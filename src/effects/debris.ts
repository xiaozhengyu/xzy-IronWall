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
 * 粒子对象出来，光是这一下产生的垃圾就够卡一帧。快满的时候大家一起少溅一点（见 CAPACITY
 * 上那段），而不是让排在后面的人一片都分不到 —— 场面已经足够乱，每人少几片没人看得出来，
 * 掉帧和"有人没碎"所有人都看得出来。
 */

/**
 * 池子容量。
 *
 * 2600 是按"尾巴上少几片没人数得清"定的，而那个判断错在**尾巴不是随机的**。
 *
 * 破空的杀伤摊在 0.55 秒里：波一路往前推，前排先死、后排后死，先溅的血（活 0.42 秒）在后排
 * 溅之前就化掉了，池子始终有富余，每个人都完整炸开。回旋不是 —— 它在**同一帧**里把身周
 * 五十来人一起结算，每人四十七片就是两千三，加上上一刀还没落地的甲片直接顶到天花板。于是
 * 先被遍历到的那些人炸得很漂亮，排在后面的人一片都没有，而"排在后面"指的是敌人数组里的
 * 次序，跟玩家看哪儿毫无关系。玩家看到的就是：同一圈里有人碎了、有人只是躺下了。
 *
 * 所以这里改了两件事：容量抬到 4400（放得下一次满员回旋，加一刀的余量），以及满员时按比例
 * 缩水而不是先到先得（见 burst 里的 share）。少几片和一片都没有是两回事。
 */
const CAPACITY = 4400;

/**
 * 池子还剩多少比例时开始缩水，以及缩到最少剩几成。
 *
 * 不等到装满才管：那时最后几个人已经什么都分不到了。从还剩四成起就一起匀着少溅一点，
 * 于是一次群杀里每个人都碎，只是碎得没有单杀那么阔气 —— 这正是眼睛能接受的那种"少"。
 */
const SHARE_FROM = 0.4;
const SHARE_FLOOR = 0.3;

/** 甲片里有多大比例是"大块"。打在人身上是一成，炸出来的那一蓬要高得多（见 blast）。 */
const BIG_SHARD_CHANCE = 0.1;
const BLAST_BIG_CHANCE = 0.3;

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

  /** 场上还剩多少片。 */
  get alive(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
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
    const room = 1 - this.count / CAPACITY;
    const share = room >= SHARE_FROM ? 1 : Math.max(SHARE_FLOOR, room / SHARE_FROM);

    const blood = Math.round((9 + 11 * power) * share);
    // 甲片是"碎了"的唯一证据，所以再挤也保底一片：血谁挨一下都会飙，只有甲片说得出这一下
    // 把人打散了。
    const full = power >= 2 ? 8 + 8 * (power - 1) : 2;
    const shards = Math.max(power >= 2 ? 1 : 0, Math.round(full * share));

    const heading = Math.atan2(dirY, dirX);
    const boost = 0.7 + 0.5 * power;
    for (let i = 0; i < blood; i++) {
      // 方向：以打击方向为中心撒开一个很宽的扇面，再各自掷一个速度。
      this.emit(
        x, y,
        heading + (Math.random() - 0.5) * 3.0,
        (26 + Math.random() * 46) * boost,
        34 + Math.random() * 52,
        BIG_SHARD_CHANCE,
        KIND_BLOOD,
        palette,
      );
    }
    for (let i = 0; i < shards; i++) {
      this.emit(
        x, y,
        heading + (Math.random() - 0.5) * 2.2,
        (18 + Math.random() * 30) * boost,
        34 + Math.random() * 52,
        BIG_SHARD_CHANCE,
        KIND_SHARD,
        palette,
      );
    }
  }

  /**
   * 原地炸开一蓬：不朝哪个方向，而是从一点甩向四面八方。
   *
   * 为什么 burst 顶不上这件事。burst 是**打在某个人身上**的，一次回旋杀掉身周五十人，就是
   * 五十蓬各自四十来片、摊在一个半径四十多个单位的圈上 —— 每一处都很稀，合起来也只是"一圈
   * 人身上各掉了点东西"，读不出中间发生过一次爆炸。而玩家按下回旋看到的应该是**脚下炸了**：
   * 有东西从他站的地方飞出来，飞得比那圈人还远。这一蓬就是那些东西。
   *
   * 所以它的速度和抛高都比 burst 高一大截（飞出去约两倍于判定半径），大块的比例也调高 ——
   * 爆炸物要看得清是"一块东西"，一堆小点只会读成灰。
   */
  /**
   * @param volume 这一蓬给到满量的几成。1 = 满。由调用方按"包了多少人、练到几级"算（见
   *               BLAST_FULL_CROWD）—— 而不是抖 power，那个字段说的是招式的档位，不是这一发的大小。
   */
  blast(x: number, y: number, power: number, palette: CharacterPalette, volume = 1): void {
    const room = 1 - this.count / CAPACITY;
    const share = room >= SHARE_FROM ? 1 : Math.max(SHARE_FLOOR, room / SHARE_FROM);
    const give = share * Math.max(0, Math.min(1, volume));
    // 甲片给得比血多一倍：爆炸物要能认出是"一块东西"，血只是一片红雾。
    const blood = Math.round(34 * power * 0.5 * give);
    const shards = Math.round(70 * power * 0.5 * give);

    for (let i = 0; i < blood; i++) {
      this.emit(
        x, y,
        Math.random() * Math.PI * 2,
        70 + Math.random() * 90,
        60 + Math.random() * 70,
        BLAST_BIG_CHANCE,
        KIND_BLOOD,
        palette,
      );
    }
    for (let i = 0; i < shards; i++) {
      this.emit(
        x, y,
        Math.random() * Math.PI * 2,
        90 + Math.random() * 110,
        70 + Math.random() * 80,
        BLAST_BIG_CHANCE,
        KIND_SHARD,
        palette,
      );
    }
  }

  /**
   * @param angle 甩出去的地面方向，弧度。撒开由调用方掷 —— 扇面和整圈的分布不是同一件事。
   * @param speed 水平初速，世界单位每秒。
   * @param lift  竖直初速。它和重力一起决定这一片在空中待多久，也就决定它能飞多远。
   */
  private emit(
    x: number,
    y: number,
    angle: number,
    speed: number,
    lift: number,
    bigChance: number,
    kind: number,
    palette: CharacterPalette,
  ): void {
    if (this.count >= CAPACITY) return;
    const i = this.count++;

    this.x[i] = x;
    this.y[i] = y;
    // 从胸口高度溅出来，不是从脚下 —— 从地面冒出来的血读作地上的水坑被踩了一脚。
    this.z[i] = 7 + Math.random() * 5;
    this.vx[i] = Math.cos(angle) * speed;
    this.vy[i] = Math.sin(angle) * speed;
    this.vz[i] = lift;
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
      // 大小拉开档次，其中一部分是**大块**。清一色的小方块读作噪点；中间混几块明显更大的，
      // 眼睛才会把它读成"从这人身上崩下来的东西"。爆炸那一蓬把这个比例调高（见 blast）。
      const big = Math.random() < bigChance;
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
