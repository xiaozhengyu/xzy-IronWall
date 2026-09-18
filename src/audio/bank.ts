import hudClickUrl from '../../assets/audio/hud_click.ogg';
import { audioContext } from './mixer';

/**
 * 文件夹内文件名随意；每次构建由 Vite 收集全部 ogg/wav/mp3，同一文件夹内随机挑一件。
 * glob 必须写成字面量，不能抽成接收目录名的函数，否则 Vite 无法在构建期找到素材。
 */
const attackSwingUrls = Object.values(import.meta.glob(
  '../../assets/audio/attack_swing/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];
const battleHitUrls = Object.values(import.meta.glob(
  '../../assets/audio/battle_hit/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];
const footstepUrls = Object.values(import.meta.glob(
  '../../assets/audio/footstep/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];
const sceneSwitchUrls = Object.values(import.meta.glob(
  '../../assets/audio/scene_switch/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];
const cardDealUrls = Object.values(import.meta.glob(
  '../../assets/audio/card_deal/*.{ogg,wav,mp3}',
  { eager: true, query: '?url', import: 'default' },
)) as string[];

/**
 * 音效表：id → 文件。
 *
 * **四个，是收过一轮之后再按需要加回来的。** 曾经摆过七个语义（暴击、拾取、升级、首领出场
 * 那几个）全撤了：那些事画面上各有说法，再配一个音效只是在割草的噪音里多抢一个声部。留下和
 * 加回来的都只有一条理由 —— **它是玩家唯一的反馈来源**：挥空时画面上什么都没有，砍中那一下
 * 的手感全在声音里，而"我正在跑"这件事，脚下那点尘土也说不清楚。
 *
 * 脚步是撤掉之后又加回来的，加回来的时候和当初不一样：当初按地表分（只有草地响），现在只有
 * 一套素材，踩水踩雪踩土都报；触发点也从头量过一遍，见 effects/footsteps.ts。
 *
 * **这个文件只能被浏览器那一侧引到。** 和 items/pickupIcons.ts 分开的理由一模一样：
 * `.ogg` 一进来，esbuild 打 node 包时就没有 loader 了，`npm run bench` 和 tools/ 下那几个
 * 离线脚本会当场挂掉。战斗那一侧要发声，往队列里推 id 就行，不要从这里 import。
 *
 * hud-click 来自 Kenney.nl（CC0）；其余三类是从 doc/ 下的录屏里裁的，见 assets/audio/README.md。
 */
const SOUND_URLS = {
  'hud-click': [hudClickUrl],
  'attack-swing': attackSwingUrls,
  'battle-hit': battleHitUrls,
  footstep: footstepUrls,
  'scene-switch': sceneSwitchUrls,
  'card-deal': cardDealUrls,
} as const;

export type SoundId = keyof typeof SOUND_URLS;

/**
 * 每个音效自己的脾气。
 *
 * gap —— 两次之间至少隔多久，秒。同一个采样在几毫秒内连响会叠成一声闷响，而不是两下。
 * jitter —— 每次播放随机改变多少音调（比例）。
 *
 * **界面点击的 jitter 是 0，这是故意的。** 战斗音效要抖一点（同一个采样连响十次而音高一样，
 * 耳朵立刻听出是机关枪），但按钮相反 —— 同一个按钮每次按下去声音都不一样，会让人觉得
 * 界面不稳、像是坏了。按钮要的是"一模一样"。
 *
 * **战斗那两个的 jitter 现在比以前小。** 早先一个 id 只有一条采样，全靠改音调冒充变化，
 * 抖得不够就是机关枪。现在挥击有 11 条、命中有 13 条真正不同的录音，"不重复"这件事已经
 * 由变体自己解决了，音调再抖多了反而露馅 —— 真实录音被明显改调，听起来是"放慢/放快的
 * 录音带"，而不是另一刀。
 */
interface SoundSpec {
  gap: number;
  jitter: number;
}

const SPECS: Record<SoundId, SoundSpec> = {
  'hud-click': { gap: 0.04, jitter: 0 },
  // 挥击本来就按出手频率一刀一次，最快也有 0.2 秒；这道闸只挡"挥到一半被打断又立刻起手"
  // 这类贴脸双响。
  'attack-swing': { gap: 0.06, jitter: 0.035 },
  'battle-hit': { gap: 0.035, jitter: 0.025 },
  /*
   * 脚步的 gap **必须小于疾走时的两步间隔**，否则会把正常的步子闸掉。
   *
   * 量过：走路 4.47 步/秒（间隔 224ms），疾走 8.00 步/秒（间隔 125ms）。0.05 留了一倍
   * 余量，同时仍然挡得住低帧率下相位跳变造成的贴脸双响。
   *
   * 素材本身也按这个数裁过，最长 130ms —— 比 125ms 长一点点是故意的，跑起来前一步的
   * 尾巴压着后一步的头，那正是"连成一串跑步声"而不是"一下一下的独立响声"。
   */
  footstep: { gap: 0.05, jitter: 0.03 },
  /*
   * 换屏声。**jitter 是 0，和按钮同一个理由** —— 界面的声音要"一模一样"，每次不一样会
   * 让人觉得界面不稳。何况它只有一条素材，抖音调只会把同一条露出马脚。
   *
   * gap 给到 0.3：它有 734ms 长，而界面上有几处是**一次动作连着两次换屏**（商店按返回：
   * shop.hide 之后紧接着 setup.show）。不挡的话那两下会叠在一起，听着像破音。
   */
  'scene-switch': { gap: 0.3, jitter: 0 },
  /*
   * 三选一：弹出来一次，选完飞出去再一次，两次都是这一条。同样 jitter 0（界面音）。
   *
   * **gap 必须很小，这一条是被"选完也响"逼出来的。** 一度写的是 1 秒，理由是这条素材
   * 有 1.7 秒长；但弹出和选完之间隔的是**玩家的反应时间** —— 按数字键的话三四百毫秒就
   * 选完了，闸一秒会把收场那一声整个吃掉，而且是悄悄吃掉，听起来就像"有时候响有时候不响"。
   *
   * 0.12 秒只挡真正的同帧重入。两条路本来各自就有闸：show 开头 `if (this.open) return`，
   * choose 开头 `if (!this.open || this.closing) return false`，所以这道闸只是兜底。
   *
   * 代价是玩家手快时两声会叠在一起（后一声压在前一声 1.7 秒的尾巴上）。这是想要的：
   * 那本来就是同一叠牌甩开又收回。
   */
  'card-deal': { gap: 0.12, jitter: 0 },
};

export const specOf = (id: SoundId): SoundSpec => SPECS[id];

interface LoadedSample {
  buffer: AudioBuffer;
  leadIn: number;
}

const samples = new Map<SoundId, LoadedSample[]>();

/**
 * 起音判据用多长的窗口求能量。
 *
 * 判据看的是**能量包络**，不是某一个采样的瞬时值。起音段的原始波形抖得厉害，按瞬时值取线，
 * 取到的往往是噪声里的一根毛刺，比真正听得见的那一下早十几毫秒。3ms 足够把这种毛刺抹平，
 * 又短到不会把一个真正的瞬态糊掉。
 */
const ENVELOPE_WINDOW = 0.003;

/**
 * 能量包络爬到峰值的这个比例，才算"这一声真的来了"。
 *
 * 0.25 是 -12dB。这个数是三条素材一起量出来的：
 *
 *   hud-click 的整个起音只有 6ms 宽（-34dB 在 113.9ms，峰值在 119.8ms），-12dB 落在
 *   117.1ms —— 正是耳朵认为它响了的那一刻。
 *
 *   挥击和命中相反，是**几十毫秒的抡起来**：-34dB 在 4ms 就越线了，可包络要到 42ms
 *   （挥击）和 36ms（命中）才爬到 -12dB，峰值更是在 91ms 和 153ms。那四十毫秒的爬升
 *   是素材自带的抡劲，放在割草游戏里就是"砍下去之后才响"。
 *
 * **所以这一刀是切在波形中间的，不是切在静音里。** 这样切必然有一个台阶，台阶就是"啪"
 * 一声 —— 所以起播那一下必须淡入，见 sfx.ts 的 ATTACK_FADE。两者是一套的，只改一个会
 * 立刻听出问题。
 *
 * 还想更"跟手"就把这个数调大（-6dB 就是 0.5），代价是素材的起音被削掉更多，听起来会越来
 * 越像被掐头。
 */
const ONSET_FRACTION = 0.25;

/**
 * 这一声真正开始之前，有多少秒是听不见的。
 *
 * 素材前面那一段 —— 空白也好、抡起来的爬升也好 —— 都是实打实的延迟：按下去到听见响，
 * 中间隔着它。**这个东西对手感的影响远大于它的长度看起来的样子**，十几毫秒就足够让人
 * 觉得"不跟手"，而这正是玩家能感觉到、却说不出原因的那类问题。
 *
 * 在这里算而不是把文件裁掉：一来换素材直接覆盖就行，二来这条线是一个可以随时拧的旋钮 ——
 * 裁进文件里就固化了，想往回调得重新出素材。hud-click 更是别人的 CC0 素材，为这点毫秒
 * 把 ogg 重编一遍（有损转有损）不值得。
 *
 * 找到越线点之后再往回退到最近的过零点：过零点上切没有台阶，淡入要处理的东西更少。
 * 退不到就退满 5ms。
 */
function measureLeadIn(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const win = Math.max(1, Math.round(rate * ENVELOPE_WINDOW));

  // 滑动窗口里的能量和。比的是能量而不是 RMS —— 省掉每个采样一次 sqrt，把比例平方一下
  // 就完全等价（0.25 的 RMS 比例就是 0.0625 的能量比例）。
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    energy += data[i] * data[i];
    if (i >= win) energy -= data[i - win] * data[i - win];
    if (energy > peak) peak = energy;
  }
  // 整条都是静音：没什么可裁的。
  if (peak <= 0) return 0;

  const line = peak * ONSET_FRACTION * ONSET_FRACTION;
  let first = -1;
  energy = 0;
  for (let i = 0; i < data.length; i++) {
    energy += data[i] * data[i];
    if (i >= win) energy -= data[i - win] * data[i - win];
    if (energy > line) { first = i; break; }
  }
  if (first <= 0) return 0;

  const floor = Math.max(0, first - Math.ceil(rate * 0.005));
  let cut = floor;
  for (let i = first; i > floor; i--) {
    if (data[i] === 0 || (data[i] > 0) !== (data[i - 1] > 0)) { cut = i; break; }
  }
  return cut / rate;
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
