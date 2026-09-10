import { Projection } from '../render/projection';

/**
 * 砸在地上的那个"洞"：一小片被吸进去的画面。
 *
 * 这是这套渲染里**唯一**不靠画图元表达的效果。别的东西都是往 ShapeBatch 里塞四边形 ——
 * 弧、碎片、数字，全都是"多画一些东西上去"。而扭曲说的是另一件事：这块地方的画面**本身**
 * 被拧了一下。加多少个亮色的圈都表达不了它，因为观众要看到的正是被压弯的草、被拉长的人，
 * 而那些东西早就画完了。所以它只能发生在整帧合成之后，靠重采样：见 render/warpFilter.ts。
 *
 * 为什么值得为它开一条新路：横扫和回旋都是"原地打一下"，它们没有破空那种**飞出去的东西**
 * 可看。破空的破坏感一半来自那道波自己在跑，横扫和回旋只有一瞬间的弧，弧一散画面就干净了 ——
 * 干净正是问题所在。地上留一个正在合拢的洞，就是给这两招补上"这里刚刚发生过事"的那半秒。
 *
 * 存世界坐标不存屏幕坐标，理由和 ImpactEffects 一样：洞是砸在地上的，玩家走开之后它该留在
 * 原地，而不是跟着镜头飘。
 *
 * ## 两种形状
 *
 * dent（默认）  一个塌陷的坑：猛地凹下去，再松开。横扫用的是它 —— 一刀甩过去，地上留个印子。
 * implosion     一个球：四周先被抽向中心、越缩越紧，然后炸开。回旋用的是它。给 burst 一个
 *               正数就切到这一档。
 *
 * 两者的区别不只是参数，是**时间上有没有一个转折点**。坑只有一条衰减曲线，球有两段：吸和炸。
 * 而"先吸后炸"正是爆炸在画面上唯一说得清的写法 —— 直接放大只读作镜头推近，先收一下再放，
 * 眼睛才知道刚才有东西在这儿憋住了。
 */

/**
 * 同时最多几个洞。
 *
 * 着色器里是一个定长循环，每多一枚就是全屏每像素多一轮 pow 和三角函数 —— 这是**填充率**
 * 开销，和场上有多少人无关，所以它必须有个死上限。4 够用：横扫的攻击间隔约半秒、坑活 0.34
 * 秒，连着挥也就叠两个；回旋再插一个，还剩一格余量。满了顶掉剩余寿命最短的那个（见 spawn）——
 * 丢掉一个快消失的洞没人看得出来，丢掉刚砸下去的那个所有人都看得出来。
 */
const MAX_LENSES = 4;

/** 坑塌陷有多快。0.12 是"一帧半就到底"，慢一点就读作水波而不是被砸出来的坑。 */
const RISE = 0.12;

/**
 * 球在整条命里，前多少比例是"吸"。
 *
 * 0.32 之后立刻翻成炸，中间**不留过渡**。这个跳变是故意的：它就是"爆"的那一帧。给它一段
 * 平滑过渡的话，吸力先降到零、再慢慢长出推力，画面上是一次停顿 —— 而爆炸没有停顿。
 */
const IMPLODE_UNTIL = 0.32;

/**
 * 亮边压在归一化半径的哪一圈、多锐。坑贴着内侧，球贴着壳。
 *
 * 球那一圈给 0.87 是对着**画出来的那个光圈**：castRing 里冲击环的终点是 reach /
 * SKILL_HIT_MARGIN，而球的半径就是 reach，两者的比正好是 1/1.15 ≈ 0.87。折射带压在那儿，
 * 玩家看到的就是"光圈边缘被拧了一下"，而不是"旁边还有一圈别的东西"。
 *
 * 球那条带比坑锐得多（13 对 5），是为了让它在 r = 1 之前就衰减干净。带子如果在球的外沿还有
 * 余量，边界上就会留一道几像素的硬台阶 —— 那读作画面被切了一刀，不是一层壳。
 */
const DENT_RIM_AT = 0.62;
const DENT_RIM_SHARP = 5;
const SPHERE_RIM_AT = 0.87;
const SPHERE_RIM_SHARP = 13;

/** 一枚交给滤镜的透镜，全部是缓冲像素。滤镜只认这几个数，不认世界。 */
export interface WarpLens {
  /** 圆心落在缓冲的哪个像素上。 */
  x: number;
  y: number;
  /** 横竖两个半径。相等就是正圆（球），竖的短一截就是躺在地上的坑。 */
  rx: number;
  ry: number;
  /**
   * 球面重映射的强度，**有符号**：正 = 炸出来（中间放大），负 = 缩进去（外圈被抽向中心）。
   *
   * 数值是重映射指数的对数偏置，见 warpFilter.ts 里的 pow。所以它不是"位移多少像素"，
   * 0.8 和 0.4 差的是一倍指数而不是一倍位移。
   */
  strength: number;
  /** 旋进：核心处画面被拧过多少弧度。正 = 画面逆时针转。 */
  swirl: number;
  /** 明暗，有符号：正 = 压暗（憋住了），负 = 提亮（炸开了）。 */
  tone: number;
  /** 亮边多亮。 */
  rim: number;
  /** 亮边压在归一化半径的哪一圈，以及多锐。 */
  rimAt: number;
  rimSharp: number;
  /**
   * 亮边那一圈上的折射量，按归一化半径。正 = 那一圈从更外面取样。
   *
   * 和 strength 分开是因为它们说的是两件事：strength 拧的是**整片**（缩放），edge 只拧
   * 光圈边缘那一条带。想要"里面几乎不动、就边上抖一下"，只有分开才给得出来。
   */
  edge: number;
}

export interface WarpOptions {
  /** 活多久，秒。 */
  life?: number;
  /** 吸力峰值。 */
  depth?: number;
  /**
   * 炸开的峰值。> 0 就从"坑"切成"球"：先吸后炸。
   *
   * 0（默认）是坑，只有吸，一路衰减到没。
   */
  burst?: number;
  /** 旋进峰值，弧度。正是逆时针。 */
  swirl?: number;
  /** 憋住那一下压暗多少。 */
  dark?: number;
  /** 炸开那一下提亮多少。只有球用得上。 */
  flash?: number;
  /** 亮边峰值。 */
  rim?: number;
  /** 亮边那一圈上的折射量，按归一化半径。0.05 = 那一圈按半径的百分之五错开。 */
  edge?: number;
  /** 坑的起手半径占最终半径的比例。坑是**张开**的，不是一上来就满。 */
  open?: number;
  /** 球缩到最紧时有多小、炸到最开时有多大，都按最终半径的比例。 */
  shrink?: number;
  grow?: number;
  /**
   * 竖向压扁多少。默认按地面投影压 —— 坑是躺在地上的。
   *
   * 球要给 1：球在画面上是**正圆**，压扁了就又躺回地上去了，读作一摊水而不是一个憋住的球。
   */
  squash?: number;
}

interface Lens {
  x: number;
  y: number;
  age: number;
  life: number;
  /** 最终半径，世界单位。 */
  radius: number;
  depth: number;
  burst: number;
  swirl: number;
  dark: number;
  flash: number;
  rim: number;
  edge: number;
  open: number;
  shrink: number;
  grow: number;
  squash: number;
}

export class WarpField {
  private readonly lenses: Lens[] = [];
  /** 交出去的那份，复用不重建：每帧都要一份，而它每帧都一样长。 */
  private readonly pool: WarpLens[] = Array.from({ length: MAX_LENSES }, () => ({
    x: 0,
    y: 0,
    rx: 0,
    ry: 0,
    strength: 0,
    swirl: 0,
    tone: 0,
    rim: 0,
    rimAt: 0,
    rimSharp: 1,
    edge: 0,
  }));
  /** 这一帧真正交出去的那几个，装的是 pool 里的引用，所以清空重填不分配。 */
  private readonly active: WarpLens[] = [];

  get count(): number {
    return this.lenses.length;
  }

  clear(): void {
    this.lenses.length = 0;
  }

  /**
   * 在 (x, y) 砸一个洞。
   *
   * @param radius 最终半径，世界单位。给判定半径就对了 —— 扭曲的范围和"这一下打到哪儿"
   *               是同一件事，两者对不上时玩家会觉得洞是另一个招放的。
   */
  spawn(x: number, y: number, radius: number, options: WarpOptions = {}): void {
    const lens: Lens = {
      x,
      y,
      age: 0,
      life: options.life ?? 0.4,
      radius,
      depth: options.depth ?? 0.17,
      burst: options.burst ?? 0,
      swirl: options.swirl ?? 1.05,
      dark: options.dark ?? 0.46,
      flash: options.flash ?? 0.45,
      rim: options.rim ?? 0.4,
      edge: options.edge ?? 0,
      open: options.open ?? 0.55,
      shrink: options.shrink ?? 0.5,
      grow: options.grow ?? 1.2,
      squash: options.squash ?? Projection.groundSquash,
    };
    if (this.lenses.length < MAX_LENSES) {
      this.lenses.push(lens);
      return;
    }
    // 满了：顶掉**剩余寿命最短**的那个。按强度挑会把一个刚砸下去、还没涨起来的新洞误判成弱者。
    let worst = 0;
    let worstLeft = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.lenses.length; i++) {
      const left = this.lenses[i].life - this.lenses[i].age;
      if (left < worstLeft) {
        worstLeft = left;
        worst = i;
      }
    }
    this.lenses[worst] = lens;
  }

  update(dt: number): void {
    for (let i = this.lenses.length - 1; i >= 0; i--) {
      const lens = this.lenses[i];
      lens.age += dt;
      if (lens.age < lens.life) continue;
      this.lenses[i] = this.lenses[this.lenses.length - 1];
      this.lenses.pop();
    }
  }

  /**
   * 把还活着的洞换算成缓冲像素，交给滤镜。
   *
   * 参数和别的效果的 draw 一样（镜头中心、投影原点、颗粒度），因为它们说的是同一次投影。
   *
   * @returns 复用的数组，别存着 —— 下一帧就被原地覆盖了。
   */
  collect(camX: number, camY: number, rootX: number, rootY: number, grain: number): readonly WarpLens[] {
    this.active.length = 0;
    for (const lens of this.lenses) {
      const o = this.pool[this.active.length];
      const radius = lens.burst > 0 ? this.shapeSphere(lens, o) : this.shapeDent(lens, o);
      // 三个通道都已经弱到看不见了就别占一个循环槽 —— 着色器里每一枚都是全屏的代价。
      if (
        Math.abs(o.strength) < 0.004 &&
        Math.abs(o.edge) < 0.002 &&
        o.rim < 0.01 &&
        Math.abs(o.tone) < 0.01
      ) {
        continue;
      }

      this.active.push(o);
      o.x = rootX + (lens.x - camX) * grain;
      o.y = rootY + (lens.y - camY) * Projection.groundSquash * grain;
      o.rx = radius * grain;
      o.ry = radius * grain * lens.squash;
    }
    return this.active;
  }

  /** 坑：猛地凹下去，再松开。@returns 这一帧的半径，世界单位。 */
  private shapeDent(lens: Lens, out: WarpLens): number {
    const t = lens.age / lens.life;
    // 慢起手会让它读作"有什么东西正在浮上来"，方向正好反了。
    const env = t < RISE ? t / RISE : Math.pow(1 - (t - RISE) / (1 - RISE), 1.7);
    // 三次 easeOut，起手最快。和冲击弧的推进曲线是同一个手感（见 frontRadius）。
    const ease = 1 - (1 - t) * (1 - t) * (1 - t);

    out.strength = -lens.depth * env;
    out.swirl = lens.swirl * env;
    out.tone = lens.dark * env;
    out.rim = lens.rim * env;
    out.edge = lens.edge * env;
    out.rimAt = DENT_RIM_AT;
    out.rimSharp = DENT_RIM_SHARP;
    return lens.radius * (lens.open + (1 - lens.open) * ease);
  }

  /** 球：四周被抽向中心、越缩越紧，然后炸开。@returns 这一帧的半径，世界单位。 */
  private shapeSphere(lens: Lens, out: WarpLens): number {
    const t = lens.age / lens.life;
    out.rimAt = SPHERE_RIM_AT;
    out.rimSharp = SPHERE_RIM_SHARP;

    if (t < IMPLODE_UNTIL) {
      // 吸。指数 0.6 让吸力起手就很凶，越往后越接近满 —— 憋住的过程该是"越来越紧"，
      // 而不是匀速收。
      const u = t / IMPLODE_UNTIL;
      const grip = Math.pow(u, 0.6);
      out.strength = -lens.depth * grip;
      out.swirl = lens.swirl * grip;
      out.tone = lens.dark * grip;
      out.rim = lens.rim * grip * 0.7;
      // 憋住的时候边缘往里收，和整片的吸向同一边。
      out.edge = -lens.edge * grip;
      // 球本身也在缩。光靠取样偏移不够 —— 边缘那圈亮壳必须真的往里收，
      // 眼睛才看得到"它变小了"。
      return lens.radius * (1 - (1 - lens.shrink) * u);
    }

    // 炸。强度、亮度都从满值往下掉，而半径反过来往外冲 —— 一边散一边铺开，
    // 这个反向正是"炸开"和"关掉"的区别。
    const u = (t - IMPLODE_UNTIL) / (1 - IMPLODE_UNTIL);
    const fade = (1 - u) * (1 - u);
    out.strength = lens.burst * fade;
    // 旋进跟着翻向：憋住时往里绞，炸开时反着甩出去。
    out.swirl = -lens.swirl * fade * 0.6;
    // 亮得比推力更短：闪光是一瞬的事，冲击波要多推一会儿。
    out.tone = -lens.flash * fade * (1 - u);
    out.rim = lens.rim * fade;
    // 炸开时边缘翻向外，这是冲击波过境时那一下抖动。
    out.edge = lens.edge * fade;
    const outward = 1 - (1 - u) * (1 - u) * (1 - u);
    return lens.radius * (lens.shrink + (lens.grow - lens.shrink) * outward);
  }
}
