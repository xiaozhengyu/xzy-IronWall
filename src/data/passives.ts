/**
 * 被动技能的加成表。
 *
 * 每个角色默认自带一个，卸不掉，也不占主动槽。它在画面上几乎什么都不做 —— 内容全在这张表
 * 里：一包乘算的属性加成，而且**随玩家等级一起长**。
 *
 * 为什么要跟着等级长：一个一级时 +12% 的被动，如果到三十级还是 +12%，那么练级越久它越不
 * 值钱，最后变成一条谁也不看的说明文字。跟着长之后它才一直是这个角色身上的一部分。
 *
 * 加成的大头落在攻击力、攻击范围、攻击频率这三项上 —— 这三项是被动真正能改变手感的地方。
 * 血和防御也能加（磐石就加），但那是"更耐打"，不是"打起来不一样"。
 *
 * 技能的名字和说明在 skills.ts 那条 SkillDef 上，这里只有数。
 */

import type { SkillId } from '../game/skills';
import type { PassiveDef } from './types';

export const Passives: readonly PassiveDef[] = [
  {
    // 双锤武将。攻守都沾一点，和他"站在人堆中间"的打法一致。
    id: 'ironBody',
    bonus: { defense: 0.12, maxHp: 0.06, attack: 0.06 },
    perLevel: { defense: 0.006, maxHp: 0.004, attack: 0.004 },
  },
  {
    // 骑士。最能挨的那一个，代价是这条被动一点攻击都不给。
    id: 'bulwark',
    bonus: { defense: 0.18, maxHp: 0.12, attackRange: 0.02 },
    perLevel: { defense: 0.009, maxHp: 0.007, attackRange: 0.001 },
  },
  {
    // 披风剑士。范围加得最多 —— 他的破空是按 attackRange 折算射程的，所以这一项在他身上
    // 是双份的收益：既够得更远，波也飞得更远。
    id: 'keenEdge',
    bonus: { attack: 0.14, attackRange: 0.08 },
    perLevel: { attack: 0.008, attackRange: 0.005 },
  },
  {
    // 骠骑将军。频率和移动，两样都是"更快"，和他冲进去再冲出来的打法对得上。
    id: 'swiftStrike',
    bonus: { attackSpeed: 0.15, moveSpeed: 0.06, attack: 0.05 },
    perLevel: { attackSpeed: 0.008, moveSpeed: 0.003, attack: 0.003 },
  },
];

const byId = new Map<SkillId, PassiveDef>(Passives.map((passive) => [passive.id, passive]));

/** 没有这条被动就返回 null —— 不是所有护身技都得是被动加成，以后可能有别的形状。 */
export const passiveById = (id: SkillId | null): PassiveDef | null =>
  (id ? byId.get(id) ?? null : null);
