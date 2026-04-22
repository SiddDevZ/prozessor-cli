import { spawn, exec as execCb } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import path from 'path';
import { getProjectsDir, getSettings } from './config.js';
import logStore from './log-store.js';
import { ensureRepo, prepareProject } from './git-ops.js';
import { pickCrash } from './flair.js';

const exec = promisify(execCb);

const PORT_PATTERNS = [
  /(?:listening|running|started|server|ready).*?(?:on|at|port)[:\s]+?(\d{2,5})/i,
  /(?:port)[:\s]+?(\d{2,5})/i,
  /(?:localhost|0\.0\.0\.0|127\.0\.0\.1)[:\s]+(\d{2,5})/i,
  /:\s*(\d{4,5})(?:\s|$|\b)/,
];

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

  _tryExtractPort(name, text) {
    const st = this.state[name];
    if (!st || st.port) return; // already detected
    for (const pattern of PORT_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const port = parseInt(match[1], 10);
        if (port >= 80 && port <= 65535) {
          st.port = port;
          logStore.push(name, `🔗 Detected port: ${port}`);
          this.emit('status-change', { name, status: 'running', port });
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

    // Try up to 5 times with 2s intervals
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(r => setTimeout(r, 2000));
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
            st.port = port;
            logStore.push(name, `🔗 Detected port: ${port}`);
            this.emit('status-change', { name, status: 'running', port });
            return;
          }
        }
      } catch { /* ignore */ }
    }
  }

  startProject(proj) {
    const { name } = proj;
    const subdir = proj.subdir || 'backend';
    const entrypoint = proj.entrypoint || 'server.js';
    const workDir = path.join(getProjectsDir(), name, subdir);

    logStore.push(name, `🚀 Starting ${entrypoint}...`);

    const term = process.env.TERM === 'screen'
      ? 'screen-256color'
      : (process.env.TERM || 'xterm-256color');
    const colorterm = process.env.COLORTERM || (term.includes('256color') ? '24bit' : '');

    const p = spawn('node', [entrypoint], {
      cwd: workDir,
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
    st.status = 'running';
    st.startedAt = Date.now();
    st.stoppedByUser = false;

    p.stdout.on('data', (data) => {
      const text = data.toString();
      logStore.push(name, text, 'stdout');
      this._tryExtractPort(name, text);
    });

    p.stderr.on('data', (data) => {
      const text = data.toString();
      logStore.push(name, text, 'stderr');
      this._tryExtractPort(name, text);
    });

    p.on('exit', (code, signal) => {
      const currentSt = this.state[name];
      if (!currentSt) return;

      if (currentSt.restarting) {
        currentSt.status = 'restarting';
        return;
      }

      if (currentSt.stoppedByUser) {
        currentSt.status = 'stopped';
        logStore.push(name, `⏹ Process stopped by user.`);
        this.emit('status-change', { name, status: 'stopped' });
        return;
      }

      currentSt.status = 'crashed';
      currentSt.crashCount++;
      currentSt.lastCrashAt = Date.now();

      const settings = getSettings();
      const maxCrashes = settings.maxCrashRetries || 4;
      const cooldownMs = (settings.crashCooldownMins || 2) * 60 * 1000;

      if (currentSt.crashCount >= maxCrashes) {
        const cooldownMins = (settings.crashCooldownMins || 2);
        logStore.push(name, `⏸ Crashed ${currentSt.crashCount} times — taking a ${cooldownMins}m breather ${pickCrash()}`, 'stderr');
        this.emit('status-change', { name, status: 'cooldown' });

        currentSt.cooldownTimer = setTimeout(() => {
          currentSt.cooldownTimer = null;
          currentSt.crashCount = 0;
          if (!currentSt.stoppedByUser) {
            logStore.push(name, `🔄 Cooldown ended. Retrying...`);
            this.startProject(proj);
          }
        }, cooldownMs);
      } else {
        logStore.push(name, `❌ Exited (code ${code}${signal ? ', signal ' + signal : ''}) — crash ${currentSt.crashCount}/${maxCrashes}, retrying in 3s ${pickCrash()}`, 'stderr');
        this.emit('status-change', { name, status: 'crashed' });

        setTimeout(() => {
          if (!this.state[name]?.stoppedByUser) {
            this.startProject(proj);
          }
        }, 3000);
      }
    });

    this.emit('status-change', { name, status: 'running' });

    // Background port detection via ss as fallback
    if (p.pid) this._detectPortViaSS(name, p.pid);

    return p;
  }

  async stopProject(name) {
    const st = this.state[name];
    if (!st) return;

    st.stoppedByUser = true;
    st.crashCount = 0;

    if (st.cooldownTimer) {
      clearTimeout(st.cooldownTimer);
      st.cooldownTimer = null;
    }

    if (!st.process) {
      st.status = 'stopped';
      this.emit('status-change', { name, status: 'stopped' });
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (st.process && !st.process.killed) {
          st.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      st.process.once('exit', () => {
        clearTimeout(timeout);
        st.status = 'stopped';
        st.process = null;
        st.startedAt = null;
        st.port = null;
        this.emit('status-change', { name, status: 'stopped' });
        resolve();
      });

      st.process.kill('SIGTERM');
    });
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
      st.restarting = true;
      logStore.push(name, `🔄 Restarting...`);

      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (st.process && !st.process.killed) st.process.kill('SIGKILL');
          resolve();
        }, 5000);

        st.process.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        st.process.kill('SIGTERM');
      });

      st.restarting = false;
    }

    this.startProject(proj);
  }

  async initializeAll(projects, onProgress) {
    const tasks = projects
      .filter(proj => proj.enabled !== false)
      .map(async (proj) => {
        logStore.ensureProject(proj.name);
        try {
          if (onProgress) onProgress('clone', proj.name);
          await ensureRepo(proj);
          if (onProgress) onProgress('setup', proj.name);
          await prepareProject(proj);
          if (onProgress) onProgress('start', proj.name);
          this.startProject(proj);
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

    await Promise.all(
      running.map((name) => this.stopProject(name))
    );
  }
}

const processManager = new ProcessManager();
export default processManager;
