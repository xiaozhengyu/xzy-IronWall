import { v2 } from '../core/math';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';
import type { Terrain } from './terrain';
import { type Weather, shadowed } from './weather';

/**
 * 摆在场上的东西。目前只有营火，移植自 overlord 的 PropCatalog.Campfire。
 *
 * 它们和树的区别在于**摆**还是**长**：树按噪声撒在林地里，营地是人选的位置。所以树的
 * 位置是哈希算出来的（不用存），营地是一个显式的列表。
 *
 * 两者都用同一套语法搭：堆叠的硬边横带。这不是省事 —— 一个上了明暗的圆锥或者一团渐变的
 * 火焰在像素网格上都会糊成一坨，而一叠横带的每一条边都是台阶，台阶在任何尺寸下都读得出来。
 */

export type PropKind = 'campfire';

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  /** 错开柴堆的方向，免得一片火烧得一模一样。 */
  flip: boolean;
  /** 绕不进去的半径，世界单位。 */
  radius: number;
}

// ---------------------------------------------------------------- 尺度与调色

/**
 * 营火比一个兵的膝盖高一点。
 *
 * 按真实比例（一堆火到膝盖）画出来只有两三个像素，在一片草簇里认不出来 —— 而营火在这张
 * 图上要说的是"这一带有人扎过营"，说不出来的道具等于没有。
 */
const FIRE_HEIGHT = 7.6;
/** 绕得过去，但绕不进去。一队人从火堆上直接踩过去，比没有火更糟。 */
const FIRE_RADIUS = FIRE_HEIGHT * 0.28;

const ASH = rgb(150, 146, 138);
const CHAR = rgb(46, 40, 36);
// 柴必须明显亮过烧焦的中心。第一版给了 (56,44,33)，和 CHAR 的 (46,40,36) 差十个色阶 ——
// 柴画上去了，但和它躺着的那块地一个颜色，等于没画。对比留在部件之间，这是同一条原则。
const LOG_DARK = rgb(96, 72, 46);
const LOG_LIT = rgb(138, 106, 68);
const FLAME_MID = rgb(232, 128, 42);
const FLAME_LIGHT = rgb(252, 206, 96);
/**
 * 火光洒在地上的一圈暖色。
 *
 * 大白天的火不会在草地上投出一圈光晕 —— 第一版给得又大又亮，读成地上一块发黄的怪斑。
 * 收到只比灰圈大一点、几乎看不见，它的作用是让火脚下的草暖一度，而不是当一盏灯。
 * 等做了昼夜再把它放大。
 */
const FIRE_GLOW = rgba(255, 176, 78, 22);

export class Props {
  readonly list: Prop[] = [];

  /**
   * 在场上挑几处扎营。
   *
   * 条件是开阔（不在林子里、不在水里、不在路上）而且彼此隔开 —— 三顶挤在一起的帐篷是
   * 一个村子，散开的两三处才是"行军途中歇脚的地方"。营火配在帐篷边上，因为营火单独出现
   * 读不出人味，而一帐一火就是一个宿营点。
   */
  place(terrain: Terrain, count = 7, seed = 991): void {
    let s = seed >>> 0;
    const rand = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };

    for (let attempt = 0; attempt < 600 && this.list.length < count; attempt++) {
      const x = 120 + rand() * (terrain.width - 240);
      const y = 120 + rand() * (terrain.height - 240);
      const m = terrain.sample(x, y);
      // 开阔地，不在水里、林子里、路上。
      if (m.water > 0.15 || m.forest > 0.35 || m.dirt > 0.4) continue;
      // 彼此隔开。挤在一起的几堆火是一个营地，散开的才是"沿途歇脚的地方"。
      if (this.list.some((p) => Math.hypot(p.x - x, p.y - y) < 280)) continue;
      this.list.push({ kind: 'campfire', x, y, flip: rand() < 0.5, radius: FIRE_RADIUS });
    }
  }

  /** 遍历一个圆附近的道具。碰撞用。 */
  forEachNear(x: number, y: number, reach: number, cb: (p: Prop) => void): void {
    for (const p of this.list) {
      if (Math.abs(p.x - x) > reach + p.radius || Math.abs(p.y - y) > reach + p.radius) continue;
      cb(p);
    }
  }

  draw(
    shapes: ShapeBatch,
    weather: Weather,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    scale: number,
    halfW: number,
    halfH: number,
  ): void {
    for (const p of this.list) {
      if (Math.abs(p.x - camX) > halfW + 60 || Math.abs(p.y - camY) > halfH + 60) continue;
      const s = v2(rootX + (p.x - camX) * scale, rootY + (p.y - camY) * Projection.groundSquash * scale);
      // 和人物、树共用一套行深度，所以人能走到火堆后面去。
      campfire(shapes, s, scale, weather, weather.cloudShade(p.x, p.y), p.x, p.y);
    }
  }
}

/**
 * 营火：一圈灰、两根交叉的柴、两团火焰、一柱烟。
 *
 * 地上那圈烧白的灰是最认得出营火的东西 —— 少了它火焰是浮在草上的。火焰跟着风走，而这一条
 * 是白捡的：sway 本来就按离地高度缩放，所以柴不动、焰在动。一堆静止的火放在一片会摆的草
 * 里，是画面上唯一不动的东西，那比没有火更显眼。
 */
function campfire(
  shapes: ShapeBatch,
  s: { x: number; y: number },
  scale: number,
  weather: Weather,
  cloud: number,
  worldX: number,
  worldY: number,
): void {
  const h = FIRE_HEIGHT * Projection.heightSquash * scale;
  const r = FIRE_HEIGHT * 0.5 * scale;
  const depth = s.y * Projector.DEPTH_PER_ROW;
  const tone = (c: Rgba): Rgba => shadowed(weather.grade(c, 0.35), cloud);

  // 火光洒在地上的一圈暖色，压在灰底下。它是自己的光源，所以不走 grade。
  shapes.ellipse(s, r * 1.6, r * 1.6 * Projection.groundSquash, 0, FIRE_GLOW, depth - 12);

  // 一圈灰，再套一圈烧焦的黑心。灰圈只比柴堆大一点 —— 第一版铺得太开，火反而成了
  // 中间那个小点，整堆读作"地上一个洞"。
  shapes.ellipse(s, r * 0.95, r * 0.95 * Projection.groundSquash, 0, tone(ASH), depth - 10);
  shapes.ellipse(s, r * 0.58, r * 0.58 * Projection.groundSquash, 0, tone(CHAR), depth - 9);

  // 交叉的柴。两根，一暗一亮，交叉才读作"架起来的"而不是"掉在地上的"。
  const log = Math.max(1.5, 0.3 * FIRE_HEIGHT * scale * 0.5);
  shapes.bar(v2(s.x - r * 0.72, s.y + r * 0.2), v2(s.x + r * 0.68, s.y - r * 0.12), log, tone(LOG_DARK), depth);
  shapes.bar(v2(s.x - r * 0.62, s.y - r * 0.16), v2(s.x + r * 0.7, s.y + r * 0.18), log * 0.85, tone(LOG_LIT), depth + 0.01);

  // 两团独立跳动的火焰。用两个不同频率，火才不会像在呼吸。
  const flick1 = 0.82 + Math.sin(weather.time * 7.3 + worldX * 0.1) * 0.18;
  const flick2 = 0.82 + Math.sin(weather.time * 11.1 + worldY * 0.13) * 0.18;
  const sway = weather.sway(worldX, worldY, h);

  // 火焰要压过柴堆，不是从柴缝里冒一点点。外焰宽一点、内焰高一点，两层之间那道硬边
  // 就是火的形状。
  shapes.ellipse(
    v2(s.x + sway.x * 0.5, s.y - h * 0.5),
    r * 0.62,
    h * 0.52 * flick1,
    0,
    FLAME_MID,
    depth + 0.02,
  );
  shapes.ellipse(
    v2(s.x + sway.x * 0.9 + r * 0.06, s.y - h * 0.78),
    r * 0.34,
    h * 0.38 * flick2,
    0,
    FLAME_LIGHT,
    depth + 0.03,
  );

  // 一柱细烟。慢慢侧向卷一下，免得看着像一根旗杆。
  const rise = h * 1.9;
  const phase = (weather.time * 0.19) % 1;
  for (let puff = 0; puff < 3; puff++) {
    const life = (phase + puff * 0.33) % 1;
    const curl = Math.sin(weather.time * 0.52 + puff * 1.9) * r * 0.5 + sway.x * (0.6 + life * 1.6);
    const at = v2(s.x + curl, s.y - h - rise * (0.15 + life * 0.9));
    const alpha = Math.round(120 * (1 - life));
    if (alpha <= 3) continue;
    shapes.ellipse(at, r * (0.5 + life * 0.7), r * (0.5 + life * 0.7) * 0.8, 0, rgba(186, 194, 184, alpha), depth + 0.04);
  }
}

/** 营火在夜里能照多远。留给以后做昼夜时用。 */
export const FIRE_LIGHT_RADIUS = FIRE_HEIGHT * 1.7;

export const PropSpec = { fireHeight: FIRE_HEIGHT };
