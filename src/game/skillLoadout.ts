import {
  SkillCategoryRules,
  Skills,
  skillById,
  skillsInCategory,
  type SkillDef,
  type SkillId,
} from './skills';

/** 主动槽与键位一一对应；UI、输入和战斗逻辑都从这里读，避免各写一份顺序。 */
export const ACTIVE_SKILL_KEYS = ['Q', 'W', 'E', 'R'] as const;
export const ACTIVE_SKILL_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'] as const;
export type ActiveSkillSlot = 0 | 1 | 2 | 3;

export interface SkillLoadoutSnapshot {
  attack: SkillId;
  projectiles: SkillId[];
  guard: SkillId | null;
  active: (SkillId | null)[];
  equipped: SkillId[];
  cooldowns: Record<SkillId, number>;
}

const cooldownTable = (): Record<SkillId, number> =>
  Object.fromEntries(Skills.map((skill) => [skill.id, 0])) as Record<SkillId, number>;

/**
 * 技能装备与独立冷却。
 *
 * - attack / guard 由类别规则保证单选；选择新的会替换旧的。
 * - projectile 是集合，可同时装备并各走自己的冷却。
 * - active 放进四个有顺序的主动槽，由 Q/W/E/R 触发。
 *
 * Battle 只问“这一项是否装备、是否冷却完”，不再自己维护互斥规则。以后加新技能时，通常只需
 * 在 skills.ts 登记 category 与 cooldown；只在出现全新结算形状时才需要扩展 Battle.castSkill。
 */
export class SkillLoadout {
  attackSkill: SkillId = 'wave';
  guardSkill: SkillId | null = 'ironBody';
  readonly projectileSkills = new Set<SkillId>(['heavenSplit', 'skyArrow']);
  readonly activeSkillSlots: (SkillId | null)[] = ['lunge', 'aegis', 'dharma', null];

  private readonly cooldowns = cooldownTable();

  snapshot(): SkillLoadoutSnapshot {
    return {
      attack: this.attackSkill,
      projectiles: [...this.projectileSkills],
      guard: this.guardSkill,
      active: [...this.activeSkillSlots],
      equipped: Skills.filter((skill) => this.isEquipped(skill.id)).map((skill) => skill.id),
      cooldowns: { ...this.cooldowns },
    };
  }

  isEquipped(id: SkillId): boolean {
    const skill = skillById(id);
    switch (skill.category) {
      case 'attack':
        return this.attackSkill === id;
      case 'projectile':
        return this.projectileSkills.has(id);
      case 'guard':
        return this.guardSkill === id;
      case 'active':
        return this.activeSkillSlots.includes(id);
    }
  }

  /** 明确设置装备状态；返回 false 表示类别规则不允许（例如卸下唯一的自动攻击或主动槽已满）。 */
  setEquipped(id: SkillId, enabled: boolean): boolean {
    const skill = skillById(id);
    switch (skill.category) {
      case 'attack':
        if (!enabled) return false;
        this.attackSkill = id;
        return true;

      case 'projectile':
        if (enabled) this.projectileSkills.add(id);
        else this.projectileSkills.delete(id);
        return true;

      case 'guard':
        if (enabled) this.guardSkill = id;
        else if (this.guardSkill === id) this.guardSkill = null;
        return true;

      case 'active': {
        const current = this.activeSkillSlots.indexOf(id);
        if (!enabled) {
          if (current >= 0) this.activeSkillSlots[current] = null;
          return true;
        }
        if (current >= 0) return true;
        const empty = this.activeSkillSlots.indexOf(null);
        if (empty < 0) return false;
        this.activeSkillSlots[empty] = id;
        return true;
      }
    }
  }

  toggle(id: SkillId): boolean {
    const skill = skillById(id);
    if (skill.category === 'attack') return this.setEquipped(id, true);
    return this.setEquipped(id, !this.isEquipped(id));
  }

  /** 把主动技能放到指定键位；同一技能换槽时会先从旧槽移走。 */
  assignActive(slot: ActiveSkillSlot, id: SkillId | null): boolean {
    if (slot < 0 || slot >= this.activeSkillSlots.length) return false;
    if (id === null) {
      this.activeSkillSlots[slot] = null;
      return true;
    }
    if (skillById(id).category !== 'active') return false;
    const old = this.activeSkillSlots.indexOf(id);
    if (old >= 0) this.activeSkillSlots[old] = null;
    this.activeSkillSlots[slot] = id;
    return true;
  }

  cycleAttack(): void {
    const attacks = skillsInCategory('attack');
    const current = attacks.findIndex((skill) => skill.id === this.attackSkill);
    this.attackSkill = attacks[(current + 1 + attacks.length) % attacks.length].id;
  }

  automaticSkills(): SkillDef[] {
    return Skills.filter(
      (skill) =>
        SkillCategoryRules[skill.category].trigger === 'automatic' && this.isEquipped(skill.id),
    );
  }

  tick(dt: number): void {
    for (const skill of Skills) {
      this.cooldowns[skill.id] = Math.max(0, this.cooldowns[skill.id] - dt);
    }
  }

  ready(id: SkillId): boolean {
    return this.cooldowns[id] <= 0;
  }

  consume(id: SkillId): void {
    this.cooldowns[id] = skillById(id).cooldown;
  }

  cooldownOf(id: SkillId): number {
    return this.cooldowns[id];
  }

  resetCooldowns(): void {
    for (const skill of Skills) this.cooldowns[skill.id] = 0;
  }
}
