import minimapFrameUrl from '../../assets/hud/minimap-frame.png';
import { playerPresetDisplayName, type Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { Camera } from '../render/camera';
import './hud.css';
import { Minimap } from './minimap';
import { HudProgressBar } from './hudProgressBar';
import { HudFrame } from './hudFrame';
import { createHudButton } from './hudButton';
import { createHudIcon } from './hudIcons';
import { swordCursorImage } from './cursorImage';
import { HudWavePanel } from './hudWavePanel';
import { HudPlayerPanel } from './hudPlayerPanel';
import { HudQuickbar } from './hudQuickbar';
import { HUD_COOLDOWN_SKILLS, HudCooldownPanel } from './hudCooldownPanel';
import { HudText, type HudLocale } from './text/hudText';
export { createHudButton, type HudButtonOptions, type HudButtonSkin } from './hudButton';
export { HudProgressBar, type HudProgressBarOptions } from './hudProgressBar';
export { HudFrame, type HudFrameOptions, type HudFrameSkin } from './hudFrame';
export { createHudIcon, HUD_ICON_URLS, type HudIconName } from './hudIcons';
export { HudWavePanel, type HudWavePanelOptions } from './hudWavePanel';
export { HudPlayerPanel, type HudPlayerPanelOptions } from './hudPlayerPanel';
export {
  HudQuickbar,
  type HudQuickbarItemUse,
  type HudQuickbarOptions,
  type HudQuickSlotOptions,
} from './hudQuickbar';
export { HudCooldownPanel, type HudTimedEffect } from './hudCooldownPanel';
export { HudText, type HudLocale, type HudTextKey, type HudTextParams } from './text/hudText';

/**
 * 小地图调节集中在这里：size 改整个 HUD 尺寸，zoom 改内部地图视野（1 = 整张地图）。
 * 也可以在 new Hud(host, options) 时覆盖，不必改组件实现。
 */
export const MINIMAP_SETTINGS = {
  size: '17%',
  zoom: 1.35,
};

/** 宝石进度只做循环显示，暂不接升级或奖励。 */
export const GEM_PROGRESS_SETTINGS = {
  width: '60%',
  height: '34px',
  gemsPerCycle: 100,
  sideOverhang: 20,
};

export interface HudOptions {
  minimapSize?: string;
  minimapZoom?: number;
  gemProgressWidth?: string;
  gemProgressHeight?: string;
  gemsPerCycle?: number;
  gemProgressSideOverhang?: number;
  requestPause?: () => void;
  locale?: HudLocale;
}

/**
 * 正式游戏 HUD。它挂在固定 16:9 的 gameViewport 里，不属于 ESC 调试菜单。
 *
 * 小地图与宝石进度各自封装为组件，位置在 hud.css、默认参数在本文件中调整。
 */
export class Hud {
  readonly root = document.createElement('div');
  readonly minimapLayer = document.createElement('div');
  readonly minimap: Minimap;
  readonly gemProgress: HudProgressBar;
  readonly playerInfo: HudPlayerPanel;
  readonly waveInfo: HudWavePanel;
  readonly currencyInfo: HudFrame;
  readonly quickbar: HudQuickbar;
  readonly cooldownInfo: HudCooldownPanel;
  readonly text: HudText;

  private readonly topInfoRow = document.createElement('div');
  private readonly minimapDock = document.createElement('div');
  private readonly minimapElement = document.createElement('div');
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly pointerSurfaces: HTMLElement[] = [];
  private readonly hudPointer = document.createElement('div');
  private readonly quickbarResizeObserver: ResizeObserver;
  private readonly gemsPerCycle: number;
  private readonly gemProgressSideOverhang: number;
  private lastCollectedGems = 0;
  private lastPlayerPreset = -1;

  constructor(host: HTMLElement, options: HudOptions = {}) {
    this.root.className = 'hud';
    this.text = new HudText(options.locale ?? 'zh-CN');

    this.playerInfo = new HudPlayerPanel(this.text, { className: 'hud-player-info' });
    this.waveInfo = new HudWavePanel(this.text, { className: 'hud-wave-info' });
    this.currencyInfo = this.createCurrencyFrame();
    this.topInfoRow.className = 'hud-top-info-row';
    this.topInfoRow.append(this.playerInfo.root, this.waveInfo.root, this.currencyInfo.root);
    this.root.appendChild(this.topInfoRow);
    this.pointerSurfaces.push(this.playerInfo.root, this.waveInfo.root, this.currencyInfo.root);

    this.minimapDock.className = 'hud-minimap-dock';
    const minimapControls = document.createElement('div');
    minimapControls.className = 'hud-minimap-controls';
    const requestPause = () => options.requestPause?.();
    const pauseButton = createHudButton({
      label: this.text.value('pause'),
      icon: 'pause',
      skin: 'button4',
      className: 'hud-minimap-button',
    });
    const settingsButton = createHudButton({
      label: this.text.value('settings'),
      icon: 'settings',
      skin: 'button4',
      className: 'hud-minimap-button',
    });
    pauseButton.addEventListener('click', requestPause);
    settingsButton.addEventListener('click', requestPause);
    this.text.bindAttribute(pauseButton, 'aria-label', 'pause');
    this.text.bindAttribute(settingsButton, 'aria-label', 'settings');
    this.actionButtons.push(pauseButton, settingsButton);
    minimapControls.append(pauseButton, settingsButton);

    this.minimapElement.className = 'hud-minimap';
    this.setMinimapSize(options.minimapSize ?? MINIMAP_SETTINGS.size);
    this.minimap = new Minimap(options.minimapZoom ?? MINIMAP_SETTINGS.zoom);

    const frame = document.createElement('img');
    frame.className = 'hud-minimap-frame';
    frame.src = minimapFrameUrl;
    frame.alt = '';
    frame.draggable = false;

    this.minimapLayer.className = 'hud-minimap-layer';
    this.minimapLayer.setAttribute('aria-hidden', 'true');
    this.minimapLayer.appendChild(this.minimap.canvas);

    this.minimapElement.append(frame, this.minimapLayer);
    this.minimapDock.append(minimapControls, this.minimapElement);
    this.root.appendChild(this.minimapDock);
    this.pointerSurfaces.push(this.minimapDock);
    const cycle = options.gemsPerCycle ?? GEM_PROGRESS_SETTINGS.gemsPerCycle;
    this.gemsPerCycle = Number.isFinite(cycle) ? Math.max(1, Math.floor(cycle)) : GEM_PROGRESS_SETTINGS.gemsPerCycle;
    const sideOverhang = options.gemProgressSideOverhang ?? GEM_PROGRESS_SETTINGS.sideOverhang;
    this.gemProgressSideOverhang = Number.isFinite(sideOverhang) ? Math.max(0, sideOverhang) : 0;
    const gemProgressHeight = options.gemProgressHeight ?? GEM_PROGRESS_SETTINGS.height;
    this.root.style.setProperty('--hud-gem-progress-height', gemProgressHeight);
    this.gemProgress = new HudProgressBar({
      label: this.text.value('gemProgress'),
      className: 'hud-gem-progress',
      width: options.gemProgressWidth ?? GEM_PROGRESS_SETTINGS.width,
      height: gemProgressHeight,
    });
    this.text.bindAttribute(this.gemProgress.root, 'aria-label', 'gemProgress');
    this.gemProgress.setValue(0, this.gemsPerCycle, false);
    this.root.appendChild(this.gemProgress.root);
    this.pointerSurfaces.push(this.gemProgress.root);

    this.quickbar = new HudQuickbar(this.text);
    this.root.appendChild(this.quickbar.root);
    this.pointerSurfaces.push(this.quickbar.root);
    this.quickbarResizeObserver = new ResizeObserver(() => this.syncGemProgressWidth());

    this.cooldownInfo = new HudCooldownPanel(this.text);
    this.root.appendChild(this.cooldownInfo.root);
    this.pointerSurfaces.push(this.cooldownInfo.root);

    this.hudPointer.className = 'hud-pointer';
    this.hudPointer.hidden = true;
    const pointerImage = swordCursorImage();
    if (pointerImage) {
      this.hudPointer.style.width = `${pointerImage.width}px`;
      this.hudPointer.style.height = `${pointerImage.height}px`;
      this.hudPointer.style.backgroundImage = `url(${pointerImage.url})`;
      this.hudPointer.style.transform = `translate(${-pointerImage.hotX}px, ${-pointerImage.hotY}px)`;
    }
    this.root.appendChild(this.hudPointer);
    host.appendChild(this.root);
    this.quickbarResizeObserver.observe(this.quickbar.root);
    this.syncGemProgressWidth();
  }

  private syncGemProgressWidth(): void {
    const width = this.quickbar.root.getBoundingClientRect().width;
    if (width > 0) {
      this.gemProgress.root.style.width = `${width + this.gemProgressSideOverhang * 2}px`;
    }
  }

  private createCurrencyFrame(): HudFrame {
    const frame = new HudFrame({
      skin: 'frame1',
      className: 'hud-currency-info',
      label: this.text.value('currencyInfo'),
    });
    this.text.bindAttribute(frame.root, 'aria-label', 'currencyInfo');
    const values: Array<['coin' | 'gem', 'gold' | 'energy', string]> = [
      ['coin', 'gold', '0'],
      ['gem', 'energy', '0'],
    ];
    for (const [icon, label, value] of values) {
      const item = document.createElement('div');
      item.className = 'hud-currency-item';
      this.text.bindAttribute(item, 'aria-label', label);
      item.append(createHudIcon(icon, `hud-currency-icon hud-currency-icon--${icon}`));
      const count = document.createElement('span');
      count.className = 'hud-text hud-text--pixel hud-currency-value';
      count.textContent = value;
      item.appendChild(count);
      frame.content.appendChild(item);
    }
    return frame;
  }

  setLocale(locale: HudLocale): void {
    this.text.setLocale(locale);
  }

  useItem(index: number): boolean {
    const effect = this.quickbar.consumeItem(index);
    if (!effect) return false;
    this.cooldownInfo.activateTimedEffect(effect);
    return true;
  }

  update(dt: number): void {
    this.cooldownInfo.update(dt);
  }

  /** CSS 长度或百分比，例如 '22.5%'、'240px'。 */
  setMinimapSize(size: string): void {
    this.minimapDock.style.width = size;
  }

  /** 1 显示整张地图；数值越大越靠近玩家。实际值会限制在 1..8。 */
  setMinimapZoom(zoom: number): void {
    this.minimap.zoom = zoom;
  }

  /**
   * 指针锁定时浏览器只把点击交给 canvas；用游戏准星的屏幕坐标命中 HUD 按钮。
   */
  activateControlAt(clientX: number, clientY: number): boolean {
    for (const button of this.actionButtons) {
      const rect = button.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
      button.click();
      return true;
    }
    return false;
  }

  /** 指针锁定时，场景准星被 HUD 遮住的区域改由最上层 DOM 光标接力显示。 */
  updatePointer(x: number, y: number, viewWidth: number, viewHeight: number, visible: boolean): void {
    if (!visible || viewWidth <= 0 || viewHeight <= 0 || !this.hudPointer.style.backgroundImage) {
      this.hudPointer.hidden = true;
      return;
    }
    const nx = Math.max(0, Math.min(1, x / viewWidth));
    const ny = Math.max(0, Math.min(1, y / viewHeight));
    const rootRect = this.root.getBoundingClientRect();
    const clientX = rootRect.left + nx * rootRect.width;
    const clientY = rootRect.top + ny * rootRect.height;
    const overHud = this.pointerSurfaces.some((surface) => {
      const rect = surface.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    });
    this.hudPointer.hidden = !overHud;
    if (!overHud) return;
    this.hudPointer.style.left = `${nx * 100}%`;
    this.hudPointer.style.top = `${ny * 100}%`;
  }

  draw(field: Field, battle: Battle, camera: Camera): void {
    if (battle.presetIndex !== this.lastPlayerPreset) {
      this.lastPlayerPreset = battle.presetIndex;
      this.playerInfo.setName(playerPresetDisplayName(battle.presetIndex));
      this.playerInfo.setAvatar(battle.player);
    }
    this.playerInfo.setHealth(Math.max(0, Math.ceil(battle.player.hp)), battle.player.maxHp);
    for (let index = 0; index < battle.skillLoadout.activeSkillSlots.length; index++) {
      const skillId = battle.skillLoadout.activeSkillSlots[index];
      this.quickbar.setSkillCooldown(index,
        skillId ? battle.skillCooldown(skillId) : 0,
        skillId ? battle.skillCooldownDuration(skillId) : 0);
    }
    for (const definition of HUD_COOLDOWN_SKILLS) {
      this.cooldownInfo.setSkillState(definition.id,
        battle.skillLoadout.isEquipped(definition.id),
        battle.skillCooldown(definition.id), battle.skillCooldownDuration(definition.id));
    }
    this.minimap.draw(field, battle, camera);
    const total = battle.collectedGems;
    if (total !== this.lastCollectedGems) {
      const sameCycle = Math.floor(total / this.gemsPerCycle) === Math.floor(this.lastCollectedGems / this.gemsPerCycle);
      this.gemProgress.setValue(total % this.gemsPerCycle, this.gemsPerCycle,
        total > this.lastCollectedGems && sameCycle);
      this.lastCollectedGems = total;
    }
  }
}
