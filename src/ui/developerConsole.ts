import type { SkillCategory, SkillId } from '../game/skills';
import type { SkillLoadoutSnapshot } from '../game/skillLoadout';

export interface DeveloperConsoleSkill {
  id: SkillId;
  name: string;
  note: string;
  category: SkillCategory;
  cooldown: number;
}

export interface DeveloperConsolePickup {
  id: string;
  name: string;
  note: string;
}

export interface DeveloperConsoleItemSlot {
  id: string;
  count: number;
}

export interface DeveloperConsoleState {
  skillLoadout: SkillLoadoutSnapshot;
  itemSlots: readonly (DeveloperConsoleItemSlot | null)[];
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  hpLock: number | null;
  mpLock: number | null;
  invincible: boolean;
}

export interface DeveloperConsoleBridge {
  readonly skills: readonly DeveloperConsoleSkill[];
  readonly pickups: readonly DeveloperConsolePickup[];
  read(): DeveloperConsoleState;
  toggleSkill(id: SkillId): boolean;
  resetSkills(): void;
  grantItems(id: string, count: number): number;
  setHpLock(enabled: boolean): void;
  setMpLock(enabled: boolean): void;
  setInvincible(enabled: boolean): void;
  fillHp(): void;
  fillMp(): void;
}

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  attack: '自动攻击',
  projectile: '自动发射',
  guard: '护身技能',
  active: '主动技能',
};

const CATEGORY_ORDER: readonly SkillCategory[] = ['attack', 'projectile', 'guard', 'active'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function controlButton(text: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'menu-btn developer-console-button', text);
  button.addEventListener('click', onClick);
  return button;
}

function section(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', 'developer-console-section');
  root.appendChild(el('h3', 'developer-console-section-title', title));
  const body = el('div', 'developer-console-section-body');
  root.appendChild(body);
  return { root, body };
}

export class DeveloperConsole {
  readonly root = el('section', 'developer-console');

  private readonly bridge: DeveloperConsoleBridge;
  private readonly skillButtons = new Map<SkillId, HTMLButtonElement>();
  private readonly skillSlots = el('div', 'developer-console-skill-slots');
  private readonly itemSelect = el('select', 'developer-console-select');
  private readonly itemCount = el('input', 'developer-console-number') as HTMLInputElement;
  private readonly heldItems = el('div', 'developer-console-held-items');
  private readonly hpValue = el('span', 'developer-console-resource-value');
  private readonly mpValue = el('span', 'developer-console-resource-value');
  private readonly hpLockButton = el('button', 'menu-btn developer-console-button');
  private readonly mpLockButton = el('button', 'menu-btn developer-console-button');
  private readonly invincibleButton = el('button', 'menu-btn developer-console-button');
  private readonly feedback = el('div', 'developer-console-feedback');
  private feedbackText = '';

  constructor(bridge: DeveloperConsoleBridge) {
    this.bridge = bridge;
    this.build();
  }

  refresh(): void {
    const state = this.bridge.read();

    for (const [id, button] of this.skillButtons) {
      const equipped = state.skillLoadout.equipped.includes(id);
      button.classList.toggle('on', equipped);
      button.setAttribute('aria-pressed', String(equipped));
    }

    const active = state.skillLoadout.active
      .map((id, index) => `${['Q', 'W', 'E', 'R'][index]} ${this.skillName(id)}`)
      .join(' · ');
    this.skillSlots.textContent = `主动槽：${active || '空'}`;

    this.heldItems.replaceChildren();
    let heldCount = 0;
    for (const slot of state.itemSlots) {
      if (!slot) continue;
      const pickup = this.bridge.pickups.find((entry) => entry.id === slot.id);
      const tag = el('span', 'developer-console-item-tag', `${pickup?.name ?? slot.id} ×${slot.count}`);
      tag.title = pickup?.note ?? slot.id;
      this.heldItems.appendChild(tag);
      heldCount++;
    }
    if (heldCount === 0) this.heldItems.textContent = '快捷栏为空';

    this.hpValue.textContent = `${Math.max(0, Math.ceil(state.hp))} / ${Math.max(1, Math.ceil(state.maxHp))}`;
    this.mpValue.textContent = `${Math.max(0, Math.ceil(state.mp))} / ${Math.max(1, Math.ceil(state.maxMp))}`;
    this.refreshToggle(this.hpLockButton, state.hpLock !== null,
      state.hpLock === null ? '锁定当前生命' : `生命锁定 ${Math.ceil(state.hpLock)}`);
    this.refreshToggle(this.mpLockButton, state.mpLock !== null,
      state.mpLock === null ? '锁定当前蓝量' : `蓝量锁定 ${Math.ceil(state.mpLock)}`);
    this.refreshToggle(this.invincibleButton, state.invincible, '无敌');
    this.feedback.textContent = this.feedbackText;
  }

  private build(): void {
    const head = el('div', 'developer-console-head');
    const title = el('div', 'developer-console-title', '开发者控制台');
    head.append(title, el('span', 'developer-console-badge', 'DEV ONLY'));
    this.root.appendChild(head);
    this.root.appendChild(el('div', 'developer-console-note', '只影响当前局，不写入存档。'));

    this.buildSkills();
    this.buildItems();
    this.buildResources();
    this.root.appendChild(this.feedback);
  }

  private buildSkills(): void {
    const group = section('技能');
    for (const category of CATEGORY_ORDER) {
      const skills = this.bridge.skills.filter((skill) => skill.category === category && skill.id !== 'sprint');
      if (skills.length === 0) continue;
      const row = el('div', 'developer-console-skill-row');
      row.appendChild(el('span', 'developer-console-label', CATEGORY_LABELS[category]));
      const buttons = el('div', 'developer-console-button-list');
      for (const skill of skills) {
        const button = controlButton(skill.name, () => {
          const changed = this.bridge.toggleSkill(skill.id);
          this.feedbackText = changed ? `${skill.name} 已更新` : `${skill.name} 未能装备：槽位或类别规则不允许`;
          this.refresh();
        });
        button.title = skill.cooldown > 0
          ? `${skill.note} · 冷却 ${skill.cooldown.toFixed(1)} 秒`
          : `${skill.note} · 无冷却`;
        this.skillButtons.set(skill.id, button);
        buttons.appendChild(button);
      }
      row.appendChild(buttons);
      group.body.appendChild(row);
    }

    this.skillSlots.textContent = '主动槽：Q 空 · W 空 · E 空 · R 空';
    group.body.appendChild(this.skillSlots);
    group.body.appendChild(controlButton('恢复默认技能', () => {
      this.bridge.resetSkills();
      this.feedbackText = '已恢复本角色的开局技能方案';
      this.refresh();
    }));
    this.root.appendChild(group.root);
  }

  private buildItems(): void {
    const group = section('道具');
    const form = el('div', 'developer-console-item-form');
    for (const pickup of this.bridge.pickups) {
      const option = el('option') as HTMLOptionElement;
      option.value = pickup.id;
      option.textContent = pickup.name;
      this.itemSelect.appendChild(option);
    }
    this.itemCount.type = 'number';
    this.itemCount.min = '1';
    this.itemCount.max = '9';
    this.itemCount.step = '1';
    this.itemCount.value = '1';
    const grant = controlButton('立即获取', () => {
      const requested = Math.max(1, Math.min(9, Math.floor(Number(this.itemCount.value) || 1)));
      const granted = this.bridge.grantItems(this.itemSelect.value, requested);
      this.feedbackText = granted === requested
        ? `已获取 ${this.itemName(this.itemSelect.value)} ×${granted}`
        : `只获取 ${this.itemName(this.itemSelect.value)} ×${granted}/${requested}，快捷栏容量不足`;
      this.refresh();
    });
    form.append(this.itemSelect, this.itemCount, grant);
    group.body.append(form, this.heldItems);
    this.root.appendChild(group.root);
  }

  private buildResources(): void {
    const group = section('玩家资源');
    const values = el('div', 'developer-console-resource-values');
    const hp = el('div', 'developer-console-resource-row');
    hp.append(el('span', 'developer-console-label', '生命'), this.hpValue);
    const mp = el('div', 'developer-console-resource-row');
    mp.append(el('span', 'developer-console-label', '蓝量'), this.mpValue);
    values.append(hp, mp);

    this.hpLockButton.addEventListener('click', () => {
      this.bridge.setHpLock(this.bridge.read().hpLock === null);
      this.feedbackText = this.bridge.read().hpLock === null ? '已解除生命锁定' : '已锁定当前生命值';
      this.refresh();
    });
    this.mpLockButton.addEventListener('click', () => {
      this.bridge.setMpLock(this.bridge.read().mpLock === null);
      this.feedbackText = this.bridge.read().mpLock === null ? '已解除蓝量锁定' : '已锁定当前蓝量';
      this.refresh();
    });
    this.invincibleButton.addEventListener('click', () => {
      const next = !this.bridge.read().invincible;
      this.bridge.setInvincible(next);
      this.feedbackText = next ? '已开启无敌' : '已关闭无敌';
      this.refresh();
    });

    const buttons = el('div', 'developer-console-button-list');
    buttons.append(
      this.hpLockButton,
      this.mpLockButton,
      controlButton('补满生命', () => {
        this.bridge.fillHp();
        this.feedbackText = '生命已补满';
        this.refresh();
      }),
      controlButton('补满蓝量', () => {
        this.bridge.fillMp();
        this.feedbackText = '蓝量已补满';
        this.refresh();
      }),
      this.invincibleButton,
    );
    group.body.append(values, buttons);
    this.root.appendChild(group.root);
  }

  private refreshToggle(button: HTMLButtonElement, on: boolean, label: string): void {
    button.textContent = label;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }

  private skillName(id: SkillId | null): string {
    if (!id) return '空';
    return this.bridge.skills.find((skill) => skill.id === id)?.name ?? id;
  }

  private itemName(id: string): string {
    return this.bridge.pickups.find((pickup) => pickup.id === id)?.name ?? id;
  }
}
