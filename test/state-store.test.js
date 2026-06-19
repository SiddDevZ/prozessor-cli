import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = path.join(os.tmpdir(), `proz-state-${process.pid}.json`);
process.env.PROZESSOR_STATE_PATH = TMP;

// import after setting the env override so statePath() picks it up
const store = (await import('../lib/state-store.js')).default;

beforeEach(() => {
  try { fs.unlinkSync(TMP); } catch {}
});

afterEach(() => {
  try { fs.unlinkSync(TMP); } catch {}
});

test('readAll: empty when file is missing', () => {
  assert.deepEqual(store.readAll(), {});
});

test('recordStart + readAll: round-trip', () => {
  store.recordStart('alpha', { pid: 111, pgid: 111, port: 3000 });
  const all = store.readAll();
  assert.equal(all.alpha.pid, 111);
  assert.equal(all.alpha.pgid, 111);
  assert.equal(all.alpha.port, 3000);
  assert.ok(typeof all.alpha.startedAt === 'number');
});

test('setPort: updates only the port, creating entry if needed', () => {
  store.setPort('beta', 8080);
  assert.equal(store.getEntry('beta').port, 8080);

  store.recordStart('beta', { pid: 222, pgid: 222, port: 9000 });
  store.setPort('beta', 9100);
  const e = store.getEntry('beta');
  assert.equal(e.port, 9100);
  assert.equal(e.pid, 222);
});

test('clearEntry: removes one project, keeps others', () => {
  store.recordStart('a', { pid: 1 });
  store.recordStart('b', { pid: 2 });
  store.clearEntry('a');
  assert.equal(store.getEntry('a'), null);
  assert.equal(store.getEntry('b').pid, 2);
});

test('readAll: resilient to a corrupt file', () => {
  fs.writeFileSync(TMP, '{ this is not valid json');
  assert.deepEqual(store.readAll(), {});
  // and writing still works afterwards
  store.recordStart('c', { pid: 3 });
  assert.equal(store.getEntry('c').pid, 3);
});
