import { spawn, exec as execCb } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import path from 'path';
import { getProjectsDir, getSettings } from './config.js';
import logStore from './log-store.js';
import { ensureRepo, prepareProject } from './git-ops.js';
import { pickCrash } from './flair.js';
import { findPidsOnPort, freePort, parseAddrInUsePort } from './port-utils.js';
import stateStore from './state-store.js';

const exec = promisify(execCb);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const isWindows = process.platform === 'win32';

const PORT_PATTERNS = [
  /(?:listening|running|started|server|ready).*?(?:on|at|port)[:\s]+?(\d{2,5})/i,
  /(?:port)[:\s]+?(\d{2,5})/i,
  /(?:localhost|0\.0\.0\.0|127\.0\.0\.1)[:\s]+(\d{2,5})/i,
  /:\s*(\d{4,5})(?:\s|$|\b)/,
];

// terminate an entire process group (the detached leader and its descendants).
// swallows ESRCH (already gone). returns true on success / already-dead.
function killGroup(pgid, signal) {
  if (!pgid) return false;
  try {
    if (isWindows) {
      execCb(`taskkill /pid ${pgid} /T /F`);
      return true;
    }
    process.kill(-pgid, signal);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return true;
    return false;
  }
}

// is any process in the group still alive?
function groupAlive(pgid) {
  if (!pgid || isWindows) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.state = {};
  }

  _ensureState(name) {
    if (!this.state[name]) {
      this.state[name] = {
        process: null,
        status: 'stopped',
        restarting: false,
        startedAt: null,
        stoppedByUser: false,
        crashCount: 0,
        lastCrashAt: null,
        cooldownTimer: null,
        port: null,
        pgid: null,
        lastKnownPort: null,
        _recentStderr: '',
      };
    }
    return this.state[name];
  }

  getState(name) {
    return this.state[name] || null;
  }

  getAllStates() {
    return { ...this.state };
  }

  getStatus(name) {
    const st = this.state[name];
    if (!st) return 'unknown';
    if (st.cooldownTimer) return 'cooldown';
    if (st.restarting) return 'restarting';
    if (st.status === 'running' && st.process && !st.process.killed) return 'running';
    if (st.stoppedByUser) return 'stopped';
    return st.status || 'stopped';
  }

  getUptime(name) {
    const st = this.state[name];
    if (!st || !st.startedAt || this.getStatus(name) !== 'running') return null;
    return Date.now() - st.startedAt;
  }

  getPid(name) {
    const st = this.state[name];
    if (!st || !st.process) return null;
    return st.process.pid;
  }

  getPort(name) {
    const st = this.state[name];
    return st?.port || null;
  }

  // priority: explicit config port -> current/last detected -> persisted state
  _resolveKnownPort(proj, st) {
    if (proj && proj.port) {
      const p = parseInt(proj.port, 10);
      if (Number.isInteger(p) && p > 0) return p;
    }
    if (st && st.port) return st.port;
    if (st && st.lastKnownPort) return st.lastKnownPort;
    const entry = stateStore.getEntry(proj.name);
    if (entry && entry.port) return entry.port;
    return null;
  }

  _setDetectedPort(name, port) {
    const st = this.state[name];
    if (!st || st.port) return;
    st.port = port;
    st.lastKnownPort = port;
    stateStore.setPort(name, port);
    logStore.push(name, `🔗 Detected port: ${port}`);
    this.emit('status-change', { name, status: 'running', port });
  }

  _tryExtractPort(name, text) {
    const st = this.state[name];
    if (!st || st.port) return; // already known
    for (const pattern of PORT_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const port = parseInt(match[1], 10);
        if (port >= 80 && port <= 65535) {
          this._setDetectedPort(name, port);
          return;
        }
      }
    }
  }

  async _detectPortViaSS(name, pid) {
    const st = this.state[name];
    if (!st || st.port) return;

    const detectCommand = process.platform === 'linux'
      ? `ss -tlnp 2>/dev/null | grep 'pid=${pid},' || true`
      : `lsof -Pan -p ${pid} -iTCP -sTCP:LISTEN 2>/dev/null || true`;

    for (let attempt = 0; attempt < 5; attempt++) {
      await delay(2000);
      if (!st || st.port || st.status !== 'running') return;
      try {
        const { stdout } = await exec(detectCommand);
        let match = stdout.match(/:([0-9]{2,5})\s/);
        if (!match && process.platform !== 'linux') {
          match = stdout.match(/TCP\s+[^\s]*:(\d{2,5})\s+\(LISTEN\)/i);
        }
        if (match) {
          const port = parseInt(match[1], 10);
          if (port >= 80 && port <= 65535) {
            this._setDetectedPort(name, port);
            return;
          }
        }
      } catch { /* ignore */ }
    }
  }

  // public entry: reclaim a known busy port (orphan), then spawn.
  async startProject(proj) {
    const { name } = proj;
    const st = this._ensureState(name);

    const knownPort = this._resolveKnownPort(proj, st);
    if (knownPort) {
      try {
        const pids = await findPidsOnPort(knownPort);
        if (pids.length) {
          logStore.push(name, `♻ Port ${knownPort} is busy — reclaiming before start...`);
          await freePort(knownPort, { onLog: (m) => logStore.push(name, m) });
        }
      } catch { /* never block start on reclaim */ }
    }

    return this._spawn(proj);
  }

  _spawn(proj) {
    const { name } = proj;
    const subdir = proj.subdir || 'backend';
    const entrypoint = proj.entrypoint || 'server.js';
    const command = proj.command || '';
    const workDir = path.join(getProjectsDir(), name, subdir);

    logStore.push(name, `🚀 Starting ${command || entrypoint}...`);

    const term = process.env.TERM === 'screen'
      ? 'screen-256color'
      : (process.env.TERM || 'xterm-256color');
    const colorterm = process.env.COLORTERM || (term.includes('256color') ? '24bit' : '');

    // a `command` project runs through a shell so entries can use npm scripts.
    // detached still gives the shell its own group, so killGroup reaps the whole tree.
    const p = spawn(...(command ? ['/bin/sh', ['-c', command]] : ['node', [entrypoint]]), {
      cwd: workDir,
      detached: !isWindows, // own process group so we can kill the whole tree
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TERM: term,
        FORCE_COLOR: process.env.FORCE_COLOR || '1',
        CLICOLOR_FORCE: process.env.CLICOLOR_FORCE || '1',
        COLORTERM: colorterm,
      },
    });

    const st = this._ensureState(name);
    st.process = p;
    st.pgid = p.pid;
    st.status = 'running';
    st.startedAt = Date.now();
    st.stoppedByUser = false;
    st._recentStderr = '';

    // surface an explicit configured port immediately for the dashboard
    if (proj.port) {
      const cfgPort = parseInt(proj.port, 10);
      if (Number.isInteger(cfgPort) && cfgPort > 0) st.port = cfgPort;
    }

    stateStore.recordStart(name, { pid: p.pid, pgid: p.pid, port: st.port });

    p.stdout.on('data', (data) => {
      const text = data.toString();
      logStore.push(name, text, 'stdout');
      this._tryExtractPort(name, text);
    });

    p.stderr.on('data', (data) => {
      const text = data.toString();
      logStore.push(name, text, 'stderr');
      st._recentStderr = (st._recentStderr + text).slice(-2000);
      this._tryExtractPort(name, text);
    });

    p.on('exit', (code, signal) => this._handleExit(proj, p, code, signal));

    this.emit('status-change', { name, status: 'running' });

    if (p.pid) this._detectPortViaSS(name, p.pid);

    return p;
  }

  _handleExit(proj, p, code, signal) {
    const { name } = proj;
    const st = this.state[name];
    if (!st) return;

    // stale-exit guard: ignore events from a process we've already replaced
    if (st.process && st.process !== p) return;

    if (st.restarting) {
      st.status = 'restarting';
      return;
    }

    if (st.stoppedByUser) {
      st.status = 'stopped';
      st.process = null;
      st.startedAt = null;
      st.port = null;
      st.pgid = null;
      stateStore.clearEntry(name);
      logStore.push(name, `⏹ Process stopped by user.`);
      this.emit('status-change', { name, status: 'stopped' });
      return;
    }

    // crash path
    st.process = null;
    const stderr = st._recentStderr || '';
    const addrInUsePort = parseAddrInUsePort(stderr);
    const addrInUse = addrInUsePort !== null || /EADDRINUSE|address already in use/i.test(stderr);

    // preserve last-known port for reclaim, then clear the live port
    if (st.port) st.lastKnownPort = st.port;
    st.port = null;

    st.status = 'crashed';
    st.crashCount++;
    st.lastCrashAt = Date.now();

    const settings = getSettings();
    const maxCrashes = settings.maxCrashRetries || 4;
    const cooldownMs = (settings.crashCooldownMins || 2) * 60 * 1000;
    const reclaimPort = addrInUsePort || (addrInUse ? this._resolveKnownPort(proj, st) : null);

    if (addrInUse) {
      logStore.push(name, `⚠ Port still in use — will reclaim before retry.`, 'stderr');
    }

    if (st.crashCount >= maxCrashes) {
      const cooldownMins = settings.crashCooldownMins || 2;
      logStore.push(name, `⏸ Crashed ${st.crashCount} times — taking a ${cooldownMins}m breather ${pickCrash()}`, 'stderr');
      this.emit('status-change', { name, status: 'cooldown' });

      st.cooldownTimer = setTimeout(() => {
        st.cooldownTimer = null;
        st.crashCount = 0;
        if (!st.stoppedByUser) {
          logStore.push(name, `🔄 Cooldown ended. Retrying...`);
          this._retryStart(proj, reclaimPort);
        }
      }, cooldownMs);
    } else {
      logStore.push(name, `❌ Exited (code ${code}${signal ? ', signal ' + signal : ''}) — crash ${st.crashCount}/${maxCrashes}, retrying in 3s ${pickCrash()}`, 'stderr');
      this.emit('status-change', { name, status: 'crashed' });
      setTimeout(() => this._retryStart(proj, reclaimPort), 3000);
    }
  }

  async _retryStart(proj, reclaimPort) {
    const st = this.state[proj.name];
    if (st?.stoppedByUser) return;
    if (reclaimPort) {
      try {
        const pids = await findPidsOnPort(reclaimPort);
        if (pids.length) {
          await freePort(reclaimPort, { onLog: (m) => logStore.push(proj.name, m) });
        }
      } catch { /* ignore */ }
    }
    if (!this.state[proj.name]?.stoppedByUser) {
      this.startProject(proj).catch(() => {});
    }
  }

  // gracefully terminate the whole process tree: SIGTERM -> SIGKILL escalation,
  // wait for the leader to exit, then reset state. never hangs.
  async stopProject(name) {
    const st = this.state[name];
    if (!st) return;

    st.stoppedByUser = true;
    st.crashCount = 0;
    if (st.cooldownTimer) {
      clearTimeout(st.cooldownTimer);
      st.cooldownTimer = null;
    }

    const p = st.process;
    const pgid = st.pgid;

    if (!p) {
      st.status = 'stopped';
      st.port = null;
      st.pgid = null;
      stateStore.clearEntry(name);
      this.emit('status-change', { name, status: 'stopped' });
      return;
    }

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(killTimer);
        clearTimeout(hardCap);
        resolve();
      };
      p.once('exit', finish);
      killGroup(pgid, 'SIGTERM');
      const killTimer = setTimeout(() => { if (!done) killGroup(pgid, 'SIGKILL'); }, 5000);
      const hardCap = setTimeout(finish, 8000); // never hang the UI
    });

    // make sure no descendant lingers holding the port
    killGroup(pgid, 'SIGKILL');

    st.status = 'stopped';
    st.process = null;
    st.startedAt = null;
    st.port = null;
    st.pgid = null;
    stateStore.clearEntry(name);
    this.emit('status-change', { name, status: 'stopped' });
  }

  async restartProject(proj) {
    const { name } = proj;
    const st = this.state[name];

    if (st) {
      st.crashCount = 0;
      if (st.cooldownTimer) {
        clearTimeout(st.cooldownTimer);
        st.cooldownTimer = null;
      }
    }

    if (st && st.process && !st.process.killed) {
      const pgid = st.pgid;
      st.restarting = true;
      logStore.push(name, `🔄 Restarting...`);

      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(killTimer);
          clearTimeout(hardCap);
          resolve();
        };
        st.process.once('exit', finish);
        killGroup(pgid, 'SIGTERM');
        const killTimer = setTimeout(() => { if (!done) killGroup(pgid, 'SIGKILL'); }, 5000);
        const hardCap = setTimeout(finish, 8000);
      });

      killGroup(pgid, 'SIGKILL');

      // carry the port forward for reclaim, but clear the live value
      if (st.port) st.lastKnownPort = st.port;
      st.port = null;
      st.restarting = false;
    }

    await this.startProject(proj);
  }

  // clean up orphaned process groups / ports left by a previous prozessor run.
  async reconcileOrphans() {
    const recorded = stateStore.readAll();
    const names = Object.keys(recorded);
    if (names.length === 0) return;

    for (const name of names) {
      const entry = recorded[name];
      try {
        if (entry.pgid && groupAlive(entry.pgid)) {
          logStore.push(name, `♻ Reclaiming orphaned process group (pgid ${entry.pgid}) from a previous session.`);
          killGroup(entry.pgid, 'SIGTERM');
          await delay(1500);
          if (groupAlive(entry.pgid)) killGroup(entry.pgid, 'SIGKILL');
        }
        if (entry.port) {
          const pids = await findPidsOnPort(entry.port);
          if (pids.length) {
            logStore.push(name, `♻ Freeing orphaned port ${entry.port} from a previous session.`);
            await freePort(entry.port, { onLog: (m) => logStore.push(name, m) });
          }
        }
      } catch { /* best effort */ }
      stateStore.clearEntry(name);
    }
  }

  async initializeAll(projects, onProgress) {
    await this.reconcileOrphans();

    const tasks = projects
      .filter((proj) => proj.enabled !== false)
      .map(async (proj) => {
        logStore.ensureProject(proj.name);
        try {
          if (onProgress) onProgress('clone', proj.name);
          await ensureRepo(proj);
          if (onProgress) onProgress('setup', proj.name);
          await prepareProject(proj);
          if (onProgress) onProgress('start', proj.name);
          await this.startProject(proj);
        } catch (err) {
          logStore.push(proj.name, `❌ Failed to initialize: ${err.message}`, 'stderr');
        }
      });

    await Promise.all(tasks);
  }

  async shutdownAll() {
    const running = Object.entries(this.state)
      .filter(([, st]) => (st.process && !st.process.killed) || st.cooldownTimer)
      .map(([name]) => name);

    logStore.push('system', `⏹ Shutting down ${running.length} project(s)...`);

    await Promise.all(running.map((name) => this.stopProject(name)));
  }

  // best-effort synchronous tree-kill for force-quit / fatal-crash paths,
  // where there is no time to await graceful shutdown.
  killAllSync() {
    const pgids = new Set();
    for (const st of Object.values(this.state)) {
      if (st.pgid) pgids.add(st.pgid);
    }
    try {
      const recorded = stateStore.readAll();
      for (const entry of Object.values(recorded)) {
        if (entry.pgid) pgids.add(entry.pgid);
      }
    } catch { /* ignore */ }

    for (const pgid of pgids) {
      killGroup(pgid, 'SIGKILL');
    }
    try { stateStore.clearAll(); } catch { /* ignore */ }
  }
}

const processManager = new ProcessManager();
export default processManager;
