import { type Vec3, V3_ZERO, lerp2, v2, v3 } from '../core/math';
import { lerpColor, rgba, shade } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import { ShapeBatch } from '../render/shapeBatch';
import { HorseSpec, type HorsePose } from './horse';
import { tokenScale } from './lod';
import type { CharacterPalette } from './palette';
import type { UnitDef } from './unitDef';

/**
 * 画坐骑。移植自 overlord 的 HorseRenderer。
 *
 * 这里的深度偏移**刻意都很小**，让几何自己决定顺序：靠近镜头那一对腿必须落在躯干之前、
 * 另一对落在躯干之后，而哪一对是哪一对会随着马转身来回换。写死一个大偏移就锁死了其中一种。
 */

const DEPTH_SHADOW = -22;
const DEPTH_LEG = 0;
const DEPTH_TAIL = 0.4;
const DEPTH_BARREL = 0.6;
// 故意小。骑手的腿比马衣的裙摆往外挂出一个单位，所以近侧那条腿在几何上本来就在前面 ——
// 但只领先半个深度单位，马衣上给 0.9 的偏置就足以把整条腿吞掉，画出来是个没有腿的骑手。
const DEPTH_BARDING = 0.2;
const DEPTH_SADDLE = 1.1;
const DEPTH_NECK = 1.3;
const DEPTH_HEAD = 1.7;

export function drawHorse(
  shapes: ShapeBatch,
  pose: HorsePose,
  p: Projector,
  palette: CharacterPalette,
  def: UnitDef,
): void {
  if (p.scale < tokenScale.value) {
    drawToken(shapes, p, palette);
    return;
  }

  drawShadow(shapes, p);

  for (let i = 0; i < 4; i++) drawLeg(shapes, pose, p, palette, i);

  drawTail(shapes, pose, p, palette);
  drawBarrel(shapes, pose, p, palette, def);
  drawNeckAndHead(shapes, pose, p, palette, def);
  drawSaddle(shapes, pose, p, palette, def);
}

function drawShadow(shapes: ShapeBatch, p: Projector): void {
  const r = HorseSpec.shadowRadius * 0.62;
  shapes.ellipse(
    p.screen(v3(0, -0.4, 0)),
    p.s(r),
    p.s(r * Projection.groundSquash * 1.5),
    0,
    rgba(0, 0, 0, 70),
    p.baseDepth + DEPTH_SHADOW,
  );
}

/** 面朝镜头那一侧的符号，用来把远侧的腿压暗一档。 */
function sideSign(p: Projector): number {
  return p.rightAxis.y >= 0 ? 1 : -1;
}

function drawLeg(shapes: ShapeBatch, pose: HorsePose, p: Projector, palette: CharacterPalette, leg: number): void {
  const r = HorseSpec.legRoot(leg);
  const root = v3(r.x + pose.body.x, r.y + pose.body.y, r.z + pose.body.z);
  const knee = pose.knee[leg];
  const hoof = pose.hoof[leg];

  const depth = p.depth(v3((root.x + hoof.x) * 0.5, (root.y + hoof.y) * 0.5, (root.z + hoof.z) * 0.5)) + DEPTH_LEG;
  const far = root.x * sideSign(p) > 0;
  const coat = far ? shade(palette.horseShade, 0.85) : palette.horseCoat;
  const dark = shade(palette.horseShade, far ? 0.85 : 1);
  const light = shade(palette.horseLight, far ? 0.85 : 1);

  // 马腿不是一根杆。上面是肩肌或者股肌，下面是前臂 / 胫，再往下是只有三分之一粗的管骨、
  // 一个球节和蹄子。整条画成一个粗细，就是"玩具感"的另一半来源。
  const t = HorseSpec.legThickness;
  const mid = lerpV(root, knee, 0.55);

  shapes.shadedCapsule(p.screen(root), p.screen(mid), p.s(t * 1.32), dark, coat, light, depth);
  shapes.shadedCapsule(p.screen(mid), p.screen(knee), p.s(t * 0.92), dark, coat, light, depth + 0.01);

  const fetlock = lerpV(knee, hoof, 0.84);
  shapes.capsule(p.screen(knee), p.screen(fetlock), p.s(t * 0.52), shade(coat, 0.72), depth + 0.02);
  shapes.disc(p.screen(fetlock), p.s(t * 0.4), shade(coat, 0.66), depth + 0.03);
  shapes.capsule(p.screen(fetlock), p.screen(hoof), p.s(t * 0.46), shade(coat, 0.6), depth + 0.03);
  shapes.disc(p.screen(hoof), p.s(t * 0.5), palette.leatherDark, depth + 0.04);
}

function drawTail(shapes: ShapeBatch, pose: HorsePose, p: Projector, palette: CharacterPalette): void {
  // 每一节自己算深度：马一转身，尾巴就会从臀后转到臀前，一个共用的深度键说不了这件事。
  // 它也有自己的色阶 —— 一条纯黑的尾巴贴在同样暗的臀部阴影面上等于没画。
  const dark = shade(palette.horseMane, 0.6);
  const lit = shade(palette.horseMane, 2.1);

  for (let i = 1; i < pose.tail.length; i++) {
    const t = 1 - (i - 1) / (pose.tail.length - 1);
    const a = pose.tail[i - 1];
    const b = pose.tail[i];
    const depth = p.depth(v3((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5)) + DEPTH_TAIL;
    shapes.shadedCapsule(p.screen(a), p.screen(b), p.s(1.4 + 2.2 * t), dark, palette.horseMane, lit, depth);
  }
}

function drawBarrel(
  shapes: ShapeBatch,
  pose: HorsePose,
  p: Projector,
  palette: CharacterPalette,
  def: UnitDef,
): void {
  const chest = p.screen(pose.chest);
  const croup = p.screen(pose.croup);
  const axis = v2(chest.x - croup.x, chest.y - croup.y);
  const depth =
    p.depth(v3((pose.chest.x + pose.croup.x) * 0.5, (pose.chest.y + pose.croup.y) * 0.5,
      (pose.chest.z + pose.croup.z) * 0.5)) + DEPTH_BARREL;

  const thickness = p.crossThickness(HorseSpec.barrelHalfWidth, HorseSpec.barrelHalfHeight, axis);

  // 三块肉，不是一根管子：肩后那道深胸围、收进去的腹胁、压在后腿上的圆臀。这就是马和木头
  // 拉车玩具的区别 —— 整体比例本来就已经接近了，但一根粗细均匀的圆柱没有胸围线、没有腰
  // 收、没有臀，轮廓上没有任何东西说明哪一头是头。
  const tGirth = p.crossThickness(
    HorseSpec.barrelHalfWidth * HorseSpec.girthScaleW,
    HorseSpec.barrelHalfHeight * HorseSpec.girthScaleH,
    axis,
  );
  const tFlank = p.crossThickness(
    HorseSpec.barrelHalfWidth * HorseSpec.flankScaleW,
    HorseSpec.barrelHalfHeight * HorseSpec.flankScaleH,
    axis,
  );
  const tHaunch = p.crossThickness(
    HorseSpec.barrelHalfWidth * HorseSpec.haunchScaleW,
    HorseSpec.barrelHalfHeight * HorseSpec.haunchScaleH,
    axis,
  );

  // 从后往前画，肩那一头收在最上面：脖子是从那儿长出来的，眼睛也是先读那一头。
  shapes.shadedCapsule(croup, lerp2(croup, chest, 0.34), tHaunch,
    palette.horseShade, palette.horseCoat, palette.horseLight, depth);
  shapes.shadedCapsule(lerp2(croup, chest, 0.28), lerp2(croup, chest, 0.64), tFlank,
    palette.horseShade, palette.horseCoat, palette.horseLight, depth + 0.01);
  shapes.shadedCapsule(lerp2(croup, chest, 0.58), chest, tGirth,
    palette.horseShade, palette.horseCoat, palette.horseLight, depth + 0.02);

  if (!def.barding) return;

  const across = Math.atan2(axis.y, axis.x) + Math.PI * 0.5;

  // 侧裙：马身上最大的一块甲，也是唯一在游戏尺寸下真能读出来的一块。两侧都画 —— 远侧那块
  // 自己就会在深度上输给躯干，不用另外剔除。
  //
  // 它挂在躯干**自己的轮廓**上而不是一个写死的高度，所以任何朝向下裙摆的下沿都正好落在
  // 腹线上。thickness 是躯干在屏幕上的视高，除以缩放就换回身体单位 —— 骨架的其余部分都
  // 住在那个空间里。
  const halfBarrel = (thickness * 0.5) / p.scale;
  // 只盖住腹胁的下半截，不是整面：那条线以上是骑手的大腿垂下来的地方，埋掉就是个没有腿
  // 的骑手。
  const skirtThickness = halfBarrel * 0.98;
  const skirtZ = HorseSpec.backZ - halfBarrel + skirtThickness * 0.5;

  for (let side = -1; side <= 1; side += 2) {
    // 裙摆挂在腹胁外侧，而一个 X 方向的偏移在屏幕上既往旁边移也往下移 —— 最多能移掉半个
    // 躯干高度。不补这一下，近侧那块裙会沉到肚子底下，读作马身下浮着一块板子而不是绑在
    // 侧面的甲。躯干只有一个轮廓，所以两侧的裙必须挂在同一个屏幕高度上。
    const lift = (p.screen(v3(side * HorseSpec.barrelHalfWidth, 0, 0)).y - p.screen(V3_ZERO).y) / p.scale;

    const a = v3(pose.body.x + side * HorseSpec.barrelHalfWidth, pose.body.y + HorseSpec.chestY - 2.6,
      pose.body.z + skirtZ + lift);
    const b = v3(pose.body.x + side * HorseSpec.barrelHalfWidth, pose.body.y + HorseSpec.croupY + 2.6,
      pose.body.z + skirtZ + lift);
    const sd = p.depth(v3((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5)) + DEPTH_BARDING - 0.1;

    // 一块平板，上下打光 —— 不用 shadedCapsule。那个助手把三档色带铺在胶囊**自己的轴**上，
    // 在一条肢体上没问题，铺在一块长条平板上就是三道顺着裙摆的条纹。
    const ts = p.s(skirtThickness);
    const litZ = skirtThickness * 0.24;

    shapes.bar(p.screen(a), p.screen(b), ts, palette.clothShade, sd);
    shapes.bar(
      p.screen(v3(a.x, a.y, a.z + litZ)),
      p.screen(v3(b.x, b.y, b.z + litZ)),
      ts * 0.62,
      palette.cloth,
      sd + 0.01,
    );
  }

  // 胸前和臀上的两块护板，阵营色。
  for (const at of [0.86, 0.14]) {
    const c = lerp2(croup, chest, at);
    const h = p.s(at > 0.5 ? 2.6 : 3.0);
    shapes.rect(c, thickness * 0.9, h, across, palette.clothShade, depth + DEPTH_BARDING);
    const L = ShapeBatch.LIGHT_DIR;
    shapes.rect(
      v2(c.x + L.x * thickness * 0.12, c.y + L.y * thickness * 0.12),
      thickness * 0.66,
      h * 0.9,
      across,
      palette.cloth,
      depth + DEPTH_BARDING + 0.005,
    );
  }
}

function drawNeckAndHead(
  shapes: ShapeBatch,
  pose: HorsePose,
  p: Projector,
  palette: CharacterPalette,
  def: UnitDef,
): void {
  const poll = p.screen(pose.poll);
  const muzzle = p.screen(pose.muzzle);

  const neckDepth =
    p.depth(v3((pose.withers.x + pose.poll.x) * 0.5, (pose.withers.y + pose.poll.y) * 0.5,
      (pose.withers.z + pose.poll.z) * 0.5)) + DEPTH_NECK;
  const headDepth = p.depth(pose.muzzle) + DEPTH_HEAD;

  // 分三段收窄。脖子抬得高、也很陡，在那个角度下一根粗细均匀的胶囊读作两个球中间接了根
  // 管子 —— 从肩到枕骨的这道收窄是轮廓里说"这是马"的大半。
  for (let i = 0; i < 3; i++) {
    const a = lerpV(pose.withers, pose.poll, i / 3);
    const b = lerpV(pose.withers, pose.poll, (i + 1) / 3);
    const w = HorseSpec.neckThickness * (1.18 - i * 0.17);
    shapes.shadedCapsule(p.screen(a), p.screen(b), p.s(w),
      palette.horseShade, palette.horseCoat, palette.horseLight, neckDepth + i * 0.01);
  }

  shapes.shadedCapsule(poll, muzzle, p.s(HorseSpec.headThickness),
    palette.horseShade, palette.horseCoat, palette.horseLight, headDepth);
  shapes.disc(muzzle, p.s(HorseSpec.headThickness * 0.62), shade(palette.horseShade, 0.9), headDepth + 0.01);

  // 鬃毛，顺着颈脊铺下来。
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const a = lerpV(pose.withers, pose.poll, t);
    a.z += 1.1;
    const b = v3(a.x, a.y - 1.1, a.z - 0.5);
    shapes.capsule(p.screen(a), p.screen(b), p.s(1.5), palette.horseMane, neckDepth + 0.02 + t * 0.01);
  }

  if (def.barding) {
    // 颈甲：一排横板压在鬃毛上，顺着颈脊排下去。
    for (let i = 0; i < 3; i++) {
      const t = i / 3;
      const c = lerpV(pose.withers, pose.poll, t + 0.08);
      c.z += 0.6;
      shapes.shadedCapsule(
        p.screen(v3(c.x - 1.5, c.y, c.z)),
        p.screen(v3(c.x + 1.5, c.y, c.z)),
        p.s(2.3),
        palette.steelDark, palette.steel, palette.steelLight,
        neckDepth + 0.04 + i * 0.01,
      );
    }

    // 面甲：一条窄钢板顺着脸下来，停在口鼻之前。
    const mid = lerpV(pose.poll, pose.muzzle, 0.25);
    mid.z += 0.5;
    const end = lerpV(pose.poll, pose.muzzle, 0.78);
    end.z += 0.2;
    shapes.shadedCapsule(p.screen(mid), p.screen(end), p.s(HorseSpec.headThickness * 0.68),
      palette.steelDark, palette.steel, palette.steelLight, headDepth + 0.02);

    // 面甲上的冠饰，和骑手的盔缨配套。
    const crest = lerpV(pose.poll, pose.muzzle, 0.12);
    crest.z += 1.2;
    shapes.shadedCapsule(
      p.screen(crest),
      p.screen(v3(crest.x, crest.y - 0.6, crest.z + 2.6)),
      p.s(1.2),
      palette.plumeShade, palette.plume, shade(palette.plume, 1.35),
      headDepth + 0.05,
    );
  }

  if (p.detailed) {
    // 耳朵。
    const ear = v3(pose.poll.x, pose.poll.y - 0.4, pose.poll.z + 0.9);
    shapes.capsule(p.screen(v3(ear.x - 0.9, ear.y, ear.z)), p.screen(v3(ear.x - 1.0, ear.y, ear.z + 1.3)),
      p.s(0.8), palette.horseShade, headDepth + 0.03);
    shapes.capsule(p.screen(v3(ear.x + 0.9, ear.y, ear.z)), p.screen(v3(ear.x + 1.0, ear.y, ear.z + 1.3)),
      p.s(0.8), palette.horseShade, headDepth + 0.03);

    // 笼头上的一条带子。
    const s = lerpV(pose.poll, pose.muzzle, 0.6);
    shapes.bar(p.screen(v3(s.x - 1.3, s.y, s.z)), p.screen(v3(s.x + 1.3, s.y, s.z)),
      p.s(0.7), palette.leatherDark, headDepth + 0.04);
  }
}

function drawSaddle(
  shapes: ShapeBatch,
  pose: HorsePose,
  p: Projector,
  palette: CharacterPalette,
  def: UnitDef,
): void {
  const depth = p.depth(pose.saddle) + DEPTH_SADDLE;
  const center = p.screen(pose.saddle);
  const L = ShapeBatch.LIGHT_DIR;

  // 先是阵营色的鞍垫，再压一副皮鞍座。
  shapes.ellipse(center, p.s(3.4), p.s(2.4 * Projection.groundSquash + 1.2), 0, palette.clothShade, depth);
  shapes.ellipse(
    v2(center.x + L.x * p.s(0.5), center.y + L.y * p.s(0.5)),
    p.s(2.9),
    p.s(2.0 * Projection.groundSquash + 1.0),
    0,
    def.barding ? palette.cloth : palette.clothShade,
    depth + 0.005,
  );
  shapes.sphere(center, p.s(2.1), palette.leatherDark, palette.leather, palette.leatherLight, depth + 0.01);
}

/**
 * 整只马缩成一个色块 —— 骑在上面的人只有八像素高的时候用这一档。
 *
 * 两个 quad：躯干和它的影子。那个尺寸下腿和脖子都不足一像素，却要花二十个 quad 什么也说
 * 不出来。
 */
function drawToken(shapes: ShapeBatch, p: Projector, palette: CharacterPalette): void {
  const length = HorseSpec.chestY - HorseSpec.croupY;

  shapes.ellipse(
    p.screen(V3_ZERO),
    p.s(length * 0.5),
    p.s(length * 0.5 * Projection.groundSquash),
    0,
    rgba(0, 0, 0, 76),
    p.depth(V3_ZERO) - 24,
  );

  // 往阵营色上带一点，理由和人的躯干一样：马在两边都是同一个颜色，而色块尺寸下一队骑兵
  // 大半的面积就是这些躯干。仍然以毛色为主，所以它还读作一匹马。
  shapes.capsule(
    p.screen(v3(0, HorseSpec.croupY, HorseSpec.backZ)),
    p.screen(v3(0, HorseSpec.chestY, HorseSpec.backZ)),
    p.s(HorseSpec.barrelHalfWidth * 2),
    lerpColor(palette.horseCoat, palette.cloth, 0.45),
    p.depth(v3(0, 0, HorseSpec.backZ)) - 2,
  );
}

/** 两个身体空间点之间插值。返回**新**对象 —— 调用方会就地改 z。 */
function lerpV(a: Vec3, b: Vec3, t: number): Vec3 {
  return v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}
