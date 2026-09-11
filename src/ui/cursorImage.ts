import { POINTER_SHAPE, forEachCursorPixel } from '../render/pointerShape';

/**
 * 那把当光标的剑。**它是一枚真的 CSS cursor，由系统来画。**
 *
 * 像素数据在 render/pointerShape.ts，和离线出图共用同一份。这里把它铺成位图、绕剑尖转 45°，
 * 再烘成带热点的 data URL。剑尖是唯一的热点，旋转和加边距都得把它一起搬过去。
 *
 * 周期性变色不走 CSS 动画，而是预先烘好十几张轮流换（见 startCursorBreathing）。
 */

/** 原始像素图为 16×16，放大两倍再旋转；画布跟着扩，避免护手和描边被裁掉。 */
const PIXEL = 2;
const ANGLE = -Math.PI / 4;

/** 烤失败时用什么。默认箭头总比没有光标强。 */
const FALLBACK = 'auto';

interface CursorImage {
  url: string;
  width: number;
  height: number;
  hotX: number;
  hotY: number;
}

let cached: CursorImage | null | undefined;
let cachedSprite: Sprite | null | undefined;

interface Sprite {
  canvas: HTMLCanvasElement;
  hotX: number;
  hotY: number;
}

/**
 * 旋转完的那把剑，还没变成 data URL。
 *
 * 单独抽出来是因为呼吸变色要拿它重复烘十几遍（见 cursorFrames），而把像素铺一遍再转 45 度
 * 这一步每张都是一样的。
 */
function cursorSprite(): Sprite | null {
  if (cachedSprite !== undefined) return cachedSprite;

  const w = POINTER_SHAPE.width * PIXEL;
  const h = POINTER_SHAPE.height * PIXEL;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    cachedSprite = null;
    return cachedSprite;
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
    cachedSprite = null;
    return cachedSprite;
  }
  const hotX = -minX;
  const hotY = -minY;
  rotatedContext.imageSmoothingEnabled = false;
  rotatedContext.translate(hotX, hotY);
  rotatedContext.rotate(ANGLE);
  rotatedContext.drawImage(canvas, -sourceHotX, -sourceHotY);

  cachedSprite = { canvas: rotated, hotX, hotY };
  return cachedSprite;
}

function cursorImage(): CursorImage | null {
  if (cached !== undefined) return cached;
  const sprite = cursorSprite();
  if (!sprite) {
    cached = null;
    return cached;
  }
  try {
    cached = {
      url: sprite.canvas.toDataURL('image/png'),
      width: sprite.canvas.width,
      height: sprite.canvas.height,
      hotX: sprite.hotX,
      hotY: sprite.hotY,
    };
  } catch {
    cached = null;
  }
  return cached;
}

function cursorCss(): string {
  const image = cursorImage();
  return image ? `url(${image.url}) ${image.hotX} ${image.hotY}, ${FALLBACK}` : FALLBACK;
}

/*
 * 呼吸变色：**烘成几张原生光标，轮流换**，而不是拿一个 div 跟着鼠标跑。
 *
 * 原来那把剑是个 `<div>`，在 mousemove 里改 left/top 挪过去，真光标用 cursor:none 藏掉。
 * 那样它永远差系统一拍：系统光标是合成器在显示管线最末端画的，而这个 div 要走完事件派发 →
 * JS → 样式 → 布局 → 绘制 → 合成 → 等垂直同步，六十赫兹下至少落后一帧；鼠标采样率高于屏幕
 * 刷新率时，系统光标在两帧之间还会动，div 连这一段都没有。玩家的说法是"不跟手"，而那不是
 * 错觉，是这套画法的必然结果。
 *
 * 换成 CSS 的 cursor 就由系统来画，跟手程度和原生光标完全一样。代价是原生光标不能挂 CSS
 * 动画 —— 所以把色相那一圈**预先烘成十几张图**，定时换 `style.cursor`。系统照样零延迟地画，
 * 而剑仍然在呼吸。
 *
 * 发光也得一起烘进图里（原来是 CSS 的 drop-shadow）。所以每张图四周留一圈 padding，热点跟着
 * 平移同样多，否则剑尖会偏出去一小截 —— 而剑尖正是这枚光标唯一的热点。
 */

/** 呼吸一圈多少毫秒。和原来那条 CSS 动画一致。 */
const BREATH_MS = 3000;
/**
 * 半圈烘几张。一圈是去程加回程，所以实际步数是 (N - 1) × 2 = 30 步，每步 100 毫秒。
 *
 * 不能太多：每张都是一个几 KB 的 data URL，而且第一次用到时浏览器要解一次码。十六张在
 * 色相上每步约七度，肉眼看不出台阶。
 */
const BREATH_FRAMES = 16;
/** 四周留给发光的余量，像素。取比最大那档模糊半径大一点。 */
const GLOW_PAD = 5;

/** 色相转多少度。和原来那条 CSS 动画的 0 → 110 一致。 */
const HUE_SWING = 110;

/** 两头的发光。色相转过去的同时，光晕从青换成品红、再散开一点。 */
const GLOW_FROM = { r: 0, g: 240, b: 255, blur: 2 };
const GLOW_TO = { r: 235, g: 72, b: 255, blur: 3 };

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 烘一张：色相转 t 那么多，再叠上对应的光晕。
 *
 * 滤镜的顺序和原来那条 CSS 动画一样是先 hue-rotate 后 drop-shadow —— 反过来的话光晕自己也会
 * 被转色，青色那一头会变成别的颜色。
 */
function bakeFrame(sprite: Sprite, t: number): CursorImage | null {
  const canvas = document.createElement('canvas');
  canvas.width = sprite.canvas.width + GLOW_PAD * 2;
  canvas.height = sprite.canvas.height + GLOW_PAD * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const blur = mix(GLOW_FROM.blur, GLOW_TO.blur, t);
  const r = Math.round(mix(GLOW_FROM.r, GLOW_TO.r, t));
  const g = Math.round(mix(GLOW_FROM.g, GLOW_TO.g, t));
  const b = Math.round(mix(GLOW_FROM.b, GLOW_TO.b, t));
  ctx.imageSmoothingEnabled = false;
  // Canvas 的 filter 不是每个浏览器都有。没有就只是少一层光晕和变色，剑本身照画 —— 和
  // cursorImage 拿不到 2d 上下文时退回系统箭头是同一个取向：缺了装饰不该让光标消失。
  ctx.filter = `hue-rotate(${(HUE_SWING * t).toFixed(1)}deg) drop-shadow(0 0 ${blur.toFixed(2)}px rgba(${r}, ${g}, ${b}, 0.65))`;
  ctx.drawImage(sprite.canvas, GLOW_PAD, GLOW_PAD);

  try {
    return {
      url: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
      hotX: sprite.hotX + GLOW_PAD,
      hotY: sprite.hotY + GLOW_PAD,
    };
  } catch {
    return null;
  }
}

let cachedFrames: CursorImage[] | undefined;

/** 呼吸一圈的所有帧，去程那一半；回程原样倒着放。 */
function cursorFrames(): CursorImage[] {
  if (cachedFrames) return cachedFrames;
  const sprite = cursorSprite();
  if (!sprite) {
    cachedFrames = [];
    return cachedFrames;
  }
  const frames: CursorImage[] = [];
  for (let i = 0; i < BREATH_FRAMES; i++) {
    const frame = bakeFrame(sprite, i / Math.max(1, BREATH_FRAMES - 1));
    if (frame) frames.push(frame);
  }
  cachedFrames = frames;
  return cachedFrames;
}

const cssOf = (image: CursorImage): string => `url(${image.url}) ${image.hotX} ${image.hotY}, ${FALLBACK}`;

let breathing: number | null = null;

/**
 * 把呼吸着的剑装到 `document.body` 上。重复调用无效。
 *
 * 页面藏起来时停表：换一个看不见的光标毫无意义，而这一圈每秒要改十次样式。回到前台接着走，
 * 相位从哪儿断的就从哪儿续 —— 色相本来就是个环，看不出接缝。
 */
export function startCursorBreathing(): void {
  if (breathing !== null) return;
  const frames = cursorFrames();
  if (frames.length === 0) {
    document.body.style.cursor = cursorCss();
    return;
  }
  // 第一次用到某张图时浏览器要解一次码，正赶上换帧就会闪一下系统箭头。开场先各解一遍。
  for (const frame of frames) new Image().src = frame.url;

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  if (frames.length === 1 || still.matches) {
    document.body.style.cursor = cssOf(frames[0]);
    return;
  }

  // 去程 N 张、回程 N-2 张（两头不重复），一圈 (N-1)×2 步。
  const steps = (frames.length - 1) * 2;
  let step = 0;
  const tick = (): void => {
    const index = step < frames.length ? step : steps - step;
    document.body.style.cursor = cssOf(frames[index]);
    step = (step + 1) % steps;
  };
  tick();
  breathing = setInterval(tick, Math.max(16, Math.round(BREATH_MS / steps)));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (breathing !== null) {
        clearInterval(breathing);
        breathing = -1;
      }
    } else if (breathing === -1) {
      breathing = setInterval(tick, Math.max(16, Math.round(BREATH_MS / steps)));
    }
  });
}
