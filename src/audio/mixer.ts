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

/**
 * 音乐总音量。**比音效低一大截，这是故意的。**
 *
 * 音乐是一直在响的底子，音效是偶尔冒出来的信息。两者一样响的话，砍中那一下就得跟鼓点抢
 * 位置 —— 而玩家需要听清的恰恰是砍中那一下。两条素材已经用 loudnorm 对齐到同一个响度
 * （见 assets/music/README 那一段），所以这里一个数管两首。
 */
const MUSIC_GAIN = 0.38;

/**
 * 弹出框盖上来时音乐压到几成。
 *
 * 不是静音，是让开：三选一、暂停、结算这些时候玩家在读字、在做选择，音乐继续顶在前面
 * 会让人烦躁；但完全掐掉又会让那几秒显得死寂，反而像是游戏卡住了。
 */
const MUSIC_DUCK = 0.3;

/** 音量变化的过渡时间，秒。切档从来不是瞬间的 —— 直接改数会"咔"一声。 */
const RAMP = 0.25;

let context: AudioContext | null = null;
let masterBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxEnabled = true;
let musicEnabled = true;
let ducked = false;
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
  musicBus = context.createGain();
  musicBus.gain.value = musicTarget();
  musicBus.connect(masterBus);
  return context;
}

export const audioContext = (): AudioContext | null => ensureContext();

/** 音效接到这条总线上。没有 context 就是 null，调用方直接不播。 */
export const sfxDestination = (): GainNode | null => (ensureContext() ? sfxBus : null);

/** 音乐接到这条总线上。开关和闪避都只改这一条的音量，不碰正在播的声部。 */
export const musicDestination = (): GainNode | null => (ensureContext() ? musicBus : null);

/** 音乐这一刻该是多响：关了就是 0，盖着弹出框就让开一档，否则满档。 */
function musicTarget(): number {
  if (!musicEnabled) return 0;
  return ducked ? MUSIC_GAIN * MUSIC_DUCK : MUSIC_GAIN;
}

/**
 * 把音乐总线推到当前该在的音量。
 *
 * 用 ramp 不直接赋值：音量瞬间跳变在耳朵里就是一声"咔"，而这条路一局里要走很多次
 * （每弹一次牌、每暂停一次）。cancelScheduledValues + setValueAtTime(当前值) 是为了从
 * **正在进行的那条斜坡的中点**接着走 —— 不先把当前值钉下来，新斜坡会从上一条的终点起算，
 * 快速开关几次就会听见音量跳来跳去。
 */
function applyMusicGain(): void {
  if (!musicBus || !context) return;
  const now = context.currentTime;
  musicBus.gain.cancelScheduledValues(now);
  musicBus.gain.setValueAtTime(musicBus.gain.value, now);
  musicBus.gain.linearRampToValueAtTime(musicTarget(), now + RAMP);
}

/** 音乐开关。存档里那一条设置直接喂给它。 */
export function setMusicEnabled(on: boolean): void {
  musicEnabled = on;
  applyMusicGain();
}

/**
 * 弹出框盖上来 / 让开。
 *
 * 幂等：同一个值反复喂进来什么都不做。调用方（main）每帧都算一次"现在有没有东西盖着"，
 * 不用自己记上一次是什么。
 */
export function setMusicDucked(on: boolean): void {
  if (ducked === on) return;
  ducked = on;
  applyMusicGain();
}

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

  /*
   * 挂完监听器之后，**不等手势先自己试一次**。
   *
   * 自动播放策略不是"一律禁止"：Chrome/Edge 还看这个站点的 Media Engagement Index ——
   * 常来、而且以前在这儿放出过声音的站点，允许直接起播。所以这一次尝试对老玩家是有用的：
   * 一进来音乐就响，而不是干等到他点第一下。新玩家那边它会被拒（或者干脆挂着），
   * 照旧走上面那条手势的路，什么都没变坏。
   *
   * **这里绝不置 resuming。** 没有用户手势的 resume() 可能永远挂着 —— 既不 resolve 也不
   * reject，这是实测过的。置了的话那个标志就再也回不去，往后每一声音效都会排在一个永不
   * 启动的 context 上，24 个声部占满之后就是永久静音，比"进来晚响一会儿"糟得多。
   * 成了就走 settle（和手势那条路同一个收尾），没成什么也不做。
   */
  const ctx = ensureContext();
  if (ctx && ctx.state !== 'running') {
    void ctx.resume().then(() => {
      if (ctx.state === 'running') settle();
    }, () => undefined);
  }
}

/** 音效开关。存档里那一条设置直接喂给它。 */
export function setSfxEnabled(on: boolean): void {
  sfxEnabled = on;
  if (sfxBus) sfxBus.gain.value = on ? SFX_GAIN : 0;
}

