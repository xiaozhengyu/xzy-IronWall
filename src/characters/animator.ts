import {
  type Vec3,
  TWO_PI,
  clamp,
  dot3,
  easeOut,
  frac,
  lenSq3,
  lerp,
  lerp3,
  norm3,
  segment,
  smoothStep,
  sub3,
  v3,
} from '../core/math';
import { HorseAnimator, HorseSpec, type HorsePose } from './horse';
import { type Pose, RigSpec } from './rig';
import type { UnitDef } from './unitDef';

/**
 * 程序化生成姿势：没有关键帧，也没有精灵图。步态循环把脚放到地上，胯随之上下和左右摆动，
 * 剩下的交给 IK。移植自 overlord 的 CharacterAnimator。
 */

// 步态调参。
const STRIDE_BASE = 2.2;
const STRIDE_PER_SPEED = 0.155;

// 加了上限，让落脚点始终在腿的可达范围内 —— 否则 IK 会截断，站定的那只脚会明显打滑。
const MAX_STRIDE = 7.5;
const CROUCH_PER_STRIDE = 0.14;

const LIFT_BASE = 0.45;
const LIFT_PER_SPEED = 0.05;
const SWAY_AMPLITUDE = 0.35;
const LEAN_PER_SPEED = 0.012;

/**
 * 正着走和倒着走的切换阈值，量的是"走向在脸朝方向上的投影"（cos）。
 *
 * ±0.17 是垂直左右各十度。中间那条二十度宽的带子就是迟滞区 —— 见 syncStepDirection。
 */
const BACK_ENTER = -0.17;
const BACK_EXIT = 0.17;
/** 前倾和披风从"向前"倒向"向后"的速度，每秒。脚是一下翻过来的，这两样得跟上但不能跟太死。 */
const BACK_BLEND_RATE = 9;

/**
 * 后仰是前倾的几成。
 *
 * **不是对称的**，这是有道理的：往前走是身体带着腿跑，重心压在前面，倾角越快越大；往后退
 * 是腿在够、身体几乎不动，人只是把重心往后挪了一点点。一比一地仰回去，读出来像被一根绳子
 * 往后拽着走。
 */
const BACK_LEAN_SCALE = 0.3;

const SPINE_LENGTH = RigSpec.chestZ - RigSpec.hipZ;
const ARM_LENGTH = RigSpec.upperArm + RigSpec.forearm;

/**
 * 弓是斜着端的，不是竖直的。竖直的弓在高机位下投影成一根光杆 —— 侧倾之后弓臂在屏幕上
 * 横扫开，这是让弓的弧度和拉开的弦活下来的唯一办法。
 */
const BOW_CANT: Vec3 = { x: 0.6, y: 0.13, z: 0.79 };
const BOW_CANT_DRAWN: Vec3 = { x: 0.72, y: 0.06, z: 0.69 };

/**
 * 攻击动作里"打中"的那一刻，用归一化进度表示。
 *
 * 定在这里而不是调用方，是因为这个数字属于动画本身：每一个都等于对应动作里 strike 段
 * 结束的位置。两处一旦对不上，判定就会在武器还没挥到位时生效 —— 而这种错位在画面上
 * 只表现为"手感有点怪"，极难定位。改动作的时候记得一起改这里。
 */
export function attackImpact(def: UnitDef): number {
  // 端平锁死的矛没有"挥到位"这一刻 —— 它一直就在位。落点定在这一段的最前面，人贴上来的
  // 那一下几乎当场就疼，这正是撞在一根戳着的矛上该有的手感。
  if (def.braced) return 0.3;

  switch (def.weapon) {
    case 'hammer':
      return 0.54; // applyDoubleSmash: strike 段 0.36..0.54
    case 'sword':
      return 0.6; // applySlash: 0.35..0.60
    case 'spear':
      return 0.52; // applyPolearmThrust: 0.30..0.52
    case 'halberd':
      return 0.58; // applyHalberd: 0.38..0.58
    case 'bow':
      return 0.65; // applyBow: 撒放在 0.62..0.68
    default:
      return 0.5; // applyPunch: 0.30..0.50
  }
}

export function attackDuration(def: UnitDef): number {
  // 全场最短的一段，而且看不见 —— 它只是"这一下什么时候结算"的计时器，不是一个动作。
  // 出手快慢由 attackSpeed 经 enemySwingGap 决定，和这个数无关。
  if (def.braced) return 0.35;

  switch (def.weapon) {
    case 'bow':
      return 1.15;
    case 'spear':
      return 0.5;
    case 'halberd':
      return 0.78;
    case 'sword':
      return 0.58;
    // 锤子最慢。重量感全靠这个 —— 一个和剑一样快的锤子读起来就是一根轻飘飘的棍子。
    case 'hammer':
      return 0.72;
    default:
      return 0.38;
  }
}

export class CharacterAnimator {
  /** 步态循环位置，0..1。一个循环是两步。 */
  phase = 0;

  /**
   * 这一帧在倒着走。见 syncStepDirection。
   *
   * 只有玩家会立起来：别人朝哪儿就往哪儿走。
   */
  backward = false;

  private breath = 0;
  private stride = 0;
  private lift = 0;
  /** 倒着走的平滑量，0..1。脚只能整个翻过来，但前倾和披风是连续的。 */
  private backBlend = 0;

  /**
   * 这一帧是正着走还是倒着走。**每帧在 update 之前调一次**（坐骑要和人用同一个答案）。
   *
   * 这是"朝向和走向分家"之后最便宜的那一半补救：脚的迈步方向在身体局部空间里就是一个正负
   * 号，翻过来，人就是在往后退而不是在往前走 —— 不用把上下半身拆成两个投影。
   *
   * 它**只解决进退这条轴**。走向和朝向垂直时（绕着人转圈，割草里最常走的那条线）两边都不
   * 对，那时候腿仍然是朝正前方迈而人在横移。真要那一档也对，就得让迈步方向跟着走向转，
   * 或者把上下半身分开。
   *
   * @param stepDelta 走的方向减去脸朝的方向，弧度。0 = 朝哪儿就往哪儿走。
   */
  syncStepDirection(dt: number, stepDelta: number): void {
    const forwardness = Math.cos(stepDelta);
    // 迟滞：进和退的阈值错开，各偏离垂直 10 度。不错开的话，绕着人转圈时正好垂直的那一段
    // 会在正着走和倒着走之间每隔几帧翻一次 —— 而垂直恰恰是最常走的那条线。
    if (this.backward ? forwardness > BACK_EXIT : forwardness < BACK_ENTER) {
      this.backward = !this.backward;
    }
    this.backBlend = lerp(this.backBlend, this.backward ? 1 : 0, clamp(dt * BACK_BLEND_RATE, 0, 1));
  }

  /**
   * @param speed     当前移动速度（世界单位/秒）
   * @param walkSpeed 该单位的标准步行速度，用来把 speed 归一化
   * @param attack    攻击动作进度 0..1；负数表示没在攻击
   * @param horse     坐骑的姿势；步兵传 null。给了它，下半身就不再走步态而是坐上马鞍
   *                  （见 buildSeat），上半身也不再摆臂。
   */
  update(
    dt: number,
    speed: number,
    walkSpeed: number,
    def: UnitDef,
    attack: number,
    pose: Pose,
    horse: HorsePose | null = null,
  ): void {
    const move = clamp(speed / Math.max(walkSpeed, 0.01), 0, 1.6);
    const gait = clamp(move, 0, 1);

    this.stride = clamp(STRIDE_BASE + speed * STRIDE_PER_SPEED, 0, MAX_STRIDE);
    this.lift = LIFT_BASE + speed * LIFT_PER_SPEED;

    if (speed > 0.35 && this.stride > 0.01) {
      // 两步走过 2*stride 的地面，所以循环频率精确跟随速度。这正是让站定的脚不打滑的原因。
      this.phase = frac(this.phase + (speed / (2 * this.stride)) * dt);
    } else {
      this.phase = frac(this.phase + dt * 0.25);
      this.phase = lerp(this.phase, 0.25, clamp(dt * 6, 0, 1));
    }

    this.breath += dt;

    if (horse) buildSeat(pose, horse);
    else this.buildLowerBody(pose, gait, speed);
    this.buildUpperBody(pose, gait, speed, def, attack, horse !== null);
    this.updateCape(pose, speed, walkSpeed);
    pose.solveLimbs();
    applyStature(pose, def.stature);
  }

  /**
   * 倒地。
   *
   * 不是布娃娃：先照常搭出站立的静止姿势，再把整副骨架朝一个固定的躺姿缓动过去 ——
   * 脊柱贴着地面铺开、胯落到一个身体厚度的高度、四肢甩开。这样每个关节全程都待在 IK
   * 的可达范围内（真布娃娃在这里会在脚一出界的瞬间把腿拉成一条直线），代价只有每个关节
   * 一次 lerp。移植自 overlord 的 CharacterAnimator.Collapse。
   *
   * @param t    倒地进度 0..1
   * @param fall 身体局部地面平面上的单位向量，身体朝这个方向倒。调用方要挑一个在屏幕上
   *             横着铺开的方向，而不是戳进屏幕里的 —— 后者投影出来几乎没有位移，看着
   *             像人原地缩了一下。
   */
  collapse(
    pose: Pose,
    def: UnitDef,
    t: number,
    fallX: number,
    fallY: number,
    horse: HorsePose | null = null,
  ): void {
    // 马跟着骑手一起倒下，然后骑手照常摊到地上 —— 他是被摔下来的，不是连人带马一起躺平。
    if (horse) {
      HorseAnimator.collapse(horse, t);
      buildSeat(pose, horse);
    } else {
      this.buildLowerBody(pose, 0, 0);
    }
    this.buildUpperBody(pose, 0, 0, def, -1, horse !== null);
    pose.capeSwing = 0;
    pose.capeTrail = 0;
    pose.capeLift = 0;

    const e = smoothStep(clamp(t, 0, 1));
    // 倒向 fall：头朝那边，腿拖在反方向，手臂甩向两侧。全部写在"倒地坐标系"里而不是
    // 原始的局部轴上，这才让调用方能指定往哪边倒。
    const sideX = -fallY;
    const sideY = fallX;

    // 左肢往身体的左边摊，右肢往右边 —— 关键是**哪一边才是左边**。
    //
    // side 是"垂直于倒地方向"的那条轴，它和身体自己的左右轴没有固定关系：人往哪个方向倒，
    // side 就跟着转。之前左脚一律往 +side 摆、右脚往 −side，于是倒的方向一转过去，左脚就
    // 摆到了身体的右侧 —— 而胯是固定的（左胯在局部 x 的负半边），IK 于是把左腿从身体底下
    // 穿过去接到右边的脚上，两条腿交叉，看着像被打成了麻花。
    //
    // 身体左轴是局部 (-1, 0)，它在 side 上的投影是 −sideX = fallY。所以 fallY 的正负就是
    // "左边在 side 的哪一头"。fallY 接近 0 时（正好朝身体侧向倒）左右本来就没有答案，但那时
    // side 平行于脊柱，两条腿都落在脊柱线上，怎么分都不会交叉。
    const lsign = fallY >= 0 ? 1 : -1;

    const hip = v3(fallX * 0.4, fallY * 0.4, 1.7);
    const chest = v3(
      hip.x + fallX * (SPINE_LENGTH * 0.94),
      hip.y + fallY * (SPINE_LENGTH * 0.94),
      hip.z + 0.55,
    );
    const head = v3(chest.x + fallX * 3.4, chest.y + fallY * 3.4, chest.z + 0.1);

    pose.hip = lerp3(pose.hip, hip, e);
    pose.chest = lerp3(pose.chest, chest, e);
    pose.head = lerp3(pose.head, head, e);
    pose.spineLean = lerp(pose.spineLean, 1.45, e);
    pose.spineYaw = lerp(pose.spineYaw, 0.25, e);

    // 腿伸在身后，不是蜷起来：一个缩到站立高度三分之一的身体读作一堆衣服，不是一个人。
    const lx = sideX * lsign;
    const ly = sideY * lsign;

    pose.footL = lerp3(pose.footL, v3(hip.x - fallX * 6.6 + lx * 2.4, hip.y - fallY * 6.6 + ly * 2.4, 0.4), e);
    pose.footR = lerp3(pose.footR, v3(hip.x - fallX * 5.4 - lx * 2.2, hip.y - fallY * 5.4 - ly * 2.2, 0.5), e);

    pose.handL = lerp3(pose.handL, v3(chest.x + lx * 3.6, chest.y + ly * 3.6, chest.z - 0.9), e);
    pose.handR = lerp3(pose.handR, v3(chest.x - lx * 3.4, chest.y - ly * 3.4, chest.z - 1.0), e);

    pose.bowDraw = 0;
    pose.showArrow = false;
    // 武器落平、顺着身体躺下。"在世界里是平的"不等于"在屏幕上是平的"：一根躺在地上却
    // 指向镜头深处的杆子，投影出来仍然是接近竖直的一条线，所以它必须躺在 fall 方向上 ——
    // 那个方向已经被挑成是横着铺开的了。
    pose.weaponGrip = lerp3(pose.weaponGrip, pose.handR, e);
    pose.weaponDir = norm3(
      lerp3(pose.weaponDir, norm3(v3(fallX * 0.94 - lx * 0.28, fallY * 0.94 - ly * 0.28, 0.06)), e),
    );
    pose.offhandGrip = pose.handL;
    pose.offhandDir = pose.weaponDir;

    pose.solveLimbs();
    applyStature(pose, def.stature);
  }

  /**
   * 用和脚同一个相位驱动斗篷。走路时是克制的摆动；一旦实际速度超过步行速，横摆、后曳和
   * 掀起的下摆都连续地长成更大的跑动幅度。
   */
  private updateCape(pose: Pose, speed: number, walkSpeed: number): void {
    const pace = speed / Math.max(walkSpeed, 0.01);
    const moving = clamp(pace, 0, 1);
    const running = clamp((pace - 1) / 0.9, 0, 1);
    const step = TWO_PI * this.phase;

    const sideAmplitude = lerp(0.42, 1.28, running) * moving;
    const trail = lerp(0.3, 1.55, running) * moving;
    const lift = lerp(0.1, 0.72, running) * moving;

    // 二次谐波让松垮的下摆在每次落脚时抖一下，又不至于把整件斗篷变成正弦缎带。
    const hemSnap = (0.5 + 0.5 * Math.sin(step * 2 + 0.65)) * moving;
    pose.capeSwing = Math.sin(step - 0.55) * sideAmplitude;
    // 布是往人**走**的反方向飘的，不是往他背后飘。倒着退的时候披风扑在身前 —— 这一条和
    // 脚一起，才是让人读作"他在后退"而不是"他的腿反了"的东西。
    pose.capeTrail = (trail + hemSnap * lerp(0.08, 0.32, running)) * (1 - 2 * this.backBlend);
    pose.capeLift = lift + hemSnap * lerp(0.06, 0.28, running);
  }

  private buildLowerBody(pose: Pose, gait: number, speed: number): void {
    const idleSpread = 1.05;
    const bobAmplitude = (0.25 + speed * 0.02) * gait;

    // 胯：以两倍步频上下起伏，并朝着站定的那条腿横移。
    const bob = -bobAmplitude * Math.cos(TWO_PI * 2 * this.phase);
    const sway = -SWAY_AMPLITUDE * gait * Math.sin(TWO_PI * this.phase);
    const breathe = (1 - gait) * 0.12 * Math.sin(TWO_PI * 0.32 * this.breath);

    // 步子越大，胯必须坐得越低，腿才够得着。
    const crouch = Math.max(0, (this.stride - 3) * CROUCH_PER_STRIDE) * gait;

    pose.hip = v3(sway, 0, RigSpec.hipZ - crouch + bob + breathe);

    const idleL = v3(-RigSpec.hipHalfWidth * idleSpread, 0, 0);
    const idleR = v3(RigSpec.hipHalfWidth * idleSpread, 0, 0);

    pose.footL = lerp3(idleL, this.stepTarget(this.phase, -RigSpec.hipHalfWidth), gait);
    pose.footR = lerp3(idleR, this.stepTarget(frac(this.phase + 0.5), RigSpec.hipHalfWidth), gait);
  }

  /**
   * 一条腿在一个循环里的落脚目标：前半程踩实并向身后滑动，后半程腾空前摆。
   */
  private stepTarget(phase: number, sideX: number): Vec3 {
    const half = this.stride * 0.5;
    let y: number;
    let z: number;

    if (phase < 0.5) {
      const t = phase / 0.5;
      y = lerp(half, -half, t);
      z = 0;
    } else {
      const t = (phase - 0.5) / 0.5;
      y = lerp(-half, half, smoothStep(t));
      z = this.lift * Math.sin(Math.PI * t);
    }

    // 步幅保持在胯宽上。原本大步时会收窄近 18%，那等于让人走钢丝：从正面或背面看两条
    // 小腿都往身体底下并，靴子几乎碰在一起，无论脚尖怎么摆都读作内八字。
    //
    // 倒着走就是把这条轴整个翻过来：站定的那只脚改成从身后往身前滑，人于是被"推"着后退。
    // 相位推进的公式一个字没改，所以脚照样不打滑 —— 翻的是方向，不是速度。
    return v3(sideX, this.backward ? -y : y, z);
  }

  private buildUpperBody(
    pose: Pose,
    gait: number,
    speed: number,
    def: UnitDef,
    attack: number,
    mounted = false,
  ): void {
    // 骑在马上的人本来就是前倾的，而且不会随速度越倾越多 —— 他靠鞍子固定，不是靠往前扑。
    //
    // 步兵的前倾要跟着进退翻：往后退的人是往后仰着的，一个前倾着倒退的人读起来像被拖走。
    // 但只仰一点点，见 BACK_LEAN_SCALE。
    const lean = mounted
      ? 0.1 + speed * 0.004
      : speed * LEAN_PER_SPEED * lerp(1, -BACK_LEAN_SCALE, this.backBlend);
    pose.spineLean = lean;
    pose.spineYaw = 0;
    pose.bowDraw = 0;
    pose.showArrow = false;

    pose.chest = v3(
      pose.hip.x,
      pose.hip.y + Math.sin(lean) * SPINE_LENGTH,
      pose.hip.z + Math.cos(lean) * SPINE_LENGTH,
    );
    pose.head = v3(
      pose.hip.x,
      pose.hip.y + Math.sin(lean) * (RigSpec.headZ - RigSpec.hipZ),
      pose.hip.z + (RigSpec.headZ - RigSpec.hipZ),
    );

    // 反向摆臂：每条手臂镜像同侧的腿。骑手的脚挂在镫上不动，所以他也不摆臂。
    const swing = mounted ? 0 : (pose.footR.y - pose.footL.y) * 0.5 * gait;

    const shoulderL = pose.shoulderSocket(0);
    const shoulderR = pose.shoulderSocket(1);

    buildWeaponRest(pose, def, shoulderL, shoulderR, swing, gait);

    if (attack >= 0) applyAttack(pose, def, attack, shoulderL, shoulderR);
  }
}

/**
 * 骑姿：胯坐在鞍上，两只脚踩在马腹两侧的镫里，于是两条腿是永远弯在马身上的。
 *
 * 落脚点两边各有一个失败模式，正确的位置夹在中间：收进躯干半宽以内，整条腿会消失到马身
 * 后面；伸到一个真实马镫该在的位置，脚又超出腿的可达范围，IK 把腿拉成一条直线 —— 而马
 * 侧面那条直线读作贴上去的一根木条。现在这个位置让腿在大约四分之三可达处折起来，膝盖还在。
 */
function buildSeat(pose: Pose, horse: HorsePose): void {
  // 骑手吸收掉一部分马的起伏，不是焊在鞍子上的。
  const seat = horse.saddle;
  pose.hip = v3(seat.x * 0.7, seat.y + 0.2, seat.z + 0.9);

  const stirrupX = HorseSpec.barrelHalfWidth + 1.0;
  const stirrupZ = HorseSpec.backZ - HorseSpec.barrelHalfHeight + 0.5 + horse.body.z * 0.9;

  pose.footL = v3(-stirrupX, seat.y + 2.6, stirrupZ);
  pose.footR = v3(stirrupX, seat.y + 2.6, stirrupZ);
}

/**
 * IK 之后再整体缩短姿势。让每个关节围绕地面缩放，既保住步态和手持道具，又能让矮个子
 * 真的矮下去而不只是变宽。
 *
 * 去重是必须的，这是从 C# 移植过来时最容易踩的一个坑：那边 Vector3 是值类型，
 * `pose.WeaponGrip = pose.HandR` 是一次拷贝；这边是对象引用，两个字段指向同一个 Vec3。
 * 而握点几乎总是等于某只手，于是那个关节会被缩放两次 —— z 实际乘的是 scale²。
 * stature 为 1 时看不出来（1² = 1），所以这个错误可以一直藏到第一个非标准身高的单位
 * 出现为止。别改成"赋值时拷贝"：握点跟着手走本来就是对的，该修的是这里。
 */
function applyStature(pose: Pose, scale: number): void {
  if (Math.abs(scale - 1) < 0.001) return;
  const joints = new Set<Vec3>([
    pose.hip,
    pose.chest,
    pose.head,
    pose.footL,
    pose.footR,
    pose.kneeL,
    pose.kneeR,
    pose.handL,
    pose.handR,
    pose.elbowL,
    pose.elbowR,
    pose.weaponGrip,
    pose.offhandGrip,
  ]);
  for (const p of joints) p.z *= scale;
}

function buildWeaponRest(
  pose: Pose,
  def: UnitDef,
  shoulderL: Vec3,
  shoulderR: Vec3,
  swing: number,
  gait: number,
): void {
  const hang = ARM_LENGTH * (0.88 - 0.1 * gait);

  switch (def.weapon) {
    case 'bow': {
      // 横在身前，弓臂大致竖直，弦朝着射手自己。
      pose.handL = v3(shoulderL.x - 1.9, shoulderL.y + 1.5, shoulderL.z - 2.9);
      pose.handR = v3(shoulderR.x + 0.5, shoulderR.y + 0.6, shoulderR.z - 2.6);
      pose.weaponGrip = pose.handL;
      pose.weaponDir = norm3(BOW_CANT);
      break;
    }

    case 'spear':
    case 'halberd': {
      if (def.braced) {
        buildBracedPike(pose, shoulderL, shoulderR);
        break;
      }
      // 斜扛在肩上，只用持械那只手。两只手都扶在杆上会让手臂无处可去：整个走路循环里它们
      // 都夹在胸前，姿势读作扭曲。副手像普通士兵一样跟着步态摆，只在突刺时才回到杆上。
      const dir = def.weapon === 'halberd' ? norm3(v3(0.06, 0.2, 0.98)) : norm3(v3(0.1, 0.34, 0.94));
      const grip =
        def.weapon === 'halberd'
          ? v3(shoulderR.x + 1.0, shoulderR.y + 0.8, shoulderR.z - 2.9)
          : v3(shoulderR.x + 0.9, shoulderR.y + 0.4, shoulderR.z - 2.6);
      pose.weaponDir = dir;
      pose.weaponGrip = grip;
      pose.handR = grip;
      pose.handL = v3(shoulderL.x - 0.25, shoulderL.y + swing * 0.95, shoulderL.z - hang);
      break;
    }

    case 'hammer': {
      // 双持圆锤：两只手都跟着步态摆，两个锤头朝上、朝外斜出去。
      //
      // 锤头必须落在身体轮廓之外，这是整个姿势的要点。竖直举着的话两个头会压在躯干上，
      // 从这个机位看就是胸口多了两块灰色 —— 而斜出去之后它们成了身体两侧对称的两块金属，
      // 那正是玩家在人堆里认出自己的东西。
      const drop = hang * 0.94;
      pose.handL = v3(shoulderL.x - 0.5, shoulderL.y + 0.7 + swing * 0.85, shoulderL.z - drop);
      pose.handR = v3(shoulderR.x + 0.5, shoulderR.y + 0.7 - swing * 0.85, shoulderR.z - drop);
      pose.weaponGrip = pose.handR;
      pose.offhandGrip = pose.handL;
      pose.weaponDir = norm3(v3(0.40, 0.20, 0.89));
      pose.offhandDir = norm3(v3(-0.40, 0.20, 0.89));
      break;
    }

    case 'sword': {
      pose.handL = v3(shoulderL.x - 0.4, shoulderL.y + 1.6 + swing * 0.18, shoulderL.z - 2.2);
      pose.handR = v3(shoulderR.x + 1.15, shoulderR.y + 0.35 - swing * 0.18, shoulderR.z - 2.2);
      pose.weaponGrip = pose.handR;
      pose.weaponDir = norm3(v3(0.28, 0.22, 0.93));
      break;
    }

    default: {
      pose.handL = v3(shoulderL.x - 0.25, shoulderL.y + swing * 0.95, shoulderL.z - hang);
      pose.handR = v3(shoulderR.x + 0.25, shoulderR.y - swing * 0.95, shoulderR.z - hang);
      pose.weaponGrip = pose.handR;
      pose.weaponDir = v3(0, 0, 1);
      break;
    }
  }
}

/**
 * 端平锁死的长矛：矛平举在身前指着正前方，盾横在身前，两只手一步都不摆。见 UnitDef.braced。
 *
 * **方向是严格的 +y，一点都不抬。** +y 是身体的正前方，也正是塔盾盾面的法线，所以矛与盾
 * 在任何朝向下都是垂直的 —— 这个兵种就是这么定义的，抬起来一点点就不再是了。
 *
 * 别的动作（applyPolearmThrust）会把矛往上掰到 0.47 的仰角，理由是"完全水平的突刺在俯视图
 * 里会被压缩成一个点"。那条理由在这里不成立：突刺是一瞬间，看不清就等于没发生；而这杆矛是
 * 一直举着的，玩家绕着他走，八个朝向里有六个都把这条线完整地铺在屏幕上。正对镜头的那两个
 * 朝向上它确实缩成一截短粗的杆 —— 那是一杆指着你的矛该有的样子。
 *
 * 两只手都不跟步态摆，各有各的理由：
 *   持盾的左手 —— 盾的左右位置是跟着它走的（见 renderer 的 drawShield）。手一摆，一面比人
 *                 还宽的盾就跟着左右晃，走两步就露出半个身子。
 *   持矛的右手 —— 矛尖在手前面二十多个单位，握点抖一个单位，矛尖就扫过去一大截。这条线
 *                 必须是死的。
 */
function buildBracedPike(pose: Pose, shoulderL: Vec3, shoulderR: Vec3): void {
  // 左手压在身前偏内侧：盾心要落在人的正前方（drawShield 从胸往手插值 0.72），一面正面挡人
  // 的盾不能像挎着的圆盾那样偏到一边去。
  pose.handL = v3(shoulderL.x + 1.1, shoulderL.y + 2.3, shoulderL.z - 2.6);

  // 握点在盾上沿的高度、盾面外侧一点：矛是从盾的上沿探出去的，不是从盾里穿出去的。
  const grip = v3(shoulderR.x + 0.35, shoulderR.y + 2.4, shoulderR.z - 1.0);
  pose.weaponGrip = grip;
  pose.handR = grip;
  pose.weaponDir = v3(0, 1, 0);
}

/** 把攻击动作叠在静止姿势之上。 */
function applyAttack(pose: Pose, def: UnitDef, t: number, shoulderL: Vec3, shoulderR: Vec3): void {
  // 端平锁死的人不做任何攻击动作 —— 他不是在"攻击"，他是一根一直戳在那儿的矛，走进去的人
  // 自己撞上来。伤害照常在 attackImpact 那一刻落下，只是画面上一帧都不变。
  if (def.braced) return;

  switch (def.weapon) {
    case 'bow':
      applyBow(pose, t, shoulderL, shoulderR);
      break;
    case 'spear':
      applyPolearmThrust(pose, t, shoulderL, shoulderR, 7.0);
      break;
    case 'halberd':
      applyHalberd(pose, t, shoulderL, shoulderR);
      break;
    case 'sword':
      applySlash(pose, t);
      break;
    case 'hammer':
      applyDoubleSmash(pose, t, shoulderL, shoulderR);
      break;
    default:
      applyPunch(pose, t, shoulderR);
      break;
  }
}

/**
 * 副手有多少落在杆上。在挥击的头几帧内渐入、末几帧渐出，手臂才能不跳变地回到走路摆臂。
 */
const grab = (t: number): number => smoothStep(clamp(Math.min(t / 0.14, (1 - t) / 0.18), 0, 1));

/**
 * 人会握在手臂真正够得到的位置上，够不到就把手往杆下方滑。
 *
 * 这是"双手攻击时副臂看起来长了一截"的修法。IK 只决定肘往哪儿放：它会把肩到手的距离
 * 截断以解出三角形，但渲染器仍然把前臂画到给定的那只手上 —— 于是一只摆在臂展之外的手，
 * 画出来就是一条被拉长去补差距的前臂。
 *
 * 直接把手拉回肩膀能修长度，却会让手离开武器，那更糟 —— 一个悬在杆边上的拳头。所以让
 * 手沿着杆往回滑，滑到手臂可达球面的近侧交点。握点顺着杆下移一点，人本来就会这么做。
 */
function gripWithinReach(shoulder: Vec3, wanted: Vec3, shaft: Vec3): Vec3 {
  // 比真实臂长略短：画得笔直的手臂读作一根棍子，肘部需要有地方待着。
  const slack = 0.96;
  const reach = ARM_LENGTH * slack;

  const v = sub3(wanted, shoulder);
  const far = lenSq3(v);
  if (far <= reach * reach) return wanted;

  const b = dot3(v, shaft);
  const disc = b * b - far + reach * reach;
  if (disc < 0) {
    const k = reach / Math.sqrt(far);
    return v3(shoulder.x + v.x * k, shoulder.y + v.y * k, shoulder.z + v.z * k);
  }

  const root = Math.sqrt(disc);
  let back = b - root;
  if (back < 0) back = b + root;
  back = Math.max(back, 0);

  return v3(wanted.x - shaft.x * back, wanted.y - shaft.y * back, wanted.z - shaft.z * back);
}

/** 沿杆的双手突刺：后引、前送、收势。 */
function applyPolearmThrust(pose: Pose, t: number, shoulderL: Vec3, shoulderR: Vec3, reach: number): void {
  const windup = smoothStep(segment(t, 0, 0.3));
  const strike = easeOut(segment(t, 0.3, 0.52));
  const recover = smoothStep(segment(t, 0.52, 1));

  const push = (-1.9 * windup + reach * strike) * (1 - recover);

  // 朝目标放平而不是指向镜头 —— 完全水平的突刺在俯视图里会被压缩成一个点。
  const level = clamp(strike + windup * 0.3 - recover, 0, 1);
  const dir = norm3(lerp3(pose.weaponDir, v3(0.02, 0.88, 0.47), level));

  const grip = v3(shoulderR.x + 0.8, shoulderR.y + 0.6 + push, shoulderR.z - 1.6 + level * 0.5);
  pose.weaponDir = dir;
  pose.weaponGrip = grip;
  pose.handR = grip;

  const offHand = gripWithinReach(
    shoulderL,
    v3(grip.x + dir.x * 3 - 1.2, grip.y + dir.y * 3, grip.z + dir.z * 3),
    dir,
  );
  pose.handL = lerp3(pose.handL, offHand, grab(t));
  pose.spineYaw = -0.28 * windup + 0.4 * strike - 0.12 * recover;
}

/** 过顶劈砍：斧头先抬高到身后，再从身前落下。 */
function applyHalberd(pose: Pose, t: number, shoulderL: Vec3, shoulderR: Vec3): void {
  const windup = smoothStep(segment(t, 0, 0.38));
  const strike = easeOut(segment(t, 0.38, 0.58));
  const recover = smoothStep(segment(t, 0.58, 1));

  let pitch = lerp(0.2, -0.55, windup);
  pitch = lerp(pitch, 1.15, strike);
  pitch = lerp(pitch, 0.2, recover);

  const dir = norm3(v3(0.06, Math.sin(pitch), Math.cos(pitch)));

  let lift = lerp(-2.9, -0.6, windup);
  lift = lerp(lift, -2.2, strike);
  lift = lerp(lift, -2.9, recover);

  const grip = v3(shoulderR.x + 0.9, shoulderR.y + 0.5 + 0.8 * strike, shoulderR.z + lift);
  pose.weaponDir = dir;
  pose.weaponGrip = grip;
  pose.handR = grip;
  const offHand = gripWithinReach(
    shoulderL,
    v3(grip.x + dir.x * 3.2 - 1.5, grip.y + dir.y * 3.2, grip.z + dir.z * 3.2),
    dir,
  );
  pose.handL = lerp3(pose.handL, offHand, grab(t));
  pose.spineYaw = -0.34 * windup + 0.45 * strike - 0.11 * recover;
}

function applySlash(pose: Pose, t: number): void {
  // 水平横扫。手沿着胸前的一段圆弧走：先绕到持剑那侧的身后，再扫向对侧。
  // 角度从身体右侧 (+X) 量向正前 (+Y)。
  const windup = smoothStep(segment(t, 0, 0.35));
  const strike = easeOut(segment(t, 0.35, 0.6));
  const recover = smoothStep(segment(t, 0.6, 1));

  const restAngle = 0.55;
  let angle = lerp(restAngle, -0.85, windup);
  angle = lerp(angle, 2.3, strike);
  angle = lerp(angle, restAngle, recover);

  let height = lerp(-2.2, 1.5, windup);
  height = lerp(height, -0.4, strike);
  height = lerp(height, -2.2, recover);

  const reach = 3.1;
  pose.handR = v3(
    pose.chest.x + Math.cos(angle) * reach,
    pose.chest.y + Math.sin(angle) * reach,
    pose.chest.z + height,
  );
  pose.weaponGrip = pose.handR;
  pose.spineYaw = clamp(-0.45 * windup + 0.9 * strike - 0.45 * recover, -0.6, 0.6);

  // 剑身在挥击中拖在手后面，并从竖直倒向水平。
  const bladeAngle = angle - 0.7;
  const flat = clamp(strike + windup * 0.25 - recover, 0, 1);
  pose.weaponDir = norm3(v3(Math.cos(bladeAngle), Math.sin(bladeAngle), lerp(2.4, 0.15, flat)));
}

/**
 * 双锤过顶砸击：两把一起举过头，再一起砸到身前。
 *
 * 刻意是对称的。单手挥击靠脊柱扭转（spineYaw）产生力量感，但双持过顶没有可扭的方向 ——
 * 硬加扭转只会让两只手一前一后，读作"他在乱挥"而不是"他在砸"。对称动作的力量感来自
 * 别的地方：举起慢、落下快，以及落点明显低于起手点。
 */
function applyDoubleSmash(pose: Pose, t: number, shoulderL: Vec3, shoulderR: Vec3): void {
  const windup = smoothStep(segment(t, 0, 0.36));
  const strike = easeOut(segment(t, 0.36, 0.54));
  const recover = smoothStep(segment(t, 0.54, 1));

  // 手相对肩的高度：垂着 -> 举过头顶 -> 砸到身前偏低 -> 回到垂着。
  let lift = lerp(-4.4, 2.4, windup);
  lift = lerp(lift, -3.6, strike);
  lift = lerp(lift, -4.4, recover);

  // 手往前伸多少。举起时略微收回身后，砸下时送出去。
  let reach = lerp(0.7, -1.1, windup);
  reach = lerp(reach, 4.4, strike);
  reach = lerp(reach, 0.7, recover);

  // 锤头的俯仰，从竖直量起：0 是朝正上，PI/2 是水平朝前，再大就是朝前下方。
  //
  // 落点必须越过 PI/2。第一版停在 1.4（离水平还差 10 度），那是"向前平推"而不是"向下砸"，
  // 锤子看着像在捅人。2.05 让两个锤头明确地落到身前的地面附近。
  let pitch = lerp(0.18, -0.62, windup);
  pitch = lerp(pitch, 2.05, strike);
  pitch = lerp(pitch, 0.18, recover);

  // 举过头顶时两只手收拢，砸下去时分开 —— 收拢的起手让落点显得更宽。
  const spread = lerp(1.0, 0.55, windup) + 0.9 * strike;

  pose.handL = v3(shoulderL.x - 0.55 * spread, shoulderL.y + reach, shoulderL.z + lift);
  pose.handR = v3(shoulderR.x + 0.55 * spread, shoulderR.y + reach, shoulderR.z + lift);

  const out = 0.34 * spread;
  const sinP = Math.sin(pitch);
  const cosP = Math.cos(pitch);
  pose.weaponGrip = pose.handR;
  pose.offhandGrip = pose.handL;
  pose.weaponDir = norm3(v3(out, sinP, cosP));
  pose.offhandDir = norm3(v3(-out, sinP, cosP));
  pose.spineYaw = 0;
}

function applyPunch(pose: Pose, t: number, shoulderR: Vec3): void {
  const windup = smoothStep(segment(t, 0, 0.3));
  const strike = easeOut(segment(t, 0.3, 0.5));
  const recover = smoothStep(segment(t, 0.5, 1));

  const reach = -1.4 * windup + 5.4 * strike - 4.0 * recover;
  const rise = 1.6 * windup + 0.9 * strike - 2.5 * recover;
  pose.handR = v3(shoulderR.x + 0.35, shoulderR.y + reach, shoulderR.z - ARM_LENGTH + 2.6 + rise);
  pose.spineYaw = -0.28 * windup + 0.45 * strike - 0.17 * recover;
}

function applyBow(pose: Pose, t: number, shoulderL: Vec3, shoulderR: Vec3): void {
  const raise = smoothStep(segment(t, 0, 0.32));
  const draw = smoothStep(segment(t, 0.2, 0.55));
  const loose = segment(t, 0.62, 0.68);
  const lower = smoothStep(segment(t, 0.72, 1));

  const held = clamp(draw - loose, 0, 1);
  const up = clamp(raise - lower, 0, 1);

  // 持弓臂朝目标伸直。
  const carried = v3(shoulderL.x - 1.9, shoulderL.y + 1.5, shoulderL.z - 2.9);
  const aimed = v3(shoulderL.x - 1.7, shoulderL.y + 3.8, shoulderL.z - 0.5);
  pose.handL = lerp3(carried, aimed, up);

  // 拉弦的手随着拉开的进程越过下颌向后走。
  const rest = v3(shoulderR.x + 0.5, shoulderR.y + 0.6, shoulderR.z - 2.6);
  const anchor = v3(shoulderR.x + 0.5, shoulderR.y - 1.4, shoulderR.z + 0.4);
  const released = v3(shoulderR.x + 0.5, shoulderR.y + 0.9, shoulderR.z + 0.2);
  pose.handR = lerp3(rest, lerp3(anchor, released, loose), up);

  pose.weaponGrip = pose.handL;
  pose.weaponDir = norm3(lerp3(BOW_CANT, BOW_CANT_DRAWN, up));
  pose.bowDraw = held;
  pose.showArrow = held > 0.05;
  pose.spineYaw = -0.3 * up;
}
