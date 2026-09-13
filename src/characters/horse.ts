import { type Vec3, clamp, frac, lerp, lerp3, smoothStep, v3 } from '../core/math';
import { solveTwoBoneIk } from './twoBoneIk';

/**
 * 坐骑：比例、姿势和步态。移植自 overlord 的 HorseSpec / HorsePose / HorseAnimator，
 * 数值一个没改 —— 和人物骨架一样，这些比例是被截图反复对出来的。
 *
 * 局部空间和骑手共用：X = 右手边，Y = 面朝方向，Z = 上。马肩隆约 10 个单位高，于是骑手的
 * 头落在 24 上下 —— 差不多是步兵的一倍半，这正是骑兵在人堆里一眼能认出来的全部原因。
 */
export const HorseSpec = {
  // 是战马不是骑乘马。分开这两种轮廓的不是整体大小，是另外两件事：躯干必须明显长过深
  // （2:1 的桶就是个桶，2.6:1 才是马），而且它得**有形状** —— 肩后那道深胸围、收进去的
  // 腹胁、鼓出来的后臀。一根粗细均匀的管子无论比例多准都读作玩具。
  backZ: 9.2,
  chestY: 6.4,
  croupY: -6.6,
  barrelHalfWidth: 2.7,
  barrelHalfHeight: 3.1,

  /** 胸围 / 腹胁 / 后臀三处横截面相对上面两个半径的倍率。 */
  girthScaleH: 1.14,
  girthScaleW: 0.94,
  flankScaleH: 0.88,
  flankScaleW: 0.94,
  haunchScaleH: 1.06,
  haunchScaleW: 1.12,

  shoulderY: 4.8,
  hipY: -5.0,
  frontSpread: 2.4,
  hindSpread: 2.7,

  frontUpper: 4.6,
  frontLower: 4.6,
  hindUpper: 4.9,
  hindLower: 4.9,
  legThickness: 2.15,

  // 短而粗、抬得高的脖子，配一颗紧凑的头。这两样随便拉长一点，轮廓就从战马变成长颈鹿。
  withersY: 4.4,
  withersZ: 11.6,
  pollY: 6.8,
  pollZ: 16.6,
  muzzleY: 10.6,
  muzzleZ: 13.4,
  neckThickness: 3.3,
  headThickness: 3.2,

  saddleY: -0.4,
  saddleZ: 12.6,

  // 尾根长在臀部**外面**，不在躯干里 —— 尾巴的第一节埋进身体是"看着像没有尾巴"的主因。
  tailBaseY: -5.4,
  tailBaseZ: 11.6,
  shadowRadius: 8.2,

  /** 每条腿的肩窝 / 髋窝。0 = 左前，1 = 右前，2 = 左后，3 = 右后。 */
  legRoot(leg: number): Vec3 {
    const front = leg < 2;
    const x = (leg % 2 === 0 ? -1 : 1) * (front ? this.frontSpread : this.hindSpread);
    return v3(x, front ? this.shoulderY : this.hipY, front ? this.backZ - 0.4 : this.backZ + 0.2);
  },

  upper(leg: number): number {
    return leg < 2 ? this.frontUpper : this.hindUpper;
  },
  lower(leg: number): number {
    return leg < 2 ? this.frontLower : this.hindLower;
  },
};

/** 一帧的坐骑姿势，全部在身体局部空间里。 */
export class HorsePose {
  chest: Vec3 = v3(0, HorseSpec.chestY, HorseSpec.backZ);
  croup: Vec3 = v3(0, HorseSpec.croupY, HorseSpec.backZ);
  withers: Vec3 = v3(0, HorseSpec.withersY, HorseSpec.withersZ);
  poll: Vec3 = v3(0, HorseSpec.pollY, HorseSpec.pollZ);
  muzzle: Vec3 = v3(0, HorseSpec.muzzleY, HorseSpec.muzzleZ);
  saddle: Vec3 = v3(0, HorseSpec.saddleY, HorseSpec.saddleZ);

  readonly hoof: Vec3[] = [v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0)];
  readonly knee: Vec3[] = [v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0)];

  /** 尾根加四节垂下来的尾。一截短桩读作没有尾巴。 */
  readonly tail: Vec3[] = [v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0)];

  /** 加在每个部件上的整体偏移 —— 躯干的起伏和左右摆。 */
  body: Vec3 = v3(0, 0, 0);

  solveLegs(): void {
    for (let i = 0; i < 4; i++) {
      const r = HorseSpec.legRoot(i);
      const root = v3(r.x + this.body.x, r.y + this.body.y, r.z + this.body.z);
      // 前腿的腕关节向后折、后腿的飞节向前折。正是这个相反的方向让四足动物读作马
      // 而不是一张桌子。
      const pole = i < 2 ? v3(0, -1, 0) : v3(0, 1, 0);
      this.knee[i] = solveTwoBoneIk(root, this.hoof[i], HorseSpec.upper(i), HorseSpec.lower(i), pole);
    }
  }
}

// 一个循环里四只蹄各自的落地相位，顺序是左前、右前、左后、右后。走是均匀的四拍；
// 疾驰把两对腿各自并到一起，腾空期就是从那儿来的。
const WALK_OFFSETS = [0, 0.5, 0.75, 0.25];
const GALLOP_OFFSETS = [0.1, 0, 0.6, 0.5];

const STRIDE_BASE = 3.2;
const STRIDE_PER_SPEED = 0.2;
const MAX_STRIDE = 9.5;
const GALLOP_THRESHOLD = 26;

/**
 * 四足步态。和双足是同一套想法：蹄子放在地上，身体跟着蹄子走。唯一真正的区别是四条腿需要
 * 一个落地顺序，而马按速度用两种不同的顺序。
 */
export class HorseAnimator {
  phase = 0;

  private galloping = false;
  private backward = false;
  private stride = 0;
  private lift = 0;
  private tailPhase = 0;

  /**
   * @param backward 这一帧在倒着走。骑手身上那个答案直接传下来（见 CharacterAnimator
   *                 .syncStepDirection）—— 人和马必须用同一个，否则马往前小跑、鞍上的人
   *                 在往后退。马自己不再判一次：它没有"朝向"这回事，它的朝向就是骑手的。
   */
  update(dt: number, speed: number, pose: HorsePose, backward = false): void {
    this.backward = backward;
    // 带回滞，免得速度刚好卡在阈值上时两种步态每帧互跳。
    if (this.galloping && speed < GALLOP_THRESHOLD * 0.75) this.galloping = false;
    else if (!this.galloping && speed > GALLOP_THRESHOLD) this.galloping = true;

    this.stride = clamp(STRIDE_BASE + speed * STRIDE_PER_SPEED, 0, MAX_STRIDE);
    this.lift = 0.6 + speed * 0.055;

    if (speed > 0.4 && this.stride > 0.01) this.phase = frac(this.phase + (speed / (2 * this.stride)) * dt);
    else this.phase = frac(this.phase + dt * 0.12);

    this.tailPhase += dt * (1.2 + speed * 0.05);

    const offsets = this.galloping ? GALLOP_OFFSETS : WALK_OFFSETS;
    const gait = clamp(speed / 12, 0, 1);

    for (let i = 0; i < 4; i++) {
      const root = HorseSpec.legRoot(i);
      const stand = v3(root.x, root.y * 0.92, 0);
      pose.hoof[i] = lerp3(stand, this.step(frac(this.phase + offsets[i]), root), gait);
    }

    // 躯干起伏：走的时候一个循环两次，疾驰时一次（身体跟着唯一那个腾空期起落）。
    const bobRate = this.galloping ? 1 : 2;
    const bob = -(0.3 + speed * 0.022) * gait * Math.cos(Math.PI * 2 * bobRate * this.phase);
    const sway = -0.3 * gait * Math.sin(Math.PI * 2 * this.phase);
    pose.body = v3(sway, 0, bob);

    const pitch = this.galloping ? 0.16 * Math.sin(Math.PI * 2 * this.phase) : 0;

    pose.chest = v3(pose.body.x, pose.body.y + HorseSpec.chestY, pose.body.z + HorseSpec.backZ + pitch * 2.2);
    pose.croup = v3(pose.body.x, pose.body.y + HorseSpec.croupY, pose.body.z + HorseSpec.backZ - pitch * 2.2);
    pose.withers = v3(pose.body.x, pose.body.y + HorseSpec.withersY, pose.body.z + HorseSpec.withersZ + pitch * 1.8);
    pose.saddle = v3(pose.body.x, pose.body.y + HorseSpec.saddleY, pose.body.z + HorseSpec.saddleZ);

    // 头颈随步态点动 —— 马的脑袋就是它的平衡杆。
    const nod = gait * (0.55 + speed * 0.02) * Math.sin(Math.PI * 2 * this.phase + 0.9);
    pose.poll = v3(pose.body.x, pose.body.y + HorseSpec.pollY + nod * 0.35, pose.body.z + HorseSpec.pollZ - nod);
    pose.muzzle = v3(
      pose.body.x,
      pose.body.y + HorseSpec.muzzleY + nod * 0.5,
      pose.body.z + HorseSpec.muzzleZ - nod * 1.5,
    );

    this.buildTail(pose, gait);
    pose.solveLegs();
  }

  /**
   * 站立的静止姿势。
   *
   * 倒地那一段每帧都要先跑一次它，理由和人那边 collapse 先调 buildLowerBody 一模一样：
   * **缓动的起点必须是干净的**。尸体在空中还会被整个掀飞一遍（Character.flingPose 会就地
   * 旋转每一个关节，马的关节也在里面），那一遍是加在上一帧的结果上的。不先抹回静止姿势的话，
   * 下一帧的 collapse 就是从"已经转过一次"的姿势再往下缓 —— 转角逐帧累加，马会在空中疯转。
   *
   * 不需要相位：gait 为 0 时步态项全是 0，所以这一副姿势是确定的。
   */
  static rest(pose: HorsePose): void {
    pose.body = v3(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const root = HorseSpec.legRoot(i);
      pose.hoof[i] = v3(root.x, root.y * 0.92, 0);
    }
    pose.chest = v3(0, HorseSpec.chestY, HorseSpec.backZ);
    pose.croup = v3(0, HorseSpec.croupY, HorseSpec.backZ);
    pose.withers = v3(0, HorseSpec.withersY, HorseSpec.withersZ);
    pose.saddle = v3(0, HorseSpec.saddleY, HorseSpec.saddleZ);
    pose.poll = v3(0, HorseSpec.pollY, HorseSpec.pollZ);
    pose.muzzle = v3(0, HorseSpec.muzzleY, HorseSpec.muzzleZ);

    // 尾巴垂着不摆：静止姿势里没有摆动这回事。步长和 buildTail 用的是同一组。
    let py = HorseSpec.tailBaseY;
    let pz = HorseSpec.tailBaseZ;
    pose.tail[0] = v3(0, py, pz);
    const step: [number, number][] = [
      [-2.0, -0.4],
      [-1.3, -2.5],
      [-0.3, -3.0],
      [0.3, -2.8],
    ];
    for (let i = 1; i < pose.tail.length; i++) {
      py += step[i - 1][0];
      pz += step[i - 1][1];
      pose.tail[i] = v3(0, py, pz);
    }

    pose.solveLegs();
  }

  /**
   * 马跟着骑手一起倒。和人是同一个手法：先照常搭一副站立姿势（见 rest），再把它朝一个躺姿
   * 缓过去 —— 躯干落到自己半个厚度的高度、腿折在身下、脖子平铺在地上。全程蹄子都在关节窝
   * 够得着的范围内，所以腿的 IK 一次都不会被截断。
   */
  static collapse(pose: HorsePose, t: number): void {
    HorseAnimator.rest(pose);
    const e = smoothStep(clamp(t, 0, 1));
    const drop = HorseSpec.backZ - HorseSpec.barrelHalfHeight * 0.95;

    pose.body = lerp3(pose.body, v3(0.6, 0, -drop), e);
    const body = pose.body;

    pose.chest = lerp3(pose.chest, v3(body.x, body.y + HorseSpec.chestY, body.z + HorseSpec.backZ), e);
    pose.croup = lerp3(pose.croup, v3(body.x, body.y + HorseSpec.croupY, body.z + HorseSpec.backZ), e);
    pose.withers = lerp3(pose.withers, v3(body.x, body.y + HorseSpec.withersY, body.z + HorseSpec.backZ + 0.6), e);
    pose.saddle = lerp3(pose.saddle, v3(body.x, body.y + HorseSpec.saddleY, body.z + HorseSpec.saddleZ), e);

    // 脖子和头是**摊在地上**的，不是照常抬着。
    pose.poll = lerp3(pose.poll, v3(body.x + 1.2, body.y + HorseSpec.pollY + 2.6, body.z + HorseSpec.backZ + 0.4), e);
    pose.muzzle = lerp3(
      pose.muzzle,
      v3(body.x + 2.2, body.y + HorseSpec.muzzleY + 3.4, body.z + HorseSpec.backZ - 1.4),
      e,
    );

    for (let i = 0; i < 4; i++) {
      const root = HorseSpec.legRoot(i);
      pose.hoof[i] = lerp3(pose.hoof[i], v3(root.x * 1.5, root.y * 0.55, 0.5), e);
    }

    for (let i = 0; i < pose.tail.length; i++) {
      const k = i / (pose.tail.length - 1);
      const flat = v3(
        body.x + k * 1.4,
        body.y + HorseSpec.tailBaseY - k * 5.5,
        body.z + HorseSpec.backZ - 1.2 - k * 1.0,
      );
      pose.tail[i] = lerp3(pose.tail[i], flat, e);
    }

    pose.solveLegs();
  }

  private step(phase: number, root: Vec3): Vec3 {
    const half = this.stride * 0.5;
    let y: number;
    let z: number;

    if (phase < 0.5) {
      y = lerp(half, -half, phase / 0.5);
      z = 0;
    } else {
      const t = (phase - 0.5) / 0.5;
      y = lerp(-half, half, smoothStep(t));
      z = this.lift * Math.sin(Math.PI * t);
    }

    // 蹄子落在身体底下一点，不是关节正下方。倒着走时迈步那条轴整个翻过来，和人一样。
    return v3(root.x * 0.92, root.y * 0.92 + (this.backward ? -y : y), z);
  }

  /**
   * 尾巴从尾根往后出去，再几乎垂到飞节。垂得够低这件事很要紧：短尾巴读作一截桩子，
   * 从后面看整只动物就不再像马了。
   */
  private buildTail(pose: HorsePose, gait: number): void {
    let px = pose.body.x;
    let py = pose.body.y + HorseSpec.tailBaseY;
    let pz = pose.body.z + HorseSpec.tailBaseZ;
    pose.tail[0] = v3(px, py, pz);

    // 先从尾根往后偏上，再一路甩下去。
    const step: [number, number][] = [
      [-2.0, -0.4],
      [-1.3, -2.5],
      [-0.3, -3.0],
      [0.3, -2.8],
    ];

    const swing = Math.sin(this.tailPhase) * (0.5 + gait * 0.9);
    const lift = gait * 0.9; // 动起来的马尾巴举得更高

    for (let i = 1; i < pose.tail.length; i++) {
      const t = i / (pose.tail.length - 1);
      const [dy, dz] = step[i - 1];
      px += swing * t;
      py += dy - lift * (1 - t) * 0.6;
      pz += dz + lift * (1 - t);
      pose.tail[i] = v3(px, py, pz);
    }
  }
}
