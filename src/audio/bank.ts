import hudClickUrl from '../../assets/audio/hud_click.ogg';
import { audioContext } from './mixer';

/**
 * 文件夹内文件名随意；每次构建由 Vite 收集全部 ogg/wav/mp3，同一文件夹内随机挑一件。
 * glob 必须写成字面量，不能抽成接收目录名的函数，否则 Vite 无法在构建期找到素材。
 */
const footGrassUrls = Object.values(import.meta.glob(
  '../../assets/audio/foot_grass/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];
const battleHitUrls = Object.values(import.meta.glob(
  '../../assets/audio/battle_hit/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];
const battleCriticalUrls = Object.values(import.meta.glob(
  '../../assets/audio/battle_critical/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];
const pickupUrls = Object.values(import.meta.glob(
  '../../assets/audio/pickup/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];
const levelUpUrls = Object.values(import.meta.glob(
  '../../assets/audio/level_up/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];
const bossEnterUrls = Object.values(import.meta.glob(
  '../../assets/audio/boss_enter/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];

/**
 * 音效表：id → 文件。
 *
 * **这个文件只能被浏览器那一侧引到。** 和 items/pickupIcons.ts 分开的理由一模一样：
 * `.ogg` 一进来，esbuild 打 node 包时就没有 loader 了，`npm run bench` 和 tools/ 下那几个
 * 离线脚本会当场挂掉。战斗那一侧以后要发声，往队列里推 id 就行，不要从这里 import。
 *
 * hud-click 来自 Kenney.nl（CC0）；其余素材按 assets/audio/README.md 的目录投放。
 */
const SOUND_URLS = {
  'hud-click': [hudClickUrl],
  'foot-grass': footGrassUrls,
  'battle-hit': battleHitUrls,
  'battle-critical': battleCriticalUrls,
  pickup: pickupUrls,
  'level-up': levelUpUrls,
  'boss-enter': bossEnterUrls,
} as const;

export type SoundId = keyof typeof SOUND_URLS;

/**
 * 每个音效自己的脾气。
 *
 * gap —— 两次之间至少隔多久，秒。同一个采样在几毫秒内连响会叠成一声闷响，而不是两下。
 * jitter —— 每次播放随机改变多少音调（比例）。
 *
 * **界面点击的 jitter 是 0，这是故意的。** 战斗音效必须抖（同一个采样连响十次而音高一样，
 * 耳朵立刻听出是机关枪），但按钮相反 —— 同一个按钮每次按下去声音都不一样，会让人觉得
 * 界面不稳、像是坏了。按钮要的是"一模一样"。
 */
interface SoundSpec {
  gap: number;
  jitter: number;
}

const SPECS: Record<SoundId, SoundSpec> = {
  'hud-click': { gap: 0.04, jitter: 0 },
  // 触地本来就按步态一脚一次；这道短闸只挡低帧率相位跳变或重置造成的贴脸双响。
  'foot-grass': { gap: 0.09, jitter: 0.035 },
  'battle-hit': { gap: 0.035, jitter: 0.045 },
  'battle-critical': { gap: 0.08, jitter: 0.025 },
  pickup: { gap: 0.045, jitter: 0.035 },
  'level-up': { gap: 0.5, jitter: 0 },
  'boss-enter': { gap: 1, jitter: 0.015 },
};

export const specOf = (id: SoundId): SoundSpec => SPECS[id];

interface LoadedSample {
  buffer: AudioBuffer;
  leadIn: number;
}

const samples = new Map<SoundId, LoadedSample[]>();

/** 低于这个幅度就当成静音。-50dB 左右，编码器留下的底噪都在这条线以下。 */
const SILENCE = 0.003;

/**
 * 这个采样前面有多少秒是空的。
 *
 * 素材前面常带一小段空白（录制、剪辑、编码器补帧都会留），而那一段是实打实的延迟：
 * 按钮按下去到听见响，中间隔着它。**按钮音效对这个特别敏感** —— 几十毫秒就足够让人觉得
 * 界面"不跟手"，而这正是玩家能感觉到、却说不出原因的那类问题。
 *
 * 在这里算而不是把文件裁掉：一来不用带一套音频工具链，二来以后每加一个音效都自动生效，
 * 不依赖谁记得先裁一刀。原始文件保持不动，换素材直接覆盖就行。
 *
 * 找到第一个有声音的采样之后往回退到最近的过零点：从波形中间硬切会"啪"一声，
 * 那是另一个更难听的问题。退不到就退满 5ms，反正那一段本来就是静音。
 */
function measureLeadIn(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  let first = -1;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > SILENCE) { first = i; break; }
  }
  // 整条都是静音（或者本来就没有空白）：不用裁。
  if (first <= 0) return 0;
  const floor = Math.max(0, first - Math.ceil(buffer.sampleRate * 0.005));
  let cut = floor;
  for (let i = first; i > floor; i--) {
    if (data[i] === 0 || (data[i] > 0) !== (data[i - 1] > 0)) { cut = i; break; }
  }
  return cut / buffer.sampleRate;
}


/**
 * 全部取回来解好码。挂在加载期那一串里。
 *
 * 一件都不是必须的：取不到、解不了码，就是这一个音效不响，别的照常。所以每一件各自 catch，
 * 一个坏文件不会把整批拖下水，更不会让人卡在加载条上。
 *
 * decodeAudioData 要 AudioContext，而这时多半还没有用户手势、context 还是 suspended ——
 * **解码不需要 running**，suspended 的 context 一样解得了，所以这一步可以放在解锁之前。
 */
export async function loadSounds(): Promise<void> {
  const ctx = audioContext();
  if (!ctx) return;
  await Promise.all((Object.keys(SOUND_URLS) as SoundId[]).map(async (id) => {
    const loaded = await Promise.all(SOUND_URLS[id].map(async (url): Promise<LoadedSample | null> => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        return { buffer, leadIn: measureLeadIn(buffer) };
      } catch {
        // 这一件没有就没有。同一个 id 的别的变体仍然可以正常用。
        return null;
      }
    }));
    const ready = loaded.filter((sample): sample is LoadedSample => sample !== null);
    if (ready.length > 0) samples.set(id, ready);
  }));
}

/** 从一个逻辑音效的变体里随机拿一件；buffer 和它自己的前导静音必须绑在一起返回。 */
export function sampleOf(id: SoundId): LoadedSample | null {
  const variants = samples.get(id);
  if (!variants || variants.length === 0) return null;
  return variants[Math.floor(Math.random() * variants.length)];
}
