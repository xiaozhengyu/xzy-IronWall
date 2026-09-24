import type { CollisionBlocker, Props } from '../world/props';
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
 * 障碍列表每次现查现用。树的位置由 Terrain 按散布格缓存，营火是一个几项的列表；
 * 因此这里查附近格子即可，绘制和碰撞仍共用同一份树木数据。
 */

const scratch: CollisionBlocker[] = [];
const terrainScratch: { x: number; y: number; radius: number }[] = [];

function pushOut(x: number, y: number, radius: number, blocker: CollisionBlocker): { x: number; y: number } {
  if (blocker.shape === 'circle') {
    const dx = x - blocker.x;
    const dy = y - blocker.y;
    const min = radius + blocker.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return { x, y };
    const d = Math.sqrt(d2);
    if (d < 1e-4) return { x: blocker.x + min, y: blocker.y };
    const k = (min - d) / d;
    return { x: x + dx * k, y: y + dy * k };
  }

  const c = Math.cos(blocker.rotation);
  const s = Math.sin(blocker.rotation);
  const lx = (x - blocker.x) * c + (y - blocker.y) * s;
  const ly = -(x - blocker.x) * s + (y - blocker.y) * c;
  const hx = blocker.width * 0.5;
  const hy = blocker.height * 0.5;
  const nearestX = Math.max(-hx, Math.min(hx, lx));
  const nearestY = Math.max(-hy, Math.min(hy, ly));
  let dx = lx - nearestX;
  let dy = ly - nearestY;
  const d2 = dx * dx + dy * dy;
  if (d2 >= radius * radius) return { x, y };

  if (d2 < 1e-4) {
    const left = lx + hx;
    const right = hx - lx;
    const top = ly + hy;
    const bottom = hy - ly;
    const nearest = Math.min(left, right, top, bottom);
    if (nearest === left) { dx = -1; dy = 0; }
    else if (nearest === right) { dx = 1; dy = 0; }
    else if (nearest === top) { dx = 0; dy = -1; }
    else { dx = 0; dy = 1; }
    const distance = nearest + radius;
    const pushedX = lx + dx * distance;
    const pushedY = ly + dy * distance;
    return {
      x: blocker.x + pushedX * c - pushedY * s,
      y: blocker.y + pushedX * s + pushedY * c,
    };
  }

  const d = Math.sqrt(d2);
  const k = (radius - d) / d;
  dx *= k;
  dy *= k;
  const pushedX = lx + dx;
  const pushedY = ly + dy;
  return {
    x: blocker.x + pushedX * c - pushedY * s,
    y: blocker.y + pushedX * s + pushedY * c,
  };
}

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
  terrainScratch.length = 0;
  terrain.treesNear(x, y, radius, terrainScratch);
  for (const tree of terrainScratch) scratch.push({ shape: 'circle', ...tree, rotation: 0 });
  props.forEachNear(x, y, radius, (p) => scratch.push(p));
  if (scratch.length === 0) return { x, y };

  // 迭代两遍：被两个障碍夹住时，第一遍推出去还可能落进另一个里。两遍之后仍然重叠的情况
  // 在这个密度下遇不到，而且再多迭代会让贴着障碍走变得发涩。
  for (let pass = 0; pass < 2; pass++) {
    for (const blocker of scratch) {
      const next = pushOut(x, y, radius, blocker);
      x = next.x;
      y = next.y;
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
  terrainScratch.length = 0;
  terrain.treesNear(x, y, radius, terrainScratch);
  for (const tree of terrainScratch) scratch.push({ shape: 'circle', ...tree, rotation: 0 });
  props.forEachNear(x, y, radius, (p) => scratch.push(p));
  for (const blocker of scratch) {
    const moved = pushOut(x, y, radius, blocker);
    if (moved.x !== x || moved.y !== y) return false;
  }
  return true;
}
