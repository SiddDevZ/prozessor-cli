const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const kaomoji = {
  success: [
    '(ﾉ◕ヮ◕)ﾉ*:・ﾟ✧',
    'ᕕ( ᐛ )ᕗ',
    '(☞ﾟヮﾟ)☞',
    '╰(*°▽°*)╯',
    '(ง •̀_•́)ง',
    '(づ ◕‿◕ )づ',
    '(⌐■_■)',
    '( •̀ᴗ•́ )و',
    '\\(ᵔᵕᵔ)/',
    '(ﾟ▽ﾟ)/',
  ],
  error: [
    '¯\\_(ツ)_/¯',
    '(╥_╥)',
    '(ノಠ益ಠ)ノ彡┻━┻',
    '(ᗒᗣᗕ)՞',
    'щ(ᗒᗩᗕ)щ',
    '(╯°□°)╯',
    '(ᵕ̣̣̣̣̣̣ ᴖ ᵕ̣̣̣̣̣̣)',
    '(⊙_⊙)',
  ],
  thinking: [
    '(ᴗ_ ᴗ。)',
    '( ˘▽˘)っ',
    '(⊙.⊙)',
    '( ̯ )',
    '┬┴┬┴┤(·_├┬┴┬┴',
    '(°ロ°)',
  ],
  farewell: [
    '(ﾉ´ヮ`)ﾉ*:・ﾟ bye!',
    '(ᵔᴥᵔ) see ya!',
    'ʕ•ᴥ•ʔ cya!',
    '(◕‿◕) until next time!',
    '(ﾟ▽ﾟ)/ later!',
    '( ˘ ³˘)♥ peace out!',
    '\\(^-^)/ sayonara!',
    '(⌐■_■) stay classy.',
  ],
  idle: [
    '(ᵔᴥᵔ)',
    '(◕‿◕)',
    '( ˘▽˘)',
    '(ﾟヮﾟ)',
    '(◠‿◠)',
    'ʕ •ₒ• ʔ',
  ],
  crash: [
    '(╯°□°)╯ oh no',
    '¯\\_(ツ)_/¯ welp',
    '(ᗒᗣᗕ)՞ oof',
    '(╥_╥) rip',
    '(ノಠ益ಠ)ノ yikes',
    'щ(ᗒᗩᗕ)щ bruh',
  ],
};

export const tips = [
  'Press [f] to cycle through project log filters',
  'Press [1-9] to jump to a specific project\'s logs',
  'Press [0] to show all project logs',
  'Double Ctrl+C to force quit if shutdown hangs',
  'Git polling auto-detects new commits and restarts',
  'Crash cooldown prevents restart loops automatically',
  'Add .env files to the envs/ folder',
  'Projects keep running while you browse the menu',
  'Use arrow keys to scroll through log history',
];

export function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12)  return 'Good morning! ☀️';
  if (hour >= 12 && hour < 17) return 'Good afternoon! 🌤';
  if (hour >= 17 && hour < 21) return 'Good evening! 🌙';
  return 'Burning the midnight oil? 🌚';
}

export function pickSuccess()  { return pick(kaomoji.success); }
export function pickError()    { return pick(kaomoji.error); }
export function pickThinking() { return pick(kaomoji.thinking); }
export function pickFarewell() { return pick(kaomoji.farewell); }
export function pickIdle()     { return pick(kaomoji.idle); }
export function pickCrash()    { return pick(kaomoji.crash); }
export function pickTip()      { return pick(tips); }

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const RUNNING_FRAMES = [
  '{green-fg}●{/green-fg}',
  '{green-fg}◉{/green-fg}',
  '{green-fg}◎{/green-fg}',
  '{green-fg}◉{/green-fg}',
];

export const COOLDOWN_FRAMES = [
  '{yellow-fg}◜{/yellow-fg}',
  '{yellow-fg}◝{/yellow-fg}',
  '{yellow-fg}◞{/yellow-fg}',
  '{yellow-fg}◟{/yellow-fg}',
];
