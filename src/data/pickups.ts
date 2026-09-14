/**
 * 敌人掉落的药和符。
 *
 * 以前快捷栏上那四格是**写死的存货**（三颗红药、三颗蓝药、两张符），一进游戏就在手里。那是
 * 摆界面用的假数据：玩家没做任何事就拿到了，用完也永远回不来。现在四格开局全是 0，全靠敌人
 * 掉 —— 和金币同一个量级的概率，见 balance.ts 的 PICKUP_DROP_CHANCE。
 *
 * 两类东西回答两个不同的问题：
 *
 *   药   把血和蓝补回来。分**立刻一口**（restore）和**慢慢回**（regen）两种：前者救命，后者
 *        总量更大但要几秒才给完，血快空的时候救不了你。
 *   符   接下来这十几秒要打得更凶 —— 一包乘算加成，到点就没。
 *
 * **这个文件不 import 图片。** 图在 src/items/pickupIcons.ts 那边按 id 配 —— 战斗那一侧要读
 * 这张表（掉落、结算），而它得能在 node 里空跑，png 进来就跑不动了。
 */

import type { StatBonus } from './types';

export type PickupKind = 'potion' | 'charm';

export interface PickupDef {
  id: string;
  name: string;
  kind: PickupKind;
  /** 界面上那行小字。 */
  note: string;
  /** 掉落权重，相对值。四种加起来才是 PICKUP_DROP_CHANCE 那一份。 */
  weight: number;
  /**
   * 药：立刻回多少，按**上限的比例**给。
   *
   * 按比例不按绝对值：血量上限从一级的一千二长到满级的两千三，再加护身技和属性卡，绝对值
   * 定的药到后期就是一口不痛不痒的水。
   */
  restore?: { hp?: number; mp?: number };
  /**
   * 药：**每秒**回多少，同样按上限的比例。配 duration 一起用。
   *
   * 和 restore 是两种药，不是一个字段的两种写法：restore 是"现在就要活下去"，一口下去立刻
   * 回一截；regen 是"接下来这几秒稳住"，总量更大但摊开给。血快空的时候前者救命，后者救不了；
   * 而在还有余裕时用后者更划算 —— 这个取舍正是两种药并存的理由。
   */
  regen?: { hp?: number; mp?: number };
  /** 符：一包乘算加成，和属性卡走同一条路（applyBonuses）。 */
  buff?: StatBonus;
  /** 符生效多久，秒。药是 0。 */
  duration: number;
}

export const Pickups: readonly PickupDef[] = [
  {
    id: 'potion-hp',
    name: '回血丹',
    note: '立刻回三成生命',
    kind: 'potion',
    // 血比蓝值钱，所以掉得少一点。
    weight: 0.9,
    restore: { hp: 0.3 },
    duration: 0,
  },
  {
    id: 'potion-mp',
    name: '回蓝丹',
    note: '立刻回四成法力',
    kind: 'potion',
    weight: 1.1,
    restore: { mp: 0.4 },
    duration: 0,
  },
  {
    /*
     * 续命丹：八秒里每秒回 4.5%，一共三成六。
     *
     * 总量比回血丹（立刻三成）多一点，但要八秒才给完 —— 这是它的全部代价。血剩一丝的时候
     * 它救不了你，而在还撑得住的时候它比回血丹划算。两种药的取舍就在这一条上。
     */
    id: 'potion-hp-over-time',
    name: '续命丹',
    note: '8 秒内每秒回 4.5% 生命',
    kind: 'potion',
    weight: 0.8,
    regen: { hp: 0.045 },
    duration: 8,
  },
  {
    // 凝神丹。回蓝的那一支同理，总量比凝神一口（四成）多，但摊在八秒里。
    id: 'potion-mp-over-time',
    name: '凝神丹',
    note: '8 秒内每秒回 6% 法力',
    kind: 'potion',
    weight: 0.9,
    regen: { mp: 0.06 },
    duration: 8,
  },
  {
    /*
     * 疾行符：跑得快、打得狠。
     *
     * 两样捆在一起而不是各出一张符，是因为单独的"+18% 移动速度"读起来不像一件值得捡的东西。
     * 一张符要能改变接下来十几秒怎么打 —— 这一张说的是"冲进去"。
     */
    id: 'charm-swift',
    name: '疾行符',
    note: '12 秒内移动速度 +18%，攻击力 +15%',
    kind: 'charm',
    weight: 1,
    buff: { moveSpeed: 0.18, attack: 0.15 },
    duration: 12,
  },
  {
    /*
     * 坚壁符：多一层血，多一管蓝。
     *
     * 上限涨出来的那一截**当场补满**（见 Battle.applyPickup），所以它同时也是半瓶药 —— 一张
     * 撑过一波的符，而不是一张"等你掉血了才有用"的符。到期时上限缩回去，血跟着夹住。
     */
    id: 'charm-ward',
    name: '坚壁符',
    note: '15 秒内生命与法力上限 +25%，涨出来的当场补满',
    kind: 'charm',
    weight: 1,
    buff: { maxHp: 0.25, maxMp: 0.25 },
    duration: 15,
  },
  /*
   * 下面四张是**商店独有**的。游戏里打不出来（weight 给 0，摧掉落那一摧永远摧不到它们），
   * 买一次用一局，用完就没了。
   *
   * 为什么要有这一档：存档里别的东西都是**只涨不降**的（根基、师承、等级），而一个只涨不降
   * 的商店总有一天会被买空，之后金币又回到没有出口的状态。耗品这一档是唯一一个能一直转的循环。
   *
   * 它们比打得出来的那几张狠，但都带代价或者很短 —— 花钱买的应该是"这一局我想怎么打"，
   * 不是"花钱买一层保险"。
   */
  {
    id: 'charm-rage',
    name: '狂暴符',
    note: '15 秒内攻击力 +40%，防御 −25%',
    kind: 'charm',
    weight: 0,
    buff: { attack: 0.4, defense: -0.25 },
    duration: 15,
  },
  {
    id: 'charm-gale',
    name: '疾风符',
    note: '15 秒内移动速度 +35%，出手频率 +20%',
    kind: 'charm',
    weight: 0,
    buff: { moveSpeed: 0.35, attackSpeed: 0.2 },
    duration: 15,
  },
  {
    /*
     * 金身符：十秒里基本打不死。
     *
     * 用生命上限而不是另开一个"无敌"开关：上限翻到六倍并且当场补满，到期缩回去时血跟着
     * 夹住（applyPickup 里已经有这一条）—— 符一掉你就回到原来那点血，读起来是"刚才那十秒
     * 是借的"。真的无敌会让玩家学到"按下去就不用走位"。
     */
    id: 'charm-aegis',
    name: '金身符',
    note: '10 秒内生命上限 ×6，涨出来的当场补满',
    kind: 'charm',
    weight: 0,
    buff: { maxHp: 5 },
    duration: 10,
  },
  {
    // 聚宝符：一整局金币翻倍。它把"这一局多投三百"变成一个赌注，而不只是一次消耗。
    // 持续时间给一个很大的数：一局最长二十来分钟，这一张该盖整局。
    id: 'charm-fortune',
    name: '聚宝符',
    note: '本局金币掉落翻倍',
    kind: 'charm',
    weight: 0,
    buff: {},
    duration: 3600,
  },
];

/**
 * 一格最多摞多少件。
 *
 * 摞满了就**不再掉**（见 Battle.itemsFull），不是掉了再丢掉 —— 后者会让玩家一直看到自己捡不
 * 起来的东西。九件是因为格子右下角只放得下一位数。
 */
export const ITEM_STACK_MAX = 9;

/**
 * 快捷栏有几格。
 *
 * 格位**不和物品绑定**：先捡到的先占前面的格子（见 Battle.takeItem）。以后药和符会越加越多，
 * 钉死格位就意味着永远只有前四种能被拿到。四格装的是"这一局你身上有什么"，不是一张固定的
 * 清单；格子占满时新的那一件留在草地上。
 */
export const ITEM_SLOT_COUNT = 4;

/** 慢慢回那种药多久跳一次，秒。一秒一跳：跳得太密飘字连成一串，太疏又读不出它还在回。 */
export const REGEN_TICK = 1;

export const pickupById = (id: string): PickupDef | null =>
  Pickups.find((entry) => entry.id === id) ?? null;

/** 按权重摇一件。掉落那一侧只问"这次掉什么"，不关心权重怎么排的。 */
/**
 * 首领掉的那一件从这几样里摧。
 *
 * 一波才一个首领，而他要砍十来刀 —— 掉出一颗回血丹和砸一个篝火没区别的话，那十刀就白砍了。
 * 这四样都是"持续一段时间"的：两种慢回的丹、两种符。一口闷的那两种留给篝火。
 */
const BOSS_PICKUP_IDS: readonly string[] = [
  'potion-hp-over-time',
  'potion-mp-over-time',
  'charm-swift',
  'charm-ward',
];

/** 首领掉的那一件。保底掉，所以这里不掷"掉不掉"，只掷"掉哪一件"。 */
export function rollBossPickup(random: () => number = Math.random): PickupDef {
  const pool = Pickups.filter((entry) => BOSS_PICKUP_IDS.includes(entry.id));
  let total = 0;
  for (const entry of pool) total += entry.weight;
  let at = random() * total;
  for (const entry of pool) {
    at -= entry.weight;
    if (at <= 0) return entry;
  }
  return pool[pool.length - 1];
}

export function rollPickup(random: () => number = Math.random): PickupDef {
  let total = 0;
  for (const entry of Pickups) total += entry.weight;
  let at = random() * total;
  for (const entry of Pickups) {
    at -= entry.weight;
    if (at <= 0) return entry;
  }
  return Pickups[Pickups.length - 1];
}
