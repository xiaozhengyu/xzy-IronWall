import { unitAppearance } from '../characters/unitDef';
import { ShapeBatch, type PrimitiveSink } from '../render/shapeBatch';
import { v2 } from '../core/math';
import type { Rgba } from '../render/color';
import { SkillStage } from './skillDemo';
import type { SkillId } from '../game/skills';
import type { HeroDef } from '../data/types';

/**
 * 牌面上那一小块：**这个角色正在放这一招**。
 *
 * 不是一张示意图，也不是一张烘好的静态图 —— 是把选人界面那个台子整个搬到牌上，人会挥、
 * 弧会扫，每张牌各放各的招。玩家在三选一里看到的就是他选完之后屏幕上会出现的东西。
 *
 * **走的是同一份渲染代码。** 台子是 `drawFigureStage`（选人界面那一份），一招演什么是
 * `SkillStage`（见 skillDemo.ts），两者都只依赖 ShapeBatch、不依赖 Pixi（见 shapeBatch.ts
 * 顶上那段）。所以这里只需要补一个把图元填进 2D 画布的 sink，四十行，剩下全是现成的。
 *
 * 为什么不挂在主画布上（像选人界面那样在 DOM 上开个洞让画布透出来）：那条路要在战场那一帧
 * 上再叠一批图元，而图元是**按深度统一排序**的 —— 台子上的人会和战场上的人混在一起排。
 * 各牌自己一块画布之后，这一层和战场彻底无关，位置、层级、遮挡全归 CSS 管。
 *
 * **这个文件只管画布**：多大、人站在哪一点、怎么填进 2D context。哪一招演什么、演多久全在
 * skillDemo.ts —— 那一份在 node 里也跑得起来，离线出图走的就是它。
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
 * 画布的内部尺寸，**和牌上那一格（hudCardPicker.css 的 .hud-card-stage）一个像素不差**。
 *
 * 以前是 176×212 铺到 132×159 的格子上 —— 0.75 倍的缩放，而这是一张像素图：四列里要扔掉
 * 一列，人身上的描边宽一处窄一处。1:1 之后 image-rendering 那条根本用不上，画出来是什么
 * 样，屏幕上就是什么样。
 *
 * 格子有多大、为什么这么大，理由写在 CSS 那边（那儿才看得见牌面还剩多少地方）。
 */
export const FIGURE_WIDTH = 240;
export const FIGURE_HEIGHT = 253;
/**
 * 颗粒度：这一格**镜头拉多远**。
 *
 * 按**最大的那个径向招**定：金钟罩的罩子半径是 20 个世界单位（见 skillDemo.ts 的
 * STAGE_SQUEEZE），乘 5.4 是 108 像素，而人站在画布正中、两边各有 120 —— 整个罩子在框里，
 * 上沿离顶也还剩一截。这一条是所有取景参数的出发点：罩子在场上有三个多身高宽（见
 * .preview-aegis.png），放不下它，牌上就只剩一圈贴身的光边，那是另一件事。
 *
 * 人回到七十像素上下，和格子撑大之前一样 —— "这个角色真在放这一招"和"这一招罩多大一片"
 * 两件事同时成立，靠的是格子变大，不是取景变紧。（中间试过在小格子里硬塞：4.0 能把罩子
 * 装下，但人只剩三十九像素，牌上读作一个小人；7.2 人够大，罩子半径两百多像素、画布才
 * 176 宽。两头都不行，说明该动的是格子。）
 *
 * 前冲的招（横扫、破空）和回旋的圈仍然会扫出画布 —— 那是对的：它们本来就比罩子够得远，
 * 牌面装不下正是这个意思。
 */
export const FIGURE_GRAIN = 5.4;
/**
 * 人站在画布的哪儿。
 *
 * 横着**正中**。以前偏右（0.6），因为那个取景里只有一道朝左下的弧要地方；现在罩子、圈、
 * 法相都是**以人为心**的，偏出去多少就在对面切掉多少 —— 一个偏心的圆读作画歪了。
 *
 * 竖着压低一点：人是从脚往上画的，头顶、举起来的武器、罩子的上沿都在上半边。
 *
 * 骑马的再往下压一截：他比步兵高出六个多单位，照步兵那个落点摆，头仍然会顶到框外。
 * （选人界面那排敌人用的是同一条办法，见 main.ts 的 foeStageFigures。）
 */
const ANCHOR_X = 0.5;
const FOOT = 0.56;
const FOOT_MOUNTED = 0.63;

/** 人脚落在画布的哪一点。离线出图也调它，格子里的落点得和牌上一致。 */
export const figureAnchor = (mounted: boolean, width = FIGURE_WIDTH, height = FIGURE_HEIGHT) =>
  v2(width * ANCHOR_X, height * (mounted ? FOOT_MOUNTED : FOOT));

export class SkillFigure {
  readonly canvas = document.createElement('canvas');

  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sink: CanvasSink | null;
  private readonly shapes = new ShapeBatch();
  private readonly stage: SkillStage;

  constructor(hero: HeroDef, skill: SkillId) {
    this.canvas.className = 'skill-figure';
    this.canvas.width = FIGURE_WIDTH;
    this.canvas.height = FIGURE_HEIGHT;
    this.ctx = this.canvas.getContext('2d');
    this.sink = this.ctx ? new CanvasSink(this.ctx) : null;
    this.stage = new SkillStage(
      unitAppearance(hero.appearance),
      skill,
      { width: FIGURE_WIDTH, height: FIGURE_HEIGHT },
      hero.base.attackRange,
    );
  }

  /** 推进一帧并重画。牌开着的时候由 requestAnimationFrame 驱动。 */
  step(dt: number): void {
    this.stage.step(dt);
    const ctx = this.ctx;
    const sink = this.sink;
    if (!ctx || !sink) return;
    ctx.clearRect(0, 0, FIGURE_WIDTH, FIGURE_HEIGHT);
    const shapes = this.shapes;
    shapes.clear();
    this.stage.draw(shapes, figureAnchor(this.stage.actor.def.mounted), FIGURE_GRAIN);
    shapes.flushToMesh(sink, FIGURE_WIDTH, FIGURE_HEIGHT);
  }
}
