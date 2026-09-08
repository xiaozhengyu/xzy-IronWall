import skillFrameLeftUrl from '../../assets/hud/skill/skill-frame-left.png';
import skillFrameMiddleUrl from '../../assets/hud/skill/skill-frame-middle.png';
import skillFrameRightUrl from '../../assets/hud/skill/skill-frame-right.png';
import pill01Url from '../../assets/hud/item/pill/pill-01.png';
import pill02Url from '../../assets/hud/item/pill/pill-02.png';
import skill01Url from '../../assets/hud/item/skill/skill-01.png';
import skill06Url from '../../assets/hud/item/skill/skill-06.png';
import skill07Url from '../../assets/hud/item/skill/skill-07.png';
import talisman01Url from '../../assets/hud/item/talisman/talisman-01.png';
import talisman02Url from '../../assets/hud/item/talisman/talisman-02.png';
import type { SkillId } from '../game/skills';
import type { HudText } from './text/hudText';
import type { HudTextKey } from './text/hudText.types';
import { createHudSkillLevel } from './hudSkillLevel';
import './hudQuickbar.css';

export interface HudQuickSlotOptions {
  key: string;
  icon?: string;
  label: HudTextKey;
  emptyLabel?: HudTextKey;
  id?: string;
  count?: number;
  effectDuration?: number;
}

export interface HudQuickbarOptions {
  skills?: readonly HudQuickSlotOptions[];
  items?: readonly HudQuickSlotOptions[];
}

/** 冷却进度写进 CSS 前量化到多少档。见 setSkillCooldown。 */
const COOLDOWN_STEPS = 128;

type HudQuickSlotView = {
  root: HTMLElement;
  icon: HTMLImageElement | null;
  name: HTMLSpanElement | null;
  levels: HTMLElement | null;
  cooldown: HTMLSpanElement | null;
  cooldownValue: HTMLSpanElement | null;
  countValue: HTMLSpanElement | null;
  lastCooldownText: string;
  /** 上一次写进 CSS 的冷却进度，量化过；见 setSkillCooldown。 */
  lastCooldownStep: number;
  lastCooling: boolean;
  skillId: SkillId | null | undefined;
};

type HudItemSlot = {
  view: HudQuickSlotView;
  options: HudQuickSlotOptions;
  count: number;
};

export interface HudQuickbarItemUse {
  id: string;
  icon: string;
  label: string;
  duration: number;
}

const DEFAULT_SKILLS: readonly HudQuickSlotOptions[] = [
  { key: 'Q', icon: skill01Url, label: 'activeSkillSlot' },
  { key: 'W', icon: skill06Url, label: 'activeSkillSlot' },
  { key: 'E', icon: skill07Url, label: 'activeSkillSlot' },
  { key: 'R', label: 'activeSkillSlot', emptyLabel: 'emptyActiveSkillSlot' },
];

const ACTIVE_SKILL_PRESENTATION: Partial<Record<SkillId, { icon: string; name: HudTextKey }>> = {
  lunge: { icon: skill01Url, name: 'skillLunge' },
  aegis: { icon: skill06Url, name: 'skillAegis' },
  dharma: { icon: skill07Url, name: 'skillDharma' },
};

const DEFAULT_ITEMS: readonly HudQuickSlotOptions[] = [
  { key: '1', id: 'pill-01', icon: pill01Url, label: 'itemSlot', count: 3, effectDuration: 8 },
  { key: '2', id: 'pill-02', icon: pill02Url, label: 'itemSlot', count: 3, effectDuration: 10 },
  { key: '3', id: 'talisman-01', icon: talisman01Url, label: 'itemSlot', count: 2, effectDuration: 12 },
  { key: '4', id: 'talisman-02', icon: talisman02Url, label: 'itemSlot', count: 2, effectDuration: 14 },
];

/** 底部快捷栏的纯显示组件；技能和物品逻辑接入时只需更新各槽位图标与状态。 */
export class HudQuickbar {
  readonly root = document.createElement('div');
  readonly skillGroup = document.createElement('div');
  readonly itemGroup = document.createElement('div');

  private readonly skillSlots: HudQuickSlotView[] = [];
  private readonly itemSlots: HudItemSlot[] = [];
  private readonly text: HudText;

  constructor(text: HudText, options: HudQuickbarOptions = {}) {
    this.text = text;
    this.root.className = 'hud-quickbar';
    this.skillGroup.className = 'hud-quickbar-group hud-quickbar-group--skills';
    this.itemGroup.className = 'hud-quickbar-group hud-quickbar-group--items';
    text.bindAttribute(this.skillGroup, 'aria-label', 'activeSkills');
    text.bindAttribute(this.itemGroup, 'aria-label', 'itemQuickbar');

    const skills = options.skills ?? DEFAULT_SKILLS;
    const items = options.items ?? DEFAULT_ITEMS;
    for (let index = 0; index < skills.length; index++) {
      const view = this.createSlot(text, skills[index], index, skills.length, true);
      this.skillSlots.push(view);
      this.skillGroup.appendChild(view.root);
    }
    for (let index = 0; index < items.length; index++) {
      const view = this.createSlot(text, items[index], index, items.length, false);
      const count = Math.max(0, Math.floor(items[index].count ?? 0));
      this.itemSlots.push({ view, options: items[index], count });
      this.refreshItemCount(this.itemSlots[index]);
      this.itemGroup.appendChild(view.root);
    }
    this.root.append(this.skillGroup, this.itemGroup);
    text.onChange(() => {
      for (const slot of this.skillSlots) this.refreshSkillPresentation(slot);
    });
  }

  setSkill(index: number, id: SkillId | null): void {
    const slot = this.skillSlots[index];
    if (!slot || slot.skillId === id) return;
    slot.skillId = id;
    this.refreshSkillPresentation(slot);
  }

  setSkillCooldown(index: number, remaining: number, total: number): void {
    const slot = this.skillSlots[index];
    if (!slot?.cooldown || !slot.cooldownValue) return;
    const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
    const safeRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    const ratio = safeTotal > 0 ? Math.min(1, safeRemaining / safeTotal) : 0;

    // 进度量化到 1/128 再写。
    //
    // 这个方法每帧被调四次，而写自定义属性不管值变没变都会让这一格的样式失效。一个六秒的
    // 技能每帧只走 0.3%，量化之后大约三帧才真的写一次，而 1/128 换算到格子上是半个像素 ——
    // 扫过去的那道暗边照样是连续的。
    const step = Math.round(ratio * COOLDOWN_STEPS);
    if (step !== slot.lastCooldownStep) {
      slot.lastCooldownStep = step;
      slot.root.style.setProperty('--hud-quick-slot-cooldown', String(step / COOLDOWN_STEPS));
    }
    const cooling = ratio > 0;
    if (cooling !== slot.lastCooling) {
      slot.lastCooling = cooling;
      slot.root.classList.toggle('hud-quick-slot--cooling', cooling);
    }

    const cooldownText = cooling
      ? (safeRemaining >= 10 ? String(Math.ceil(safeRemaining)) : safeRemaining.toFixed(1))
      : '';
    if (slot.lastCooldownText === cooldownText) return;
    slot.lastCooldownText = cooldownText;
    slot.cooldownValue.textContent = cooldownText;
  }

  consumeItem(index: number): HudQuickbarItemUse | null {
    const item = this.itemSlots[index];
    const icon = item?.options.icon;
    const duration = item?.options.effectDuration ?? 0;
    if (!item || !icon || item.count <= 0 || duration <= 0) return null;
    item.count--;
    this.refreshItemCount(item);
    return {
      id: item.options.id ?? `item-${index + 1}`,
      icon,
      label: this.text.value('itemEffect', { key: item.options.key }),
      duration,
    };
  }

  private createSlot(text: HudText, options: HudQuickSlotOptions, index: number, count: number,
    skill: boolean): HudQuickSlotView {
    const slot = document.createElement('div');
    const framePart = index === 0 ? 'left' : index === count - 1 ? 'right' : 'middle';
    slot.className = `hud-quick-slot hud-quick-slot--${framePart}`;
    const label = options.icon ? options.label : options.emptyLabel ?? options.label;
    text.bindAttribute(slot, 'aria-label', label, () => ({ key: options.key }));

    const body = document.createElement('span');
    body.className = 'hud-quick-slot-body';
    slot.appendChild(body);

    let icon: HTMLImageElement | null = null;
    if (options.icon || skill) {
      icon = document.createElement('img');
      icon.className = 'hud-quick-slot-icon';
      if (options.icon) icon.src = options.icon;
      icon.alt = '';
      icon.draggable = false;
      icon.hidden = !options.icon;
      slot.appendChild(icon);
    }
    if (!options.icon) {
      slot.classList.add('hud-quick-slot--empty');
    }

    let name: HTMLSpanElement | null = null;
    let levels: HTMLElement | null = null;
    let cooldown: HTMLSpanElement | null = null;
    let cooldownValue: HTMLSpanElement | null = null;
    let countValue: HTMLSpanElement | null = null;
    if (skill) {
      name = document.createElement('span');
      name.className = 'hud-text hud-text--pixel hud-quick-slot-name';
      name.hidden = true;
      levels = createHudSkillLevel(undefined, undefined, 'hud-quick-slot-levels');
      levels.hidden = true;
      cooldown = document.createElement('span');
      cooldown.className = 'hud-quick-slot-cooldown';
      cooldownValue = document.createElement('span');
      cooldownValue.className = 'hud-text hud-text--pixel hud-quick-slot-cooldown-value';
      slot.append(cooldown, cooldownValue, name, levels);
    } else if (options.icon) {
      countValue = document.createElement('span');
      countValue.className = 'hud-text hud-text--pixel hud-quick-slot-count';
      slot.appendChild(countValue);
    }

    const frame = document.createElement('img');
    frame.className = 'hud-quick-slot-frame';
    frame.src = framePart === 'left'
      ? skillFrameLeftUrl
      : framePart === 'right' ? skillFrameRightUrl : skillFrameMiddleUrl;
    frame.alt = '';
    frame.draggable = false;

    const key = document.createElement('span');
    key.className = 'hud-text hud-text--pixel hud-quick-slot-key';
    key.textContent = options.key;
    slot.append(frame, key);
    return {
      root: slot,
      icon,
      name,
      levels,
      cooldown,
      cooldownValue,
      countValue,
      lastCooldownText: '',
      lastCooldownStep: -1,
      lastCooling: false,
      skillId: undefined,
    };
  }

  private refreshSkillPresentation(slot: HudQuickSlotView): void {
    const presentation = slot.skillId ? ACTIVE_SKILL_PRESENTATION[slot.skillId] : undefined;
    if (slot.icon) {
      slot.icon.hidden = !presentation;
      if (presentation) slot.icon.src = presentation.icon;
    }
    if (slot.name) {
      slot.name.hidden = !presentation;
      slot.name.textContent = presentation ? this.text.value(presentation.name) : '';
    }
    if (slot.levels) slot.levels.hidden = !presentation;
    slot.root.classList.toggle('hud-quick-slot--empty', !presentation);
  }

  private refreshItemCount(item: HudItemSlot): void {
    if (item.view.countValue) item.view.countValue.textContent = String(item.count);
    item.view.root.classList.toggle('hud-quick-slot--depleted', item.count <= 0);
  }
}
