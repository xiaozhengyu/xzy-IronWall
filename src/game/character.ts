import { CharacterAnimator, attackDuration, attackImpact } from '../characters/animator';
import type { CharacterPalette } from '../characters/palette';
import { Pose, RigSpec } from '../characters/rig';
import type { UnitDef } from '../characters/unitDef';
import { clamp } from '../core/math';

/**
 * 场上一个活的单位：位置、朝向，加上它自己那一份姿势和动画状态。
 *
 * 姿势和动画器必须每人一份 —— 步态相位、呼吸、倒地进度都是各自独立的状态。而 UnitDef
 * 和调色板是共享的只读数据，一百个杂兵指向同一个 def 就够了。
 */

/** 倒地动作的长度，秒。 */
const COLLAPSE_TIME = 0.42;
/** 尸体躺在地上多久之后开始沉下去。 */
const CORPSE_HOLD = 1.8;
/** 沉入地面的时长。用压扁高度代替淡出 —— 渲染器没有整体透明度，而沉下去也更像回事。 */
const SINK_TIME = 0.5;

export class Character {
  readonly pose = new Pose();
  private readonly animator = new CharacterAnimator();

  x = 0;
  y = 0;
  /** 地面平面上的朝向角，和 Projector 用同一套。 */
  facing = 0;
  /** 当前移动速度，世界单位/秒。动画靠它决定走还是站。 */
  speed = 0;

  /** 攻击动作已经走过的秒数；负数表示没在攻击。 */
  attack = -1;
  /** 倒地已经走过的秒数；负数表示还活着。 */
  death = -1;
  /** 刚挨打的白光，0..1。 */
  hurt = 0;

  maxHp = 1;
  hp = 1;
  /** 距离下一次可以出手还有多少秒。 */
  attackCooldown = 0;

  // 倒向哪边，身体局部地面坐标。
  private fallX = 0;
  private fallY = -1;

  def: UnitDef;
  palette: CharacterPalette;
  /** 这个单位的标准步行速度，用来把 speed 归一化成步态。 */
  walkSpeed: number;

  constructor(def: UnitDef, palette: CharacterPalette, walkSpeed = 16) {
    this.def = def;
    this.palette = palette;
    this.walkSpeed = walkSpeed;
  }

  get alive(): boolean {
    return this.death < 0;
  }

  /** 步态循环位置，0..1。脚步特效靠它的跨越判断触地。 */
  get gaitPhase(): number {
    return this.animator.phase;
  }

  /** 已经该从场上清掉了。 */
  get gone(): boolean {
    return this.death >= COLLAPSE_TIME + CORPSE_HOLD + SINK_TIME;
  }

  /** 身体半径，用于分离和判定。 */
  get radius(): number {
    return RigSpec.hipHalfWidth * this.def.bulk * 1.15;
  }

  /** 开始一次攻击。已经在挥了、还在冷却、或者已经死了都忽略。 */
  swing(cooldown = 0): boolean {
    if (this.attack >= 0 || !this.alive || this.attackCooldown > 0) return false;
    this.attack = 0;
    this.attackCooldown = cooldown;
    return true;
  }

  /**
   * 挨一下。掉血、闪白光；血空了就倒。
   * @returns 这一下是否致命。
   */
  takeHit(fromX: number, fromY: number, damage = 1): boolean {
    if (!this.alive) return false;
    this.hp -= damage;
    this.hurt = 1;
    if (this.hp <= 0) {
      this.kill(fromX, fromY);
      return true;
    }
    return false;
  }

  /**
   * @param fromX/fromY 打击来自世界坐标的哪一点，决定往哪边倒。
   */
  kill(fromX: number, fromY: number): void {
    if (!this.alive) return;
    this.death = 0;
    this.attack = -1;
    this.speed = 0;

    // 背对打击方向倒下。转成身体局部坐标：y 是朝向，x 是右手边。
    let awayX = this.x - fromX;
    let awayY = this.y - fromY;
    const len = Math.hypot(awayX, awayY);
    if (len < 1e-4) {
      awayX = Math.cos(this.facing);
      awayY = Math.sin(this.facing);
    } else {
      awayX /= len;
      awayY /= len;
    }

    const sin = Math.sin(this.facing);
    const cos = Math.cos(this.facing);
    // forward = (cos, sin)，right = (sin, -cos)，和 Projector.ground 是同一组基。
    this.fallY = awayX * cos + awayY * sin;
    this.fallX = awayX * sin - awayY * cos;
    const fl = Math.hypot(this.fallX, this.fallY);
    if (fl > 1e-4) {
      this.fallX /= fl;
      this.fallY /= fl;
    } else {
      this.fallX = 0;
      this.fallY = -1;
    }
  }

  /**
   * 推进这一帧的动画。
   *
   * @param animate 画面外的单位传 false：计时（攻击、倒地、冷却）照常走，但跳过搭姿势
   *                和 IK —— 那是每个单位每帧最贵的一块，而且没人看得见。回到画面里时
   *                下一帧就重新算出正确的姿势，看不出接缝。
   * @returns 这一帧是否跨过了攻击的落点（也就是"这一下打出去了"）。
   */
  update(dt: number, animate = true): boolean {
    if (this.death >= 0) {
      this.death += dt;
      if (!animate) return false;
      this.animator.collapse(this.pose, this.def, clamp(this.death / COLLAPSE_TIME, 0, 1), this.fallX, this.fallY);

      // 躺够了就沉下去。压扁 z 而不是调透明度：渲染器没有整体 alpha，而且一具慢慢陷进
      // 草里的尸体比一具凭空消失的更像回事。
      const sinking = this.death - COLLAPSE_TIME - CORPSE_HOLD;
      if (sinking > 0) {
        const k = 1 - clamp(sinking / SINK_TIME, 0, 1);
        for (const j of [
          this.pose.hip, this.pose.chest, this.pose.head,
          this.pose.footL, this.pose.footR, this.pose.kneeL, this.pose.kneeR,
          this.pose.handL, this.pose.handR, this.pose.elbowL, this.pose.elbowR,
        ]) {
          j.z *= k;
        }
      }
      return false;
    }

    this.hurt = Math.max(0, this.hurt - dt * 4);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    let landed = false;
    let attackT = -1;
    if (this.attack >= 0) {
      const duration = attackDuration(this.def);
      const before = this.attack / duration;
      this.attack += dt;
      attackT = this.attack / duration;

      // 跨越检测，不是阈值比较：后者在落点之后的每一帧都为真，会连着触发一整串。
      const impact = attackImpact(this.def);
      if (before < impact && attackT >= impact) landed = true;

      if (attackT >= 1) {
        this.attack = -1;
        attackT = -1;
      }
    }

    if (animate) this.animator.update(dt, this.speed, this.walkSpeed, this.def, attackT, this.pose);
    return landed;
  }
}
