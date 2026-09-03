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
 */
export function drawAegisDome(
  shapes: ShapeBatch,
  sx: number,
  sy: number,
  radius: number,
  lift: number,
  thickness: number,
  blink: number,
  depth: number,
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
}
