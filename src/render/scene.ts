import { Container, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import { RigSpec } from '../characters/rig';
import { drawAegisDome } from '../effects/aegisDome';
import { drawDharmaAspect } from '../effects/dharmaAspect';
import { SKY_BLADE_LENGTH, drawSkyBlade, heavenSplitBlade, skyArrowBlade } from '../effects/skyBlade';
import { drawCharacter, drawSkeleton } from '../characters/renderer';
import type { Pose } from '../characters/rig';
import type { UnitDef } from '../characters/unitDef';
import type { CharacterPalette } from '../characters/palette';
import { brightenPalette, flatPalette } from '../characters/palette';
import type { Character } from '../game/character';
import { enemyArrowPosition, type Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { ItemDef } from '../items/itemDef';
import type { ItemSheet } from '../items/renderer';
import { v2, type Vec2 } from '../core/math';
import { rgb, rgba } from './color';
import type { Camera } from './camera';
import { PixelSurface } from './pixelSurface';
import { PrimitiveMesh } from './primitiveMesh';
import { Projection } from './projection';
import { Projector } from './projector';
import { ShapeBatch } from './shapeBatch';
import { drawFigureStage } from './figureStage';

/**
 * 一帧画面从头到尾。
 *
 * 这个文件存在的理由是**画家顺序**：地面 → 脚印 → 草石 → 冲击弧 → 树和人（同一批次按深度
 * 排序）→ 水花 → 雨雪。光标由 UI 顶层绘制。这个顺序以前散在 main.ts 中间的
 * 六十行里，和出怪、碰撞、暂停挤在一起。想加一层新东西（血条、伤害数字、技能特效），要先
 * 在那六十行里找准位置；现在打开这个文件，顺序就是它自己。
 *
 * Scene 只读不写：它不改世界的任何状态，所以爱调几次调几次 —— 开始画面和暂停时改颗粒度、
 * 拖窗口，靠的就是单独把 draw 再跑一遍。
 */

/**
 * 备战界面上的一台：谁、画在哪儿、多大、走了多远。
 *
 * 位置和大小由界面那边量出来（DOM 摆框，画布跟着框走），所以这里只是一个纯数据的口子。
 */
export interface StageFigure {
  actor: Character;
  /** 地块中心落在缓冲的哪个像素上。 */
  at: Vec2;
  grain: number;
  /** 走过的路，世界单位。人不动，草按它的反方向流。 */
  scrollX: number;
  scrollY: number;
  /** 只放大地块，不动人。不给就是 1。 */
  tileScale?: number;
}

/** 每帧从外面传进来的、不属于世界本身的东西。 */
export interface SceneOverlay {
  showSkeleton: boolean;
}

const smooth = (prev: number, now: number): number => prev * 0.9 + now * 0.1;

/**
 * 剔除时在视口四边各留多少世界单位。
 *
 * 横向按身体加武器的伸出量给；纵向不对称：人从脚下往上画，脚在下边界外一个身高之内时身子
 * 还探得进画面（CULL_DOWN），而脚一旦越过上边界，整个人都在画面之上了（CULL_UP 只需一点点）。
 * 一个人从脚到头约 18.3 个世界单位，被相机压扁之后换算回世界纵向是 18.3 × heightSquash /
 * groundSquash ≈ 23，取 30 留富余给长枪和斗篷。
 */
/**
 * 轮廓光的颜色和偏移方向。
 *
 * 只走上下左右四个方向，不走八个：八个方向厚一倍、也贵一倍，而在二十像素的人身上，四个
 * 方向已经能围出一圈连续的边（斜角处由相邻两个方向的偏移接上）。
 *
 * 颜色是暖白偏金，和玩家那身金包边同一个语气；alpha 给到 190 而不是满 —— "轻微"是它该有的
 * 分寸，满不透明的一圈白边会让人物读作贴纸。
 */
const RIM_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const HERO_RIM_PALETTE = flatPalette(rgba(255, 236, 176, 190));
/** 冲刺时那一档：几乎不透明的暖白，偏移也翻倍（见 drawRim）。 */
const HERO_DASH_PALETTE = flatPalette(rgba(255, 248, 214, 246));
const IRON_BODY_GLOW = rgb(255, 242, 190);

/**
 * 金钟罩压在玩家之上（他站在罩子里），但比技能弧低一档 —— 弧是一瞬间的事件，罩子一直都在，
 * 让它压过每一道弧会把技能反馈盖掉。
 */
const DEPTH_AEGIS = 16;

/**
 * 穿云箭那把剑的色调：暖金偏白。
 *
 * 和招式自己那圈落点提示环（255,198,92）同一个色系 —— 一招里的东西该看着像一套。破空那道
 * 波用的是偏冷的白，两招在余光里就分得开。
 */
const SKY_ARROW_TINT = rgb(255, 236, 190);
const ENEMY_ARROW_WOOD = rgb(104, 68, 38);
const ENEMY_ARROW_STEEL = rgb(214, 222, 222);
const ENEMY_ARROW_FLETCHING = rgb(154, 42, 34);
const ENEMY_ARROW_LENGTH = 5.2;
const ENEMY_ARROW_TRAIL_SPAN = 0.24;
const ENEMY_ARROW_TRAIL_SAMPLES = 7;
/** 还剩多少秒开始闪。 */
const AEGIS_WARN = 1;

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

  /**
   * 敌人走平涂档（见 characters/renderer.ts 的 lite）。
   *
   * 只给敌人，玩家永远画全 —— 他就一个，省不出什么，而他是玩家在人海里唯一要找的东西，
   * 身上那圈轮廓光和完整的明暗正是为这件事存在的。
   *
   * 默认**关着**：画风优先。同屏几百人时这一档把每人的图元数降三成，而这一块（算图元 +
   * 深度排序 + 写顶点）完全线性跟着图元数走 —— 但出货尺寸下肢体有八像素宽，那条被省掉的
   * 硬边阴影带是看得见的，而人物的明暗正是这套画法的立身之本。L 键切过去，帧数顶不住的
   * 机器上它仍然是那张随时能打的牌。
   */
  liteEnemies = false;

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

  private readonly renderer: Renderer;

  constructor(renderer: Renderer, camera: Camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.surface = new PixelSurface(renderer, camera.magnify);
    this.itemLayer.visible = false;
    this.surface.units.addChild(this.prim.mesh, this.itemLayer);
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
    this.setGroundVisible(field, true);
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

    // 掉落物和角色、树木共用深度排序：人在宝石前面时会挡住它，走到后面时宝石也能盖住鞋面。
    battle.collectibles.draw(shapes, camX, camY, rootX, rootY, grain, (worldY) =>
      Math.round(cam.worldToScreen(camX, worldY).y) * Projector.DEPTH_PER_ROW,
      { width: this.surface.width, height: this.surface.height },
    );

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
    const playerAt = cam.worldToScreen(battle.player.x, battle.player.y);
    const dharma = battle.dharma;
    if (dharma) {
      drawDharmaAspect(shapes, battle.player, playerAt, grain, dharma.left, dharma.total);
    }
    const ironBody = battle.skillLoadout.isEquipped('ironBody');
    const ironBreath = 0.5 + 0.5 * Math.sin((battle.elapsed * Math.PI * 2) / 2.1);
    this.drawCharacterAt(battle.player, true, battle.dashing, ironBody ? ironBreath : null);

    this.drawEnemyArrows(battle, camX, camY, rootX, rootY, grain);

    // 金钟罩画在人之后：它罩在玩家身上，不是垫在他底下。
    this.drawAegis(battle, camX, camY, rootX, rootY, grain);
    this.drawSkyArrow(battle, camX, camY, rootX, rootY, grain);
    this.drawHeavenSplit(battle, grain);

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

    // 扣血数字压在所有人和碎片之上。它是读数，被谁挡住都等于没有 —— 而人堆里随便一具
    // 站得更靠下的尸体就能把它吃掉。
    battle.damageNumbers.draw(shapes, camX, camY, rootX, rootY, grain);

    // 溅起来的水珠画在人之后：它们是被脚踢起来的，该压在鞋面上。
    field.footsteps.drawSplashes(shapes, camX, camY, rootX, rootY, grain);
    // 落下的雨雪在所有东西之前 —— 它在镜头和世界之间，不参与排序。
    field.weather.draw(shapes, camX, camY, rootX, rootY, grain);

    this.primitives = shapes.primitiveCount; // flush 之后计数会清零
    shapes.flushToMesh(this.prim, this.surface.width, this.surface.height);
    this.prim.end();

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

  /**
   * 备战界面的台子：一台或者一排，每台一块地加一个人。
   *
   * 选人那一步只有一台（中间那个人），选图那一步是一排（这张图上会遇到的几种敌人）。两者
   * 走的是同一条路 —— 界面那边只是给出"这一台画在哪儿、多大、走了多远"，画法完全一样。
   *
   * 烘出来的那张地面精灵在这里是**关掉**的：它一个纹素有三个世界单位，铺在人背后是一片
   * 巨大的色块。台子上那块地是现画的（见 figureStage.ts），大小和人配得上。
   *
   * 敌人为什么不烘成图片：他们要走要挥。取一次图是一次 GPU 回读，每帧回读五个人是拿不出手
   * 的开销，而画在画布上本来就是这套渲染最擅长的事，一帧五个人不值一提。
   */
  drawStages(field: Field, stages: readonly StageFigure[]): void {
    const t0 = performance.now();
    this.itemLayer.visible = false;
    this.setGroundVisible(field, false);

    this.prim.begin();
    const shapes = this.shapes;
    for (const stage of stages) {
      drawFigureStage(shapes, stage.actor, stage.at, stage.grain, stage.scrollX, stage.scrollY, stage.tileScale);
    }
    this.primitives = shapes.primitiveCount;
    shapes.flushToMesh(this.prim, this.surface.width, this.surface.height);
    this.prim.end();

    this.drawn = stages.length;
    this.surface.render();
    this.buildMs = smooth(this.buildMs, performance.now() - t0);
  }

  /**
   * 把一个人画进一张离屏纹理，再取成一张画布 —— 选人列表里那些小头像就是它。
   *
   * 为什么不摆一张画好的图：那样列表里的人和中间预览的人就成了两份资产，改了骨架或配色只
   * 有一份会跟着变。这里画的就是游戏里那个人，同一套 drawCharacter、同一条几何路，只是
   * 画进了一张 64 见方的纹理里。
   *
   * 取不出来（extract 在某些环境里可能没有）就返回 null，列表那边自己退回纯文字。
   *
   * @param footY 脚落在纹理的第几行。头像给一个大于 height 的值就是从胸口截断。
   */
  renderPortrait(
    pose: Pose,
    def: UnitDef,
    palette: CharacterPalette,
    width: number,
    height: number,
    grain: number,
    footY: number,
    facing = 0,
  ): HTMLCanvasElement | null {
    const target = RenderTexture.create({ width, height, scaleMode: 'nearest', antialias: false });
    try {
      this.prim.begin();
      const shapes = this.shapes;
      // 脚落在 footY 上。头像把它放到纹理下沿之外，于是画面正好从胸口往上截断；全身像则
      // 把它放在纹理里面，一整个人都在。
      drawCharacter(
        shapes,
        pose,
        new Projector(v2(width * 0.5, footY), facing, Projection.groundSquash, grain),
        palette,
        def,
      );
      shapes.flushToMesh(this.prim, width, height);
      this.prim.end();
      this.renderer.render({ container: this.prim.mesh, target, clear: true });
      const canvas = this.renderer.extract.canvas(target) as HTMLCanvasElement;
      return canvas;
    } catch {
      return null;
    } finally {
      target.destroy(true);
      // 下一帧要重新攒图元，别把头像那一批留在缓冲里。
      this.prim.begin();
      this.prim.end();
    }
  }

  /** 地面那两个精灵。人物台和图鉴要把它们收起来，回到战场再放出来。 */
  private setGroundVisible(field: Field, on: boolean): void {
    field.ground.sprite.visible = on;
    field.ground.shadowSprite.visible = on;
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
   * 金钟罩：罩在玩家身上的那个光罩。
   *
   * 画两圈，一圈在地上一圈在身上 —— 单画一个屏幕空间的圆读作贴在镜头上的一个环，看不出它
   * 罩着谁；单画一个地面椭圆又读作脚下一个法阵。地面那圈交代"罩子占了这么大一块地"，身上
   * 那圈交代"罩子有高度、玩家在里面"，两圈一起才是个罩子。
   *
   * 快到期时闪一下（见 blink）：这是玩家唯一能知道"还剩多久"的地方，而一个没有预告就消失的
   * 护盾会让人觉得是被偷走的。
   */
  /**
   * 穿云箭的两个可见段：起手迅速冲出屏幕，0.8 秒后在随机落点从天而降。
   *
   * 中间那段空拍是有意的（招式那边留的）：人在等天外一剑，什么都不画反而把等待撑起来了。
   */
  private drawSkyArrow(
    battle: Battle,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    grain: number,
  ): void {
    const arrow = battle.skyArrow;
    if (!arrow) return;

    const rising = arrow.age < 0.18;
    const falling = arrow.age >= 0.8;
    if (!rising && !falling) return; // 箭已经穿出视口，留出“人在等天外一箭”的空拍。

    let x: number;
    let y: number;
    let shadow: Vec2 | null = null;
    if (rising) {
      const at = this.camera.worldToScreen(battle.player.x, battle.player.y);
      x = at.x;
      y = at.y - (arrow.age / 0.18) * (this.surface.height + 24);
    } else {
      const t = Math.min((arrow.age - 0.8) / 0.28, 1);
      const ground = v2(
        rootX + (arrow.targetX - camX) * grain,
        rootY + (arrow.targetY - camY) * Projection.groundSquash * grain,
      );
      x = ground.x;
      y = -18 + (ground.y + 18) * t;
      shadow = ground;
      // 地上的细环提前告诉玩家落点，箭本身仍从屏幕外开始，保留“天降”的纵深。
      const pulse = 1 - t;
      this.shapes.ellipseRing(
        ground,
        (5 + pulse * 8) * grain,
        (2.5 + pulse * 4) * grain,
        0,
        Math.max(1, grain * 0.45),
        rgba(255, 198, 92, Math.round(120 + 100 * pulse)),
        ground.y * Projector.DEPTH_PER_ROW + 18,
        16,
      );
    }

    // 天上掉下来的是一把三个人高的大剑，不是一支箭。
    //
    // 原来画的是一根细杆加两撇倒钩，在满屏几百人的画面里读作一根牙签。这一招要等将近一秒
    // 才落地，等待本身就是在给它攒份量 —— 掉下来的东西必须配得上那个等待。
    //
    // 摆位由 skyArrowBlade 从招式状态算（运行时和离线预览共用同一份），这里只负责把它画出来。
    const pose = skyArrowBlade(arrow.age, this.camera.worldToScreen(battle.player.x, battle.player.y), v2(x, shadow?.y ?? y), this.surface.height, grain);
    if (!pose) return;
    drawSkyBlade(
      this.shapes,
      pose.tip,
      pose.butt,
      pose.side,
      pose.width,
      pose.alpha,
      SKY_ARROW_TINT,
      (shadow?.y ?? y) * Projector.DEPTH_PER_ROW + 30,
    );
  }

  /** 开天：穿云剑模型沿施放时锁定的行走朝向贴地飞出。 */
  private drawHeavenSplit(battle: Battle, grain: number): void {
    const blade = battle.heavenSplit;
    if (!blade) return;

    const dirX = Math.cos(blade.heading);
    const dirY = Math.sin(blade.heading);
    const butt = this.camera.worldToScreen(blade.x, blade.y);
    const tip = this.camera.worldToScreen(
      blade.x + dirX * SKY_BLADE_LENGTH,
      blade.y + dirY * SKY_BLADE_LENGTH,
    );
    const pose = heavenSplitBlade(blade.age, blade.left, butt, tip, grain);
    drawSkyBlade(
      this.shapes,
      pose.tip,
      pose.butt,
      pose.side,
      pose.width,
      pose.alpha,
      SKY_ARROW_TINT,
      ((pose.tip.y + pose.butt.y) * 0.5) * Projector.DEPTH_PER_ROW + 30,
    );
  }

  private drawAegis(
    battle: Battle,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    grain: number,
  ): void {
    const a = battle.aegis;
    if (!a) return;

    const player = battle.player;
    const sx = rootX + (player.x - camX) * grain;
    const sy = rootY + (player.y - camY) * Projection.groundSquash * grain;
    const r = a.radius * grain;

    // 最后一秒开始闪，越到后面闪得越急。
    const left = a.left;
    const blink = left > AEGIS_WARN ? 1 : 0.45 + 0.55 * Math.abs(Math.sin((AEGIS_WARN - left) * 22));

    // 罩子整个排在玩家之上（他站在里面），但仍按自己的屏幕行取深度，所以身前那一排人挡得住它。
    drawAegisDome(
      this.shapes,
      sx,
      sy,
      r,
      RigSpec.chestZ * Projection.heightSquash * grain,
      grain,
      blink,
      sy * Projector.DEPTH_PER_ROW + DEPTH_AEGIS,
    );
  }

  /**
   * 敌军箭矢。箭头取当前点，箭尾沿上一帧的飞行方向反推固定长度，所以帧率变化不会让箭
   * 忽长忽短；尾迹从固定弹道回采，既显出高弧线，也不会改变箭的落点。
   */
  private drawEnemyArrows(
    battle: Battle,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    grain: number,
  ): void {
    const toScreen = (x: number, y: number, z: number): Vec2 =>
      v2(
        rootX + (x - camX) * grain,
        rootY + ((y - camY) * Projection.groundSquash - z * Projection.heightSquash) * grain,
      );

    for (const arrow of battle.enemyArrows) {
      const tip = toScreen(arrow.x, arrow.y, arrow.z);
      const previous = toScreen(arrow.previousX, arrow.previousY, arrow.previousZ);
      let dx = tip.x - previous.x;
      let dy = tip.y - previous.y;
      let len = Math.hypot(dx, dy);
      if (len < 1e-4) {
        const target = toScreen(arrow.targetX, arrow.targetY, 0.7);
        dx = target.x - tip.x;
        dy = target.y - tip.y;
        len = Math.hypot(dx, dy) || 1;
      }
      const ux = dx / len;
      const uy = dy / len;
      // 落地后箭头和前半截已经钻进土里，只留下半截箭杆与尾羽。
      const visibleLength = ENEMY_ARROW_LENGTH * (arrow.landed ? 0.5 : 1);
      const tail = v2(tip.x - ux * visibleLength * grain, tip.y - uy * visibleLength * grain);
      const depth = this.camera.worldToScreen(arrow.x, arrow.y).y * Projector.DEPTH_PER_ROW + 10;
      const shaft = Math.max(1, grain * 0.42);

      const trailHistory = Math.min(ENEMY_ARROW_TRAIL_SPAN, arrow.age);
      if (!arrow.landed && trailHistory > 1e-4) {
        let trailHead = tip;
        for (let i = 1; i <= ENEMY_ARROW_TRAIL_SAMPLES; i++) {
          const progress = i / ENEMY_ARROW_TRAIL_SAMPLES;
          const sample = enemyArrowPosition(arrow, arrow.age - trailHistory * progress);
          const trailTail = toScreen(sample.x, sample.y, sample.z);
          const fade = 1 - progress;
          const alpha = Math.round(150 * fade);
          if (alpha > 3) {
            this.shapes.capsule(
              trailHead,
              trailTail,
              Math.max(1, grain * (0.48 + fade * 0.34)),
              rgba(236, 220, 174, alpha),
              depth - 0.03,
            );
          }
          trailHead = trailTail;
        }
      }

      const bodyAlpha = Math.round(255 * arrow.opacity);
      const wood = rgba(ENEMY_ARROW_WOOD.r, ENEMY_ARROW_WOOD.g, ENEMY_ARROW_WOOD.b, bodyAlpha);
      const steel = rgba(ENEMY_ARROW_STEEL.r, ENEMY_ARROW_STEEL.g, ENEMY_ARROW_STEEL.b, bodyAlpha);
      const fletching = rgba(
        ENEMY_ARROW_FLETCHING.r,
        ENEMY_ARROW_FLETCHING.g,
        ENEMY_ARROW_FLETCHING.b,
        bodyAlpha,
      );
      this.shapes.bar(tail, tip, shaft, wood, depth);
      if (!arrow.landed) {
        this.shapes.capsule(
          v2(tip.x - ux * grain * 0.8, tip.y - uy * grain * 0.8),
          tip,
          Math.max(1, grain * 0.72),
          steel,
          depth + 0.01,
        );
      }
      const px = -uy * grain * 0.75;
      const py = ux * grain * 0.75;
      this.shapes.bar(
        v2(tail.x - px, tail.y - py),
        v2(tail.x + px, tail.y + py),
        Math.max(1, grain * 0.34),
        fletching,
        depth + 0.01,
      );
    }
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
  private drawCharacterAt(c: Character, rim = false, hot = false, ironBreath: number | null = null): void {
    const at = this.camera.worldToScreen(c.x, c.y);
    const grain = this.camera.grain;
    if (rim) this.drawRim(c, at, grain, hot, ironBreath);
    const p = new Projector(at, c.facing, Projection.groundSquash, grain);
    const palette = ironBreath === null
      ? c.palette
      : brightenPalette(c.palette, 0.1 + ironBreath * 0.16, IRON_BODY_GLOW);
    // rim 只有玩家会传，所以这一条同时也是"玩家不降档"。
    drawCharacter(this.shapes, c.pose, p, palette, c.def, {
      hurt: c.hurt,
      lift: c.lift,
      lite: this.liteEnemies && !rim,
    });
  }

  /**
   * 玩家身上那圈轮廓光。
   *
   * 几百个人挤在一起时，颜色解决不了"我在哪儿"——眼睛先看到的是密度不是色相。轮廓光解决的
   * 是这个：一圈比场上任何东西都亮的边，余光扫过就能捕捉到，不需要看清。
   *
   * 做法是把整个人再画四遍，各偏一个缓冲像素、整套调色板刷成同一个亮色（见 flatPalette），
   * 深度压在他自己身后 —— 于是只有偏出去的那一圈露在外面。这和 PixelSurface 给全体单位描
   * 暗边用的是同一个手法，区别只是这一份是逐角色的、亮的。
   *
   * 只给玩家画。代价是四份完整的人物图元（约二百八十个），对一个人可以接受，对场上一千人
   * 不行 —— 也没必要，人海里需要被一眼找到的只有一个。
   */
  private drawRim(c: Character, at: Vec2, grain: number, hot = false, ironBreath: number | null = null): void {
    // 冲刺时换一档更厚更亮的边。
    //
    // 冲刺是这个游戏里唯一一次"玩家自己高速位移"，而高速位移在俯视角下最容易读丢 —— 画面
    // 里几百个人都在动，凭什么看出哪一下是我冲出去的。把常驻那圈轮廓光加厚加亮就够了：
    // 不用另做一套特效，玩家看到的是"我本来就在发光，冲的时候更亮"，是同一件东西的两档。
    const iron = ironBreath !== null;
    const off = Math.max(1, Math.round(grain * (hot ? 0.7 : iron ? 0.54 : 0.34)));
    const palette = hot
      ? HERO_DASH_PALETTE
      : iron
        ? flatPalette(rgba(255, 245, 198, Math.round(218 + ironBreath * 37)))
        : HERO_RIM_PALETTE;
    // 压在自己身后半个屏幕行。再深就会被身后那一排人盖住，再浅就会盖住自己的腿。
    const depthRow = at.y - 0.5;
    for (const [dx, dy] of RIM_OFFSETS) {
      const p = new Projector(
        v2(at.x + dx * off, at.y + dy * off),
        c.facing,
        Projection.groundSquash,
        grain,
        depthRow,
      );
      drawCharacter(this.shapes, c.pose, p, palette, c.def, { lift: c.lift, silhouette: true });
    }
  }

}
