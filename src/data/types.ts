/**
 * 数据层的全部类型。
 *
 * 这一层只回答"一个东西有多强"，不回答"它长什么样"，也不回答"它这一帧在做什么"。三件事
 * 分给三个地方：
 *
 *   长什么样   UnitDef（characters/unitDef.ts）。武器、盔甲、披风、骑不骑马。
 *   有多强     这里。血、攻、防、速度、范围、频率、拾取。
 *   在做什么   Character（game/character.ts）。坐标、朝向、当前血量、冷却。
 *
 * 之前"有多强"没有自己的位置：attackRange 和 attackArc 挂在 UnitDef 上（那个文件开头写的
 * 是"让一个单位看起来不同于另一个的全部东西"），玩家血量是 battle.ts 里的一个常量，敌人
 * 速度写在出兵表里，而攻击力和防御根本不存在。所以"这个角色有多强"过去没有一个地方可查。
 *
 * 这个文件里一个数都没有 —— 数在 units.ts / heroes.ts / balance.ts 那三张表里。
 */

import type { SkillId } from '../game/skills';
import type { UnitDef, UnitPresetId } from '../characters/unitDef';
import type { CharacterPalette } from '../characters/palette';

// ---------------------------------------------------------------- 属性

/**
 * 一个单位的全部数值。玩家和敌人共用同一份形状 —— 敌人打玩家和玩家打敌人走的是同一个
 * 伤害公式，两边的字段对不上的话公式就得分岔成两条。
 */
export interface UnitStats {
  /** 生命上限。 */
  maxHp: number;
  /**
   * 法力上限。主动技能的开销从这里出。
   *
   * 只有主动技（Q/W/E/R）耗蓝 —— 自动攻击和自动发射不耗，那两样是一直在跑的底噪，给它们
   * 记账等于给"活着"记账。蓝是玩家**主动**按下去的那几下的预算。
   */
  maxMp: number;
  /**
   * 法力每秒回多少。
   *
   * 自动回，不靠捡东西：这是个割草游戏，玩家的手一直在走位和按技能上，再多一种要去捡的
   * 资源就是多一件分心的事。回蓝速度因此就是"主动技能多久能再按一次"的第二条闸，和冷却
   * 并列 —— 冷却管的是单个技能的间隔，蓝管的是几个技能加起来的总量。
   */
  mpRegen: number;
  /** 攻击力。进伤害公式的那个数，不是屏幕上飘的那个。 */
  attack: number;
  /** 防御。按 DEFENSE_SCALE 做递减，见 balance.ts 的 damageAfterDefense。 */
  defense: number;
  /** 移动速度，世界单位每秒。玩家的奔跑速度由它乘 RUN_MULTIPLIER 得到。 */
  moveSpeed: number;
  /** 攻击判定半径，世界单位。技能的 reach 是它的倍数。 */
  attackRange: number;
  /**
   * 攻击判定张角，弧度。
   *
   * 用户列的六项基础属性里没有它，但判定需要它，而且它是**兵种形状**的一部分：长枪兵的
   * 0.9 和持盾兵的 1.5 说的是"这把武器往哪边扫"，不是"这个人有多强"。所以它跟着基础属性
   * 一起放在这里，但**不参与等级成长**（成长表里不写它），免得练到后期一个人扫出一整圈。
   */
  attackArc: number;
  /**
   * 攻击频率，倍率。1 = 武器动作本身的节奏，1.2 = 快两成。
   *
   * 用倍率而不是"间隔秒数"：间隔减到 0 就到顶了，而倍率没有上限，成长和商店都好加。而且
   * 每种武器的动作时长本来就不一样（锤子 0.72 秒一下、拳头 0.38 秒），倍率能同时作用在
   * 它们身上，一个绝对的秒数不能。
   */
  attackSpeed: number;
  /**
   * 暴击率，0.09 = 九成一。技能命中算双倍（见 balance.ts 的 rollDamage）。
   *
   * 以前是两个全局常量，所以四个角色的暴击率一模一样 —— 它在“这个人打起来不一样”
   * 这件事上一点忙都不帮。现在它是一项基础属性，和别的五项一起画在选人界面的六边形上。
   *
   * 不跟等级长：它本身就是一个百分比，每级加一点的话三十级下来会变成“刀刀暴击”，
   * 而那等于把暴击这件事取消了。要涨只能靠属性牌和护身技。
   */
  crit: number;
  /** 拾取范围，世界单位。灵石和金币在这个半径内开始被吸过来。 */
  pickupRange: number;
}

/** UnitStats 的字段名。加成表和成长表都按它开键。 */
export type StatKey = keyof UnitStats;

/**
 * 每级的**绝对**增量。没写的字段就是这一级不长。
 *
 * 用绝对值而不是百分比：百分比在三十级上是复利，末级会比首级高出一个数量级，那时候前面
 * 调过的每一个数都白调了。绝对增量的曲线是直的，一眼能算出满级是多少。
 */
export type StatGrowth = Partial<Record<StatKey, number>>;

/**
 * 乘算的加成，0.08 = +8%。被动技能、地图、商店和局内属性卡都用这一种。
 *
 * 同一项上有多个来源时是**相加再乘一次**（1 + a + b），不是连乘。连乘会让两个 +50% 变成
 * +125%，玩家算不出自己身上到底有多少加成。
 */
export type StatBonus = Partial<Record<StatKey, number>>;

// ---------------------------------------------------------------- 被动技能

/**
 * 被动技能：不用按键、永远生效的一包属性加成。
 *
 * 每个角色默认自带一个，它是这个角色"天生"的那一部分。加成随玩家等级一起长 —— 一个一级
 * 时 +12% 的被动到了三十级还是 +12% 的话，练级越久它越不值钱。
 *
 * 名字和说明不在这里，在 skills.ts 的那条 SkillDef 上：被动技能首先是一个技能，界面上和
 * 别的技能摆在一起（选人界面的技能条、调试菜单的技能列表）。一个东西两张表各写一个名字，
 * 迟早会改出两个不一样的。
 */
export interface PassiveDef {
  id: SkillId;
  /** 1 级时的加成。 */
  bonus: StatBonus;
  /** 每升一级再加多少。最终加成是 bonus + perLevel × (等级 - 1)。 */
  perLevel: StatBonus;
}

// ---------------------------------------------------------------- 角色

/** 成长类型。界面上给玩家看的一个标签，同时也是这张成长表的一句话总结。 */
export type HeroArchetype = 'offense' | 'defense' | 'speed' | 'balanced';

export interface HeroDef {
  id: string;
  name: string;
  /** 一句定位，列表里跟在名字下面。 */
  tagline: string;
  /** 一句玩法介绍，右栏用。 */
  blurb: string;
  archetype: HeroArchetype;

  /**
   * 这个角色长什么样。
   *
   * 以前这里是 `preset: number`，一个指向 battle.ts 里 PlayerPresets 的下标 —— 于是一张
   * 纯数据表反向依赖了两千五百行的战斗引擎，备战界面只想读角色名字也得把整个引擎拖进来，
   * 而且那张表"只能往后加"，中间插一条就会把所有角色换成别人。现在直接给形象的名字。
   */
  appearance: UnitPresetId;

  /** 1 级时的属性。 */
  base: UnitStats;
  /** 每级长多少。不同成长类型的区别全在这张表里。 */
  growth: StatGrowth;

  /**
   * 自动攻击技。**开局唯一带着的招**，也是这个角色的手感基调。
   *
   * 一局是从这一招加一双靴子（疾走）开始的，别的全靠局内抽牌拿。见 game/skillLoadout.ts
   * 的 startRun。
   */
  attackSkill: SkillId;
  /**
   * 开局就戴着的护身技。不写就是没有。
   *
   * 四张护身技（铁布衫、磐石、锋锐、疾锋）**谁都抽得到**，和主动技、发射技一样在同一个
   * 牌库里（见 game/skillLoadout.ts 的 runSkillPool）。以前是一人一张、写死在这张表上的 ——
   * 那意味着用双锤打就永远看不到磐石，而它本来就只是一包属性加成，没有任何理由挂在某一个人名下。
   *
   * 留下这一字段是给**开局太弱**的角色补的一块底：抽到护身技之前那几分钟，角色只有自动攻击技
   * 和一双靴子。别的角色撑得住，骑士撑不住 —— 他的攻击力最低、出手最慢、回旋那个圈只有
   * 二十个单位，开局那几波全靠硬扁。
   *
   * 不是白给：它占掉护身技那唯一一格（见 SkillCategoryRules 的 guard），所以戴着它的人在那一格
   * 上再没有选择；而且它照样要靠抽牌升级，开局带的是一级。
   */
  startGuard?: SkillId;
}

// ---------------------------------------------------------------- 兵种

/**
 * 一个兵种：长相、配色、基础属性三样凑起来。
 *
 * 以前这是 waves.ts 里的 EnemyKind（def + palette + speed）。speed 早就没放进 UnitDef 而是
 * 单独摆在外面 —— 那条缝当时就已经开了一半，现在把剩下的属性一起放进来。
 */
export interface UnitKindDef {
  id: string;
  name: string;
  /** 界面上那行小字。选图时右栏列敌人用。 */
  note: string;
  appearance: UnitPresetId;
  palette: CharacterPalette;
  stats: UnitStats;
  /**
   * 首领。属性和杂兵是同一套字段，只是数大一截，外加一条：**首领不吃波次成长**，它自己
   * 那一档已经把强度写死了。见 balance.ts 的 scaleForWave。
   */
  boss?: boolean;
  /** 杀掉给多少经验。首领给得多。 */
  exp: number;
}

/** 已经解析好的兵种：外观是一份真的 UnitDef，不是一个工厂函数。 */
export interface ResolvedUnitKind {
  id: string;
  def: UnitDef;
  palette: CharacterPalette;
  stats: UnitStats;
  boss: boolean;
  exp: number;
}

// ---------------------------------------------------------------- 地图

/**
 * 一张图对敌人的加成。
 *
 * 地图之间的区别原来只有出兵比例和地形。加上这一层之后，同一个持盾兵在隘口比在荒原更难
 * 推动 —— "这张图难在哪儿"因此有了一个能调的数，而不是只能靠改出兵表。
 *
 * 全是乘数，1 就是不动。默认那张图（演武荒原）应该全填 1：它是基准，别的图和它比。
 */
export interface MapModifier {
  enemyHp: number;
  enemyAttack: number;
  enemyDefense: number;
  enemySpeed: number;
  /**
   * 这张图每多打一波，额外再涨多少（加在全局波次曲线之上）。
   *
   * 分成"一次性倍率"和"每波再加"两笔：前者说的是"这张图的敌人本来就更硬"，后者说的是
   * "这张图越往后越吃力"。隘口两样都有，荒原只有前者（而且是负的）。
   */
  hpPerWave: number;
  defensePerWave: number;
  /** 玩家在这张图上的经验倍率。难的图给得多。 */
  expRate: number;
}

export const NEUTRAL_MODIFIER: MapModifier = {
  enemyHp: 1,
  enemyAttack: 1,
  enemyDefense: 1,
  enemySpeed: 1,
  hpPerWave: 0,
  defensePerWave: 0,
  expRate: 1,
};
