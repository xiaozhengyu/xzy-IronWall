import { clamp } from '../core/math';
import type { Camera } from '../render/camera';

/**
 * 鼠标和键盘。
 *
 * 它只负责把浏览器事件收成几个状态（准星在哪、左键按没按、哪些键按着、指针锁没锁），
 * 不解释这些状态的含义 —— "按住左键"翻译成"往前走"是 Battle 的事，"按 T"翻译成"换天气"
 * 是 main 里那张命令表的事。这条线一划开，加手柄或者触屏就只是再写一个这样的类。
 */
export interface ControlHooks {
  /** 一个键刚被按下。自动重复不重复触发 —— 切换类的功能不能跟着重复率闪。 */
  onKey(code: string): void;
  /** 指针锁定变了。这是暂停的唯一开关，见下面 pointerlockchange 上那段注释。 */
  onLockChange(locked: boolean): void;
  /** 现在允不允许夺指针。地面还没烘完时不接。 */
  canLock(): boolean;
}

export class Controls {
  /**
   * 准星在缓冲里的位置。
   *
   * 指针锁定下浏览器不再给绝对坐标，只给 movementX/Y 增量，所以位置得自己攒。这也正是要把
   * 它画出来的原因：系统光标已经隐藏了，不画就没有任何东西告诉玩家"朝向"到底指着哪儿。
   * 存的是缓冲像素坐标，和人物的投影用同一套。
   */
  readonly cursor = { x: 0, y: 0 };

  readonly keys = new Set<string>();
  pointerLocked = false;
  /** 左键按着 = 往前走。 */
  moving = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;

  constructor(canvas: HTMLCanvasElement, camera: Camera, hooks: ControlHooks) {
    this.canvas = canvas;
    this.camera = camera;

    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) {
        // 面板盖着的时候点空白处会落到这里（背景层 pointer-events 是 none），也就是浏览器
        // FPS 里那条"点任意处继续"。这一下只用来夺取指针，不当成移动指令 —— 否则每次点进
        // 画面人都会先窜一步。
        if (hooks.canLock()) this.requestLock().catch(() => {});
        return;
      }
      if (e.button === 0) this.moving = true;
    });

    // 锁定状态下右键菜单会顶掉指针锁定。
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // 挂在 window 上而不是画布上：按下之后把鼠标拖出画布再松手，画布收不到 mouseup，
    // 人就会一直走下去。
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.moving = false;
    });

    /**
     * 暂停的开关就在这里。
     *
     * ESC 由浏览器自己处理：锁定状态下它根本不把 keydown 交给页面，preventDefault 也拦不住。
     * 所以暂停不能监听 ESC，只能监听它造成的后果 —— 锁定丢了。好处是这条路把 alt-tab、
     * 切窗口、右键菜单一并接住了，它们本来也都该暂停。
     */
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) {
        this.moving = false;
        // 松开所有按键。不清的话，按着 Shift 再按 ESC，Shift 会一直卡在集合里，回来之后
        // 人凭空就在跑。
        this.keys.clear();
      }
      hooks.onLockChange(this.pointerLocked);
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // 滚轮调的是 grain，因为要看的是"更多的地"而不是"更小的像素"。
        camera.zoom(e.deltaY <= 0);
      },
      { passive: false },
    );

    addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      // movementX/Y 是 CSS 像素，缓冲是物理像素除以放大倍数，所以两次换算。
      const perCssPixel = (camera.resolution || 1) / camera.magnify;
      this.cursor.x = clamp(this.cursor.x + e.movementX * perCssPixel, 0, camera.viewWidth);
      this.cursor.y = clamp(this.cursor.y + e.movementY * perCssPixel, 0, camera.viewHeight);
    });

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) hooks.onKey(e.code);
      this.keys.add(e.code);
      // 空格默认会滚动页面。
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** 按住 Shift 就是跑。 */
  get running(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /**
   * 夺取指针锁定。新版浏览器返回 Promise，而刚按过 ESC 的一小段冷却期里它会直接 reject。
   * 那是正常的用户操作，不该当成错误 —— 菜单那边接住它，隔一阵再试。
   */
  requestLock(): Promise<void> {
    return (this.canvas.requestPointerLock?.() as Promise<void> | undefined) ?? Promise.resolve();
  }

  /** 把准星摆到缓冲里的某一点。开场时用，让它落在人的正下方。 */
  placeCursor(x: number, y: number): void {
    this.cursor.x = clamp(x, 0, this.camera.viewWidth);
    this.cursor.y = clamp(y, 0, this.camera.viewHeight);
  }
}
