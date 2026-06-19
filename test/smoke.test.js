import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnDummy, isAlive, getFreePort, isPortFree } from './helpers.js';

test('harness: dummy server binds a port and reports it', async () => {
  const port = await getFreePort();
  const { proc, port: bound } = await spawnDummy(port);
  assert.equal(bound, port);
  assert.ok(isAlive(proc.pid));
  assert.equal(await isPortFree(port), false);
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {}
});
