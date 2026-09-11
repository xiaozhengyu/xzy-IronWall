/**
 * 按模板发号施令的那个人：只管时间和配额，不碰世界。
 *
 * 模板本身（各张地图的波次表）和兵种属性都搬到 data/ 去了 —— 那些是天天要调的数值，而这里
 * 是几个月才碰一次的机制。两者留在同一个文件里的时候，改一个数值的 diff 和改一条规则的
 * diff 长得一模一样。
 *
 * 这几个 re-export 是给老调用点留的门：tools/ 下的离线脚本和 battle.ts 都按 './waves'
 * 取模板，没必要为了搬家去改它们的 import。
 */

import {
  DEFAULT_SPAWN_TEMPLATE,
  type SpawnTemplate,
  type WaveSpec,
} from '../data/waves';
import { EnemyKindIds, resolveKind } from '../data/units';
import type { ResolvedUnitKind } from '../data/types';

export {
  DEFAULT_SPAWN_TEMPLATE,
  PASS_SPAWN_TEMPLATE,
  SNOWFIELD_SPAWN_TEMPLATE,
  STEPPE_SPAWN_TEMPLATE,
} from '../data/waves';
export type { EnemyMix, SpawnTemplate, WaveSpec } from '../data/waves';
export type { EnemyKindId } from '../data/units';

export class WaveDirector {
  private spec: SpawnTemplate;
  private waveAt = 0;
  /** 本波已经过去多少秒。 */
  private elapsed = 0;
  /**
   * 攒着还没放出去的人。小数留着，密度低于一帧一个时也不会被抹成零。
   *
   * 爆兵和持续密度分成两笔账：爆兵那笔要优先放、而且不许被"最多攒两秒"那条规则抹掉 ——
   * 一波的开场白被人数上限吞掉的话，八波就长成一个样子了。
   */
  private pendingSurge = 0;
  private pendingDensity = 0;
  /** 爆兵还剩多少个没开始放。 */
  private surgeLeft = 0;
  /** 刚进新的一波。battle 读一次就清，用来记爆兵的天花板。 */
  private started = false;
  /** 兵种比例的前缀和，换波时算一次。 */
  private roll: { kind: ResolvedUnitKind; upTo: number }[] = [];
  private rollTotal = 0;

  /** 已经打完的波数。面板上的进度节点按它点亮。 */
  cleared = 0;

  constructor(template: SpawnTemplate = DEFAULT_SPAWN_TEMPLATE) {
    this.spec = template;
    this.enterWave();
  }

  get template(): SpawnTemplate {
    return this.spec;
  }

  /** 换一张模板（换地图）。会从第一波重新开始。 */
  setTemplate(template: SpawnTemplate): void {
    this.spec = template;
    this.reset();
  }

  reset(): void {
    this.waveAt = 0;
    this.cleared = 0;
    this.pendingSurge = 0;
    this.pendingDensity = 0;
    this.enterWave();
  }

  /** 从 1 数起的波号，面板显示用。 */
  get waveNumber(): number {
    return this.waveAt + 1;
  }

  get waveCount(): number {
    return this.spec.waves.length;
  }

  get wave(): WaveSpec {
    return this.spec.waves[this.waveAt];
  }

  /**
   * 距离下一波还有几秒。停在最后一波（after: 'hold'）时是 0 —— 面板显示 00:00，
   * 意思是"没有下一波了，就是这样了"。
   */
  get countdown(): number {
    if (this.holding) return 0;
    return Math.max(0, this.wave.duration - this.elapsed);
  }

  /** 最后一波已经打完、正在按它的密度续着出。 */
  get holding(): boolean {
    return this.spec.after === 'hold' && this.cleared >= this.waveCount;
  }

  /**
   * 推进计时并累配额。
   *
   * @param rate 出兵速度倍率，1 是模板原速。调试旋钮走这里，模板本身不受影响。
   */
  update(dt: number, rate = 1): void {
    if (dt <= 0) return;
    const wave = this.wave;
    this.elapsed += dt;

    // 爆兵先放：它和持续密度是叠加的，不是二选一 —— 开波那两秒本来就该比之后任何时候都密。
    if (this.surgeLeft > 0) {
      const burst = Math.min(this.surgeLeft, (wave.surge / Math.max(0.1, wave.surgeTime)) * rate * dt);
      this.surgeLeft -= burst;
      this.pendingSurge += burst;
    }
    this.pendingDensity += wave.density * rate * dt;

    // 一次只翻一波：dt 是一帧，而最短的一波也有一分钟，不会跨两波。
    if (!this.holding && this.elapsed >= wave.duration) this.advance();
  }

  /** 爆兵还没放完。battle 靠它决定要不要抬高人数上限。 */
  get surging(): boolean {
    return this.surgeLeft > 1e-3 || this.pendingSurge >= 1;
  }

  /** 刚跨进新的一波吗。读一次就清。 */
  takeWaveStart(): boolean {
    const started = this.started;
    this.started = false;
    return started;
  }

  /**
   * 取本次能放的人数，上限由外面给（场上还容得下几个）。
   *
   * 取不走的那部分**留着**：出兵被人数上限卡住时，配额攒在这儿，玩家一杀出空档就立刻补上，
   * 这正是"杀不完"的来源。但持续密度那笔最多攒两秒，否则挂机两分钟再回来会瞬间灌进来一整波；
   * 爆兵那笔不设上限，它本来就是一次性的一整包。
   */
  take(room: number): number {
    let left = Math.max(0, Math.floor(room));
    const surge = Math.min(Math.floor(this.pendingSurge), left);
    this.pendingSurge -= surge;
    left -= surge;
    const steady = Math.min(Math.floor(this.pendingDensity), left);
    this.pendingDensity -= steady;
    this.pendingDensity = Math.min(this.pendingDensity, this.wave.density * 2 + 1);
    return surge + steady;
  }

  /** 没能落地的名额退回来（出怪点全被挡住时），下一批再试。 */
  refund(count: number): void {
    if (count <= 0) return;
    if (this.surging) this.pendingSurge += count;
    else this.pendingDensity += count;
  }

  /** 整张模板一共有几个首领。面板上那排节点按它排。 */
  get bossTotal(): number {
    let total = 0;
    for (const wave of this.spec.waves) total += wave.bosses;
    return total;
  }

  /**
   * 直接跳到第 n 波，从 1 数起。调试用。
   *
   * 和自然翻页走同一条路：重记爆兵、重算兵种比例、面板节点点亮到这一波之前。攒着没放的配额
   * 一并清掉 —— 那是上一波欠的人，跳过去之后再补出来只会让两波的配比混在一起。
   */
  jumpTo(waveNumber: number): void {
    const at = Math.max(0, Math.min(this.waveCount - 1, Math.floor(waveNumber) - 1));
    this.waveAt = at;
    this.cleared = at;
    this.pendingSurge = 0;
    this.pendingDensity = 0;
    this.enterWave();
  }

  /** 按这一波的比例摇一个兵种。 */
  pick(random: () => number = Math.random): ResolvedUnitKind {
    const at = random() * this.rollTotal;
    for (const entry of this.roll) if (at < entry.upTo) return entry.kind;
    return this.roll[this.roll.length - 1].kind;
  }

  private advance(): void {
    this.cleared++;
    if (this.waveAt + 1 >= this.waveCount) {
      // 打完最后一波。'hold' 就留在原地继续按它出，'restart' 回到第一波。
      if (this.spec.after === 'restart') {
        this.waveAt = 0;
        this.cleared = 0;
        this.enterWave();
      } else {
        this.elapsed = 0;
      }
      return;
    }
    this.waveAt++;
    this.enterWave();
  }

  private enterWave(): void {
    const wave = this.wave;
    this.elapsed = 0;
    this.surgeLeft = wave.surge;
    this.started = true;
    this.roll = [];
    this.rollTotal = 0;
    for (const id of EnemyKindIds) {
      const weight = wave.mix[id] ?? 0;
      if (weight <= 0) continue;
      this.rollTotal += weight;
      this.roll.push({ kind: resolveKind(id), upTo: this.rollTotal });
    }
    // 模板把一波的比例写空了（或者全写成 0）就退回全兵种等概率，总比一个也生不出来强。
    if (this.roll.length === 0) {
      for (const id of EnemyKindIds) {
        this.rollTotal += 1;
        this.roll.push({ kind: resolveKind(id), upTo: this.rollTotal });
      }
    }
  }
}
