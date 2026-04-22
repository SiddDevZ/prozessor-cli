import blessed from 'blessed';
import logStore from './log-store.js';
import processManager from './process-manager.js';
import { pickTip } from './flair.js';
import { uiPalette, symbols } from './theme.js';

const PROJECT_COLORS = ['cyan', 'green', 'magenta', 'yellow', 'blue', 'red', 'white'];
const RUNNING_FRAMES = ['●', '◉', '◎', '◉'];
const COOLDOWN_FRAMES = ['◜', '◝', '◞', '◟'];

function getProjectColor(name, projects) {
  const idx = projects.findIndex((p) => p.name === name);
  return idx >= 0 ? PROJECT_COLORS[idx % PROJECT_COLORS.length] : 'white';
}

function formatUptime(ms) {
  if (!ms) return '--';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function escapeAndCrop(text, max) {
  const clean = stripAnsi(text).replace(/\r/g, '').replace(/\t/g, '  ');
  const cropped = clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1))}…`;
  return blessed.escape(cropped);
}

export default class Dashboard {
  constructor(projects) {
    this.projects = projects || [];
    this.screen = null;
    this.logBox = null;
    this.statusBar = null;
    this.commandBar = null;
    this.filter = null;
    this.paused = false;
    this.destroyed = false;
    this.followTail = true;
    this.onMenuRequested = null;
    this.onQuitRequested = null;
    this.refreshTimer = null;
    this.tipTimer = null;
    this.scrollTimer = null;
    this.scrollVelocity = 0;
    this.scrollLastTs = 0;
    this.animFrame = 0;
    this._logListener = null;
    this._statusListener = null;
    this._currentTip = pickTip();
    this._pendingLogsRefresh = true;
    this._lastStatusContent = '';
    this._lastCommandContent = '';
    this._lastLogSignature = '';
  }

  init() {
    this.destroy();

    this.paused = false;
    this.destroyed = false;

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'PROZESSOR',
      fullUnicode: true,
      autoPadding: false,
      dockBorders: true,
    });

    this.screen.enableMouse();

    this.logBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-5',
      tags: true,
      scrollable: true,
      alwaysScroll: false,
      scrollbar: {
        ch: ' ',
        track: { bg: uiPalette.bg },
        style: { bg: uiPalette.borderFg },
      },
      mouse: true,
      keys: false,
      vi: false,
      style: {
        fg: uiPalette.baseFg,
        bg: uiPalette.bg,
      },
      border: {
        type: 'line',
        fg: uiPalette.borderFg,
      },
      label: '',
      padding: { left: 1, right: 1 },
    });
    this.screen.append(this.logBox);

    this.statusBar = blessed.box({
      bottom: 2,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      style: {
        fg: uiPalette.baseFg,
        bg: uiPalette.panelBg,
      },
      border: {
        type: 'line',
        fg: uiPalette.borderFg,
      },
      label: ' {bold}fleet status{/bold} ',
      padding: { left: 1, right: 1 },
    });
    this.screen.append(this.statusBar);

    this.commandBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      padding: { left: 1, right: 1 },
      style: {
        fg: uiPalette.mutedFg,
        bg: uiPalette.bg,
      },
    });
    this.screen.append(this.commandBar);

    this._bindKeys();

    this._logListener = () => {
      this._pendingLogsRefresh = true;
    };
    logStore.on('line', this._logListener);

    this._statusListener = () => {
      if (!this.paused) {
        this._renderStatus();
        this._safeRender();
      }
    };
    processManager.on('status-change', this._statusListener);

    this.logBox.on('scroll', () => {
      this._syncFollowState();
      this._renderCommandBar();
      this._safeRender();
    });

    this.logBox.on('wheeldown', () => this._pushScroll(2.4));
    this.logBox.on('wheelup', () => this._pushScroll(-2.4));

    this.screen.on('wheeldown', () => this._pushScroll(2.4));
    this.screen.on('wheelup', () => this._pushScroll(-2.4));

    this.screen.on('resize', () => {
      this._pendingLogsRefresh = true;
      this._tick();
    });

    this.refreshTimer = setInterval(() => this._tick(), 120);

    this.tipTimer = setInterval(() => {
      if (!this.paused) {
        this._currentTip = pickTip();
        this._renderCommandBar();
        this._safeRender();
      }
    }, 15000);

    this._pendingLogsRefresh = true;
    this._tick();
  }

  _bindKeys() {
    const bindKey = (keys, handler) => {
      this.screen.key(keys, handler);
    };

    bindKey(['m'], () => {
      if (this.onMenuRequested) this.onMenuRequested();
    });

    bindKey(['f'], () => {
      this._cycleFilter();
    });

    bindKey(['0'], () => {
      this.filter = null;
      this.followTail = true;
      this._pendingLogsRefresh = true;
      this._tick();
    });

    for (let i = 1; i <= 9; i++) {
      bindKey([String(i)], () => {
        if (i <= this.projects.length) {
          this.filter = this.projects[i - 1].name;
          this.followTail = true;
          this._pendingLogsRefresh = true;
          this._tick();
        }
      });
    }

    bindKey(['up'], () => this._scrollBy(-1));
    bindKey(['down'], () => this._scrollBy(1));
    bindKey(['pageup'], () => this._scrollBy(-Math.max(8, this._logViewportHeight() - 3)));
    bindKey(['pagedown'], () => this._scrollBy(Math.max(8, this._logViewportHeight() - 3)));

    bindKey(['home'], () => {
      if (!this.logBox) return;
      this.followTail = false;
      this.logBox.setScroll(0);
      this._renderCommandBar();
      this._safeRender();
    });

    bindKey(['end'], () => {
      if (!this.logBox) return;
      this.followTail = true;
      this.logBox.setScrollPerc(100);
      this._renderCommandBar();
      this._safeRender();
    });

    bindKey(['q', 'C-c'], () => {
      if (this.onQuitRequested) this.onQuitRequested();
    });
  }

  _logViewportHeight() {
    const h = Number(this.logBox?.height);
    if (Number.isFinite(h)) return Math.max(6, h - 2);
    return 16;
  }

  _tick() {
    if (this.paused || this.destroyed || !this.screen) return;

    this.animFrame = (this.animFrame + 1) % 1000;
    this._renderStatus();
    this._renderCommandBar();

    if (this._pendingLogsRefresh) {
      this._refreshLogs();
      this._pendingLogsRefresh = false;
    }

    this._safeRender();
  }

  _safeRender() {
    if (!this.screen || this.paused || this.destroyed) return;
    try {
      this.screen.render();
    } catch {
      // Avoid terminal crashes caused by transient resize/race conditions.
    }
  }

  _pushScroll(impulse) {
    if (!this.logBox || this.paused || this.destroyed) return;
    if (impulse < 0) this.followTail = false;

    this.scrollVelocity += impulse;
    const cap = 24;
    if (this.scrollVelocity > cap) this.scrollVelocity = cap;
    if (this.scrollVelocity < -cap) this.scrollVelocity = -cap;

    if (!this.scrollTimer) {
      this.scrollLastTs = Date.now();
      this.scrollTimer = setInterval(() => this._drainScroll(), 16);
    }
  }

  _drainScroll() {
    if (!this.logBox || this.paused || this.destroyed) {
      this._stopScrollTimer();
      return;
    }

    const now = Date.now();
    const dt = Math.max(1, now - this.scrollLastTs);
    this.scrollLastTs = now;

    const step = this.scrollVelocity * (dt / 16);
    const intStep = step > 0 ? Math.floor(step) : Math.ceil(step);

    if (intStep !== 0) {
      try {
        this.logBox.scroll(intStep);
      } catch {
        this._stopScrollTimer();
        return;
      }
      this._syncFollowState();
      this._renderCommandBar();
      this._safeRender();
    }

    // Friction tuned for screen/tmux and Ubuntu terminal repeat rates.
    this.scrollVelocity *= 0.82;
    if (Math.abs(this.scrollVelocity) < 0.08) {
      this.scrollVelocity = 0;
      this._stopScrollTimer();
    }
  }

  _stopScrollTimer() {
    if (this.scrollTimer) {
      clearInterval(this.scrollTimer);
      this.scrollTimer = null;
    }
  }

  _statusIcon(status) {
    const runFrame = RUNNING_FRAMES[this.animFrame % RUNNING_FRAMES.length];
    const coolFrame = COOLDOWN_FRAMES[this.animFrame % COOLDOWN_FRAMES.length];

    switch (status) {
      case 'running':
        return `{${uiPalette.successFg}-fg}${runFrame}{/${uiPalette.successFg}-fg}`;
      case 'stopped':
        return `{${uiPalette.errorFg}-fg}●{/${uiPalette.errorFg}-fg}`;
      case 'crashed':
        return `{${uiPalette.errorFg}-fg}✕{/${uiPalette.errorFg}-fg}`;
      case 'cooldown':
        return `{${uiPalette.warningFg}-fg}${coolFrame}{/${uiPalette.warningFg}-fg}`;
      case 'restarting':
        return `{${uiPalette.warningFg}-fg}↻{/${uiPalette.warningFg}-fg}`;
      default:
        return `{${uiPalette.mutedFg}-fg}○{/${uiPalette.mutedFg}-fg}`;
    }
  }

  _renderStatus() {
    if (!this.statusBar) return;

    const parts = this.projects.map((proj, i) => {
      const status = processManager.getStatus(proj.name);
      const icon = this._statusIcon(status);
      const uptime = formatUptime(processManager.getUptime(proj.name));
      const port = processManager.getPort(proj.name);
      const portLabel = port ? ` {${uiPalette.mutedFg}-fg}(${port}){/${uiPalette.mutedFg}-fg}` : '';
      const num = `{${uiPalette.mutedFg}-fg}${i + 1}{/${uiPalette.mutedFg}-fg}`;
      const nameColor = getProjectColor(proj.name, this.projects);
      return `${num} ${icon} {${nameColor}-fg}{bold}${blessed.escape(proj.name)}{/bold}{/${nameColor}-fg}${portLabel} {${uiPalette.mutedFg}-fg}${uptime}{/${uiPalette.mutedFg}-fg}`;
    });

    const content = parts.length
      ? ` ${parts.join(`  {${uiPalette.borderFg}-fg}${symbols.vLine}{/${uiPalette.borderFg}-fg}  `)}`
      : ` {${uiPalette.mutedFg}-fg}No projects configured yet. Open menu with [m] to add one.{/${uiPalette.mutedFg}-fg}`;

    if (content !== this._lastStatusContent) {
      this.statusBar.setContent(content);
      this._lastStatusContent = content;
    }
  }

  _renderCommandBar() {
    if (!this.commandBar) return;

    const left =
      `{bold}{${uiPalette.accentFg}-fg}[m]{/${uiPalette.accentFg}-fg}{/bold} menu  ` +
      `{bold}{${uiPalette.accentFg}-fg}[f]{/${uiPalette.accentFg}-fg}{/bold} filter  ` +
      `{bold}{${uiPalette.accentFg}-fg}[↑↓]{/${uiPalette.accentFg}-fg}{/bold} smooth scroll  ` +
      `{bold}{${uiPalette.accentFg}-fg}[q]{/${uiPalette.accentFg}-fg}{/bold} quit`;

    const content = ` ${left}`;

    if (content !== this._lastCommandContent) {
      this.commandBar.setContent(content);
      this._lastCommandContent = content;
    }
  }

  _refreshLogs() {
    if (!this.logBox) return;

    const entries = this.filter
      ? logStore.getLines(this.filter, 600)
      : logStore.getAllInterleaved(1000);

    const width = Math.max(30, (this.screen?.width || 80) - 14);
    const last = entries[entries.length - 1];
    const signature = `${this.filter || '*'}:${entries.length}:${last?.ts || 0}:${width}`;

    if (signature === this._lastLogSignature) return;
    this._lastLogSignature = signature;

    const previousPerc = this.logBox.getScrollPerc();

    const lines = [];
    const maxLines = 900;
    for (const entry of entries) {
      const color = getProjectColor(entry.project, this.projects);
      const prefix = `{${color}-fg}{bold}[${blessed.escape(entry.project)}]{/bold}{/${color}-fg}`;
      const streamColor = entry.stream === 'stderr' ? uiPalette.errorFg : uiPalette.baseFg;
      const message = escapeAndCrop(entry.text, width);
      lines.push(`${prefix} {${streamColor}-fg}${message}{/${streamColor}-fg}`);
      if (lines.length >= maxLines) break;
    }

    this.logBox.setContent(lines.join('\n'));

    if (this.followTail || previousPerc >= 99) {
      this.logBox.setScrollPerc(100);
      this.followTail = true;
    } else if (Number.isFinite(previousPerc)) {
      this.logBox.setScrollPerc(previousPerc);
    }

    this._updateLogLabel();
    this._syncFollowState();
  }

  _updateLogLabel() {
    if (!this.logBox) return;
    this.logBox.setLabel('');
  }

  _syncFollowState() {
    if (!this.logBox) return;
    const percent = this.logBox.getScrollPerc();
    if (Number.isFinite(percent)) {
      this.followTail = percent >= 99;
    }
  }

  _scrollBy(delta) {
    this._pushScroll(delta * 1.1);
  }

  _cycleFilter() {
    if (!this.projects.length) {
      this.filter = null;
    } else if (this.filter === null) {
      this.filter = this.projects[0].name;
    } else {
      const idx = this.projects.findIndex((p) => p.name === this.filter);
      if (idx === -1 || idx >= this.projects.length - 1) {
        this.filter = null;
      } else {
        this.filter = this.projects[idx + 1].name;
      }
    }

    this.followTail = true;
    this._pendingLogsRefresh = true;
    this._tick();
  }

  _teardownRuntime() {
    if (this._logListener) {
      logStore.removeListener('line', this._logListener);
      this._logListener = null;
    }
    if (this._statusListener) {
      processManager.removeListener('status-change', this._statusListener);
      this._statusListener = null;
    }
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.tipTimer) {
      clearInterval(this.tipTimer);
      this.tipTimer = null;
    }
    this._stopScrollTimer();
    this.scrollVelocity = 0;
  }

  _destroyScreen() {
    if (!this.screen) return;
    try {
      this.screen.destroy();
    } catch {
      // Ignore teardown errors to avoid exit crashes.
    }
    this.screen = null;
    this.logBox = null;
    this.statusBar = null;
    this.commandBar = null;
  }

  pause() {
    this.paused = true;
    this._teardownRuntime();
    this._destroyScreen();
  }

  resume() {
    this.init();
  }

  destroy() {
    this.paused = true;
    this.destroyed = true;
    this._teardownRuntime();
    this._destroyScreen();
  }

  updateProjects(projects) {
    this.projects = projects || [];
    if (this.filter && !this.projects.find((p) => p.name === this.filter)) {
      this.filter = null;
    }
    this._pendingLogsRefresh = true;
    this._lastStatusContent = '';
    this._lastCommandContent = '';

    if (!this.paused) {
      this._tick();
    }
  }
}
