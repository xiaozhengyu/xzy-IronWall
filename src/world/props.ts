import { v2 } from '../core/math';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';
import type { Terrain } from './terrain';
import { type Weather, shadowed } from './weather';
import type { ResolvedMapDecoration, ResolvedMapLandmark, ResolvedMapObstacle } from '../data/mapTypes';

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
  /**
   * 被砸掉了没有。一波只点一次，翻页时统一点回来（见 relight）。
   *
   * 篝火是玩家**能自己决定什么时候去拿**的那一份补给（首领是波次给的，他插不上手）。
   * 所以它不是砸掉就没了，而是一波点一次 —— 地图上那几个点于是成了一条可以跑的线路。
   */
  down: boolean;
}

/** Static blockers can be circles or rotated boxes; collision keeps the authored shape. */
export type CollisionBlocker = {
  x: number;
  y: number;
  rotation: number;
} & (
  | { shape: 'circle'; radius: number }
  | { shape: 'box'; width: number; height: number }
);

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
  readonly obstacles: ResolvedMapObstacle[] = [];
  readonly decorations: ResolvedMapDecoration[] = [];
  private readonly blockers: CollisionBlocker[] = [];

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
      this.list.push({ kind: 'campfire', x, y, flip: rand() < 0.5, radius: FIRE_RADIUS, down: false });
    }
  }

  /** Place the map-authored campfires instead of deriving them from terrain sampling. */
  placeAuthored(terrain: Terrain, landmarks: readonly ResolvedMapLandmark[]): void {
    for (const landmark of landmarks) {
      if (landmark.kind !== 'campfire') continue;
      const m = terrain.sample(landmark.x, landmark.y);
      if (m.water > 0.15 || m.forest > 0.35) {
        throw new Error(`Map landmark ${landmark.id} overlaps blocked terrain`);
      }
      if (this.list.some((p) => Math.hypot(p.x - landmark.x, p.y - landmark.y) < 280)) {
        throw new Error(`Map landmark ${landmark.id} overlaps another campfire`);
      }
      this.list.push({
        kind: 'campfire',
        x: landmark.x,
        y: landmark.y,
        flip: this.list.length % 2 === 1,
        radius: FIRE_RADIUS,
        down: false,
      });
    }
  }

  /** Place deterministic map obstacles and expose them to both rendering and collision. */
  placeObstacles(obstacles: readonly ResolvedMapObstacle[]): void {
    this.obstacles.push(...obstacles);
    this.blockers.push(...obstacles);
  }

  /** Place visual-only map decorations; unlike obstacles they never enter collision. */
  placeDecorations(decorations: readonly ResolvedMapDecoration[]): void {
    this.decorations.push(...decorations);
  }

  /** 遍历一个圆附近的道具。碰撞用。 */
  forEachNear(x: number, y: number, reach: number, cb: (p: CollisionBlocker) => void): void {
    for (const p of this.list) {
      // 砸掉的那几堆不拦人。
      if (p.down) continue;
      if (Math.abs(p.x - x) > reach + p.radius || Math.abs(p.y - y) > reach + p.radius) continue;
      cb({ shape: 'circle', x: p.x, y: p.y, radius: p.radius, rotation: 0 });
    }
    for (const obstacle of this.blockers) {
      const extent = obstacle.shape === 'circle'
        ? obstacle.radius
        : Math.hypot(obstacle.width * 0.5, obstacle.height * 0.5);
      if (Math.abs(obstacle.x - x) > reach + extent || Math.abs(obstacle.y - y) > reach + extent) continue;
      cb(obstacle);
    }
  }

  /** 把砸掉的那几堆全点回来。每翻一波叫一次。 */
  relight(): void {
    for (const p of this.list) p.down = false;
  }

  /**
   * 把一个圆里还烧着的篝火全砸掉，返回它们的位置。
   *
   * 返回位置而不是在这里掉东西：Props 是世界里的布景，它不该知道掉落表长什么样。
   */
  breakNear(x: number, y: number, reach: number): { x: number; y: number }[] {
    const broken: { x: number; y: number }[] = [];
    for (const p of this.list) {
      if (p.down) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy > (reach + p.radius) * (reach + p.radius)) continue;
      p.down = true;
      broken.push({ x: p.x, y: p.y });
    }
    return broken;
  }

  /** 还烧着的那几堆。小地图要标出来。 */
  get burning(): readonly Prop[] {
    return this.list.filter((p) => !p.down);
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
      // 砸掉了就不画。不留一堆灰：要说的是"这儿现在没东西了"，而远处一堆灰和一堆火太像。
      if (p.down) continue;
      if (Math.abs(p.x - camX) > halfW + 60 || Math.abs(p.y - camY) > halfH + 60) continue;
      const s = v2(rootX + (p.x - camX) * scale, rootY + (p.y - camY) * Projection.groundSquash * scale);
      // 和人物、树共用一套行深度，所以人能走到火堆后面去。
      campfire(shapes, s, scale, weather, weather.cloudShade(p.x, p.y), p.x, p.y);
    }
    for (const obstacle of this.obstacles) {
      const extent = obstacle.shape === 'circle'
        ? obstacle.radius
        : Math.hypot(obstacle.width * 0.5, obstacle.height * 0.5);
      if (Math.abs(obstacle.x - camX) > halfW + extent || Math.abs(obstacle.y - camY) > halfH + extent) continue;
      const s = v2(rootX + (obstacle.x - camX) * scale, rootY + (obstacle.y - camY) * Projection.groundSquash * scale);
      drawObstacle(shapes, obstacle, s, scale, weather, weather.cloudShade(obstacle.x, obstacle.y));
    }
    for (const decoration of this.decorations) {
      if (Math.abs(decoration.x - camX) > halfW + 80 || Math.abs(decoration.y - camY) > halfH + 80) continue;
      const s = v2(rootX + (decoration.x - camX) * scale, rootY + (decoration.y - camY) * Projection.groundSquash * scale);
      drawDecoration(shapes, decoration, s, scale, weather, weather.cloudShade(decoration.x, decoration.y));
    }
  }
}

const STONE_DARK = rgb(70, 72, 68);
const STONE_MID = rgb(112, 111, 101);
const STONE_LIGHT = rgb(164, 158, 139);
const WOOD_DARK = rgb(61, 45, 31);
const WOOD_MID = rgb(105, 75, 45);
const WOOD_LIGHT = rgb(153, 112, 65);
const RUIN_DARK = rgb(82, 83, 77);
const RUIN_MID = rgb(128, 126, 115);
const RUIN_LIGHT = rgb(174, 168, 151);

function drawObstacle(
  shapes: ShapeBatch,
  obstacle: ResolvedMapObstacle,
  s: { x: number; y: number },
  scale: number,
  weather: Weather,
  cloud: number,
): void {
  const depth = s.y * Projector.DEPTH_PER_ROW;
  const tone = (color: Rgba): Rgba => shadowed(weather.grade(color, 0.34), cloud);
  const shadow = rgba(18, 24, 18, 88);

  if (obstacle.shape === 'circle') {
    const radius = obstacle.radius * scale;
    const palette = obstacle.kind === 'rocks' || obstacle.kind === 'pillar'
      ? [STONE_DARK, STONE_MID, STONE_LIGHT]
      : [RUIN_DARK, RUIN_MID, RUIN_LIGHT];
    if (obstacle.kind === 'pillar') {
      const seed = stableVariant(obstacle.id);
      const height = radius * (7 + (seed % 5) * 0.9);
      const width = radius * (3.1 + (seed % 3) * 0.3);
      drawSteppedStone(shapes, s, width, height, seed, tone, depth);
      return;
    }
    if (obstacle.kind === 'rocks') {
      const variant = stableVariant(obstacle.id) % 3;
      const pieces = variant === 0
        ? [[-0.28, 0.1, 0.66], [0.2, -0.1, 0.82], [0.38, 0.2, 0.48]]
        : variant === 1
          ? [[-0.34, 0.16, 0.56], [0.02, -0.12, 0.84], [0.36, 0.08, 0.62]]
          : [[-0.3, 0.04, 0.72], [0.12, -0.18, 0.58], [0.38, 0.12, 0.72]];
      pieces.forEach(([ox, oy, size], index) => {
        const piece = radius * size;
        const seed = stableVariant(`${obstacle.id}-${index}`);
        const center = v2(s.x + radius * ox, s.y + radius * oy * Projection.groundSquash);
        drawSteppedStone(shapes, center, piece * 2.2, piece * (1.35 + (seed % 3) * 0.12), seed, tone, depth + index * 0.01);
      });
    } else {
      shapes.ellipse(
        v2(s.x, s.y + radius * 0.24 * Projection.groundSquash),
        radius * 1.18,
        radius * 0.56 * Projection.groundSquash,
        0,
        rgba(18, 24, 18, 64),
        depth - 10,
      );
      shapes.sphere(s, radius * 0.78, tone(palette[0]), tone(palette[1]), tone(palette[2]), depth);
    }
    return;
  }

  const width = obstacle.width * scale;
  const height = obstacle.height * Projection.groundSquash * scale;
  const palette = obstacle.kind === 'fence'
    ? [WOOD_DARK, WOOD_MID, WOOD_LIGHT]
    : obstacle.kind === 'ruin'
      ? [RUIN_DARK, RUIN_MID, RUIN_LIGHT]
      : [STONE_DARK, STONE_MID, STONE_LIGHT];
  if (obstacle.kind === 'fence') {
    const ux = Math.cos(obstacle.rotation) * width * 0.5;
    const uy = Math.sin(obstacle.rotation) * width * 0.5 * Projection.groundSquash;
    const postCount = Math.max(5, Math.min(13, Math.ceil(obstacle.width / 20)));
    for (let i = 0; i < postCount; i++) {
      const t = i / Math.max(1, postCount - 1) - 0.5;
      const px = s.x + ux * t * 1.92;
      const py = s.y + uy * t * 1.92;
      const postHeight = (14 + (i % 3) * 2) * scale;
      shapes.rect(v2(px, py - postHeight * 0.48), Math.max(2, 2.8 * scale), postHeight, 0, tone(palette[0]), depth + i * 0.001);
      shapes.rect(v2(px - scale * 0.45, py - postHeight * 0.58), Math.max(1.5, 1.4 * scale), postHeight * 0.68, 0, tone(palette[2]), depth + 0.002 + i * 0.001);
    }
    const railA = v2(s.x - ux, s.y - uy - 5 * scale);
    const railB = v2(s.x + ux, s.y + uy - 5 * scale);
    const railC = v2(s.x - ux, s.y - uy - 11 * scale);
    const railD = v2(s.x + ux, s.y + uy - 11 * scale);
    shapes.bar(railA, railB, Math.max(2, 3.2 * scale), tone(palette[1]), depth + 0.025);
    shapes.bar(railC, railD, Math.max(1.5, 2.2 * scale), tone(palette[2]), depth + 0.026);
    return;
  }

  const alongX = obstacle.width >= obstacle.height;
  const major = Math.max(obstacle.width, obstacle.height);
  const minor = Math.min(obstacle.width, obstacle.height);
  const blocks = Math.max(1, Math.ceil(major / 42));
  const blockLength = major / blocks;
  const axisX = alongX ? Math.cos(obstacle.rotation) : -Math.sin(obstacle.rotation);
  const axisY = (alongX ? Math.sin(obstacle.rotation) : Math.cos(obstacle.rotation)) * Projection.groundSquash;
  const blockW = (alongX ? blockLength : minor) * scale;
  const blockH = (alongX ? minor : blockLength) * Projection.groundSquash * scale;
  shapes.rect(v2(s.x, s.y + blockH * 0.16), alongX ? width * 1.04 : width, height * 1.04, obstacle.rotation, shadow, depth - 10);
  for (let course = 0; course < 2; course++) {
    for (let i = 0; i < blocks; i++) {
      const offset = (i + 0.5 - blocks * 0.5) * blockLength + (course === 1 ? blockLength * 0.28 : 0);
      const center = v2(
        s.x + axisX * offset * scale,
        s.y + axisY * offset * scale - course * minor * 0.62 * scale,
      );
      const variant = stableVariant(`${obstacle.id}-${course}-${i}`);
      const raised = minor * (course === 0 ? 1.8 : 1.4) * scale;
      drawMasonryBlock(
        shapes,
        center,
        blockW * (0.82 + (variant % 3) * 0.07),
        blockH * 0.68,
        raised,
        obstacle.rotation,
        palette.map(tone),
        depth + course * 0.002 + i * 0.003,
        variant,
      );
    }
  }
}

function stableVariant(id: string): number {
  let value = 17;
  for (let i = 0; i < id.length; i++) value = (value * 31 + id.charCodeAt(i)) >>> 0;
  return value % 11;
}

function drawSteppedStone(
  shapes: ShapeBatch,
  foot: { x: number; y: number },
  width: number,
  height: number,
  variant: number,
  tone: (color: Rgba) => Rgba,
  depth: number,
): void {
  shapes.ellipse(foot, width * 0.62, width * 0.22 * Projection.groundSquash, 0, rgba(18, 24, 18, 82), depth - 8);
  const levels = 5;
  const bandH = height / (levels + 0.2);
  const profile = [0.68, 0.9, 1, 0.86, 0.57];
  for (let i = 0; i < levels; i++) {
    const taper = profile[(i + variant) % levels];
    const bandW = width * taper;
    const offset = Math.sin((variant + i) * 1.7) * width * 0.055;
    const y = foot.y - height + bandH * (i + 0.52);
    shapes.rect(v2(foot.x + offset, y), bandW, bandH * 1.05, 0, tone(STONE_DARK), depth + i * 0.002);
    shapes.rect(v2(foot.x + offset - width * 0.04, y - bandH * 0.03), bandW * 0.76, bandH * 0.78, 0, tone(STONE_MID), depth + 0.02 + i * 0.002);
    if (i < levels - 1) {
      shapes.rect(v2(foot.x + offset - bandW * 0.18, y - bandH * 0.36), bandW * 0.34, Math.max(1, bandH * 0.14), 0, tone(STONE_LIGHT), depth + 0.04 + i * 0.002);
    }
  }
  shapes.rect(v2(foot.x, foot.y - height + bandH * 0.38), width * 0.28, Math.max(1, bandH * 0.2), 0, tone(STONE_LIGHT), depth + 0.06);
}

function drawMasonryBlock(
  shapes: ShapeBatch,
  center: { x: number; y: number },
  width: number,
  footprint: number,
  faceHeight: number,
  rotation: number,
  palette: readonly Rgba[],
  depth: number,
  variant: number,
): void {
  const blockWidth = Math.max(2, width);
  const blockDepth = Math.max(2, footprint);
  const height = Math.max(blockDepth, faceHeight);
  shapes.rect(v2(center.x, center.y - height * 0.26), blockWidth * 0.94, height * 0.92, rotation, palette[0], depth);
  shapes.rect(v2(center.x - blockWidth * 0.04, center.y - height * 0.56), blockWidth * 0.86, blockDepth * 0.72, rotation, palette[1], depth + 0.01);
  shapes.rect(
    v2(center.x - blockWidth * (variant % 3 === 0 ? 0.2 : 0.11), center.y - height * 0.58),
    blockWidth * (0.22 + (variant % 3) * 0.04),
    Math.max(1, blockDepth * 0.16),
    rotation,
    palette[2],
    depth + 0.02,
  );
}

function drawDecoration(
  shapes: ShapeBatch,
  decoration: ResolvedMapDecoration,
  s: { x: number; y: number },
  scale: number,
  weather: Weather,
  cloud: number,
): void {
  const depth = s.y * Projector.DEPTH_PER_ROW;
  const tone = (color: Rgba): Rgba => shadowed(weather.grade(color, 0.34), cloud);
  const k = decoration.scale * scale;
  if (decoration.kind === 'tent') {
    shapes.ellipse(s, 18 * k, 7 * Projection.groundSquash * k, 0, rgba(23, 28, 21, 70), depth - 8);
    shapes.rect(v2(s.x, s.y - 5 * k), 28 * k, 15 * Projection.groundSquash * k, decoration.rotation, tone(rgb(120, 89, 58)), depth);
    shapes.bar(
      v2(s.x - 12 * k, s.y - 12 * Projection.groundSquash * k),
      v2(s.x, s.y - 22 * Projection.groundSquash * k),
      Math.max(1, 3 * k),
      tone(rgb(184, 151, 103)),
      depth + 0.01,
    );
    shapes.bar(
      v2(s.x, s.y - 22 * Projection.groundSquash * k),
      v2(s.x + 12 * k, s.y - 12 * Projection.groundSquash * k),
      Math.max(1, 3 * k),
      tone(rgb(94, 69, 48)),
      depth + 0.01,
    );
    return;
  }
  if (decoration.kind === 'banner') {
    const h = 34 * k;
    shapes.bar(v2(s.x, s.y), v2(s.x, s.y - h), Math.max(1, 2.5 * k), tone(rgb(73, 53, 35)), depth);
    shapes.rect(v2(s.x + 7 * k, s.y - h * 0.78), 14 * k, 18 * k, decoration.rotation, tone(rgb(137, 47, 42)), depth + 0.01);
    shapes.rect(v2(s.x + 7 * k, s.y - h * 0.78), 5 * k, 13 * k, decoration.rotation, tone(rgb(203, 153, 73)), depth + 0.02);
    return;
  }
  if (decoration.kind === 'reed') {
    const baseX = s.x;
    const baseY = s.y;
    shapes.ellipse(s, 8 * k, 3 * Projection.groundSquash * k, 0, rgba(23, 32, 20, 72), depth - 3);
    for (let i = 0; i < 4; i++) {
      const offset = (i - 1.5) * 2.8 * k;
      const height = (15 + ((i + decoration.id.length) % 3) * 4) * k;
      const color = i % 2 === 0 ? rgb(91, 119, 54) : rgb(127, 145, 64);
      shapes.bar(
        v2(baseX + offset, baseY),
        v2(baseX + offset * 1.5 + (i % 2 === 0 ? -2 : 2) * k, baseY - height),
        Math.max(1.2, 1.8 * k),
        tone(color),
        depth + i * 0.003,
      );
      if (i === 1 || i === 3) {
        shapes.rect(v2(baseX + offset * 1.5, baseY - height), Math.max(1.5, 2.2 * k), Math.max(1.5, 3.4 * k), 0, tone(rgb(178, 154, 82)), depth + 0.02);
      }
    }
    return;
  }
  const length = 28 * k;
  shapes.ellipse(s, 16 * k, 5 * Projection.groundSquash * k, 0, rgba(23, 28, 21, 60), depth - 8);
  const dx = Math.cos(decoration.rotation) * length * 0.5;
  const dy = Math.sin(decoration.rotation) * length * 0.5 * Projection.groundSquash;
  shapes.bar(v2(s.x - dx, s.y - dy), v2(s.x + dx, s.y + dy), Math.max(2, 5 * k), tone(rgb(104, 71, 42)), depth);
  shapes.ellipse(v2(s.x - dx, s.y - dy), 3 * k, 2.5 * Projection.groundSquash * k, 0, tone(rgb(150, 106, 62)), depth + 0.01);
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
