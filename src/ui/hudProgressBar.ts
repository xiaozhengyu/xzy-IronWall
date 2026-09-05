import './hudProgressBar.css';

export interface HudProgressBarOptions {
  label: string;
  className?: string;
  width?: string;
  /** CSS 长度；左右装饰与高度等比缩放，宽度只拉伸中段。 */
  height?: string;
}

/** 三段式 HUD 进度条。只负责显示，数值含义及循环规则由调用方决定。 */
export class HudProgressBar {
  readonly root = document.createElement('div');
  private readonly fill = document.createElement('div');
  private currentValue = -1;
  private currentMax = -1;

  constructor(options: HudProgressBarOptions) {
    this.root.className = ['hud-progress-bar', options.className].filter(Boolean).join(' ');
    this.root.setAttribute('role', 'progressbar');
    this.root.setAttribute('aria-label', options.label);
    this.root.setAttribute('aria-valuemin', '0');
    this.setSize(options.width ?? '100%', options.height ?? '34px');

    const track = document.createElement('div');
    track.className = 'hud-progress-track';
    track.setAttribute('aria-hidden', 'true');
    this.fill.className = 'hud-progress-fill';
    track.appendChild(this.fill);

    const frame = document.createElement('div');
    frame.className = 'hud-progress-frame';
    frame.setAttribute('aria-hidden', 'true');
    this.root.append(track, frame);
    this.setValue(0, 100, false);
  }

  setSize(width: string, height: string): void {
    this.root.style.width = width;
    this.root.style.setProperty('--hud-progress-height', height);
  }

  /** 归零可关闭动画，避免满条后从右向左倒退。没有数值变化时不更新 DOM。 */
  setValue(value: number, max = 100, animate = true): void {
    const limit = Number.isFinite(max) && max > 0 ? max : 100;
    const amount = Math.max(0, Math.min(limit, Number.isFinite(value) ? value : 0));
    if (amount === this.currentValue && limit === this.currentMax) return;
    this.currentValue = amount;
    this.currentMax = limit;
    this.root.setAttribute('aria-valuemax', String(limit));
    this.root.setAttribute('aria-valuenow', String(amount));
    this.root.setAttribute('aria-valuetext', `${amount} / ${limit}`);
    this.fill.style.transition = animate ? '' : 'none';
    this.fill.style.transform = `scaleX(${amount / limit})`;
  }
}
