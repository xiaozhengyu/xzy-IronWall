import skill01Url from '../../assets/hud/item/skill/skill-01.png';
import skill03Url from '../../assets/hud/item/skill/skill-03.png';
import skill05Url from '../../assets/hud/item/skill/skill-05.png';
import skill08Url from '../../assets/hud/item/skill/skill-08.png';
import skill09Url from '../../assets/hud/item/skill/skill-09.png';
import type { SkillId } from '../game/skills';
import type { HudText } from './text/hudText';
import type { HudTextKey } from './text/hudText.types';
import { createHudSkillLevel } from './hudSkillLevel';
import './hudCooldownPanel.css';

type CooldownEntryDefinition = {
  id: SkillId;
  icon: string;
  label: HudTextKey;
};

type CooldownEntryView = {
  root: HTMLElement;
  value: HTMLSpanElement;
  lastValue: string;
  /** 上一次写进 DOM 的那几笔。这几个方法每帧都会被调，值不变就不该再写。 */
  lastStep: number;
  lastActive: boolean;
  lastVisible: boolean | null;
};

type ActiveTimedEffect = HudTimedEffect & {
  remaining: number;
  view: CooldownEntryView;
};

export interface HudTimedEffect {
  id: string;
  icon: string;
  label: string;
  duration: number;
}

/** 冷却进度写进 CSS 前量化到多少档。见 updateEntry。 */
const COOLDOWN_STEPS = 128;

export const HUD_COOLDOWN_SKILLS: readonly CooldownEntryDefinition[] = [
  { id: 'sweep', icon: skill01Url, label: 'skillSweep' },
  { id: 'spin', icon: skill09Url, label: 'skillSpin' },
  { id: 'wave', icon: skill03Url, label: 'skillWave' },
  { id: 'heavenSplit', icon: skill05Url, label: 'skillHeavenSplit' },
  { id: 'skyArrow', icon: skill08Url, label: 'skillSkyArrow' },
];

/** 左下角的动态技能与药效 CD 汇总面板。 */
export class HudCooldownPanel {
  readonly root = document.createElement('section');

  private readonly content = document.createElement('div');
  private readonly skillContent = document.createElement('div');
  private readonly effectContent = document.createElement('div');
  private readonly skillViews = new Map<SkillId, CooldownEntryView>();
  private readonly effects = new Map<string, ActiveTimedEffect>();

  constructor(text: HudText) {
    this.root.className = 'hud-cooldown-panel';
    this.content.className = 'hud-cooldown-panel-content';
    this.skillContent.className = 'hud-cooldown-panel-group hud-cooldown-panel-group--skills';
    this.effectContent.className = 'hud-cooldown-panel-group hud-cooldown-panel-group--effects';
    this.effectContent.hidden = true;
    text.bindAttribute(this.root, 'aria-label', 'cooldownPanel');
    this.content.append(this.skillContent, this.effectContent);
    this.root.appendChild(this.content);

    for (const definition of HUD_COOLDOWN_SKILLS) {
      const view = this.createEntry(definition.icon, text.value(definition.label), true);
      const name = view.root.querySelector('.hud-cooldown-entry-name') as HTMLElement;
      text.bindText(name, definition.label);
      view.root.hidden = true;
      this.skillViews.set(definition.id, view);
      this.skillContent.appendChild(view.root);
    }
  }

  setSkillState(id: SkillId, visible: boolean, remaining: number, duration: number): void {
    const view = this.skillViews.get(id);
    if (!view) return;
    if (view.lastVisible !== visible) {
      view.lastVisible = visible;
      view.root.hidden = !visible;
    }
    this.updateEntry(view, remaining, duration);
  }

  activateTimedEffect(effect: HudTimedEffect): void {
    const duration = Number.isFinite(effect.duration) ? Math.max(0, effect.duration) : 0;
    if (duration <= 0) return;
    const existing = this.effects.get(effect.id);
    if (existing) {
      existing.remaining = duration;
      existing.duration = duration;
      existing.label = effect.label;
      this.updateEntry(existing.view, duration, duration);
      return;
    }

    const view = this.createEntry(effect.icon, effect.label);
    view.root.classList.add('hud-cooldown-entry--effect');
    this.effectContent.hidden = false;
    this.effectContent.appendChild(view.root);
    this.effects.set(effect.id, { ...effect, duration, remaining: duration, view });
    this.updateEntry(view, duration, duration);
  }

  update(dt: number): void {
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (elapsed <= 0) return;
    for (const [id, effect] of this.effects) {
      effect.remaining = Math.max(0, effect.remaining - elapsed);
      if (this.updateEntry(effect.view, effect.remaining, effect.duration)) continue;
      effect.view.root.remove();
      this.effects.delete(id);
    }
    this.effectContent.hidden = this.effects.size === 0;
  }

  private createEntry(iconUrl: string, label: string, showLevel = false): CooldownEntryView {
    const root = document.createElement('div');
    root.className = 'hud-cooldown-entry';
    root.setAttribute('aria-label', label);

    const icon = document.createElement('img');
    icon.className = 'hud-cooldown-entry-icon';
    icon.src = iconUrl;
    icon.alt = '';
    icon.draggable = false;

    const mask = document.createElement('span');
    mask.className = 'hud-cooldown-entry-mask';
    const value = document.createElement('span');
    value.className = 'hud-text hud-text--pixel hud-cooldown-entry-value';
    const name = document.createElement('span');
    name.className = 'hud-text hud-text--pixel hud-cooldown-entry-name';
    name.textContent = label;
    root.append(icon, mask, value, name);
    if (showLevel) {
      root.classList.add('hud-cooldown-entry--skill');
      root.appendChild(createHudSkillLevel(undefined, undefined, 'hud-cooldown-entry-levels'));
    }
    return { root, value, lastValue: '', lastStep: -1, lastActive: false, lastVisible: null };
  }

  private updateEntry(view: CooldownEntryView, remaining: number, duration: number): boolean {
    const safeRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
    const ratio = safeDuration > 0 ? Math.min(1, safeRemaining / safeDuration) : 0;

    // 和技能格一样：进度量化到 1/128 再写，否则每帧五个条目各让一枝样式失效一次。
    const step = Math.round(ratio * COOLDOWN_STEPS);
    if (step !== view.lastStep) {
      view.lastStep = step;
      view.root.style.setProperty('--hud-cooldown-ratio', String(step / COOLDOWN_STEPS));
    }
    const active = ratio > 0;
    if (active !== view.lastActive) {
      view.lastActive = active;
      view.root.classList.toggle('hud-cooldown-entry--active', active);
    }

    const value = ratio > 0
      ? (safeRemaining >= 10 ? String(Math.ceil(safeRemaining)) : safeRemaining.toFixed(1))
      : '';
    if (value !== view.lastValue) {
      view.lastValue = value;
      view.value.textContent = value;
    }
    return ratio > 0;
  }
}
