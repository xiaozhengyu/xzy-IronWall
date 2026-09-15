import experienceFrameUrl from '../../assets/hud/role/experience-bar-frame.png';
import statusBarFrameUrl from '../../assets/hud/role/status-bar-frame.png';
import type { HudText } from './text/hudText';
import './hudPlayerPanel.css';

export interface HudPlayerPanelOptions {
  level?: number;
  health?: number;
  maxHealth?: number;
  mana?: number;
  maxMana?: number;
  experience?: number;
  maxExperience?: number;
}

type PlayerBar = {
  root: HTMLDivElement;
  value: HTMLSpanElement;
};

/**
 * 血条、蓝条、等级、经验这几个数值视图的所有者。
 *
 * **它自己不是一块面板** —— 没有外框，也没有一个属于它的容器。正式 HUD 把这五个视图分放在
 * 两个地方（战斗栏和资源栏，见 mountSections），所以这个类存在的意义只剩"谁来建、谁来刷"。
 *
 * 原来它是一块完整的面板：一个九宫格外框，左边一张人物半身像，右边名字和等级。那一整套
 * 从来没进过画面 —— 它的 root 一次都没有被 append 过，setAvatar 也没有任何人调；每一局里
 * 建出来的是一块外框、一张空画布和一张盖在空画布上的头像框贴图，然后原地等着被垃圾回收。
 * 真正在画面上的只有被 mountSections 搬走的那五个视图。所以那一套连同 avatar-frame.png
 * 一起删了，留下的就是这个名字有点名不副实的类。
 */
export class HudPlayerPanel {
  private readonly text: HudText;
  private readonly levelElement = document.createElement('span');
  private readonly experienceValue = document.createElement('span');
  private readonly experienceBar = document.createElement('div');
  private readonly healthBar: PlayerBar;
  private readonly manaBar: PlayerBar;
  private level = 1;
  private health = 0;
  private maxHealth = 1;
  private mana = 0;
  private maxMana = 1;
  private experience = 0;
  private maxExperience = 1;

  constructor(text: HudText, options: HudPlayerPanelOptions = {}) {
    this.text = text;

    this.healthBar = this.createStatusBar('health');
    this.manaBar = this.createStatusBar('mana');
    this.levelElement.className = 'hud-text hud-text--pixel hud-player-level';

    this.experienceBar.className = 'hud-player-experience-bar';
    const experienceClip = document.createElement('div');
    experienceClip.className = 'hud-player-experience-clip';
    const experienceFill = document.createElement('span');
    experienceFill.className = 'hud-player-experience-fill';
    experienceClip.append(experienceFill);
    this.experienceBar.append(experienceClip,
      this.createFrameImage(experienceFrameUrl, 'hud-player-experience-frame'));

    this.experienceValue.className = 'hud-text hud-text--pixel hud-player-experience-value';

    // 这几个视图先无主地挂在这儿，由 mountSections 分发到战斗栏和资源栏。面板自己不再有
    // 容器 —— 它现在只是这五个视图的所有者，见类头上那段说明。
    this.setLevel(options.level ?? 1);
    this.setHealth(options.health ?? 0, options.maxHealth ?? 1);
    this.setMana(options.mana ?? 0, options.maxMana ?? 1);
    this.setExperience(options.experience ?? 0, options.maxExperience ?? 1);
    this.refreshText();
    text.onChange(() => this.refreshText());
  }
  /** 正式 HUD 将同一套数值视图分放在战斗栏和资源栏，更新接口保持一致。 */
  mountSections(vitals: HTMLElement, progression: HTMLElement): void {
    vitals.append(this.healthBar.root, this.manaBar.root);
    this.experienceBar.appendChild(this.levelElement);
    progression.append(this.experienceBar, this.experienceValue);
  }

  setLevel(level: number): void {
    this.level = this.normalizeCount(level, 1);
    this.refreshText();
  }

  /**
   * 这三个 set 每帧都会被 Hud.draw 调一遍，但血量一秒里变不了几次。
   *
   * 数值没变就直接回去：一次 refreshBar 是三笔 DOM 写入（自定义属性、文字、aria-label），
   * 而写自定义属性会让这一枝的样式失效，等于每帧白白让浏览器重算一次 HUD 的样式。
   * 换语言走的是 refreshText，那条路照旧无条件刷新，所以这里的提前返回不会让文案卡住。
   */
  setHealth(value: number, maximum: number): void {
    const [health, maxHealth] = this.normalizeRange(value, maximum);
    if (health === this.health && maxHealth === this.maxHealth) return;
    this.health = health;
    this.maxHealth = maxHealth;
    this.refreshBar(this.healthBar, this.health, this.maxHealth, 'health');
  }

  setMana(value: number, maximum: number): void {
    const [mana, maxMana] = this.normalizeRange(value, maximum);
    if (mana === this.mana && maxMana === this.maxMana) return;
    this.mana = mana;
    this.maxMana = maxMana;
    this.refreshBar(this.manaBar, this.mana, this.maxMana, 'mana');
  }

  setExperience(value: number, maximum: number): void {
    const [experience, maxExperience] = this.normalizeRange(value, maximum);
    if (experience === this.experience && maxExperience === this.maxExperience) return;
    this.experience = experience;
    this.maxExperience = maxExperience;
    const ratio = this.experience / this.maxExperience;
    this.experienceBar.style.setProperty('--hud-player-experience', `${ratio * 100}%`);
    this.refreshText();
  }

  private createStatusBar(kind: 'health' | 'mana'): PlayerBar {
    const root = document.createElement('div');
    root.className = `hud-player-status-bar hud-player-status-bar--${kind}`;
    const clip = document.createElement('div');
    clip.className = 'hud-player-status-clip';
    const fill = document.createElement('div');
    fill.className = 'hud-player-status-fill';
    clip.append(fill);
    const value = document.createElement('span');
    value.className = 'hud-text hud-text--pixel hud-player-status-value';
    root.append(clip, value, this.createFrameImage(statusBarFrameUrl, 'hud-player-status-frame'));
    return { root, value };
  }

  private createFrameImage(source: string, className: string): HTMLImageElement {
    const image = document.createElement('img');
    image.className = className;
    image.src = source;
    image.alt = '';
    image.draggable = false;
    return image;
  }

  private refreshBar(bar: PlayerBar, value: number, maximum: number, kind: 'health' | 'mana'): void {
    bar.root.style.setProperty('--hud-player-status-progress', `${value / maximum * 100}%`);
    bar.value.textContent = `${kind === 'health' ? 'HP' : 'MP'} ${value} / ${maximum}`;
    bar.root.setAttribute('aria-label', this.text.value(kind, { value, maximum }));
  }

  private refreshText(): void {
    this.levelElement.textContent = this.text.value('playerLevel', { level: this.level });
    this.refreshBar(this.healthBar, this.health, this.maxHealth, 'health');
    this.refreshBar(this.manaBar, this.mana, this.maxMana, 'mana');
    this.experienceValue.textContent = this.text.value('experienceValue', {
      value: this.experience.toLocaleString('en-US'),
      maximum: this.maxExperience.toLocaleString('en-US'),
    });
    this.experienceValue.setAttribute('aria-label', this.text.value('experience', {
      value: this.experience,
      maximum: this.maxExperience,
    }));
  }

  private normalizeRange(value: number, maximum: number): [number, number] {
    const safeMaximum = this.normalizeCount(maximum, 1);
    return [Math.min(safeMaximum, this.normalizeCount(value, 0)), safeMaximum];
  }

  private normalizeCount(value: number, fallback: number): number {
    return Math.max(0, Math.floor(Number.isFinite(value) ? value : fallback));
  }
}
