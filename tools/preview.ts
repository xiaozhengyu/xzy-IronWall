/**
 * 离线人物预览：不开浏览器，把 ShapeBatch 的输出自己栅格化成 PNG。
 *
 * 存在的理由是人物绘制这套东西几乎全是数值调参 —— 比例、色阶、深度偏移 —— 而判断一次
 * 改动对不对唯一的办法是看图。跑一次就能拿到一张各朝向、各兵种的对照表，比开着页面来回
 * 按方向键快得多，也能在没有浏览器的环境里验证移植是否正确。
 *
 *   npx esbuild tools/preview.ts --bundle --platform=node --format=esm --outfile=.preview.mjs
 *   node .preview.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { CharacterAnimator, attackDuration, attackImpact } from '../src/characters/animator';
import { PALETTE_BLUE, PALETTE_RED, type CharacterPalette } from '../src/characters/palette';
import { drawCharacter } from '../src/characters/renderer';
import { Pose } from '../src/characters/rig';
import { type UnitDef, UnitPresets } from '../src/characters/unitDef';
import { ImpactEffects, weaponImpactPoint } from '../src/effects/impact';
import { Character } from '../src/game/character';
import { Debris } from '../src/effects/debris';
import { v2 } from '../src/core/math';
import { Projection } from '../src/render/projection';
import { Projector } from '../src/render/projector';
import { forEachCursorPixel } from '../src/render/swordCursor';
import { ShapeBatch, type PrimitiveSink } from '../src/render/shapeBatch';
import { ellipseSegments, unitCircle } from '../src/render/ellipseFan';
import { type Rgba, rgb, rgba } from '../src/render/color';
import { Terrain } from '../src/world/terrain';
import { Weather } from '../src/world/weather';
import { Props } from '../src/world/props';

// ---------------------------------------------------------------- 极小的栅格化器

interface Shape {
  pts: number[];
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 冒充 Pixi 的 Graphics：把所有东西摊平成多边形。 */
class ShapeSink implements PrimitiveSink {
  readonly shapes: Shape[] = [];

  clear(): this {
    this.shapes.length = 0;
    return this;
  }

  /** 矩形（含旋转）四个角直接就是多边形。 */
  quad(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    color: Rgba,
  ): void {
    this.push([x0, y0, x1, y1, x2, y2, x3, y3], color);
  }

  /** 段数走 ellipseFan，和线上那条路用同一份 —— 出的图才是游戏里真正画出来的样子。 */
  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, color: Rgba): void {
    const n = ellipseSegments(rx, ry);
    const ring = unitCircle(n);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const ex = ring[i * 2] * rx;
      const ey = ring[i * 2 + 1] * ry;
      pts.push(cx + ex * cos - ey * sin, cy + ex * sin + ey * cos);
    }
    this.push(pts, color);
  }

  private push(pts: number[], c: Rgba): void {
    this.shapes.push({ pts, r: c.r, g: c.g, b: c.b, a: c.a / 255 });
  }
}

class Canvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    bg: [number, number, number],
  ) {
    this.data = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      this.data[i * 3] = bg[0];
      this.data[i * 3 + 1] = bg[1];
      this.data[i * 3 + 2] = bg[2];
    }
  }

  /** 在像素中心采样的扫描线填充，不做抗锯齿 —— 和低分辨率缓冲 + 最近邻放大是一回事。 */
  fillPolygon(shape: Shape): void {
    const { pts } = shape;
    const n = pts.length / 2;
    if (n < 3) return;

    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }

    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.height - 1, Math.ceil(maxY));
    const crossings: number[] = [];

    for (let py = y0; py <= y1; py++) {
      const sy = py + 0.5;
      crossings.length = 0;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2];
        const ay = pts[i * 2 + 1];
        const bx = pts[((i + 1) % n) * 2];
        const by = pts[((i + 1) % n) * 2 + 1];
        if (ay === by) continue;
        if (sy >= Math.min(ay, by) && sy < Math.max(ay, by)) {
          crossings.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const x0 = Math.max(0, Math.ceil(crossings[c] - 0.5));
        const x1 = Math.min(this.width - 1, Math.floor(crossings[c + 1] - 0.5));
        for (let px = x0; px <= x1; px++) this.blend(px, py, shape);
      }
    }
  }

  private blend(x: number, y: number, s: Shape): void {
    const i = (y * this.width + x) * 3;
    const a = s.a;
    this.data[i] = Math.round(this.data[i] * (1 - a) + s.r * a);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + s.g * a);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + s.b * a);
  }

  /** 把另一张画布原样贴过来。 */
  blit(src: Canvas, ox: number, oy: number): void {
    for (let y = 0; y < src.height; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= this.height) continue;
      for (let x = 0; x < src.width; x++) {
        const dx = ox + x;
        if (dx < 0 || dx >= this.width) continue;
        const si = (y * src.width + x) * 3;
        const di = (dy * this.width + dx) * 3;
        this.data[di] = src.data[si];
        this.data[di + 1] = src.data[si + 1];
        this.data[di + 2] = src.data[si + 2];
      }
    }
  }

  /** 最近邻整数放大，看清像素格子。 */
  upscale(factor: number): Canvas {
    const out = new Canvas(this.width * factor, this.height * factor, [0, 0, 0]);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const si = (Math.floor(y / factor) * this.width + Math.floor(x / factor)) * 3;
        const di = (y * out.width + x) * 3;
        out.data[di] = this.data[si];
        out.data[di + 1] = this.data[si + 1];
        out.data[di + 2] = this.data[si + 2];
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- PNG 编码

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, body: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
};

function writePng(path: string, canvas: Canvas): void {
  const raw = Buffer.alloc(canvas.height * (canvas.width * 3 + 1));
  for (let y = 0; y < canvas.height; y++) {
    const rowStart = y * (canvas.width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    Buffer.from(canvas.data.buffer, y * canvas.width * 3, canvas.width * 3).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ---------------------------------------------------------------- 出图

interface Cell {
  def: UnitDef;
  palette: CharacterPalette;
  facing: number;
  /** 步态推进的秒数；0 表示站立。 */
  walk: number;
  attack: number;
  /** 投影缩放，也就是颗粒度：人由多少个像素构成。默认 1 是 overlord 的出货尺寸。 */
  grain?: number;
}

function renderCell(cell: Cell, cellW: number, cellH: number, canvas: Canvas, ox: number, oy: number): number {
  const pose = new Pose();
  const animator = new CharacterAnimator();

  const walkSpeed = 16;
  const speed = cell.walk > 0 ? walkSpeed : 0;
  const dt = 1 / 60;
  const steps = Math.max(1, Math.round(cell.walk / dt));
  for (let i = 0; i < steps; i++) animator.update(dt, speed, walkSpeed, cell.def, cell.attack, pose);

  const shapes = new ShapeBatch();
  const sink = new ShapeSink();
  // 人站在格子底部往上一点，脚下留出影子的位置。
  const grain = cell.grain ?? 1;
  const p = new Projector(v2(ox + cellW / 2, oy + cellH - 6 * grain), cell.facing, Projection.groundSquash, grain);
  drawCharacter(shapes, pose, p, cell.palette, cell.def);
  shapes.flushToMesh(sink);

  for (const s of sink.shapes) canvas.fillPolygon(s);
  return sink.shapes.length;
}

const presets: [string, () => UnitDef][] = [
  ['warlord', UnitPresets.warlord],
  ['hero', UnitPresets.hero],
  ['thug', UnitPresets.thug],
  ['shieldman', UnitPresets.shieldman],
  ['spearman', UnitPresets.spearman],
  ['archer', UnitPresets.archer],
  ['elite', UnitPresets.elite],
];

// 八个朝向。facing 是地面平面上的角度，PI/2 是朝着镜头。
const facings = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75].map((f) => f * Math.PI);

/** 和 src/main.ts 里定下的默认颗粒度保持一致 —— 校对的必须是真正会发布的那个尺寸。 */
const GRAIN = 3;

// 格子按 grain 一起放大，否则长杆武器会被裁掉：枪杆 15 单位，grain 3 下就是 45 像素。
const CELL_W = Math.round(36 * GRAIN);
const CELL_H = Math.round(33 * GRAIN);
const grid = new Canvas(CELL_W * facings.length, CELL_H * presets.length, [71, 105, 59]);

let total = 0;
presets.forEach(([, make], row) => {
  facings.forEach((facing, col) => {
    total += renderCell(
      { def: make(), palette: row % 2 === 0 ? PALETTE_BLUE : PALETTE_RED, facing, walk: 0, attack: -1, grain: GRAIN },
      CELL_W,
      CELL_H,
      grid,
      col * CELL_W,
      row * CELL_H,
    );
  });
});
writePng('.preview-facings.png', grid);

// 走路循环：同一个人沿相位取样一整圈。
const WALK_FRAMES = 8;
const walkStrip = new Canvas(CELL_W * WALK_FRAMES, CELL_H * 2, [71, 105, 59]);
for (let i = 0; i < WALK_FRAMES; i++) {
  // 一个步态循环是 2*stride 的地面距离；stride 约 4.7，所以周期约 0.58 秒。
  const cycle = 0.585;
  renderCell(
    { def: UnitPresets.warlord(), palette: PALETTE_BLUE, facing: Math.PI * 0.5, walk: 0.2 + (i / WALK_FRAMES) * cycle, attack: -1, grain: GRAIN },
    CELL_W,
    CELL_H,
    walkStrip,
    i * CELL_W,
    0,
  );
  renderCell(
    { def: UnitPresets.spearman(), palette: PALETTE_RED, facing: 0, walk: 0.2 + (i / WALK_FRAMES) * cycle, attack: -1, grain: GRAIN },
    CELL_W,
    CELL_H,
    walkStrip,
    i * CELL_W,
    CELL_H,
  );
}
writePng('.preview-walk.png', walkStrip.upscale(2));

// 攻击动作：剑士横扫 + 弓手开弓。
const attackStrip = new Canvas(CELL_W * WALK_FRAMES, CELL_H * 2, [71, 105, 59]);
for (let i = 0; i < WALK_FRAMES; i++) {
  const t = i / (WALK_FRAMES - 1);
  renderCell({ def: UnitPresets.warlord(), palette: PALETTE_BLUE, facing: Math.PI * 0.5, walk: 0, attack: t, grain: GRAIN }, CELL_W, CELL_H, attackStrip, i * CELL_W, 0);
  renderCell({ def: UnitPresets.archer(), palette: PALETTE_RED, facing: Math.PI * 0.5, walk: 0, attack: t, grain: GRAIN }, CELL_W, CELL_H, attackStrip, i * CELL_W, CELL_H);
}
writePng('.preview-attack.png', attackStrip.upscale(2));

// 砸击序列：连着模拟一整次攻击，把冲击波也跑出来。
//
// 这是唯一能离线看到特效的办法 —— 特效有生命周期，一张静态姿势图里它不存在。这里的
// 生成/落点逻辑和 main.ts 走的是同一个 weaponImpactPoint 和 attackImpact，所以看到的
// 就是游戏里会发生的。
{
  const FRAMES = 10;
  const def = UnitPresets.warlord();
  // 两个朝向。只测"朝向镜头"的话，把地面角度错当成屏幕角度也看不出来 —— 那个错误只在
  // 侧向时才暴露：弧会歪向一边，或者被地面压扁的比例算错。
  const FACINGS = [Math.PI * 0.5, 0];
  // 格子要比别的图高得多，也要把人往上放：冲击弧是朝身前跑出去的，跑完全程比人还长，
  // 用标准格子的话第二帧之后弧就掉到格子外面了 —— 那会让人误以为特效提前消失了。
  const TALL = Math.round(CELL_H * 2.1);
  const strip = new Canvas(CELL_W * FRAMES, TALL * FACINGS.length, [71, 105, 59]);
  const duration = attackDuration(def);
  const impact = attackImpact(def);
  const dt = 1 / 60;

  FACINGS.forEach((facing, row) => {
  // 人固定站在世界原点，镜头也钉在他身上。
  const pose = new Pose();
  const animator = new CharacterAnimator();
  const effects = new ImpactEffects();
  let elapsed = 0;
  let frame = 0;

  // 整段动作按帧推进，到了该出图的时刻就画一格。
  while (frame < FRAMES) {
    const before = elapsed / duration;
    elapsed += dt;
    const t = Math.min(elapsed / duration, 1);

    animator.update(dt, 0, 16, def, t, pose);
    if (impact !== null && before < impact && t >= impact) {
      const at = weaponImpactPoint(pose, def, 0, 0, facing);
      effects.spawn(at.x, at.y, facing, { power: def.bulk });
    }
    effects.update(dt);

    // 取样窗口盖住"整段动作 + 冲击波跑完"，否则最后几格全是已经结束的静止姿势。
    const window = duration + 0.42;
    if (elapsed >= ((frame + 0.5) / FRAMES) * window) {
      const shapes = new ShapeBatch();
      const sink = new ShapeSink();
      const ox = frame * CELL_W;
      const rootX = ox + CELL_W / 2;
      const rootY = row * TALL + Math.round(TALL * 0.3);
      effects.draw(shapes, 0, 0, rootX, rootY, GRAIN);
      drawCharacter(shapes, pose, new Projector(v2(rootX, rootY), facing, Projection.groundSquash, GRAIN), PALETTE_BLUE, def);
      shapes.flushToMesh(sink);
      for (const sh of sink.shapes) strip.fillPolygon(sh);
      frame++;
    }
  }
  });
  writePng('.preview-smash.png', strip.upscale(2));
}

// 特写：单个兵种放大看清楚。调某个部件（武器、盔、盾）时看这张。
{
  const rows: [string, () => UnitDef, CharacterPalette][] = [
    ['warlord', UnitPresets.warlord, PALETTE_BLUE],
    ['spearman', UnitPresets.spearman, PALETTE_RED],
    ['elite', UnitPresets.elite, PALETTE_RED],
  ];
  const closeFacings = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
  const sheet = new Canvas(CELL_W * closeFacings.length, CELL_H * rows.length, [71, 105, 59]);
  rows.forEach(([, make, palette], row) => {
    closeFacings.forEach((facing, col) => {
      renderCell(
        { def: make(), palette, facing, walk: 0, attack: -1, grain: GRAIN },
        CELL_W,
        CELL_H,
        sheet,
        col * CELL_W,
        row * CELL_H,
      );
    });
  });
  writePng('.preview-closeup.png', sheet.upscale(3));
}

// 颗粒度对照：同一个人在不同的 grain 下画，再各自放大到同样的物理尺寸。
// 变的只有"他由多少个像素构成"，屏幕上的大小是一样的 —— 这正是运行时那个旋钮在做的事。
{
  const BASE_W = 26;
  const BASE_H = 26;
  const PRODUCT = 12; // grain × magnify 恒定，所以每格最终都是 BASE × PRODUCT 大
  const grains = [1, 1.5, 2, 3, 4, 6];
  const rows: [string, () => UnitDef, CharacterPalette][] = [
    ['warlord', UnitPresets.warlord, PALETTE_BLUE],
    ['spearman', UnitPresets.spearman, PALETTE_RED],
  ];

  const sheet = new Canvas(BASE_W * PRODUCT * grains.length, BASE_H * PRODUCT * rows.length, [71, 105, 59]);
  rows.forEach(([, make, palette], row) => {
    grains.forEach((grain, col) => {
      const cell = new Canvas(Math.round(BASE_W * grain), Math.round(BASE_H * grain), [71, 105, 59]);
      renderCell(
        { def: make(), palette, facing: Math.PI * 0.5, walk: 0, attack: -1, grain },
        cell.width,
        cell.height,
        cell,
        0,
        0,
      );
      sheet.blit(cell.upscale(PRODUCT / grain), col * BASE_W * PRODUCT, row * BASE_H * PRODUCT);
    });
  });
  writePng('.preview-grain.png', sheet);
  console.log(`颗粒度对照：grain = ${grains.join(' / ')}`);
}

console.log(`每帧图元数约 ${Math.round(total / (presets.length * facings.length))}，共写出 6 张预览图`);


// ---------------------------------------------------------------- 野战场

/**
 * 地面是烘成一张 RGBA 图的，所以整片场地可以直接写成 PNG —— 这是检查地形布局（路、
 * 水塘、林地的位置和比例）最直接的办法，比在游戏里走一圈快得多。
 */
{
  const FIELD_W = 1200;
  const FIELD_H = 1200;
  const terrain = new Terrain(FIELD_W, FIELD_H, 20260902);

  const weather = new Weather();
  const baked = terrain.bakeGround(weather);
  const map = new Canvas(baked.texWidth, baked.texHeight, [0, 0, 0]);
  for (let i = 0; i < baked.texWidth * baked.texHeight; i++) {
    map.data[i * 3] = baked.data[i * 4];
    map.data[i * 3 + 1] = baked.data[i * 4 + 1];
    map.data[i * 3 + 2] = baked.data[i * 4 + 2];
  }
  writePng('.preview-field.png', map.upscale(2));
  console.log(`野战场 ${FIELD_W}x${FIELD_H}，地面纹理 ${baked.texWidth}x${baked.texHeight}`);

  // 一屏的实景：地面 + 细节 + 树 + 几个人，检查它们放在一起读不读得通。
  const VIEW_W = 460;
  const VIEW_H = 260;
  const GRAIN = 3;
  const view = new Canvas(VIEW_W, VIEW_H, [0, 0, 0]);

  // 镜头对着一处林地边缘 —— 那里同时有草、林、树，最能看出材质边界和尺度关系。
  // 对准林缘：灌木、倒木都只长在这条过渡带上，巨石只长在带外的开阔地。镜头扎进密林
  // 深处的话，这三样一个也看不到 —— 它们本来就不长在那儿。
  const camX = FIELD_W * 0.115;
  const camY = FIELD_H * 0.5;
  const rootX = VIEW_W / 2;
  const rootY = VIEW_H / 2;

  // 先把烘好的地面按最近邻铺进来，和游戏里那个精灵是同一件事。
  const patchW = (FIELD_W / baked.texWidth) * GRAIN;
  const patchH = (FIELD_H * Projection.groundSquash / baked.texHeight) * GRAIN;
  const originX = rootX - camX * GRAIN;
  const originY = rootY - camY * Projection.groundSquash * GRAIN;
  for (let py = 0; py < VIEW_H; py++) {
    for (let px = 0; px < VIEW_W; px++) {
      const tx = Math.floor((px - originX) / patchW);
      const ty = Math.floor((py - originY) / patchH);
      const o = (py * VIEW_W + px) * 3;
      if (tx < 0 || ty < 0 || tx >= baked.texWidth || ty >= baked.texHeight) continue;
      const b = (ty * baked.texWidth + tx) * 4;
      view.data[o] = baked.data[b];
      view.data[o + 1] = baked.data[b + 1];
      view.data[o + 2] = baked.data[b + 2];
    }
  }

  const shapes = new ShapeBatch();
  const sink = new ShapeSink();
  const spanX = VIEW_W / 2 / GRAIN + 40;
  const spanY = VIEW_H / 2 / (GRAIN * Projection.groundSquash) + 60;
  weather.prepareClouds(camX - spanX, camY - spanY, camX + spanX, camY + spanY);
  terrain.drawDetail(shapes, weather, camX, camY, rootX, rootY, GRAIN, spanX, spanY);
  terrain.drawScatter(shapes, weather, camX, camY, rootX, rootY, GRAIN, spanX, spanY);
  terrain.drawTrees(shapes, weather, camX, camY, rootX, rootY, GRAIN, spanX, spanY);

  // 放几个人进去比尺度：树该比人高一大截，草丛该只到脚踝。
  const crowd: [number, number, () => UnitDef, CharacterPalette][] = [
    [camX - 40, camY - 20, UnitPresets.warlord, PALETTE_BLUE],
    [camX + 30, camY + 10, UnitPresets.thug, PALETTE_RED],
    [camX + 5, camY + 40, UnitPresets.spearman, PALETTE_RED],
    [camX - 70, camY + 30, UnitPresets.archer, PALETTE_RED],
  ];
  for (const [wx, wy, make, palette] of crowd) {
    const pose = new Pose();
    const animator = new CharacterAnimator();
    for (let i = 0; i < 30; i++) animator.update(1 / 60, 16, 16, make(), -1, pose);
    const sx = rootX + (wx - camX) * GRAIN;
    const sy = rootY + (wy - camY) * Projection.groundSquash * GRAIN;
    drawCharacter(shapes, pose, new Projector(v2(sx, sy), Math.PI * 0.5, Projection.groundSquash, GRAIN), palette, make());
  }

  shapes.flushToMesh(sink);
  for (const sh of sink.shapes) view.fillPolygon(sh);
  writePng('.preview-terrain.png', view.upscale(2));

  // 篝火特写，加两个人比尺度：火该到膝盖上一点。
  {
    const W = 300;
    const H = 190;
    const camp = new Canvas(W, H, [86, 116, 70]);
    const props = new Props();
    // 直接摆，不走 place()：预览要的是固定构图，不是随机选址。
    props.list.push(
      { kind: 'campfire', x: 58, y: 46, flip: false, radius: 2.1 },
      { kind: 'campfire', x: 100, y: 66, flip: true, radius: 2.1 },
    );
    const shapes2 = new ShapeBatch();
    const sink2 = new ShapeSink();
    const cx2 = 78;
    const cy2 = 58;
    const rx2 = W / 2;
    const ry2 = H / 2;
    const w2 = new Weather();
    w2.prepareClouds(cx2 - 200, cy2 - 200, cx2 + 200, cy2 + 200);
    props.draw(shapes2, w2, cx2, cy2, rx2, ry2, GRAIN, 400, 400);

    for (const [wx, wy, make, palette] of [
      [46, 74, UnitPresets.warlord, PALETTE_BLUE],
      [104, 80, UnitPresets.thug, PALETTE_RED],
    ] as [number, number, () => UnitDef, CharacterPalette][]) {
      const pose = new Pose();
      const animator = new CharacterAnimator();
      for (let i = 0; i < 30; i++) animator.update(1 / 60, 0, 16, make(), -1, pose);
      const sx = rx2 + (wx - cx2) * GRAIN;
      const sy = ry2 + (wy - cy2) * Projection.groundSquash * GRAIN;
      drawCharacter(shapes2, pose, new Projector(v2(sx, sy), Math.PI * 0.5, Projection.groundSquash, GRAIN), palette, make());
    }

    shapes2.flushToMesh(sink2);
    for (const sh of sink2.shapes) camp.fillPolygon(sh);
    writePng('.preview-camp.png', camp.upscale(3));
    console.log('篝火特写：两堆火 + 两个人');
  }

  // 天气对照：同一块地在晴、雨、雪下的样子。看的是积雪堆和水洼的边缘 —— 它们必须和
  // 材质边界用同一种互相穿插的像素带，才读作长在地里而不是盖在上面。
  const strip = new Canvas(baked.texWidth, baked.texHeight * 3, [0, 0, 0]);
  const states: [string, number, number][] = [
    ['晴', 0, 0],
    ['雨', 0, 0.8],
    ['雪', 0.85, 0],
  ];
  states.forEach(([, snow, wet], row) => {
    const w = new Weather();
    w.snowCover = snow;
    w.wetness = wet;
    const b = terrain.bakeGround(w);
    for (let i = 0; i < b.texWidth * b.texHeight; i++) {
      const dst = (row * baked.texHeight * baked.texWidth + i) * 3;
      strip.data[dst] = b.data[i * 4];
      strip.data[dst + 1] = b.data[i * 4 + 1];
      strip.data[dst + 2] = b.data[i * 4 + 2];
    }
  });
  writePng('.preview-weather.png', strip);
  console.log('天气对照：晴 / 雨 / 雪');
}

// ---------------------------------------------------------------- 死亡：击飞
//
// 两行看两件事，因为一张图同时说不清：
//
//   上排 分帧   每一格一个时刻，人画在格子中间、按真实高度抬起来，连同这一刻还在空中的
//               血珠和甲片。看姿势和碎片：翻到哪儿了、离地多高、落地是不是平的、腿有没有交叉。
//   下排 频闪   同一个人按**真实世界坐标**连着画，带上击飞的轨迹线。看轨迹：飞多高飞多远。
//
// 单帧分不出击飞和原地倒地 —— 那个区别全在位移上，所以频闪那一排才是判断"得劲"的依据。
{
  const STEP = 1 / 120;
  const FRAMES = 8;
  /** 分帧取到落地稍后一点。滞空随机，0.6～0.93 秒。 */
  const FRAME_SPAN = 1.0;

  const make = UnitPresets.thug;
  const palette = PALETTE_RED;

  /**
   * 死了 t 秒之后的那个人，外加同步推进的碎片。
   *
   * 每次从头模拟。击飞的高度、距离和翻滚圈数都是死的那一刻掷出来的，所以同一格里连着
   * 推进才是一条连贯的轨迹；不同格之间各掷各的，那正是"每个人飞得不一样"要展示的东西。
   */
  const at = (t: number, facing: number) => {
    const c = new Character(make(), palette, 20);
    c.facing = facing;
    c.kill(-1, 0); // 从左边打过来，往右飞
    const debris = new Debris();
    // 技能那一档：血 + 甲片。平砍只有血。
    debris.burst(c.x, c.y, 1, 0, 2, palette);
    for (let i = 0; i < Math.round(t / STEP); i++) {
      c.update(STEP, true);
      debris.update(STEP);
    }
    return { c, debris };
  };

  const drawAt = (c: Character, debris: Debris | null, canvas: Canvas, px: number, py: number, trail: boolean) => {
    const shapes = new ShapeBatch();
    const sink = new ShapeSink();

    if (trail && c.trailCount >= 2) {
      const total = c.trail.length / 3;
      const point = (k: number) => {
        const idx = ((c.trailHead - 1 - k + total * 2) % total) * 3;
        return v2(
          px + (c.trail[idx] - c.x) * GRAIN,
          py + ((c.trail[idx + 1] - c.y) * Projection.groundSquash - c.trail[idx + 2] * Projection.heightSquash) * GRAIN,
        );
      };
      let prev = point(0);
      for (let k = 1; k < c.trailCount; k++) {
        const next = point(k);
        const fade = 1 - k / c.trailCount;
        shapes.capsule(prev, next, Math.max(1, GRAIN * 0.9 * fade), rgba(236, 226, 206, Math.round(200 * fade)), 0);
        prev = next;
      }
    }

    drawCharacter(
      shapes,
      c.pose,
      new Projector(v2(px, py), c.facing, Projection.groundSquash, GRAIN),
      palette,
      c.def,
      { lift: c.lift },
    );
    // 碎片的世界原点就是这个人现在站的地方，所以镜头传他自己的坐标。
    if (debris) debris.draw(shapes, c.x, c.y, px, py, GRAIN, () => 1e6);

    shapes.flushToMesh(sink);
    for (const s of sink.shapes) canvas.fillPolygon(s);
  };

  const CW = Math.round(30 * GRAIN);
  const CH = Math.round(32 * GRAIN);
  const sheet = new Canvas(CW * FRAMES, CH * 3, [71, 105, 59]);

  // 上排：分帧，带碎片
  for (let i = 0; i < FRAMES; i++) {
    const { c, debris } = at((i / (FRAMES - 1)) * FRAME_SPAN, 0);
    drawAt(c, debris, sheet, i * CW + CW / 2, CH - Math.round(8 * GRAIN), false);
  }

  // 下排：频闪，带轨迹线。取样只覆盖滞空那一段。
  const STROBE = 6;
  const STROBE_SPAN = 0.8;
  for (let i = 0; i < STROBE; i++) {
    const { c } = at((i / (STROBE - 1)) * STROBE_SPAN, 0);
    drawAt(c, null, sheet, Math.round(8 * GRAIN) + c.x * GRAIN, CH * 2 - Math.round(8 * GRAIN), true);
  }

  // 第三行：八个受击方向各躺一具，看**腿有没有交叉**。
  //
  // 交叉与否取决于人往哪个方向倒：倒地姿势里"左肢往哪边摊"是按垂直于倒地方向的那条轴算的，
  // 而那条轴和身体自己的左右轴没有固定关系（animator.collapse 里 lsign 那段）。所以这个
  // 毛病只在**部分**方向上出现，单看一个方向验不出来，必须八个一起摆。
  for (let i = 0; i < FRAMES; i++) {
    const a = (i / FRAMES) * Math.PI * 2;
    const c = new Character(make(), palette, 20);
    c.facing = Math.PI * 0.5; // 一律面朝镜头，只变打击来的方向
    c.kill(c.x - Math.cos(a), c.y - Math.sin(a));
    for (let k = 0; k < Math.round(1.2 / STEP); k++) c.update(STEP, true);
    drawAt(c, null, sheet, i * CW + CW / 2, CH * 3 - Math.round(9 * GRAIN), false);
  }

  writePng('.preview-death.png', sheet.upscale(2));
  console.log(`击飞：分帧 ${FRAMES} 格（${FRAME_SPAN} 秒，含碎片）+ 频闪 ${STROBE} 个取样（${STROBE_SPAN} 秒，含轨迹线）`);
}

// ---------------------------------------------------------------- 技能特效看不看得见
//
// 三个技能 × 新旧两种画法，底下都铺同一群人。
//
// 这张图回答的是"在游戏里能不能看见"。空场上画一道弧当然好看，但玩家永远不会在空场上放
// 技能 —— 弧扫过的地方恰恰站满了人。旧画法（下排）把弧压在腿以下，人一密就整条被吃掉；
// 新画法（上排）压在人群之上、加粗、放慢。同一群人、同一个时刻，只有画法不同。
{
  const STEP = 1 / 120;
  const COUNT = 42;
  const SPAN_X = 96;
  const SPAN_Y = 60;

  const W = Math.round((SPAN_X + 20) * GRAIN);
  const H = Math.round((SPAN_Y + 30) * GRAIN * Projection.groundSquash + 14 * GRAIN);

  const rng = (() => {
    let s = 20260904;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();

  // 一群人，两排共用。
  const folks: Character[] = [];
  for (let i = 0; i < COUNT; i++) {
    const c = new Character(UnitPresets.thug(), PALETTE_RED, 20);
    c.x = (rng() - 0.5) * SPAN_X;
    c.y = (rng() - 0.5) * SPAN_Y;
    c.facing = rng() * Math.PI * 2;
    for (let k = 0; k < Math.round((0.2 + rng() * 0.6) / STEP); k++) c.update(STEP, true);
    folks.push(c);
  }

  /** 一格：铺人 + 放一次特效，推到 t 秒再画。 */
  const panel = (
    canvas: Canvas,
    ox: number,
    oy: number,
    opts: Parameters<ImpactEffects['spawn']>[3],
    t: number,
    origin: { x: number; y: number },
    heading: number,
  ) => {
    const shapes = new ShapeBatch();
    const sink = new ShapeSink();
    const rootX = ox + W / 2;
    const rootY = oy + H / 2;

    for (const c of folks) {
      const at = v2(rootX + c.x * GRAIN, rootY + c.y * Projection.groundSquash * GRAIN);
      drawCharacter(shapes, c.pose, new Projector(at, c.facing, Projection.groundSquash, GRAIN), PALETTE_RED, c.def);
    }

    const fx = new ImpactEffects();
    fx.spawn(origin.x, origin.y, heading, opts);
    for (let k = 0; k < Math.round(t / STEP); k++) fx.update(STEP);
    fx.draw(shapes, 0, 0, rootX, rootY, GRAIN);

    shapes.flushToMesh(sink);
    for (const s of sink.shapes) canvas.fillPolygon(s);
  };

  // 三招各一列。上排新画法，下排旧画法（贴地、细、掉得快）。
  const cases: { spawn: Parameters<ImpactEffects['spawn']>[3]; t: number; at: { x: number; y: number }; head: number }[] = [
    // 横扫：贴地那一档本来就是它，两排一样——它是对照组，说明"看不见"不是错觉。
    { spawn: { power: 1.34, life: 0.34, weight: 1.5, overhead: true }, t: 0.14, at: { x: -34, y: 0 }, head: 0 },
    // 回旋
    { spawn: { power: 1.34, span: Math.PI * 2, from: 1.5, to: 27, life: 0.5, weight: 2.1, overhead: true }, t: 0.3, at: { x: 0, y: 0 }, head: 0 },
    // 破空
    { spawn: { power: 1, span: 0.9, from: 2, to: 96, life: 0.55, weight: 2.4, overhead: true, tint: rgb(214, 236, 255) }, t: 0.19, at: { x: -46, y: 0 }, head: 0 },
  ];

  const sheet = new Canvas(W * cases.length, H * 2, [71, 105, 59]);
  cases.forEach((c, col) => {
    panel(sheet, col * W, 0, c.spawn, c.t, c.at, c.head);
    // 旧画法：同样的形状和尺寸，但贴地、不加粗、掉得快。
    const old = { ...c.spawn, weight: 1, overhead: false, tint: undefined, life: 0.4 };
    panel(sheet, col * W, H, old, c.t, c.at, c.head);
  });

  writePng('.preview-skillfx.png', sheet.upscale(2));
  console.log('技能特效：上排新画法（压人群之上/加粗/放慢），下排旧画法（贴地）；列 = 横扫 / 回旋 / 破空');
}

// ---------------------------------------------------------------- 准心
//
// 一群人上面摆两个准心：左边旧的十字，右边新的像素剑。
//
// 准心的全部问题是"在花的底色上找不找得到"，所以必须画在人堆上看。空地上那个十字也是看得
// 见的 —— 正因为如此它才一直没被发现有问题。
//
// 剑走的是 src/render/swordCursor.ts 里那份像素数据，和运行时 Scene 画进 Graphics 的是
// 同一份；这里只是换了个画笔（ShapeBatch 而不是 Graphics），形状不会两边不一样。
{
  const STEP = 1 / 120;
  const COUNT = 46;
  const SPAN_X = 92;
  const SPAN_Y = 56;

  const W = Math.round((SPAN_X + 20) * GRAIN);
  const H = Math.round((SPAN_Y + 28) * GRAIN * Projection.groundSquash + 14 * GRAIN);

  const rng = (() => {
    let s = 20260905;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();

  const folks: Character[] = [];
  for (let i = 0; i < COUNT; i++) {
    const c = new Character(UnitPresets.thug(), PALETTE_RED, 20);
    c.x = (rng() - 0.5) * SPAN_X;
    c.y = (rng() - 0.5) * SPAN_Y;
    c.facing = rng() * Math.PI * 2;
    for (let k = 0; k < Math.round((0.2 + rng() * 0.6) / STEP); k++) c.update(STEP, true);
    folks.push(c);
  }

  const sheet = new Canvas(W * 2, H, [71, 105, 59]);

  // 准心画在最上面，所以给一个比谁都大的深度。运行时它压根不进批次（走单独的 Graphics）。
  const ON_TOP = 1e7;

  [false, true].forEach((sword, side) => {
    const shapes = new ShapeBatch();
    const sink = new ShapeSink();
    const rootX = side * W + W / 2;
    const rootY = H / 2;

    for (const c of folks) {
      const at = v2(rootX + c.x * GRAIN, rootY + c.y * Projection.groundSquash * GRAIN);
      drawCharacter(shapes, c.pose, new Projector(at, c.facing, Projection.groundSquash, GRAIN), PALETTE_RED, c.def);
    }

    // 三个位置各摆一个：空地、人堆边上、人堆正中间。
    const spots = [
      v2(rootX - 34 * GRAIN, rootY + 20 * GRAIN),
      v2(rootX + 4 * GRAIN, rootY - 4 * GRAIN),
      v2(rootX + 30 * GRAIN, rootY + 6 * GRAIN),
    ];

    for (const spot of spots) {
      const cx = Math.round(spot.x);
      const cy = Math.round(spot.y);
      if (sword) {
        const px = Math.max(1, Math.min(4, Math.round(GRAIN / 2)));
        forEachCursorPixel(px, (ox, oy, color) => {
          shapes.rect(v2(cx + ox + px / 2, cy + oy + px / 2), px, px, 0, color, ON_TOP);
        });
      } else {
        // 旧的十字：四个一像素宽的小方块，臂长跟着颗粒度。
        const arm = Math.max(2, Math.round(GRAIN));
        const old = rgba(240, 230, 210, 255);
        for (const [ox, oy, w, h] of [
          [-arm * 2, 0, arm, 1],
          [arm, 0, arm, 1],
          [0, -arm * 2, 1, arm],
          [0, arm, 1, arm],
        ]) {
          shapes.rect(v2(cx + ox + w / 2, cy + oy + h / 2), w, h, 0, old, ON_TOP);
        }
      }
    }

    shapes.flushToMesh(sink);
    for (const s of sink.shapes) sheet.fillPolygon(s);
  });

  writePng('.preview-cursor.png', sheet.upscale(3));
  console.log('准心：左旧十字 / 右像素剑，各摆在空地、人堆边、人堆中');
}
