/**
 * 备战界面上能选的出战角色，以及他们各自有多强。
 *
 * 这张表接替了 game/roster.ts。搬过来顺手砍掉了两件事：
 *
 *   对 battle.ts 的依赖 —— 原来 HeroDef 用一个下标指 PlayerPresets，于是一张纯数据表反向
 *   依赖了两千五百行的战斗引擎，备战界面只想读一个角色名也得把整个引擎拖进来。而且那张表
 *   "只能往后加"，中间插一条就会把所有角色悄悄换成别人。现在直接写形象的名字。
 *
 *   "一个数值都没有" —— 原来那张表的注释里写着这句，等级、生命、法力在界面上一律显示破折号。
 *   现在每个角色有完整的基础属性和一张成长表。
 *
 * 加一个角色就是往下面这个数组里再加一条：起个 id、挑一份形象、写六项基础属性、挑一种成长
 * 类型、给一个被动，界面和存档会自己长出来（存档按 id 记等级，见 game/profile.ts）。
 */

import type { HeroDef, UnitStats } from './types';

/**
 * 基础属性的基准线，也就是接数据层之前那个写死的玩家。
 *
 * 保留它不只是省字：**双锤武将一级时的手感必须和以前一模一样**。移动速度 32 是原来的
 * PLAYER_SPEED，攻击范围 34 和张角 1.9 是原来挂在 UnitDef 上的武将那两项，攻击频率 1 就是
 * 武器动作本身的节奏（原来的 PLAYER_SWING_GAP 是 0）。加了一层数据不该偷偷改掉基准。
 *
 * 生命是唯一一个大改的：原来是 100 点、敌人每下扣 1 点，也就是能挨一百下。现在伤害是真的
 * 算出来的（杂兵一下打掉八九点），所以上限得抬到一千出头，"能挨一百下"这件事才不变。
 */
const baseline: UnitStats = {
  maxHp: 1200,
  /*
   * 法力。这是这一版新加的一条闸。
   *
   * 100 上限配每秒 9 点回复，等于**十一秒回满**。按这个基准，三个主动技（突进 12、金钟罩
   * 26、天地法相 32）连着放一轮是 70 点，回满那一轮要等八秒 —— 比任何单个技能的冷却都长。
   * 于是"下一招什么时候能放"有了两条独立的闸：冷却管单个技能的间隔，蓝管几个技能加起来的
   * 总量。只有冷却的话，玩家最优解永远是"三个键轮着按"，蓝就是用来否掉那个解的。
   */
  maxMp: 100,
  mpRegen: 9,
  attack: 120,
  defense: 40,
  moveSpeed: 32,
  attackRange: 34,
  attackArc: 1.9,
  attackSpeed: 1,
  // 原来写死在 collectibles.ts 里的 MAGNET_RADIUS。
  pickupRange: 68,
};

const stats = (overrides: Partial<UnitStats>): UnitStats => ({ ...baseline, ...overrides });

export const Heroes: readonly HeroDef[] = [
  {
    id: 'warlord',
    name: '双锤武将',
    tagline: '近身横扫',
    blurb: '两柄重锤扫开身前一片，站在人堆中间也能把人堆推开。',
    archetype: 'balanced',
    appearance: 'warlord',
    // 基准角色：全部落在基线上，别的角色和他比。
    base: stats({}),
    growth: {
      maxHp: 26,
      maxMp: 2.4,
      mpRegen: 0.1,
      attack: 9,
      defense: 1.2,
      moveSpeed: 0.15,
      attackRange: 0.35,
      attackSpeed: 0.012,
      pickupRange: 0.8,
    },
    attackSkill: 'sweep',
    passive: 'ironBody',
  },
  {
    id: 'knight',
    name: '骑士',
    tagline: '持盾破阵',
    blurb: '一手剑一手盾，靠回旋清开贴身的人，再顶着盾冲进下一堆。',
    archetype: 'defense',
    appearance: 'knight',
    // 防御型：血最厚、防御最高，代价是够不远（16 是原来挂在 knight 预设上的那个数）也打不快。
    base: stats({ maxHp: 1600, attack: 95, defense: 60, moveSpeed: 30, attackRange: 16, attackArc: 1.7, attackSpeed: 0.92, maxMp: 120, mpRegen: 8 }),
    growth: {
      maxHp: 42,
      maxMp: 3,
      mpRegen: 0.09,
      attack: 6,
      defense: 2.4,
      moveSpeed: 0.1,
      attackRange: 0.16,
      attackSpeed: 0.008,
      pickupRange: 0.8,
    },
    attackSkill: 'spin',
    passive: 'bulwark',
  },
  {
    id: 'swordsman',
    name: '披风剑士',
    tagline: '远程破空',
    blurb: '出手最远的一个：一道破空推出去，路过的都倒，自己不用挤进人堆。',
    archetype: 'offense',
    appearance: 'hero',
    // 进攻型：攻击力涨得最快，血和防御最薄。他本来也不该挤进人堆。
    base: stats({ maxHp: 900, attack: 105, defense: 30, moveSpeed: 33, attackRange: 16, attackArc: 1.7, pickupRange: 76, maxMp: 110, mpRegen: 11 }),
    growth: {
      maxHp: 20,
      maxMp: 2.8,
      mpRegen: 0.13,
      attack: 12,
      defense: 0.9,
      moveSpeed: 0.18,
      attackRange: 0.2,
      attackSpeed: 0.016,
      pickupRange: 1,
    },
    attackSkill: 'wave',
    passive: 'keenEdge',
  },
  {
    id: 'rider',
    name: '骠骑将军',
    tagline: '马上长枪',
    blurb: '唯一骑马的一个：坐在鞍上比谁都高，枪够得也最远，靠冲进去再冲出来打。',
    archetype: 'speed',
    appearance: 'lancer',
    // 速度型：移动速度长得最快，攻击范围 30 是原来挂在 lancer 预设上的那个数（坐在鞍上，
    // 手离地面本来就远）。
    // 蓝池最小、回得最快：他的打法是冲进去扎一下再冲出来，一局里按突进的次数比谁都多，
    // 吃的是**回复速度**而不是池子大小 —— 池子再大也只是多冲一次，回得快才跟得上这个节奏。
    base: stats({ maxHp: 1000, attack: 110, defense: 35, moveSpeed: 38, attackRange: 30, attackArc: 0.95, attackSpeed: 1.05, pickupRange: 72, maxMp: 90, mpRegen: 15 }),
    growth: {
      maxHp: 22,
      maxMp: 2,
      mpRegen: 0.1,
      attack: 8,
      defense: 1,
      // 三十级是 38 + 0.42 × 29 = 50.2，仍然低于他自己的冲刺（× 1.875 = 71）。速度型是
      // "跑得比别人快"，不是"不需要冲刺"。
      moveSpeed: 0.42,
      attackRange: 0.3,
      attackSpeed: 0.02,
      pickupRange: 1.2,
    },
    attackSkill: 'sweep',
    passive: 'swiftStrike',
  },
];

export function heroById(id: string): HeroDef {
  return Heroes.find((hero) => hero.id === id) ?? Heroes[0];
}

/** 成长类型在界面上显示成什么。 */
export const ARCHETYPE_LABEL: Record<HeroDef['archetype'], string> = {
  offense: '进攻型',
  defense: '防御型',
  speed: '速度型',
  balanced: '均衡型',
};
