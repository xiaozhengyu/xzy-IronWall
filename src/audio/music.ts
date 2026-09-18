import startUrl from '../../assets/music/start.ogg';
import battleUrl from '../../assets/music/battle.ogg';
import { audioContext, musicDestination } from './mixer';

/**
 * 背景音乐：两首，各自循环，切换时交叉淡入淡出。
 *
 * **和音效走的是两套机制，不是一套。** 音效是几百毫秒的一次性采样，可以几十个同时响；
 * 音乐是一首一直在放的曲子，同一时刻只有一首（切换的那半秒是两首）。所以这里不复用
 * sfx.ts 的声部计数和每 id 间隔 —— 那两样解决的是"一帧里冒出八十个声音"，音乐没有这个问题。
 *
 * **循环用 AudioBufferSourceNode 的 loop，不用 <audio loop>。** 后者在每一圈的接缝处会有
 * 一个听得见的空档（浏览器要重新起播），而开场那首只有 17 秒，一分钟就要接三次，
 * 每次都"嗒"一下。代价是整首要解码进内存，见下面 load 那一段。
 *
 * 这个文件和 bank.ts 一样**只能被浏览器那一侧引到**：`.ogg` 一进 node 的依赖图，
 * esbuild 打 bench 和 tools/ 那几个离线脚本时就没有 loader 了。
 */

const TRACK_URLS = {
  start: startUrl,
  battle: battleUrl,
} as const;

export type MusicTrack = keyof typeof TRACK_URLS;


/**
 * 每首自己的淡入淡出时长，秒。**0 就是直接给到位，一点渐变都不做。**
 *
 * 选人那首是 0，这是故意的。它本来就压得极低（见下面 TRACK_VOLUME），一首几乎听不见的
 * 背景音再慢慢爬上来，唯一的效果是让人分不清"现在到底是什么音量"——尤其它起播的时刻
 * 取决于玩家什么时候点第一下（自动播放策略见 mixer.unlock），于是同一屏每次进来听感都
 * 不一样。定死一个音量，从第一个采样起就是它，听感才是稳的。
 *
 * 战斗那首保留 1 秒：它是有存在感的，而且进图那一下是从选人曲**交叉**过来的，硬切在
 * 两首之间才是真的突兀。
 *
 * 代价：离开选人界面时那一首是硬停的，波形中间断开会有一个台阶。可以接受——它的幅度只有
 * 0.057，而那一刻黑幕正在落、换屏声正在响，这点台阶完全盖住了。
 */
const TRACK_FADE: Record<MusicTrack, number> = {
  start: 0,
  battle: 1,
};

/**
 * 每首自己的音量，叠在音乐总线之上。
 *
 * **选人那一首要小得多。** 它是真正意义上的背景音 —— 玩家在那一屏上读属性、比技能、挑
 * 地图，音乐只负责让这屏不至于死寂，不该参与表达。战斗那首相反，它是这一局的情绪底子，
 * 该有存在感。两首素材本身已经用 loudnorm 对齐（见 assets/music/README.md），所以这里
 * 这个比例就是纯粹的设计意图，不是在补素材的响度差。
 */
const TRACK_VOLUME: Record<MusicTrack, number> = {
  // 0.15 是在 0.3 的基础上再砍一半（-6dB）。叠上总线的 0.38 之后实际幅度约 0.057，
  // 也就是比战斗那首低 16dB —— 这一屏上它只是"不死寂"，不该让人注意到。
  start: 0.15,
  battle: 1,
};

interface Playing {
  track: MusicTrack;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * 一首曲子，外加它**真正有声音的那一段**。
 *
 * 两首素材首尾都带着可观的静音（start 头 1.94s 尾 1.32s，battle 头 2.77s 尾 0.62s），
 * 照原样循环的话每转一圈就断三秒多 —— 听起来不像"循环的背景乐"，像"放完了又重放"。
 * 更要命的是**第一次起播**：点下去之后要愣两秒才出声，然后以满音量突然出现，那个从无到
 * 有的落差会被听成"音乐好大"。
 */
interface Loaded {
  buffer: AudioBuffer;
  /** 第一个听得见的采样，秒。起播点和循环起点都用它。 */
  head: number;
  /** 最后一个听得见的采样，秒。循环终点。 */
  tail: number;
}

const buffers = new Map<MusicTrack, Loaded>();

/**
 * 掐掉首尾的静音，只留有声的那一段。
 *
 * 判据和音效那边同源（bank.ts 的 ONSET_FRACTION）：**相对本首峰值** -34dB。绝对阈值在
 * 这里没用 —— 两首曲子的电平差本来就大，一个固定的数对一首太松、对另一首太紧。
 *
 * 只扫第一个声道。立体声两边的静音边界不会差到能听出来，而扫两遍要多花一倍时间，
 * 这是在加载路径上。
 */
function voiced(buffer: AudioBuffer): { head: number; tail: number } {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
  }
  const line = peak * 0.02;
  let head = 0;
  let tail = data.length - 1;
  while (head < data.length && Math.abs(data[head]) < line) head++;
  while (tail > head && Math.abs(data[tail]) < line) tail--;
  // 整条都静音（不该发生）就退回整段，至少还能放。
  if (tail <= head) return { head: 0, tail: buffer.duration };
  return { head: head / buffer.sampleRate, tail: (tail + 1) / buffer.sampleRate };
}
let current: Playing | null = null;
/** 想放的那一首。素材没到、context 还没解锁时先记在这儿，等条件齐了由 setTrack 再推一次。 */
let wanted: MusicTrack | null = null;
let loading = false;

/**
 * 取回来解码。**不挂在加载条上，后台慢慢来。**
 *
 * 战斗那首一分四十七秒，解出来是四十兆 PCM，解码本身也要几百毫秒。摆进启动流程里，
 * 玩家要为一首还没开始听的曲子多等一截 —— 而这个工程的加载条走的是真进度，多出来的
 * 那一截是实打实的等待。所以让它在后台解，解好之前选人界面就是安静的，解好了自己接上。
 */
async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  const ctx = audioContext();
  if (!ctx) return;
  await Promise.all((Object.keys(TRACK_URLS) as MusicTrack[]).map(async (track) => {
    try {
      const response = await fetch(TRACK_URLS[track]);
      if (!response.ok) return;
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      buffers.set(track, { buffer, ...voiced(buffer) });
    } catch {
      // 这一首没有就没有。另一首照常，游戏也照常 —— 没音乐不该让人打不了。
    }
  }));
}

/** 开始加载。main 在引导流程末尾调一次，不 await。 */
export function loadMusic(): void {
  void load();
}

function fadeOut(playing: Playing, now: number): void {
  const fade = TRACK_FADE[playing.track];
  if (fade <= 0) {
    // 不渐变的那一首直接停。停了就不必再管增益，节点跟着一起废掉。
    playing.source.stop(now);
    return;
  }
  playing.gain.gain.cancelScheduledValues(now);
  playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
  playing.gain.gain.linearRampToValueAtTime(0, now + fade);
  // 淡完就停。不停的话它会一直占着一个解码好的缓冲在那儿空转。
  playing.source.stop(now + fade);
}

/**
 * 换到这一首（null 就是停）。
 *
 * **幂等，而且每帧调都不要紧。** main 每帧按当前状态算出该放哪一首然后喂进来，不用自己
 * 记上一次放的是什么。已经在放同一首就直接返回。
 *
 * 顺带承担"条件还不齐就以后再说"：素材没解完、或者 AudioContext 还没被用户手势解锁，
 * 这时候起播是无效的（suspended 的 context 上 start 出来的东西要等 resume 才响，而 resume
 * 可能永远不来）。所以把想放的记下来，下一帧再试 —— 反正 main 每帧都会调。
 */
export function setTrack(track: MusicTrack | null): void {
  wanted = track;
  const ctx = audioContext();
  const out = musicDestination();
  if (!ctx || !out || ctx.state !== 'running') return;
  if (current?.track === track) return;

  const now = ctx.currentTime;
  if (current) {
    fadeOut(current, now);
    current = null;
  }
  if (!track) return;

  const loaded = buffers.get(track);
  // 还没解好。wanted 已经记下了，下一帧再来。
  if (!loaded) return;

  const gain = ctx.createGain();
  const volume = TRACK_VOLUME[track];
  const fade = TRACK_FADE[track];
  if (fade > 0) {
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + fade);
  } else {
    // 不淡入：从第一个采样起就是最终音量。
    gain.gain.setValueAtTime(volume, now);
  }
  gain.connect(out);

  const source = ctx.createBufferSource();
  source.buffer = loaded.buffer;
  source.loop = true;
  // 只循环有声的那一段，两头的静音一律不碰。
  source.loopStart = loaded.head;
  source.loopEnd = loaded.tail;
  source.connect(gain);
  // 第二个参数是从第几秒开始放。从 head 起播，所以点下去就有声，不用先等两秒空白。
  source.start(now, loaded.head);

  current = { track, source, gain };
}

/** 现在在放的那一首；没有就是 null。调试和自检用。 */
export const currentTrack = (): MusicTrack | null => current?.track ?? null;

/** 想放但还没放上的那一首。素材没解完或者还没解锁时不为空。 */
export const pendingTrack = (): MusicTrack | null => (current ? null : wanted);

/**
 * 当前这一首自己那条增益的实时值（不含音乐总线）。调试和自检用。
 *
 * 光看总线是不够的：总线管的是开关和闪避，而每首自己的音量和淡入挂在这一条上，
 * 两者相乘才是真正听到的东西。查"为什么这次听起来更大"必须能分开看。
 */
export const currentVolume = (): number | null => (current ? current.gain.gain.value : null);
