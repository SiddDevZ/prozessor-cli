// shared helpers for the test suite
import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DUMMY_SERVER = path.join(__dirname, 'fixtures', 'dummy-server.js');

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export async function waitFor(fn, { timeout = 5000, interval = 50 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeout) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
}

export function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export function isPortFree(port) {
  // connect-based: if a connection succeeds the port is in use, regardless of
  // whether the listener bound IPv4, IPv6 or dual-stack.
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.setTimeout(1000);
    sock.once('connect', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(true));
  });
}

// spawn the dummy server detached (its own process group) and resolve once it
// reports its listening port. returns { proc, pgid, port, childPid }.
export function spawnDummy(port, { forkChild = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [DUMMY_SERVER], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DUMMY_PORT: String(port), DUMMY_FORK_CHILD: forkChild ? '1' : '0' },
    });

    let boundPort = null;
    let childPid = null;
    let settled = false;

    const onData = (buf) => {
      const text = buf.toString();
      const m = text.match(/listening on port (\d+)/);
      if (m) boundPort = parseInt(m[1], 10);
      const c = text.match(/child pid (\d+)/);
      if (c) childPid = parseInt(c[1], 10);

      if (!settled && boundPort && (!forkChild || childPid)) {
        settled = true;
        resolve({ proc, pgid: proc.pid, port: boundPort, childPid });
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('dummy server did not start in time'));
      }
    }, 5000);
    timer.unref();
  });
}
