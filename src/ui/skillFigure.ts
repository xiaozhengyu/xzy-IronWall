import { Character } from '../game/character';
import { unitAppearance } from '../characters/unitDef';
import { PALETTE_HERO } from '../characters/palette';
import { HUMAN_PACE, PLAYER_RUN_SPEED } from '../game/battle';
import { ImpactEffects } from '../effects/impact';
import { ShapeBatch, type PrimitiveSink } from '../render/shapeBatch';
import {
  STAGE_TILE_RADIUS, drawFigureStage, spawnStageSkill, type StageSkillShape,
} from '../render/figureStage';
import type { Rgba } from '../render/color';
import { skillById, type SkillId } from '../game/skills';
import type { HeroDef } from '../data/types';

/**
 * 牌面上那一小块：**这个角色正在放这一招**。
 *
 * 不是一张示意图，也不是一张烘好的静态图 —— 是把选人界面那个台子整个搬到牌上，人会挥、
 * 弧会扫，每张牌各放各的招。玩家在三选一里看到的就是他选完之后屏幕上会出现的东西。
 *
 * **走的是同一份渲染代码。** `drawFigureStage` 和 `spawnStageSkill` 就是选人界面那个台子用
 * 的两个函数，而它们只依赖 ShapeBatch（不依赖 Pixi，见 shapeBatch.ts 顶上那段）。所以这里
 * 只需要补一个把图元填进 2D 画布的 sink，四十行，剩下的全是现成的。
 *
 * 为什么不挂在主画布上（像选人界面那样在 DOM 上开个洞让画布透出来）：那条路要在战场那一帧
 * 上再叠一批图元，而图元是**按深度统一排序**的 —— 台子上的人会和战场上的人混在一起排。
 * 各牌自己一块画布之后，这一层和战场彻底无关，位置、层级、遮挡全归 CSS 管。
 */

/** 把图元填进 2D 画布。ShapeBatch 交出来的只有这两种东西。 */
class CanvasSink implements PrimitiveSink {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  private paint(color: Rgba): void {
    // a 是 0-255（见 render/color.ts），而 canvas 要 0-1。
    this.ctx.fillStyle = `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${(color.a / 255).toFixed(3)})`;
    this.ctx.fill();
  }

  quad(
    x0: number, y0: number, x1: number, y1: number,
    x2: number, y2: number, x3: number, y3: number, color: Rgba,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    this.paint(color);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, color: Rgba): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rotation, 0, Math.PI * 2);
    this.paint(color);
  }
}

/**
 * 画布的内部尺寸。CSS 再把它拉到牌面上那一格。
 *
 * **竖着比横着高。** 骠骑将军是骑马的，从马蹄到盔顶比步兵高出六个多世界单位，
 * 方格子里他的头正好被切掉。把格子变高而不是把人缩小：四个角色点过去，人必须是同一个
 * 大小，忽大忽小读作界面在跳。
 *
 * 比显示尺寸大一圈：弧扫出去会超出人的轮廓，画布小了就被切掉半截。
 */
const WIDTH = 176;
const HEIGHT = 212;
/**
 * 颗粒度。人从脚到头顶约 19 个世界单位，再被俯角压掉一截，7.2 下来屏幕上约八十几像素。
 *
 * 调到过 1.15（随手拍的），人只有二十像素高，牌上看过去是一个点 —— “这个角色在放这一招”
 * 这件事完全读不出来。
 */
const GRAIN = 7.2;
/**
 * 人站在画布的哪儿。
 *
 * 往**右上**挪：弧是朝左下扫的，人站正中的话弧会出画布。竖着压低一点 —— 人是从脚往上
 * 画的，头顶和举起来的武器要地方。
 *
 * 骑马的再往下压一截：他比步兵高出六个多单位，照步兵那个落点摆，头仍然会顶到框外。
 * （选人界面那排敌人用的是同一条办法，见 main.ts 的 foeStageFigures。）
 */
const ANCHOR_X = 0.6;
const FOOT = 0.58;
const FOOT_MOUNTED = 0.68;
/** 每隔多久重放一次。和牌面上别的动画一样的节奏，三张牌不会各闪各的。 */
const LOOP = 1.8;
/** 起手那一下在周期里的什么位置。留一小段静立，招式才有"起手"可言。 */
const SWING_AT = 0.25;

/**
 * 这一招在台子上画成哪种弧。null = 不画弧。
 *
 * **没匹配上就不画，不能兽底到扇面。** 上一版兽底给 fan，于是护身技、疾走这种根本
 * 没有"发动"的招式牌上，角色挥出了一道横扫 —— 牌面写的是铁布衫，画面演的是横扫，
 * 那比什么都不演更误人。
 *
 * 实在没弧可画的那几招（护身、疾走）就只站着 —— 它们本来就是"一直生效"，
 * 站着正是它们真实的样子。
 */
function stageShape(id: SkillId): StageSkillShape | null {
  const skill = skillById(id);
  if (skill.category === 'guard' || skill.kind === 'passive' || skill.kind === 'sustained') return null;
  // 围着人转一圈的：回旋、金钟罩、天地法相。前者是一圈推开，后两个是罩在身上的壳。
  if (id === 'spin' || id === 'aegis' || id === 'dharma') return 'ring';
  if (skill.arc !== null && skill.arc >= Math.PI * 1.99) return 'ring';
  // 打出去的：破空、开天、穿云箭，以及冲出去的突进。
  if (id === 'wave' || id === 'heavenSplit' || id === 'skyArrow' || id === 'lunge') return 'wave';
  return 'fan';
}

export class SkillFigure {
  readonly canvas = document.createElement('canvas');

  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sink: CanvasSink | null;
  private readonly shapes = new ShapeBatch();
  private readonly effects = new ImpactEffects();
  private readonly actor: Character;
  private readonly shape: StageSkillShape | null;
  private clock = LOOP;
  /** 这一招是不是"跑"。目前只有疾走。 */
  private readonly running: boolean;
  private scrollX = 0;
  private scrollY = 0;

  constructor(hero: HeroDef, skill: SkillId) {
    this.canvas.className = 'skill-figure';
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.ctx = this.canvas.getContext('2d');
    this.sink = this.ctx ? new CanvasSink(this.ctx) : null;
    this.actor = new Character(unitAppearance(hero.appearance), PALETTE_HERO, HUMAN_PACE);
    /*
     * 朝左下。
     *
     * 两件事：一是挥出去的那一下朝着牌面的空处，不会被自己的身体挡住；二是弧扫向左下，
     * 而图标挂在左上角 —— 两者各占一角，不互相压。
     */
    this.actor.facing = Math.PI * 0.75;
    this.shape = stageShape(skill);
    this.running = skillById(skill).kind === 'sustained';
    if (this.running) this.actor.speed = PLAYER_RUN_SPEED;
  }

  /** 推进一帧并重画。牌开着的时候由 requestAnimationFrame 驱动。 */
  step(dt: number): void {
    this.clock += dt;
    if (this.clock >= LOOP) {
      this.clock -= LOOP;
      this.effects.clear();
    }
    // 起手落在周期里固定的那一点上，不是一到头就挥 —— 前面那一段静立是"起手"的一部分。
    const before = this.clock - dt;
    if (before < LOOP * SWING_AT && this.clock >= LOOP * SWING_AT) {
      // 没弧的招不挥 —— 铁布衫不需要挥一下。
      if (this.shape) {
        this.actor.swing(0);
        spawnStageSkill(this.effects, this.actor, this.shape, STAGE_TILE_RADIUS * 1.35);
      }
    }
    /*
     * 疾走要**跑起来**。
     *
     * 它没有弧，但它也不是铁布衫那种"站着就生效"的东西 —— 它本身就是移动。
     * 让他站着的话，牌上一个不动的人恰恰把这一招说反了。
     *
     * 人不挪窝，动的只有步态和脚下那块地（scroll）—— 和选人界面那个台子一样。
     */
    if (this.running) {
      this.scrollX += Math.cos(this.actor.facing) * this.actor.speed * dt;
      this.scrollY += Math.sin(this.actor.facing) * this.actor.speed * dt;
    }
    this.actor.update(dt, true);
    this.effects.update(dt);
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const sink = this.sink;
    if (!ctx || !sink) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const shapes = this.shapes;
    shapes.clear();
    drawFigureStage(
      shapes,
      this.actor,
      { x: WIDTH * ANCHOR_X, y: HEIGHT * (this.actor.def.mounted ? FOOT_MOUNTED : FOOT) },
      GRAIN,
      this.scrollX,
      this.scrollY,
      1,
      this.effects,
    );
    shapes.flushToMesh(sink, WIDTH, HEIGHT);
  }
}
