import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// isolate state file and projects dir before importing modules that read them
const STATE = path.join(os.tmpdir(), `proz-pm-state-${process.pid}.json`);
const PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'proz-pm-projects-'));
process.env.PROZESSOR_STATE_PATH = STATE;
process.env.PROZESSOR_PROJECTS_DIR = PROJECTS;

const processManager = (await import('../lib/process-manager.js')).default;
const stateStore = (await import('../lib/state-store.js')).default;
const { getProjectsDir } = await import('../lib/config.js');
const logStore = (await import('../lib/log-store.js')).default;
const { DUMMY_SERVER, spawnDummy, getFreePort, isPortFree, isAlive, waitFor } = await import('./helpers.js');

let counter = 0;
const created = [];

function makeProject({ forkChild = false, port } = {}) {
  counter += 1;
  const name = `__proztest_${process.pid}_${counter}`;
  const dir = path.join(getProjectsDir(), name, 'backend');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(DUMMY_SERVER, path.join(dir, 'server.js'));
  created.push(name);
  // dummy reads DUMMY_PORT / DUMMY_FORK_CHILD from inherited env
  process.env.DUMMY_PORT = String(port);
  process.env.DUMMY_FORK_CHILD = forkChild ? '1' : '0';
  const proj = { name, subdir: 'backend', entrypoint: 'server.js' };
  if (port) proj.port = port;
  return proj;
}

function childPidFromLogs(name) {
  for (const line of logStore.getLines(name, 300)) {
    const m = line.text.match(/child pid (\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

beforeEach(() => {
  try { fs.unlinkSync(STATE); } catch {}
});

afterEach(async () => {
  for (const name of created.splice(0)) {
    try { await processManager.stopProject(name); } catch {}
    try {
      fs.rmSync(path.join(getProjectsDir(), name), { recursive: true, force: true });
    } catch {}
  }
  delete process.env.DUMMY_PORT;
  delete process.env.DUMMY_FORK_CHILD;
});

test('stopProject kills the whole process tree and frees the port', async () => {
  const port = await getFreePort();
  const proj = makeProject({ forkChild: true, port });

  await processManager.startProject(proj);
  const up = await waitFor(async () => !(await isPortFree(port)));
  assert.ok(up, 'server should be listening');

  const parentPid = processManager.getPid(proj.name);
  const childPid = await waitFor(() => childPidFromLogs(proj.name)).then(() => childPidFromLogs(proj.name));
  assert.ok(parentPid && childPid, 'should know parent + child pids');

  await processManager.stopProject(proj.name);

  assert.ok(await waitFor(() => !isAlive(parentPid)), 'parent should be dead');
  assert.ok(await waitFor(() => !isAlive(childPid)), 'forked child should be dead');
  assert.equal(await isPortFree(port), true, 'port should be free');
  assert.equal(stateStore.getEntry(proj.name), null, 'state entry cleared');
});

test('restartProject reclaims the port and yields a fresh pid', async () => {
  const port = await getFreePort();
  const proj = makeProject({ port });

  await processManager.startProject(proj);
  assert.ok(await waitFor(async () => !(await isPortFree(port))), 'first start listening');
  const firstPid = processManager.getPid(proj.name);

  await processManager.restartProject(proj);
  assert.ok(await waitFor(async () => !(await isPortFree(port))), 'restarted and listening again');

  const secondPid = processManager.getPid(proj.name);
  assert.ok(secondPid && secondPid !== firstPid, 'restart should produce a new pid');
  assert.ok(!isAlive(firstPid), 'old process gone');
  assert.equal(processManager.getStatus(proj.name), 'running');
});

test('startProject reclaims a known busy port (EADDRINUSE prevention)', async () => {
  const port = await getFreePort();
  // an orphan already squatting on the port
  const orphan = await spawnDummy(port);
  assert.equal(await isPortFree(port), false, 'orphan holds the port');

  const proj = makeProject({ port }); // explicit port -> pre-start reclaim
  await processManager.startProject(proj);

  assert.ok(await waitFor(() => !isAlive(orphan.pgid)), 'orphan should be reclaimed');
  assert.ok(await waitFor(async () => !(await isPortFree(port))), 'our service holds the port now');
  assert.equal(processManager.getStatus(proj.name), 'running');
});

test('reconcileOrphans kills tracked orphan groups and frees their ports', async () => {
  const port = await getFreePort();
  const orphan = await spawnDummy(port);

  // simulate a previous session having recorded this process
  stateStore.recordStart('__orphan_proj__', { pid: orphan.pgid, pgid: orphan.pgid, port });

  await processManager.reconcileOrphans();

  assert.ok(await waitFor(() => !isAlive(orphan.pgid)), 'orphan group killed');
  assert.equal(await isPortFree(port), true, 'orphan port freed');
  assert.equal(stateStore.getEntry('__orphan_proj__'), null, 'stale state cleared');
});

test('killAllSync terminates managed process groups synchronously', async () => {
  const port = await getFreePort();
  const proj = makeProject({ port });
  await processManager.startProject(proj);
  assert.ok(await waitFor(async () => !(await isPortFree(port))), 'running');

  const pid = processManager.getPid(proj.name);
  processManager.killAllSync();

  assert.ok(await waitFor(() => !isAlive(pid)), 'process killed after killAllSync');
});
