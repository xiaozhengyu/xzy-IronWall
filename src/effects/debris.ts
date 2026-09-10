import type { CharacterPalette } from '../characters/palette';
import { v2 } from '../core/math';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 被技能打碎的那一下：血珠和甲片。
 *
 * 存在的理由是**分辨力**。击飞已经让人看得出"有人死了、往哪边飞"，但看不出"这一下有多重"。
 * 平砍和一发破空打在同一个人身上，飞出去的样子是一样的。碎片补的正是这个差别：溅出来的
 * 东西越多，这一下越狠。
 *
 * 两种碎片各干一件事：
 *   血珠  暗红的小点，撒得散、消失得快。它是"打中了"的即时反馈，颜色和草地反差最大。
 *   甲片  钢色的小方块，飞得慢、会落地、躺一会儿再没。它是"打碎了"的证据，也是唯一能
 *         让一次重击在画面上留下痕迹的东西。
 *
 * 定长的池子 + 定型数组，一个对象都不分配：一次回旋能同时杀掉上百人，如果每个人溅十几个
 * 粒子对象出来，光是这一下产生的垃圾就够卡一帧。满池后血珠直接丢弃，甲片则轮转覆盖旧粒子：
 * 总图元数不变，但这次技能打碎敌人的证据不能被上一蓬短命血珠吃掉。
 */

/**
 * 池子容量。
 *
 * 一次回旋能同时杀上百人，每人溅三十来片，峰值就是三千多。给满会让一次群杀之后场上飘着
 * 三千个方块，既没必要也拖帧；给 2600 是让**大部分**那一下能完整炸出来。达到上限后不再加
 * 图元，但新甲片会替掉旧粒子，让同一帧被回旋扫中的整圈敌人都能留下破碎反馈。
 */
const CAPACITY = 2600;

const KIND_BLOOD = 0;
const KIND_SHARD = 1;

/** 重力。比人的击飞重（那边是 250）—— 小块东西该落得更急，不然像在水里飘。 */
const GRAVITY = 380;

/** 血珠活多久、甲片活多久。血是一瞬的事，甲片要留下来才算“碎了”。 */
const BLOOD_LIFE = 0.42;
const SHARD_LIFE = 1.15;

/** 血色。调色板里没有 —— 它不属于任何一种材质，是打出来的东西。 */
const BLOOD = rgb(138, 26, 26);
const BLOOD_DARK = rgb(78, 14, 16);

export class Debris {
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly z = new Float32Array(CAPACITY);
  private readonly vx = new Float32Array(CAPACITY);
  private readonly vy = new Float32Array(CAPACITY);
  private readonly vz = new Float32Array(CAPACITY);
  private readonly age = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly size = new Float32Array(CAPACITY);
  /** 甲片的长宽比和旋转。血珠不用（它是圆点，转不转都一样）。 */
  private readonly aspect = new Float32Array(CAPACITY);
  private readonly spin = new Float32Array(CAPACITY);
  private readonly angle = new Float32Array(CAPACITY);
  private readonly kind = new Uint8Array(CAPACITY);
  /** 甲片各自的颜色（钢、皮、布都可能），血珠不用。 */
  private readonly tint: Rgba[] = new Array(CAPACITY);

  private count = 0;
  /** 满池后新甲片轮转写入的位置。无需搜索，因此百人同帧死亡仍是常数开销。 */
  private shardAt = 0;

  /** 场上还剩多少片。 */
  get alive(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
    this.shardAt = 0;
  }

  /**
   * 在 (x, y) 炸开一蓬。
   *
   * @param dirX/dirY 打击的去向（也就是人被掀飞的方向）。碎片整体偏向这一边，但张得很开 ——
   *                  完全沿一个方向喷读作喷泉，完全均匀又读作烟花，两者都不像被打碎。
   * @param power     1 = 平砍，2 = 技能。只影响数量和初速，不影响样子。
   */
  burst(x: number, y: number, dirX: number, dirY: number, power: number, palette: CharacterPalette): void {
    // 数量翻了一倍多。原来一次技能命中是 14 血 + 6 片，在满屏都是人的画面里几乎看不出
    // "炸开了" —— 十几个小方块散在一个人身上，读作被打了一下，不是被打碎了。
    const blood = Math.round(9 + 11 * power);
    const shards = Math.round(power >= 2 ? 8 + 8 * (power - 1) : 2);

    for (let i = 0; i < blood; i++) this.emit(x, y, dirX, dirY, power, KIND_BLOOD, palette);
    for (let i = 0; i < shards; i++) this.emit(x, y, dirX, dirY, power, KIND_SHARD, palette);
  }

  private emit(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    power: number,
    kind: number,
    palette: CharacterPalette,
  ): void {
    let i: number;
    if (this.count < CAPACITY) {
      i = this.count++;
    } else {
      // 血珠只负责瞬时命中感，满池后可以舍弃；甲片承担“敌人被打碎”的信息，必须让新技能
      // 写进来。轮转覆盖避免扫描 2600 个槽，也让回旋的碎片分布到整圈命中点。
      if (kind === KIND_BLOOD) return;
      i = this.shardAt;
      this.shardAt = (this.shardAt + 1) % CAPACITY;
    }

    // 方向：以打击方向为中心撒开一个很宽的扇面，再各自掷一个速度。
    const spread = kind === KIND_BLOOD ? 1.5 : 1.1;
    const a = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 2 * spread;
    const speed = (kind === KIND_BLOOD ? 26 + Math.random() * 46 : 18 + Math.random() * 30) * (0.7 + 0.5 * power);

    this.x[i] = x;
    this.y[i] = y;
    // 从胸口高度溅出来，不是从脚下 —— 从地面冒出来的血读作地上的水坑被踩了一脚。
    this.z[i] = 7 + Math.random() * 5;
    this.vx[i] = Math.cos(a) * speed;
    this.vy[i] = Math.sin(a) * speed;
    this.vz[i] = 34 + Math.random() * 52;
    this.age[i] = 0;
    this.kind[i] = kind;

    this.aspect[i] = 1;
    this.spin[i] = 0;
    this.angle[i] = 0;

    if (kind === KIND_BLOOD) {
      this.life[i] = BLOOD_LIFE * (0.7 + Math.random() * 0.6);
      this.size[i] = 0.5 + Math.random() * 0.7;
      this.tint[i] = Math.random() < 0.5 ? BLOOD : BLOOD_DARK;
    } else {
      this.life[i] = SHARD_LIFE * (0.75 + Math.random() * 0.5);
      // 大小拉开档次，还有一成是**大块**。清一色的小方块读作噪点；中间混几块明显更大的，
      // 眼睛才会把它读成"从这人身上崩下来的东西"。
      const big = Math.random() < 0.1;
      this.size[i] = big ? 2.1 + Math.random() * 1.3 : 0.8 + Math.random() * 1.0;
      // 甲片是片不是块：长宽比拉开，再给一个自转。翻着飞的薄片比不动的方块像碎片得多，
      // 而这里的代价只是每片多存两个数 —— rect 本来就收一个旋转角。
      this.aspect[i] = 0.35 + Math.random() * 0.5;
      this.angle[i] = Math.random() * Math.PI;
      this.spin[i] = (Math.random() - 0.5) * 26;
      // 甲片取自死者身上真实用到的材质，所以一个布衣杂兵炸出来的是布片不是钢片。
      const r = Math.random();
      this.tint[i] = r < 0.55 ? palette.steel : r < 0.8 ? palette.leather : palette.cloth;
    }
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.spin[i] !== 0) this.angle[i] += this.spin[i] * dt;

      if (this.z[i] > 0) {
        this.vz[i] -= GRAVITY * dt;
        this.z[i] += this.vz[i] * dt;
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
        if (this.z[i] <= 0) {
          this.z[i] = 0;
          // 落地就停住。弹跳看着更"物理"，但几百片一起弹是一地跳蚤。
          this.vx[i] = 0;
          this.vy[i] = 0;
          this.vz[i] = 0;
          // 血落地就没了：地上留一摊需要另一套（贴在地面、跟着地形），不是粒子该干的事。
          if (this.kind[i] === KIND_BLOOD) this.age[i] = this.life[i];
          // 落地的甲片停止翻滚，躺在地上等着淡掉。
          this.spin[i] = 0;
        }
      }

      if (this.age[i] >= this.life[i]) this.swapRemove(i);
    }
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.z[i] = this.z[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.vz[i] = this.vz[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size[i] = this.size[last];
    this.aspect[i] = this.aspect[last];
    this.spin[i] = this.spin[last];
    this.angle[i] = this.angle[last];
    this.kind[i] = this.kind[last];
    this.tint[i] = this.tint[last];
  }

  /**
   * @param camX/camY   镜头中心的世界地面坐标
   * @param rootX/rootY 那一点画在缓冲的哪个像素上
   * @param scale       每世界单位多少缓冲像素（grain）
   * @param depthOf     世界 y 换算成深度键。碎片要和人一起排序，否则会整片压在人身上。
   */
  draw(
    shapes: ShapeBatch,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    scale: number,
    depthOf: (worldY: number) => number,
  ): void {
    for (let i = 0; i < this.count; i++) {
      const t = this.age[i] / this.life[i];
      const fade = 1 - t * t; // 前半程几乎不掉，最后才化掉
      const alpha = Math.round(235 * fade);
      if (alpha <= 3) continue;

      const sx = rootX + (this.x[i] - camX) * scale;
      const sy =
        rootY + ((this.y[i] - camY) * Projection.groundSquash - this.z[i] * Projection.heightSquash) * scale;

      const c = this.tint[i];
      const s = this.size[i] * scale;
      shapes.rect(
        v2(sx, sy),
        s,
        s * this.aspect[i],
        this.angle[i],
        rgba(c.r, c.g, c.b, alpha),
        depthOf(this.y[i]) + 0.4,
      );
    }
  }
}
