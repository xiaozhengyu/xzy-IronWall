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
/** resume() 已经发出去、还没落地的那一小段。为什么需要它，见 unlock 和 sfxAudible。 */
let resuming = false;

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
 * 这一刻能不能出声。
 *
 * running 当然可以。**suspended 但 resume 还在路上，也可以** —— 这一条就是"第一次点击没
 * 声音，第二次才有"的全部原因：
 *
 *   resume() 是异步的。它返回的那一瞬间 state 仍然是 suspended（这一点实测过，不是推测），
 *   而按钮的声音就在同一个事件里播。于是第一次手势永远撞在 state !== 'running' 上被丢掉，
 *   等到第二次按，resume 早就落地了，声音才出来。
 *
 * 放行是安全的：suspended 的 context 上照样能 start 一个 source —— currentTime 是冻住的，
 * when=0 的意思是"尽快"，等 resume 落地它就响，延迟就是 resume 本身那几毫秒，听不出来。
 *
 * resuming 只在真实手势的处理器里置位，不在这里顺手 resume()：**没有用户手势的 resume()
 * 会永远挂着**（既不 resolve 也不 reject）。那样 resuming 就再也回不去，往后每一声都排在
 * 一个永不启动的 context 上，24 个声部占满之后就是永久静音 —— 比现在这个 bug 糟得多。
 */
export function sfxAudible(): boolean {
  const ctx = ensureContext();
  if (!ctx) return false;
  return ctx.state === 'running' || resuming;
}

/**
 * 在第一次用户手势里解锁。
 *
 * 挂一次性的 pointerdown / keydown，**capture 阶段**：界面上有好几层会 stopPropagation
 * 的弹出物（卡牌那块幕布最典型），冒泡阶段可能永远等不到这一下。
 *
 * 备战界面那个"开始游戏"本身就是一次 pointerdown，所以正常玩下来，进图之前一定已经解锁了。
 *
 * **这个监听器必须比 uiClick 的先挂上**（见 main.ts 的引导顺序）。同一个目标同一个阶段的
 * 监听器按注册顺序走，挂晚了的话，第一次点击时按钮的 play 会跑在 resume 发出之前，
 * resuming 还是 false，那一声照样丢 —— 又回到上面说的那个 bug。
 */
export function unlock(): void {
  if (unlocked) return;
  const settle = (): void => {
    resuming = false;
    unlocked = true;
    removeEventListener('pointerdown', tap, true);
    removeEventListener('keydown', tap, true);
  };
  const tap = (): void => {
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === 'running') { settle(); return; }
    // 置位要在 resume() 之前：同一个手势里后面那个按钮的 play 马上就要来读它。
    resuming = true;
    // 失败了也无所谓 —— 监听器还挂着，下一次手势再试一遍，直到 running。
    void ctx.resume().then(settle, () => { resuming = false; });
  };
  addEventListener('pointerdown', tap, true);
  addEventListener('keydown', tap, true);
}

/** 音效开关。存档里那一条设置直接喂给它。 */
export function setSfxEnabled(on: boolean): void {
  sfxEnabled = on;
  if (sfxBus) sfxBus.gain.value = on ? SFX_GAIN : 0;
}

