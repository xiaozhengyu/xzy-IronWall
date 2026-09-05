import minimapFrameUrl from '../../assets/hud/minimap-frame.png';
import type { Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { Camera } from '../render/camera';
import './hud.css';
import { Minimap } from './minimap';
import { HudProgressBar } from './hudProgressBar';
import { HudFrame } from './hudFrame';
import { createHudButton } from './hudButton';
import { createHudIcon } from './hudIcons';
import { swordCursorImage } from './cursorImage';
export { createHudButton, type HudButtonOptions, type HudButtonSkin } from './hudButton';
export { HudProgressBar, type HudProgressBarOptions } from './hudProgressBar';
export { HudFrame, type HudFrameOptions, type HudFrameSkin } from './hudFrame';
export { createHudIcon, HUD_ICON_URLS, type HudIconName } from './hudIcons';

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
};

export interface HudOptions {
  minimapSize?: string;
  minimapZoom?: number;
  gemProgressWidth?: string;
  gemProgressHeight?: string;
  gemsPerCycle?: number;
  requestPause?: () => void;
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
  readonly playerInfo: HudFrame;
  readonly waveInfo: HudFrame;
  readonly currencyInfo: HudFrame;

  private readonly topInfoRow = document.createElement('div');
  private readonly minimapDock = document.createElement('div');
  private readonly minimapElement = document.createElement('div');
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly pointerSurfaces: HTMLElement[] = [];
  private readonly hudPointer = document.createElement('div');
  private readonly gemsPerCycle: number;
  private lastCollectedGems = 0;

  constructor(host: HTMLElement, options: HudOptions = {}) {
    this.root.className = 'hud';

    this.playerInfo = this.createInfoFrame('玩家信息', 'hud-player-info');
    this.waveInfo = this.createInfoFrame('怪物波次', 'hud-wave-info');
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
      label: '暂停',
      icon: 'pause',
      skin: 'button4',
      className: 'hud-minimap-button',
    });
    const settingsButton = createHudButton({
      label: '设置',
      icon: 'settings',
      skin: 'button4',
      className: 'hud-minimap-button',
    });
    pauseButton.addEventListener('click', requestPause);
    settingsButton.addEventListener('click', requestPause);
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
    this.gemProgress = new HudProgressBar({
      label: '蓝色宝石收集进度',
      className: 'hud-gem-progress',
      width: options.gemProgressWidth ?? GEM_PROGRESS_SETTINGS.width,
      height: options.gemProgressHeight ?? GEM_PROGRESS_SETTINGS.height,
    });
    this.gemProgress.setValue(0, this.gemsPerCycle, false);
    this.root.appendChild(this.gemProgress.root);
    this.pointerSurfaces.push(this.gemProgress.root);

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
  }

  private createInfoFrame(label: string, className: string): HudFrame {
    const frame = new HudFrame({ skin: 'frame1', className, label });
    const placeholder = document.createElement('span');
    placeholder.className = 'hud-info-placeholder';
    placeholder.textContent = label;
    frame.content.appendChild(placeholder);
    return frame;
  }

  private createCurrencyFrame(): HudFrame {
    const frame = new HudFrame({ skin: 'frame1', className: 'hud-currency-info', label: '货币信息' });
    const values: Array<['coin' | 'gem', string]> = [['coin', '0'], ['gem', '0']];
    for (const [icon, value] of values) {
      const item = document.createElement('div');
      item.className = 'hud-currency-item';
      item.append(createHudIcon(icon, `hud-currency-icon hud-currency-icon--${icon}`));
      const count = document.createElement('span');
      count.className = 'hud-currency-value';
      count.textContent = value;
      item.appendChild(count);
      frame.content.appendChild(item);
    }
    return frame;
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
