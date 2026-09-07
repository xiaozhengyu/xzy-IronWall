import { type Rgba, rgb } from './color';

/**
 * 竖直宝剑：等宽矩形剑身，顶部两行收成小三角剑尖。
 * 白色刃边、亮青色剑身、洋红护手与紫色握柄。
 * 剑尖是唯一热点，用高饱和配色与战场兵器区分。
 * HUD 覆盖层、浏览器原生光标和离线预览共用这一份像素数据。
 */
const SHAPE = [
  '................',
  '................',
  '.......L........',
  '......LSS.......',
  '.....LSSSS......',
  '.....LSSSS......',
  '.....LSSSS......',
  '.....LSSSS......',
  '.....LSSSS......',
  '...GGGGGGGGG....',
  '......HHH.......',
  '......HHH.......',
  '......HHH.......',
  '.....GGGGG......',
  '................',
  '................',
];

const COLORS: Record<string, Rgba> = {
  L: rgb(248, 255, 255),
  S: rgb(0, 240, 255),
  G: rgb(255, 72, 216),
  H: rgb(140, 72, 204),
};
const OUTLINE = rgb(7, 12, 24);
const WIDTH = SHAPE[0].length;
const HEIGHT = SHAPE.length;

/** 保留原版两格描边：第一圈含对角，第二圈只扩展上下左右。 */
const GRID: (Rgba | null)[] = (() => {
  let grid: (Rgba | null)[] = SHAPE.flatMap(row => [...row].map(cell => COLORS[cell] ?? null));
  for (let step = 0; step < 2; step++) {
    const next = grid.slice();
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (grid[y * WIDTH + x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (step > 0 && dx !== 0 && dy !== 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && grid[ny * WIDTH + nx]) {
              next[y * WIDTH + x] = OUTLINE;
            }
          }
        }
      }
    }
    grid = next;
  }
  return grid;
})();

export const POINTER_SHAPE = {
  width: WIDTH,
  height: HEIGHT,
  hotX: 7,
  hotY: 2,
};

/** 逐格回调，坐标相对于剑尖；透明格不输出。 */
export function forEachCursorPixel(px: number, cb: (x: number, y: number, color: Rgba) => void): void {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const color = GRID[y * WIDTH + x];
      if (color) cb((x - POINTER_SHAPE.hotX) * px, (y - POINTER_SHAPE.hotY) * px, color);
    }
  }
}
