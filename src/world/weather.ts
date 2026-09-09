import { clamp, lerp, v2, type Vec2 } from '../core/math';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 天气。移植自 overlord 的 Rendering.Weather。
 *
 * 它做四件互相独立的事，分开看才不会打结：
 *   1. 积累状态 —— snowCover / wetness，两个缓慢变化的标量，是地面外观的输入。
 *   2. 给颜色定调 —— grade() 把任意一个表面色改成"这种天气下它该有的样子"。
 *   3. 云影 —— 一张在世界上飘的低频场，只影响地面亮度。
 *   4. 下落物 —— 雨丝和雪片，画在所有东西之前。
 *
 * 前两件是慢变的（十几秒才走完），第三件是连续飘动的。这个区别决定了渲染架构：慢变的
 * 可以烘进地面纹理并在跨过档位时重烘，飘动的只能每帧当叠加层画。
 */

export type WeatherKind = 'clear' | 'rain' | 'snow';

const MAX_DROPS = 420;
/** 下落物按这个边长的世界方格平铺，镜头周围铺 2x2 块。 */
const DROP_TILE = 520;

/** 雨滴雪片那一层，和落地的水点。两者只差一档：水点是落在地上的记号，该在雨丝之下。 */
const DEPTH_PRECIP = Projector.DEPTH_OVERLAY + 10;
const DEPTH_SPLASH = Projector.DEPTH_OVERLAY;
const CLOUD_GRID = 16;

const SNOW_GROUND = rgb(220, 226, 232);
const RAIN_INK = rgba(150, 176, 196, 150);
const SPLASH_INK = rgba(178, 200, 214, 120);
const SNOW_INK = rgb(238, 243, 248);

interface Drop {
  /** 它会落在世界的哪一点（相对平铺方格）。 */
  gx: number;
  gy: number;
  /** 离地面平面多高，世界单位。 */
  height: number;
  speed: number;
  /** 每片自己的相位，雪才不会整齐划一地飘。 */
  drift: number;
}

export class Weather {
  kind: WeatherKind = 'clear';

  /** 0 是无风，1 是能把草压倒。 */
  windSpeed = 0.35;
  /** 风吹向哪边，地面平面上的弧度。 */
  windAngle = 0.55;
  /** 下多大。和风分开：暴风雪是两者都有，冻雨只有一样。 */
  intensity = 0.7;
  /** 晴天时天上有多少云。0 是万里无云的正午。 */
  cloudiness = 0.55;

  time = 0;

  /**
   * 地上积了多少雪，0..1。它不是"正在下雪"，是"地上已经白了多少" —— 雪停之后它还在，
   * 而且化得比积得快。
   */
  snowCover = 0;
  /** 雨对地面做同样的事：湿了就变暗。 */
  wetness = 0;

  private readonly drops: Drop[] = [];
  private readonly cloud = new Float32Array((CLOUD_GRID + 1) * (CLOUD_GRID + 1));
  private cloudStrength = 0;
  private cloudMin = v2(0, 0);
  private cloudSpan = v2(1, 1);
  private seed = 20260902;

  constructor() {
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push(this.newDrop(true));
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  get windDirection(): Vec2 {
    return v2(Math.cos(this.windAngle), Math.sin(this.windAngle));
  }

  /** 阵风：稳定的风上叠两个不同周期的波，所以它永远不会正好重复。 */
  get gust(): number {
    return 0.62 + 0.38 * Math.sin(this.time * 0.63) + 0.14 * Math.sin(this.time * 1.9 + 1.3);
  }

  private get dropCeiling(): number {
    return this.kind === 'snow' ? 180 : 340;
  }

  private newDrop(anywhere: boolean): Drop {
    return {
      gx: this.rand() * DROP_TILE,
      gy: this.rand() * DROP_TILE,
      height: (anywhere ? this.rand() : 1) * this.dropCeiling,
      speed: 0.7 + this.rand() * 0.6,
      drift: this.rand() * Math.PI * 2,
    };
  }

  update(dt: number): void {
    this.time += dt;

    const wantSnow = this.kind === 'snow' ? this.intensity : 0;
    const wantWet = this.kind === 'rain' ? this.intensity : 0;

    // 积得比化得慢四倍 —— 现实里这两件事就差这个量级，而且一张瞬间变回绿色的地图看着像 bug。
    this.snowCover = ease(this.snowCover, wantSnow, dt * (wantSnow > this.snowCover ? 0.1 : 0.28));
    this.wetness = ease(this.wetness, wantWet, dt * (wantWet > this.wetness ? 0.5 : 0.16));

    if (this.kind === 'clear') return;

    const fall = this.kind === 'snow' ? 44 : 520;
    const wind = this.windDirection;
    const push = this.windSpeed * this.gust;

    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.height -= fall * d.speed * dt;

      // 雪轻到能被风横着带走，雨不能 —— 会飘的雨看着像被电风扇吹的。
      const carry = this.kind === 'snow' ? 26 : 6;
      d.gx += wind.x * push * carry * dt;
      d.gy += wind.y * push * carry * dt;
      if (this.kind === 'snow') d.gx += Math.sin(this.time * 1.7 + d.drift) * 5 * dt;

      if (d.height <= 0) this.drops[i] = this.newDrop(false);
    }
  }

  // ---------------------------------------------------------------- 它对东西做什么

  /**
   * 一个表面在这种天气下的样子。
   *
   * exposure 是这个表面实际留得住多少雪，这是整个设计的关键。全强度地给所有东西上色会把
   * 地图漂白：第一版把树冠和水面连同草地一起刷白，一片冬天的林子出来像一张晒过头的照片。
   * 雪落在地上、在立起来的东西上挂住一点、不在开阔水面上停留。
   *
   * 雨不按 exposure 加权：什么都会湿。
   */
  grade(c: Rgba, exposure = 1): Rgba {
    let out = c;

    if (this.snowCover > 0.001 && exposure > 0.001) {
      // 每一档要混向的那个白会按它本来的明度偏一点。全部混向同一个平白会让三档收敛成一档：
      // 一片深草地会变成一张纸，而地面层存在的全部意义（成团的明暗）恰好在地面最显眼的
      // 时候消失了。
      const lum = (out.r * 30 + out.g * 59 + out.b * 11) / 100;
      const bias = clamp((lum - 76) / 4, -14, 14);
      const k = clamp(this.snowCover * 1.15, 0, 0.94) * exposure;
      out = {
        r: Math.round(lerp(out.r, clamp(SNOW_GROUND.r + bias, 0, 255), k)),
        g: Math.round(lerp(out.g, clamp(SNOW_GROUND.g + bias, 0, 255), k)),
        b: Math.round(lerp(out.b, clamp(SNOW_GROUND.b + bias, 0, 255), k)),
        a: out.a,
      };
    }

    if (this.wetness > 0.001) {
      // 湿地面是更暗、更灰，不是更蓝。给雨加蓝调是让一个场景看起来像忘了摘滤镜的头号做法。
      const k = this.wetness * 0.34;
      const grey = (out.r * 30 + out.g * 59 + out.b * 11) / 100;
      out = {
        r: Math.round(out.r * (1 - k) + grey * k * 0.75),
        g: Math.round(out.g * (1 - k) + grey * k * 0.75),
        b: Math.round(out.b * (1 - k) + grey * k * 0.9),
        a: out.a,
      };
    }

    return out;
  }

  /**
   * 在同一种材质的夏色和冬色之间取。
   *
   * 这是雪上到树冠的办法，它取代了以前盖在每个树冠上的一个白盖子 —— 一个圆盘贴在树冠上
   * 读作贴纸，而地图上每棵树戴着同一个则读作错误。
   *
   * 当初用盖子是因为把树冠混向白会得到灰绿色，那看着像病了而不是像下雪。这一点仍然成立，
   * 但那是反对混向**白**，不是反对改颜色。在两个手挑的调色板之间取值没有难看的中点，
   * 因为两端都是选过的，中间都在连接两个可用颜色的那条线上。
   */
  season(summer: Rgba, winter: Rgba): Rgba {
    if (this.snowCover <= 0.001) return summer;
    const k = clamp(this.snowCover * 1.2, 0, 1);
    return {
      r: Math.round(lerp(summer.r, winter.r, k)),
      g: Math.round(lerp(summer.g, winter.g, k)),
      b: Math.round(lerp(summer.b, winter.b, k)),
      a: summer.a,
    };
  }

  /**
   * 一个扎根在 world 处、在屏幕上有 screenHeight 那么高的东西，顶端被吹偏多少像素。
   *
   * 一个稳定的倾斜加一个振荡，都按高度缩放，相位沿地面推进 —— 于是一阵风是扫过田野的，
   * 而不是所有草叶一起动。Y 分量跟着地面平面被压扁：草尖是被沿着地面推，不是穿过空气。
   */
  sway(worldX: number, worldY: number, screenHeight: number): Vec2 {
    if (this.windSpeed <= 0.001) return v2(0, 0);
    const phase = this.time * 2.3 - (worldX * 0.055 + worldY * 0.04);
    const amount = this.windSpeed * this.gust * screenHeight * (0.3 + 0.22 * Math.sin(phase));
    const dir = this.windDirection;
    return v2(dir.x * amount, dir.y * amount * Projection.groundSquash);
  }

  // ---------------------------------------------------------------- 云影

  /**
   * 在一块世界矩形上重铺云的格点。每帧画地面之前调一次。
   */
  prepareClouds(minX: number, minY: number, maxX: number, maxY: number): void {
    // 阴天没有云影，因为所有东西已经在一片影子里了。在暴风雪下画移动的暗斑是天空在自相矛盾。
    this.cloudStrength = this.cloudiness * (1 - clamp(Math.max(this.snowCover, this.wetness) * 2.2, 0, 1));

    this.cloudMin = v2(minX, minY);
    this.cloudSpan = v2(Math.max(maxX - minX, 1), Math.max(maxY - minY, 1));
    if (this.cloudStrength <= 0.001) return;

    // 顺风飘，而且比地面的风快 —— 掠过田野的云影是视野里最快的那个慢东西，把它和草速
    // 对齐会让两者都显得卡住。
    const dir = this.windDirection;
    const drift = this.time * (26 + this.windSpeed * 130);
    const driftX = dir.x * drift;
    const driftY = dir.y * drift;

    for (let gy = 0; gy <= CLOUD_GRID; gy++) {
      const wy = (minY + (this.cloudSpan.y * gy) / CLOUD_GRID - driftY) * 0.0062;
      for (let gx = 0; gx <= CLOUD_GRID; gx++) {
        const wx = (minX + (this.cloudSpan.x * gx) / CLOUD_GRID - driftX) * 0.0047;
        const v =
          Math.sin(wx) * Math.sin(wy * 1.3 + 0.7) + 0.62 * Math.sin(wx * 2.1 + 1.9) * Math.sin(wy * 1.7 - 0.4);
        // 按覆盖率分档：大部分是太阳，上面横着几道清晰的影子，而不是一片一半发暗的地。
        this.cloud[gy * (CLOUD_GRID + 1) + gx] = clamp((v - 0.3) * 1.9, 0, 1);
      }
    }
  }

  /** 一个点陷在云影里多深，0..1，已经按天气缩放过。 */
  cloudShade(worldX: number, worldY: number): number {
    if (this.cloudStrength <= 0.001) return 0;

    const fx = clamp((worldX - this.cloudMin.x) / this.cloudSpan.x, 0, 1) * CLOUD_GRID;
    const fy = clamp((worldY - this.cloudMin.y) / this.cloudSpan.y, 0, 1) * CLOUD_GRID;
    const x0 = Math.min(fx | 0, CLOUD_GRID - 1);
    const y0 = Math.min(fy | 0, CLOUD_GRID - 1);
    const tx = fx - x0;
    const ty = fy - y0;

    const a = y0 * (CLOUD_GRID + 1) + x0;
    const top = lerp(this.cloud[a], this.cloud[a + 1], tx);
    const bottom = lerp(this.cloud[a + CLOUD_GRID + 1], this.cloud[a + CLOUD_GRID + 2], tx);
    return lerp(top, bottom, ty) * this.cloudStrength;
  }

  /** 云影的格点，给叠加层用。行优先，(CLOUD_GRID+1)²。 */
  get cloudLattice(): Float32Array {
    return this.cloud;
  }
  static get latticeSize(): number {
    return CLOUD_GRID + 1;
  }

  // ---------------------------------------------------------------- 下落物

  /**
   * 镜头和地面之间的雨或雪。
   *
   * 画成同一片下落场在世界对齐的格子上铺开的四块。它会重复，而这个密度下没人看得出来；
   * 换来的是每一滴属于地图上的一个位置，于是平移镜头是从雨里穿过去，而不是把雨拖着走。
   */
  draw(shapes: ShapeBatch, camX: number, camY: number, rootX: number, rootY: number, scale: number): void {
    if (this.kind === 'clear' || this.intensity <= 0.01) return;

    const active = Math.floor(MAX_DROPS * clamp(this.intensity, 0, 1));
    const originX = Math.floor(camX / DROP_TILE - 0.5) * DROP_TILE;
    const originY = Math.floor(camY / DROP_TILE - 0.5) * DROP_TILE;

    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        this.drawTile(shapes, active, originX + tx * DROP_TILE, originY + ty * DROP_TILE, camX, camY, rootX, rootY, scale);
      }
    }
  }

  private drawTile(
    shapes: ShapeBatch,
    active: number,
    ox: number,
    oy: number,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    scale: number,
  ): void {
    const dir = this.windDirection;
    const push = this.windSpeed * this.gust;

    for (let i = 0; i < active; i++) {
      const d = this.drops[i];
      const wx = ox + d.gx;
      const wy = oy + d.gy;
      const gxs = rootX + (wx - camX) * scale;
      const gys = rootY + (wy - camY) * Projection.groundSquash * scale;

      // 所有东西都落在所有东西前面：降水在镜头和世界之间，不参与排序。深度取
      // DEPTH_OVERLAY 那一档，见它自己的注释 —— 原来写死的 16000 只压得住第 500 行以上的人。
      const sy = gys - d.height * Projection.heightSquash * scale;

      if (this.kind === 'snow') {
        const size = Math.max(1, 1.4 * scale * d.speed);
        shapes.rect(v2(gxs, sy), size, size, 0, SNOW_INK, DEPTH_PRECIP);
        continue;
      }

      // 一条线，不是一个点：这个下落速度下一滴雨一帧要走好几个像素，把"它刚才在哪"和
      // "它现在在哪"一起画出来才是雨。被风斜到看得出来 —— 大风里画成近乎垂直的雨，
      // 正是让天气看起来是画上去而不是刮过去的那个细节。
      const len = (5 + d.speed * 5) * Math.max(scale, 0.5);
      shapes.bar(v2(gxs, sy), v2(gxs - dir.x * push * len * 1.9, sy + len), Math.max(0.9, scale * 0.8), RAIN_INK, DEPTH_PRECIP);

      // 落地前最后一段在地上留一个点。没有水花的雨看着像从世界旁边落过去，而不是落到世界上。
      if (d.height < 26) {
        const k = 1 - d.height / 26;
        shapes.rect(v2(gxs, gys), 3 * scale, 1, 0, rgba(SPLASH_INK.r, SPLASH_INK.g, SPLASH_INK.b, Math.round(SPLASH_INK.a * k)), DEPTH_SPLASH);
      }
    }
  }

  get label(): string {
    return this.kind === 'rain' ? '雨' : this.kind === 'snow' ? '雪' : '晴';
  }
}

/**
 * 朝一个冷色阴影压暗，而不是朝黑。云影是被天空而不是被太阳照亮的地面，而天空是蓝的；
 * 每个通道等量相乘得到的是调光器的那种灰。
 */
export function shadowed(c: Rgba, shade: number): Rgba {
  if (shade <= 0.004) return c;
  const k = shade * 0.34;
  return {
    r: Math.round(c.r * (1 - k)),
    g: Math.round(c.g * (1 - k * 0.92)),
    b: Math.round(c.b * (1 - k * 0.72)),
    a: c.a,
  };
}

function ease(current: number, target: number, rate: number): number {
  return current + (target - current) * clamp(rate, 0, 1);
}
