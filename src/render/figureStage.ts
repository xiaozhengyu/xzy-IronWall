import { drawCharacter } from '../characters/renderer';
import type { ImpactEffects } from '../effects/impact';
import { weaponImpactPoint } from '../effects/impact';
import { RigSpec } from '../characters/rig';
import type { Character } from '../game/character';
import { v2, type Vec2 } from '../core/math';
import { type Rgba, rgb } from './color';
import { Projection } from './projection';
import { Projector } from './projector';
import type { ShapeBatch } from './shapeBatch';

/**
 * 一个人站在一小块地上 —— 备战界面上唯一的一种"台子"。
 *
 * 选人那一步中间是一台，选图那一步底下一排敌人各占一台，两处走的是同一个函数：地块一样大、
 * 草一样流、人一样画。做成两份的话，改一次草色就要改两处，而两处迟早会长得不一样。
 */

/**
 * 备战界面那块地的颜色，以及它的深度。
 *
 * 绿色取的是场上草地那一带的色相（离线出图的底色是 71,105,59），但比它亮一点点 —— 这块地
 * 背后是画布的深色底，没有周围的草衬托，照搬会显得发闷。
 */
const STAGE_GRASS = rgb(80, 114, 63);
const STAGE_GRASS_LIT = rgb(98, 132, 72);
const STAGE_TUFT = rgb(56, 86, 47);
const STAGE_TUFT_LIT = rgb(116, 152, 84);
const STAGE_SOIL = rgb(52, 40, 30);
const STAGE_SOIL_LIT = rgb(68, 53, 38);
/** 在所有东西之后。见 drawStageTile 顶上那段。 */
const STAGE_DEPTH = -1000;

/**
 * 地块半径，世界单位。世界里这块地是 |x| + |y| ≤ R 的一块正方形。
 *
 * 宽度（2R）定成人物身高的 1.5 倍。它只是个站台，不是一片场地 —— 人根本不在上面移动
 * （走路是草在流），所以大没有任何好处，大了只是把人显得小。
 *
 * 用世界单位而不是像素：换一个颗粒度时，地块和人一起缩放，比例不变。
 */
export const STAGE_TILE_RADIUS = ((RigSpec.headZ + RigSpec.headRadius) * Projection.heightSquash * 1.5) / 2;

/**
 * 草丛的间距，世界单位。密到能看出流动，又不至于铺成一片噪点。
 *
 * 明暗拉得比场上的草更开一档：这块地只有两百像素宽，人的影子还盖掉中间一大片，太含蓄的
 * 草在上面根本看不出在动 —— 而"在动"正是它唯一要说的事。
 */
const TUFT_STEP = 2.0;

const hash01 = (x: number, y: number): number => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/** 把 v 卷回 [-half, half)。草丛从一边走出去，就从另一边走回来。 */
const wrap = (v: number, half: number): number => {
  const span = half * 2;
  return ((((v + half) % span) + span) % span) - half;
};

/**
 * 备战界面脚下那块地。
 *
 * 世界坐标里它是一个**转了 45 度的正方形**（|x| + |y| ≤ R），投影之后在屏幕上正好是一个
 * 菱形。这一点是重要的：它和场上所有东西共用同一组压扁系数，所以人站在上面时脚和地是贴合
 * 的，而不是"人踩在一张贴纸上"。
 *
 * 菱形本身一行一条横杠铺出来。ShapeBatch 只认矩形和椭圆，画不了任意四边形；而一行一行铺
 * 出来的斜边本来就是像素画该有的台阶边，正合适。
 *
 * **走路是靠草在动，不是靠人在走。** 人钉在地块中央，scroll 往他的朝向累加，草丛按 scroll
 * 的反方向流过去、从对边卷回来。这样一块很小的地也能一直走下去 —— 换成真的挪人，两步就
 * 撞到边上了，而这块地只有人的一倍半宽。
 *
 * 深度给一个很负的常数：这块地在所有东西之后，不参与按屏幕行排序。
 *
 * @param scrollX/scrollY 走过的路，世界单位。草丛按它的反方向流动。
 */
function drawStageTile(
  shapes: ShapeBatch,
  anchor: Vec2,
  radius: number,
  grain: number,
  scrollX = 0,
  scrollY = 0,
): void {
  const halfW = radius * grain;
  const halfH = radius * Projection.groundSquash * grain;
  // 土层厚度：下沿再往下垫几像素，这块地才有厚度，不然读作贴在背景上的一块色斑。
  const skirt = Math.max(2, Math.round(grain * 0.6));
  /** 上面两条棱上那道亮边有多宽，缓冲像素。 */
  const rim = Math.max(2, Math.round(grain * 0.45));

  /**
   * 逐**整数屏幕行**铺，不是把菱形均分成若干段。
   *
   * 均分那种写法（i 从 -N 到 N，y = anchor + i/N × halfH）在行距不是整一个像素时会漏行：
   * 行距 1.01 个像素时，误差每攒够一次就跳过一整行，而底下垫着的土层正好从那道缝里露出来 ——
   * 画面上是横穿地块的一道深色线。走整数行就不存在这个问题：一行就是一行。
   *
   * 每条横杠画在 y + 0.5 上，正好盖住第 y 行那一个像素。压在整数上会落在两行的交界处，
   * 到底填哪一行取决于填充规则，那是另一种漏行。
   */
  const top = Math.round(anchor.y - halfH);
  const bottom = Math.round(anchor.y + halfH);
  const rowWidth = (y: number): number => halfW * (1 - Math.min(1, Math.abs(y + 0.5 - anchor.y) / halfH));
  const line = (y: number, w: number, color: Rgba, depth: number): void => {
    if (w < 0.5) return;
    shapes.bar(v2(anchor.x - w, y + 0.5), v2(anchor.x + w, y + 0.5), 1, color, depth);
  };

  // 先铺土：整块菱形往下挪 skirt 画一遍，露出来的就是下面两条边下方那一圈土。
  for (let y = top; y <= bottom; y++) {
    const lit = y - anchor.y > halfH * 0.2;
    line(y + skirt, rowWidth(y), lit ? STAGE_SOIL_LIT : STAGE_SOIL, STAGE_DEPTH);
  }

  // 再铺草。
  for (let y = top; y <= bottom; y++) {
    const w = rowWidth(y);
    line(y, w, STAGE_GRASS, STAGE_DEPTH + 1);
    // 上面那两条边压亮一档：光从左上来（和 ShapeBatch.LIGHT_DIR 同一个方向），棱上最先吃到
    // 光。只描**边**不刷整片 —— 按行整片提亮会在中间切出一条横着的分界线，那条线在菱形上
    // 读作两块贴在一起的地，而不是一块地的两条棱。
    if (y + 0.5 < anchor.y && w > rim * 2) {
      const my = y + 0.5;
      shapes.bar(v2(anchor.x - w, my), v2(anchor.x - w + rim, my), 1, STAGE_GRASS_LIT, STAGE_DEPTH + 2);
      shapes.bar(v2(anchor.x + w - rim, my), v2(anchor.x + w, my), 1, STAGE_GRASS_LIT, STAGE_DEPTH + 2);
    }
  }

  // 草丛。位置按格点哈希，所以每一簇有自己固定的抖动和明暗，卷回来之后还是同一簇草，不会
  // 每帧重新掷一遍（那样是一片沸腾的噪点，不是一块地）。
  const cells = Math.ceil(radius / TUFT_STEP);
  for (let cy = -cells; cy <= cells; cy++) {
    for (let cx = -cells; cx <= cells; cx++) {
      const h = hash01(cx, cy);
      if (h > 0.72) continue; // 留出空地，不然整块地是一张均匀的网
      const baseX = cx * TUFT_STEP + (h - 0.5) * TUFT_STEP;
      const baseY = cy * TUFT_STEP + (hash01(cy, cx) - 0.5) * TUFT_STEP;
      const px = wrap(baseX - scrollX, radius);
      const py = wrap(baseY - scrollY, radius);
      // 菱形之外的不画。卷回来的那一簇先落在角上，正好是从边上冒出来。
      if (Math.abs(px) + Math.abs(py) > radius * 0.97) continue;
      const sx = Math.round(anchor.x + px * grain);
      // 和上面的横杠同一条规则：画在整数行的中心线上，才正好盖住那一行。
      const sy = Math.round(anchor.y + py * Projection.groundSquash * grain) + 0.5;
      const long = Math.max(1, Math.round(grain * 0.28));
      shapes.bar(
        v2(sx - long, sy),
        v2(sx + long, sy),
        1,
        h < 0.24 ? STAGE_TUFT_LIT : STAGE_TUFT,
        STAGE_DEPTH + 3,
      );
    }
  }
}

/**
 * 画一台：脚下那块地，加上站在正中的人。
 *
 * @param at        地块中心落在缓冲的哪个像素上。人就站在这一点，永远不挪窝。
 * @param grain     颗粒度。出货那一档（3.1）就是"和进游戏之后一样大"。
 * @param scroll    走过的路，世界单位。人不动，草按它的反方向流 —— 见 drawStageTile。
 * @param tileScale 只放大**地块**，不动人。选人那一台用它把地放宽一点：那是玩家唯一会盯着
 *                  看的一块地，人还在上面走，地宽一点草才流得开。
 * @param effects   这一台自己的冲击弧。台子的局部世界原点就是 at，所以镜头传 (0, 0)。
 *                  演示放招时用得上 —— 只播一个挥手动作是看不出"放了个技能"的。
 */
export function drawFigureStage(
  shapes: ShapeBatch,
  actor: Character,
  at: Vec2,
  grain: number,
  scrollX = 0,
  scrollY = 0,
  tileScale = 1,
  effects: ImpactEffects | null = null,
): void {
  drawStageTile(shapes, at, STAGE_TILE_RADIUS * tileScale, grain, scrollX, scrollY);
  drawCharacter(
    shapes,
    actor.pose,
    new Projector(at, actor.facing, Projection.groundSquash, grain),
    actor.palette,
    actor.def,
    { lift: actor.lift, mount: actor.mount },
  );
  // 弧和人在同一个批次里，所以谁压谁由深度说了算 —— 和打仗时是同一套排序。
  if (effects) effects.draw(shapes, 0, 0, at.x, at.y, grain);
}

/**
 * 台子上那一下技能的形状。
 *
 * 三种：一片扇面（横扫那路）、一整圈（回旋）、一道推出去的窄波（破空）。选人界面唯一能把
 * "这个人打起来什么样"说清楚的就是这个，三个人放同一道弧等于白放。
 */
export type StageSkillShape = 'fan' | 'ring' | 'wave';

/**
 * 台子上那道弧的粗细和落点白闪，都比战场上小得多。
 *
 * ImpactEffects 的粗细是**按颗粒度**给的（thickness × scale），而这台子的颗粒度是出货那一档
 * 的一倍八 —— 照搬战场的 weight，一道弧能有四十几个像素粗，糊住整个人。半径也只有战场的
 * 三分之一，所以脱离的火花（sparks）一律关掉：它的长度是按世界单位给的，在这么小的弧上
 * 是一圈比弧本身还长的直刺，读作海胆而不是刀光。
 */
const STAGE_ARC_WEIGHT = 0.5;
const STAGE_ARC_FLASH = 0.4;

/**
 * 在台子上放一道弧。
 *
 * 长度按**地块**给，不按兵种的攻击距离：武将的攻击距离是 34 个世界单位，在预览那个放大倍数
 * 下一道弧能扫出台子、盖到旁边的界面上去 —— 而这里要说的是形状，不是够多远。
 *
 * 放在这个文件里是为了让离线出图和线上走同一份：形状各写一份的话，图上验过的和玩家看到的
 * 迟早不是一回事。
 */
export function spawnStageSkill(
  effects: ImpactEffects,
  actor: Character,
  shape: StageSkillShape,
  reach: number,
): void {
  if (shape === 'ring') {
    effects.spawn(0, 0, actor.facing, {
      span: Math.PI * 2,
      from: 2,
      to: reach * 0.85,
      weight: STAGE_ARC_WEIGHT * 1.1,
      life: 0.5,
      overhead: true,
      style: 'ring',
      sparks: 0,
      flash: STAGE_ARC_FLASH,
      tint: rgb(255, 214, 130),
    });
    return;
  }
  const at = weaponImpactPoint(actor.pose, actor.def, 0, 0, actor.facing);
  if (shape === 'wave') {
    effects.spawn(at.x, at.y, actor.facing, {
      span: 0.9,
      from: 2,
      to: reach * 1.15,
      weight: STAGE_ARC_WEIGHT * 0.9,
      life: 0.55,
      overhead: true,
      style: 'surge',
      sparks: 0,
      flash: STAGE_ARC_FLASH,
      tint: rgb(214, 236, 255),
    });
    return;
  }
  effects.spawn(at.x, at.y, actor.facing, {
    span: 1.6,
    from: 1.2,
    to: reach,
    weight: STAGE_ARC_WEIGHT,
    life: 0.42,
    overhead: true,
    style: 'slash',
    sparks: 0,
    flash: STAGE_ARC_FLASH,
    tint: rgb(255, 226, 142),
  });
}
