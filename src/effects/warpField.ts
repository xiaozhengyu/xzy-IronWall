import { Projection } from '../render/projection';

/**
 * 招式打过的地方，画面被拧一下。
 *
 * 这是这套渲染里**唯一**不靠画图元表达的效果。别的东西都是往 ShapeBatch 里塞四边形 ——
 * 弧、碎片、数字，全都是"多画一些东西上去"。而扭曲说的是另一件事：这块地方的画面**本身**
 * 被拧了一下。加多少个亮色的圈都表达不了它，因为观众要看到的正是被压弯的草、被拉长的人，
 * 而那些东西早就画完了。所以它只能发生在整帧合成之后，靠重采样：见 render/warpFilter.ts。
 *
 * 为什么值得为它开一条新路：横扫和回旋都是"原地打一下"，它们没有破空那种**飞出去的东西**
 * 可看。破空的破坏感一半来自那道波自己在跑，横扫和回旋只有一瞬间的弧，弧一散画面就干净了 ——
 * 干净正是问题所在。
 *
 * ## 扭曲发生在外围，不在中间
 *
 * 这是这个效果最重要的一条规矩，两次返工都栽在它上面。
 *
 * 一开始整片圆都在动，越靠中心越狠。听起来对（黑洞就该是那样），但放到游戏里是错的：招式
 * 的中心站着**玩家自己**，而他是这一屏里玩家唯一要盯着的东西。把他拧变形，读作画面坏了，
 * 不是有什么力量在那儿。
 *
 * 所以现在有两个独立的旋钮：
 *
 *   depth  整片的球面缩放。给 0 就是里面一动不动。
 *   edge   压在某一圈上的一条窄带，只有那条带上的像素动。
 *
 * 回旋只用 edge：它的扭曲要正好压在那圈冲击环上，环里面（也就是玩家站的地方）一个像素都
 * 不许动。横扫两个都用一点 —— 它的圆心甩在身前，玩家本来就不在里面。
 *
 * 存世界坐标不存屏幕坐标，理由和 ImpactEffects 一样：这一下是打在地上的，玩家走开之后它该
 * 留在原地，而不是跟着镜头飘。
 */

/**
 * 同时最多几个。
 *
 * 着色器里是一个定长循环，每多一枚就是全屏每像素多一轮 pow 和三角函数 —— 这是**填充率**
 * 开销，和场上有多少人无关，所以它必须有个死上限。4 够用：横扫的攻击间隔约半秒、一个活
 * 0.34 秒，连着挥也就叠两个；回旋再插一个，还剩一格余量。满了顶掉剩余寿命最短的那个
 * （见 spawn）—— 丢掉一个快消失的没人看得出来，丢掉刚打下去的那个所有人都看得出来。
 */
const MAX_LENSES = 4;

/** 起手有多快。0.12 是"一帧半就到底"，慢一点就读作水波而不是被打出来的一下。 */
const RISE = 0.12;

/** 一枚交给滤镜的透镜，全部是缓冲像素。滤镜只认这几个数，不认世界。 */
export interface WarpLens {
  /** 圆心落在缓冲的哪个像素上。 */
  x: number;
  y: number;
  /** 横竖两个半径。竖的短一截 —— 它躺在地上，和冲击环是同一个椭圆。 */
  rx: number;
  ry: number;
  /**
   * 整片的球面缩放强度，**有符号**：正 = 中间放大，负 = 外圈被压向中心。0 = 里面不动。
   *
   * 数值是重映射指数的对数偏置，见 warpFilter.ts 里的 pow。所以它不是"位移多少像素"，
   * 0.4 和 0.2 差的是一倍指数而不是一倍位移。
   */
  strength: number;
  /** 旋进：核心处画面被拧过多少弧度。正 = 画面逆时针转。同样是**中间**的事。 */
  swirl: number;
  /** 明暗，有符号：正 = 压暗，负 = 提亮。也是从中间往外衰减。 */
  tone: number;
  /** 那一圈亮边多亮。 */
  rim: number;
  /** 亮边和折射带压在归一化半径的哪一圈，以及那条带多窄。 */
  rimAt: number;
  rimSharp: number;
  /**
   * 那一圈上的折射量，按归一化半径。正 = 那一圈从更外面取样。
   *
   * 和 strength 分开是全部的意义所在，见文件顶上那段：想要"里面一动不动、就外围那一圈抖
   * 一下"，只有分开才给得出来。
   */
  edge: number;
}

export interface WarpOptions {
  /** 活多久，秒。 */
  life?: number;
  /** 整片缩放的峰值。0 = 里面一动不动。 */
  depth?: number;
  /** 旋进峰值，弧度。正是逆时针。里面不动的话这个也得是 0，它拧的是同一片。 */
  swirl?: number;
  /** 压暗峰值。同上，它也是从中间往外衰减的。 */
  dark?: number;
  /** 亮边峰值。 */
  rim?: number;
  /** 那一圈上的折射量，按归一化半径。0.12 = 那一圈按半径的一成二错开。 */
  edge?: number;
  /** 亮边／折射带压在归一化半径的哪一圈，以及多窄。 */
  rimAt?: number;
  rimSharp?: number;
  /** 起手半径占最终半径的比例。它是**张开**的，不是一上来就满。 */
  open?: number;
}

interface Lens {
  x: number;
  y: number;
  age: number;
  life: number;
  /** 最终半径，世界单位。 */
  radius: number;
  depth: number;
  swirl: number;
  dark: number;
  rim: number;
  edge: number;
  rimAt: number;
  rimSharp: number;
  open: number;
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
   * 在 (x, y) 打一下。
   *
   * @param radius 最终半径，世界单位。想让折射带压在某个画出来的圈上，就让这两者的**比**
   *               恒等于 rimAt —— 回旋就是这么对上冲击环的，见 castRing。
   */
  spawn(x: number, y: number, radius: number, options: WarpOptions = {}): void {
    const lens: Lens = {
      x,
      y,
      age: 0,
      life: options.life ?? 0.4,
      radius,
      depth: options.depth ?? 0.17,
      swirl: options.swirl ?? 1.05,
      dark: options.dark ?? 0.46,
      rim: options.rim ?? 0.4,
      edge: options.edge ?? 0,
      rimAt: options.rimAt ?? 0.62,
      rimSharp: options.rimSharp ?? 5,
      open: options.open ?? 0.55,
    };
    if (this.lenses.length < MAX_LENSES) {
      this.lenses.push(lens);
      return;
    }
    // 满了：顶掉**剩余寿命最短**的那个。按强度挑会把一个刚打下去、还没涨起来的新的误判成弱者。
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
   * 把还活着的换算成缓冲像素，交给滤镜。
   *
   * 参数和别的效果的 draw 一样（镜头中心、投影原点、颗粒度），因为它们说的是同一次投影。
   *
   * @returns 复用的数组，别存着 —— 下一帧就被原地覆盖了。
   */
  collect(camX: number, camY: number, rootX: number, rootY: number, grain: number): readonly WarpLens[] {
    this.active.length = 0;
    for (const lens of this.lenses) {
      const t = lens.age / lens.life;
      // 猛地打下去，再松开。慢起手会让它读作"有什么东西正在浮上来"，方向正好反了。
      const env = t < RISE ? t / RISE : Math.pow(1 - (t - RISE) / (1 - RISE), 1.7);
      // 三次 easeOut，起手最快。和冲击弧的推进曲线是同一条（见 frontRadius）—— 必须是
      // 同一条，折射带才跟得住那个圈；差一点点，带子就会从环上滑下来。
      const ease = 1 - (1 - t) * (1 - t) * (1 - t);
      const radius = lens.radius * (lens.open + (1 - lens.open) * ease);

      const o = this.pool[this.active.length];
      o.strength = -lens.depth * env;
      o.swirl = lens.swirl * env;
      o.tone = lens.dark * env;
      o.rim = lens.rim * env;
      o.edge = lens.edge * env;
      o.rimAt = lens.rimAt;
      o.rimSharp = lens.rimSharp;
      // 三条通道都弱到看不见了就别占一个循环槽 —— 着色器里每一枚都是全屏的代价。
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
      o.ry = radius * grain * Projection.groundSquash;
    }
    return this.active;
  }
}
