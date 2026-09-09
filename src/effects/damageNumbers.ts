import { clamp, v2 } from '../core/math';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 从头顶飘上去的扣血数字。
 *
 * 它补的是「这一下有多重」里唯一还缺的那一半。白光说"是他挨了"，碎片说"打碎了"，掀飞说
 * "打飞了"，但三者都不带刻度 —— 平砍和一发大招在画面上只差碎片多少。数字是刻度本身。
 *
 * 三条约束定了这个文件的样子：
 *
 *   **字要有像素感**。所以字模是自己烘的点阵，一个字模像素落在整数个缓冲像素上，跟着
 *   ShapeBatch 走同一条几何路 —— 不贴字体贴图，也不用 DOM 文本。整帧最后要被最近邻放大，
 *   任何非整数的字号都会在放大时抖出毛边，那正是"像素感"最先丢掉的地方。
 *
 *   **描边要自己烘**。画面上那圈暗边是 PixelSurface 在合成时对**整层的剪影**描的，所以数字
 *   压在人身上时，数字和人之间没有边 —— 而那恰恰是最需要边的时候（一个亮字压在亮盔甲上）。
 *   所以字模在烘的时候连描边一起烘：描边是字身按八邻域膨胀一圈再挖掉字身，两者一个像素都
 *   不重叠，于是整个数字可以整体半透明地化掉，而不会在接缝处叠出深浅。
 *
 *   **数字给掀飞让路**。人被掀飞，数字留在挨打的那一点往上飘 —— 跟着尸体飞的数字读作绑在
 *   人身上的标签，而这一下的信息属于"这里发生了什么"，不属于那具正在翻滚的尸体。但"留在
 *   原地"还不够：头顶那一格正是掀飞前半段轨迹扫过的地方，而被打飞的人本身就是这一下最好看
 *   的部分。所以数字往击飞的**反方向**让开一步，再淡入登场（见 BACK_OFF / FADE_IN）。
 *
 * 池子定长、定型数组、一个对象都不分配 —— 一次回旋能同时结算上百人，理由和 Debris 一样。
 */

/** 字模：5 宽 7 高。再窄（3×5）三位数还认得出，四位数就糊成一团；再宽开始像 UI 字体。 */
const GLYPH_W = 5;
const GLYPH_H = 7;
/** 字与字之间空一列。两边的描边各占一列，所以实际间距是三列，够把相邻两位分开。 */
const GLYPH_GAP = 1;

/**
 * 十个数字的点阵。
 *
 * 手写而不是拿系统字体栅格化：栅格化出来的 7 像素高数字，笔画粗细会随字形飘（"1" 细、
 * "8" 糊），而点阵字每一笔都正好一像素，十个字放在一起才是一套。
 */
const DIGIT_ROWS: readonly string[][] = [
  ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], // 0
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'], // 1
  ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], // 2
  ['11111', '00010', '00100', '00010', '00001', '10001', '01110'], // 3
  ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], // 4
  ['11111', '10000', '11110', '00001', '00001', '10001', '01110'], // 5
  ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], // 6
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'], // 7
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], // 8
  ['01110', '10001', '10001', '01111', '00001', '00010', '01100'], // 9
];

/** 一段连续的横向像素：字模第 y 行、从 x 起、w 个宽。画出来就是一个矩形。 */
interface Run {
  x: number;
  y: number;
  w: number;
}

interface Glyph {
  /** 字身。按行切成横条 —— 一个 "0" 是 8 个矩形，而不是 13 个像素方块。 */
  fill: Run[];
  /** 描边。膨胀一圈再挖掉字身，所以和 fill 一个像素都不重叠。 */
  edge: Run[];
}

/** 把一行按"这一格亮不亮"切成横条。 */
function rowRuns(y: number, lit: (x: number) => boolean, x0: number, x1: number, out: Run[]): void {
  let start = -1;
  for (let x = x0; x <= x1; x++) {
    const on = x < x1 && lit(x);
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      out.push({ x: start, y, w: x - start });
      start = -1;
    }
  }
}

/** 烘一个字模：字身横条 + 描边横条。模块加载时跑一次，十个字。 */
function bake(rows: readonly string[]): Glyph {
  const on = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < GLYPH_W && y < GLYPH_H && rows[y][x] === '1';

  const fill: Run[] = [];
  for (let y = 0; y < GLYPH_H; y++) rowRuns(y, (x) => on(x, y), 0, GLYPH_W, fill);

  // 八邻域膨胀：斜角也得有边，否则 "7" 的折角上会漏一个缺口，亮字压在亮甲上就断了。
  const edge: Run[] = [];
  for (let y = -1; y <= GLYPH_H; y++) {
    rowRuns(
      y,
      (x) => {
        if (on(x, y)) return false; // 字身自己不算描边，两者不重叠
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) if (on(x + dx, y + dy)) return true;
        }
        return false;
      },
      -1,
      GLYPH_W + 1,
      edge,
    );
  }
  return { fill, edge };
}

const GLYPHS: readonly Glyph[] = DIGIT_ROWS.map(bake);

/**
 * 池子容量。
 *
 * 一次回旋能同时杀上百人，但一百个数字同时飘在画面上已经读不成数字了 —— 它变成一片噪点。
 * 96 是"最狠的一下也基本全炸得出来"和"数字还是数字"之间的位置。满了直接丢新的，和碎片
 * 同一条策略：少一个数字没人数得出来。
 */
const CAPACITY = 96;

/** 活多久。够看清，又不至于上一轮还挂在天上时下一轮已经打出来了。 */
const LIFE = 0.78;
/** 到这个进度才开始化掉。一路变淡的数字有一半时间是看不清的。 */
const FADE_FROM = 0.55;

/** 往上飘多少个世界单位。人高 19，所以一次大约飘出半个身位。 */
const RISE = 11;
/** 左右各飘多少 —— 只为让同一堆里连着炸出来的几个数字不叠在一条竖线上。 */
const DRIFT = 4;

/**
 * 往击飞的反方向让开多少个世界单位。
 *
 * 人是从落点往外飞的，所以反方向那一侧**一定**是空出来的 —— 这不是赌一个方向，是跟着这一下
 * 自己的方向走。7 个单位约等于三分之一个身位：够把数字从飞行轨迹上挪开，又还贴着挨打的那
 * 个人，不至于读成旁边另一个人头上的数。
 */
const BACK_OFF = 7;

/**
 * 淡入多久，秒。
 *
 * 这是"压一点点时间"的柔和版：硬压 0.12 秒再瞬间亮起，数字自己会读成闪了一下；淡入则是
 * 那一段时间里画面上根本没有它，最爆的定格 + 起飞那几帧干干净净，等人飞开了字才浮出来。
 *
 * 淡入期间**位置不动**（见 draw 里的 riseT）：一边淡入一边上飘的话，字浮出来时已经飘到半空，
 * 和挨打的那个人对不上了。
 */
const FADE_IN = 0.13;

/** 头顶再往上一点点，别贴着头皮。头顶本身在 18.3（headZ 15.8 + headRadius 2.5）。 */
const HEAD_Z = 20.5;

/** 常规一下：上白下琥珀。竖直渐变是让点阵字读作"打出来的数字"而不是 UI 标签的关键一笔。 */
const TOP = rgb(255, 250, 232);
const BOTTOM = rgb(255, 186, 74);
/** 重击：同样的白起手，落到血橙。色相和常规那档拉得开，余光里就分得出轻重。 */
const CRIT_TOP = rgb(255, 252, 244);
const CRIT_BOTTOM = rgb(255, 96, 42);
/** 描边色。和 PixelSurface 那圈合成描边同一个色温，数字才像和画面烘在一起。 */
const EDGE = rgb(24, 18, 16);

/**
 * 数字压在场上所有东西之上，连降水也压过 —— 读数被谁挡住都等于没有，而人堆里随便一具站得
 * 更靠下的尸体、或者一场雨，都能把它吃掉。为什么是 DEPTH_OVERLAY 而不是随手一个大数，见
 * 那个常量自己的注释。
 */
const DEPTH_EDGE = Projector.DEPTH_OVERLAY + 20000;
const DEPTH_FILL = DEPTH_EDGE + 2;

/** 拆位用的暂存，最多六位。每帧几十个数字，不该为这个分配数组。 */
const digits = new Int32Array(6);

export interface DamageNumberOptions {
  crit?: boolean;
  /** 这个人被掀飞的去向。数字往它的反方向让开一步，见 BACK_OFF。 */
  dirX?: number;
  dirY?: number;
  /** 从多高冒出来，世界单位。默认头顶。 */
  z?: number;
}

export class DamageNumbers {
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly z = new Float32Array(CAPACITY);
  private readonly drift = new Float32Array(CAPACITY);
  private readonly age = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly value = new Int32Array(CAPACITY);
  private readonly crit = new Uint8Array(CAPACITY);

  private count = 0;

  /** 场上还飘着几个。 */
  get alive(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * 在 (x, y) 的头顶弹一个数字出来。
   *
   * @param options.crit      重击：字放大一倍、颜色更烫、活得久一点。
   * @param options.dirX/dirY 这个人被掀飞的去向（不用是单位向量，这里自己归一）。给了就往
   *                          它的反方向让开一步，把飞行轨迹让出来；不给就原地起。
   * @param options.z         从多高冒出来，世界单位。默认头顶。
   */
  spawn(x: number, y: number, value: number, options: DamageNumberOptions = {}): void {
    if (this.count >= CAPACITY) return;
    const i = this.count++;
    const crit = options.crit ?? false;
    // 反方向让开。方向是零向量（贴脸打的那种）时不让，随机漂移仍然会把它错开。
    const dx = options.dirX ?? 0;
    const dy = options.dirY ?? 0;
    const len = Math.hypot(dx, dy);
    this.x[i] = len > 1e-4 ? x - (dx / len) * BACK_OFF : x;
    this.y[i] = len > 1e-4 ? y - (dy / len) * BACK_OFF : y;
    this.z[i] = options.z ?? HEAD_Z;
    this.drift[i] = (Math.random() - 0.5) * 2 * DRIFT;
    this.age[i] = 0;
    this.life[i] = FADE_IN + LIFE * (crit ? 1.25 : 1) * (0.9 + Math.random() * 0.2);
    this.value[i] = Math.max(0, Math.round(value));
    this.crit[i] = crit ? 1 : 0;
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) this.swapRemove(i);
    }
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.z[i] = this.z[last];
    this.drift[i] = this.drift[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.value[i] = this.value[last];
    this.crit[i] = this.crit[last];
  }

  /**
   * @param camX/camY   镜头中心的世界地面坐标
   * @param rootX/rootY 那一点画在缓冲的哪个像素上
   * @param scale       每世界单位多少缓冲像素（grain）
   */
  draw(shapes: ShapeBatch, camX: number, camY: number, rootX: number, rootY: number, scale: number): void {
    // 一个字模像素占几个缓冲像素。**只取整数**，而且不跟着 grain 连续变：字模像素一旦落在
    // 半个缓冲像素上，最近邻放大就会把同样粗的笔画放成一粗一细。放到三倍颗粒度才跳一档。
    const base = Math.max(1, Math.min(4, Math.round(scale / 3)));

    for (let i = 0; i < this.count; i++) {
      const age = this.age[i];
      const life = this.life[i];
      const t = age / life;
      // 上飘从淡入结束才开始算 —— 淡入这一段人还在飞，数字定在原地浮出来。
      const riseT = clamp((age - FADE_IN) / Math.max(life - FADE_IN, 1e-4), 0, 1);
      // 起手窜得快、末尾几乎停住。匀速上升读作一个飘走的气球，而这一下是被打出来的。
      const ease = 1 - (1 - riseT) * (1 - riseT);
      const fadeIn = clamp(age / FADE_IN, 0, 1);
      const fadeOut = t < FADE_FROM ? 1 : 1 - (t - FADE_FROM) / (1 - FADE_FROM);
      const alpha = Math.round(255 * fadeIn * fadeOut);
      if (alpha <= 3) continue;

      const wx = this.x[i] + this.drift[i] * ease;
      const wz = this.z[i] + RISE * ease;
      const px = base * (this.crit[i] ? 2 : 1);

      // 拆位。低位先出，画的时候倒着走。
      let v = this.value[i];
      let n = 0;
      do {
        digits[n++] = v % 10;
        v = Math.floor(v / 10);
      } while (v > 0 && n < digits.length);

      // 整个数字的左上角，**取整到缓冲像素**。这一步是像素感的全部：不取整的话每帧的亚像素
      // 位置都不同，笔画会在上升途中自己抖起来。
      const spanX = (n * GLYPH_W + (n - 1) * GLYPH_GAP) * px;
      const sx = Math.round(rootX + (wx - camX) * scale - spanX * 0.5);
      const sy = Math.round(
        rootY + ((this.y[i] - camY) * Projection.groundSquash - wz * Projection.heightSquash) * scale - GLYPH_H * px,
      );

      const top = this.crit[i] ? CRIT_TOP : TOP;
      const bottom = this.crit[i] ? CRIT_BOTTOM : BOTTOM;
      const edge = rgba(EDGE.r, EDGE.g, EDGE.b, Math.round(alpha * 0.88));

      // 一行一个颜色：整个数字上白下暖，而不是每个字各渐变各的。
      const rowTint: Rgba[] = [];
      for (let r = 0; r < GLYPH_H; r++) {
        const k = r / (GLYPH_H - 1);
        rowTint.push(
          rgba(
            Math.round(top.r + (bottom.r - top.r) * k),
            Math.round(top.g + (bottom.g - top.g) * k),
            Math.round(top.b + (bottom.b - top.b) * k),
            alpha,
          ),
        );
      }

      for (let d = 0; d < n; d++) {
        const glyph = GLYPHS[digits[n - 1 - d]];
        const gx = sx + d * (GLYPH_W + GLYPH_GAP) * px;
        // 描边先铺，字身压上去。两者不重叠，所以整体化掉时接缝处不会叠深。
        for (const run of glyph.edge) this.blit(shapes, gx, sy, run, px, edge, DEPTH_EDGE);
        for (const run of glyph.fill) this.blit(shapes, gx, sy, run, px, rowTint[run.y], DEPTH_FILL);
      }
    }
  }

  /** 一条横条 —— 字模里一段连续的像素，画出来是一个轴对齐矩形。 */
  private blit(
    shapes: ShapeBatch,
    gx: number,
    gy: number,
    run: Run,
    px: number,
    color: Rgba,
    depth: number,
  ): void {
    const w = run.w * px;
    shapes.rect(v2(gx + run.x * px + w * 0.5, gy + run.y * px + px * 0.5), w, px, 0, color, depth);
  }
}
