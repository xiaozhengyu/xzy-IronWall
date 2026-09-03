import { CharacterAnimator, attackDuration, attackImpact } from '../characters/animator';
import type { CharacterPalette } from '../characters/palette';
import { Pose, RigSpec } from '../characters/rig';
import type { UnitDef } from '../characters/unitDef';
import { clamp, type Vec3 } from '../core/math';

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

/**
 * 击飞。人死了不是原地软倒，是被打飞出去、翻一圈、砸在地上。
 *
 * 为什么选这个而不是原地倒地：这个尺寸下一个人只有二十来个像素高，几百人挤在一起时，
 * 一次原地的姿势变化几乎读不出来 —— 眼睛能在人堆里捕捉到的只有**位移**。击飞还顺带把
 * 技能的形状变成了看得见的事件：回旋放出去是一圈人向外飞，破空是一条走廊的人被推着走，
 * 不用看特效就知道自己刚打出了什么形状。
 *
 * 三个数一起定了一次击飞的样子：
 *   LAUNCH_OUT   水平速度。乘上滞空时间就是飞多远。
 *   LAUNCH_UP    起跳速度，决定飞多高、也决定滞空多久。
 *   GRAVITY      往下拽的加速度。这三个数只服务观感，和物理正确无关 —— 真实重力
 *                （按一个人 19 单位高折算）会让人像块砖一样砸下去，滞空短到看不清翻滚。
 *
 * **每个人各掷一次，不是所有人一个样。** 一排人被同一道波扫中，如果飞的高度和距离完全一致，
 * 看着像一块整体翻过去的板子；各飞各的高度才有炸开的感觉。当前档位：最高点 7～16 个世界
 * 单位（人高 19），滞空 0.6～0.93 秒，飞出 38～87 单位 —— 敌人间距约 11，也就是掀翻三到八排。
 */
const LAUNCH_OUT_MIN = 62;
const LAUNCH_OUT_MAX = 94;
const LAUNCH_UP_MIN = 46;
const LAUNCH_UP_MAX = 70;
const GRAVITY = 150;

/**
 * 滞空期间翻多少圈。
 *
 * 整数是关键：翻滚角按滞空进度线性推到 turns × 2π，落地那一刻正好是整圈的倍数，
 * 身体自然是平的。用"每秒转多少度"那种自由旋转的话，落地时身体停在一个随机角度上，
 * 得再补一段"转正"的过渡，而那段过渡在二十像素下看着就是尸体自己抽了一下。
 */
const TUMBLE_TURNS_MIN = 1;
const TUMBLE_TURNS_MAX = 2;

/** 轨迹线：留几个点、隔多久取一个。8 × 0.045 秒盖住约 0.36 秒，够画出弧线的形状。 */
const TRAIL_POINTS = 8;
const TRAIL_STEP = 0.045;

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

  /** 击飞的速度，世界单位/秒。落地清零。 */
  private velX = 0;
  private velY = 0;
  private velZ = 0;
  /** 离地高度，世界单位。0 = 已经落地。 */
  private airZ = 0;
  /** 在空中待了多久。躺够了要沉下去，那个计时得把滞空这段减掉，否则人还在天上就开始陷进地里。 */
  private airTime = 0;
  /** 这一次预计滞空多久。翻滚角按它归一化，才能落地正好是整圈。 */
  private flightSpan = 0;
  /** 这一次翻几圈。整数，落地才是平的。 */
  private turns = 1;

  /**
   * 击飞轨迹上最近的几个点，(x, y, z) 依次存放的环形缓冲。
   *
   * 定长的 Float32Array 而不是数组推入：场上随时有几百具尸体，每帧 push/shift 出来的垃圾
   * 比轨迹本身贵得多。画它的是 Scene —— 轨迹要跨世界坐标画，而人物渲染只认身体局部空间。
   */
  readonly trail = new Float32Array(TRAIL_POINTS * 3);
  /** 离地多高，世界单位。0 = 在地上。渲染器按它缩影子。 */
  get lift(): number {
    return this.airZ;
  }

  /** 已经存了几个点，最多 TRAIL_POINTS。 */
  trailCount = 0;
  /** 下一个写到哪儿（点的下标，不是浮点下标）。 */
  trailHead = 0;
  private trailClock = 0;

  maxHp = 1;
  hp = 1;
  /** 距离下一次可以出手还有多少秒。 */
  attackCooldown = 0;

  /**
   * 绕路时习惯往哪边让，+1 左 / -1 右。出生时掷一次，之后不变。
   *
   * 存在的理由是**别让方向每帧翻**：挡路的人正对着自己时，"往远离他的那边绕"没有答案 ——
   * 横向偏移在零附近抖，方向就一帧一个样，人在原地左右抽搐。给每个人一个固定的习惯，
   * 正面撞上时照着它走，看着也更像人：有人爱往左让，有人爱往右。
   */
  readonly sideBias: 1 | -1 = Math.random() < 0.5 ? -1 : 1;

  /**
   * 人群里"想走多快"的平滑值，0..1。由 Battle 每帧推进。
   *
   * 存在的理由是**前面那个人也在动**。挡路者自己的微动会让"我还能直着走多远"一进一出地翻，
   * 而直行和绕行的速度差了近十倍 —— 于是后排会出现每两三帧一次的 0.06↔0.25 步态跳变，
   * 看着就是个别人在原地抽搐。这类抖动来自邻居的位置噪声，调阈值消不掉，只能给意图加一个
   * 时间常数：认准要走多快之后，用零点几秒滑过去。
   */
  crowdPace = 0;

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
    return this.death - this.airTime >= COLLAPSE_TIME + CORPSE_HOLD + SINK_TIME;
  }

  /**
   * 命中和撞树用的半径。
   *
   * 用胯宽是对的：它判的是"够不够得着这个人"和"能不能从树旁边挤过去"，两件事都该按身体最
   * 窄处算，宽了会让人卡在明明过得去的缝里、也会让攻击白白变长。
   */
  get radius(): number {
    return RigSpec.hipHalfWidth * this.def.bulk * 1.15;
  }

  /**
   * 挤开旁人时的半径 —— 这个人在地上占掉多大一圈。
   *
   * 和 radius 分开是因为它们量的是两件事。radius 走的是胯宽（2.05），身上最窄的一处；拿它
   * 当人群间距的话，两个杂兵贴到 4.7 个单位就算"不重叠"了，而躯干光半宽就有 3.95、肩宽
   * 3.5，画出来是结结实实叠在一起的两个人 —— 人堆读不出数量，正是这个原因。
   *
   * 所以站位按躯干算。这不是把碰撞"调大一点"，是本来就该用另一个数。
   */
  get spacing(): number {
    return RigSpec.torsoHalfWidth * this.def.bulk;
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

    // 击飞速度存世界系（away 就是世界方向）；底下那组 fall 是身体局部系，给姿势用的。
    const out = LAUNCH_OUT_MIN + Math.random() * (LAUNCH_OUT_MAX - LAUNCH_OUT_MIN);
    const up = LAUNCH_UP_MIN + Math.random() * (LAUNCH_UP_MAX - LAUNCH_UP_MIN);
    this.turns = TUMBLE_TURNS_MIN + Math.floor(Math.random() * (TUMBLE_TURNS_MAX - TUMBLE_TURNS_MIN + 1));
    this.velX = awayX * out;
    this.velY = awayY * out;
    this.velZ = up;
    // 立刻离地一点点，否则第一帧 airZ 还是 0，会被判成已经落地。
    this.airZ = 0.001;
    this.airTime = 0;
    this.flightSpan = (2 * up) / GRAVITY;
    this.trailCount = 0;
    this.trailHead = 0;
    this.trailClock = 0;

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
   * 整具身体绕胯翻一下、再整个抬离地面。
   *
   * 转轴取"垂直于倒地方向的那条水平轴" —— 绕着侧向轴翻跟头，不是原地打转。原地打转（绕 z）
   * 在俯视角下几乎看不出来，人只是转了个身；俯仰翻滚会让头和脚在屏幕上上下交换位置，这才是
   * "被打飞"读得出来的那个动作。
   *
   * 翻滚和抬升合成一趟：两件事都要遍历全部关节，分开走等于把最贵的那部分做两遍。
   *
   * **不分配任何东西。** 这条路每帧要为画面里的每一具尸体跑一次，几百具就是几百次；用
   * `for (const j of [...])` 或者 Set 去重都会每帧扔掉一堆临时对象，而这个工程为了避开
   * 分配连 Graphics 那条路都拆了。所以关节是一个一个点名的，别名那两个单独判。
   */
  private flingPose(angle: number, height: number): void {
    const p = this.pose;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hip = p.hip;
    const hx = hip.x;
    const hy = hip.y;
    const hz = hip.z;

    const move = (j: Vec3): void => {
      const dx = j.x - hx;
      const dy = j.y - hy;
      const dz = j.z - hz;
      // 拆成"沿倒地方向"和"垂直于它"两份，只转前者和 z。
      const along = dx * this.fallX + dy * this.fallY;
      const sideX = dx - along * this.fallX;
      const sideY = dy - along * this.fallY;
      const along2 = along * cos - dz * sin;
      j.x = hx + sideX + this.fallX * along2;
      j.y = hy + sideY + this.fallY * along2;
      j.z = hz + along * sin + dz * cos + height;
    };

    // 十一个规范关节两两互不相同，可以放心逐个走。
    move(p.chest);
    move(p.head);
    move(p.footL);
    move(p.footR);
    move(p.kneeL);
    move(p.kneeR);
    move(p.handL);
    move(p.handR);
    move(p.elbowL);
    move(p.elbowR);

    // 握点通常和某只手指向**同一个** Vec3 对象（这是从 C# 移植过来时的老坑，animator.ts 里
    // applyStature 上面那段写了原委）。转两次的话角度和高度都会翻倍，所以只处理不是别名的。
    if (p.weaponGrip !== p.handR && p.weaponGrip !== p.handL) move(p.weaponGrip);
    if (p.offhandGrip !== p.handR && p.offhandGrip !== p.handL && p.offhandGrip !== p.weaponGrip) {
      move(p.offhandGrip);
    }

    // 胯自己：转不动（它是转轴原点），但要跟着抬。放在最后，前面所有人都以它的原位为基准。
    hip.z += height;

    // 武器指向是方向不是位置，只转不平移、也不抬 —— 否则身体翻过去了，剑还平躺着。
    const turn = (d: Vec3): void => {
      const along = d.x * this.fallX + d.y * this.fallY;
      const sideX = d.x - along * this.fallX;
      const sideY = d.y - along * this.fallY;
      const along2 = along * cos - d.z * sin;
      d.x = sideX + this.fallX * along2;
      d.y = sideY + this.fallY * along2;
      d.z = along * sin + d.z * cos;
    };
    turn(p.weaponDir);
    if (p.offhandDir !== p.weaponDir) turn(p.offhandDir);
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

      // 弹道。走在 animate 之外：画面外的人也得飞完这一程，否则镜头转回去时尸体还杵在
      // 原地，而它本该已经躺在三十个单位以外了。
      if (this.airZ > 0) {
        this.airTime += dt;
        this.velZ -= GRAVITY * dt;
        this.airZ += this.velZ * dt;
        this.x += this.velX * dt;
        this.y += this.velY * dt;

        // 隔一小段记一个点。每帧都记的话，帧率一变轨迹的疏密就跟着变。
        this.trailClock += dt;
        if (this.trailClock >= TRAIL_STEP) {
          this.trailClock = 0;
          const i = this.trailHead * 3;
          this.trail[i] = this.x;
          this.trail[i + 1] = this.y;
          this.trail[i + 2] = Math.max(0, this.airZ);
          this.trailHead = (this.trailHead + 1) % TRAIL_POINTS;
          if (this.trailCount < TRAIL_POINTS) this.trailCount++;
        }

        if (this.airZ <= 0) {
          this.airZ = 0;
          this.velX = 0;
          this.velY = 0;
          this.velZ = 0;
        }
      } else if (this.trailCount > 0) {
        // 落地之后轨迹一节一节褪掉，不是啪一下消失。
        this.trailClock += dt;
        if (this.trailClock >= TRAIL_STEP) {
          this.trailClock = 0;
          this.trailCount--;
        }
      }

      if (!animate) return false;
      this.animator.collapse(this.pose, this.def, clamp(this.death / COLLAPSE_TIME, 0, 1), this.fallX, this.fallY);

      // 翻滚 + 抬到空中。两件事都发生在 collapse 搭完姿势之后：collapse 给的是"躺平的
      // 那个样子"，这里把整具身体当成一个刚体去转、去抬。
      if (this.airZ > 0) {
        const spin =
          this.flightSpan > 0
            ? (this.turns * 2 * Math.PI * Math.min(this.airTime, this.flightSpan)) / this.flightSpan
            : 0;
        this.flingPose(spin, this.airZ);
      }

      // 躺够了就沉下去。压扁 z 而不是调透明度：渲染器没有整体 alpha，而且一具慢慢陷进
      // 草里的尸体比一具凭空消失的更像回事。
      //
      // 计时要扣掉滞空：不扣的话，一个飞得久的人还在天上就开始往下压扁。
      const sinking = this.death - this.airTime - COLLAPSE_TIME - CORPSE_HOLD;
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
