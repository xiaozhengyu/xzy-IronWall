/**
 * 攻击技能：同一套判定和特效，换几种形状。
 *
 * 割草类游戏的群体技能翻来覆去就是四种形状（查了 Dynasty Warriors 系列的招式表，
 * charge attack 那一栏几十个招式都落在这四类里）：
 *
 *   前方扇形   横着扫一刀，眼前一片倒。最基础的那一下。
 *   原地整圈   转一圈把贴身的人全掀开。人被围住时唯一有用的形状。
 *   飞出去的波 一道波沿着朝向跑出去，路过谁谁死。够得最远，但只有一条线。
 *   突进走廊   人自己冲出去，身体扫过的一路全死。位移和杀伤是同一件事。
 *
 * 这个文件只描述形状，不描述强度。**数值全是占位的** —— 冷却、耗蓝、伤害、硬直一个都没有，
 * 碰到就死，和基础攻击的规则完全一致。先把四种形状摆出来看手感，数值等形状定了再谈。
 */

export type SkillId =
  | 'sweep'
  | 'spin'
  | 'wave'
  | 'lunge'
  | 'aegis'
  | 'dharma'
  | 'heavenSplit'
  | 'skyArrow'
  | 'ironBody';

/**
 * 技能放进哪一种槽。类别只规定“能装备几个、由谁触发”，kind 继续规定具体怎么结算。
 * 新技能通常只要在 Skills 里选择一个 category，再实现自己的 kind；装备规则不需要跟着加分支。
 */
export type SkillCategory = 'attack' | 'projectile' | 'guard' | 'active';
export type SkillEquipMode = 'single' | 'multiple' | 'activeSlots';
export type SkillTrigger = 'attack' | 'automatic' | 'passive' | 'manual';

export interface SkillCategoryRule {
  name: string;
  equip: SkillEquipMode;
  trigger: SkillTrigger;
  maxSlots: number;
}

/** 所有类别的兼容规则集中在这里；后续增加类别时，菜单与装备器都会读同一张表。 */
export const SkillCategoryRules: Record<SkillCategory, SkillCategoryRule> = {
  attack: { name: '自动攻击技', equip: 'single', trigger: 'attack', maxSlots: 1 },
  projectile: { name: '发射', equip: 'multiple', trigger: 'automatic', maxSlots: Number.POSITIVE_INFINITY },
  guard: { name: '护身', equip: 'single', trigger: 'passive', maxSlots: 1 },
  active: { name: '主动技', equip: 'activeSlots', trigger: 'manual', maxSlots: 4 },
};

/**
 * 判定怎么结算。这是三条不同的代码路径，不是三个参数。
 *
 *   instant  发招那一帧一次算清（和基础攻击同一条路，见 combat.ts 顶上那段）。
 *   wave     波跨帧向前推进，每帧结算它**这一帧扫过**的那圈人。
 *   lunge    人跨帧向前冲，每帧结算身体**这一帧碰到**的人。
 *   aura     一个罩子跟着人走，持续若干秒，每帧结算**碰到罩子**的人。
 */
export type SkillKind = 'instant' | 'wave' | 'lunge' | 'aura' | 'dharma' | 'heavenSplit' | 'skyArrow' | 'passive';

export interface SkillDef {
  id: SkillId;
  /** 菜单上显示的名字。 */
  name: string;
  /** 菜单上那行小字，说明它是什么形状。 */
  note: string;
  category: SkillCategory;
  kind: SkillKind;
  /**
   * 判定够多远，按施放者自己的 attackRange 的倍数。
   *
   * 用倍数而不是绝对值：范围本来就是兵种的属性（武将 34、杂兵 11），技能只说"比平时远
   * 多少"。这样换个兵种放同一个技能，远近关系仍然成立。
   */
  reach: number;
  /** 判定张角，弧度。null = 用兵种自己的 attackArc。 */
  arc: number | null;
  /** wave / lunge 持续多久，秒。instant 用不上。 */
  duration: number;
  /**
   * 打中时溅多少碎片。1 = 只飙血，2 = 血加甲片。
   *
   * 这是"平砍"和"技能"在画面上唯一的区别 —— 现有技能都是碰到就死，但一发破空该看着比一次
   * 横扫更碎。等以后真要分强弱，这个数是第一个该跟着技能走的。
   */
  power: number;
  /**
   * 这项技能再次可用前要等多久，秒。每个技能都有自己独立的运行时计时器。
   *
   * 自动攻击类会把它加在武器动作时长之后；自动发射和主动技则从发动时刻直接计时。
   * 位移大、覆盖广的招该等得久一点 —— 突进一下就跨过大半个屏幕，冷却太短等于一直在瞬移。
   */
  cooldown: number;
  /**
   * 收招时在落点补一圈，半径按施放者 attackRange 的倍数。0 = 不补。
   *
   * 只有突进用。冲过去之后原地炸一圈，把冲刺走廊两侧漏掉的人一起带走 —— 冲锋本来就该以
   * "撞进人堆里停下"收尾，而不是穿过去就没事了。
   */
  finishRing: number;
}

export const Skills: SkillDef[] = [
  {
    id: 'sweep',
    name: '横扫',
    note: '前方扇形，一次算清',
    category: 'attack',
    kind: 'instant',
    reach: 1,
    arc: null,
    duration: 0,
    // 横扫就是基础那一下，不该有"打碎了"的表现。
    power: 1,
    cooldown: 0,
    finishRing: 0,
  },
  {
    id: 'spin',
    name: '回旋',
    note: '原地整圈，被围住时用',
    category: 'attack',
    kind: 'instant',
    // 整圈换来的代价是够不远：同样一刀的力气摊到四面八方，只能覆盖贴身那一圈。
    //
    // 1.25 看着比"够不远"大，是因为它现在是**判定**半径，而画面上那圈会按 SKILL_HIT_MARGIN
    // 缩进去一点。修掉画面比判定大三成四那个 bug 之前，玩家看到的圈本来就是这么大。
    reach: 1.25,
    arc: Math.PI * 2,
    duration: 0,
    power: 2,
    cooldown: 0.25,
    finishRing: 0,
  },
  {
    id: 'wave',
    name: '破空',
    note: '波向前飞，路过就死',
    category: 'attack',
    kind: 'wave',
    // 够得最远，但只有一条窄带。远近和宽窄是这一套技能里唯一真正的取舍。
    reach: 4.5,
    arc: 0.9,
    duration: 0.55,
    power: 2,
    cooldown: 0.45,
    finishRing: 0,
  },
  {
    id: 'lunge',
    name: '突进',
    note: '向前冲，撞到的全死',
    category: 'active',
    kind: 'lunge',
    // lunge 的 reach 不是判定距离而是**冲多远**：判定跟着身体走，宽度就是人的宽度。
    reach: 3.2,
    arc: null,
    duration: 0.22,
    power: 2,
    // 一下跨过大半个屏幕，不该和平砍同一个频率 —— 那等于玩家一直在瞬移。
    cooldown: 1.5,
    // 冲到头再炸一圈。
    finishRing: 0.95,
  },
  {
    id: 'aegis',
    name: '金钟罩',
    note: '罩子跟着人走，碰到就飞',
    category: 'active',
    kind: 'aura',
    // 贴身一圈。它换来的不是范围是**时间**：别的招是一瞬间的事，这个能顶几秒。
    reach: 0.95,
    arc: null,
    // 主动开启 2 秒，冷却从按键发动时开始独立计算。
    duration: 2,
    power: 2,
    cooldown: 3.3,
    finishRing: 0,
  },
  {
    id: 'dharma',
    name: '天地法相',
    note: '上半身法相随身转向，罩住自身',
    category: 'active',
    kind: 'dharma',
    reach: 1.2,
    arc: null,
    duration: 2.8,
    power: 2,
    cooldown: 4.3,
    finishRing: 0,
  },
  {
    id: 'heavenSplit',
    name: '开天',
    note: '巨剑沿行走朝向飞出，剑体横扫敌群',
    category: 'projectile',
    kind: 'heavenSplit',
    reach: 3.8,
    arc: null,
    duration: 0.5,
    power: 2,
    cooldown: 1.7,
    finishRing: 0,
  },
  {
    id: 'skyArrow',
    name: '穿云箭',
    note: '冲天后随机落下，落地回旋',
    category: 'projectile',
    kind: 'skyArrow',
    reach: 1.5,
    arc: null,
    duration: 0,
    power: 2,
    cooldown: 1.9,
    finishRing: 0,
  },
  {
    id: 'ironBody',
    name: '铁布衫',
    note: '永久生效，通体呼吸提亮并强化轮廓光',
    category: 'guard',
    kind: 'passive',
    reach: 0,
    arc: null,
    duration: 0,
    power: 0,
    cooldown: 0,
    finishRing: 0,
  },
];

/**
 * 判定半径比画出来的那一圈大多少。
 *
 * 方向是**判定 > 画面**，不能反过来。反过来的后果刚被撞到过：回旋原来的特效同时吃了
 * power(1.34) 和 to(reach)，而推进曲线会把两者相乘 —— 画出来的圈比会杀人的圈大三成四，
 * 于是"环明明扫过去了，圈里还站着人"。
 *
 * 略宽一点是这个工程一贯的取向（见 combat.ts 顶上那段）："擦过去却没死"比"隔着一点空气
 * 死了"难受得多。
 */
export const SKILL_HIT_MARGIN = 1.15;

/**
 * 破空在近处的走廊半宽，世界单位。
 *
 * 敌人之间大约隔 11 个单位，所以 16 是"身前三排都清掉"。见 combat.ts 的 sweptBy。
 */
export const WAVE_NEAR_HALF_WIDTH = 16;

export const skillAt = (index: number): SkillDef => Skills[Math.max(0, Math.min(Skills.length - 1, index))];

export const skillById = (id: SkillId): SkillDef => {
  const skill = Skills.find((entry) => entry.id === id);
  if (!skill) throw new Error(`Unknown skill: ${id}`);
  return skill;
};

export const skillsInCategory = (category: SkillCategory): SkillDef[] =>
  Skills.filter((skill) => skill.category === category);

/** 一个轴对齐的框，世界坐标。就是 BattleView.spawn 那个出货视口。 */
export interface ViewBox {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}

/**
 * 从 (x, y) 朝 heading 走多远才会走出这个框。
 *
 * 标准的射线—轴对齐框求交，只算正方向那一侧。起点在框外时返回 0（贴着地图边缘时会发生：
 * 出货视口被夹在场地内，人可以站在框的边上）。
 */
export function exitDistance(x: number, y: number, heading: number, box: ViewBox): number {
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);

  let t = Infinity;
  if (Math.abs(dx) > 1e-6) {
    const edge = dx > 0 ? box.x + box.halfW : box.x - box.halfW;
    t = Math.min(t, (edge - x) / dx);
  }
  if (Math.abs(dy) > 1e-6) {
    const edge = dy > 0 ? box.y + box.halfH : box.y - box.halfH;
    t = Math.min(t, (edge - y) / dy);
  }
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/**
 * 发射类技能能打多远：名义射程，但**不许打出画面**。
 *
 * 为什么要这条规则：波的射程是按施放者的 attackRange 折算的，武将那一档能到一百六十多个
 * 世界单位，比半个视口还长。打出画面之后玩家看不到自己杀了谁，屏幕外一片人无声消失 ——
 * 那不是爽快，是茫然。而且波会一路飞过整张地图，把还没进过画面的人也清掉，跑步机那套
 * "背后回收、前方多刷"就白做了。
 *
 * 用**出货视口**而不是当前视野：滚轮缩放是调试旋钮，上线后视口固定，技能能打多远不该跟着
 * 调试视角变（和出怪用同一个框、同一个理由，见 BattleView 那段）。
 *
 * 按整个扇面取最小值，不只看正前方：一道斜着放的波，正前方还在画面里，扇面的边角早就出去了。
 *
 * 兜底是施放者自己的 attackRange —— 贴着地图边缘朝外放时，框只剩一点点，再往下夹会让这一招
 * 还不如平砍。打不出画面的前提下，至少得够得着眼前的人。
 */
export function cappedReach(
  x: number,
  y: number,
  heading: number,
  arc: number,
  reach: number,
  floor: number,
  box: ViewBox,
): number {
  const SAMPLES = 5;
  let limit = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const a = heading - arc * 0.5 + (arc * i) / SAMPLES;
    limit = Math.min(limit, exitDistance(x, y, a, box));
  }
  return Math.max(Math.min(reach, limit), Math.min(reach, floor));
}
