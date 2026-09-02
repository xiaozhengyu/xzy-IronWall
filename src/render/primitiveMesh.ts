import { Buffer, BufferUsage, Geometry, GlProgram, Mesh, Rectangle, Shader } from 'pixi.js';
import { type Rgba } from './color';
import type { PrimitiveSink } from './shapeBatch';

/**
 * 直接往顶点缓冲里写三角形，绕开 Pixi 的 Graphics。
 *
 * 为什么必须绕开。满屏一千人时一帧有四万八千个图元，而 Graphics 在这个量级上有两笔都很贵的
 * 开销，实测（自动化环境，绝对值偏大但比例有效）：
 *
 *   往 GraphicsContext 里下四万八千次指令        约 50 毫秒
 *   Pixi 把它们三角化并绘制                      约 78~100 毫秒
 *
 * 前一笔纯粹是 API 调用的代价 —— 每次 rect/ellipse 都要新建 Rectangle/Circle 对象、克隆一次
 * 变换矩阵、把 fill 样式转成内部结构。后一笔里旋转矩形还要走 earcut 通用耳切（把它们改走
 * "变换 + 矩形"的快路径能省下两成，但也就两成）。两笔加起来每个图元约 2.7 微秒，这个数字
 * 乘四万八千就是这条路的天花板，再怎么调都翻不过去。
 *
 * 而这些图元本来就是**已经算好的三角形**：矩形是两个三角形，圆盘是一把扇形。自己写进
 * Float32Array 再交给一个 Mesh，每个图元只剩几十纳秒的数组写入。
 *
 * 这也正是 ShapeBatch 顶上那段注释里说的、移植时因为"WebGL 这边没有等价的廉价通道"而放弃
 * 的做法 —— 那个判断当时是对的，但 Pixi 8 的自定义 Mesh 已经把这条通道给回来了。
 */

/**
 * 圆盘/椭圆展开成多少段。
 *
 * 沿用 Pixi 的公式再封一个顶：段数少了轮廓会和原来对不上。离线逐像素比过 —— 段数压到
 * 6/8/12 那一档时，有 0.8% 的像素和 Graphics 那条路不同（都在圆的边缘）；照 Pixi 的公式
 * 走，差异降到 0.0%（8928 个像素里差 3 个）。
 *
 * 敢用大段数是因为三角形本身不要钱：满屏一千人也就三十几万个三角形，GPU 根本不在乎。
 * 真正会疼的是每段一次 cos/sin，那笔开销由下面的单位圆查表消掉了。
 */
function segmentsFor(rx: number, ry: number): number {
  const n = Math.ceil(2.3 * Math.sqrt(rx + ry)) * 4;
  return n < 6 ? 6 : n > 32 ? 32 : n;
}

/**
 * 单位圆的采样表，按段数缓存。
 *
 * 不查表的话，八千多个椭圆乘二十来段就是每帧二十万次 cos/sin —— 那笔钱比它省下的三角形贵
 * 得多。段数只有十来种取值，表一次建好就一直用。
 */
const unitCircles = new Map<number, Float32Array>();
function unitCircle(n: number): Float32Array {
  let t = unitCircles.get(n);
  if (!t) {
    t = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      t[i * 2] = Math.cos(a);
      t[i * 2 + 1] = Math.sin(a);
    }
    unitCircles.set(n, t);
  }
  return t;
}

/** 顶点着色器。uniform 的名字必须和 Pixi 内部约定一致，绑定由 Mesh 的适配器负责。 */
const VERTEX = `#version 300 es
in vec2 aPosition;
in vec4 aColor;

out vec4 vColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);

    // 输出预乘 alpha：Pixi 的默认混合是 (ONE, ONE_MINUS_SRC_ALPHA)，不预乘的话半透明的
    // 冲击弧和云影会偏亮。
    vec4 c = aColor * uColor * uWorldColorAlpha;
    vColor = vec4(c.rgb * c.a, c.a);
}
`;

const FRAGMENT = `#version 300 es
precision mediump float;

in vec4 vColor;
out vec4 finalColor;

void main(void) {
    finalColor = vColor;
}
`;

export class PrimitiveMesh implements PrimitiveSink {
  readonly mesh: Mesh<Geometry, Shader>;

  private positions: Float32Array;
  private colors: Uint32Array;
  private indices: Uint32Array;

  private readonly posBuffer: Buffer;
  private readonly colBuffer: Buffer;
  private readonly idxBuffer: Buffer;

  private vertices = 0;
  private indexCount = 0;
  /** 上一帧用到哪儿。这一帧短了就得把多出来的那截抹成退化三角形，否则会画出上一帧的残留。 */
  private lastIndexCount = 0;
  /** 索引缓冲实际画到哪儿的高水位线。只涨不落，见 end()。 */
  private drawSpan = 0;
  /** 装不下而被丢掉的图元数。正常应当一直是 0；不是的话说明容量估小了。 */
  overflow = 0;

  /**
   * @param capacity 预留多少个顶点。四万八千个图元大约要十八万个顶点，给一倍余量。
   */
  constructor(capacity = 400_000) {
    this.positions = new Float32Array(capacity * 2);
    this.colors = new Uint32Array(capacity);
    this.indices = new Uint32Array(capacity * 3);

    this.posBuffer = new Buffer({ data: this.positions, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.colBuffer = new Buffer({ data: this.colors, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.idxBuffer = new Buffer({ data: this.indices, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    // 一开始就把绘制长度收到零，之后由高水位线往上顶 —— 否则第一帧会照着四十万条索引画。
    this.idxBuffer.setDataWithSize(this.indices.subarray(0, 0), 0, false);

    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.posBuffer, format: 'float32x2' },
        // unorm8x4：一个顶点四个字节，着色器里拿到的是 0..1。比四个 float 省四分之三带宽。
        aColor: { buffer: this.colBuffer, format: 'unorm8x4' },
      },
      indexBuffer: this.idxBuffer,
    });

    const shader = new Shader({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'primitive-batch' }),
    });

    this.mesh = new Mesh({ geometry, shader });

    // 给一个固定的包围盒，别让 Pixi 去扫顶点缓冲。
    //
    // 默认它会遍历 aPosition 求 min/max —— 而这个缓冲按最坏情况开了几十万个顶点，每帧扫一遍
    // 就是上百万次浮点读取，而且剔除和渲染各会问一次。这一条不做，光算包围盒就能把主线程
    // 拖到卡死（实测页面直接没响应）。批次画的东西本来就铺满整个缓冲，固定给一个大框即可。
    this.mesh.boundsArea = new Rectangle(-1e5, -1e5, 2e5, 2e5);
    this.mesh.cullable = false;
  }

  /** 一帧的开始。 */
  begin(): void {
    this.vertices = 0;
    this.indexCount = 0;
    this.overflow = 0;
  }

  /**
   * 一个凸四边形，顶点按顺时针或逆时针给。矩形（含旋转）都走这里。
   */
  quad(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    color: Rgba,
  ): void {
    if (this.vertices + 4 > this.colors.length || this.indexCount + 6 > this.indices.length) {
      this.overflow++;
      return;
    }
    const v = this.vertices;
    const p = this.positions;
    let o = v * 2;
    p[o] = x0; p[o + 1] = y0;
    p[o + 2] = x1; p[o + 3] = y1;
    p[o + 4] = x2; p[o + 5] = y2;
    p[o + 6] = x3; p[o + 7] = y3;

    const packed = packColor(color);
    const c = this.colors;
    c[v] = packed; c[v + 1] = packed; c[v + 2] = packed; c[v + 3] = packed;

    const idx = this.indices;
    o = this.indexCount;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;

    this.vertices = v + 4;
    this.indexCount = o + 6;
  }

  /** 一个椭圆（圆盘是 rx === ry），扇形展开。 */
  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, color: Rgba): void {
    const n = segmentsFor(rx, ry);
    if (this.vertices + n + 1 > this.colors.length || this.indexCount + n * 3 > this.indices.length) {
      this.overflow++;
      return;
    }
    const packed = packColor(color);
    const p = this.positions;
    const c = this.colors;
    const idx = this.indices;

    const center = this.vertices;
    p[center * 2] = cx;
    p[center * 2 + 1] = cy;
    c[center] = packed;

    const ring = unitCircle(n);
    if (rotation === 0) {
      // 绝大多数是不旋转的圆盘，省掉四次乘法。
      for (let i = 0; i < n; i++) {
        const v = center + 1 + i;
        p[v * 2] = cx + ring[i * 2] * rx;
        p[v * 2 + 1] = cy + ring[i * 2 + 1] * ry;
        c[v] = packed;
      }
    } else {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      for (let i = 0; i < n; i++) {
        const ex = ring[i * 2] * rx;
        const ey = ring[i * 2 + 1] * ry;
        const v = center + 1 + i;
        p[v * 2] = cx + ex * cos - ey * sin;
        p[v * 2 + 1] = cy + ex * sin + ey * cos;
        c[v] = packed;
      }
    }

    let o = this.indexCount;
    for (let i = 0; i < n; i++) {
      idx[o] = center;
      idx[o + 1] = center + 1 + i;
      idx[o + 2] = center + 1 + ((i + 1) % n);
      o += 3;
    }

    this.vertices = center + n + 1;
    this.indexCount = o;
  }

  /**
   * 一帧的结束：把用到的那一段传上去。
   *
   * 只传用到的字节，不是整个缓冲 —— 容量是按最坏情况开的，每帧全传就是白白搬几兆。
   *
   * 绘制数量这件事有个坑：Pixi 画的是 `size || indexBuffer.data.length`，而 Mesh 的适配器
   * 不传 size，所以它照着索引缓冲的**整个长度**画。想每帧换一个长度就得换 data 视图，而
   * Buffer 在新视图更长时会重建 GPU 缓冲 —— 而每帧的图元数一直在浮动，那就是每帧重建。
   *
   * 所以用一条**高水位线**：drawSpan 只涨不落，视图缓存下来（data 对象不变，Buffer 就只
   * 走"更新"不走"重建"）。这一帧没用满的那一截抹成退化三角形 —— 三个顶点同一个，面积为
   * 零，光栅化阶段直接丢掉，而且索引重复能命中顶点缓存，几乎不要钱。
   */
  end(): void {
    // 只需要抹掉"上一帧用了、这一帧没用"的那一段：再往后的部分按归纳法本来就是零。
    if (this.indexCount < this.lastIndexCount) {
      this.indices.fill(0, this.indexCount, this.lastIndexCount);
    }
    this.lastIndexCount = this.indexCount;

    if (this.indexCount > this.drawSpan) {
      this.drawSpan = this.indexCount;
      this.idxBuffer.setDataWithSize(this.indices.subarray(0, this.drawSpan), this.drawSpan, false);
    }

    this.posBuffer.update(this.vertices * 2 * 4);
    this.colBuffer.update(this.vertices * 4);
    this.idxBuffer.update(this.drawSpan * 4);
  }

  destroy(): void {
    this.mesh.destroy(true);
  }
}

/** RGBA 打进一个 32 位数。小端下字节序正好是 R,G,B,A，和 unorm8x4 对得上。 */
function packColor(c: Rgba): number {
  return ((c.a << 24) | (c.b << 16) | (c.g << 8) | c.r) >>> 0;
}
