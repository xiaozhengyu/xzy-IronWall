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
 * 精确表示的 2^53 还差得远，所以打包不会丢位。异常大跨度回退排序时使用这个最小下标跨度，
 * 超过十三万个图元会自动扩大；常规路径只排下标，不需要打包。
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
  /**
   * 朝向以**单位向量**存，不存角度。
   *
   * 一帧里三分之二的图元是旋转的（满屏六百人时约一万一千个，绝大多数是 bar 画出来的肢体
   * 和甲片），而每一个原来要付两次三角函数：剔除时算一次包围盒，发射时算一次四个角。更冤
   * 的是 bar —— 它手上本来就有单位方向 (dx/len, dy/len)，那正是 cos 和 sin，却先用 atan2
   * 压成一个角度，再让 flush 用 cos/sin 解回来。一去一回三次超越函数，只为了搬运一个它一
   * 开始就有的向量。
   *
   * 存成向量之后：bar 一次三角函数都不用，rect/ellipse 在提交时算一次，flush 一次都不算。
   * 实测光是剔除那一处就占 flush 的四分之一。
   */
  private rcos: number[] = [];
  private rsin: number[] = [];
  /** 角度。只有椭圆用得上（PrimitiveSink.ellipse 收的是角度），四边形一律不读。 */
  private rot: number[] = [];
  private col: Rgba[] = [];
  private depth: number[] = [];
  private count = 0;

  /**
   * 排序用的键，(量化深度, 下标) 打包成一个数。
   *
   * 常规深度范围用稳定基数排序，图元再多也不做逐对比较；跨度异常大时回退到定型数组
   * 原生数值排序。两条路径都保留原始提交顺序，保证同深度的色阶叠放不变。
   */
  private keys = new Float64Array(0);
  private sortScratch = new Float64Array(0);
  private quantizedDepth = new Float64Array(0);
  private readonly depthCounts = new Uint32Array(2048);

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
    // 方向除以长度就是单位向量，也就是这个矩形的 cos/sin —— 直接交出去，不绕角度。
    this.emit(0, (a.x + b.x) * 0.5, (a.y + b.y) * 0.5, len * 0.5, thickness * 0.5,
      0, dx / len, dy / len, color, depth);
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
   * 画面内的图元下标，按深度排好序。稳定基数排序，见 keys 上那段。
   *
   * 深度量化到 1/8，比一个图元的尺度细得多，不会改变可见顺序。
   *
   * **剔除并在这一趟里做完**，不是排完再挑。为了让贴着边界的东西不缺角，上游给的余量都
   * 是宽的（人物剔除四边各留 16~30 个世界单位，地面细节留 40），所以提交上来的图元里有
   * 四分之一落在缓冲外面 —— 实测 27246 个里有 6981 个（25.6%）。先排后挑等于拿这四分之
   * 一陪跑完整趟基数排序。
   *
   * 而这一趟本来就要走一遍 n（算量化深度、取深度值域），把剔除并进来不多花任何一趟：
   * 后面两轮基数排序和发射循环的规模直接少四分之一。
   */
  private sortedOrder(n: number, clipW: number, clipH: number): Float64Array {
    if (this.keys.length < n) {
      const capacity = Math.max(n, 4096, Math.ceil(this.keys.length * 1.5));
      this.keys = new Float64Array(capacity);
      this.sortScratch = new Float64Array(capacity);
      this.quantizedDepth = new Float64Array(capacity);
    }
    const depth = this.depth;
    const quantized = this.quantizedDepth;
    const keys = this.keys;
    const clip = clipW > 0 && clipH > 0;
    let lo = Infinity;
    let hi = -Infinity;
    // m 是活下来的个数；keys 前 m 个位置存它们的原始下标。quantized 仍然按**原始下标**
    // 存，基数排序那几轮读的就是 quantized[source[i]]，不用跟着搬。
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (clip) {
        const ex = this.ex[i];
        const ey = this.ey[i];
        // 旋转矩形/椭圆的轴对齐包围盒。方向是存好的，这里没有三角函数，也不值得为
        // "没转过"再分一次支 —— 那时 cos 是 1、sin 是 0，同一个式子照样算对。
        const ca = Math.abs(this.rcos[i]);
        const sa = Math.abs(this.rsin[i]);
        const hx = ex * ca + ey * sa;
        const hy = ex * sa + ey * ca;
        const x = this.cx[i];
        const y = this.cy[i];
        if (x + hx < 0 || x - hx > clipW || y + hy < 0 || y - hy > clipH) continue;
      }
      const q = Math.round(depth[i] * DEPTH_QUANT);
      quantized[i] = q;
      keys[m++] = i;
      if (q < lo) lo = q;
      if (q > hi) hi = q;
    }
    this.lastCulled = n - m;
    if (m === 0) return keys.subarray(0, 0);

    const span = hi - lo + 1;
    // 每轮只处理 11 位，用 2048 个桶；正常画幅两轮即可，不受远处特效的深度跨度影响。
    if (span <= 0x100000000) {
      const counts = this.depthCounts;
      let source = keys;
      let target = this.sortScratch;
      for (let shift = 0; shift < 32 && 2 ** shift < span; shift += 11) {
        counts.fill(0);
        for (let i = 0; i < m; i++) counts[((quantized[source[i]] - lo) >>> shift) & 2047]++;
        let offset = 0;
        for (let bucket = 0; bucket < counts.length; bucket++) {
          const count = counts[bucket];
          counts[bucket] = offset;
          offset += count;
        }
        // 从前往后放，保证等深图元仍按提交顺序。
        for (let i = 0; i < m; i++) {
          const index = source[i];
          target[counts[((quantized[index] - lo) >>> shift) & 2047]++] = index;
        }
        const previous = source;
        source = target;
        target = previous;
      }
      return source.subarray(0, m);
    }
    const bias = 1 - lo; // 键必须非负，取下标时才能用取模
    const indexSpan = Math.max(INDEX_SPAN, n);
    const order = keys.subarray(0, m);
    for (let i = 0; i < m; i++) {
      const index = order[i];
      order[i] = (quantized[index] + bias) * indexSpan + index;
    }
    order.sort();
    for (let i = 0; i < m; i++) order[i] %= indexSpan;
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
    // 排序那一趟顺带把画面外的挑掉了，所以这里剩下的全是要画的。
    const order = this.sortedOrder(n, clipW, clipH);
    const visible = order.length;

    for (let k = 0; k < visible; k++) {
      const i = order[k];
      const x = this.cx[i];
      const y = this.cy[i];
      const ex = this.ex[i];
      const ey = this.ey[i];

      const color = this.col[i];
      if (this.kind[i] === 0) {
        const c = this.rcos[i];
        const s = this.rsin[i];
        if (s === 0 && c === 1) {
          mesh.quad(x - ex, y - ey, x + ex, y - ey, x + ex, y + ey, x - ex, y + ey, color);
        } else {
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
        mesh.ellipse(x, y, ex, ey, this.rot[i], color);
      }
    }
  }

  /** 按角度提交。三角函数在这里算一次，之后整条路上不再有第二次。 */
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
    this.emit(kind, x, y, ex, ey, rot, Math.cos(rot), Math.sin(rot), color, depth);
  }

  /** 按单位方向向量提交。手上已经有方向的（bar）走这条，省掉 atan2。 */
  private emit(
    kind: number,
    x: number,
    y: number,
    ex: number,
    ey: number,
    rot: number,
    cos: number,
    sin: number,
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
    this.rcos[i] = cos;
    this.rsin[i] = sin;
    this.col[i] = color;
    this.depth[i] = depth;
  }


  /** 上一次 flush 里被兜底裁剪丢掉的图元数。用来判断哪一层该自己做范围裁剪。 */
  lastCulled = 0;
}
