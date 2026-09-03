import { Container, Graphics, Sprite, type Renderer } from 'pixi.js';
import { drawCharacter, drawSkeleton } from '../characters/renderer';
import type { Character } from '../game/character';
import type { Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { ItemDef } from '../items/itemDef';
import type { ItemSheet } from '../items/renderer';
import { v2 } from '../core/math';
import { rgba } from './color';
import type { Camera } from './camera';
import { PixelSurface } from './pixelSurface';
import { PrimitiveMesh } from './primitiveMesh';
import { Projection } from './projection';
import { Projector } from './projector';
import { ShapeBatch } from './shapeBatch';

/**
 * 一帧画面从头到尾。
 *
 * 这个文件存在的理由是**画家顺序**：地面 → 脚印 → 草石 → 冲击弧 → 树和人（同一批次按深度
 * 排序）→ 水花 → 雨雪 → 准星。这个顺序是画面成立的全部前提，而它以前散在 main.ts 中间的
 * 六十行里，和出怪、碰撞、暂停挤在一起。想加一层新东西（血条、伤害数字、技能特效），要先
 * 在那六十行里找准位置；现在打开这个文件，顺序就是它自己。
 *
 * Scene 只读不写：它不改世界的任何状态，所以爱调几次调几次 —— 开始画面和暂停时改颗粒度、
 * 拖窗口，靠的就是单独把 draw 再跑一遍。
 */

/** 每帧从外面传进来的、不属于世界本身的东西。 */
export interface SceneOverlay {
  /** 准星在缓冲里的位置。 */
  cursor: { x: number; y: number };
  /** 指针没锁着就不画准星：那时候玩家用的是系统光标。 */
  showReticle: boolean;
  showSkeleton: boolean;
}

const smooth = (prev: number, now: number): number => prev * 0.9 + now * 0.1;

/** 准星的颜色，和整套画面的高光同一个值。 */
const RETICLE_COLOR = 0xf0e6d2;

/**
 * 剔除时在视口四边各留多少世界单位。
 *
 * 横向按身体加武器的伸出量给；纵向不对称：人从脚下往上画，脚在下边界外一个身高之内时身子
 * 还探得进画面（CULL_DOWN），而脚一旦越过上边界，整个人都在画面之上了（CULL_UP 只需一点点）。
 * 一个人从脚到头约 18.3 个世界单位，被相机压扁之后换算回世界纵向是 18.3 × heightSquash /
 * groundSquash ≈ 23，取 30 留富余给长枪和斗篷。
 */
/** 击飞轨迹压在人物层里，但排在人之前一点点 —— 它是身后的痕迹，不该盖住脸。 */
const DEPTH_TRAIL = -2;

const CULL_SIDE = 16;
const CULL_UP = 4;
const CULL_DOWN = 30;

export class Scene {
  private readonly surface: PixelSurface;
  private readonly camera: Camera;

  /** 一帧里所有的图元先攒在这里，最后按深度排序一次性写进顶点缓冲。 */
  private readonly shapes = new ShapeBatch();
  /**
   * 场上所有东西都画进这一个 Mesh。
   *
   * 不走 Graphics：满屏一千人时一帧四万八千个图元，Graphics 光是下指令加三角化就要一百多
   * 毫秒（见 PrimitiveMesh 顶上那段实测）。这里是自己把三角形写进顶点缓冲。
   */
  private readonly prim = new PrimitiveMesh();
  /** 准星单独一个 Graphics：四个小矩形，不值得进批次，而且它要压在最上面。 */
  private readonly reticle = new Graphics();
  /**
   * 物品图鉴那一屏的精灵。
   *
   * 物品是贴图，进不了 ShapeBatch —— 那条路只认多边形。所以它们是真正的 Sprite，挂在
   * 描边那一层里，于是和人物吃同一圈暗边、同一次放大，看到的就是物品掉在场上时的样子。
   *
   * 精灵留着复用，不每次重建：图鉴一开着就每帧走一遍，几十个 Sprite 反复 new 是白扔。
   */
  private readonly itemLayer = new Container();
  private readonly itemSprites: Sprite[] = [];

  /** 上一帧的统计。游戏里不显示，暂停面板要读。 */
  primitives = 0;
  drawn = 0;
  /**
   * 把这一帧的图元算出来并交给 Pixi 花掉的毫秒（含 Graphics 的几何重建），指数平滑。
   *
   * 真正的 GPU 时间量不到，但那从来不是这里的瓶颈 —— 画面先被画进一个小缓冲再放大，
   * 填充率低得可以忽略，开销全在 CPU 侧的几何上。
   */
  buildMs = 0;

  constructor(renderer: Renderer, camera: Camera) {
    this.camera = camera;
    this.surface = new PixelSurface(renderer, camera.magnify);
    this.itemLayer.visible = false;
    this.surface.units.addChild(this.prim.mesh, this.itemLayer, this.reticle);
  }

  /** 挂到 stage 上的那个精灵：放大后的整帧。 */
  get view() {
    return this.surface.view;
  }

  /** 地面的两个精灵不参与批次，直接挂在不描边的那一层上。 */
  attachField(field: Field): void {
    this.surface.ground.addChild(field.ground.sprite, field.ground.shadowSprite);
  }

  /**
   * 把缓冲对齐到当前窗口和放大倍数，并把尺寸同步给相机。
   *
   * 相机的视野、投影原点全都是从缓冲尺寸推出来的，所以这一步必须发生在任何 worldToScreen
   * 之前 —— 也包括加载期间那次（那时还一帧都没跑过）。
   */
  resize(cssWidth: number, cssHeight: number, resolution: number): void {
    this.surface.scale = this.camera.magnify;
    this.surface.resize(cssWidth, cssHeight, resolution);
    this.camera.resolution = resolution;
    this.camera.viewWidth = this.surface.width;
    this.camera.viewHeight = this.surface.height;
  }

  /** 缓冲的尺寸，缓冲像素。准星的活动范围按它夹。 */
  get width(): number {
    return this.surface.width;
  }
  get height(): number {
    return this.surface.height;
  }

  draw(field: Field, battle: Battle, overlay: SceneOverlay): void {
    const t0 = performance.now();
    this.itemLayer.visible = false;
    const cam = this.camera;
    const { x: camX, y: camY, rootX, rootY, grain } = cam;
    const shapes = this.shapes;

    // 地面。云影的格点铺在视口范围上，摆位必须和它一致，否则影子会相对地面滑动。
    field.ground.update(camX, camY, cam.halfW, cam.halfH);
    field.ground.layout(camX, camY, rootX, rootY, grain, this.surface.width, this.surface.height);

    this.prim.begin();

    // 视野半宽/半高，留一格余量。地面细节和树只画看得见的那部分。
    const spanX = cam.halfW + 40;
    const spanY = cam.halfH + 60;

    // 脚印和涟漪贴在地上，压在草之下。
    field.footsteps.drawGround(shapes, camX, camY, rootX, rootY, grain);
    field.terrain.drawDetail(shapes, field.weather, camX, camY, rootX, rootY, grain, spanX, spanY);

    battle.effects.draw(shapes, camX, camY, rootX, rootY, grain);

    // 场上所有人和树共用一个批次：深度排序是全局的，站得靠下的自然压在靠上的前面，所以人能
    // 走到树后面去，不需要先按 y 排一遍再画。
    field.terrain.drawScatter(shapes, field.weather, camX, camY, rootX, rootY, grain, spanX, spanY);
    field.terrain.drawTrees(shapes, field.weather, camX, camY, rootX, rootY, grain, spanX, spanY);
    field.props.draw(shapes, field.weather, camX, camY, rootX, rootY, grain, spanX, spanY);

    // 按**矩形**剔除，不是圆。
    //
    // 屏幕是矩形，而以视口对角线为半径的圆比它大一倍 —— 人堆密起来的时候，画出去的人里有
    // 三成根本在画面外。实测同屏一千人：圆剔除画 979 个，矩形只画 686 个。
    //
    // 上下的余量不对称，因为人是从脚下**往上**画的：脚落在下边界外一个身高之内，身子还
    // 可能探进画面；而脚一旦跑到上边界外，整个人都在外面了。
    const cullX = cam.halfW + CULL_SIDE;
    const cullUp = cam.halfH + CULL_UP;
    const cullDown = cam.halfH + CULL_DOWN;
    this.drawn = 0;
    for (const e of battle.enemies) {
      const oy = e.y - camY;
      if (Math.abs(e.x - camX) > cullX || oy < -cullUp || oy > cullDown) continue;
      this.drawCharacterAt(e);
      this.drawn++;
    }
    this.drawCharacterAt(battle.player);

    // 击飞的轨迹线画在人之后：它是从身体拖出来的，压在别人身上比断在别人身后好读。
    for (const e of battle.enemies) {
      if (e.alive || e.trailCount < 2) continue;
      const oy = e.y - camY;
      if (Math.abs(e.x - camX) > cullX || oy < -cullUp || oy > cullDown) continue;
      this.drawTrail(e);
    }
    if (overlay.showSkeleton) {
      const player = battle.player;
      const at = cam.worldToScreen(player.x, player.y);
      drawSkeleton(shapes, player.pose, new Projector(at, player.facing, Projection.groundSquash, grain));
    }

    // 血珠和甲片：和人一起按屏幕行排序，否则一片甲会整个压在前排人身上。
    battle.debris.draw(shapes, camX, camY, rootX, rootY, grain, (worldY) =>
      Math.round(cam.worldToScreen(camX, worldY).y) * Projector.DEPTH_PER_ROW,
    );

    // 溅起来的水珠画在人之后：它们是被脚踢起来的，该压在鞋面上。
    field.footsteps.drawSplashes(shapes, camX, camY, rootX, rootY, grain);
    // 落下的雨雪在所有东西之前 —— 它在镜头和世界之间，不参与排序。
    field.weather.draw(shapes, camX, camY, rootX, rootY, grain);

    this.primitives = shapes.primitiveCount; // flush 之后计数会清零
    shapes.flushToMesh(this.prim, this.surface.width, this.surface.height);
    this.prim.end();

    this.drawReticle(overlay);

    this.surface.render();
    this.buildMs = smooth(this.buildMs, performance.now() - t0);
  }

  /**
   * 物品图鉴：把整本物品表摆成网格铺满缓冲，场上的人和树一个都不画。
   *
   * 走的是和打仗时同一层描边、同一个放大倍数，底下的地面精灵也留着不擦 —— 物品最终是掉在
   * 草地上的，白底上好看不算数。这是这个界面存在的意义：看到的必须是玩家会看到的东西。
   *
   * @returns 真正画出来的件数。表是空的、或者精灵表还没画好时是 0，菜单靠它决定提示什么。
   */
  drawItems(defs: ItemDef[], sheet: ItemSheet): number {
    const t0 = performance.now();
    const w = this.surface.width;
    const h = this.surface.height;

    // 图元那一批清空：图鉴里没有人也没有树。
    this.prim.begin();
    this.prim.end();
    this.primitives = 0;
    this.reticle.clear();

    this.itemLayer.visible = true;

    // 格子边长按颗粒度走，不按屏幕像素 —— 要校对的是出货尺寸下的样子，放大了看反而看不出
    // 该调哪个数。一屏放不下就整体缩小，不做滚动翻页：能一眼扫完全部才是这个界面的理由。
    const box = 16;
    const margin = 8;
    let cell = Math.max(4, Math.round((box + margin) * this.camera.grain));
    let cols = Math.max(1, Math.floor(w / cell));
    let rows = Math.ceil(Math.max(1, defs.length) / cols);
    while (rows * cell > h && cell > 4) {
      cell--;
      cols = Math.max(1, Math.floor(w / cell));
      rows = Math.ceil(Math.max(1, defs.length) / cols);
    }

    const span = (cell * box) / (box + margin);
    const x0 = (w - cols * cell) / 2;
    const y0 = (h - rows * cell) / 2;

    let shown = 0;
    for (const def of defs) {
      const texture = sheet.textureOf(def);
      if (!texture) continue; // 这一件还没画进精灵表，或者 frame 写出界了。

      const sprite = this.itemSpriteAt(shown);
      sprite.texture = texture;
      sprite.visible = true;
      // 按长边等比缩进格子：长剑和果子不该被拉成一样方。
      const k = span / Math.max(texture.width, texture.height);
      sprite.scale.set(k);
      // 位置取整：像素图落在半个像素上，最近邻会把边啃掉一行。
      sprite.position.set(
        Math.round(x0 + (shown % cols) * cell + cell / 2),
        Math.round(y0 + Math.floor(shown / cols) * cell + cell / 2),
      );
      shown++;
    }
    for (let i = shown; i < this.itemSprites.length; i++) this.itemSprites[i].visible = false;

    this.drawn = shown;
    this.surface.render();
    this.buildMs = smooth(this.buildMs, performance.now() - t0);
    return shown;
  }

  /** 第 i 个图鉴精灵，不够就补一个。 */
  private itemSpriteAt(i: number): Sprite {
    let sprite = this.itemSprites[i];
    if (!sprite) {
      sprite = new Sprite();
      sprite.anchor.set(0.5);
      this.itemSprites.push(sprite);
      this.itemLayer.addChild(sprite);
    }
    return sprite;
  }

  /**
   * 击飞时身后拖的那条线。
   *
   * 存在的理由是**读出高度**。俯视角下"飞得高"和"飞得远"在屏幕上是同一个方向的位移，
   * 光看身体分不出来；一条从起点拖过来的弧线把这段路画了出来，眼睛立刻能补出那个抛物线。
   * 影子留在地上不动，加上这条线，高度就有两个读数了。
   *
   * 用世界坐标点连出来，不走 Projector —— Projector 是身体局部空间的，而轨迹上的点是
   * 这具身体**过去待过的地方**，和它现在的朝向没有关系。
   */
  private drawTrail(c: Character): void {
    const cam = this.camera;
    const grain = cam.grain;
    const rootX = cam.rootX;
    const rootY = cam.rootY;
    const n = c.trailCount;
    const total = c.trail.length / 3;

    // 环形缓冲，从最新的一点往回读。
    const at = (k: number) => {
      const idx = ((c.trailHead - 1 - k + total * 2) % total) * 3;
      const wx = c.trail[idx];
      const wy = c.trail[idx + 1];
      const wz = c.trail[idx + 2];
      return v2(
        rootX + (wx - cam.x) * grain,
        rootY + ((wy - cam.y) * Projection.groundSquash - wz * Projection.heightSquash) * grain,
      );
    };

    const depth = this.camera.worldToScreen(c.x, c.y).y * Projector.DEPTH_PER_ROW + DEPTH_TRAIL;
    let prev = at(0);
    for (let k = 1; k < n; k++) {
      const next = at(k);
      // 越往回越淡越细：这一头是刚离开的位置，那一头是快消散的旧痕。
      const fade = 1 - k / n;
      const alpha = Math.round(200 * fade);
      if (alpha > 3) {
        this.shapes.capsule(prev, next, Math.max(1, grain * 0.9 * fade), rgba(236, 226, 206, alpha), depth);
      }
      prev = next;
    }
  }

  /** 把一个单位画到它在缓冲里该在的位置上。 */
  private drawCharacterAt(c: Character): void {
    const at = this.camera.worldToScreen(c.x, c.y);
    const p = new Projector(at, c.facing, Projection.groundSquash, this.camera.grain);
    drawCharacter(this.shapes, c.pose, p, c.palette, c.def, { hurt: c.hurt, lift: c.lift });
  }

  /**
   * 准星。中间留空，免得盖住脚下那块地。它画在单位层里，所以会跟着吃那圈一像素暗边 ——
   * 在草地上正是靠那圈边才看得清。
   *
   * 不走 ShapeBatch：那一批已经 flush 过了，而准星要压在最上面，且不参与深度排序。
   */
  private drawReticle(overlay: SceneOverlay): void {
    this.reticle.clear();
    if (!overlay.showReticle) return;
    const cx = Math.round(overlay.cursor.x);
    const cy = Math.round(overlay.cursor.y);
    const arm = Math.max(2, Math.round(this.camera.grain));
    const gap = arm;
    for (const [ox, oy, w, h] of [
      [-gap - arm, 0, arm, 1],
      [gap, 0, arm, 1],
      [0, -gap - arm, 1, arm],
      [0, gap, 1, arm],
    ]) {
      this.reticle.rect(cx + ox, cy + oy, w, h).fill(RETICLE_COLOR);
    }
  }
}
