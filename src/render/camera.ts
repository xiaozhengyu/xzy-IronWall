import { clamp, v2, type Vec2 } from '../core/math';
import { Projection } from './projection';

/**
 * 世界坐标和屏幕像素之间的全部换算，集中在一个对象里。
 *
 * 这些数字以前散在 main.ts 的模块作用域里（grain、magnify、camera、halfW/halfH、rootX/rootY、
 * screenOf、viewRadius），谁都能读也谁都能改。它们其实是同一件事的不同侧面 —— "世界上的一点
 * 落在缓冲的哪个像素上" —— 所以但凡有一处算错，症状都是"东西画歪了"，而根本看不出该去哪儿找。
 * 合成一个对象之后，投影只有这一份定义。
 */
export class Camera {
  /** 滚轮每一格的缩放系数，以及能拉到的两头。 */
  static readonly ZOOM_STEP = 1.14;
  /** 下限放到 0.22 是为了让整片场地能塞进一屏 —— 那是调试用的全景，不是给玩家的视野。 */
  static readonly MIN_GRAIN = 0.22;
  static readonly MAX_GRAIN = 8;
  static readonly DEFAULT_GRAIN = 3;

  /**
   * 投影缩放，决定**人由多少个像素构成**。1 是 overlord 的出货尺寸（人约 12 像素高），
   * 越大人身上的像素越细。超过 2 会打开细节层级（甲片、金边这些）。
   */
  grain = Camera.DEFAULT_GRAIN;

  /**
   * 一个缓冲像素在屏幕上占多少个物理像素，决定**一个像素有多大**。必须是整数，否则最近邻
   * 放大会让某些像素比邻居宽一格，那正是像素画最典型的抖动。
   *
   * grain 和 magnify 的乘积才是人在屏幕上的大小。想要"同样大小、更细的颗粒"就调高 grain、
   * 调低 magnify。定下来的是 grain 3 / magnify 2：人 37 像素高，屏幕上 74 物理像素。这是
   * 几档里观感最好的一档 —— 再粗脸就糊成一团，再细像素感就没了。改之前先跑 `npm run figures`。
   */
  magnify = 2;

  /** 设备像素比。缓冲按物理像素定尺寸，所以换算 CSS 像素（比如鼠标增量）时要用它。 */
  resolution = 1;

  /** 镜头中心的世界坐标。跟随玩家，但被夹在场地内。 */
  x = 0;
  y = 0;

  /** 像素缓冲的尺寸。由 Scene 在每次 resize 之后同步过来。 */
  viewWidth = 0;
  viewHeight = 0;

  /** 视野的半宽/半高，世界单位。纵向要把相机的压扁除回去。 */
  get halfW(): number {
    return (this.viewWidth * 0.5) / this.grain;
  }
  get halfH(): number {
    return (this.viewHeight * 0.5) / (this.grain * Projection.groundSquash);
  }

  /** 缓冲的中心像素，也就是镜头中心投影到的那一点。 */
  get rootX(): number {
    return Math.round(this.viewWidth * 0.5);
  }
  get rootY(): number {
    return Math.round(this.viewHeight * 0.5);
  }

  /**
   * 跟着一个点走，但夹在场地里。
   *
   * 人不钉死在屏幕中心：场地是有边界的，镜头贴着边走出去就会露出场外的虚空。所以镜头跟随
   * 玩家、但被夹在场内，玩家走到角落时是他在画面上偏出去，而不是画面跟着飘出场。
   * 场地在某个轴上比视野还小时就居中 —— 夹取的上下界会交叉，不特判会抖。
   */
  follow(targetX: number, targetY: number, fieldW: number, fieldH: number): void {
    const hw = this.halfW;
    const hh = this.halfH;
    this.x = fieldW <= hw * 2 ? fieldW * 0.5 : clamp(targetX, hw, fieldW - hw);
    this.y = fieldH <= hh * 2 ? fieldH * 0.5 : clamp(targetY, hh, fieldH - hh);
  }

  /** 世界上的一点落在缓冲的哪个像素上。 */
  worldToScreen(worldX: number, worldY: number): Vec2 {
    return v2(
      this.rootX + (worldX - this.x) * this.grain,
      this.rootY + (worldY - this.y) * Projection.groundSquash * this.grain,
    );
  }

  /**
   * 从世界上的一点看向缓冲里的某个像素，是地面平面上的哪个方向。
   *
   * 原点必须是**那个人在屏幕上的位置**，不是屏幕中心。这两者只在场地正中才重合：镜头一旦被
   * 夹在场边，人就从画面中心偏出去，按中心算出来的方向会整体偏一个角 —— 准星明明在人身后，
   * 人却朝着别处，越贴边偏得越狠。
   *
   * 纵向还要把 groundSquash 除回去。屏幕的纵向被相机压扁了，直接对屏幕增量取 atan2 会让人
   * "看不准"，越接近正上/正下偏得越多。先还原成地面平面上的方向再取角度，人的前轴投影回
   * 屏幕才真正压在准星上。
   *
   * @returns 弧度；准星几乎压在人身上时返回 null（那时方向没有意义）。
   */
  aimAngle(fromX: number, fromY: number, screenX: number, screenY: number): number | null {
    const at = this.worldToScreen(fromX, fromY);
    const dx = screenX - at.x;
    const dy = (screenY - at.y) / Projection.groundSquash;
    if (Math.hypot(dx, dy) <= 0.5) return null;
    return Math.atan2(dy, dx);
  }

  /** 视野在世界坐标里的半径。出怪要生成在这个圈之外，玩家才看不见他们凭空出现。 */
  get viewRadius(): number {
    return Math.hypot(this.halfW, this.halfH);
  }

  /**
   * 滚轮/按键缩放。乘性步进而不是加性 —— 缩放在感觉上是几何的，每一格该是"再放大一成"，
   * 而不是"再加 0.5"，否则拉远时越来越慢、拉近时越来越粗暴。
   */
  zoom(inward: boolean): void {
    const step = inward ? Camera.ZOOM_STEP : 1 / Camera.ZOOM_STEP;
    this.grain = clamp(this.grain * step, Camera.MIN_GRAIN, Camera.MAX_GRAIN);
  }

  /** 一键回到出货尺寸。调试拉远之后找回来，比一格一格滚回去快。 */
  resetZoom(): void {
    this.grain = Camera.DEFAULT_GRAIN;
  }

  /** 放大只走整数，见 magnify 上的注释。 */
  nudgeMagnify(delta: number): void {
    this.magnify = clamp(this.magnify + delta, 1, 8);
  }

  /** 人在缓冲里有多少像素高，以及放大到屏幕上是多少物理像素。面板上要显示。 */
  figureSize(figureUnits: number): { buffer: number; screen: number } {
    const buffer = Math.round(figureUnits * this.grain);
    return { buffer, screen: Math.round((buffer * this.magnify) / (this.resolution || 1)) };
  }
}
