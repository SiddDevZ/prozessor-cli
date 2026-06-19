import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, isTimeoutError } from '../lib/git-ops.js';

test('runCommand: succeeds for a fast command', async () => {
  const res = await runCommand('echo hello', { timeout: 5000 });
  assert.equal(res.ok, true);
  assert.equal(res.timedOut, false);
  assert.match(res.stdout, /hello/);
});

test('runCommand: times out a slow command without throwing', async () => {
  const res = await runCommand('sleep 5', { timeout: 200 });
  assert.equal(res.ok, false);
  assert.equal(res.timedOut, true);
  assert.ok(isTimeoutError(res.error));
});

test('runCommand: reports non-timeout failures distinctly', async () => {
  const res = await runCommand('exit 3', { timeout: 5000 });
  assert.equal(res.ok, false);
  assert.equal(res.timedOut, false);
});
