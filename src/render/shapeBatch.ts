import { type Vec2, norm2, v2 } from '../core/math';
import { type Rgba } from './color';

/**
 * 三角形的去处。PrimitiveMesh 是正式实现，离线对照工具也实现它来验几何。
 *
 * ShapeBatch 因此不依赖任何 Pixi 类型 —— 它只知道"把这个四边形/椭圆交出去"。
 */
export interface PrimitiveSink {
  quad(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    color: Rgba,
  ): void;
  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, color: Rgba): void;
}

/**
 * 排序键的打包参数：深度量化到 1/8，低 17 位放原始下标。
 *
 * 深度最大约"屏幕行 × 32"，一千行也就三万出头，乘 8 再乘 2^17 是 3.4e10 —— 离 float64 能
 * 精确表示的 2^53 还差得远，所以打包不会丢位。下标上限 131072 意味着一帧最多十三万个图元，
 * 目前满屏一千人是六万，留了一倍。
 */
const DEPTH_QUANT = 8;
const INDEX_SPAN = 1 << 17;

/**
 * 画家顺序的图形批次。移植自 overlord 的 ShapeBatch。
 *
 * 原版把每个图元当成一个带 depth 的 quad 交给 GPU 深度缓冲排序。WebGL 这边没有等价的廉价
 * 通道，所以改成 CPU 排序之后按顺序交出去 —— 交给谁由 PrimitiveSink 决定：线上是
 * PrimitiveMesh（写顶点缓冲），离线出图工具则自己光栅化。
 *
 * 行为上和原版等价，因为原版的深度测试是 LessEqual（同深度时后提交的赢），而这里的排序键
 * 低位放的是原始下标，同深度同样保持提交顺序。ToneStep = 0 的那些同深度色阶就是靠这一点
 * 叠上去的。
 *
 * 这个文件**不依赖 Pixi**。所以整条几何路径都能在 node 里跑，出图工具和线上用的是同一份
 * 代码 —— 一份代码只有一种行为，不会哪天悄悄分叉。
 */
export class ShapeBatch {
  /**
   * 屏幕空间的光照方向。全场景共用这一个向量，这正是让一群人看起来"被同一盏灯照着"
   * 而不是一堆平涂色块的原因。
   */
  static readonly LIGHT_DIR: Vec2 = norm2(v2(-0.55, -0.84));

  /** 低于这个半径，明暗三色带每条都不足一像素：只有开销，读不出来，直接平涂中间色。 */
  static toneMinRadius = 1.25;

  /** 低于这个半径连高光都省掉。 */
  static highlightMinRadius = 1.7;

  private kind: number[] = [];
  private cx: number[] = [];
  private cy: number[] = [];
  private ex: number[] = [];
  private ey: number[] = [];
  private rot: number[] = [];
  private col: Rgba[] = [];
  private depth: number[] = [];
  private count = 0;

  /**
   * 排序用的键，(量化深度, 下标) 打包成一个数。
   *
   * 用 Float64Array 的原生 sort 而不是 Array.sort(比较函数)：后者每比较一次都要过一次 JS
   * 回调，六万个图元就是几十万次调用；定型数组不带比较函数时走的是原生数值排序，实测快
   * 一倍多。打包是为了在一次排序里同时带上稳定性 —— 低位放原始下标，同深度就按提交顺序，
   * 和原来 `|| a - b` 的效果一样（ToneStep = 0 的同深度色阶就靠这一点叠上去）。
   */
  private keys = new Float64Array(0);

  get primitiveCount(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  /** 轴对齐或旋转的矩形，按中心定位。 */
  rect(center: Vec2, sizeX: number, sizeY: number, rotation: number, color: Rgba, depth: number): void {
    this.push(0, center.x, center.y, sizeX * 0.5, sizeY * 0.5, rotation, color, depth);
  }

  ellipse(center: Vec2, radiusX: number, radiusY: number, rotation: number, color: Rgba, depth: number): void {
    this.push(1, center.x, center.y, radiusX, radiusY, rotation, color, depth);
  }

  disc(center: Vec2, radius: number, color: Rgba, depth: number): void {
    this.push(1, center.x, center.y, radius, radius, 0, color, depth);
  }

  /** 方头的连线段 —— 在像素尺度上读作一根杆/一块板。 */
  bar(a: Vec2, b: Vec2, thickness: number, color: Rgba, depth: number): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-4) return;
    this.push(0, (a.x + b.x) * 0.5, (a.y + b.y) * 0.5, len * 0.5, thickness * 0.5, Math.atan2(dy, dx), color, depth);
  }

  /** 圆头的连线段：一根杆加两端的关节圆。 */
  capsule(a: Vec2, b: Vec2, thickness: number, color: Rgba, depth: number): void {
    this.bar(a, b, thickness, color, depth);
    const r = thickness * 0.5;
    this.disc(a, r, color, depth);
    this.disc(b, r, color, depth);
  }

  /**
   * 真正空心的椭圆环。用一圈短 bar 拼出来，中间是透的 —— 这一点对地面上的标记和冲击波
   * 是必须的：一个半透明的实心椭圆会把站在它上面的人整个染一层色，哪怕深度排序是对的。
   */
  ellipseRing(
    center: Vec2,
    radiusX: number,
    radiusY: number,
    rotation: number,
    thickness: number,
    color: Rgba,
    depth: number,
    segments = 24,
  ): void {
    if (radiusX <= 0 || radiusY <= 0 || thickness <= 0) return;
    const n = Math.max(8, Math.min(64, Math.round(segments)));

    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const point = (angle: number): Vec2 => {
      const x = Math.cos(angle) * radiusX;
      const y = Math.sin(angle) * radiusY;
      return v2(center.x + x * c - y * s, center.y + x * s + y * c);
    };

    let previous = point(0);
    for (let i = 1; i <= n; i++) {
      const next = point((Math.PI * 2 * i) / n);
      this.bar(previous, next, thickness, color, depth);
      previous = next;
    }
  }

  /**
   * 三色阶的圆球：阴影铺满，中间色朝光源偏移，再加一小块高光。
   * 这就是像素画里的球，在 20~35 像素高的角色身上比任何额外几何都值钱。
   */
  sphere(center: Vec2, radius: number, shadow: Rgba, mid: Rgba, light: Rgba, depth: number): void {
    if (radius < ShapeBatch.toneMinRadius) {
      this.disc(center, radius, mid, depth);
      return;
    }
    const L = ShapeBatch.LIGHT_DIR;
    this.disc(center, radius, shadow, depth);
    this.disc(v2(center.x + L.x * radius * 0.2, center.y + L.y * radius * 0.2), radius * 0.86, mid, depth);
    if (radius >= ShapeBatch.highlightMinRadius)
      this.disc(v2(center.x + L.x * radius * 0.46, center.y + L.y * radius * 0.46), radius * 0.38, light, depth);
  }

  /**
   * 三色阶的胶囊，用在躯干和枪杆上。内侧两层用方头 bar：外层阴影的圆头已经定义了轮廓，
   * 内层再画圆头就是白花四个图元。
   */
  shadedCapsule(a: Vec2, b: Vec2, thickness: number, shadow: Rgba, mid: Rgba, light: Rgba, depth: number): void {
    if (thickness * 0.5 < ShapeBatch.toneMinRadius) {
      this.capsule(a, b, thickness, mid, depth);
      return;
    }
    const L = ShapeBatch.LIGHT_DIR;
    this.capsule(a, b, thickness, shadow, depth);

    const o1x = L.x * thickness * 0.14;
    const o1y = L.y * thickness * 0.14;
    const a1 = v2(a.x + o1x, a.y + o1y);
    const b1 = v2(b.x + o1x, b.y + o1y);
    this.bar(a1, b1, thickness * 0.8, mid, depth);
    this.disc(a1, thickness * 0.4, mid, depth);
    this.disc(b1, thickness * 0.4, mid, depth);

    if (thickness < ShapeBatch.highlightMinRadius * 2) return;
    const o2x = L.x * thickness * 0.32;
    const o2y = L.y * thickness * 0.32;
    this.bar(v2(a.x + o2x, a.y + o2y), v2(b.x + o2x, b.y + o2y), thickness * 0.28, light, depth);
  }

  /**
   * 按深度排好序的下标。打包排序，见 keys 上那段。
   *
   * 深度量化到 1/8，比一个图元的尺度细得多，不会改变可见顺序。
   */
  private sortedOrder(n: number): Float64Array {
    if (this.keys.length < n) this.keys = new Float64Array(Math.max(n, 4096));
    const depth = this.depth;
    let lo = depth[0];
    for (let i = 1; i < n; i++) if (depth[i] < lo) lo = depth[i];
    const bias = Math.ceil(-lo * DEPTH_QUANT) + 1; // 键必须非负，取下标时才能用取模
    const keys = this.keys;
    for (let i = 0; i < n; i++) {
      keys[i] = (Math.round(depth[i] * DEPTH_QUANT) + bias) * INDEX_SPAN + i;
    }
    const order = keys.subarray(0, n);
    order.sort();
    return order;
  }

  /**
   * 按深度排序后写进顶点缓冲。和 flush 是同一件事的两条出口，区别只在写给谁。
   *
   * 这条路每个图元只是往几个定型数组里写数，没有对象分配、没有三角化 —— 见 PrimitiveMesh
   * 顶上那段。矩形直接算四个角（旋转与否都一样），椭圆按半径展开扇形。
   */
  flushToMesh(mesh: PrimitiveSink, clipW = 0, clipH = 0): void {
    const n = this.count;
    this.count = 0;
    if (n === 0) return;
    const clip = clipW > 0 && clipH > 0;
    let culled = 0;
    const order = this.sortedOrder(n);

    for (let k = 0; k < n; k++) {
      const i = order[k] % INDEX_SPAN;
      const x = this.cx[i];
      const y = this.cy[i];
      const ex = this.ex[i];
      const ey = this.ey[i];
      const rot = this.rot[i];

      if (clip) {
        let hx = ex;
        let hy = ey;
        if (rot !== 0) {
          const ca = Math.abs(Math.cos(rot));
          const sa = Math.abs(Math.sin(rot));
          hx = ex * ca + ey * sa;
          hy = ex * sa + ey * ca;
        }
        if (x + hx < 0 || x - hx > clipW || y + hy < 0 || y - hy > clipH) {
          culled++;
          continue;
        }
      }

      const color = this.col[i];
      if (this.kind[i] === 0) {
        if (rot === 0) {
          mesh.quad(x - ex, y - ey, x + ex, y - ey, x + ex, y + ey, x - ex, y + ey, color);
        } else {
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          const ux = c * ex;
          const uy = s * ex;
          const vx = -s * ey;
          const vy = c * ey;
          mesh.quad(
            x - ux - vx, y - uy - vy,
            x + ux - vx, y + uy - vy,
            x + ux + vx, y + uy + vy,
            x - ux + vx, y - uy + vy,
            color,
          );
        }
      } else {
        mesh.ellipse(x, y, ex, ey, rot, color);
      }
    }

    this.lastCulled = culled;
  }

  private push(
    kind: number,
    x: number,
    y: number,
    ex: number,
    ey: number,
    rot: number,
    color: Rgba,
    depth: number,
  ): void {
    const i = this.count++;
    this.kind[i] = kind;
    this.cx[i] = x;
    this.cy[i] = y;
    this.ex[i] = ex;
    this.ey[i] = ey;
    this.rot[i] = rot;
    this.col[i] = color;
    this.depth[i] = depth;
  }


  /** 上一次 flush 里被兜底裁剪丢掉的图元数。用来判断哪一层该自己做范围裁剪。 */
  lastCulled = 0;
}
