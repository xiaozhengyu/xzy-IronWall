import { SWORD_CURSOR, forEachCursorPixel } from '../render/swordCursor';

/**
 * 把准心那把剑烤成一张 CSS 光标图，给**菜单和开始画面**用。
 *
 * 游戏里指针是锁定的，系统光标根本不显示，画面上那把剑是 Scene 每帧画进缓冲的；而菜单、
 * 开始画面、加载画面这些时候指针没锁，露出来的是系统箭头 —— 一半是剑一半是箭头，接缝很明显。
 *
 * 做法是把同一份像素数据（render/swordCursor.ts）在一张离屏 canvas 上逐格画出来，转成
 * data URI 挂进 CSS 的 cursor。所以形状只有一处定义，改了剑三个地方一起变。
 *
 * 尺寸压在 32×32 以内：浏览器对 CSS 光标图有尺寸上限，超过之后各家的行为不一样（有的直接
 * 退回默认箭头）。十六格 × 每格两像素正好卡在这个数上。
 */

/** 一格几个 CSS 像素。2 让整张图落在 32×32，是各浏览器都稳的尺寸。 */
const PIXEL = 2;

/** 烤失败时用什么。默认箭头总比没有光标强。 */
const FALLBACK = 'auto';

export interface SwordCursorImage {
  url: string;
  width: number;
  height: number;
  hotX: number;
  hotY: number;
}

let cached: SwordCursorImage | null | undefined;

export function swordCursorImage(): SwordCursorImage | null {
  if (cached !== undefined) return cached;

  const w = SWORD_CURSOR.width * PIXEL;
  const h = SWORD_CURSOR.height * PIXEL;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    cached = null;
    return cached;
  }

  const hotX = SWORD_CURSOR.hotX * PIXEL;
  const hotY = SWORD_CURSOR.hotY * PIXEL;
  // forEachCursorPixel 给的偏移是相对**剑尖**的，加回热点就是图内坐标。
  forEachCursorPixel(PIXEL, (ox, oy, color) => {
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${(color.a / 255).toFixed(3)})`;
    ctx.fillRect(hotX + ox, hotY + oy, PIXEL, PIXEL);
  });

  try {
    cached = { url: canvas.toDataURL('image/png'), width: w, height: h, hotX, hotY };
  } catch {
    cached = null;
  }
  return cached;
}

export function swordCursorCss(): string {
  const image = swordCursorImage();
  return image ? `url(${image.url}) ${image.hotX} ${image.hotY}, ${FALLBACK}` : FALLBACK;
}
