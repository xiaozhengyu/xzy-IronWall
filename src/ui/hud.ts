import minimapFrameUrl from '../../assets/hud/minimap-frame.png';
import type { Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { Camera } from '../render/camera';
import './hud.css';
import { Minimap } from './minimap';
import { HudProgressBar } from './hudProgressBar';
export { createHudButton, type HudButtonOptions } from './hudButton';
export { HudProgressBar, type HudProgressBarOptions } from './hudProgressBar';

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

  private readonly minimapElement = document.createElement('div');
  private readonly gemsPerCycle: number;
  private lastCollectedGems = 0;

  constructor(host: HTMLElement, options: HudOptions = {}) {
    this.root.className = 'hud';

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
    this.root.appendChild(this.minimapElement);
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
    host.appendChild(this.root);
  }

  /** CSS 长度或百分比，例如 '22.5%'、'240px'。 */
  setMinimapSize(size: string): void {
    this.minimapElement.style.width = size;
  }

  /** 1 显示整张地图；数值越大越靠近玩家。实际值会限制在 1..8。 */
  setMinimapZoom(zoom: number): void {
    this.minimap.zoom = zoom;
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
