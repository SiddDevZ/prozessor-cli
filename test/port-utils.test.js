import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddrInUsePort, findPidsOnPort, freePort } from '../lib/port-utils.js';
import { spawnDummy, getFreePort, isPortFree, isAlive, waitFor } from './helpers.js';

test('parseAddrInUsePort: real-world EADDRINUSE message formats', () => {
  const cases = [
    ['Error: listen EADDRINUSE: address already in use :::3000', 3000],
    ['Error: listen EADDRINUSE: address already in use 0.0.0.0:8080', 8080],
    ['Error: listen EADDRINUSE: address already in use 127.0.0.1:5173', 5173],
    ['listen EADDRINUSE: address already in use :::443', 443],
    ['EADDRINUSE 4000', 4000],
    ['address already in use :9229', 9229],
  ];
  for (const [msg, expected] of cases) {
    assert.equal(parseAddrInUsePort(msg), expected, `failed for: ${msg}`);
  }
});

test('parseAddrInUsePort: returns null for unrelated text', () => {
  assert.equal(parseAddrInUsePort('server listening on port 3000'), null);
  assert.equal(parseAddrInUsePort(''), null);
  assert.equal(parseAddrInUsePort(null), null);
  assert.equal(parseAddrInUsePort('ECONNREFUSED 127.0.0.1:5432'), null);
});

test('findPidsOnPort: locates a listening process and returns [] when free', async () => {
  const port = await getFreePort();
  assert.deepEqual(await findPidsOnPort(port), [], 'should be empty before start');

  const { proc } = await spawnDummy(port);
  try {
    const pids = await findPidsOnPort(port);
    assert.ok(pids.includes(proc.pid), `expected ${proc.pid} in ${JSON.stringify(pids)}`);
  } finally {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
  }
});

test('freePort: terminates the listener and releases the port', async () => {
  const port = await getFreePort();
  const { proc } = await spawnDummy(port);

  const res = await freePort(port);
  assert.equal(res.freed, true, `port not freed: ${JSON.stringify(res)}`);

  const gone = await waitFor(() => !isAlive(proc.pid));
  assert.ok(gone, 'listener process should be dead');
  assert.equal(await isPortFree(port), true, 'port should be free again');
});

test('freePort: no-op on an already-free port', async () => {
  const port = await getFreePort();
  const res = await freePort(port);
  assert.equal(res.freed, true);
  assert.deepEqual(res.killed, []);
});
