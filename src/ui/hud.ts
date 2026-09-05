import minimapFrameUrl from '../../assets/hud/minimap-frame.png';
import type { Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { Camera } from '../render/camera';
import './hud.css';
import { Minimap } from './minimap';
export { createHudButton, type HudButtonOptions } from './hudButton';

/**
 * 小地图调节集中在这里：size 改整个 HUD 尺寸，zoom 改内部地图视野（1 = 整张地图）。
 * 也可以在 new Hud(host, options) 时覆盖，不必改组件实现。
 */
export const MINIMAP_SETTINGS = {
  size: '17%',
  zoom: 1.35,
};

export interface HudOptions {
  minimapSize?: string;
  minimapZoom?: number;
}

/**
 * 正式游戏 HUD。它挂在固定 16:9 的 gameViewport 里，不属于 ESC 调试菜单。
 *
 * 当前只放小地图框；minimapLayer 特意独立出来，后面地图轮廓、玩家箭头、敌人点和任务标记都
 * 画进这一层，素材外框不用跟着重建。
 */
export class Hud {
  readonly root = document.createElement('div');
  readonly minimapLayer = document.createElement('div');
  readonly minimap: Minimap;

  private readonly minimapElement = document.createElement('div');

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
  }
}
