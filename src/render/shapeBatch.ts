import type { Graphics } from 'pixi.js';
import { type Vec2, norm2, v2 } from '../core/math';
import { type Rgba, toHex } from './color';

/** 旋转椭圆退化成多边形时的采样段数。 */
const ELLIPSE_SEGMENTS = 20;

/**
 * 画家顺序的图形批次。移植自 overlord 的 ShapeBatch。
 *
 * 原版把每个图元当成一个带 depth 的 quad 交给 GPU 深度缓冲排序；WebGL 这边没有等价的
 * 廉价通道，所以改成 CPU 排序后按顺序灌进一个 Pixi Graphics。行为上等价，因为原版的
 * 深度测试是 LessEqual —— 同深度时后提交的赢 —— 而 JS 的 sort 是稳定排序，同深度同样
 * 保持提交顺序。ToneStep = 0 的那些同深度色阶就是靠这一点叠上去的。
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

  /**
   * 按深度排序后一次性画进 Graphics。调用方负责先 g.clear()。
   *
   * @param clipW/clipH 缓冲尺寸。给了就把完全落在画面外的图元丢掉。
   *
   * 这是一道总的兜底裁剪，不是各层自己裁剪的替代品。区别在于代价付在哪一步：一个交到
   * 这里的图元，排序、三角化和顶点上传的开销**已经付了**，GPU 把它丢掉并不退钱。各层
   * 自己按世界范围裁剪能省掉连算都不用算；这里这一道负责接住漏网的 —— 比如雪地脚印能
   * 留四十八秒，玩家跑一圈就在场上撒下几百个，而它们没有任何按范围裁剪的机制。
   */
  flush(g: Graphics, clipW = 0, clipH = 0): void {
    const n = this.count;
    if (n === 0) return;
    const clip = clipW > 0 && clipH > 0;
    let culled = 0;

    // 排索引而不是排图元本身：省掉 n 个临时对象，也让稳定性明确落在索引上。
    const order = new Array<number>(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const depth = this.depth;
    order.sort((a, b) => depth[a] - depth[b] || a - b);

    for (let k = 0; k < n; k++) {
      const i = order[k];
      const color = this.col[i];
      const fill = { color: toHex(color), alpha: color.a / 255 };
      const x = this.cx[i];
      const y = this.cy[i];
      const ex = this.ex[i];
      const ey = this.ey[i];
      const rot = this.rot[i];

      if (clip) {
        // 旋转后的轴对齐包围盒。对矩形是精确的，对椭圆是个安全的上界。
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

      if (this.kind[i] === 0) {
        if (rot === 0) {
          g.rect(x - ex, y - ey, ex * 2, ey * 2);
        } else {
          // 自己算四个角，比走 Graphics 的变换栈省一次矩阵重置。
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          const ux = c * ex;
          const uy = s * ex;
          const vx = -s * ey;
          const vy = c * ey;
          g.poly([
            x - ux - vx, y - uy - vy,
            x + ux - vx, y + uy - vy,
            x + ux + vx, y + uy + vy,
            x - ux + vx, y - uy + vy,
          ]);
        }
      } else if (rot === 0) {
        g.ellipse(x, y, ex, ey);
      } else {
        // Graphics 没有暴露旋转椭圆，也没有暴露变换栈，所以自己采样一圈。用得很少
        // （只有圆盾），而多边形在像素网格上和真椭圆一样是硬边。
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const pts: number[] = [];
        for (let a = 0; a < ELLIPSE_SEGMENTS; a++) {
          const th = (a / ELLIPSE_SEGMENTS) * Math.PI * 2;
          const px = Math.cos(th) * ex;
          const py = Math.sin(th) * ey;
          pts.push(x + px * c - py * s, y + px * s + py * c);
        }
        g.poly(pts);
      }

      g.fill(fill);
    }

    this.lastCulled = culled;
    this.count = 0;
  }

  /** 上一次 flush 里被兜底裁剪丢掉的图元数。用来判断哪一层该自己做范围裁剪。 */
  lastCulled = 0;
}
