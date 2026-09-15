import { clamp, lerp } from '../core/math';

/** 分量都是 0..255。移植自 MonoGame 的 Color，但这里是直通 alpha，不做预乘。 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const rgb = (r: number, g: number, b: number): Rgba => ({ r, g, b, a: 255 });
export const rgba = (r: number, g: number, b: number, a: number): Rgba => ({ r, g, b, a });

/** Pixi 的 fill 取 0xRRGGBB，alpha 单独给。 */

export const lerpColor = (a: Rgba, b: Rgba, t: number): Rgba => ({
  r: Math.round(lerp(a.r, b.r, t)),
  g: Math.round(lerp(a.g, b.g, t)),
  b: Math.round(lerp(a.b, b.b, t)),
  a: Math.round(lerp(a.a, b.a, t)),
});

export const shade = (c: Rgba, factor: number): Rgba => ({
  r: Math.round(clamp(c.r * factor, 0, 255)),
  g: Math.round(clamp(c.g * factor, 0, 255)),
  b: Math.round(clamp(c.b * factor, 0, 255)),
  a: c.a,
});

const PALE: Rgba = { r: 238, g: 234, b: 226, a: 255 };

/**
 * 双向的亮度调整。
 *
 * 乘法只适合压暗：头发 (58,40,28) 乘 1.5 还是头发。所以大于 1 时改成向暖白混合，
 * 这才是把一个深色脑袋变成浅色帽子的做法。
 */
export const tone = (c: Rgba, t: number): Rgba => {
  if (t <= 1) return shade(c, t);
  const mix = clamp(t - 1, 0, 1);
  return {
    r: Math.round(lerp(c.r, PALE.r, mix)),
    g: Math.round(lerp(c.g, PALE.g, mix)),
    b: Math.round(lerp(c.b, PALE.b, mix)),
    a: c.a,
  };
};
