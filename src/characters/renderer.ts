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

/**
 * 每世界单位低于这么多像素时，人就画成一个色块而不是一个身体。
 *
 * 一个人是十九个单位高，所以 0.45 时他只有八像素，而构成他的五十多个图元大多落在其中的
 * 三个像素上：手、箭袋、盔缨、明暗带全都不足一像素，却仍然各花一个 quad。色块只有四个
 * quad，在那个尺寸下和完整版无法区分 —— 因为那个距离上被读取的是色块的颜色和密度，
 * 不是人。
 */
export const tokenScale = { value: 0.45 };

export interface DrawOptions {
  /** 刚挨打的两帧里盖在躯干上的白光，0..1。 */
  hurt?: number;
  /** 离地高度，世界单位。击飞时影子按它缩小变淡。 */
  lift?: number;
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

  if (p.scale < tokenScale.value) {
    drawToken(shapes, pose, p, palette, def, hurt);
    return;
  }

  if (!silhouette) drawShadow(shapes, p, lift);

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
  const boot = shade(legBase, far ? 0.5 : 0.58);

  const greaves = def.armor === 'plate';
  const thick = RigSpec.legThickness * def.bulk;

  limb(shapes, p.screen(hip), p.screen(knee), p.s(thick), trouser, trouserDark, depth);
  limb(
    shapes,
    p.screen(knee),
    p.screen(foot),
    p.s(thick * 0.9),
    greaves ? shade(palette.steelShade, dim) : trouser,
    greaves ? shade(palette.steelDark, dim) : trouserDark,
    depth + 0.01,
  );

  // 一个圆头的鞋尖，完全没有方向性。
  //
  // 原本这里是从脚踝到脚尖的一个胶囊，按脚的偏航角转向。那个偏航是身体空间的角度，横着
  // 走时它的横向分量被地面压扁、朝镜头走时完全不压 —— 于是同一个外撇侧看什么都不是、
  // 正看却几乎翻倍，脚尖看起来内扣正是出在这儿。这个尺寸下整只靴子不到两个单位宽，方向
  // 本来就读不出来；而一个圆点不可能内八。
  shapes.disc(p.screen(foot), p.s(thick * RigSpec.footThickness * 0.5), boot, depth + 0.02);
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
  slab(shapes, hem, seat, wPelvis * 0.94, shade(bodyDark, 0.82), shade(body, 0.84), shade(bodyLit, 0.84), depth);

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

  if (def.pauldrons) {
    const r = 1.5 * def.bulk;
    for (let i = 0; i < 2; i++) {
      const socket = pose.shoulderSocket(i);
      const at = p.screen(v3(socket.x + (i === 0 ? -0.3 : 0.3), socket.y, socket.z + 0.5));
      shapes.rect(at, p.s(r * 2.1), p.s(r * 1.5), 0, palette.steel, depth + 0.06);
      shapes.rect(v2(at.x, at.y + p.s(r * 0.5)), p.s(r * 2.1), p.s(r * 0.5), 0, palette.steelDark, depth + 0.062);
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

  const depth = p.depth(hand) + DEPTH_ARM;
  const thick = RigSpec.armThickness * def.bulk;
  const plated = def.armor === 'plate';

  // 袖子比外衣差一档，手臂才读作压在身体上的一条独立肢体。
  limb(
    shapes,
    p.screen(shoulder),
    p.screen(elbow),
    p.s(thick),
    plated ? palette.steelShade : shade(palette.cloth, 0.86),
    plated ? palette.steelDark : palette.clothShade,
    depth,
  );

  // 前臂也是袖子，只是亮一档 —— 袖子在肘部就断掉的话，人的两侧会各留一条裸露的皮肤，
  // 而皮肤是调色板里最亮的东西，人堆里手臂会喊得比人还响。拳头仍然是皮肤，一个拳头就是
  // 这个尺寸的人物需要露的全部血肉。
  limb(
    shapes,
    p.screen(elbow),
    p.screen(hand),
    p.s(thick * 0.92),
    plated ? palette.steel : shade(palette.cloth, 0.96),
    plated ? palette.steelDark : palette.clothShade,
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
  const dark = plated ? palette.steelDark : palette.skinShade;
  const mid = plated ? palette.steel : palette.skin;
  const r = RigSpec.handRadius * def.bulk;

  // 持盾那只手是例外：它从盾牌后面握着，一直待在那儿。
  if (def.shield === 'none') fist(shapes, p.screen(pose.handL), p.s(r), mid, dark, p.depth(pose.handL) + DEPTH_HAND);
  fist(shapes, p.screen(pose.handR), p.s(r), mid, dark, p.depth(pose.handR) + DEPTH_HAND);
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

  const steel = def.helmet === 'cap' || def.helmet === 'kettle' || def.helmet === 'conical' || def.helmet === 'great';
  const felt = def.helmet === 'soft';
  const crownR = def.helmet === 'great' ? r * 1.12 : r;

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
    shapes.rect(
      v2(headAt.x + cw * 0.24 * faceShift, headAt.y + bandH * 0.72),
      cw * (0.5 + 0.3 * face),
      bandH * (0.45 + 0.72 * face),
      0,
      palette.skin,
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

    case 'great':
      // 宽檐，外加一条顺着面门下来的鼻梁 —— 这是唯一被允许把皮肤板一切为二的头盔，
      // 因为大盔本来就干这个。
      shapes.rect(v2(headAt.x, headAt.y + bandH * 0.5), cw * 1.16, bandH * 0.44, 0, capDark, depth + 0.02);
      if (face > 0.02)
        shapes.rect(v2(headAt.x, headAt.y + bandH * 0.85), cw * 0.2, bandH * 0.9 * face, 0, palette.steelShade, depth + 0.04);
      break;
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

  if (def.plume) drawPlume(shapes, p, pose, palette, crownR);
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
  const topZ = SHIELD_TOP_Z;
  const halfHeight = (topZ - footZ) * 0.5;
  const carried = lerp3(pose.chest, pose.handL, 0.55);
  const center = v3(carried.x, carried.y + 1.6, footZ + halfHeight);
  const screen = p.screen(center);

  // 盾在人的近侧时画在人前面，人把它转开时画在人后面。固定偏移会让它在任何角度都在前面，
  // 于是走远的人把盾背在了背上。
  const nearSide = p.depth(center) >= p.depth(pose.chest);
  const depth = p.depth(center) + (nearSide ? DEPTH_SHIELD : -DEPTH_SHIELD);

  if (def.shield === 'round') {
    // 一个立在"右/上"平面内的圆盘；正确投影那个平面，它才会随着人转向而变成一条边。
    const { sx, sy, rot } = projectUprightDisc(p);
    const radius = 4.4;
    shapes.ellipse(screen, p.s(radius * sx), Math.max(p.s(radius * sy), p.s(0.5)), rot, palette.shieldRim, depth);

    // 接近正侧面时没有地方放盾面和盾心 —— 层层嵌套的细条只会读作噪点，所以那时盾就是
    // 一圈素边。
    if (sy > 0.4) {
      shapes.ellipse(screen, p.s((radius - 0.7) * sx), p.s((radius - 0.7) * sy), rot, palette.shieldFace, depth + 0.01);
      shapes.ellipse(screen, p.s(1.0 * sx), p.s(1.0 * sy), rot, palette.steel, depth + 0.02);
    }
    return;
  }

  // 塔盾。它的上轴在屏幕上永远是竖直的，所以画成一个竖立的矩形，宽度随着人转向侧面而收窄，
  // 高度像所有立着的东西一样被相机俯角压缩 —— 否则一面按人身高做的盾在屏幕上会比人还高。
  const halfW = 3.4;
  const w = Math.max(p.s(2 * halfW * p.sideOn), p.s(1.1));
  const h = p.s(2 * halfHeight * Projection.heightSquash);

  shapes.rect(screen, w, h, 0, palette.shieldRim, depth);
  if (w > p.s(2.2)) {
    shapes.rect(screen, w - p.s(1.2), h - p.s(1.2), 0, palette.shieldFace, depth + 0.01);
    shapes.disc(screen, p.s(1.0), palette.steel, depth + 0.02);
    if (p.detailed) shapes.rect(screen, p.s(0.6), h - p.s(1.8), 0, shade(palette.shieldFace, 0.8), depth + 0.015);
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
    case 'hammer':
      // 副手那把先画。两把锤各自按自己那只手的深度排序，所以近侧的一把自然压在身体前面、
      // 远侧的一把落到身体后面 —— 这是双持能读出"一前一后"而不是"贴在胸口"的全部原因。
      if (def.dualWield) drawHammer(shapes, p, pose.offhandGrip, pose.offhandDir, palette, def);
      drawHammer(shapes, p, pose.weaponGrip, pose.weaponDir, palette, def);
      return;
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
): void {
  const depth = p.depth(grip) + DEPTH_WEAPON;
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

function drawSword(shapes: ShapeBatch, p: Projector, pose: Pose, palette: CharacterPalette, def: UnitDef): void {
  const hand = pose.weaponGrip;
  const dir = pose.weaponDir;
  const depth = p.depth(hand) + DEPTH_WEAPON;

  const pommel = addScaled(hand, dir, -1.4);
  const guard = addScaled(hand, dir, 0.9);
  const tip = addScaled(hand, dir, bladeLength(def));

  shapes.capsule(p.screen(pommel), p.screen(guard), p.s(1.1), palette.leather, depth);
  shapes.shadedCapsule(p.screen(guard), p.screen(tip), p.s(1.5), palette.steelShade, palette.steel, palette.steelLight, depth + 0.01);

  const side = sideAxis(dir);
  shapes.bar(p.screen(addScaled(guard, side, -1.5)), p.screen(addScaled(guard, side, 1.5)), p.s(1.0), palette.steelShade, depth + 0.02);
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
