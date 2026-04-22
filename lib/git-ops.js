import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { getProjectsDir, getRootDir } from './config.js';
import logStore from './log-store.js';

const exec = promisify(execCb);

function log(name, msg) {
  logStore.push(name, msg, 'stdout');
}

function logErr(name, msg) {
  logStore.push(name, msg, 'stderr');
}

export async function ensureRepo(proj) {
  const { name, repoUrl, branch } = proj;
  const liveDir = path.join(getProjectsDir(), name);
  if (!fs.existsSync(liveDir)) {
    log(name, `📦 Cloning repository...`);
    try {
      await exec(`git clone --quiet --branch ${branch} ${repoUrl} "${liveDir}"`);
      log(name, `✅ Repository cloned.`);
    } catch (err) {
      logErr(name, `❌ Clone failed: ${err.message}`);
      throw err;
    }
  } else {
    // Verify we're on the correct branch
    try {
      const { stdout: currentBranch } = await exec('git rev-parse --abbrev-ref HEAD', { cwd: liveDir });
      if (currentBranch.trim() !== branch) {
        log(name, `🔀 Switching branch: ${currentBranch.trim()} → ${branch}`);
        await exec(`git fetch origin ${branch} --quiet`, { cwd: liveDir });
        await exec(`git checkout ${branch} --quiet`, { cwd: liveDir });
        await exec(`git pull origin ${branch} --quiet`, { cwd: liveDir });
        log(name, `✅ Switched to branch ${branch}.`);
      }
    } catch (err) {
      logErr(name, `⚠ Branch switch failed: ${err.message}`);
    }
  }
}

export async function prepareProject(proj) {
  const { name, envSrc } = proj;
  const subdir = proj.subdir || 'backend';
  const workDir = path.join(getProjectsDir(), name, subdir);
  const root = getRootDir();

  if (envSrc) {
    const envPath = path.resolve(root, 'envs', envSrc);
    if (fs.existsSync(envPath)) {
      fs.copySync(envPath, path.join(workDir, '.env'));
      log(name, `✅ Environment file copied.`);
    } else {
      logErr(name, `⚠ Env file not found: ${envSrc}`);
    }
  }

  log(name, `📦 Installing dependencies...`);
  try {
    await exec('npm install --production --silent', { cwd: workDir });
    log(name, `✅ Dependencies installed.`);
  } catch (err) {
    logErr(name, `❌ npm install failed: ${err.stderr?.trim() || err.message}`);
  }
}

export async function pullLatest(proj, processManager) {
  const { name, branch } = proj;
  const liveDir = path.join(getProjectsDir(), name);

  if (!fs.existsSync(liveDir)) return false;

  const st = processManager.getState(name);

  if (st && st.restarting) {
    if (st._restartingSince && Date.now() - st._restartingSince > 5 * 60 * 1000) {
      st.restarting = false; // unstick
    } else {
      return false;
    }
  }

  try {
    await exec(`git fetch origin ${branch} --quiet`, { cwd: liveDir });

    const { stdout: localOut } = await exec('git rev-parse HEAD', { cwd: liveDir });
    const { stdout: remoteOut } = await exec(`git rev-parse origin/${branch}`, { cwd: liveDir });
    const local = localOut.trim();
    const remote = remoteOut.trim();

    if (local !== remote) {
      log(name, `📥 New commit detected. Updating...`);
      if (st) {
        st.restarting = true;
        st._restartingSince = Date.now();
      }

      await exec('git add .', { cwd: liveDir });
      await exec('git stash push --include-untracked --quiet', { cwd: liveDir });

      await exec(`git merge origin/${branch} --quiet`, { cwd: liveDir });

      try {
        await exec('git stash pop --quiet', { cwd: liveDir });
      } catch {
        logErr(name, `⚠ Merge conflicts — local changes preserved in stash.`);
      }

      log(name, `🛠 Reinstalling and restarting...`);
      await prepareProject(proj);

      await processManager.restartProject(proj);
      if (st) {
        st.restarting = false;
        st._restartingSince = null;
      }
      return true;
    }
  } catch (err) {
    logErr(name, `⚠ Update check failed: ${err.message}`);
    if (st) {
      st.restarting = false;
      st._restartingSince = null;
    }
  }

  return false;
}

export async function checkAllForUpdates(projects, processManager) {
  for (const proj of projects) {
    if (proj.enabled !== false) {
      await pullLatest(proj, processManager);
    }
  }
}
