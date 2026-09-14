import { SKILL_ICONS } from './skillIcons';
import type { SkillId } from '../game/skills';
import type { HudText } from './text/hudText';
import type { HudTextKey } from './text/hudText.types';
import { createHudSkillLevel } from './hudSkillLevel';
import { SKILL_MAX_LEVEL } from '../data/balance';
import './hudCooldownPanel.css';

type CooldownEntryDefinition = {
  id: SkillId;
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
  /** 那一排菱形，以及上一次画到第几颗。没有这一排的条目是 null。 */
  levels: HTMLElement | null;
  lastLevel: number;
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

/**
 * 这一栏里摆的是**不用玩家按的招**：自动攻击技，自动发射技，以及一直生效的护身技。
 *
 * 顺序就是屏幕上从左到右的顺序，而且是有讲究的 —— 前面几个各自有冷却、会一格一格暗下去又
 * 亮回来，最后那个护身技**永远是亮的**（它没有冷却，见 skills.ts）。一排会动的东西末尾压一个
 * 不动的，正好是这一栏和右边药效那一栏之间的分界。
 *
 * 每个角色只会亮其中几个：自动攻击技一人一个，发射技要抽到才有，护身技也是。空的条目直接
 * 收起来（setSkillState 的 visible），所以这一栏的长度就是"我这一局堆了多少被动输出"。
 */
/*
 * 图不写在这张表里，按 id 去 `skillIcons.ts` 取。
 *
 * 它原来自己配一列，而那一列和快捷栏、牌、选人界面都对不上：开天在这儿是 skill-05、在牌上是
 * skill-02，而铁布衫和磐石在这一栏里干脆共用一张。同一招在四个地方长四个样子，而玩家要么
 * 记名字要么记样子 —— 换个界面就不认得了。
 */
export const HUD_COOLDOWN_SKILLS: readonly CooldownEntryDefinition[] = [
  { id: 'sweep', label: 'skillSweep' },
  { id: 'spin', label: 'skillSpin' },
  { id: 'wave', label: 'skillWave' },
  { id: 'heavenSplit', label: 'skillHeavenSplit' },
  { id: 'skyArrow', label: 'skillSkyArrow' },
  // 护身技摆最后，一人一张，抽到之后就一直亮着。
  { id: 'ironBody', label: 'skillIronBody' },
  { id: 'bulwark', label: 'skillBulwark' },
  { id: 'bloodthirst', label: 'skillBloodthirst' },
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
      const view = this.createEntry(SKILL_ICONS[definition.id], text.value(definition.label), true);
      const name = view.root.querySelector('.hud-cooldown-entry-name') as HTMLElement;
      text.bindText(name, definition.label);
      view.root.hidden = true;
      this.skillViews.set(definition.id, view);
      this.skillContent.appendChild(view.root);
    }
  }

  setSkillState(id: SkillId, visible: boolean, remaining: number, duration: number, level = 1): void {
    const view = this.skillViews.get(id);
    if (!view) return;
    // 那一排菱形。只在变了的时候重画 —— 这个方法每帧被调五次，而等级一局只涨三十来次。
    if (view.levels && level !== view.lastLevel) {
      view.lastLevel = level;
      view.levels.replaceChildren(...createHudSkillLevel(level, SKILL_MAX_LEVEL).childNodes);
    }
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

  clearEffects(): void {
    this.effects.clear();
    this.effectContent.replaceChildren();
    this.effectContent.hidden = true;
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
    let levels: HTMLElement | null = null;
    if (showLevel) {
      root.classList.add('hud-cooldown-entry--skill');
      levels = createHudSkillLevel(1, SKILL_MAX_LEVEL, 'hud-cooldown-entry-levels');
      root.appendChild(levels);
    }
    return {
      root, value, lastValue: '', lastStep: -1, lastActive: false, lastVisible: null,
      levels, lastLevel: -1,
    };
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
