/**
 * 商店的货架。三档东西，三种花钱的形状。
 *
 *   根基   永久属性，**全账号共享**。金币本来就是一个公共池，按角色分的话四个角色等于四条
 *          独立的长线，而练满一个角色已经要八十五万经验了。
 *   师承   某一招的**初始等级**。买到 +3，那一招无论什么时候到手都从四级起步 —— 对自带的
 *          自动攻击技就是开局直接四级，对抽来的招是抽到那一刻就已经练过了。
 *   补给   一次性的符，游戏里打不出来，买一次用一局。
 *
 * 为什么补给不跟着前两档翻十倍：它自己会消耗掉。翻十倍之后一张符要两三局的收入，而那样
 * "用完就没、下一局再买"的循环就转不起来了 —— 那条循环才是它存在的理由。
 *
 * 定价的尺子是**打满一局约 635 枚金币**（演武荒原，按出兵预算倒推）。中途退出刷金币是亏的：
 * 金币按击杀给，而清场速度随波次涨得比时长快，刷前三波的效率只有打满一局的四分之一。
 */

import type { StatKey } from './types';
import { Skills, type SkillId } from '../game/skills';
import { SPRINT_SKILL } from '../game/skillLoadout';

/** 一项根基。三级，每级 +3%，满级 +9%。 */
export interface RootDef {
  key: StatKey;
  name: string;
  /** 每一级加多少，乘算。 */
  perRank: number;
  /** 第 1/2/3 级各多少钱。 */
  prices: readonly number[];
}

/**
 * 根基能买的六项。
 *
 * 没有暴击：那一项目前在 feat/hero-identity 分支上，主干的 UnitStats 里还没有它。
 * 分支合进来之后在这里添一行就行，别的地方一行都不用改 —— 整张表是数据，界面按它长。
 * 现在的第六项是攻击范围，它是主干上真实存在、而且玩家确实能感觉到的一项。
 */
export const Roots: readonly RootDef[] = [
  { key: 'maxHp', name: '生命', perRank: 0.03, prices: [1500, 3000, 4500] },
  { key: 'attack', name: '进攻', perRank: 0.03, prices: [1500, 3000, 4500] },
  { key: 'defense', name: '防御', perRank: 0.03, prices: [1500, 3000, 4500] },
  { key: 'moveSpeed', name: '速度', perRank: 0.03, prices: [1500, 3000, 4500] },
  { key: 'attackSpeed', name: '敏捷', perRank: 0.03, prices: [1500, 3000, 4500] },
  { key: 'attackRange', name: '范围', perRank: 0.03, prices: [1500, 3000, 4500] },
];

export const ROOT_MAX_RANK = 3;

/**
 * 师承：第 1/2/3 级各多少钱。
 *
 * 不限制能买几招 —— 价格本身就是闸。一招买到 +3 是三万一，而打满一局六百多，没有人会把
 * 十招都堆上去。限制一个数量反而要在界面上解释"为什么这一格不让买"。
 */
export const MASTERY_PRICES: readonly number[] = [4000, 9000, 18000];
export const MASTERY_MAX = 3;

/** 补给：商店独有的符，买一次用一局。id 对应 data/pickups.ts 里 weight 为 0 的那四张。 */
export interface SupplyDef {
  id: string;
  price: number;
}

export const Supplies: readonly SupplyDef[] = [
  { id: 'charm-rage', price: 350 },
  { id: 'charm-gale', price: 250 },
  { id: 'charm-aegis', price: 400 },
  { id: 'charm-fortune', price: 300 },
];

/** 一种补给最多屯几个。四个快捷栏格子，屯多了进去也摆不下。 */
export const SUPPLY_MAX = 4;

/** 聚宝符：金币掉落翻几倍。 */
export const FORTUNE_COIN_MULTIPLIER = 2;

/** 第 rank 级（从 1 数起）的价钱。买不起或者满了返回 null。 */
export function rootPrice(def: RootDef, owned: number): number | null {
  return owned >= ROOT_MAX_RANK ? null : def.prices[owned];
}

export function masteryPrice(owned: number): number | null {
  return owned >= MASTERY_MAX ? null : MASTERY_PRICES[owned];
}

/** 这一招买到 owned 级之后，它的起始等级是多少。 */
export const startLevelOf = (owned: number): number => 1 + Math.max(0, Math.min(MASTERY_MAX, owned));

/**
 * 师承能买的招：除了疾走以外全部。
 *
 * 从 Skills 表里现算而不是手写一份清单：加一个新招（比如分支上那两个），货架自己就长出来了。
 * 疾走不在里面 —— 它不分级，也不进牌库。
 */
export const masterySkills = (): SkillId[] =>
  Skills.filter((skill) => skill.id !== SPRINT_SKILL).map((skill) => skill.id);
