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
import type { HudText } from './text/hudText';
import type { HudTextKey } from './text/hudText.types';
import './hudQuickbar.css';

export interface HudQuickSlotOptions {
  key: string;
  icon?: string;
  label: HudTextKey;
  emptyLabel?: HudTextKey;
}

export interface HudQuickbarOptions {
  skills?: readonly HudQuickSlotOptions[];
  items?: readonly HudQuickSlotOptions[];
}

type HudQuickSlotView = {
  root: HTMLElement;
  cooldown: HTMLSpanElement | null;
  cooldownValue: HTMLSpanElement | null;
  lastCooldownText: string;
};

const DEFAULT_SKILLS: readonly HudQuickSlotOptions[] = [
  { key: 'Q', icon: skill01Url, label: 'activeSkillSlot' },
  { key: 'W', icon: skill06Url, label: 'activeSkillSlot' },
  { key: 'E', icon: skill07Url, label: 'activeSkillSlot' },
  { key: 'R', label: 'activeSkillSlot', emptyLabel: 'emptyActiveSkillSlot' },
];

const DEFAULT_ITEMS: readonly HudQuickSlotOptions[] = [
  { key: '1', icon: pill01Url, label: 'itemSlot' },
  { key: '2', icon: pill02Url, label: 'itemSlot' },
  { key: '3', icon: talisman01Url, label: 'itemSlot' },
  { key: '4', icon: talisman02Url, label: 'itemSlot' },
];

/** 底部快捷栏的纯显示组件；技能和物品逻辑接入时只需更新各槽位图标与状态。 */
export class HudQuickbar {
  readonly root = document.createElement('div');
  readonly skillGroup = document.createElement('div');
  readonly itemGroup = document.createElement('div');

  private readonly skillSlots: HudQuickSlotView[] = [];

  constructor(text: HudText, options: HudQuickbarOptions = {}) {
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
      this.itemGroup.appendChild(this.createSlot(text, items[index], index, items.length, false).root);
    }
    this.root.append(this.skillGroup, this.itemGroup);
  }

  setSkillCooldown(index: number, remaining: number, total: number): void {
    const slot = this.skillSlots[index];
    if (!slot?.cooldown || !slot.cooldownValue) return;
    const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
    const safeRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    const ratio = safeTotal > 0 ? Math.min(1, safeRemaining / safeTotal) : 0;
    slot.root.style.setProperty('--hud-quick-slot-cooldown', String(ratio));
    slot.root.classList.toggle('hud-quick-slot--cooling', ratio > 0);
    const cooldownText = ratio > 0
      ? (safeRemaining >= 10 ? String(Math.ceil(safeRemaining)) : safeRemaining.toFixed(1))
      : '';
    if (slot.lastCooldownText === cooldownText) return;
    slot.lastCooldownText = cooldownText;
    slot.cooldownValue.textContent = cooldownText;
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

    if (options.icon) {
      const icon = document.createElement('img');
      icon.className = 'hud-quick-slot-icon';
      icon.src = options.icon;
      icon.alt = '';
      icon.draggable = false;
      slot.appendChild(icon);
    } else {
      slot.classList.add('hud-quick-slot--empty');
    }

    let cooldown: HTMLSpanElement | null = null;
    let cooldownValue: HTMLSpanElement | null = null;
    if (skill) {
      cooldown = document.createElement('span');
      cooldown.className = 'hud-quick-slot-cooldown';
      cooldownValue = document.createElement('span');
      cooldownValue.className = 'hud-text hud-text--pixel hud-quick-slot-cooldown-value';
      slot.append(cooldown, cooldownValue);
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
    return { root: slot, cooldown, cooldownValue, lastCooldownText: '' };
  }
}
