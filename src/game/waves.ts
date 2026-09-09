import { PALETTE_PEASANT, PALETTE_RED, type CharacterPalette } from '../characters/palette';
import { type UnitDef, UnitPresets } from '../characters/unitDef';

/**
 * 出兵模板：一局的节奏写成数据，换地图就换这一张表。
 *
 * 这个文件只描述"什么时候、放多少、放什么"，一个人也不放 —— 真正的落点、朝向和回收全在
 * battle.ts。分开的理由是这两件事的改动频率差着一个数量级：调难度是天天要动的数值，而出怪
 * 点怎么算是几个月才碰一次的机制。
 */

/**
 * 敌人的种类。def 和调色板是共享的只读数据，一百个杂兵指向同一份就够了。
 *
 * 这张表只放杂兵。UnitPresets.knight 是 boss，刻意不在这里 —— 他一个人 120 个图元
 * （杂兵六十上下），而且面甲、盔冠、金护手那些细节是为"这个人不一样"准备的，一屏站
 * 二十个就什么也不说明了。理由写在 unitDef.ts 那条预设上面。
 *
 * 速度是按"多久能走进画面"倒推的，不是按写实的步行速度。视野半径有两百多个世界单位（一个人
 * 才 19 单位高），照真人步速走进来要半分钟 —— 开局一整分钟画面上什么都不会发生。割草游戏里
 * 的杂兵本来也是小跑着扑过来的。
 */
export type EnemyKindId = 'thug' | 'peasant' | 'spearman' | 'shieldman' | 'archer';

export type EnemyKind = {
  /** 模板里按这个名字配比例。改名字要同步改所有模板。 */
  id: EnemyKindId;
  def: UnitDef;
  palette: CharacterPalette;
  speed: number;
};

export const EnemyKinds: readonly EnemyKind[] = [
  { id: 'thug', def: UnitPresets.thug(), palette: PALETTE_RED, speed: 26 },
  { id: 'peasant', def: UnitPresets.thug(), palette: PALETTE_PEASANT, speed: 30 },
  { id: 'spearman', def: UnitPresets.spearman(), palette: PALETTE_RED, speed: 23 },
  { id: 'shieldman', def: UnitPresets.shieldman(), palette: PALETTE_RED, speed: 20 },
  { id: 'archer', def: UnitPresets.archer(), palette: PALETTE_PEASANT, speed: 33 },
];

/** 兵种比例。权重是相对的，不必加起来等于 1；没写的兵种这一波就不出。 */
export type EnemyMix = Partial<Record<EnemyKindId, number>>;

export interface WaveSpec {
  /**
   * 这一波持续多久，秒。它同时就是面板上那个倒计时 —— 面板显示的"距下一波"和"本波还剩"
   * 是同一个数，不需要两套计时。
   */
  duration: number;
  /**
   * 开波爆兵：一上来先放这么多人。
   *
   * 压力感来自**密度突变**，不是来自总量：稳态出兵每秒十几个，混在场上几百人里看不出来；
   * 一口气涌进来两百个，玩家在下一次抬头时会发现四周厚了一圈。这是每一波的开场白。
   */
  surge: number;
  /**
   * 爆兵摊在几秒里放完。
   *
   * 不做成单帧一次性放完：那一帧要 new 上百个 Character，是看得见的卡顿，而画面上什么也不会
   * 发生 —— 人都生在视口外，要走一两秒才进画面。摊开之后卡顿没了，进场的观感一模一样。
   */
  surgeTime: number;
  /** 爆兵之后的持续密度，每秒放几个。 */
  density: number;
  /**
   * 出兵会一直补到场上有这么多**完整**敌人（有骨架、会打人的那种）为止。
   *
   * 它是出兵这条路的目标值，不是场上人数的硬上限：从远处走进画面的那批人是被"恢复"成完整
   * 敌人的，不经过出兵，所以实际场上人数经常比它高一截。真正的硬上限是 battle 的 maxEnemies。
   */
  crowd: number;
  /**
   * 这一波的全图人数预算：场上的人加上屏幕外那些无骨架的数据，一共养这么多。
   *
   * 这才是**屏幕上人有多密**的那个旋钮 —— 玩家身边站着多少人，主要看四周那片人海有多厚，
   * 而不是看出兵补得多勤。它同时是这一波的帧耗时预算，所以会被 battle 的
   * TARGET_WORLD_ENEMIES 夹住（那是全局的日常预算，模板不能突破）。
   */
  world: number;
  /**
   * 这一波的首领个数。暂定全 0。
   *
   * 只是数据，battle 现在不会照它放人：杂兵是碰到就死的（slay 直接绕过血量），一个 1 点血、
   * 挨一下就倒的骑士不是首领，是个大号杂兵。真要放首领得先有血量、受击反馈和出场逻辑，那
   * 三样落地之前，这个字段先把编队记在模板里，面板照着它排节点。接上的时候改一处：spawnWave
   * 里按这个数放人。
   */
  bosses: number;
  /** 这一波出哪些兵、各占多少。 */
  mix: EnemyMix;
}

export interface SpawnTemplate {
  /** 调试面板和存档里认这个名字。 */
  name: string;
  waves: readonly WaveSpec[];
  /**
   * 最后一波打完之后怎么办。
   *
   * 'hold'：停在最后一波，按它的密度一直出下去。割草游戏没有"打完了"这一说，玩家是被耗死
   * 的，所以这是默认。'restart'：从第一波重来，用来做无限循环的测试图。
   */
  after: 'hold' | 'restart';
}

/**
 * 默认模板：八波，每波比上一波长 30 秒。
 *
 *   波次  时长   爆兵   密度/秒   出兵目标   全图预算   首领
 *     1    60     60     10         400        900       0
 *     2    90     90     14         460        950       0
 *     3   120    120     18         520       1000       0
 *     4   150    150     24         580       1050       0
 *     5   180    180     30         620       1100       0
 *     6   210    220     36         660       1150       0
 *     7   240    260     44         700       1200       0
 *     8   270    300     52         750       1200       0
 *
 * 整局 22 分钟。四条线各自在涨，但管的事不一样：
 *
 *   时长越来越长 —— 后面的波要给玩家足够长的时间去适应新的配比，前面的波则要快速翻页，
 *   开局两分钟里连过三波，玩家立刻知道"这个游戏是一波一波的"。
 *
 *   出兵目标从 400 涨到 750 —— 这是场上完整敌人的目标数，也就是"围着我的人有多少"。离线
 *   空跑一整局（玩家一直在走、开自动攻击）实测场上人数正是跟着它走的：414 → 750。
 *
 *   全图预算从 900 涨到 1200 封顶 —— 屏幕外那片人海有多厚，也是帧耗时的大头，所以涨得最
 *   保守，顶格就是全局的日常预算（battle.ts 的 TARGET_WORLD_ENEMIES），模板不许突破。
 *
 *   密度决定的是**空档多快补回来**，不是场上有多少人（那是出兵目标的事）。参照系是玩家的
 *   清场速度：同一次离线空跑里，玩家每秒杀掉约 44 个。密度低于它，人海就一直是被凿开的；
 *   到第七、八波追平，杀出来的口子当场就被填上 —— 这才是"杀不完"。
 *
 *   爆兵跟着一起涨，它是每一波的开场白：在开波那一刻场上人数的基础上再压一层。
 */
export const DEFAULT_SPAWN_TEMPLATE: SpawnTemplate = {
  name: '默认八波',
  after: 'hold',
  waves: [
    {
      duration: 60, surge: 60, surgeTime: 1.5, density: 10, crowd: 400, world: 900, bosses: 0,
      // 第一波只有两种配色的杂兵：这一分钟是让玩家认清"什么是一个敌人"，混兵会盖掉这件事。
      mix: { thug: 0.6, peasant: 0.4 },
    },
    {
      duration: 90, surge: 90, surgeTime: 1.5, density: 14, crowd: 460, world: 950, bosses: 0,
      // 长枪兵进场。他最好认（枪最长），所以第一个混进来的是他。
      mix: { thug: 0.45, peasant: 0.25, spearman: 0.3 },
    },
    {
      duration: 120, surge: 120, surgeTime: 1.8, density: 18, crowd: 520, world: 1000, bosses: 0,
      mix: { thug: 0.3, peasant: 0.2, spearman: 0.35, shieldman: 0.15 },
    },
    {
      duration: 150, surge: 150, surgeTime: 1.8, density: 24, crowd: 580, world: 1050, bosses: 0,
      // 弓手进场。远程会改变走位，所以放在中段、且比例压得低。
      mix: { thug: 0.25, peasant: 0.15, spearman: 0.3, shieldman: 0.2, archer: 0.1 },
    },
    {
      duration: 180, surge: 180, surgeTime: 2, density: 30, crowd: 620, world: 1100, bosses: 0,
      mix: { thug: 0.2, peasant: 0.1, spearman: 0.3, shieldman: 0.25, archer: 0.15 },
    },
    {
      duration: 210, surge: 220, surgeTime: 2, density: 36, crowd: 660, world: 1150, bosses: 0,
      mix: { thug: 0.15, peasant: 0.1, spearman: 0.3, shieldman: 0.28, archer: 0.17 },
    },
    {
      duration: 240, surge: 260, surgeTime: 2.2, density: 44, crowd: 700, world: 1200, bosses: 0,
      mix: { thug: 0.12, peasant: 0.08, spearman: 0.3, shieldman: 0.3, archer: 0.2 },
    },
    {
      duration: 270, surge: 300, surgeTime: 2.5, density: 52, crowd: 750, world: 1200, bosses: 0,
      // 弓手封顶 0.2：再往上，场上一百多张弓同时开火，玩家是被看不见的箭磨死的，不是被围死的。
      mix: { thug: 0.1, peasant: 0.05, spearman: 0.3, shieldman: 0.35, archer: 0.2 },
    },
  ],
};

/**
 * 按模板发号施令的那个人：只管时间和配额，不碰世界。
 *
 * 把它单独拿出来是为了能在 node 里空跑一整局验证节奏（tools/ 下的离线脚本就是这么用的），
 * 不必先有相机和地形。
 */
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
  private roll: { kind: EnemyKind; upTo: number }[] = [];
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
  pick(random: () => number = Math.random): EnemyKind {
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
    for (const kind of EnemyKinds) {
      const weight = wave.mix[kind.id] ?? 0;
      if (weight <= 0) continue;
      this.rollTotal += weight;
      this.roll.push({ kind, upTo: this.rollTotal });
    }
    // 模板把一波的比例写空了（或者全写成 0）就退回全兵种等概率，总比一个也生不出来强。
    if (this.roll.length === 0) {
      for (const kind of EnemyKinds) {
        this.rollTotal += 1;
        this.roll.push({ kind, upTo: this.rollTotal });
      }
    }
  }
}
