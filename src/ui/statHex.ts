import './statHex.css';

/**
 * 六项基础属性的六边形示意图。
 *
 * 为什么是图不是一排数字：那排数字一直都在（生命 1954、攻击 381……），但它回答不了玩家在
 * 选人界面真正要问的问题 —— **"这个人和那个人差在哪儿"**。两列数要一项一项对，而形状一眼
 * 就能比：骑士是一个往防御那边拉长的团，剑士是一个尖细地指向攻击和暴击的角。
 *
 * 每一项都按**四个角色里的最大值**归一化，不是按绝对值。绝对值没有共同的尺度可言：生命
 * 两千多、频率一点几、暴击零点一几，画在同一张图上只会得到一个刺猬。归一化之后每一条轴
 * 上的满格就是"这一项上最强的那个人"，图形本身就是一次横向比较。
 *
 * 用内联 SVG 而不是画布：它要跟着这一栏的宽度缩放，而且这一屏本来就是 DOM。
 */

/** 一条轴。key 只用来取值，label 是画在角上的字。 */
export interface StatAxis {
  label: string;
  /** 这个角色在这一项上的值。 */
  value: number;
  /** 四个角色里这一项的最大值。归一化的分母。 */
  max: number;
}

const SIZE = 150;
const CENTER = SIZE / 2;
/** 数据多边形最远画到哪儿。剩下的留给角上那六个字。 */
const RADIUS = 44;
/** 底图画几圈。三圈够读出"大概几成"，再多就成了靶纸。 */
const RINGS = 3;
/**
 * 最里面留一小截空。
 *
 * 一项接近 0 的属性会让那个顶点缩到圆心上，六边形塌成一个五边形 —— 玩家读到的是"这一项
 * 没有"，而实际上是"这一项最弱"。留一截之后最弱也还是一个顶点。
 */
const FLOOR = 0.16;

/** 从正上方开始，顺时针六个角。 */
function corner(index: number, radius: number): [number, number] {
  const angle = (Math.PI / 3) * index - Math.PI / 2;
  return [CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius];
}

const ns = 'http://www.w3.org/2000/svg';
function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

const points = (pairs: [number, number][]): string =>
  pairs.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export class StatHex {
  readonly root = document.createElementNS(ns, 'svg');

  constructor() {
    this.root.setAttribute('class', 'stat-hex');
    this.root.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    this.root.setAttribute('role', 'img');
  }

  /** 画一份。六条轴按顺序从正上方顺时针排。 */
  draw(axes: StatAxis[]): void {
    this.root.replaceChildren();
    if (axes.length !== 6) return;

    // 底图：三圈网格加六条辐条。它们不动，但每次重画都要重建 —— 这一块一秒最多重画一次
    // （换角色时），省下来的那点开销不值得多一份"哪些节点是静态的"的账。
    for (let ring = RINGS; ring >= 1; ring--) {
      const r = (RADIUS * ring) / RINGS;
      this.root.appendChild(node('polygon', {
        points: points(axes.map((_, i) => corner(i, r))),
        class: `stat-hex-ring${ring === RINGS ? ' stat-hex-ring--outer' : ''}`,
      }));
    }
    for (let i = 0; i < axes.length; i++) {
      const [x, y] = corner(i, RADIUS);
      this.root.appendChild(node('line', { x1: CENTER, y1: CENTER, x2: x, y2: y, class: 'stat-hex-spoke' }));
    }

    // 数据多边形。
    const shape = axes.map((axis, i) => {
      const share = axis.max > 0 ? Math.max(0, Math.min(1, axis.value / axis.max)) : 0;
      return corner(i, RADIUS * (FLOOR + (1 - FLOOR) * share));
    });
    this.root.appendChild(node('polygon', { points: points(shape), class: 'stat-hex-shape' }));
    for (const [x, y] of shape) {
      this.root.appendChild(node('circle', { cx: x, cy: y, r: 1.8, class: 'stat-hex-dot' }));
    }

    // 角上那六个字。文字锚点跟着方位走：正上和正下居中，左右两侧各自贴边，
    // 不然六个字会各偏各的，读起来像没对齐。
    for (let i = 0; i < axes.length; i++) {
      const [x, y] = corner(i, RADIUS + 13);
      const anchor = i === 0 || i === 3 ? 'middle' : (x > CENTER ? 'start' : 'end');
      const label = node('text', { x: x.toFixed(1), y: (y + 3).toFixed(1), 'text-anchor': anchor, class: 'stat-hex-label' });
      label.textContent = axes[i].label;
      this.root.appendChild(label);
    }

    this.root.setAttribute('aria-label', axes.map((a) => `${a.label} ${Math.round(a.value * 100) / 100}`).join('，'));
  }
}
