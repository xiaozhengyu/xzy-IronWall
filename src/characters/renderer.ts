import {
  type Vec2,
  type Vec3,
  PI_OVER_2,
  V3_UNIT_X,
  V3_UNIT_Z,
  V3_ZERO,
  clamp,
  cross3,
  dot2,
  lenSq3,
  lerp,
  lerp2,
  lerp3,
  norm3,
  v2,
  v3,
} from '../core/math';
import { type Rgba, lerpColor, rgb, rgba, shade, tone } from '../render/color';
import { Projection } from '../render/projection';
import { Projector, projectUprightDisc } from '../render/projector';
import { ShapeBatch } from '../render/shapeBatch';
import { drawHorse } from './horseRenderer';
import type { HorsePose } from './horse';
import { tokenScale } from './lod';
import type { CharacterPalette } from './palette';
import { type Pose, RigSpec } from './rig';
import { BUTT_FRACTION, HAMMER_HEAD_RADIUS, type UnitDef, bladeLength, hammerLength, shaftLength } from './unitDef';

/**
 * 用基础图形把一个人画出来。移植自 overlord 的 CharacterRenderer。
 *
 * 通篇只有两条原则，其余都是它们的推论：
 *   1. 每个部件是一块平涂 + 一条硬边阴影，绝不做渐变。三档色阶塞进一条八像素宽的肢体里，
 *      每档只占一个像素，眼睛会把它们平均回一个柔和的单色，人物于是读作模压塑料。
 *   2. 对比留在部件之间，不在部件内部。浅色盔顶压深色盔檐、深色盔檐压明亮的脸 ——
 *      一个硬边台阶哪怕只有一像素宽，仍然是个台阶。
 */

// 叠加在各部件投影深度之上的画家顺序偏移。这些值全都远小于 Projector.DEPTH_PER_ROW，
// 所以它们永远不会把两个不同的人排反。
const DEPTH_SHADOW = -22;
const DEPTH_LEG = 0;
const DEPTH_CAPE = 1.1;
const DEPTH_TORSO = 2.2;
const DEPTH_ARM = 4;
const DEPTH_SHIELD = 5;
// 低到让持在远侧的武器从头后面过，高到让身前的突刺盖住身体。
const DEPTH_WEAPON = 6;
// 在武器之上、头之下：拳头要合在杆上，但横过面门的手臂仍然从脸后面过。
const DEPTH_HAND = 6.6;
const DEPTH_QUIVER = 3;
const DEPTH_HEAD = 8;
const DEPTH_PLUME = 8.5;
const DEPTH_DEBUG = 14;

/**
 * 塔盾从草皮一直立到下巴底下，所以躲在后面的人只露一个头 —— 这正是扛这玩意的全部理由。
 * 两条边都从头骨推出来而不是写死，人物比例一旦重调，盾牌会自己跟上。
 */
const SHIELD_FOOT_Z = 0.3;
const SHIELD_TOP_Z = RigSpec.headZ - RigSpec.headRadius * 1.05;

export { tokenScale } from './lod';

/**
 * 平涂档：每个部件只画本体，不画那条硬边阴影带。
 *
 * 这是介于完整人物和色块之间的一档，为了帧率而存在。满屏几百人时，几何那一块（算图元 →
 * 按深度排序 → 写顶点缓冲）是整帧开销的一半，而它三样全都线性跟着**图元数**走 —— 所以
 * 唯一能动的就是每个人由多少个图元组成。
 *
 * 砍的是 slab/band/limb 各自那条阴影带，也就是本文件开头原则 1 里的"一块平涂 + 一条硬边
 * 阴影"中的后半截。轮廓、比例、部件数一个不动，所以人还是同一个人，只是不再有那一档明暗。
 * 每人 57~78 个图元降到 38~52，约三分之一。
 *
 * 代价是真实的：在出货尺寸（人 50 像素高）下肢体有八个像素宽，那条阴影带看得见。所以这
 * 不是"免费的等价简化"，是一档换帧率的画质选项 —— 该不该开由外面定，这里只负责画。
 *
 * 用模块级开关而不是层层传参：slab/band/limb 有二十几处调用，而绘制是同步的、一个人画完
 * 才画下一个，drawCharacter 进来时设一次就够。和上面的 tokenScale 是同一类东西。
 */
let lite = false;

export interface DrawOptions {
  /** 刚挨打的两帧里盖在躯干上的白光，0..1。 */
  hurt?: number;
  /** 离地高度，世界单位。击飞时影子按它缩小变淡。 */
  lift?: number;
  /** 平涂档：省掉每个部件那条硬边阴影带，图元数降三分之一。见 lite。 */
  lite?: boolean;
  /**
   * 剪影模式：这一遍画的不是这个人，是他的轮廓。
   *
   * 轮廓光的做法是把整个人再画几遍、各偏一个像素、整套调色板刷成同一个亮色（见 Scene.drawRim）。
   * 但人物身上有几处**写死的黑**不走调色板 —— 脚下的影子、下巴底下那条遮挡带 —— 它们照常
   * 画出来，四份叠在一起就是脚下一团黑斑和下巴上一道黑线，看着像渲染坏了。
   *
   * 这个开关把那几处关掉。它们表达的都是"这块被挡住了"，而一份剪影里没有"被挡住"这回事。
   */
  silhouette?: boolean;
  /**
   * 坐骑的姿势。给了它就先画马再画人（见 Character.mount）。
   *
   * 走参数而不是让渲染器自己去问 def：drawCharacter 收的是一份 Pose，不是一个 Character ——
   * 轮廓光、头像、备战台子上那几条路各自持有姿势的方式都不一样，谁有马谁自己带过来。
   */
  mount?: HorsePose | null;
}

export function drawCharacter(
  shapes: ShapeBatch,
  pose: Pose,
  p: Projector,
  palette: CharacterPalette,
  def: UnitDef,
  options: DrawOptions = {},
): void {
  const hurt = options.hurt ?? 0;
  const lift = options.lift ?? 0;
  const silhouette = options.silhouette ?? false;
  const mount = def.mounted ? options.mount ?? null : null;
  lite = options.lite ?? false;

  if (p.scale < tokenScale.value) {
    // 色块档下马也只是一个色块，但它得画 —— 一队骑兵在那个尺寸下大半的面积就是马。
    if (mount) drawHorse(shapes, mount, p, palette, def);
    drawToken(shapes, pose, p, palette, def, hurt);
    return;
  }

  // 马垫在最底下。它自带影子，所以骑兵不再画人的那一块 —— 两块椭圆叠在一起是一团更黑的
  // 斑，读作地上有个洞。
  //
  // 剪影那一遍连马一起跳过：马身上那块影子是写死的黑，不走调色板（和人脚下那块同理，见
  // DrawOptions.silhouette），四份叠起来就是一团渲染坏了的黑斑。目前只有玩家会走剪影，
  // 而玩家没有骑马这一档。
  if (mount) {
    if (!silhouette) drawHorse(shapes, mount, p, palette, def);
  } else if (!silhouette) {
    drawShadow(shapes, p, lift);
  }

  if (def.cape) drawCape(shapes, p, pose, palette, def);
  drawLeg(shapes, p, pose, palette, def, 0);
  drawLeg(shapes, p, pose, palette, def, 1);
  if (def.quiver) drawQuiver(shapes, p, pose, palette);
  drawTorso(shapes, p, pose, palette, def);
  drawArm(shapes, p, pose, palette, def, 0);
  drawArm(shapes, p, pose, palette, def, 1);
  drawHead(shapes, p, pose, palette, def, silhouette);

  if (def.shield !== 'none') drawShield(shapes, p, pose, palette, def);
  drawWeapon(shapes, p, pose, palette, def);
  drawHands(shapes, p, pose, palette, def);

  if (hurt > 0) drawHurtFlash(shapes, p, pose, def, hurt);
}

/**
 * 只画角色腰部以上的模型。
 *
 * 天地法相复用玩家正在使用的骨架、装备和动作，但不需要腿、影子与武器：法相本身是一层罩住
 * 玩家的大型上半身外壳。保留双臂和双手，玩家转身、挥击时外壳会和本体保持完全相同的朝向与
 * 姿态。
 */
export function drawCharacterUpperBody(
  shapes: ShapeBatch,
  pose: Pose,
  p: Projector,
  palette: CharacterPalette,
  def: UnitDef,
  options: Pick<DrawOptions, 'silhouette'> = {},
): void {
  const silhouette = options.silhouette ?? false;
  drawTorso(shapes, p, pose, palette, def);
  drawArm(shapes, p, pose, palette, def, 0);
  drawArm(shapes, p, pose, palette, def, 1);
  drawHead(shapes, p, pose, palette, def, silhouette);
  drawHands(shapes, p, pose, palette, def);
}

/**
 * 八像素高时，一整个人只用四个 quad。
 *
 * 影子、躯干、头，外加刚挨打时的白光。躯干带阵营色、头带自己的色调，这两样是那个尺寸下
 * 唯一还活着的东西 —— 也恰好是让玩家分清谁是谁、数清有几个的那两样。
 */
function drawToken(
  shapes: ShapeBatch,
  pose: Pose,
  p: Projector,
  palette: CharacterPalette,
  def: UnitDef,
  hurt: number,
): void {
  // 躯干永远带阵营色，不管这人穿的是什么。重甲保留一个偏灰偏亮的阵营色版本，而不是
  // 整个丢掉区分度 —— 那是"他穿了甲"在八像素下唯一能留下的信息，而且不占用那个尺寸下
  // 真正重要的东西。
  const plate = def.armor === 'plate';
  const body = plate ? lerpColor(palette.cloth, palette.steel, 0.45) : palette.cloth;

  const t = def.helmetTone <= 0 ? 1 : def.helmetTone;
  const steel = def.helmet === 'cap' || def.helmet === 'kettle' || def.helmet === 'conical' || def.helmet === 'great';
  const head = tone(steel ? palette.steel : def.helmet === 'soft' ? palette.felt : palette.hair, t);

  const hip = p.screen(pose.hip);
  const chest = p.screen(pose.chest);
  const width = p.s(RigSpec.torsoHalfWidth * def.bulk * 2);

  shapes.ellipse(
    p.screen(V3_ZERO),
    p.s(RigSpec.hipHalfWidth * 2.1),
    p.s(RigSpec.hipHalfWidth * 2.1 * Projection.groundSquash),
    0,
    rgba(0, 0, 0, 70),
    p.depth(V3_ZERO) + DEPTH_SHADOW,
  );

  // 从胯到头一笔带过，腿是被暗示出来的，不是画出来的。
  shapes.capsule(hip, chest, width, hurt > 0 ? lerpColor(body, rgb(255, 255, 255), hurt) : body, p.depth(pose.chest) + DEPTH_TORSO);
  shapes.disc(p.screen(pose.head), p.s(RigSpec.headRadius * 1.05), head, p.depth(pose.head) + DEPTH_HEAD);
}

/**
 * 挨打后两帧盖在躯干上的一层淡光。
 *
 * 一个图元，画在身体所有部件之上。血花说的是打在哪儿；这个说的是谁挨了 —— 在四十个人
 * 挤在一起时，血点在它主人亮起来之前不属于任何人。
 */
function drawHurtFlash(shapes: ShapeBatch, p: Projector, pose: Pose, def: UnitDef, hurt: number): void {
  const chest = p.screen(pose.chest);
  const hip = p.screen(pose.hip);
  const width = p.crossSectionWidth(RigSpec.torsoHalfWidth * def.bulk * 1.25, RigSpec.torsoHalfDepth * def.bulk * 1.25);
  const wash = rgba(255, 228, 226, Math.round(210 * hurt * hurt));
  shapes.capsule(hip, chest, width, wash, p.depth(pose.chest) + DEPTH_HAND + 0.5);
}

/**
 * @param lift 离地多高，世界单位。0 = 站在地上。
 *
 * 人飞起来时影子要缩小变淡。俯视角下"飞得高"和"飞得远"在屏幕上是同一个方向的位移，光看
 * 身体分不出来 —— 影子是唯一钉在地面上的东西，它和身体拉开多远、缩得多小，就是高度的读数。
 * 不缩的话，一个飞到半空的人拖着一块和站着时一样大的影子，读起来像是贴着地面滑出去的。
 */
function drawShadow(shapes: ShapeBatch, p: Projector, lift = 0): void {
  // 12 个单位（人高的六成）处缩到一半。倒数衰减而不是线性：线性缩到零就没有影子了，而
  // 影子是这个人和地面之间唯一的联系 —— 断掉的话，飞在高处的人读作贴在镜头上的一张贴纸。
  // 下限 0.5 也是为这个：再高也得留一小块。
  const k = Math.max(0.5, 1 / (1 + lift / 12));
  shapes.ellipse(
    p.screen(V3_ZERO),
    p.s(RigSpec.shadowRadius * k),
    p.s(RigSpec.shadowRadius * k * Projection.groundSquash),
    0,
    rgba(0, 0, 0, Math.round(70 * k)),
    p.baseDepth + DEPTH_SHADOW,
  );
}

/**
 * 挂在肩后的一件分段收窄的白斗篷。它是由真实的身体空间点定位的，所以背面视角会把它带到
 * 躯干之前，正面视角则只露出两条外缘。三块方头板在游戏尺寸下已经够用，也保住了硬边的
 * 像素轮廓。
 */
function drawCape(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, def: UnitDef): void {
  const back = RigSpec.torsoHalfDepth * def.bulk;
  const top = v3(pose.chest.x, pose.chest.y - back - 0.35, pose.chest.z + 0.35);
  // 和甲裙不同，这是一件整披风：静止时下摆扫到地面。把末端留在接近地面的高度上，也能
  // 防止胯的起伏让长斗篷每走一步就明显地从脚踝上弹开。
  const restingHem = v3(pose.hip.x, pose.hip.y - back - 1.65, 0.28);

  // 跑动时长斗篷仍会掀起，但只有布料动画竖直分量的一半左右，这样它还是读作及踝的长披风，
  // 而不是缩水成一件短斗篷。
  const motion = v3(pose.capeSwing * 1.08, -pose.capeTrail * 1.12, pose.capeLift * 0.52);
  const hem = v3(restingHem.x + motion.x, restingHem.y + motion.y, restingHem.z + motion.z);
  const upper = addScaled(lerp3(top, restingHem, 0.34), motion, 0.16);
  const lower = addScaled(lerp3(top, restingHem, 0.68), motion, 0.52);

  // 暖白和旁边冷调的蓝灰钢色拉得开。深色边缘刻意压得重：在游戏尺寸下它常常是把白斗篷
  // 和明亮的肩甲分开的唯一一个像素。
  const capeShadow = rgb(148, 154, 164);
  const capeWhite = rgb(232, 232, 222);
  const capeLight = rgb(252, 250, 238);

  const width = (halfWidth: number): number => p.crossSectionWidth(halfWidth, 0.28);
  const panel = (a: Vec3, b: Vec3, halfWidth: number): void => {
    const depth = p.depth(lerp3(a, b, 0.5)) + DEPTH_CAPE;
    slab(shapes, p.screen(a), p.screen(b), width(halfWidth), capeShadow, capeWhite, capeLight, depth);
  };

  panel(top, upper, RigSpec.shoulderHalfWidth * 0.84 * def.bulk);
  panel(upper, lower, RigSpec.shoulderHalfWidth * 1.04 * def.bulk);
  panel(lower, hem, RigSpec.shoulderHalfWidth * 1.3 * def.bulk);

  if (p.detailed) shapes.disc(p.screen(top), p.s(0.55), palette.trim, p.depth(top) + DEPTH_TORSO - 0.02);
}

function drawLeg(
  shapes: ShapeBatch,
  p: Projector,
  pose: Pose,
  palette: CharacterPalette,
  def: UnitDef,
  side: number,
): void {
  const hip = pose.hipSocket(side);
  const knee = side === 0 ? pose.kneeL : pose.kneeR;
  const foot = side === 0 ? pose.footL : pose.footR;

  const depth = p.depth(lerp3(hip, foot, 0.5)) + DEPTH_LEG;

  // 远侧那条腿压暗一档，两条腿重叠时才分得开。
  const far = p.depth(foot) < p.depth(side === 0 ? pose.footR : pose.footL);
  const dim = far ? 0.78 : 1;

  // 腿属于这个人，不属于另外一条棕裤子。用和躯干同一个颜色推出来并压暗一档，从上往下看
  // 整个人读作一团在底部渐入阴影的整体，而不是一个彩色方块架在棕色的腿上。
  const legBase = def.armor === 'plate' ? palette.steel : palette.cloth;
  const trouser = shade(legBase, 0.76 * dim);
  const trouserDark = shade(legBase, 0.6 * dim);

  const hide = def.leatherKit;
  const greaves = !hide && def.armor === 'plate';
  const shin = hide ? shade(palette.leather, dim) : greaves ? shade(palette.steelShade, dim) : trouser;
  const shinDark = hide ? shade(palette.leatherDark, dim) : greaves ? shade(palette.steelDark, dim) : trouserDark;
  const boot = hide ? shade(palette.leather, 0.82 * dim) : shade(legBase, far ? 0.5 : 0.58);

  const thick = RigSpec.legThickness * def.bulk;

  limb(shapes, p.screen(hip), p.screen(knee), p.s(thick), trouser, trouserDark, depth);
  limb(shapes, p.screen(knee), p.screen(foot), p.s(thick * 0.9), shin, shinDark, depth + 0.01);

  // 膝甲：膝盖上的一枚小钢碗。膝盖是这条腿上唯一一个"关节在哪儿"读得出来的位置，
  // 一块高光钉在那儿，走路时腿的折弯才有东西可看 —— 否则一条从胯直通到脚的色带
  // 在任何步态下都只是在平移。
  if (def.poleyns) {
    const at = p.screen(knee);
    const kr = p.s(thick * 0.62);
    // 和尾锤、盾钉一样走矩形：这个尺寸下的膝甲是四五个像素，圆盘的顶点全花在看不见的
    // 圆角上。
    shapes.rect(at, kr * 1.7, kr * 1.5, 0, shade(palette.steelShade, dim), depth + 0.015);
    shapes.rect(
      v2(at.x + kr * 0.3 * ShapeBatch.LIGHT_DIR.x, at.y + kr * 0.3 * ShapeBatch.LIGHT_DIR.y),
      kr * 0.8,
      kr * 0.6,
      0,
      shade(palette.steel, dim),
      depth + 0.016,
    );
  }

  // 一个圆头的鞋尖，完全没有方向性。
  //
  // 原本这里是从脚踝到脚尖的一个胶囊，按脚的偏航角转向。那个偏航是身体空间的角度，横着
  // 走时它的横向分量被地面压扁、朝镜头走时完全不压 —— 于是同一个外撇侧看什么都不是、
  // 正看却几乎翻倍，脚尖看起来内扣正是出在这儿。这个尺寸下整只靴子不到两个单位宽，方向
  // 本来就读不出来；而一个圆点不可能内八。
  const footR = p.s(thick * RigSpec.footThickness * 0.5 * (hide ? 1.55 : 1));
  shapes.disc(p.screen(foot), footR, boot, depth + 0.02);
  // 皮靴宽到能容下一条鞋底。那一像素的近黑是脚和草地之间唯一的分界 —— 少了它，
  // 靴子的下缘会直接融进影子里，人看着像陷在地里半寸。
  if (hide) {
    const at = p.screen(foot);
    shapes.rect(v2(at.x, at.y + footR * 0.58), footR * 1.9, footR * 0.62, 0, shade(palette.leatherDark, dim), depth + 0.022);
  }
}

/**
 * 一条肢体画成一块平板：一个颜色、方头、背光侧一条硬边阴影。
 *
 * 这替换掉了原来的三色胶囊，而两者的差别就是"人物看起来像模压塑料"的全部来源。胶囊把
 * 轮廓花在圆头上、把内部花在渐变上，而在八像素宽的地方，渐变的三条带各占一个像素 ——
 * 眼睛会把它们积分回一个柔和的平均色，肢体读作一根油泥香肠。两个平涂值加一个硬边台阶
 * 花的是同样两次绘制，却能在像素网格上活下来。
 */
function limb(shapes: ShapeBatch, a: Vec2, b: Vec2, w: number, mid: Rgba, dark: Rgba, depth: number): void {
  let ax = v2(b.x - a.x, b.y - a.y);
  const len = Math.sqrt(ax.x * ax.x + ax.y * ax.y);
  ax = len > 1e-3 ? v2(ax.x / len, ax.y / len) : v2(0, -1);

  // 背离主光源的那条法线：阴影画在那一侧。
  let n = v2(-ax.y, ax.x);
  if (dot2(n, ShapeBatch.LIGHT_DIR) > 0) n = v2(-n.x, -n.y);

  shapes.bar(a, b, w, mid, depth);
  if (lite) return;
  const off = w * 0.33;
  shapes.bar(v2(a.x + n.x * off, a.y + n.y * off), v2(b.x + n.x * off, b.y + n.y * off), w * 0.34, dark, depth + 0.002);
}

/** 一个拳头：一块平涂圆盘，底下咬一口硬阴影。 */
function fist(shapes: ShapeBatch, at: Vec2, r: number, mid: Rgba, dark: Rgba, depth: number): void {
  shapes.disc(at, r, mid, depth);
  shapes.rect(v2(at.x, at.y + r * 0.6), r * 1.5, r * 0.7, 0, dark, depth + 0.002);
}

/**
 * 两点之间的平板，方头，受光侧带一条亮边。
 *
 * 胶囊版本会把两端各磨掉半个宽度的圆角，那对肢体没问题，对一个宽大于长的躯干则是灾难。
 */
function slab(
  shapes: ShapeBatch,
  a: Vec2,
  b: Vec2,
  w: number,
  shadowColor: Rgba,
  mid: Rgba,
  light: Rgba,
  depth: number,
): void {
  // 色阶朝侧向偏移，而不是沿着公共光照向量。肢体通常和光线成一定角度，通用偏移正好落在
  // 它横向上；但躯干几乎和光线平行 —— 沿光偏移只会把色调顺着身体滑上去，躯干出来是平的。
  // 改取横跨板面的分量，任何朝向下都能在向光的那一侧得到一条亮边。
  let ax = v2(b.x - a.x, b.y - a.y);
  const len = Math.sqrt(ax.x * ax.x + ax.y * ax.y);
  ax = len > 1e-3 ? v2(ax.x / len, ax.y / len) : v2(0, -1);

  let n = v2(-ax.y, ax.x);
  if (dot2(n, ShapeBatch.LIGHT_DIR) < 0) n = v2(-n.x, -n.y);

  // 两个值，不是三个。中间色铺满板面，阴影是背光侧的一条硬边；原来的第三条带是一像素宽
  // 的高光，最后总会被平均回另外两个值里去。
  shapes.bar(a, b, w, mid, depth);
  if (lite) return;
  const o1 = w * 0.33;
  shapes.bar(v2(a.x - n.x * o1, a.y - n.y * o1), v2(b.x - n.x * o1, b.y - n.y * o1), w * 0.34, shadowColor, depth + 0.002);

  // 亮边只在宽到不止一条线的地方才活得下来。
  if (w > 5) {
    const o2 = w * 0.38;
    shapes.bar(v2(a.x + n.x * o2, a.y + n.y * o2), v2(b.x + n.x * o2, b.y + n.y * o2), w * 0.18, light, depth + 0.003);
  }
}

/**
 * 横过躯干的一条带子：一个平涂色，加上背光侧的一条硬阴影。用平涂是因为这个尺寸下能读出来
 * 的是带与带之间的台阶 —— 一条两像素高的带子内部再做渐变，就是三个谁也分不出的颜色。
 */
function band(
  shapes: ShapeBatch,
  center: Vec2,
  width: number,
  height: number,
  across: number,
  color: Rgba,
  depth: number,
): void {
  let along = v2(Math.cos(across), Math.sin(across));
  if (dot2(along, ShapeBatch.LIGHT_DIR) < 0) along = v2(-along.x, -along.y);

  shapes.rect(center, width, height, across, color, depth);
  if (lite) return;
  const o = width * 0.34;
  shapes.rect(v2(center.x - along.x * o, center.y - along.y * o), width * 0.32, height, across, shade(color, 0.72), depth + 0.001);
}

function drawTorso(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, def: UnitDef): void {
  const hip = p.screen(pose.hip);
  const chest = p.screen(pose.chest);
  const depth = p.depth(pose.chest) + DEPTH_TORSO;

  // 肚子：把腰的横截面插到比胸还宽、还深，轮廓就在中间鼓出来。
  //
  // 光调 bulk 做不出胖子 —— 那是等比例放大，得到的是"大只"。骨架默认腰最细（腰 3.15
  // 对胸 3.95），这是个收腰的士兵；胖子恰好相反，最宽的地方在肚子。纵深比横宽多鼓一点，
  // 所以侧面看肚子比正面看更明显，这也符合真人。
  const belly = clamp(def.paunch, 0, 1);
  const waistHalfWidth = lerp(RigSpec.waistHalfWidth, RigSpec.torsoHalfWidth * 1.16, belly);
  const waistHalfDepth = lerp(RigSpec.waistHalfDepth, RigSpec.torsoHalfDepth * 1.34, belly);
  // 骨盆跟着长一点，否则肚子会像挂在一副窄胯上。
  const pelvisHalfWidth = lerp(RigSpec.pelvisHalfWidth, RigSpec.pelvisHalfWidth * 1.1, belly);
  const pelvisHalfDepth = lerp(RigSpec.pelvisHalfDepth, RigSpec.pelvisHalfDepth * 1.2, belly);

  // 宽度取决于朝向：正面宽，侧面窄。
  const wChest = p.crossSectionWidth(RigSpec.torsoHalfWidth * def.bulk, RigSpec.torsoHalfDepth * def.bulk);
  const wWaist = p.crossSectionWidth(waistHalfWidth * def.bulk, waistHalfDepth * def.bulk);
  const wPelvis = p.crossSectionWidth(pelvisHalfWidth * def.bulk, pelvisHalfDepth * def.bulk);

  // 躯干上任意高度的视宽，好让下面那些带子贴着轮廓走，而不是全都按肩宽裁。
  const widthAt = (t: number): number =>
    t < RigSpec.waistFrac
      ? lerp(wPelvis, wWaist, t / RigSpec.waistFrac)
      : lerp(wWaist, wChest, (t - RigSpec.waistFrac) / (1 - RigSpec.waistFrac));

  const plate = def.armor === 'plate';
  const body = plate ? lerpColor(palette.cloth, palette.steel, 0.45) : palette.cloth;
  const bodyDark = plate ? palette.steelDark : palette.clothShade;
  const bodyLit = plate ? palette.steelLight : palette.clothLight;

  const across = Math.atan2(chest.y - hip.y, chest.x - hip.x) + PI_OVER_2;

  // 方头的板，不是胶囊。胶囊的实体会各自越过端点半个自身宽度，而躯干从胯到胸不过 5 个
  // 单位长、却有 8 个单位宽 —— 一个从胯到胸的胶囊实际会从头顶盖到接近地面，把腿完全埋掉。
  // 那个外溢（而不是骨架）才是身体看起来像坐着的原因。方头把实体严格放在两个关节之间，
  // 而且参考精灵图里的肩膀本来就是方的。
  const seat = hip;
  const crown = chest;
  const waist = lerp2(seat, crown, RigSpec.waistFrac);
  const upper = lerp2(seat, crown, 0.7);

  // 胯以下的外袍，先画，垂到大腿中段。刻意不算进"臀-腰-胸"那一串：那些带子都是按胯到胸
  // 的比例定位的，把这段跨度拉长会把腰带和甲片一起往下拽。
  const hem = p.screen(v3(pose.hip.x, pose.hip.y, pose.hip.z - RigSpec.hemDrop));
  const skirtShadow = shade(bodyDark, 0.82);
  const skirtMid = shade(body, 0.84);
  const skirtLit = shade(bodyLit, 0.84);
  if (def.skirt) {
    // 甲裙张开，分两段画。一整条等宽的板挂在胯下读作一条筒裙，而参考图上（以及几乎所有
    // 这个路子的美术里）裙摆是往外张的 —— 张开的下摆把整个人的轮廓收成一个梯形，
    // 那个梯形才是"重装"在远处唯一还读得出来的信号。
    //
    // 两段而不是一条锥线：这个尺寸下一条连续的斜边会被栅格化成锯齿，而一个台阶就是
    // 一个台阶。
    const knee = lerp2(hem, seat, 0.46);
    slab(shapes, knee, seat, wPelvis * 0.98, skirtShadow, skirtMid, skirtLit, depth);
    slab(shapes, hem, knee, wPelvis * 1.16, skirtShadow, skirtMid, skirtLit, depth + 0.001);
  } else {
    slab(shapes, hem, seat, wPelvis * 0.94, skirtShadow, skirtMid, skirtLit, depth);
  }

  // 臀、腰、胸廓 —— 自下而上画，胸最后压在上面。骨盆压暗一档：它在胸廓的悬垂之下，
  // 永远吃不到主光。
  slab(shapes, seat, waist, wPelvis, shade(bodyDark, 0.88), shade(body, 0.9), shade(bodyLit, 0.9), depth);
  slab(shapes, waist, upper, wWaist, bodyDark, body, bodyLit, depth);
  slab(shapes, upper, crown, wChest, bodyDark, body, bodyLit, depth);

  // 横过躯干的带子。它们必须是平的矩形：胶囊的圆头会鼓出半个躯干宽，把整件外衣吞掉。
  if (def.skirt) {
    band(shapes, lerp2(seat, crown, 0.08), widthAt(0.08) * 1.12, p.s(2.0), across, plate ? palette.steelDark : palette.clothShade, depth + 0.01);
  } else {
    band(shapes, lerp2(seat, crown, 0.14), widthAt(0.14) * 0.99, p.s(1.5), across, palette.clothShade, depth + 0.01);
  }

  // 板甲没有露在外面的腰带 —— 胸甲直接接到腿甲上。
  if (!plate) band(shapes, lerp2(seat, crown, 0.3), widthAt(0.3) * 0.96, p.s(1.0), across, palette.leather, depth + 0.02);

  switch (def.armor) {
    case 'leather':
      band(shapes, lerp2(seat, crown, 0.62), widthAt(0.62) * 0.92, p.s(1.4), across, palette.leather, depth + 0.03);
      break;

    case 'lamellar': {
      // 永远有一条钢带；整排甲片只在放大时才出现。
      band(shapes, lerp2(seat, crown, 0.68), widthAt(0.68) * 0.95, p.s(1.8), across, palette.steelShade, depth + 0.03);
      if (p.detailed) {
        for (let i = 0; i < 3; i++) {
          const t = 0.42 + i * 0.11;
          band(shapes, lerp2(seat, crown, t), widthAt(t) * 0.9, p.s(0.5), across, palette.steelDark, depth + 0.04);
        }
      }
      break;
    }

    case 'plate':
      // 一条阵营色的罩袍带加金边，别的什么都不加：这个尺寸下再多分带，胸甲就变成一叠条纹。
      band(shapes, lerp2(seat, crown, 0.5), widthAt(0.5) * 0.98, p.s(2.6), across, palette.cloth, depth + 0.03);
      if (p.detailed) band(shapes, lerp2(seat, crown, 0.36), widthAt(0.36) * 0.98, p.s(0.5), across, palette.trim, depth + 0.04);
      break;
  }

  // 斜挎带。一条从右肩越过胸口到左胯的皮带 —— 参考图上它是整个躯干唯一一条斜线，
  // 而躯干上其它所有东西（腰带、甲片、罩袍带）都是横的。一条斜线就够把一块平板读成
  // 一个有厚度的胸膛。
  //
  // 背对镜头时不画：挎带走的是胸前，从背后看那儿是空的。
  if (def.baldric && p.facingCamera > -0.3) {
    const front = RigSpec.torsoHalfDepth * def.bulk * 0.7;
    const shoulder = pose.shoulderSocket(1);
    const a = v3(shoulder.x * 0.72, shoulder.y - front * 0.7, shoulder.z - 0.5);
    const b = v3(-RigSpec.hipHalfWidth * 0.55 * def.bulk, pose.hip.y - front, pose.hip.z + 1.7);
    shapes.bar(p.screen(a), p.screen(b), p.s(0.85 * def.bulk), palette.leather, depth + 0.05);
    shapes.bar(p.screen(lerp3(a, b, 0.55)), p.screen(b), p.s(0.85 * def.bulk), palette.leatherDark, depth + 0.051);
  }

  // 甲裙前面垂下来的罩袍垂片。甲裙本身是一圈横带，任何朝向下都长一个样；垂片只挂在身前，
  // 于是它同时也是一个朝向指示器 —— 看得见垂片就是看得见这个人的正面。
  // 背对镜头时整块跳过，而不是压到躯干后面去 —— 垂片比甲裙长半个单位，压在后面仍然会
  // 从下摆底下露出一截红舌头。
  if (def.tabard && p.facingCamera > -0.15) {
    const front = RigSpec.torsoHalfDepth * def.bulk * 0.92;
    const top = v3(0, pose.hip.y - front, pose.hip.z + 1.0);
    const bottom = v3(0, pose.hip.y - front, pose.hip.z - RigSpec.hemDrop - 0.5);
    const wTab = p.crossSectionWidth(1.6 * def.bulk, 0.28);
    const tabDepth = depth + 0.055;
    // 比罩袍亮一档。同色的一块布贴在同色的一件袍子上，除了轮廓什么也读不出来 ——
    // 垂片要成立，它和身后那片红之间必须有一个台阶。
    slab(shapes, p.screen(top), p.screen(bottom), wTab, palette.clothShade, shade(palette.cloth, 1.18), palette.clothLight, tabDepth);
    {
      // 金边和中间的一枚菱形。出货尺寸下这几笔各占一两个像素，但它们是垂片上仅有的
      // 非阵营色，红布上一点金比再多一条布褶有用得多。
      const mid = lerp2(p.screen(top), p.screen(bottom), 0.52);
      shapes.rect(mid, wTab * 0.34, wTab * 0.34, PI_OVER_2 * 0.5, palette.trim, tabDepth + 0.01);
      shapes.rect(mid, wTab * 0.18, wTab * 0.18, PI_OVER_2 * 0.5, palette.clothShade, tabDepth + 0.012);
    }
  }

  if (def.pauldrons) {
    const r = 1.5 * def.bulk;
    for (let i = 0; i < 2; i++) {
      const socket = pose.shoulderSocket(i);
      const at = p.screen(v3(socket.x + (i === 0 ? -0.3 : 0.3), socket.y, socket.z + 0.5));

      // 碗，不是方块。原来是两个矩形，于是肩上那块金属在轮廓里是两个直角 —— 那读作
      // 垫肩。参考图上的肩甲是一枚扣在肩头的碗：上缘一条弧、下缘一道硬边、朝光那侧
      // 一点高光。同样的四个图元，得到的是一块有体积的金属。
      //
      // 扁的，宽高比接近 5:3。做成正圆的话它就是一个球，而武将两手各拎着一个球形锤头 ——
      // 四个同样大小的白圆挂在一个人身上，那不是重甲，那是雪人。肩甲得是一片盖下来的
      // 檐，不是一颗珠子。
      const rx = p.s(r * 1.3);
      const ry = p.s(r * 0.78);
      shapes.ellipse(at, rx, ry, 0, palette.steelShade, depth + 0.06);
      shapes.ellipse(v2(at.x, at.y - ry * 0.22), rx * 0.92, ry * 0.76, 0, palette.steel, depth + 0.062);
      shapes.ellipse(
        v2(at.x + rx * 0.3 * ShapeBatch.LIGHT_DIR.x, at.y + ry * 0.5 * ShapeBatch.LIGHT_DIR.y),
        rx * 0.38,
        ry * 0.3,
        0,
        palette.steelLight,
        depth + 0.064,
      );
      // 下缘那道硬边。碗和袖子之间没有它的话，两块灰会在肩关节处糊成一片。
      shapes.rect(v2(at.x, at.y + ry * 0.72), rx * 1.78, p.s(0.5), 0, palette.steelDark, depth + 0.066);
    }
  }
}

function drawArm(
  shapes: ShapeBatch,
  p: Projector,
  pose: Pose,
  palette: CharacterPalette,
  def: UnitDef,
  side: number,
): void {
  const shoulder = pose.shoulderSocket(side);
  const elbow = side === 0 ? pose.elbowL : pose.elbowR;
  const hand = side === 0 ? pose.handL : pose.handR;

  // 玩家斜向屏幕上方移动时，远侧手臂应当被躯干挡住。之前所有手臂都固定叠在躯干前，
  // 所以左上、右上两个朝向会同时露出两只手，身体看起来像透明的。
  const behindTorso = def.dualWield && backFacingFarArm(p, pose) === side;
  const depth = behindTorso
    ? Math.min(p.depth(hand) + DEPTH_ARM, p.depth(pose.chest) + DEPTH_TORSO - 0.05)
    : p.depth(hand) + DEPTH_ARM;
  const thick = RigSpec.armThickness * def.bulk;
  const plated = def.armor === 'plate';
  // 皮袖优先于甲：默认的袖子是罩袍色压暗一档，于是这个人从肩到脚是同一个色相的一团，
  // 手臂只是躯干边上颜色略深的两条。换成棕皮之后，阵营色被夹在两块棕色中间 —— 它占的
  // 面积小了，读起来反而更响，而且手臂第一次真的和身体分了家。
  const hide = def.leatherKit;
  const sleeve = hide ? palette.leather : plated ? palette.steelShade : shade(palette.cloth, 0.86);
  const sleeveDark = hide ? palette.leatherDark : plated ? palette.steelDark : palette.clothShade;

  // 袖子比外衣差一档，手臂才读作压在身体上的一条独立肢体。
  limb(shapes, p.screen(shoulder), p.screen(elbow), p.s(thick), sleeve, sleeveDark, depth);

  // 前臂也是袖子，只是亮一档 —— 袖子在肘部就断掉的话，人的两侧会各留一条裸露的皮肤，
  // 而皮肤是调色板里最亮的东西，人堆里手臂会喊得比人还响。拳头仍然是皮肤，一个拳头就是
  // 这个尺寸的人物需要露的全部血肉。
  limb(
    shapes,
    p.screen(elbow),
    p.screen(hand),
    p.s(thick * 0.92),
    hide ? shade(palette.leather, 1.14) : plated ? palette.steel : shade(palette.cloth, 0.96),
    sleeveDark,
    depth + 0.01,
  );
}

/**
 * 拳头，最后画 —— 在武器之上。手是"合在"杆上的，所以必须压在它上面。跟着手臂一起画的
 * 时候它落在 DEPTH_ARM 4 对武器的 6 之下，于是每把长杆武器都配着一条戛然而止、找不到手
 * 的胳膊。
 */
function drawHands(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, def: UnitDef): void {
  const plated = def.armor === 'plate';
  // 手套跟着袖子走，不跟着甲走：一条棕皮袖子末端接一只钢拳，那只手会读作断了。
  const dark = def.leatherKit ? palette.leatherDark : plated ? palette.steelDark : palette.skinShade;
  const mid = def.leatherKit ? shade(palette.leather, 1.2) : plated ? palette.steel : palette.skin;
  const r = RigSpec.handRadius * def.bulk * (def.leatherKit ? 1.2 : 1);
  const farArm = def.dualWield ? backFacingFarArm(p, pose) : null;
  const torsoDepth = p.depth(pose.chest) + DEPTH_TORSO;
  const handDepth = (side: number, hand: Vec3): number =>
    side === farArm ? Math.min(p.depth(hand) + DEPTH_HAND, torsoDepth - 0.04) : p.depth(hand) + DEPTH_HAND;

  // 持盾那只手是例外：它从盾牌后面握着，一直待在那儿。
  if (def.shield === 'none') fist(shapes, p.screen(pose.handL), p.s(r), mid, dark, handDepth(0, pose.handL));
  fist(shapes, p.screen(pose.handR), p.s(r), mid, dark, handDepth(1, pose.handR));
}

/** 斜背向镜头时落在躯干远侧的手臂；正背面仍保留对称轮廓。 */
function backFacingFarArm(p: Projector, pose: Pose): number | null {
  if (p.facingCamera > -0.35 || Math.abs(p.rightAxis.y) < 0.28) return null;
  return p.depth(pose.handL) < p.depth(pose.handR) ? 0 : 1;
}

function drawHead(
  shapes: ShapeBatch,
  p: Projector,
  pose: Pose,
  palette: CharacterPalette,
  def: UnitDef,
  silhouette = false,
): void {
  const depth = p.depth(pose.head) + DEPTH_HEAD;
  const r = RigSpec.headRadius;

  // 头是一叠平面板，不是一个上了明暗的球。
  //
  // 三色球会把边缘像素花在一像素宽的高光和一像素宽的明暗交界上，于是游戏尺寸下的头是一个
  // 颜色等于三者平均的柔和团块 —— 这正是人物读作模压塑料的原因。参考美术改成堆叠硬边
  // 色带：头盔、盔檐下的一道暗线、然后是脸。让头能穿过人群被读到的是这些值之间的台阶，
  // 而台阶能在小像素网格上活下来，渐变不能。
  //
  // 这些板是在屏幕空间里排的，不是身体空间。它们是面朝观众的平板 —— 一块广告牌 ——
  // 所以它们的堆叠是屏幕事实；用投影后的 3D 点去搭只会把同一列重新推一遍，还带上舍入误差。
  const headAt = p.screen(pose.head);
  const w = p.s(r * 1.5);
  const bandH = p.s(r * 0.6);

  // 脸有多少转向观众：朝镜头走是 1，正侧面是一半，背对时是 0。
  //
  // 这里原本是 max(0, facingCamera)，那是一块贴在盒子正面的平板严格正确的可见性 ——
  // 而它在整个左右半圆上都是零，于是横穿画面的队列里一张脸也没有。头不是盒子，是头：
  // 侧过来你仍然看得到一边脸颊和下颌。侧面看到半张脸是诚实的答案，也是有用的那个。
  const face = clamp(0.5 + 0.5 * p.facingCamera, 0, 1);

  // 那半边脸颊落在头骨的哪一侧。身体前轴在屏幕空间是 (cos, sin)，它的 X 分量在朝镜头走时
  // 是 0、正侧面时是 ±1 —— 正好是这块板该朝前缘滑多远。
  const faceShift = p.ground({ x: 0, y: 1, z: 0 }).x;

  // 全罩式头盔：脸那块板不再是皮肤，而是一片钢。
  const closed = def.helmet === 'visor';
  const steel =
    closed || def.helmet === 'cap' || def.helmet === 'kettle' || def.helmet === 'conical' || def.helmet === 'great';
  const felt = def.helmet === 'soft';
  const crownR = def.helmet === 'great' ? r * 1.12 : closed ? r * 1.1 : r;

  // 整条头部装备色阶一起平移，所以它仍然是一条色阶，只有相对身体的明暗在动。
  const t = def.helmetTone <= 0 ? 1 : def.helmetTone;
  const baseDark = steel ? palette.steelDark : felt ? palette.feltShade : shade(palette.hair, 0.55);
  const baseMid = steel ? palette.steel : felt ? palette.felt : palette.hair;
  const baseLit = steel ? palette.steelLight : felt ? palette.feltLight : palette.hairLight;

  const capDark = tone(baseDark, t);
  const cap = tone(baseMid, t);
  const capLight = tone(baseLit, t);

  const cw = w * (crownR / r);

  // 盔檐底下永远有一条什么东西，是什么取决于他朝哪儿看：前面是皮肤，后面是后脑勺。
  // 两者是同一块板的镜像，正侧面时两块同时在屏幕上 —— 前缘一片脸颊、后缘一片头发，
  // 这正是一颗侧过来的头。
  //
  // 没有后脑那块板的话，一个走远的人到头盔为止就结束了、底下什么头也没有，于是从背后看
  // 一个队列就是一排飘着的帽子。
  const back = 1 - face;
  if (back > 0.04) {
    shapes.rect(
      v2(headAt.x - cw * 0.24 * faceShift, headAt.y + bandH * 0.72),
      cw * (0.5 + 0.3 * back),
      bandH * (0.45 + 0.72 * back),
      0,
      steel ? capDark : palette.hair,
      depth,
    );
  }

  if (face > 0.04) {
    // 面甲把脸整个换成一片钢。它必须比盔顶暗一档：面甲是竖直的一块板，永远吃不到从上面
    // 来的主光，而且底下的目缝要有个能压得住的底色 —— 目缝是近黑的，压在亮钢上会读作
    // 一条划痕，压在暗钢上才读作一个洞。
    shapes.rect(
      v2(headAt.x + cw * 0.24 * faceShift, headAt.y + bandH * 0.72),
      cw * (0.5 + 0.3 * face),
      bandH * (0.45 + 0.72 * face),
      0,
      closed ? shade(cap, 0.8) : palette.skin,
      depth + 0.002,
    );
  }

  // 头骨：一块平板、顶上一条亮带、盔檐处一条硬的暗线。
  shapes.rect(v2(headAt.x, headAt.y - bandH * 0.18), cw, bandH * 1.65, 0, cap, depth + 0.01);
  shapes.rect(v2(headAt.x, headAt.y - bandH * 0.82), cw * 0.66, bandH * 0.36, 0, capLight, depth + 0.012);
  shapes.rect(v2(headAt.x, headAt.y + bandH * 0.5), cw, bandH * 0.34, 0, capDark, depth + 0.014);

  switch (def.helmet) {
    case 'kettle':
      // 一圈绕满的帽檐。从正上方看它是这个人身上最宽的东西，这让一排铁盔兵读作一排盘子 ——
      // 但只能比头骨宽一点点，否则头会变成一张桌子。
      shapes.rect(v2(headAt.x, headAt.y + bandH * 0.46), cw * 1.22, bandH * 0.42, 0, tone(palette.steelShade, t), depth + 0.016);
      break;

    case 'topknot':
      shapes.rect(v2(headAt.x, headAt.y - bandH * 1.15), cw * 0.42, bandH * 0.55, 0, shade(palette.hair, 0.85), depth + 0.02);
      break;

    case 'soft':
      // 眉上的一圈浅色系带。它是这个人身上最亮的东西，正是它让软帽不至于读作光头 ——
      // 但它属于圆顶的边缘，不能横过底下的脸板，否则读作一条眼罩。
      shapes.rect(v2(headAt.x, headAt.y + bandH * 0.46), cw * 1.02, bandH * 0.3, 0, palette.binding, depth + 0.02);
      break;

    case 'conical':
      // 顶上一个尖：游戏尺寸下就是头骨上方一块更亮的方块。
      shapes.rect(v2(headAt.x, headAt.y - bandH * 1.18), cw * 0.34, bandH * 0.6, 0, capLight, depth + 0.02);
      shapes.rect(v2(headAt.x, headAt.y + bandH * 0.46), cw * 1.06, bandH * 0.36, 0, tone(palette.steelShade, t), depth + 0.02);
      break;

    case 'cap':
      shapes.rect(v2(headAt.x, headAt.y + bandH * 0.46), cw * 1.06, bandH * 0.36, 0, tone(palette.steelShade, t), depth + 0.02);
      break;

    case 'visor': {
      // 面甲盔。参考图上这颗头是全身信息量最大的地方，所以它值得比别的部件多花几个图元 ——
      // 一颗只有十几像素宽的头能不能被读成"人"，全看有没有一条水平的暗缝。
      //
      // 四层，自上而下：收窄的盔顶（轮廓上的一道弧，而不是一个方角）、眉脊的硬暗线、
      // 目缝、透气孔。目缝是这里唯一不能省的东西 —— 去掉它剩下的就是一块铁疙瘩。
      shapes.rect(v2(headAt.x, headAt.y - bandH * 1.02), cw * 0.7, bandH * 0.42, 0, cap, depth + 0.016);
      shapes.rect(v2(headAt.x, headAt.y - bandH * 1.12), cw * 0.4, bandH * 0.24, 0, capLight, depth + 0.018);

      // 眉脊：盔顶和面甲之间的一道硬边台阶。它同时也是帽檐，两侧比头骨略宽一点。
      shapes.rect(v2(headAt.x, headAt.y + bandH * 0.24), cw * 1.1, bandH * 0.34, 0, capDark, depth + 0.02);

      if (face > 0.12) {
        const fx = headAt.x + cw * 0.24 * faceShift;
        // 目缝。宽度跟着脸转开而收窄，正侧面时它自然缩成一条竖线然后消失。
        shapes.rect(v2(fx, headAt.y + bandH * 0.56), cw * 0.66 * face, bandH * 0.26, 0, rgba(0, 0, 0, 210), depth + 0.03);

        // 下半张脸（护颏）比面甲上半亮一档，脸于是有了一条横向的分界，不再是一整块铁。
        shapes.rect(v2(fx, headAt.y + bandH * 1.0), cw * 0.56 * face, bandH * 0.42, 0, cap, depth + 0.028);

        // 两侧的护颊。面甲左右各压一条暗边，中间那块才成为"一张脸"而不是"盔的正面"——
        // 一个矩形里要读出五官，得先有一个比它窄的框把范围划出来。
        const cheek = cw * 0.31 * face;
        for (let i = -1; i <= 1; i += 2) {
          shapes.rect(v2(fx + cheek * i, headAt.y + bandH * 0.82), cw * 0.1 * face, bandH * 0.8, 0, capDark, depth + 0.026);
        }

        // 透气孔。三个竖点，只在放大时出现 —— 出货尺寸下它们各自不足一像素，
        // 画出来只会把护颏糊成一团。
        if (p.detailed && face > 0.5) {
          for (let i = -1; i <= 1; i++) {
            shapes.rect(v2(fx + cw * 0.15 * i, headAt.y + bandH * 1.02), cw * 0.06, bandH * 0.34, 0, capDark, depth + 0.032);
          }
        }
      }
      break;
    }

    case 'great':
      // 宽檐，外加一条顺着面门下来的鼻梁 —— 这是唯一被允许把皮肤板一切为二的头盔，
      // 因为大盔本来就干这个。
      shapes.rect(v2(headAt.x, headAt.y + bandH * 0.5), cw * 1.16, bandH * 0.44, 0, capDark, depth + 0.02);
      if (face > 0.02)
        shapes.rect(v2(headAt.x, headAt.y + bandH * 0.85), cw * 0.2, bandH * 0.9 * face, 0, palette.steelShade, depth + 0.04);
      break;
  }

  // 颈甲。这套骨架的头顶在 15.8、胸在 13.1，减掉头骨半径之后头和躯干之间只剩 0.2 个
  // 单位 —— 也就是说根本没有脖子，头是直接摆在肩膀上的，而"摆着"正是它读作一个飘在
  // 上面的方块的原因。一条比头宽、比肩窄的钢带垫进去，同一颗头就变成扣在铠甲上的。
  //
  // 它跟着 face 往下走，和下面那条遮挡线用的是同一个位置：脸转过来时下巴露得多，
  // 颈甲也要跟着退下去，否则正面看它会啃掉护颏。
  if (def.gorget && !silhouette) {
    const gy = headAt.y + bandH * (0.86 + 0.62 * face);
    shapes.rect(v2(headAt.x, gy), cw * 1.14, bandH * 0.44, 0, tone(palette.steelShade, t), depth + 0.045);
    shapes.rect(v2(headAt.x, gy + bandH * 0.16), cw * 1.14, bandH * 0.16, 0, tone(palette.steelDark, t), depth + 0.046);
  }

  // 头和身体交界处的遮挡：下巴底下一条近黑的带子。那几个暗像素对轮廓的贡献超过任何额外
  // 几何 —— 但它走在脸板的下方，绝不横过脸板，否则会吞掉唯一那块说明这人朝哪儿看的皮肤。
  if (!silhouette) {
    shapes.rect(
      v2(headAt.x, headAt.y + bandH * (0.72 + 0.62 * face)),
      cw * 0.8,
      bandH * 0.28,
      0,
      rgba(0, 0, 0, 85),
      depth + 0.05,
    );
  }

  if (def.crest) drawCrest(shapes, p, pose, palette, crownR);
  if (def.plume) drawPlume(shapes, p, pose, palette, crownR);
}

/**
 * 盔冠：伏在盔顶上、前后走向的一道刷子。
 *
 * 和马尾（drawPlume）是两件不同的东西，区别不在造型在位置：马尾长在头后面，正面看只是
 * 耳后的一点颜色；盔冠长在头顶上，任何朝向下它都在这个人轮廓的最高处。人堆里认人靠的是
 * 后者，所以它才是主力标记。
 *
 * 沿身体前轴取五个样，每个样是一根竖着的短棒 —— 一个整体的多边形在这个尺寸下会被
 * 栅格化成一块砖，而五根各自带深度的短棒转到侧面时会自然地互相错开，读作一排毛。
 */
function drawCrest(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, crownR: number): void {
  const baseZ = pose.head.z + crownR * 0.66;
  // 矮而长。第一版是 1.7 高、1.15 粗，五根叠起来在头顶得到一个和头一样大的红方块 ——
  // 那读作一顶贝雷帽。冠的比例是横着的：前后要比上下长一倍以上，眼睛才会把它读成
  // "一道顺着头走的刷子"而不是"头上顶了个东西"。
  // 八根，不是五根。样点之间必须比棒子细 —— 俯视角把身体的前后轴压掉了将近一半，五根
  // 0.9 粗、间距 0.75 的棒子在屏幕上刚好分家，冠就读作一把梳子。
  const SAMPLES = 8;
  const FRONT = 1.35;
  const BACK = -1.8;

  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    // 前低、中高、后拖一条尾巴。正弦的峰压在 0.42 上，冠的最高点于是落在额头稍后一点，
    // 和参考图一样 —— 峰在正中的话，冠会读作对称的一个拱，那是个装饰，不是一顶盔。
    const height = 0.42 + 0.78 * Math.sin(Math.PI * Math.min(1, t / 0.42 / 2 + (t > 0.42 ? (t - 0.42) * 0.62 : 0)));
    const foot = v3(pose.head.x, pose.head.y + lerp(FRONT, BACK, t), baseZ - 0.3);
    const top = v3(foot.x, foot.y, baseZ + height);
    // 每根按自己那一段的深度排序，转到侧面时靠近镜头的几根自然压在后面几根上。
    const depth = p.depth(foot) + DEPTH_PLUME;
    shapes.bar(p.screen(foot), p.screen(top), p.s(1.05), palette.plume, depth);
    // 顶上一道亮边。刷子的形状是从上缘读出来的，而上缘正好是唯一朝着光的那条边。
    shapes.bar(
      p.screen(v3(top.x, top.y, top.z - 0.3)),
      p.screen(top),
      p.s(1.05),
      shade(palette.plume, 1.32),
      depth + 0.001,
    );
    // 根部压暗，冠才读作插在盔上而不是浮在盔上。
    shapes.bar(p.screen(foot), p.screen(v3(foot.x, foot.y, foot.z + 0.35)), p.s(1.05), palette.plumeShade, depth + 0.002);
  }
}

/**
 * 马鬃盔缨。两三段向上向后收窄的segment：在游戏尺寸下这就是头盔上方的三个彩色像素，
 * 却是人堆里区分兵种最有用的一个标记。
 */
function drawPlume(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, crownR: number): void {
  const root = v3(pose.head.x, pose.head.y - 0.4, pose.head.z + crownR * 0.75);
  const a = v3(root.x, root.y - 0.7, root.z + 1.7);
  const b = v3(a.x, a.y - 1.3, a.z + 0.9);

  const plumeDepth = p.depth(pose.head) + DEPTH_PLUME;
  shapes.shadedCapsule(p.screen(root), p.screen(a), p.s(1.15), palette.plumeShade, palette.plume, shade(palette.plume, 1.35), plumeDepth);
  shapes.capsule(p.screen(a), p.screen(b), p.s(0.8), palette.plumeShade, plumeDepth + 0.01);
}

function drawQuiver(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette): void {
  // 背上高处的一个短筒，箭尾从左肩上方探出来。
  const low = v3(pose.chest.x + 1.5, pose.chest.y - 1.7, pose.chest.z - 2.4);
  const high = v3(pose.chest.x - 0.7, pose.chest.y - 2.0, pose.chest.z + 1.9);
  const depth = p.depth(lerp3(low, high, 0.5)) + DEPTH_QUIVER;

  shapes.capsule(p.screen(low), p.screen(high), p.s(1.8), palette.leatherDark, depth);

  const dir = norm3({ x: high.x - low.x, y: high.y - low.y, z: high.z - low.z });
  for (let i = -1; i <= 1; i++) {
    const tip = v3(high.x + dir.x * 1.6 + i * 0.55, high.y + dir.y * 1.6, high.z + dir.z * 1.6);
    shapes.capsule(
      p.screen(v3(high.x + i * 0.45, high.y, high.z)),
      p.screen(tip),
      p.s(0.7),
      i === 0 ? palette.steel : palette.shieldRim,
      depth + 0.01,
    );
  }
}

function drawShield(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, def: UnitDef): void {
  // 从拳头往躯干收进来，并且立在自己的下缘上，而不是手在哪儿它就吊在哪儿。这个尺寸的盾
  // 是拄在地上、人靠上去的，不是举着的；它的高度必须是它自己的，否则每走一步就会把盾从
  // 草皮上提起来再放下。
  //
  // 只盖住持盾那一侧的半个人，不是整个人：盾是挎在一边的，把人完全盖住只会剩下一个长方形
  // 加一个头。这样也把持盾的手臂放到了它自己的盾后面 —— 那本来就是那条手臂该在的地方。
  const footZ = SHIELD_FOOT_Z;
  // 放大只往上长。盾是拄在地上的（见 SHIELD_FOOT_Z），围着盾心等比放大会把下沿抬离草皮，
  // 于是一面更大的盾反而读作"被举起来了"—— 正好丢掉它最要紧的那件事。
  const topZ = footZ + (SHIELD_TOP_Z - footZ) * def.shieldScale;
  const halfHeight = (topZ - footZ) * 0.5;
  // 0.72 而不是 0.55：盾是挎在一边的。偏 0.55 时盾心几乎压在胸骨上，正面看整个人
  // 就是一面盾加一个头，肩甲、腰带、垂片全被吃掉。
  const carried = lerp3(pose.chest, pose.handL, 0.72);
  const center = v3(carried.x, carried.y + 1.6, footZ + halfHeight);
  const screen = p.screen(center);

  // 盾在人的近侧时画在人前面，人把它转开时画在人后面。固定偏移会让它在任何角度都在前面，
  // 于是走远的人把盾背在了背上。
  const nearSide = p.depth(center) >= p.depth(pose.chest);
  const depth = p.depth(center) + (nearSide ? DEPTH_SHIELD : -DEPTH_SHIELD);

  if (def.shield === 'round') {
    // 一个立在"右/上"平面内的圆盘；正确投影那个平面，它才会随着人转向而变成一条边。
    const { sx, sy, rot } = projectUprightDisc(p);
    const radius = 4.4 * def.shieldScale;
    const rx = p.s(radius * sx);
    const ry = Math.max(p.s(radius * sy), p.s(0.5));

    // 圆盾不是一张椭圆纸片，而是一块沿身体前轴有厚度的圆盘。近面随人物朝向切换，背层与
    // 中间厚边留在它后方；正面时露出一圈暗月牙，侧面时则展开成清楚的盾沿。
    const halfThickness = 0.65;
    const nearSign = p.facingCamera >= 0 ? 1 : -1;
    const farCenter = v3(center.x, center.y - nearSign * halfThickness, center.z);
    const nearCenter = v3(center.x, center.y + nearSign * halfThickness, center.z);
    const farScreen = p.screen(farCenter);
    const faceScreen = p.screen(nearCenter);
    const middleScreen = p.screen(center);

    shapes.ellipse(farScreen, rx, ry, rot, shade(palette.shieldRim, 0.48), depth);
    shapes.ellipse(middleScreen, rx, ry, rot, shade(palette.shieldRim, 0.7), depth + 0.004);
    shapes.ellipse(faceScreen, rx, ry, rot, palette.shieldRim, depth + 0.008);

    // 接近正侧面时没有地方放盾面和盾心 —— 层层嵌套的细条只会读作噪点，所以那时盾就是
    // 一圈素边。
    if (sy > 0.4) {
      shapes.ellipse(faceScreen, p.s((radius - 0.75) * sx), p.s((radius - 0.75) * sy), rot, palette.shieldFace, depth + 0.01);

      // 盾心：一枚鼓出来的钢碗，占盾面直径的三分之一。原来是个半径 1 的小圆点，在盾面
      // 中央读作一处污渍；参考图上这块金属大得多，而它是整面盾上唯一的高光 —— 圆盾在
      // 人堆里能被认出来靠的就是"红面上一点亮"这个组合。
      const boss = radius * 0.36;
      shapes.ellipse(faceScreen, p.s(boss * sx), p.s(boss * sy), rot, palette.steelShade, depth + 0.02);
      shapes.ellipse(
        v2(faceScreen.x + p.s(boss * sx * 0.2) * ShapeBatch.LIGHT_DIR.x, faceScreen.y + p.s(boss * sy * 0.24) * ShapeBatch.LIGHT_DIR.y),
        p.s(boss * 0.66 * sx),
        p.s(boss * 0.66 * sy),
        rot,
        palette.steel,
        depth + 0.022,
      );
      if (p.detailed) {
        // 盾心上的高光走矩形：它躺在一枚已经是圆的盾心里面，边缘轮廓由盾心负责，
        // 这一块只负责"这儿反光"。圆盘要二十个顶点，矩形四个。
        shapes.rect(
          v2(faceScreen.x + p.s(boss * sx * 0.36) * ShapeBatch.LIGHT_DIR.x, faceScreen.y + p.s(boss * sy * 0.42) * ShapeBatch.LIGHT_DIR.y),
          p.s(boss * 0.6 * sx),
          p.s(boss * 0.6 * sy),
          rot,
          palette.steelLight,
          depth + 0.024,
        );
        // 盾面上的四枚饰钉。它们在出货尺寸下各占一个像素，但四个点绕着盾心排开时，
        // 眼睛读到的是"这面盾有花纹"，而不是四个点。
        //
        // 用矩形：这个尺寸下一枚钉子就是四个像素，方圆完全一样，而一个圆盘要二十个顶点。
        // 四枚圆钉是每个持盾兵八十个顶点，场上一百个持盾兵就是八千个 —— 为了看不出来的
        // 圆角花掉的。
        for (let i = 0; i < 4; i++) {
          const a = rot + (i * Math.PI) / 2 + Math.PI / 4;
          const rr = radius * 0.66;
          shapes.rect(
            v2(faceScreen.x + Math.cos(a) * p.s(rr * sx), faceScreen.y + Math.sin(a) * p.s(rr * sy)),
            p.s(1.1 * sx),
            p.s(1.1 * sy),
            rot,
            palette.trim,
            depth + 0.015,
          );
        }
      }
    }
    return;
  }

  // 塔盾。它的上轴在屏幕上永远是竖直的，所以画成一个竖立的矩形，宽度随着人转向侧面而收窄，
  // 高度像所有立着的东西一样被相机俯角压缩 —— 否则一面按人身高做的盾在屏幕上会比人还高。
  const halfW = 3.4 * def.shieldScale;
  const w = Math.max(p.s(2 * halfW * p.sideOn), p.s(1.1));
  const h = p.s(2 * halfHeight * Projection.heightSquash);

  // 精英塔盾同样是一块有厚度的实体。沿身体前轴把背面、中层、正面错开：正面朝镜头时露出
  // 上下厚边，转到侧面时三层横向展开，原本的一条纸片边就变成完整盾沿。
  const halfThickness = 0.9;
  const nearSign = p.facingCamera >= 0 ? 1 : -1;
  const farScreen = p.screen(v3(center.x, center.y - nearSign * halfThickness, center.z));
  const faceScreen = p.screen(v3(center.x, center.y + nearSign * halfThickness, center.z));
  shapes.rect(farScreen, w, h, 0, shade(palette.shieldRim, 0.46), depth);
  shapes.rect(screen, w, h, 0, shade(palette.shieldRim, 0.68), depth + 0.004);
  shapes.rect(faceScreen, w, h, 0, palette.shieldRim, depth + 0.008);
  if (w > p.s(2.2)) {
    shapes.rect(faceScreen, w - p.s(1.2), h - p.s(1.2), 0, palette.shieldFace, depth + 0.01);
    shapes.disc(faceScreen, p.s(1.0), palette.steel, depth + 0.02);
    if (p.detailed) shapes.rect(faceScreen, p.s(0.6), h - p.s(1.8), 0, shade(palette.shieldFace, 0.8), depth + 0.015);
  }
}

function drawWeapon(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, def: UnitDef): void {
  switch (def.weapon) {
    case 'none':
      return;
    case 'bow':
      drawBow(shapes, p, pose, palette);
      return;
    case 'sword':
      drawSword(shapes, p, pose, palette, def);
      return;
    case 'hammer': {
      // 斜向屏幕上方时，远侧锤仍然完整绘制，但整把压到躯干后层：穿过身体的那段被遮住，
      // 伸出轮廓的锤头继续可见。直接跳过整把锤会让双持在这两个朝向凭空变成单持。
      const farArm = def.dualWield ? backFacingFarArm(p, pose) : null;
      const behindTorso = p.depth(pose.chest) + DEPTH_TORSO - 0.08;
      if (def.dualWield)
        drawHammer(shapes, p, pose.offhandGrip, pose.offhandDir, palette, def, farArm === 0 ? behindTorso : undefined);
      drawHammer(shapes, p, pose.weaponGrip, pose.weaponDir, palette, def, farArm === 1 ? behindTorso : undefined);
      return;
    }
    default:
      drawPolearm(shapes, p, pose, palette, def);
      return;
  }
}

/**
 * 圆锤：一根短柄，顶上一个球，球下面一道箍。
 *
 * 锤头是这套图形里少数几个真该用三色球的地方。别处都刻意避开球体（八像素宽的渐变会被
 * 眼睛平均成一团糊），但锤头本来就是个实心金属球，而且在 grain 3 下它有十来个像素宽 ——
 * 足够让明暗真的读成体积。它也是这个兵种的识别特征，值得多花两个图元。
 */
function drawHammer(
  shapes: ShapeBatch,
  p: Projector,
  grip: Vec3,
  dir: Vec3,
  palette: CharacterPalette,
  def: UnitDef,
  depthCeiling?: number,
): void {
  const naturalDepth = p.depth(grip) + DEPTH_WEAPON;
  const depth = depthCeiling === undefined ? naturalDepth : Math.min(naturalDepth, depthCeiling);
  const length = hammerLength(def);
  const r = HAMMER_HEAD_RADIUS * def.bulk;

  const butt = addScaled(grip, dir, -1.5);
  const neck = addScaled(grip, dir, length - r * 0.9);
  const head = addScaled(grip, dir, length);

  // 柄。缠了皮的木柄，和钢头之间靠一道硬色阶分开。
  shapes.capsule(p.screen(butt), p.screen(neck), p.s(1.15 * def.bulk), palette.leather, depth);

  // 箍：柄和头交界处的一圈深色。少了它，球会显得像插在棍子上，而不是箍在棍子上 ——
  // 但它必须明显小于锤头，否则两个相交的圆读作一把扳手的开口。
  shapes.disc(p.screen(neck), p.s(1.0 * def.bulk), palette.steelDark, depth + 0.01);

  shapes.sphere(
    p.screen(head),
    p.s(r),
    palette.steelShade,
    palette.steel,
    palette.steelLight,
    depth + 0.02,
  );
}

/**
 * 剑：柄、尾锤、护手，加一片会收尖的剑身。
 *
 * 原来剑身是一根等粗的胶囊，两头一样宽 —— 那是根钢棍。剑之所以读作剑，靠的是从护手到
 * 剑尖那个收窄；在这个尺寸下不需要真的做锥形，掰成两段、后段窄一档就够了，一个硬边台阶
 * 比一条渐变的锥线在像素网格上活得久。
 */
function drawSword(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, def: UnitDef): void {
  const hand = pose.weaponGrip;
  const dir = pose.weaponDir;
  const depth = p.depth(hand) + DEPTH_WEAPON;

  const length = bladeLength(def);
  const pommel = addScaled(hand, dir, -1.4);
  const guard = addScaled(hand, dir, 0.9);
  const tip = addScaled(hand, dir, length);

  // 好装备配金件。杂兵的刀留在钢色上 —— 满场人手一把金护手的话，金就不再是"这人不一样"
  // 的信号了。用肩甲当门槛：有肩甲的都是把自己武装到位的人，而杂兵一个都没有。
  const fine = def.pauldrons || def.armor === 'plate' || def.armor === 'lamellar';
  const fitting = fine ? palette.trim : palette.steelShade;

  shapes.capsule(p.screen(pommel), p.screen(guard), p.s(1.1), palette.leather, depth);

  // 普通敌兵恢复 2364867 之前的剑：一体式剑身、短护手、没有尾锤。精制的分段剑只留给
  // 有肩甲或重甲的英雄单位，避免所有杂兵手里都拿着同一把华丽武器。
  if (!fine) {
    shapes.shadedCapsule(p.screen(guard), p.screen(tip), p.s(1.5), palette.steelShade, palette.steel, palette.steelLight, depth + 0.01);
    const side = sideAxis(dir);
    shapes.bar(p.screen(addScaled(guard, side, -1.5)), p.screen(addScaled(guard, side, 1.5)), p.s(1.0), palette.steelShade, depth + 0.02);
    return;
  }

  const waist = addScaled(guard, dir, (length - 0.9) * 0.6);

  // 剑身根部走方头板，只有剑尖那段用圆头胶囊。
  //
  // shadedCapsule 是七个图元，其中四个是圆头的关节盘 —— 出货那一档每个要 32 个顶点，
  // 一根就是一百四十个。而根部这一段两头都是内接缝：一头压在护手底下，一头压在剑尖那段
  // 底下，圆头一个像素都露不出来。场上一多半的人握着剑，这一处的选择比它看起来重要得多。
  slab(
    shapes,
    p.screen(guard),
    p.screen(waist),
    p.s(1.75),
    palette.steelShade,
    palette.steel,
    palette.steelLight,
    depth + 0.01,
  );
  shapes.shadedCapsule(p.screen(waist), p.screen(tip), p.s(1.2), palette.steelShade, palette.steel, palette.steelLight, depth + 0.012);

  const side = sideAxis(dir);
  shapes.bar(p.screen(addScaled(guard, side, -1.7)), p.screen(addScaled(guard, side, 1.7)), p.s(1.1), fitting, depth + 0.02);
  // 尾锤。柄尾要是就这么断掉，剑会读作从拳头里长出来的。
  //
  // 方的，不是圆的。出货那一档它只有七个像素宽，方圆读起来是一回事 —— 但一个圆盘要按
  // ellipseSegments 展成 24 个顶点，一个矩形只要 4 个，而场上一多半的人手里都握着一把剑。
  const pommelAt = p.screen(pommel);
  shapes.rect(pommelAt, p.s(1.5), p.s(1.5), 0, fitting, depth + 0.021);
}

/** 枪和戟：同一根杆，不同的头。 */
function drawPolearm(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, def: UnitDef): void {
  const grip = pose.weaponGrip;
  const dir = pose.weaponDir;
  const depth = p.depth(grip) + DEPTH_WEAPON;

  const length = shaftLength(def);
  const butt = addScaled(grip, dir, -length * BUTT_FRACTION);
  const tip = addScaled(grip, dir, length * (1 - BUTT_FRACTION));

  shapes.bar(p.screen(butt), p.screen(tip), p.s(1.0), palette.wood, depth);

  if (def.weapon === 'halberd') {
    // 一侧是斧刃，另一侧是越过杆继续伸出去的尖。
    const neck = addScaled(tip, dir, -3.2);
    const side = sideAxis(dir);

    // 用一块平的板而不是一团东西：一个横架在杆上的矩形，加一根后刺。
    const a = p.screen(addScaled(neck, side, 0.4));
    const b = p.screen(addScaled(addScaled(neck, side, 2.8), dir, 0.9));
    shapes.bar(a, b, p.s(2.9), palette.steel, depth + 0.01);
    shapes.bar(
      p.screen(addScaled(neck, side, -0.4)),
      p.screen(addScaled(addScaled(neck, side, -1.7), dir, 0.4)),
      p.s(1.0),
      palette.steelShade,
      depth + 0.01,
    );
    shapes.capsule(p.screen(addScaled(tip, dir, -1.8)), p.screen(tip), p.s(1.1), shade(palette.steel, 1.08), depth + 0.02);
  } else {
    const neck = addScaled(tip, dir, -2.2);
    shapes.shadedCapsule(p.screen(neck), p.screen(tip), p.s(1.35), palette.steelShade, palette.steel, palette.steelLight, depth + 0.01);
  }

  if (def.tassel) {
    // 枪头下的布穗 —— 一块在 1 倍缩放下也活得下来的阵营色。
    const t = addScaled(tip, dir, -3.4);
    const end = v3(t.x - dir.x * 1.4, t.y - dir.y * 1.4, t.z - dir.z * 1.4 - 0.8);
    shapes.capsule(p.screen(t), p.screen(end), p.s(1.5), palette.plume, depth + 0.02);
  }
}

/**
 * 弓是唯一真正是曲线的部件：弓臂沿着"弓臂轴与瞄准方向张成的平面"内的一条抛物线取样，
 * 弦则是从两个弓梢到拉弦手所在位置的两段直线。
 */
function drawBow(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette): void {
  const grip = pose.weaponGrip;
  const up = pose.weaponDir;
  const depth = p.depth(grip) + DEPTH_WEAPON;

  // 弓臂朝背离射手的方向弯，方向取"正前"去掉沿弓臂轴分量之后剩下的那部分。
  const fwd = v3(0, 1, 0);
  let bend = { x: fwd.x - up.x * up.y, y: fwd.y - up.y * up.y, z: fwd.z - up.z * up.y };
  bend = lenSq3(bend) > 1e-5 ? norm3(bend) : v3(0, 1, 0);

  const limbLen = 5.4;
  const curve = 2.8;
  const segments = 6;

  const point = (t: number): Vec3 =>
    v3(
      grip.x + up.x * (t * limbLen) + bend.x * (curve * (1 - t * t)),
      grip.y + up.y * (t * limbLen) + bend.y * (curve * (1 - t * t)),
      grip.z + up.z * (t * limbLen) + bend.z * (curve * (1 - t * t)),
    );

  let prev = point(-1);
  for (let i = 1; i <= segments; i++) {
    const t = -1 + (2 * i) / segments;
    const next = point(t);
    shapes.capsule(p.screen(prev), p.screen(next), p.s(i === segments / 2 ? 1.15 : 0.8), palette.wood, depth);
    prev = next;
  }

  // 弦：从两个弓梢连到弦扣，弦扣由拉弦手往后带。
  const pull = 0.2 + pose.bowDraw * 2.6;
  const nock = addScaled(grip, bend, -pull);
  shapes.bar(p.screen(point(1)), p.screen(nock), p.s(0.45), palette.steelShade, depth + 0.01);
  shapes.bar(p.screen(point(-1)), p.screen(nock), p.s(0.45), palette.steelShade, depth + 0.01);

  if (pose.showArrow) {
    const head = addScaled(nock, bend, 7.5);
    shapes.bar(p.screen(nock), p.screen(head), p.s(0.7), palette.wood, depth + 0.02);
    shapes.capsule(p.screen(addScaled(head, bend, -1.0)), p.screen(head), p.s(0.9), palette.steel, depth + 0.03);
  }
}

/** 骨架叠加层：骨、关节、IK 目标点。调姿势的时候开着它。 */
export function drawSkeleton(shapes: ShapeBatch, pose: Pose, p: Projector): void {
  const boneColor = rgba(255, 255, 255, 210);
  const jointColor = rgba(255, 214, 64, 255);
  const targetColor = rgba(255, 90, 90, 255);
  const debug = p.baseDepth + DEPTH_DEBUG;
  const w = Math.max(1, p.scale * 0.35);

  const bone = (a: Vec3, b: Vec3): void => shapes.bar(p.screen(a), p.screen(b), w, boneColor, debug);

  bone(pose.hipSocket(0), pose.kneeL);
  bone(pose.kneeL, pose.footL);
  bone(pose.hipSocket(1), pose.kneeR);
  bone(pose.kneeR, pose.footR);
  bone(pose.hipSocket(0), pose.hipSocket(1));
  bone(pose.hip, pose.chest);
  bone(pose.shoulderSocket(0), pose.shoulderSocket(1));
  bone(pose.shoulderSocket(0), pose.elbowL);
  bone(pose.elbowL, pose.handL);
  bone(pose.shoulderSocket(1), pose.elbowR);
  bone(pose.elbowR, pose.handR);
  bone(pose.chest, pose.head);

  for (const j of [pose.kneeL, pose.kneeR, pose.elbowL, pose.elbowR])
    shapes.disc(p.screen(j), p.s(0.5) + 0.5, jointColor, debug + 1);
  for (const t of [pose.footL, pose.footR, pose.handL, pose.handR])
    shapes.disc(p.screen(t), p.s(0.6) + 0.5, targetColor, debug + 1);

  shapes.bar(p.screen(V3_ZERO), p.screen(v3(0, 7, 0)), w, rgba(120, 220, 255, 200), debug);
}

// ---------------------------------------------------------------- 小工具

const addScaled = (a: Vec3, dir: Vec3, k: number): Vec3 => v3(a.x + dir.x * k, a.y + dir.y * k, a.z + dir.z * k);

/** 垂直于武器方向、躺在地面上的那个轴。护手、斧刃这类横向部件用它。 */
function sideAxis(dir: Vec3): Vec3 {
  const side = cross3(dir, V3_UNIT_Z);
  return lenSq3(side) < 1e-5 ? V3_UNIT_X : norm3(side);
}
