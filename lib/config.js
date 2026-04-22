import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'projects.json');
const CONFIG_EXAMPLE_PATH = path.join(ROOT, 'projects.example.json');

const DEFAULTS = {
  pollInterval: 20,
  logBufferSize: 500,
  maxCrashRetries: 4,
  crashCooldownMins: 2,
  autoUpdateCli: true,
};

function defaultConfig() {
  return { projects: [], settings: { ...DEFAULTS } };
}

function normalizeConfig(data) {
  const source = data && typeof data === 'object' ? data : {};
  const projects = Array.isArray(source.projects) ? source.projects : [];
  const settings = { ...DEFAULTS, ...(source.settings || {}) };
  return { projects, settings };
}

export function loadProjects() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const seed = fs.existsSync(CONFIG_EXAMPLE_PATH)
      ? normalizeConfig(fs.readJsonSync(CONFIG_EXAMPLE_PATH))
      : defaultConfig();
    const data = normalizeConfig(seed);
    fs.writeJsonSync(CONFIG_PATH, data, { spaces: 2 });
    return data;
  }

  const loaded = fs.readJsonSync(CONFIG_PATH);
  const normalized = normalizeConfig(loaded);
  return normalized;
}

export function saveProjects(data) {
  fs.writeJsonSync(CONFIG_PATH, normalizeConfig(data), { spaces: 2 });
}

export function addProject({ name, repoUrl, branch = 'main', envSrc = '', subdir = 'backend', entrypoint = 'server.js' }) {
  const data = loadProjects();
  if (data.projects.find((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Project "${name}" already exists.`);
  }
  data.projects.push({ name, repoUrl, branch, envSrc, subdir, entrypoint, enabled: true });
  saveProjects(data);
  return data;
}

export function removeProject(name) {
  const data = loadProjects();
  const idx = data.projects.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) throw new Error(`Project "${name}" not found.`);
  const removed = data.projects.splice(idx, 1)[0];
  saveProjects(data);
  return removed;
}

export function updateProject(name, updates) {
  const data = loadProjects();
  const proj = data.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!proj) throw new Error(`Project "${name}" not found.`);
  Object.assign(proj, updates);
  saveProjects(data);
  return proj;
}

export function updateSettings(updates) {
  const data = loadProjects();
  if (!data.settings) data.settings = { ...DEFAULTS };
  Object.assign(data.settings, updates);
  saveProjects(data);
  return data.settings;
}

export function getSettings() {
  const data = loadProjects();
  return { ...DEFAULTS, ...(data.settings || {}) };
}

export function getProjectsDir() {
  const dir = path.join(ROOT, 'projects');
  fs.ensureDirSync(dir);
  return dir;
}

export function getRootDir() {
  return ROOT;
}
