// cross-platform helpers to discover and free TCP ports.
// every function is defensive: it swallows errors and returns structured
// results rather than throwing, so callers never crash on a missing tool.
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

function uniqPids(values) {
  const out = [];
  for (const v of values) {
    const pid = parseInt(v, 10);
    if (Number.isInteger(pid) && pid > 0 && !out.includes(pid)) out.push(pid);
  }
  return out;
}

// extract a port from an EADDRINUSE-style message.
// handles ":::3000", "0.0.0.0:3000", "address already in use :3000",
// "address already in use 127.0.0.1:8080", and bare "EADDRINUSE 3000".
export function parseAddrInUsePort(text) {
  if (!text) return null;
  const str = String(text);
  if (!/EADDRINUSE|address already in use/i.test(str)) return null;

  const patterns = [
    /(?:\d{1,3}(?:\.\d{1,3}){3}|::|\[[^\]]*\]):(\d{2,5})/, // host:port (ipv4/ipv6)
    /:::?(\d{2,5})/,                                       // :::port or ::port
    /address already in use[^\d]*(\d{2,5})/i,              // trailing port
    /EADDRINUSE[^\d]*(\d{2,5})/i,                          // EADDRINUSE <port>
  ];

  for (const re of patterns) {
    const m = str.match(re);
    if (m) {
      const port = parseInt(m[1], 10);
      if (port >= 1 && port <= 65535) return port;
    }
  }
  return null;
}

// return the list of PIDs listening on the given TCP port.
export async function findPidsOnPort(port) {
  const p = parseInt(port, 10);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return [];

  try {
    if (isWindows) {
      const { stdout } = await exec(`netstat -ano -p tcp | findstr ":${p} "`, { timeout: 5000 });
      const pids = stdout
        .split('\n')
        .filter((l) => /LISTENING/i.test(l))
        .map((l) => l.trim().split(/\s+/).pop());
      return uniqPids(pids);
    }

    // macOS + Linux: lsof is the most reliable when present
    try {
      const { stdout } = await exec(`lsof -ti tcp:${p} -sTCP:LISTEN`, { timeout: 5000 });
      const pids = uniqPids(stdout.split('\n'));
      if (pids.length) return pids;
    } catch {
      // lsof returns non-zero (and throws) when nothing matches; fall through
    }

    if (isLinux) {
      // fuser fallback: prints pids like "3000/tcp: 1234 1235"
      try {
        const { stdout, stderr } = await exec(`fuser ${p}/tcp 2>&1`, { timeout: 5000 });
        const pids = uniqPids(`${stdout} ${stderr}`.replace(/\d+\/tcp:?/g, '').split(/\s+/));
        if (pids.length) return pids;
      } catch {
        // ignore
      }
      // ss fallback: parse pid=NNN from the process column
      try {
        const { stdout } = await exec(`ss -tlnpH 'sport = :${p}'`, { timeout: 5000 });
        const pids = uniqPids([...stdout.matchAll(/pid=(\d+)/g)].map((m) => m[1]));
        if (pids.length) return pids;
      } catch {
        // ignore
      }
    }

    return [];
  } catch {
    return [];
  }
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    // ESRCH: already gone (treat as success). EPERM: not ours (failure).
    return err.code === 'ESRCH';
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// free a port by terminating its listeners: SIGTERM, brief wait, then SIGKILL.
// returns { port, freed, killed: [pids], stillAlive: [pids] }.
export async function freePort(port, { onLog, graceMs = 1500 } = {}) {
  const p = parseInt(port, 10);
  const log = typeof onLog === 'function' ? onLog : () => {};
  const result = { port: p, freed: true, killed: [], stillAlive: [] };

  if (!Number.isInteger(p) || p < 1 || p > 65535) return result;

  const pids = await findPidsOnPort(p);
  if (pids.length === 0) return result;

  log(`♻ Reclaiming port ${p} from pid(s): ${pids.join(', ')}`);

  for (const pid of pids) killPid(pid, 'SIGTERM');

  await new Promise((r) => setTimeout(r, graceMs));

  for (const pid of pids) {
    if (isPidAlive(pid)) killPid(pid, 'SIGKILL');
    result.killed.push(pid);
  }

  // short settle, then confirm
  await new Promise((r) => setTimeout(r, 300));
  const remaining = await findPidsOnPort(p);
  result.stillAlive = remaining;
  result.freed = remaining.length === 0;
  return result;
}
