/**
 * 敌人掉落的药和符。
 *
 * 以前快捷栏上那四格是**写死的存货**（三颗红药、三颗蓝药、两张符），一进游戏就在手里。那是
 * 摆界面用的假数据：玩家没做任何事就拿到了，用完也永远回不来。现在四格开局全是 0，全靠敌人
 * 掉 —— 和金币同一个量级的概率，见 balance.ts 的 PICKUP_DROP_CHANCE。
 *
 * 两类东西回答两个不同的问题：
 *
 *   药   现在就要活下去 —— 立刻回一截血或蓝，没有持续时间。
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
  /**
   * 占快捷栏第几格，也就是按哪个数字键。0 起步。
   *
   * 固定死而不是按拿到的顺序排：手要记住"一号是回血"，那就不能让它今天在一号明天在三号。
   */
  slot: number;
  /** 掉落权重，相对值。四种加起来才是 PICKUP_DROP_CHANCE 那一份。 */
  weight: number;
  /**
   * 药：立刻回多少，按**上限的比例**给。
   *
   * 按比例不按绝对值：血量上限从一级的一千二长到满级的两千三，再加护身技和属性卡，绝对值
   * 定的药到后期就是一口不痛不痒的水。
   */
  restore?: { hp?: number; mp?: number };
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
    slot: 0,
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
    slot: 1,
    weight: 1.1,
    restore: { mp: 0.4 },
    duration: 0,
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
    slot: 2,
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
    slot: 3,
    weight: 1,
    buff: { maxHp: 0.25, maxMp: 0.25 },
    duration: 15,
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

export const pickupById = (id: string): PickupDef | null =>
  Pickups.find((entry) => entry.id === id) ?? null;

export const pickupAtSlot = (slot: number): PickupDef | null =>
  Pickups.find((entry) => entry.slot === slot) ?? null;

/** 按权重摇一件。掉落那一侧只问"这次掉什么"，不关心权重怎么排的。 */
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
