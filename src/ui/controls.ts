import { clamp } from '../core/math';
import type { Camera } from '../render/camera';

export interface ControlHooks {
  onKey(code: string): void;
  onActiveChange(active: boolean): void;
  canActivate(): boolean;
  /**
   * 按下了 ESC。
   *
   * 它**不再**等于"暂停"。ESC 归游戏流程管（弹临时结算画面，见 ui/summary.ts），而调试
   * 菜单只由 HUD 上的系统按钮打开 —— 两件事从这里就分开，Controls 自己不再替谁做决定。
   * 长按不重复触发。
   */
  onEscape(): void;
}

/** 普通鼠标坐标驱动瞄准，ESC 交给上层处理，不锁定或重定位系统鼠标。 */
export class Controls {
  /** 准星的缓冲坐标，与人物投影保持一致。 */
  readonly cursor = { x: 0, y: 0 };
  readonly keys = new Set<string>();
  active = false;
  moving = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly hooks: ControlHooks;
  private clientPosition: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera, hooks: ControlHooks) {
    this.canvas = canvas;
    this.camera = camera;
    this.hooks = hooks;

    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      this.trackPointer(event);
      if (!this.active) {
        this.resume();
        return; // 继续游戏的这次点击不触发移动。
      }
      this.moving = true;
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('mouseleave', () => { this.moving = false; });
    addEventListener('mouseup', (event) => {
      if (event.button === 0) this.moving = false;
    });
    addEventListener('mousemove', (event) => this.trackPointer(event));
    addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    addEventListener('resize', () => this.syncCursor());

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      camera.zoom(event.deltaY <= 0);
    }, { passive: false });

    addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        if (!event.repeat) hooks.onEscape();
        return;
      }
      if (!this.keys.has(event.code)) hooks.onKey(event.code);
      this.keys.add(event.code);
      if (event.code === 'Space') event.preventDefault();
    });
    addEventListener('keyup', (event) => this.keys.delete(event.code));
  }

  private trackPointer(event: MouseEvent): void {
    this.clientPosition = { x: event.clientX, y: event.clientY };
    this.syncCursor();
  }

  private syncCursor(): void {
    if (!this.clientPosition) return;
    const rect = this.canvas.getBoundingClientRect();
    this.placeCursor(
      (this.clientPosition.x - rect.left) / Math.max(1, rect.width) * this.camera.viewWidth,
      (this.clientPosition.y - rect.top) / Math.max(1, rect.height) * this.camera.viewHeight,
    );
  }

  get running(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  resume(): void {
    if (this.active || !this.hooks.canActivate()) return;
    this.moving = false;
    this.keys.clear();
    this.syncCursor();
    this.active = true;
    this.hooks.onActiveChange(true);
  }

  pause(): void {
    this.moving = false;
    this.keys.clear();
    if (!this.active) return;
    this.active = false;
    this.hooks.onActiveChange(false);
  }

  placeCursor(x: number, y: number): void {
    this.cursor.x = clamp(x, 0, this.camera.viewWidth);
    this.cursor.y = clamp(y, 0, this.camera.viewHeight);
  }

  /** 缓冲分辨率变化后，仍然对准真实鼠标当前的屏幕位置。 */
  resizeCursor(previousWidth: number, previousHeight: number): void {
    if (previousWidth <= 0 || previousHeight <= 0) return;
    if (previousWidth === this.camera.viewWidth && previousHeight === this.camera.viewHeight) return;
    if (this.clientPosition) {
      this.syncCursor();
    } else {
      this.placeCursor(
        this.cursor.x / previousWidth * this.camera.viewWidth,
        this.cursor.y / previousHeight * this.camera.viewHeight,
      );
    }
  }
}
