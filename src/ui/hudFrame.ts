import './hudFrame.css';

export type HudFrameSkin = 'frame1';

export interface HudFrameOptions {
  skin?: HudFrameSkin;
  className?: string;
  label?: string;
  width?: string;
  height?: string;
}

/**
 * 可复用九宫格 HUD 外框。边框、中心填充和内容互相独立，调用方只需调整宽高。
 */
export class HudFrame {
  readonly root = document.createElement('section');
  readonly content = document.createElement('div');

  constructor(options: HudFrameOptions = {}) {
    this.root.className = ['hud-frame', options.className].filter(Boolean).join(' ');
    this.content.className = 'hud-frame-content';
    this.root.appendChild(this.content);
    this.setSkin(options.skin ?? 'frame1');
    if (options.label) this.root.setAttribute('aria-label', options.label);
    if (options.width || options.height) this.setSize(options.width, options.height);
  }

  setSkin(skin: HudFrameSkin): void {
    this.root.dataset.frameSkin = skin;
  }

  setSize(width?: string, height?: string): void {
    if (width) this.root.style.width = width;
    if (height) this.root.style.height = height;
  }
}
