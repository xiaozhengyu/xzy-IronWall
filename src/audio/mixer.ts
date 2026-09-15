/**
 * 音频总线。整个游戏只有这一个 AudioContext。
 *
 * 分总线而不是每个声音各自设音量：设置里那个"音效"开关要一次关掉所有音效，而以后加了音乐
 * 之后，两者得能分开关。把音量挂在一条 GainNode 上，开关就是改一个数，不用去追每个正在响
 * 的声部。
 *
 * **AudioContext 出生就是 suspended 的。** 浏览器的自动播放策略要求它必须在一次真实的用户
 * 手势里被 resume —— 不解锁的话，所有 play 都静悄悄地什么都不发生，而且一个错都不报。
 * 见下面 unlock()。
 */

/** 音效总音量。开关关掉时不是设 0，是走 SFX_MUTED —— 见 setSfxEnabled。 */
const SFX_GAIN = 0.85;

let context: AudioContext | null = null;
let masterBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let sfxEnabled = true;
let unlocked = false;

/**
 * 拿到 AudioContext，没有就建一个。
 *
 * 懒建而不是模块加载时就建：模块加载发生在页面刚打开的时候，那时一定还没有用户手势，
 * 建出来的 context 必然是 suspended，某些浏览器还会往控制台扔一条警告。
 *
 * 建不出来就返回 null（很老的浏览器、或者被策略完全禁掉）。这一层的所有失败都是**静默降级**：
 * 没声音不该让人进不去游戏。
 */
function ensureContext(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  masterBus = context.createGain();
  masterBus.connect(context.destination);
  sfxBus = context.createGain();
  sfxBus.gain.value = sfxEnabled ? SFX_GAIN : 0;
  sfxBus.connect(masterBus);
  return context;
}

export const audioContext = (): AudioContext | null => ensureContext();

/** 音效接到这条总线上。没有 context 就是 null，调用方直接不播。 */
export const sfxDestination = (): GainNode | null => (ensureContext() ? sfxBus : null);

/**
 * 在第一次用户手势里解锁。
 *
 * 挂一次性的 pointerdown / keydown，**capture 阶段**：界面上有好几层会 stopPropagation
 * 的弹出物（卡牌那块幕布最典型），冒泡阶段可能永远等不到这一下。
 *
 * 备战界面那个"开始游戏"本身就是一次 pointerdown，所以正常玩下来，进图之前一定已经解锁了。
 */
export function unlock(): void {
  if (unlocked) return;
  const tap = (): void => {
    const ctx = ensureContext();
    if (!ctx) return;
    // resume 返回 Promise，失败了也无所谓 —— 下一次手势还会再试一遍，直到 running。
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    if (ctx.state === 'running') {
      unlocked = true;
      removeEventListener('pointerdown', tap, true);
      removeEventListener('keydown', tap, true);
    }
  };
  addEventListener('pointerdown', tap, true);
  addEventListener('keydown', tap, true);
}

/** 音效开关。存档里那一条设置直接喂给它。 */
export function setSfxEnabled(on: boolean): void {
  sfxEnabled = on;
  if (sfxBus) sfxBus.gain.value = on ? SFX_GAIN : 0;
}

