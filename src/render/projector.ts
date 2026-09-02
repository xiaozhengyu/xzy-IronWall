import { type Vec2, type Vec3, v2 } from '../core/math';
import { Projection } from './projection';

/**
 * 把身体局部坐标投影到 3/4 俯视的屏幕空间。地面平面被竖直压扁；Z 只是把点沿屏幕往上抬。
 * 移植自 overlord 的 Characters.Projector。
 */
export class Projector {
  /**
   * 每个屏幕行分到的深度预算。一个角色自身各部件跨越的深度远小于这个值，所以站得靠下
   * 一个像素的人一定画在后面那个人之前，而他自己的各个部件之间仍然能正确排序。
   */
  static readonly DEPTH_PER_ROW = 32;

  private readonly root: Vec2;
  private readonly sin: number;
  private readonly cos: number;
  private readonly squash: number;
  readonly baseDepth: number;

  /** 放大倍率。1 是出货尺寸；调试特写用更大的值。 */
  readonly scale: number;

  /**
   * @param depthRow 用来推排序键的屏幕行。通常就是单位自己的落点。
   */
  constructor(screenRoot: Vec2, facing: number, squash: number, scale = 1, depthRow?: number) {
    this.root = screenRoot;
    this.sin = Math.sin(facing);
    this.cos = Math.cos(facing);
    this.squash = squash;
    this.baseDepth = (depthRow ?? screenRoot.y) * Projector.DEPTH_PER_ROW;
    this.scale = scale;
  }

  /** 前方是地面上的 (cos, sin)；右手边是前方转 -90 度。 */
  ground(local: Vec3): Vec2 {
    return v2(local.x * this.sin + local.y * this.cos, -local.x * this.cos + local.y * this.sin);
  }

  screen(local: Vec3): Vec2 {
    const gx = local.x * this.sin + local.y * this.cos;
    const gy = -local.x * this.cos + local.y * this.sin;
    return v2(
      this.root.x + gx * this.scale,
      this.root.y + (gy * this.squash - local.z * Projection.heightSquash) * this.scale,
    );
  }

  /** 画家顺序的排序键：越大越靠近镜头。 */
  depth(local: Vec3): number {
    return this.baseDepth + (-local.x * this.cos + local.y * this.sin) * this.squash;
  }

  /** 身体右轴在屏幕空间的方向，盾牌这类平板件要用。 */
  get rightAxis(): Vec2 {
    return v2(this.sin, -this.cos * this.squash);
  }

  /** 局部上轴在屏幕空间的像。被相机俯角缩短。 */
  static get upAxis(): Vec2 {
    return v2(0, -Projection.heightSquash);
  }

  /** 面朝镜头时 +1，背朝镜头时 -1。 */
  get facingCamera(): number {
    return this.sin;
  }

  /** 身体宽度有多少转向镜头，正侧面时为 0。 */
  get sideOn(): number {
    return Math.abs(this.sin);
  }

  /** 把身体空间的尺寸（粗细、半径）换算成屏幕像素。 */
  s(size: number): number {
    return size * this.scale;
  }

  /** 单位画得够大、细节能在像素网格上活下来时为真。 */
  get detailed(): boolean {
    return this.scale >= 2;
  }

  /** 一个横截面椭圆（横向半宽 halfWidth、纵深半深 halfDepth）看上去的宽度。 */
  crossSectionWidth(halfWidth: number, halfDepth: number): number {
    const a = halfWidth * this.sin;
    const b = halfDepth * this.cos;
    return 2 * Math.sqrt(a * a + b * b) * this.scale;
  }
}

/**
 * 一个立在身体"右/上"平面内的单位圆，在屏幕空间下的两个主轴 —— 也就是那个平面 2x2
 * 投影矩阵的奇异值分解。圆盾要用它才能随着人转身自然地变成一条边。
 */
export function projectUprightDisc(p: Projector): { sx: number; sy: number; rot: number } {
  const right = p.rightAxis;
  const up = Projector.upAxis;

  const m00 = right.x;
  const m10 = right.y;
  const m01 = up.x;
  const m11 = up.y;

  const e = (m00 + m11) * 0.5;
  const f = (m00 - m11) * 0.5;
  const g = (m10 + m01) * 0.5;
  const h = (m10 - m01) * 0.5;

  const q = Math.sqrt(e * e + h * h);
  const r = Math.sqrt(f * f + g * g);

  return {
    sx: q + r,
    sy: Math.abs(q - r),
    rot: (Math.atan2(h, e) + Math.atan2(g, f)) * 0.5,
  };
}
