import { type Vec3, V3_UNIT_X, V3_UNIT_Y, clamp, cross3, dot3, lenSq3, mul3, sub3 } from '../core/math';

/**
 * 解析式双骨骼 IK。给定根节点（胯/肩）和末端目标（脚/手），返回中间关节（膝/肘）的位置。
 *
 * @param pole 期望的弯曲方向。膝盖朝前弯、肘朝后外弯；这个向量垂直于 root->target 的
 *             分量决定肢体往哪边折。
 */
export function solveTwoBoneIk(
  root: Vec3,
  target: Vec3,
  upper: number,
  lower: number,
  pole: Vec3,
): Vec3 {
  let toTarget = sub3(target, root);
  let dist = Math.sqrt(lenSq3(toTarget));
  if (dist < 1e-4) {
    toTarget = { x: 0, y: 0, z: -1 };
    dist = 1e-4;
  }
  const dir = mul3(toTarget, 1 / dist);

  // 夹住可达范围，让目标越界或折得太近时三角形仍然有解。
  const min = Math.abs(upper - lower) + 1e-3;
  const max = upper + lower - 1e-3;
  const d = clamp(dist, min, max);

  // 根到关节在 root->target 轴上的投影距离。
  const a = (upper * upper - lower * lower + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));

  // pole 垂直于肢体轴的分量。
  let bend = sub3(pole, mul3(dir, dot3(pole, dir)));
  if (lenSq3(bend) < 1e-6) {
    bend = cross3(dir, V3_UNIT_X);
    if (lenSq3(bend) < 1e-6) bend = cross3(dir, V3_UNIT_Y);
  }
  const bl = Math.sqrt(lenSq3(bend));
  bend = mul3(bend, 1 / bl);

  return {
    x: root.x + dir.x * a + bend.x * h,
    y: root.y + dir.y * a + bend.y * h,
    z: root.z + dir.z * a + bend.z * h,
  };
}
