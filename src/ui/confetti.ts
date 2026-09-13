import './confetti.css';

/**
 * 礼花。只在"全数斩首"那一屏放。
 *
 * 用 DOM 方块而不是画布：这一屏本来就是一层 DOM，再拉一块 canvas 进来要自己管尺寸、
 * 像素比和生命周期，而这里要的东西一共就是"几十个小方块从上面飘下来"。CSS 动画能表达它，
 * 而且整段过程不占 JS 每帧的时间 —— 结算画面底下那一帧战场还在画。
 *
 * **只在赢的时候放。** 输了也撒纸屑是这套反馈里最糟的一种：它会让玩家怀疑自己是不是看错了
 * 结果。这一层的全部意义就是"这一屏和上一屏不是同一件事"。
 */
const PIECES = 54;
/** 一片飘多久，毫秒。区间取得开一点，免得整批一起落地读成一块布。 */
const FALL_MIN = 1900;
const FALL_MAX = 3400;
/** 撒完多久之后把节点摘掉。比最长的一片再多一点。 */
const CLEANUP_MS = FALL_MAX + 400;

/** 取自这一套 UI 自己的金、青、赤，不用彩虹色 —— 彩虹在这张暗色卡片上读作别人家的弹窗。 */
const COLORS = ['#f0e6d2', '#d8c9a4', '#e8b44a', '#8bfaff', '#22cdec', '#c0483a', '#7fd4a0'];

export class Confetti {
  readonly root = document.createElement('div');
  private timer = 0;

  constructor() {
    this.root.className = 'confetti';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true;
  }

  /** 撒一轮。重复调用会先把上一轮清掉 —— 同一屏不该叠两层纸屑。 */
  burst(): void {
    this.stop();
    this.root.hidden = false;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < PIECES; i++) {
      const piece = document.createElement('i');
      piece.className = 'confetti-bit';
      const fall = FALL_MIN + Math.random() * (FALL_MAX - FALL_MIN);
      // 横向落点铺满整屏；起手高度各不相同，于是它们是**陆续**进画面的，不是一排一起掉下来。
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.setProperty('--confetti-fall', `${fall}ms`);
      piece.style.setProperty('--confetti-delay', `${Math.random() * 900}ms`);
      // 左右各飘一段，幅度和方向都各掷各的：整批同向漂移读作被风吹，而不是纸屑自己在打转。
      piece.style.setProperty('--confetti-drift', `${(Math.random() * 2 - 1) * 90}px`);
      piece.style.setProperty('--confetti-spin', `${(Math.random() * 2 - 1) * 900}deg`);
      piece.style.setProperty('--confetti-tilt', `${Math.random() * 360}deg`);
      // 细长条和小方块混着来：全是正方形读作雪，细长条才像纸。
      piece.style.height = `${6 + Math.random() * 10}px`;
      piece.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
      frag.appendChild(piece);
    }
    this.root.appendChild(frag);
    // 自己把自己收掉：这一屏可能停留很久，几十个还在跑动画的节点没必要一直挂着。
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.root.hidden = true;
      this.root.replaceChildren();
    }, CLEANUP_MS);
  }

  /** 立刻收掉。离开这一屏时调。 */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    this.root.hidden = true;
    this.root.replaceChildren();
  }
}
