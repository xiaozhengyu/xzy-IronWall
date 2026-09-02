import type { Props } from '../world/props';
import type { Terrain } from '../world/terrain';

/**
 * 走位碰撞。
 *
 * 只有一类东西挡路：圆形障碍（树干、营火）。处理方式是**推开**而不是硬挡 —— 人贴着走
 * 过去会蹭着边滑开，这是"绕过去"该有的手感；硬挡会让人顶在树上不动。
 *
 * **水面不挡路。** 池塘和雨后的洼地是同一件事：能踩进去，踩进去溅水花。这一条决定了这个
 * 文件的全部形状 —— 之前水是拦住的，为此有一整套"整步被拒就分轴重试、两轴都堵就沿岸线
 * 切线滑"的逻辑，还得算水深梯度。水一旦能走，那些全是死代码，所以一并删掉了。留着两套
 * 并存的移动规则是以后最容易搞混的东西。
 *
 * 障碍列表每次现查现用。树的位置是哈希算出来的（不存表），营火是一个几项的列表，所以
 * "查一遍附近"比维护一张空间索引还便宜，也不会有索引和真相不同步的问题。
 */

const scratch: { x: number; y: number; radius: number }[] = [];

/**
 * 把一个单位从 (fromX, fromY) 移到 (toX, toY)，处理沿途的障碍。
 *
 * @returns 实际落点。
 */
export function moveWithCollision(
  terrain: Terrain,
  props: Props,
  radius: number,
  _fromX: number,
  _fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number } {
  let x = toX;
  let y = toY;

  scratch.length = 0;
  terrain.treesNear(x, y, radius, scratch);
  props.forEachNear(x, y, radius, (p) => scratch.push({ x: p.x, y: p.y, radius: p.radius }));
  if (scratch.length === 0) return { x, y };

  // 迭代两遍：被两个障碍夹住时，第一遍推出去还可能落进另一个里。两遍之后仍然重叠的情况
  // 在这个密度下遇不到，而且再多迭代会让贴着障碍走变得发涩。
  for (let pass = 0; pass < 2; pass++) {
    for (const c of scratch) {
      const dx = x - c.x;
      const dy = y - c.y;
      const min = radius + c.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        // 正好压在障碍中心：没有方向可推，随便挑一个，下一帧就正常了。
        x = c.x + min;
        continue;
      }
      const k = (min - d) / d;
      x += dx * k;
      y += dy * k;
    }
  }

  return { x, y };
}

/**
 * 出生点、铺场用：这个位置能不能站人。
 *
 * 水面算能站 —— 从池塘里走出来的敌人是对的，那儿本来就能走。
 */
export function isFreeSpot(terrain: Terrain, props: Props, x: number, y: number, radius: number): boolean {
  scratch.length = 0;
  terrain.treesNear(x, y, radius, scratch);
  props.forEachNear(x, y, radius, (p) => scratch.push({ x: p.x, y: p.y, radius: p.radius }));
  for (const c of scratch) {
    const min = radius + c.radius;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < min * min) return false;
  }
  return true;
}
