import { type Vec3, V3_UNIT_Z, v3 } from '../core/math';
import { solveTwoBoneIk } from './twoBoneIk';

/**
 * 骨骼比例，单位是虚拟像素。整个人大约 19 单位高 —— 在 1 倍缩放下就是像素缓冲里的 19 px。
 * 移植自 overlord 的 RigSpec，数值一个没改：这些比例是被截图反复对出来的，改动任何一个
 * 都会让人物退回"卡通娃娃"。
 *
 * 局部空间是右手系、以身体为基准：X = 角色的右手边，Y = 面朝方向，Z = 上。
 */
export const RigSpec = {
  // 身高大致按 40% 腿 / 29% 躯干 / 31% 头颈 划分，总高约 18.8。
  // 最早胯放在 18.8 里的 5.0（腿只占 28%，躯干却差不多长了一倍），结果读起来像个坐在地上的人。
  hipZ: 7.6,

  /**
   * 外袍垂到胯下多少 —— 从胯量起，不是从地面。
   *
   * 躯干原本到胯关节就结束，整条腿光溜溜地挂在下面。从俯视角看这是错的读法：眼睛应该先
   * 撞上一整块结实的人，底下露一点腿，而不是一个方块架在两根杆子上。穿甲的人也不会露大腿，
   * 那儿总有袍子、战裙或者腿甲。
   */
  hemDrop: 3.1,
  hipHalfWidth: 2.05,
  thigh: 4.35,
  shin: 4.35,

  // 比看上去该有的更细。高度被压缩后腿在屏幕上变短了，宽度却没变，一条和长度差不多宽的
  // 大腿就是根香肠 —— 相机一抬高，这里是老卡通比例暴露得最厉害的地方。
  legThickness: 2.45,

  // 是靴子，不是小丑鞋。画成脚踝上的一个圆头，所以这个系数乘上小腿粗细就是它的全部。
  footThickness: 0.58,

  chestZ: 13.1,
  shoulderHalfWidth: 3.5,
  upperArm: 2.9,
  forearm: 2.9,

  // 前臂和拳头。手臂粗得跟大腿一样，是让人物读作玩偶而非人的主要原因；拳头也是从这里推的。
  armThickness: 1.85,

  // 躯干上的三个横截面，不是一个。从胯到胸一个胶囊就是个鸡蛋，而鸡蛋没有腰、没有肩、
  // 也没有臀 —— 这是身体读起来像一团东西的主要原因。
  torsoHalfWidth: 3.95,
  torsoHalfDepth: 2.5,
  waistHalfWidth: 3.15,
  waistHalfDepth: 2.0,
  pelvisHalfWidth: 3.65,
  pelvisHalfDepth: 2.45,

  /** 腰的收束点落在胯到胸之间的哪个位置。 */
  waistFrac: 0.4,

  headZ: 15.8,

  // 人群里眼睛数的是脑袋，所以头保持大方 —— 但和肩同宽的头骨是最响的卡通信号，
  // 而肩膀是左右各 3.5。
  headRadius: 2.5,

  shadowRadius: 5.4,

  get legLength(): number {
    return this.thigh + this.shin;
  },
  get armLength(): number {
    return this.upperArm + this.forearm;
  },
  get handRadius(): number {
    return this.armThickness * 0.46;
  },
};

/** 一帧的骨骼状态，全部在身体局部空间里。 */
export class Pose {
  hip: Vec3 = v3(0, 0, RigSpec.hipZ);
  chest: Vec3 = v3(0, 0, RigSpec.chestZ);
  /** 躯干绕 Z 的扭转（挥击的蓄力与收势）。 */
  spineYaw = 0;
  /** 前倾，弧度。 */
  spineLean = 0;

  footL: Vec3 = v3(0, 0, 0);
  footR: Vec3 = v3(0, 0, 0);
  kneeL: Vec3 = v3(0, 0, 0);
  kneeR: Vec3 = v3(0, 0, 0);
  handL: Vec3 = v3(0, 0, 0);
  handR: Vec3 = v3(0, 0, 0);
  elbowL: Vec3 = v3(0, 0, 0);
  elbowR: Vec3 = v3(0, 0, 0);
  head: Vec3 = v3(0, 0, RigSpec.headZ);

  /** 武器指向的单位向量。 */
  weaponDir: Vec3 = V3_UNIT_Z;
  /** 主手握在武器上的那个点。 */
  weaponGrip: Vec3 = v3(0, 0, 0);

  // 副手武器。只有双持的单位（UnitDef.dualWield）会用到，其余单位这两个字段是死的。
  // 没有做成"武器数组"是因为人只有两只手，而两只手的姿势从来不对称 —— 数组会立刻
  // 退化成 [0] 和 [1] 两个特例，不如直接写出来。
  offhandDir: Vec3 = V3_UNIT_Z;
  offhandGrip: Vec3 = v3(0, 0, 0);
  /** 0 = 弓弦静止，1 = 拉满。 */
  bowDraw = 0;
  showArrow = false;

  // 由步态动画写入、由渲染器消费的布料运动。放在身体局部空间里，斗篷才能在任何朝向上
  // 都正确地跟着人走。
  capeSwing = 0;
  capeTrail = 0;
  capeLift = 0;

  /** 胯部关节窝。 */
  hipSocket(side: number): Vec3 {
    const x = side === 0 ? -RigSpec.hipHalfWidth : RigSpec.hipHalfWidth;
    return { x: this.hip.x + x, y: this.hip.y, z: this.hip.z };
  }

  /** 肩关节窝，已经应用了脊柱扭转。 */
  shoulderSocket(side: number): Vec3 {
    const x = side === 0 ? -RigSpec.shoulderHalfWidth : RigSpec.shoulderHalfWidth;
    const cos = Math.cos(this.spineYaw);
    const sin = Math.sin(this.spineYaw);
    return { x: this.chest.x + x * cos, y: this.chest.y + x * sin, z: this.chest.z };
  }

  /** 跑两腿两臂的 IK，填出膝和肘。 */
  solveLimbs(): void {
    // 膝盖只朝正前方弯，外撇分量必须是 0：外撇会把膝盖顶到比胯还宽半个单位，而脚却收在
    // 胯的内侧 —— 膝外脚内正是罗圈腿的定义。侧面看不出来（那儿的外撇指向屏幕里），
    // 所以这个毛病只在朝着或背着镜头走的时候出现。
    this.kneeL = solveTwoBoneIk(this.hipSocket(0), this.footL, RigSpec.thigh, RigSpec.shin, v3(0, 1, 0));
    this.kneeR = solveTwoBoneIk(this.hipSocket(1), this.footR, RigSpec.thigh, RigSpec.shin, v3(0, 1, 0));

    // 肘朝后、并往外侧折。
    this.elbowL = solveTwoBoneIk(this.shoulderSocket(0), this.handL, RigSpec.upperArm, RigSpec.forearm, v3(-0.7, -1, -0.15));
    this.elbowR = solveTwoBoneIk(this.shoulderSocket(1), this.handR, RigSpec.upperArm, RigSpec.forearm, v3(0.7, -1, -0.15));
  }
}
