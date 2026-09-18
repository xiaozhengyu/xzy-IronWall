import { sampleOf, specOf, type SoundId } from './bank';
import { audioContext, sfxAudible, sfxDestination } from './mixer';

/**
 * 放一个音效。
 *
 * 两条闸，都是为割草那个场面准备的 —— 一发回旋清掉八十个人，天真的做法是八十次 play，
 * 结果是一堵白噪音，而且音频线程当场跪：
 *
 *   每个 id 一个最小间隔（见 bank.ts 的 gap）—— 和战斗里 AURA_HIT_GAP 那个每敌免疫窗口
 *   是同一个套路：不是每次都判定，是每隔一段才判定一次。
 *
 *   全局声部上限 —— 满了就直接丢掉新的，和碎片、飘字满了之后的策略一致：少一声没人听得出来，
 *   而卡一下所有人都听得出来。
 *
 * 声部计数靠 onended 减回去。AudioBufferSourceNode 是一次性的，播完自己就废了，
 * 不需要回收池。
 */

/** 同时最多几个声部。短音效 24 个已经是一片了，再多只是把动态范围吃光。 */
const MAX_VOICES = 24;

/**
 * 起播那一下的淡入，秒。
 *
 * 这是 measureLeadIn 那一刀的配套件，不是可有可无的修饰。现在起播点落在波形中间（能量
 * 包络的 -12dB 处，见 bank.ts 的 ONSET_FRACTION），从那里硬切必然留下一个台阶，而台阶
 * 就是"啪"一声 —— 比它要解决的那点延迟难听得多。
 *
 * 1.2ms。比任何素材的起音都短（hud-click 整个起音也有 6ms），所以听不出被淡过；
 * 又比一个采样周期长得多，足够把台阶抹平。**再长就开始吃掉打击感了**：淡入是在削瞬态，
 * 而瞬态正是"砍中了"这件事的全部。
 */
const ATTACK_FADE = 0.0012;

let voices = 0;
const lastPlayed = new Map<SoundId, number>();

export interface PlayOptions {
  /** 音量倍率，叠在总线音量之上。同帧合并时按人数折算的那个数走这里。 */
  gain?: number;
}

export function play(id: SoundId, options: PlayOptions = {}): void {
  const ctx = audioContext();
  const out = sfxDestination();
  const sample = sampleOf(id);
  // 没解锁、没加载上、或者压根没有 AudioContext —— 一律静默不响。没声音不是错。
  //
  // 这里问的是 sfxAudible 而不是 `ctx.state === 'running'`：解锁那一次手势里，resume 还没
  // 落地，state 仍是 suspended，而按钮的声音恰恰就在那一个事件里。按 state 一刀切，
  // 第一次点击必然是哑的。见 mixer.sfxAudible。
  if (!ctx || !out || !sample || !sfxAudible()) return;
  if (voices >= MAX_VOICES) return;

  const spec = specOf(id);
  const now = ctx.currentTime;
  const last = lastPlayed.get(id);
  if (last !== undefined && now - last < spec.gap) return;
  lastPlayed.set(id, now);

  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  if (spec.jitter > 0) {
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * spec.jitter;
  }

  // 每个声部都过一个 GainNode —— 以前音量为 1 时是直连的，省掉一个节点；现在不行了，
  // 淡入本身就得靠它。24 个声部封顶，多这一个节点的代价可以忽略。
  const node = ctx.createGain();
  const gain = Math.max(0, Math.min(1, options.gain ?? 1));
  // 淡入和起播锚在同一个时刻。如果让斜坡挂在 currentTime、而 start 用"尽快"，两者可能差
  // 一个渲染量子（两三毫秒）—— 斜坡先跑完，声音才进来，淡入就等于没做，台阶原样还在。
  node.gain.setValueAtTime(0, now);
  node.gain.linearRampToValueAtTime(gain, now + ATTACK_FADE);
  source.connect(node);
  node.connect(out);

  voices++;
  source.onended = () => { voices--; };
  // 第二个参数是**从采样的第几秒开始放**，用它跳掉素材前面那段听不见的东西 —— 空白也好、
  // 抡起来的爬升也好，那一段是实打实的延迟。见 bank.ts 的 measureLeadIn。
  source.start(now, sample.leadIn);
}
