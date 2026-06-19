// persists per-project runtime info across prozessor sessions so orphaned
// process trees from a previous (crashed/force-quit) run can be reconciled.
// the file is intentionally small and gitignored. all reads are crash-safe:
// a missing or corrupt file yields an empty record rather than throwing.
import fs from 'fs';
import path from 'path';
import { getRootDir } from './config.js';

function statePath() {
  // env override keeps tests from clobbering a real session's state file
  if (process.env.PROZESSOR_STATE_PATH) return process.env.PROZESSOR_STATE_PATH;
  return path.join(getRootDir(), '.prozessor-state.json');
}

export function readAll() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && data.projects && typeof data.projects === 'object') {
      return data.projects;
    }
    return {};
  } catch {
    return {};
  }
}

function writeAll(projects) {
  const file = statePath();
  const tmp = `${file}.${process.pid}.tmp`;
  const payload = JSON.stringify({ projects }, null, 2);
  try {
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, file); // atomic replace
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function getEntry(name) {
  return readAll()[name] || null;
}

export function recordStart(name, { pid = null, pgid = null, port = null } = {}) {
  const all = readAll();
  all[name] = { pid, pgid, port, startedAt: Date.now() };
  writeAll(all);
  return all[name];
}

export function setPort(name, port) {
  const all = readAll();
  if (!all[name]) all[name] = { pid: null, pgid: null, port: null, startedAt: Date.now() };
  all[name].port = port;
  writeAll(all);
  return all[name];
}

export function clearEntry(name) {
  const all = readAll();
  if (name in all) {
    delete all[name];
    writeAll(all);
  }
}

export function clearAll() {
  writeAll({});
}

export default { readAll, getEntry, recordStart, setPort, clearEntry, clearAll };
