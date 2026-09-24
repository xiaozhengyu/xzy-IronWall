/**
 * 出兵模板：一局的节奏写成数据，换地图就换这一张表。
 *
 * 这个文件只描述"什么时候、放多少、放什么"，一个人也不放 —— 真正的落点、朝向和回收全在
 * battle.ts，按模板发号施令的那个人在 game/waves.ts。分开的理由是这几件事的改动频率差着
 * 一个数量级：调难度是天天要动的数值，而出怪点怎么算是几个月才碰一次的机制。
 *
 * 兵种**有多强**也不在这里，在 units.ts。模板只按 id 配比例，所以改一个兵种的血量不用碰
 * 任何一张出兵表，反过来也一样。第几波的敌人比第一波强多少是全局曲线，在 balance.ts。
 */

import type { EnemyKindId } from './units';

/** 兵种比例。权重是相对的，不必加起来等于 1；没写的兵种这一波就不出。 */
export type EnemyMix = Partial<Record<EnemyKindId, number>>;

export type SpawnPattern = 'surround' | 'forward-pressure' | 'side-pressure' | 'mixed' | 'final';

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
  /** 这一波出哪些兵、各占多少。 */
  mix: EnemyMix;
  /** 地图 encounter 选择这一波的空间出生策略。 */
  spawnPattern: SpawnPattern;
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
 * 四条线各自在涨，但管的事不一样：
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
      duration: 45, surge: 18, surgeTime: 1.5, density: 4, crowd: 110, world: 320, spawnPattern: 'surround',
      // 第一波只有两种配色的杂兵：这一分钟是让玩家认清"什么是一个敌人"，混兵会盖掉这件事。
      mix: { thug: 0.6, peasant: 0.4 },
    },
    {
      duration: 65, surge: 31, surgeTime: 1.5, density: 6, crowd: 138, world: 359, spawnPattern: 'forward-pressure',
      // 长枪兵进场。他最好认（枪最长），所以第一个混进来的是他。
      mix: { thug: 0.45, peasant: 0.25, spearman: 0.3 },
    },
    {
      duration: 85, surge: 56, surgeTime: 1.8, density: 10, crowd: 196, world: 439, spawnPattern: 'surround',
      mix: { thug: 0.3, peasant: 0.2, spearman: 0.35, shieldman: 0.15 },
    },
    {
      duration: 110, surge: 91, surgeTime: 1.8, density: 16, crowd: 275, world: 547, spawnPattern: 'side-pressure',
      // 弓手进场。远程会改变走位，所以放在中段、且比例压得低。
      mix: { thug: 0.25, peasant: 0.15, spearman: 0.3, shieldman: 0.2, archer: 0.1 },
    },
    {
      duration: 135, surge: 133, surgeTime: 2, density: 24, crowd: 371, world: 679, spawnPattern: 'side-pressure',
      // 戟兵进场。他和长枪兵、持盾兵是同一类近战，认他靠"举过头顶砸下来"那一下 ——
      // 全场只有他把武器抡到头顶。
      mix: { thug: 0.2, peasant: 0.1, spearman: 0.25, shieldman: 0.2, archer: 0.15, halberdier: 0.1 },
    },
    {
      duration: 160, surge: 183, surgeTime: 2, density: 32, crowd: 484, world: 834, spawnPattern: 'mixed',
      // 骑兵进场。这是全场最响的一次配比变化 —— 他们比所有人高出一半、快出一截，
      // 玩家会先看见一条比人海高一头的天际线压过来。所以比例压得很低（0.08）。
      //
      // 重甲兵也在这一波进来，同样压得很低（0.06）。他是全场唯一不挥武器的人：一排平举的
      // 矛尖在人海里是一组不动的平行线，比例一高，那组线就成了画面的主体。名额从持盾兵和
      // 长枪兵身上匀 —— 三者是同一类"正面顶住"的兵，总量不该跟着变多。
      mix: {
        thug: 0.14, peasant: 0.08, spearman: 0.22, shieldman: 0.18, archer: 0.14,
        halberdier: 0.1, cavalry: 0.08, bulwark: 0.06,
      },
    },
    {
      duration: 190, surge: 238, surgeTime: 2.2, density: 42, crowd: 610, world: 1008, spawnPattern: 'forward-pressure',
      // 枪骑兵和骑射一起进来。到这一波，场上三种骑兵各有各的读法：轻骑最快、枪骑最重、
      // 骑射站得最远。
      mix: {
        thug: 0.09, peasant: 0.06, spearman: 0.18, shieldman: 0.16, archer: 0.13,
        halberdier: 0.1, cavalry: 0.1, lancer: 0.06, horseArcher: 0.04, bulwark: 0.08,
      },
    },
    {
      duration: 215, surge: 300, surgeTime: 2.5, density: 52, crowd: 750, world: 1200, spawnPattern: 'final',
      // 弓手（含骑射）合计封顶 0.2：再往上，场上一百多张弓同时开火，玩家是被看不见的箭
      // 磨死的，不是被围死的。骑兵合计封顶 0.24 —— 他们又高又快，比例再高，人海就读不成
      // 人海了，读成一支冲锋的骑兵队。
      mix: {
        thug: 0.06, peasant: 0.03, spearman: 0.17, shieldman: 0.15, archer: 0.14,
        halberdier: 0.11, cavalry: 0.12, lancer: 0.06, horseArcher: 0.06, bulwark: 0.1,
      },
    },
  ],
};

/**
 * 这张模板打到第 n 波**结束**时，一共会放出多少人。n 从 1 数起，超出就算整张表。
 *
 * 一波的出兵量是"开波爆兵 + 持续密度 × 这一波的时长"，也就是模板自己写着的那两个数。它不是
 * 实际击杀数（场上有人数上限、有回收、玩家也不是每个都杀得到），但它是**唯一一个纯数据、
 * 不用跑一遍游戏就能算出来的量**，所以拿它当尺子：实际收到多少灵石和它成正比，比例由离线
 * 空跑量出来（见 balance.ts 的 GEMS_PER_SPAWN）。
 *
 * 卡牌节奏靠它：不同模板的波数和出兵量可以差着一截，弹框的
 * 门槛要是写死一个数，短的那张图就永远练不满。
 */
export function spawnsThroughWave(template: SpawnTemplate, wave: number): number {
  const upTo = Math.max(1, Math.min(wave, template.waves.length));
  let total = 0;
  for (let i = 0; i < upTo; i++) {
    const spec = template.waves[i];
    total += spec.surge + spec.density * spec.duration;
  }
  return total;
}
