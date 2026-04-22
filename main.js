import pc from 'picocolors';
import { intro, outro, select, text, confirm, isCancel, log } from '@clack/prompts';
import { loadProjects, addProject, removeProject, updateSettings, getSettings } from './lib/config.js';
import processManager from './lib/process-manager.js';
import logStore from './lib/log-store.js';
import { checkAllForUpdates } from './lib/git-ops.js';
import Dashboard from './lib/ui.js';
import { pickSuccess, pickFarewell, pickError, pickCrash } from './lib/flair.js';
import { terminalTheme } from './lib/theme.js';

const accent = terminalTheme.accent;
const accentBg = terminalTheme.accentBg;
const muted = terminalTheme.muted;
const dim = terminalTheme.dim;
const APP_NAME = 'PROZESSOR';
const APP_VERSION = '1.0.0';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const MENU_CANCEL = '__MENU_CANCEL__';
const MENU_EXIT = '__MENU_EXIT__';

const MENU_LOGO_LINES = [
  '  █▀█ █▀█ █▀█ ▀▀█ █▀▀ █▀▀ █▀▀ █▀█ █▀█',
  '  █▀▀ █▀▄ █ █ ▄▀  █▀▀ ▀▀█ ▀▀█ █ █ █▀▄',
  '  ▀   ▀ ▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀ ▀',
];

const MENU_LOGO_GRADIENT = [
  [168, 85, 247],
  [192, 132, 252],
  [211, 170, 255],
];

const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function patchedWrite(data, ...args) {
  if (typeof data === 'string') {
    if (terminalTheme.colorLevel === 'truecolor') {
      data = data.replaceAll('\x1b[36m', '\x1b[38;2;192;132;252m');
    } else if (terminalTheme.colorLevel === 'basic') {
      data = data.replaceAll('\x1b[36m', '\x1b[35m');
    }
  }
  return originalWrite(data, ...args);
};

function animatedSpinner() {
  let interval = null;
  let msg = '';
  let frameIdx = 0;
  return {
    start(msg) {
      this.stop();
      process.stdout.write('\x1b[?25l');
      this.message(msg);
      interval = setInterval(() => {
        const frame = BRAILLE_FRAMES[frameIdx++ % BRAILLE_FRAMES.length];
        process.stdout.write(`\r\x1b[2K  ${accent(frame)} ${msg}`);
      }, 85);
    },
    stop(finalMessage = '') {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write('\r\x1b[2K\x1b[?25h');
      if (finalMessage) process.stdout.write(`  ${finalMessage}\n`);
    },
    message(next) {
      msg = next.replace(/\.+\s*$/, '');
      frameIdx = 0;
      const frame = BRAILLE_FRAMES[frameIdx % BRAILLE_FRAMES.length];
      process.stdout.write(`\r\x1b[2K  ${accent(frame)} ${msg}`);
    },
  };
}

let dashboard = null;
let pollTimer = null;
let menuOpening = false;
let menuCancelIntent = 'dashboard';
let originalStdinEmit = null;
let lastKeyTime = 0;
let lastKeyName = '';

function beginMenuKeyTracking() {
  menuCancelIntent = 'dashboard';
  if (!process.stdin || originalStdinEmit) return;

  originalStdinEmit = process.stdin.emit.bind(process.stdin);
  process.stdin.emit = function (event, ...args) {
    if (event === 'keypress' && args[1]) {
      const key = args[1];
      if (key.ctrl && key.name === 'c') menuCancelIntent = 'exit';
      else if (key.name === 'escape') menuCancelIntent = 'dashboard';
      else if (key.name === 'up' || key.name === 'down') {
        const now = Date.now();
        if (now - lastKeyTime < 50 && lastKeyName === key.name) {
          return false; 
        }
        lastKeyTime = now;
        lastKeyName = key.name;
      }
    } else if (event === 'data' && args[0]) {
      const chunk = args[0];
      if (chunk.length > 0) {
        const first = typeof chunk === 'string' ? chunk.charCodeAt(0) : chunk[0];
        if (first === 3) menuCancelIntent = 'exit';
        else if (first === 27) menuCancelIntent = 'dashboard';
      }
    }
    return originalStdinEmit(event, ...args);
  };
}

function endMenuKeyTracking() {
  if (process.stdin && originalStdinEmit) {
    process.stdin.emit = originalStdinEmit;
  }
  lastKeyTime = 0;
  lastKeyName = '';
  originalStdinEmit = null;
  menuCancelIntent = 'dashboard';
}

function handleCancel(value) {
  if (isCancel(value)) {
    if (menuOpening && menuCancelIntent === 'exit') {
      return MENU_EXIT;
    }
    return MENU_CANCEL;
  }
  return value;
}

function isCancelled(value) {
  return value === MENU_CANCEL;
}

function isMenuExit(value) {
  return value === MENU_EXIT;
}

function getCancelReturn(value) {
  if (isCancelled(value) || isMenuExit(value)) return value;
  return null;
}

function formatUptime(ms) {
  if (!ms) return pc.dim('--');
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

async function showLogo() {
  console.clear();
  console.log('');
  for (let i = 0; i < MENU_LOGO_LINES.length; i++) {
    const line = MENU_LOGO_LINES[i];
    if (terminalTheme.colorLevel === 'truecolor') {
      const [r, g, b] = MENU_LOGO_GRADIENT[i % MENU_LOGO_GRADIENT.length];
      console.log(`\x1b[38;2;${r};${g};${b}m${line}\x1b[39m`);
    } else {
      console.log(accent(line));
    }
  }
  console.log('');
  intro(accentBg(` made by @buildwithsid v${APP_VERSION} `));
}

async function mainMenu() {
  const data = loadProjects();
  const projects = data.projects;
  const running = projects.filter((p) => processManager.getStatus(p.name) === 'running').length;

  const statusSummary = `${running}/${projects.length} running`;

  const choice = handleCancel(
    await select({
      message: accent(`Control Panel ${dim(`(${statusSummary})`)}`),
      options: [
        { value: 'start',       label: `Start Project`,     hint: 'wakey wakey project' },
        { value: 'stop',        label: `Stop Project`,      hint: 'put a project to sleep' },
        { value: 'add',         label: `Add Project`,       hint: 'add a new project' },
        { value: 'remove',      label: `Remove Project`,    hint: 'remove a project' },
        { value: 'settings',    label: `Settings`,          hint: 'tune the engine' },
        { value: 'dashboard',   label: `Back to Dashboard`, hint: 'return to live view' },
      ],
    })
  );

  if (isMenuExit(choice)) return MENU_EXIT;
  if (isCancelled(choice) || choice === 'dashboard') return MENU_CANCEL;

  switch (choice) {
    case 'start': {
      const result = await startFlow();
      if (isMenuExit(result)) return MENU_EXIT;
      if (isCancelled(result)) return;
      return mainMenu();
    }
    case 'stop': {
      const result = await stopFlow();
      if (isMenuExit(result)) return MENU_EXIT;
      if (isCancelled(result)) return;
      return mainMenu();
    }
    case 'add': {
      const result = await addProjectFlow();
      if (isMenuExit(result)) return MENU_EXIT;
      if (isCancelled(result)) return;
      return mainMenu();
    }
    case 'remove': {
      const result = await removeFlow();
      if (isMenuExit(result)) return MENU_EXIT;
      if (isCancelled(result)) return;
      return mainMenu();
    }
    case 'settings': {
      const result = await settingsMenu();
      if (isMenuExit(result)) return MENU_EXIT;
      if (isCancelled(result)) return;
      return mainMenu();
    }
  }
}

async function startFlow() {
  const { projects } = loadProjects();
  const stopped = projects.filter((p) => processManager.getStatus(p.name) !== 'running');

  if (stopped.length === 0) {
    log.info(`All projects already running. ${dim(pickSuccess())}`);
    return;
  }

  const name = handleCancel(
    await select({
      message: 'Start which project?',
      options: stopped.map((p) => ({ value: p.name, label: p.name, hint: processManager.getStatus(p.name) })),
    })
  );
  {
    const cancelValue = getCancelReturn(name);
    if (cancelValue) return cancelValue;
  }

  const proj = projects.find((p) => p.name === name);
  const s = animatedSpinner();
  s.start(`Waking up ${name}`);
  processManager.startProject(proj);

  await new Promise((r) => setTimeout(r, 1500));
  const status = processManager.getStatus(name);
  if (status === 'running') {
    s.stop(`✅ ${name} is alive! ${dim(pickSuccess())}`);
  } else {
    s.stop(`❌ ${name} — ${status} ${dim(pickError())}`);
  }
}

async function stopFlow() {
  const { projects } = loadProjects();
  const running = projects.filter((p) => processManager.getStatus(p.name) === 'running');

  if (running.length === 0) {
    log.info('No running projects to stop.');
    return;
  }

  const name = handleCancel(
    await select({
      message: 'Stop which project?',
      options: running.map((p) => ({
        value: p.name,
        label: p.name,
        hint: `PID ${processManager.getPid(p.name)} · ${formatUptime(processManager.getUptime(p.name))}`,
      })),
    })
  );
  {
    const cancelValue = getCancelReturn(name);
    if (cancelValue) return cancelValue;
  }

  const s = animatedSpinner();
  s.start(`Putting ${name} to sleep`);
  await processManager.stopProject(name);
  s.stop(`✅ ${name} stopped. ${dim(pickSuccess())}`);
}

async function addProjectFlow() {
  const name = handleCancel(
    await text({
      message: 'Project name:',
      placeholder: 'my-project',
      validate(v) { if (!v.trim()) return 'Name is required.'; },
    })
  );
  {
    const cancelValue = getCancelReturn(name);
    if (cancelValue) return cancelValue;
  }

  const repoUrl = handleCancel(
    await text({
      message: 'Git repo URL:',
      placeholder: 'git@github.com:user/repo.git',
      validate(v) { if (!v.trim()) return 'Repo URL is required.'; },
    })
  );
  {
    const cancelValue = getCancelReturn(repoUrl);
    if (cancelValue) return cancelValue;
  }

  const branch = handleCancel(
    await text({
      message: 'Branch:',
      placeholder: 'main',
      initialValue: 'main',
    })
  );
  {
    const cancelValue = getCancelReturn(branch);
    if (cancelValue) return cancelValue;
  }

  const subdir = handleCancel(
    await text({
      message: 'Subdirectory (where server lives):',
      placeholder: 'backend',
      initialValue: 'backend',
    })
  );
  {
    const cancelValue = getCancelReturn(subdir);
    if (cancelValue) return cancelValue;
  }

  const entrypoint = handleCancel(
    await text({
      message: 'Entry file:',
      placeholder: 'server.js',
      initialValue: 'server.js',
    })
  );
  {
    const cancelValue = getCancelReturn(entrypoint);
    if (cancelValue) return cancelValue;
  }

  const envSrc = handleCancel(
    await text({
      message: 'Env file path (relative to envs/, leave empty for none):',
      placeholder: '.env.myproject',
    })
  );
  {
    const cancelValue = getCancelReturn(envSrc);
    if (cancelValue) return cancelValue;
  }

  try {
    addProject({
      name: name.trim(),
      repoUrl: repoUrl.trim(),
      branch: (branch && branch.trim()) || 'main',
      envSrc: (envSrc && envSrc.trim()) || '',
      subdir: (subdir && subdir.trim()) || 'backend',
      entrypoint: (entrypoint && entrypoint.trim()) || 'server.js',
    });
    log.success(`Added "${name.trim()}" to the roster. ${dim(pickSuccess())}`);

    const startNow = handleCancel(
      await confirm({ message: 'Clone and start now?', initialValue: true })
    );
    {
      const cancelValue = getCancelReturn(startNow);
      if (cancelValue) return cancelValue;
    }
    if (startNow) {
      const data = loadProjects();
      const proj = data.projects.find((p) => p.name === name.trim());
      if (proj) {
        const s = animatedSpinner();
        s.start('Cloning repository');
        const { ensureRepo, prepareProject } = await import('./lib/git-ops.js');
        await ensureRepo(proj);
        s.stop(`✅ Cloned.`);
        s.start('Installing dependencies');
        await prepareProject(proj);
        s.stop(`✅ Dependencies installed.`);
        processManager.startProject(proj);
        log.success(`${name.trim()} is live! ${dim(pickSuccess())}`);

        if (dashboard) dashboard.updateProjects(data.projects);
      }
    }
  } catch (err) {
    log.error(`${err.message} ${dim(pickError())}`);
  }
}

async function removeFlow() {
  const { projects } = loadProjects();
  if (projects.length === 0) {
    log.info('No projects to remove.');
    return;
  }

  const name = handleCancel(
    await select({
      message: 'Remove which project?',
      options: projects.map((p) => ({
        value: p.name,
        label: p.name,
        hint: processManager.getStatus(p.name),
      })),
    })
  );
  {
    const cancelValue = getCancelReturn(name);
    if (cancelValue) return cancelValue;
  }

  const sure = handleCancel(
    await confirm({ message: pc.red(`Remove "${name}"? This won't delete the repo folder.`), initialValue: false })
  );
  {
    const cancelValue = getCancelReturn(sure);
    if (cancelValue) return cancelValue;
  }
  if (!sure) return;

  if (processManager.getStatus(name) === 'running') {
    await processManager.stopProject(name);
  }

  removeProject(name);
  log.success(`Removed "${name}" from config.`);

  if (dashboard) {
    const data = loadProjects();
    dashboard.updateProjects(data.projects);
  }
}

async function settingsMenu() {
  const settings = getSettings();

  const choice = handleCancel(
    await select({
      message: accent('Settings'),
      options: [
        { value: 'crashes',  label: 'Max Crash Retries',   hint: `${settings.maxCrashRetries} before cooldown` },
        { value: 'cooldown', label: 'Crash Cooldown',       hint: `${settings.crashCooldownMins}m pause` },
        { value: 'poll',     label: 'Git Poll Interval',    hint: `every ${settings.pollInterval}s` },
        { value: 'buffer',   label: 'Log Buffer Size',      hint: `${settings.logBufferSize} lines/project` },
        { value: 'back',     label: 'Back' },
      ],
    })
  );

  if (isMenuExit(choice)) return MENU_EXIT;
  if (isCancelled(choice)) return MENU_CANCEL;
  if (choice === 'back') return;

  switch (choice) {
    case 'crashes': {
      const v = handleCancel(
        await text({
          message: `Max crashes before cooldown (currently ${settings.maxCrashRetries}):`,
          placeholder: String(settings.maxCrashRetries),
          validate(v) {
            if (v && v.trim()) {
              const n = parseInt(v);
              if (isNaN(n) || n < 1) return 'Minimum 1.';
            }
          },
        })
      );
      {
        const cancelValue = getCancelReturn(v);
        if (cancelValue) return cancelValue;
      }
      if (!isCancelled(v) && v && v.trim()) {
        updateSettings({ maxCrashRetries: parseInt(v) });
        log.success(`Max crash retries → ${parseInt(v)}. ${dim(pickSuccess())}`);
      }
      break;
    }
    case 'cooldown': {
      const v = handleCancel(
        await text({
          message: `Cooldown duration in minutes (currently ${settings.crashCooldownMins}):`,
          placeholder: String(settings.crashCooldownMins),
          validate(v) {
            if (v && v.trim()) {
              const n = parseFloat(v);
              if (isNaN(n) || n < 0.5) return 'Minimum 0.5 minutes.';
            }
          },
        })
      );
      {
        const cancelValue = getCancelReturn(v);
        if (cancelValue) return cancelValue;
      }
      if (!isCancelled(v) && v && v.trim()) {
        updateSettings({ crashCooldownMins: parseFloat(v) });
        log.success(`Crash cooldown → ${parseFloat(v)}m. ${dim(pickSuccess())}`);
      }
      break;
    }
    case 'poll': {
      const v = handleCancel(
        await text({
          message: `Poll interval in seconds (currently ${settings.pollInterval}):`,
          placeholder: String(settings.pollInterval),
          validate(v) {
            if (v && v.trim()) {
              const n = parseInt(v);
              if (isNaN(n) || n < 5) return 'Minimum 5 seconds.';
            }
          },
        })
      );
      {
        const cancelValue = getCancelReturn(v);
        if (cancelValue) return cancelValue;
      }
      if (!isCancelled(v) && v && v.trim()) {
        const newInterval = parseInt(v);
        updateSettings({ pollInterval: newInterval });

        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => {
          const freshData = loadProjects();
          checkAllForUpdates(freshData.projects, processManager);
        }, newInterval * 1000);
        log.success(`Poll interval → ${newInterval}s. ${dim(pickSuccess())}`);
      }
      break;
    }
    case 'buffer': {
      const v = handleCancel(
        await text({
          message: `Log buffer size per project (currently ${settings.logBufferSize}):`,
          placeholder: String(settings.logBufferSize),
          validate(v) {
            if (v && v.trim()) {
              const n = parseInt(v);
              if (isNaN(n) || n < 50) return 'Minimum 50 lines.';
            }
          },
        })
      );
      {
        const cancelValue = getCancelReturn(v);
        if (cancelValue) return cancelValue;
      }
      if (!isCancelled(v) && v && v.trim()) {
        const newSize = parseInt(v);
        updateSettings({ logBufferSize: newSize });
        logStore.setBufferSize(newSize);
        log.success(`Log buffer → ${newSize} lines/project. ${dim(pickSuccess())}`);
      }
      break;
    }
  }

  return settingsMenu();
}

async function shutdownAndExit() {
  if (dashboard) dashboard.destroy();
  console.clear();
  console.log(accent(pc.bold(`\n  ${APP_NAME} — shutting down\n`)));
  const s2 = animatedSpinner();
  s2.start('Stopping all processes');
  if (pollTimer) clearInterval(pollTimer);
  await processManager.shutdownAll();
  s2.stop(`✅ All processes stopped.`);
  outro(accent(pickFarewell()));
  process.exit(0);
}

async function main() {
  const data = loadProjects();
  const settings = getSettings();
  logStore.setBufferSize(settings.logBufferSize);

  dashboard = new Dashboard(data.projects);

  function launchDashboard() {
    const freshData = loadProjects();
    dashboard.projects = freshData.projects;
    dashboard.init();

    dashboard.onMenuRequested = async () => {
      if (menuOpening) return;
      menuOpening = true;
      try {
        dashboard.pause();
        beginMenuKeyTracking();
        await showLogo();
        const menuResult = await mainMenu();

        if (menuResult === MENU_EXIT) {
          await shutdownAndExit();
          return;
        }

        console.clear();
        launchDashboard();
      } finally {
        endMenuKeyTracking();
        menuOpening = false;
      }
    };

    dashboard.onQuitRequested = async () => {
      await shutdownAndExit();
    };
  }

  launchDashboard();

  await processManager.initializeAll(data.projects);

  pollTimer = setInterval(() => {
    const freshData = loadProjects();
    checkAllForUpdates(freshData.projects, processManager);
  }, settings.pollInterval * 1000);
}

let sigintCount = 0;
process.on('SIGINT', async () => {
  sigintCount++;
  if (sigintCount >= 2) {
    process.exit(1);
  }
  if (dashboard) dashboard.destroy();
  console.log(accent(`\n  Shutting down... ${dim('(press Ctrl+C again to force)')}`));
  if (pollTimer) clearInterval(pollTimer);
  await processManager.shutdownAll();
  console.log(accent(`  ${pickFarewell()}`));
  process.exit(0);
});

process.on('uncaughtException', async (err) => {
  if (dashboard) dashboard.destroy();
  console.error(pc.red(`\n  Fatal error: ${err.message} ${dim(pickCrash())}`));
  console.error(err.stack);
  await processManager.shutdownAll();
  process.exit(1);
});

main();
