import { sampleOf, specOf, type SoundId } from './bank';
import { audioContext, sfxDestination } from './mixer';

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
  if (!ctx || !out || !sample || ctx.state !== 'running') return;
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

  const gain = options.gain ?? 1;
  if (gain === 1) {
    source.connect(out);
  } else {
    const node = ctx.createGain();
    node.gain.value = Math.max(0, Math.min(1, gain));
    source.connect(node);
    node.connect(out);
  }

  voices++;
  source.onended = () => { voices--; };
  // 第二个参数是**从采样的第几秒开始放**，用它跳掉素材前面那段空白 —— 那一段是实打实的
  // 延迟，按钮按下去到听见响中间就隔着它。见 bank.ts 的 measureLeadIn。
  source.start(0, sample.leadIn);
}
