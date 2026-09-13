import './hurtFlash.css';

/**
 * 挨打时屏幕四周红一下。
 *
 * 三条规矩，缺一条这东西就变成噪声：
 *
 *   **只在扣血飘字那一刻闪**，不是常驻的一层红。血少了就一直红着的做法等于把整局后半段
 *   都糊上一层滤镜 —— 玩家两分钟就看不见它了，而它偏偏是在最要紧的时候失效。
 *
 *   **血越少红得越浓。**但这一档只调浓淡：
 *   平时带子始终只占一条轴的五个点，只有跌到一成血以下才慢慢变宽，而且到死也只到十四个点。
 *
 *   **红是沿边的四条直带，不是一圈椭圆。** 玩家的眼睛正盯着画面中央那一堆人，
 *   而椭圆渐晕是一个扣在画面上的圆窗口。四条等宽的直带读起来是画框自己红了一下。
 */
/** 跌到这一成以下，带子才开始往画面里长。 */
const CRITICAL_HP = 0.1;
/** 平时每条带子有多宽，占那一条轴的百分比。 */
const EDGE_BAND = 5;
/** 濒死时最宽只到这儿。中间七成二的画面始终是干净的。 */
const DEEP_BAND = 14;

export class HurtFlash {
  readonly root = document.createElement('div');
  private animation: Animation | null = null;

  constructor() {
    this.root.className = 'hurt-flash';
    this.root.setAttribute('aria-hidden', 'true');
  }

  /**
   * 闪一下。
   *
   * @param share  这一下扣掉的血占血上限的几成。只作微调 —— 主唱是下面那个 low。
   * @param hpLeft 挨完这一下还剩几成血。
   */
  hit(share: number, hpLeft: number): void {
    const low = clamp01(1 - hpLeft);
    // 这一下有多重。乘 6 是因为单次扣血很少超过上限的六分之一，再多也只是"很重"。
    const bite = clamp01(share * 6);
    /*
     * 峰值压得很低：满血一成出头，濒死也就三成。
     *
     * 先调到过 0.15-0.8，太重了 —— 一层厚红盖上去再退开，画面读起来像卡了一拍。
     * 这一下要干的事是"余光里有东西亮了一下"，不是"把你的眼睛拽过来"—— 头顶那个数字已经在说详情了。
     * 剩血吃平方，为的是前半程几乎看不出变化：半血才刚刚比满血浓一点点。
     */
    const peak = clamp01(0.1 + 0.16 * low * low + 0.06 * bite);
    /*
     * 带子有多宽。**平时只占画幅的五个点，一像素都不往里进。**
     *
     * 只有跌到一成血以下，带子才开始慢慢变宽，而且到死也只到十四个点 ——
     * 主体画面任何时候都不能被盖。一成血这个阈值才是这一段的全部意义：
     * 它一开始往里长，就是真的快死了。
     */
    const bleed = hpLeft >= CRITICAL_HP ? 0 : clamp01((CRITICAL_HP - hpLeft) / CRITICAL_HP);
    const band = EDGE_BAND + (DEEP_BAND - EDGE_BAND) * bleed;
    this.root.style.setProperty('--hurt-flash-band', `${band.toFixed(1)}%`);
    // 起得快、落得慢：挨打是一瞬间的事，而"刚才那一下"要留一点余味才读得到。
    this.animation?.cancel();
    this.animation = this.root.animate(
      [{ opacity: 0 }, { opacity: peak, offset: 0.13 }, { opacity: 0 }],
      { duration: 440, easing: 'ease-out' },
    );
  }

  /** 收场（回选人、重开一局）。留着上一局最后那一下的红会跟着新的一局一起淡出去。 */
  clear(): void {
    this.animation?.cancel();
    this.animation = null;
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
