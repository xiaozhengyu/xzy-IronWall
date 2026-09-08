/**
 * 离线帧耗时基准：不开浏览器，把一帧里 CPU 侧的活各自计时。
 *
 *   npm run bench                          默认跑到开局一秒，人还少
 *   WARMUP=3600 FRAMES=300 npm run bench   跑到第六十秒的稳态再量
 *   LITE=1 npm run bench                   敌人按平涂档算（对照 Scene.liteEnemies）
 *
 * 量不到 GPU，也量不到 Pixi 的提交和 DOM，但这两样以外的东西全在这里：世界推进、图元
 * 生成、深度排序（含画面外剔除）、写顶点缓冲。顺序照着 Scene.draw 抄。
 */
import { Battle } from '../src/game/battle';
import { Field } from '../src/game/field';
import { Camera } from '../src/render/camera';
import { Projection } from '../src/render/projection';
import { Projector } from '../src/render/projector';
import { ShapeBatch, type PrimitiveSink } from '../src/render/shapeBatch';
import { ellipseSegments, unitCircle } from '../src/render/ellipseFan';
import { drawCharacter } from '../src/characters/renderer';
import type { Rgba } from '../src/render/color';

/** 冒充 PrimitiveMesh：干同样的定型数组写入，不碰 Pixi。 */
class CountingSink implements PrimitiveSink {
  positions = new Float32Array(400_000 * 2);
  colors = new Uint32Array(400_000);
  indices = new Uint32Array(400_000 * 3);
  vertices = 0;
  indexCount = 0;

  begin(): void {
    this.vertices = 0;
    this.indexCount = 0;
  }

  quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, color: Rgba): void {
    if (this.vertices + 4 > this.colors.length) return;
    const v = this.vertices;
    const p = this.positions;
    let o = v * 2;
    p[o] = x0; p[o + 1] = y0; p[o + 2] = x1; p[o + 3] = y1;
    p[o + 4] = x2; p[o + 5] = y2; p[o + 6] = x3; p[o + 7] = y3;
    const packed = ((color.a << 24) | (color.b << 16) | (color.g << 8) | color.r) >>> 0;
    const c = this.colors;
    c[v] = packed; c[v + 1] = packed; c[v + 2] = packed; c[v + 3] = packed;
    const idx = this.indices;
    o = this.indexCount;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    this.vertices = v + 4;
    this.indexCount = o + 6;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, color: Rgba): void {
    const n = ellipseSegments(rx, ry);
    if (this.vertices + n + 1 > this.colors.length) return;
    const packed = ((color.a << 24) | (color.b << 16) | (color.g << 8) | color.r) >>> 0;
    const p = this.positions;
    const c = this.colors;
    const idx = this.indices;
    const center = this.vertices;
    p[center * 2] = cx;
    p[center * 2 + 1] = cy;
    c[center] = packed;
    const ring = unitCircle(n);
    if (rotation === 0) {
      for (let i = 0; i < n; i++) {
        const v = center + 1 + i;
        p[v * 2] = cx + ring[i * 2] * rx;
        p[v * 2 + 1] = cy + ring[i * 2 + 1] * ry;
        c[v] = packed;
      }
    } else {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      for (let i = 0; i < n; i++) {
        const ex = ring[i * 2] * rx;
        const ey = ring[i * 2 + 1] * ry;
        const v = center + 1 + i;
        p[v * 2] = cx + ex * cos - ey * sin;
        p[v * 2 + 1] = cy + ex * sin + ey * cos;
        c[v] = packed;
      }
    }
    let o = this.indexCount;
    for (let i = 0; i < n; i++) {
      idx[o] = center;
      idx[o + 1] = center + 1 + i;
      idx[o + 2] = center + 1 + ((i + 1) % n);
      o += 3;
    }
    this.vertices = center + n + 1;
    this.indexCount = o;
  }
}

const CULL_SIDE = 16;
const CULL_UP = 4;
const CULL_DOWN = 30;
/** 敌人画平涂档还是完整档。默认跟 Scene.liteEnemies 一致（完整）。 */
const LITE = process.env.LITE === '1';

const acc: Record<string, number> = {};
const pacc: Record<string, number> = {};
let mark0 = 0;
let pmark0 = 0;
const t = () => Number(process.hrtime.bigint()) / 1e6;

function begin(): void {
  mark0 = t();
  pmark0 = 0;
}

function stamp(name: string): void {
  const now = t();
  acc[name] = (acc[name] ?? 0) + (now - mark0);
  mark0 = now;
  const pc = shapes.primitiveCount;
  pacc[name] = (pacc[name] ?? 0) + (pc - pmark0);
  pmark0 = pc;
}

const field = new Field(1200, 1200, 20260902);
for (let i = 0; i < Field.BAKE_SLICES; i++) field.bakeSlice(i);
const battle = new Battle(field);
const camera = new Camera();
camera.viewWidth = 960;
camera.viewHeight = 540;
camera.grain = Camera.DEFAULT_GRAIN;

const shapes = new ShapeBatch();
const sink = new CountingSink();

function viewOf() {
  const player = battle.player;
  return {
    x: camera.x,
    y: camera.y,
    radius: camera.viewRadius,
    visible: { x: camera.x, y: camera.y, halfW: camera.halfW, halfH: camera.halfH },
    spawn: camera.shipViewport(player.x, player.y, field.width, field.height),
  };
}

camera.follow(battle.player.x, battle.player.y, field.width, field.height);
battle.seed(viewOf());
battle.autoAttack = true;

const dt = 1 / 60;
const WARMUP = Number(process.env.WARMUP ?? 60);
const FRAMES = Number(process.env.FRAMES ?? 240);
let drawn = 0;
let prims = 0;
let verts = 0;
let idx = 0;

for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
  const measuring = frame >= WARMUP;
  if (measuring) begin();

  camera.follow(battle.player.x, battle.player.y, field.width, field.height);
  const view = viewOf();
  // 玩家一直在走，而且慢慢转向：镜头动起来，出怪和回收才跑得到稳态。
  battle.update(dt, { facing: Math.sin(frame * 0.017) * Math.PI, moving: true, running: false }, view);
  if (measuring) stamp('battle.update');

  const camX = camera.x;
  const camY = camera.y;
  const rootX = camera.rootX;
  const rootY = camera.rootY;
  const grain = camera.grain;
  const spanX = camera.halfW + 40;
  const spanY = camera.halfH + 60;

  sink.begin();
  field.ground.update(camX, camY, camera.halfW, camera.halfH);
  if (measuring) stamp('ground.update');

  field.footsteps.drawGround(shapes, camX, camY, rootX, rootY, grain);
  field.terrain.drawDetail(shapes, field.weather, camX, camY, rootX, rootY, grain, spanX, spanY);
  if (measuring) stamp('terrain.detail');

  battle.effects.draw(shapes, camX, camY, rootX, rootY, grain);
  field.terrain.drawScatter(shapes, field.weather, camX, camY, rootX, rootY, grain, spanX, spanY);
  field.terrain.drawTrees(shapes, field.weather, camX, camY, rootX, rootY, grain, spanX, spanY);
  field.props.draw(shapes, field.weather, camX, camY, rootX, rootY, grain, spanX, spanY);
  if (measuring) stamp('scatter+trees');

  battle.collectibles.draw(shapes, camX, camY, rootX, rootY, grain,
    (worldY) => Math.round(camera.worldToScreen(camX, worldY).y) * Projector.DEPTH_PER_ROW,
    { width: camera.viewWidth, height: camera.viewHeight });
  if (measuring) stamp('collectibles');

  const cullX = camera.halfW + CULL_SIDE;
  const cullUp = camera.halfH + CULL_UP;
  const cullDown = camera.halfH + CULL_DOWN;
  let n = 0;
  for (const e of battle.enemies) {
    const oy = e.y - camY;
    if (Math.abs(e.x - camX) > cullX || oy < -cullUp || oy > cullDown) continue;
    const at = camera.worldToScreen(e.x, e.y);
    const p = new Projector(at, e.facing, Projection.groundSquash, grain);
    drawCharacter(shapes, e.pose, p, e.palette, e.def, { hurt: e.hurt, lift: e.lift, lite: LITE });
    n++;
  }
  if (measuring) {
    stamp('characters');
    drawn += n;
  }

  battle.debris.draw(shapes, camX, camY, rootX, rootY, grain,
    (worldY) => Math.round(camera.worldToScreen(camX, worldY).y) * Projector.DEPTH_PER_ROW);
  field.footsteps.drawSplashes(shapes, camX, camY, rootX, rootY, grain);
  field.weather.draw(shapes, camX, camY, rootX, rootY, grain);
  if (measuring) stamp('debris+weather');

  const count = shapes.primitiveCount;
  shapes.flushToMesh(sink, camera.viewWidth, camera.viewHeight);
  if (measuring) {
    stamp('sort+writeVerts');
    prims += count;
    verts += sink.vertices;
    idx += sink.indexCount;
  }
}

const per = (k: string) => (acc[k] / FRAMES).toFixed(2).padStart(7);
let total = 0;
for (const k of Object.keys(acc)) total += acc[k];
const grade = LITE ? '平涂' : '完整';
console.log(`档位 ${grade}｜预留 ${battle.reserved.length} 人，场上 ${battle.enemies.length} 人，画 ${(drawn / FRAMES).toFixed(0)} 人，图元 ${(prims / FRAMES).toFixed(0)}，顶点 ${(verts / FRAMES).toFixed(0)}，索引 ${(idx / FRAMES).toFixed(0)}`);
for (const k of Object.keys(acc)) {
  console.log(`${k.padEnd(16)} ${per(k)} ms   图元 ${((pacc[k] ?? 0) / FRAMES).toFixed(0).padStart(6)}`);
}
console.log(`${'合计(CPU)'.padEnd(16)} ${(total / FRAMES).toFixed(2).padStart(7)} ms`);
