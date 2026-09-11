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

  /**
   * 左键这一刻按着没有。**按在哪儿都算**，包括按在界面上。
   *
   * 和 moving 是两件事：moving 是"人在走"，只有按在画布上才立得起来；这一条是"手指还压着"。
   * 分开记是为了补上一个洞 —— 界面上任何一层弹出物（升级卡那块幕布最典型）都会把 mousedown
   * 吃掉，而玩家往往按着不放就想接着走，结果人钉在原地，直到他松手再按一次。
   */
  private primaryDown = false;
  /**
   * 这一次按下不许触发移动，直到松手。
   *
   * 只有一处会立起来：从暂停里点回来的那一下（resume）。那一下是"继续游戏"，不是"往那边走"
   * —— 否则玩家一回到游戏就朝着他刚才点确认的位置冲出去。
   */
  private holdBlocked = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly hooks: ControlHooks;
  private clientPosition: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera, hooks: ControlHooks) {
    this.canvas = canvas;
    this.camera = camera;
    this.hooks = hooks;

    // 捕获阶段记"手指压着没有"：界面上的弹出层会在冒泡前把事件吃掉，这一层要在它之前。
    addEventListener('mousedown', (event) => {
      if (event.button === 0) this.primaryDown = true;
    }, true);

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
      if (event.button !== 0) return;
      this.primaryDown = false;
      this.holdBlocked = false;
      this.moving = false;
    });
    addEventListener('mousemove', (event) => {
      this.trackPointer(event);
      /*
       * 按着不放的补漏：手指压着、光标已经在画布上、可就是没在走，那就开始走。
       *
       * 这一条专治"mousedown 被别人吃了"。弹出层（升级卡）、刚消失的按钮、浏览器自己的一些
       * 手势，都可能让画布收不到那一下按下，而玩家的手指明明还压着。只认 target 是画布本身，
       * 所以从 HUD 按钮上拖出来不会误触发。
       */
      if (this.active && this.primaryDown && !this.moving && !this.holdBlocked
        && event.target === this.canvas) {
        this.moving = true;
      }
    });
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

  /** 这个键这一帧按着没有。按住型的技能（疾走）靠它，见 main.ts 的 readInput。 */
  held(code: string): boolean {
    return this.keys.has(code);
  }

  resume(): void {
    if (this.active || !this.hooks.canActivate()) return;
    this.moving = false;
    // 点回来的这一下按住不放也不许走，直到松手 —— 见 holdBlocked。
    this.holdBlocked = this.primaryDown;
    this.keys.clear();
    this.syncCursor();
    this.active = true;
    this.hooks.onActiveChange(true);
  }

  pause(): void {
    this.moving = false;
    this.primaryDown = false;
    this.holdBlocked = false;
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
