import avatarFrameUrl from '../../assets/hud/role/avatar-frame.png';
import experienceFrameUrl from '../../assets/hud/role/experience-bar-frame.png';
import statusBarFrameUrl from '../../assets/hud/role/status-bar-frame.png';
import { drawCharacterUpperBody } from '../characters/renderer';
import type { Character } from '../game/character';
import { v2 } from '../core/math';
import type { Rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import { ShapeBatch, type PrimitiveSink } from '../render/shapeBatch';
import { HudFrame } from './hudFrame';
import type { HudText } from './text/hudText';
import './hudPlayerPanel.css';

export interface HudPlayerPanelOptions {
  className?: string;
  name?: string;
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

class PortraitSink implements PrimitiveSink {
  private readonly context: CanvasRenderingContext2D;

  constructor(context: CanvasRenderingContext2D) {
    this.context = context;
  }

  quad(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    color: Rgba,
  ): void {
    const context = this.context;
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.lineTo(x2, y2);
    context.lineTo(x3, y3);
    context.closePath();
    context.fillStyle = this.color(color);
    context.fill();
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, color: Rgba): void {
    const context = this.context;
    context.beginPath();
    context.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
    context.fillStyle = this.color(color);
    context.fill();
  }

  private color(color: Rgba): string {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
  }
}

/** 纯显示的人物信息面板；数值接入可通过公开的 set 方法完成。 */
export class HudPlayerPanel {
  readonly frame: HudFrame;
  readonly root: HTMLElement;

  private readonly text: HudText;
  private readonly nameElement = document.createElement('span');
  private readonly levelElement = document.createElement('span');
  private readonly experienceValue = document.createElement('span');
  private readonly avatarCanvas = document.createElement('canvas');
  private readonly avatarShapes = new ShapeBatch();
  private readonly avatarSink: PortraitSink;
  private readonly healthBar: PlayerBar;
  private readonly manaBar: PlayerBar;
  private name: string | null;
  private level = 1;
  private health = 0;
  private maxHealth = 1;
  private mana = 0;
  private maxMana = 1;
  private experience = 0;
  private maxExperience = 1;

  constructor(text: HudText, options: HudPlayerPanelOptions = {}) {
    this.text = text;
    this.name = options.name ?? null;
    this.frame = new HudFrame({
      skin: 'frame1',
      className: options.className,
      label: text.value('playerInfo'),
    });
    this.root = this.frame.root;
    this.frame.content.classList.add('hud-player-panel-content');
    text.bindAttribute(this.root, 'aria-label', 'playerInfo');

    const avatar = document.createElement('div');
    avatar.className = 'hud-player-avatar';
    this.avatarCanvas.className = 'hud-player-avatar-canvas';
    this.avatarCanvas.width = 144;
    this.avatarCanvas.height = 128;
    this.avatarCanvas.setAttribute('aria-hidden', 'true');
    const avatarContext = this.avatarCanvas.getContext('2d');
    if (!avatarContext) throw new Error('2D canvas is required for the HUD player portrait');
    avatarContext.imageSmoothingEnabled = false;
    this.avatarSink = new PortraitSink(avatarContext);
    avatar.append(this.avatarCanvas, this.createFrameImage(avatarFrameUrl, 'hud-player-avatar-frame'));

    const header = document.createElement('div');
    header.className = 'hud-player-header';
    this.nameElement.className = 'hud-text hud-text--pixel hud-player-name';
    this.levelElement.className = 'hud-text hud-text--pixel hud-text--gold hud-player-level';
    header.append(this.nameElement, this.levelElement);

    this.healthBar = this.createStatusBar('health');
    this.manaBar = this.createStatusBar('mana');

    const experienceBar = document.createElement('div');
    experienceBar.className = 'hud-player-experience-bar';
    const experienceClip = document.createElement('div');
    experienceClip.className = 'hud-player-experience-clip';
    const experienceFill = document.createElement('span');
    experienceFill.className = 'hud-player-experience-fill';
    experienceClip.append(experienceFill);
    experienceBar.append(experienceClip,
      this.createFrameImage(experienceFrameUrl, 'hud-player-experience-frame'));

    this.experienceValue.className = 'hud-text hud-text--pixel hud-player-experience-value';
    this.frame.content.append(avatar, header, this.healthBar.root, this.manaBar.root,
      experienceBar, this.experienceValue);

    this.setLevel(options.level ?? 22);
    this.setHealth(options.health ?? 268, options.maxHealth ?? 300);
    this.setMana(options.mana ?? 82, options.maxMana ?? 120);
    this.setExperience(options.experience ?? 2845, options.maxExperience ?? 4500);
    this.refreshText();
    text.onChange(() => this.refreshText());
  }

  setName(name?: string): void {
    this.name = name?.trim() || null;
    this.refreshText();
  }

  setLevel(level: number): void {
    this.level = this.normalizeCount(level, 1);
    this.refreshText();
  }

  setAvatar(character: Character): void {
    const context = this.avatarCanvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, this.avatarCanvas.width, this.avatarCanvas.height);
    this.avatarShapes.clear();
    const projector = new Projector(
      v2(this.avatarCanvas.width * 0.5, this.avatarCanvas.height * 1.02),
      Math.PI * 0.5,
      Projection.groundSquash,
      7.2,
    );
    drawCharacterUpperBody(this.avatarShapes, character.pose, projector, character.palette, character.def);
    this.avatarShapes.flushToMesh(this.avatarSink, this.avatarCanvas.width, this.avatarCanvas.height);
  }

  setHealth(value: number, maximum: number): void {
    [this.health, this.maxHealth] = this.normalizeRange(value, maximum);
    this.refreshBar(this.healthBar, this.health, this.maxHealth, 'health');
  }

  setMana(value: number, maximum: number): void {
    [this.mana, this.maxMana] = this.normalizeRange(value, maximum);
    this.refreshBar(this.manaBar, this.mana, this.maxMana, 'mana');
  }

  setExperience(value: number, maximum: number): void {
    [this.experience, this.maxExperience] = this.normalizeRange(value, maximum);
    const ratio = this.experience / this.maxExperience;
    this.root.style.setProperty('--hud-player-experience', `${ratio * 100}%`);
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
    bar.value.textContent = `${value} / ${maximum}`;
    bar.root.setAttribute('aria-label', this.text.value(kind, { value, maximum }));
  }

  private refreshText(): void {
    this.nameElement.textContent = this.name ?? this.text.value('playerName');
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
