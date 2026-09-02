import { Graphics, type Renderer } from 'pixi.js';
import { drawCharacter, drawSkeleton } from '../characters/renderer';
import type { Character } from '../game/character';
import type { Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { Camera } from './camera';
import { PixelSurface } from './pixelSurface';
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
const CULL_SIDE = 16;
const CULL_UP = 4;
const CULL_DOWN = 30;

export class Scene {
  private readonly surface: PixelSurface;
  private readonly camera: Camera;

  /** 一帧里所有的图元先攒在这里，最后按深度排序一次性灌进 Graphics。 */
  private readonly shapes = new ShapeBatch();
  private readonly figure = new Graphics();
  private readonly reticle = new Graphics();

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
    this.surface.units.addChild(this.figure, this.reticle);
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
    const cam = this.camera;
    const { x: camX, y: camY, rootX, rootY, grain } = cam;
    const shapes = this.shapes;

    // 地面。云影的格点铺在视口范围上，摆位必须和它一致，否则影子会相对地面滑动。
    field.ground.update(camX, camY, cam.halfW, cam.halfH);
    field.ground.layout(camX, camY, rootX, rootY, grain, this.surface.width, this.surface.height);

    this.figure.clear();

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
    if (overlay.showSkeleton) {
      const player = battle.player;
      const at = cam.worldToScreen(player.x, player.y);
      drawSkeleton(shapes, player.pose, new Projector(at, player.facing, Projection.groundSquash, grain));
    }

    // 溅起来的水珠画在人之后：它们是被脚踢起来的，该压在鞋面上。
    field.footsteps.drawSplashes(shapes, camX, camY, rootX, rootY, grain);
    // 落下的雨雪在所有东西之前 —— 它在镜头和世界之间，不参与排序。
    field.weather.draw(shapes, camX, camY, rootX, rootY, grain);

    this.primitives = shapes.primitiveCount; // flush 之后计数会清零
    shapes.flush(this.figure, this.surface.width, this.surface.height);

    this.drawReticle(overlay);

    this.surface.render();
    this.buildMs = smooth(this.buildMs, performance.now() - t0);
  }

  /** 把一个单位画到它在缓冲里该在的位置上。 */
  private drawCharacterAt(c: Character): void {
    const at = this.camera.worldToScreen(c.x, c.y);
    const p = new Projector(at, c.facing, Projection.groundSquash, this.camera.grain);
    drawCharacter(this.shapes, c.pose, p, c.palette, c.def, { hurt: c.hurt });
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
