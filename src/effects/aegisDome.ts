import { v2 } from '../core/math';
import { rgba } from '../render/color';
import { Projection } from '../render/projection';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 金钟罩那个光罩。
 *
 * **画两圈，一圈在地上一圈在身上。** 单画一个屏幕空间的圆读作贴在镜头上的一个环，看不出它
 * 罩着谁；单画一个地面椭圆又读作脚下一个法阵。地上那圈交代"罩子占了这么大一块地"，身上那圈
 * 交代"罩子有高度、玩家在里面"，两圈一起才是个罩子。
 *
 * 抽成一个函数是因为有两个消费者：运行时由 Scene 每帧跟着玩家画，离线由 tools/preview.ts
 * 画进对照图。罩子和别的技能不一样 —— 它不是一瞬间的事件而是一段持续状态，冲击弧那套
 * "放出去就不管了"表达不了它，所以也没法复用特效系统。
 *
 * @param sx/sy  玩家脚下在缓冲里的像素位置
 * @param radius 罩子半径，缓冲像素
 * @param lift   胸口高度在屏幕上抬多少像素
 * @param blink  亮度系数 0..1，快到期时用它闪
 * @param beads  贴着球面飞的小珠子有几颗（= 金钟罩的技能等级）。0 就不画
 * @param time   战斗时钟，秒。只用来定珠子转到哪了
 */
/**
 * 珠子转多快，弧度每秒。
 *
 * 磐石那几颗流星是 2.5，这里给到它的三倍多。两者说的不是同一件事：流星要让玩家看清楚它
 * 转到哪了（它真的打人，转太快就没法预判）；珠子不参与任何判定，它要说的就是"这东西正高速
 * 运转着"，慢下来反而读作几颗挂在壳上的点。
 */
const BEAD_SPIN = 8.5;
/**
 * 尾巴拖过多少弧度，以及分几段采样。
 *
 * 1.15 弧度大约是六分之一圈。比磐石流星那条（0.62）长，因为这里要说的正是"沿着球面绕"，
 * 弧太短就看不出弧。再长会绕过大半个球，读作一根篍在壳上的圈而不是一颗在飞的珠子。
 */
const BEAD_TAIL_ARC = 1.15;
const BEAD_TAIL_SAMPLES = 8;

export function drawAegisDome(
  shapes: ShapeBatch,
  sx: number,
  sy: number,
  radius: number,
  lift: number,
  thickness: number,
  blink: number,
  depth: number,
  beads = 0,
  time = 0,
): void {
  const alpha = Math.round(215 * blink);
  if (alpha <= 3) return;

  // 地上一层很淡的填充。
  //
  // 只有两圈线的话，罩子读作"两个环"而不是"一块被罩住的地" —— 而玩家真正要知道的是"站在
  // 哪儿才安全"。填充给出那块面积，淡到几乎不挡人（底下那几十个人仍然认得出）。
  shapes.ellipse(
    v2(sx, sy),
    radius,
    radius * Projection.groundSquash,
    0,
    rgba(255, 226, 140, Math.round(alpha * 0.17)),
    depth - 0.02,
  );

  // 地上那一圈：被相机压扁的椭圆环。
  shapes.ellipseRing(
    v2(sx, sy),
    radius,
    radius * Projection.groundSquash,
    0,
    Math.max(1, thickness),
    rgba(255, 226, 140, Math.round(alpha * 0.85)),
    depth,
    28,
  );

  // 身上那一圈：抬到胸口高度的一个近似正圆，读作球壳的轮廓。0.86 而不是 1 是因为纵向被
  // 相机压过一点 —— 正圆在这个视角下会读作躺平的盘子。
  shapes.ellipseRing(
    v2(sx, sy - lift),
    radius,
    radius * 0.86,
    0,
    Math.max(1, thickness * 0.85),
    rgba(255, 240, 190, alpha),
    depth + 0.02,
    30,
  );

  drawDomeBeads(shapes, sx, sy - lift, radius, thickness, blink, depth, beads, time);
}

/**
 * 贴着球面飞的那几颗小珠子。**纯装饰，不参与任何碰撞。**
 *
 * 和磐石那几颗流星是两回事，虽然看着像：流星在**地面上**绕着人转，位置由 Battle 每帧
 * 算好，打人的和画出来的读同一个角度；珠子在**球壳上**跑，完全长在渲染这一层，战斗那边根本
 * 不知道它们的存在。所以它只需要一个时钟，不需要任何状态。
 *
 * 为什么要有：罩子本身是两圈线加一层淡填充，它是静的 —— 站在里面那几秒除了倒计时闪那一下，
 * 屏幕上什么都不在变。几颗高速跑的珠子把"这是一个正在运转的东西"说出来了，而升一级多一颗，
 * 升级的回报也看得见。这两条和磐石流星是同一个理由。
 */
function drawDomeBeads(
  shapes: ShapeBatch,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  blink: number,
  depth: number,
  beads: number,
  time: number,
): void {
  if (beads <= 0) return;
  // 珠子比壳子的线粗两圈，但比磐石那几颗流星小：它们是罩子表面的纹，不是另一批东西。
  // 给过 1.35 倍，出图一看是几个淡到以为是脏点的小斑，升一级多一颗也完全看不出来。
  const core = Math.max(1.8, thickness * 1.75);

  for (let i = 0; i < beads; i++) {
    /*
     * 每颗走一条自己的大圆，而且都是**竖的**。
     *
     * 先在 xy 平面上转一个圆，绕 x 轴斜一个角（tilt）把它翻进三维，再绕屏幕法线转一个角
     * （swing）把几条圆错开。不错开的话所有圆都从同两个点穿过，五颗珠子会周期性地碰头，
     * 读作"它们被穿在同一根铁丝上"而不是各飞各的。
     *
     * **tilt 必须离赤道远一点**，这是碰过的：斜得少时（cos tilt 接近 1）圆在屏幕上投成的
     * 椭圆和壳子自己那圈轮廓（1 对 0.86）几乎重合，珠子就贴着轮廓跑 —— 看起来就是“绕着
     * 赤道水平转圈”，球面那层意思一点都没有。现在 cos tilt 压在 0.15..0.65，配上错开的 swing，
     * 每条圆都明显窄于轮廓、且朝向各不相同：有的从头顶翻过去绕到背后，有的斜着跨过整个球面。
     *
     * 转速也逐颗错开一点（× 1 + i × 0.08）：完全同速的话它们的相对位置永远不变，一群定形的
     * 点一起扫过去，看久了像一个刚体在转。
     */
    const tilt = 1.15 + Math.sin(i * 2.1) * 0.28;
    // swing 从竖着那一条开始往两边排，而不是从 0 往上加。swing 接近 0 或者 π 的那一条就是一个
    // 扬平的椭圆，也就是"水平绕圈" —— 而第一颗恰恰是一级金钟罩唯一那一颗，把它排在 0 上等于
    // 让最常见的那个情况长成最不想要的样子。排出来是 1.57 / 1.07 / 2.07 / 0.57 / 2.57，五条都绕到头顶。
    const swing = Math.PI / 2 + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 0.5;
    const spin = BEAD_SPIN * (1 + i * 0.08);
    const a0 = time * spin + i * 2.399;

    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const cs = Math.cos(swing);
    const sn = Math.sin(swing);

    /*
     * 拖尾：沿自己那条圆往回采几段，越往回越淡越细。
     *
     * 没尾巴的时候就是几个在壳上乱跳的亮点 —— 一帧一帧看它在动，但看不出**沿着什么在动**，
     * 而这一条恰恰就是要说的事。尾巴把那条弧画出来一截，“贴着球面绕”才成了一件看得见的事。
     * 和磐石流星、箭、被掀飞的人是同一种画法，只是这里的"过去在哪"要多算一步投影。
     */
    let head: { x: number; y: number } | null = null;
    for (let k = 0; k <= BEAD_TAIL_SAMPLES; k++) {
      const a = a0 - BEAD_TAIL_ARC * (k / BEAD_TAIL_SAMPLES);
      const px = Math.cos(a);
      const py = Math.sin(a) * ct;
      const pz = Math.sin(a) * st;
      // 球面投到屏幕：横向按半径，纵向跟着壳子那圈一起压到 0.86。
      const at2 = {
        x: cx + (px * cs - py * sn) * radius,
        y: cy + (px * sn + py * cs) * radius * 0.86,
      };

      /*
       * 前后两面不一样画。
       *
       * z > 0 是转到我们这一面的，压在壳子之上、亮、大一点；z < 0 是转到背面的，压在壳子之下、
       * 暗、小一点 —— 隔着一层半透的罩子看过去就该是这个样子。两面同一个画法的话，这堆点
       * 读作一圈平的光环，球就没了。每一段尾巴各算各的，所以一条尾巴翻过轮廓时会自己暗下去。
       */
      const front = pz > 0;
      const face = Math.abs(pz);
      const fade = 1 - k / (BEAD_TAIL_SAMPLES + 1);
      const size = core * (front ? 0.86 + face * 0.42 : 0.62 + face * 0.24);
      const glow = Math.round((front ? 255 : 152) * blink * (0.78 + face * 0.22) * fade);
      const layer = depth + (front ? 0.05 : -0.05);

      if (k === 0) {
        if (glow > 3) {
          shapes.disc(v2(at2.x, at2.y), size * 2.1, rgba(255, 196, 92, Math.round(glow * 0.42)), layer);
          shapes.disc(v2(at2.x, at2.y), size, rgba(255, 236, 176, glow), layer + 0.01);
          if (front) {
            shapes.disc(v2(at2.x - size * 0.22, at2.y - size * 0.26), size * 0.44, rgba(255, 252, 236, glow), layer + 0.02);
          }
        }
      } else if (head && glow > 3) {
        shapes.capsule(
          v2(head.x, head.y),
          v2(at2.x, at2.y),
          Math.max(0.7, size * (0.2 + fade * 0.38)),
          rgba(255, 206, 120, Math.round(glow * 0.75)),
          layer - 0.01,
        );
      }
      head = at2;
    }
  }
}
