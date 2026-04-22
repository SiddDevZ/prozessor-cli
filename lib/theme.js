import pc from 'picocolors';

const noColor = Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR');
const colorDepth = typeof process.stdout?.getColorDepth === 'function' ? process.stdout.getColorDepth() : 1;
const term = (process.env.TERM || '').toLowerCase();
const colorTerm = (process.env.COLORTERM || '').toLowerCase();
const forceColor = process.env.FORCE_COLOR;
const forced = !noColor && forceColor !== undefined && forceColor !== '0';
const termSupportsColor = /color|ansi|xterm|screen|tmux|rxvt|linux|vt100/i.test(term);

const trueColor = !noColor && (colorDepth >= 24 || colorTerm.includes('truecolor') || colorTerm.includes('24bit'));
const basicColor = !noColor && (trueColor || forced || colorDepth >= 4 || termSupportsColor);

const identity = (value) => value;

function wrapAnsi(open, close) {
  return (value) => `${open}${value}${close}`;
}

const accent = trueColor
  ? wrapAnsi('\u001b[38;2;192;132;252m', '\u001b[39m')
  : basicColor
    ? pc.magenta
    : identity;

const accentBg = trueColor
  ? wrapAnsi('\u001b[48;2;168;85;247m\u001b[97m', '\u001b[39m\u001b[49m')
  : basicColor
    ? (value) => pc.bgMagenta(pc.white(value))
    : identity;

const success = trueColor
  ? wrapAnsi('\u001b[38;2;80;250;123m', '\u001b[39m')
  : basicColor
    ? pc.green
    : identity;

const warning = trueColor
  ? wrapAnsi('\u001b[38;2;255;183;77m', '\u001b[39m')
  : basicColor
    ? pc.yellow
    : identity;

const error = trueColor
  ? wrapAnsi('\u001b[38;2;255;85;85m', '\u001b[39m')
  : basicColor
    ? pc.red
    : identity;

const border = trueColor
  ? wrapAnsi('\u001b[38;2;176;176;176m', '\u001b[39m')
  : basicColor
    ? pc.gray
    : identity;

const muted = trueColor
  ? wrapAnsi('\u001b[38;2;206;206;206m', '\u001b[39m')
  : basicColor
    ? pc.dim
    : identity;

export const terminalTheme = {
  colorDepth,
  colorLevel: trueColor ? 'truecolor' : basicColor ? 'basic' : 'none',
  accent,
  accentBg,
  success,
  warning,
  error,
  border,
  muted,
  bold: (value) => pc.bold(value),
  dim: (value) => pc.dim(value),
  accentBold: (value) => accent(pc.bold(value)),
};

const lowColorTerminal = noColor || colorDepth < 8;

export const uiPalette = lowColorTerminal
  ? {
      baseFg: 'white',
      mutedFg: 'white',
      accentFg: 'white',
      accentStrongFg: 'white',
      successFg: 'white',
      warningFg: 'white',
      errorFg: 'white',
      infoFg: 'white',
      borderFg: 'white',
      bg: 'black',
      panelBg: 'black',
    }
  : {
      baseFg: 'white',
      mutedFg: 'gray',
      accentFg: 'magenta',
      accentStrongFg: 'bright-magenta',
      successFg: 'green',
      warningFg: 'yellow',
      errorFg: 'red',
      infoFg: 'cyan',
      borderFg: 'gray',
      bg: 'black',
      panelBg: 'black',
    };

export const symbols = {
  cornerTL: '╭',
  cornerTR: '╮',
  cornerBL: '╰',
  cornerBR: '╯',
  hLine: '─',
  hBold: '━',
  vLine: '│',
  dot: '•',
  arrow: '›',
};

export function supportsUnicode() {
  return process.platform !== 'win32' || process.env.TERM_PROGRAM === 'vscode';
}
