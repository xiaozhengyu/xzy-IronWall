import './curtain.css';

/**
 * 一块盖满整个窗口的黑幕，用来接住"换一个界面"这件事。
 *
 * 为什么要有它：切界面是**一帧之内**发生的 —— 上一屏 hidden 立起来、下一屏 hidden 落下去，
 * 玩家眼里就是画面咔一下换了个样。每一屏各自的入场动画解决不了这个，因为那两屏在同一帧里
 * 一个还在、一个已经来了，中间没有任何过渡可言。黑幕提供的就是那个"中间"：先全黑，换完，
 * 再亮起来。
 *
 * 挂在 body 上而不是任何一屏里面：它要在两屏都不存在的那一瞬间仍然盖着。
 *
 * 只有一块，全局共用 —— 同一时刻不可能有两个界面在切。
 */
class Curtain {
  private readonly root = document.createElement('div');
  private timer = 0;

  constructor() {
    this.root.className = 'curtain';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true;
    document.body.appendChild(this.root);
  }

  /** 当场全黑，不走动画。换屏之前调这一下。 */
  drop(): void {
    this.cancel();
    this.root.hidden = false;
    this.root.style.transitionDuration = '0ms';
    this.root.style.opacity = '1';
    // 逼浏览器把这一帧结算掉，否则下面 lift 里的 opacity 变化会和它合并成"什么都没发生"。
    void this.root.offsetWidth;
  }

  /** 亮起来。换完屏调这一下。 */
  lift(ms = LIFT_MS): void {
    this.cancel();
    this.root.style.transitionDuration = `${ms}ms`;
    this.root.style.opacity = '0';
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.root.hidden = true;
    }, ms);
  }

  /**
   * 淡到全黑，跑完再回调。
   *
   * 回调而不是 Promise：这一层下面就是游戏循环，`await` 会把调用方切成异步函数，而那些函数
   * 都是被 rAF 或者点击直接调的，改成异步只会让"什么时候真的切了"更难讲清楚。
   */
  fall(ms: number, done: () => void): void {
    this.cancel();
    this.root.hidden = false;
    // 从当前透明度接着走：连点两次时不会闪回全亮再重新变黑。
    this.root.style.transitionDuration = `${ms}ms`;
    void this.root.offsetWidth;
    this.root.style.opacity = '1';
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      done();
    }, ms);
  }

  private cancel(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = 0;
  }
}

/** 亮起来用多久。比落下去慢一点：进一个新界面该是"揭开"，不是"切过去"。 */
const LIFT_MS = 420;

export const curtain = new Curtain();
