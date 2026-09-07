import { POINTER_SHAPE, forEachCursorPixel } from '../render/pointerShape';

/**
 * 光标只烘焙一次：全局 UI 覆盖层使用它，覆盖层未启用时供浏览器 cursor 回退。
 * 两种显示方式共用向左上倾斜 45° 的图片和剑尖热点，不依赖窗口或战场颗粒度。
 */

/** 原始像素图为 32×32，旋转后扩展透明画布，避免护手和描边被裁掉。 */
const PIXEL = 2;
const ANGLE = -Math.PI / 4;

/** 烤失败时用什么。默认箭头总比没有光标强。 */
const FALLBACK = 'auto';

export interface CursorImage {
  url: string;
  width: number;
  height: number;
  hotX: number;
  hotY: number;
}

let cached: CursorImage | null | undefined;

export function cursorImage(): CursorImage | null {
  if (cached !== undefined) return cached;

  const w = POINTER_SHAPE.width * PIXEL;
  const h = POINTER_SHAPE.height * PIXEL;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    cached = null;
    return cached;
  }

  const sourceHotX = POINTER_SHAPE.hotX * PIXEL;
  const sourceHotY = POINTER_SHAPE.hotY * PIXEL;
  // 像素偏移相对剑尖，加回热点就是图内坐标。
  forEachCursorPixel(PIXEL, (ox, oy, color) => {
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${(color.a / 255).toFixed(3)})`;
    ctx.fillRect(sourceHotX + ox, sourceHotY + oy, PIXEL, PIXEL);
  });

  // 围绕剑尖旋转，并从四个角计算新边界；DOM 和原生 cursor 使用同一个旋转后热点。
  const cos = Math.cos(ANGLE);
  const sin = Math.sin(ANGLE);
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => ({
    x: (x - sourceHotX) * cos - (y - sourceHotY) * sin,
    y: (x - sourceHotX) * sin + (y - sourceHotY) * cos,
  }));
  const minX = Math.floor(Math.min(...corners.map(point => point.x)));
  const minY = Math.floor(Math.min(...corners.map(point => point.y)));
  const rotated = document.createElement('canvas');
  rotated.width = Math.ceil(Math.max(...corners.map(point => point.x))) - minX;
  rotated.height = Math.ceil(Math.max(...corners.map(point => point.y))) - minY;
  const rotatedContext = rotated.getContext('2d');
  if (!rotatedContext) {
    cached = null;
    return cached;
  }
  const hotX = -minX;
  const hotY = -minY;
  rotatedContext.imageSmoothingEnabled = false;
  rotatedContext.translate(hotX, hotY);
  rotatedContext.rotate(ANGLE);
  rotatedContext.drawImage(canvas, -sourceHotX, -sourceHotY);

  try {
    cached = { url: rotated.toDataURL('image/png'), width: rotated.width, height: rotated.height, hotX, hotY };
  } catch {
    cached = null;
  }
  return cached;
}

export function cursorCss(): string {
  const image = cursorImage();
  return image ? `url(${image.url}) ${image.hotX} ${image.hotY}, ${FALLBACK}` : FALLBACK;
}
