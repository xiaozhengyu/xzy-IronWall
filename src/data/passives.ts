/**
 * 被动技能的加成表。
 *
 * 不是每张护身技都在这里：饮血没有属性包，它的效果写在结算那一步（见 LIFESTEAL_PER_LEVEL）。
 *
 * 在这里的那几张在画面上几乎什么都不做 —— 内容全在这张表里：一包乘算的属性加成，
 * 而且**随玩家等级一起长**。
 *
 * 为什么要跟着等级长：一个一级时 +12% 的被动，如果到三十级还是 +12%，那么练级越久它越不
 * 值钱，最后变成一条谁也不看的说明文字。跟着长之后它才一直是这个角色身上的一部分。
 *
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
    /*
     * 骑士。四个护身技里唯一**有画面、会打人**的那个：它还带着几颗绕身飞的流星
     * （见 effects/orbitStars.ts），升一级多一颗。
     *
     * 属性那一包因此压过一档（防御 0.18 → 0.12，生命 0.12 → 0.08）。别的三个护身技全部的
     * 价值都在这包数字里，而它另外还有一整套输出；不压的话它就不是"四选一"，是"正确答案
     * 加三个陪跑"。
     */
    id: 'bulwark',
    bonus: { defense: 0.12, maxHp: 0.08, attackRange: 0.02 },
    perLevel: { defense: 0.006, maxHp: 0.005, attackRange: 0.001 },
  },
];

const byId = new Map<SkillId, PassiveDef>(Passives.map((passive) => [passive.id, passive]));

/** 没有这条被动就返回 null —— 不是所有护身技都得是被动加成，以后可能有别的形状。 */
export const passiveById = (id: SkillId | null): PassiveDef | null =>
  (id ? byId.get(id) ?? null : null);
