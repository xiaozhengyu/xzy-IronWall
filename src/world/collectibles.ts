import { v2 } from '../core/math';
import { rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 地图上的可收集物种类。生成、推进和拾取都走这个公共入口，加一种只要补一套配色和画法，
 * 不用再复制吸附逻辑。
 */
export type CollectibleKind = 'gem' | 'coin' | 'pickup';

/** 一帧里各类型收走了多少。对象复用，调用方读完即可，不要长期持有。 */
export type CollectedCounts = Record<CollectibleKind, number>;

export interface CollectibleTarget {
  x: number;
  y: number;
  /**
   * 吸附半径，世界单位。**三种掉落共用这一个圈**，进圈就往目标飞。
   *
   * 以前这是一个写死的常量（MAGNET_RADIUS = 68）。现在它是玩家的一项基础属性，跟着角色、
   * 等级和局内的属性卡走 —— "拾取范围"这张卡在那之前是一行没有实现的说明文字。
   *
   * 药和符曾经单开过一个更小的圈，撤了：同样是地上的东西，有的走近就飞过来、有的要踩上去，
   * 玩家会先感到别扭再想明白为什么。那件事改由**掉在哪儿**来办，见 PICKUP_TOSS_MIN。
   */
  pickupRange: number;
  /**
   * 这一件药 / 符现在收不收得下。收不下就让它留在地上。
   *
   * 不给就是照单全收。快捷栏只有四格，格子被别的东西占满时新的那一件应该躺在草地上等着，
   * 而不是被捡起来然后无声地丢掉 —— 后者玩家完全不知道发生了什么。
   */
  accepts?: (id: string) => boolean;
}

interface CollectibleDrop {
  kind: CollectibleKind;
  /**
   * 这是哪一件药 / 符。只有 kind 'pickup' 有。
   *
   * 灵石和金币是**画出来**的（一堆图元拼的方块和圆片），药和符是**贴图**：地上那一件和快捷栏
   * 那一格用同一张 icon。所以这一类在这里只走物理和地面那圈光，本体由 Scene 建一个精灵去画，
   * 见 iconDrops。
   */
  pickup?: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  phase: number;
  bounces: number;
  resting: boolean;
  pulling: boolean;
  pullSpeed: number;
  trailX: number;
  trailY: number;
}

interface PickupBurst {
  kind: CollectibleKind;
  x: number;
  y: number;
  age: number;
  phase: number;
}

/**
 * 每种掉落的配色。宝石是冷色的旋转方块，金币是暖色的旋转圆片；两者共用同一套阴影、
 * 落地光环和吸附光尾，只换颜色，所以在同一堆掉落里一眼能分开又不会显得是两套东西。
 */
interface CollectiblePalette {
  /** 落地光环、吸附光尾、拾取爆点的主色。 */
  glow: readonly [number, number, number];
  /** 外圈暗色描边。 */
  shell: readonly [number, number, number];
  /** 侧面（金币立起来时露出的那条厚度带）；宝石用不到，填个居中色即可。 */
  edge: readonly [number, number, number];
  /** 本体主色。 */
  body: readonly [number, number, number];
  /** 朝光的切面。 */
  facet: readonly [number, number, number];
  /** 最亮的高光点。 */
  spark: readonly [number, number, number];
}

const PALETTES: Record<CollectibleKind, CollectiblePalette> = {
  // 取敌人掉落宝石一贯的青蓝，和灵石进度条同色系。
  gem: {
    glow: [66, 238, 255],
    shell: [8, 54, 82],
    edge: [20, 130, 165],
    body: [34, 205, 236],
    facet: [139, 250, 255],
    spark: [241, 255, 255],
  },
  // 金币走 HUD 金边那套暖金：暗描边 + 亮金体 + 高光，缩到几个像素也还是"金色圆片"。
  coin: {
    glow: [255, 206, 92],
    shell: [92, 58, 8],
    edge: [176, 122, 20],
    body: [240, 197, 58],
    facet: [253, 235, 123],
    spark: [255, 251, 224],
  },
  /*
   * 药和符的本体是**贴图**，不是图元 —— 这一套颜色只画它脚下那圈光和被吸走时的光尾。
   *
   * 给一档偏白的暖绿：地上同时躺着一片青蓝的灵石和几枚金币，第三种颜色必须和那两种都分得开，
   * 而且要比它们亮一点。一局里只掉几百件药符，和几万颗灵石比是稀罕物，脚下那圈光就是它在
   * 一地蓝光里唯一的招手方式。
   */
  pickup: {
    glow: [168, 255, 186],
    shell: [22, 74, 44],
    edge: [72, 160, 104],
    body: [140, 232, 166],
    facet: [200, 255, 214],
    spark: [244, 255, 248],
  },
};

/** 配色表里存的是纯 RGB，画的时候再配上各处不同的透明度。 */
const tint = (c: readonly [number, number, number], alpha: number) => rgba(c[0], c[1], c[2], alpha);

/**
 * 金币比灵石高出来的深度，单位是屏幕行。
 *
 * 金币 1/50 才掉一枚，被一地灵石压住就等于没掉。抬六行足够盖过任何和它在画面上重叠的
 * 灵石（一颗掉落物本身也就三四行高），又不至于让它穿到明显站在前面的人身上 —— 掉落物
 * 的深度是和角色、树木共用一套排序的，抬太多金币就会浮在人身上。
 */
const COIN_DEPTH_BIAS = Projector.DEPTH_PER_ROW * 6;

const MAX_DROPS = 1800;
const MAX_BURSTS = 96;
const GRAVITY = 260;
const MAGNET_DELAY = 0.48;

/**
 * 药和符弹出去多远。
 *
 * **"走过去捡"这件事只由这一个数负责，吸附半径一个字都不改。**
 *
 * 中间试过给药符单开一个更小的吸附圈（12，后来 40）。那是错的：场上三种掉落用两套吸附规则，
 * 玩家会先感到别扭再想明白为什么 —— 同样是地上的东西，有的走近就飞过来、有的要踩上去，这
 * 中间没有任何可讲的道理。吸附是这套掉落的基础手感，它必须只有一种。
 *
 * 所以差别全放在**掉在哪儿**：灵石金币抛 7~18 个单位，基本落在脚边，打完就到手；药和符抛
 * 85~135，明显落在吸附圈（拾取范围，基准 68）之外。于是它天然要玩家朝它挪几步，走进圈里之后
 * 该飞过来还是飞过来 —— 获得感来自那几步，不是来自一条不一样的规则。
 *
 * 上限压在 135：视口半宽只有一百五十来个单位，再远就掉到画面外去了，而看不见的掉落等于没掉。
 */
const PICKUP_TOSS_MIN = 85;
const PICKUP_TOSS_MAX = 135;
const COLLECT_DISTANCE = 3.5;
const COLLECT_HEIGHT = 7;
const BURST_LIFE = 0.24;

/**
 * 地图可收集物池。
 *
 * 它不知道经验、金钱或技能，只管理“东西落到地上、靠近玩家后被吸走”这段公共行为。
 * update 每帧把各类型收走的数量写进 collected；Battle 累计后交给 HUD 显示。
 */
export class Collectibles {
  /** 上一次 update 里各类型收走的数量。每帧清零后重填，不要跨帧持有。 */
  readonly collected: CollectedCounts = { gem: 0, coin: 0, pickup: 0 };
  /**
   * 这一帧收走的药和符，按 id。对象复用，读完即可，不要跨帧持有。
   *
   * 和 collected 分开：那边只数个数，而这边要知道**收到的是哪一件** —— 四格快捷栏各记各的。
   */
  readonly collectedPickups: string[] = [];
  private readonly drops: CollectibleDrop[] = [];
  private readonly visibleDrops: CollectibleDrop[] = [];
  /** 最近一帧可见的掉落物数量，便于性能检查。 */
  drawn = 0;
  private readonly bursts: PickupBurst[] = [];
  private replaceAt = 0;

  get alive(): number {
    return this.drops.length;
  }

  /**
   * 这一帧画面里有哪些药和符，以及它们的屏幕位置。Scene 照着这张表摆精灵。
   *
   * 复用同一个数组、每帧重填：场上随时几百件掉落，每帧新建一批对象比画它们还贵。调用方读完
   * 即用，不要跨帧持有。
   *
   * **必须在 draw 之后读**：位置是 draw 那一遍里按同一份 bob 和同一个投影算出来的，两处各算
   * 一遍迟早会差出半个像素，那时图标和它的描边就分家了。
   */
  readonly iconDrops: { id: string; x: number; y: number; size: number }[] = [];

  /**
   * 还躺在地上没被捡走的药和符，**世界坐标**。小地图照着它摆标记。
   *
   * 和 iconDrops 是两码事：那一份是屏幕坐标、只含画面里的、而且要等 draw 跑过才有值。这一份
   * 是全图的 —— 小地图的意义恰恰是告诉玩家**画面外**还有什么。
   *
   * 同样复用数组：一局里这个数在零和几十之间，每帧新建一批对象不值得。
   */
  readonly pickupMarkers: { id: string; x: number; y: number }[] = [];

  /** 刷新上面那张表。小地图每帧调一次。 */
  refreshPickupMarkers(): void {
    this.pickupMarkers.length = 0;
    for (const d of this.drops) {
      if (d.kind !== 'pickup' || !d.pickup) continue;
      this.pickupMarkers.push({ id: d.pickup, x: d.x, y: d.y });
    }
  }

  clear(): void {
    this.collected.gem = 0;
    this.collected.coin = 0;
    this.collected.pickup = 0;
    this.collectedPickups.length = 0;
    this.drops.length = 0;
    this.visibleDrops.length = 0;
    this.drawn = 0;
    this.bursts.length = 0;
    this.replaceAt = 0;
  }

  spawn(kind: CollectibleKind, x: number, y: number, pickup?: string): void {
    const angle = Math.random() * Math.PI * 2;
    const toss = kind === 'pickup';
    const speed = toss
      ? PICKUP_TOSS_MIN + Math.random() * (PICKUP_TOSS_MAX - PICKUP_TOSS_MIN)
      : 7 + Math.random() * 11;
    const drop: CollectibleDrop = {
      kind,
      pickup,
      x,
      y,
      z: 4 + Math.random() * 3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      // 抛得远的也要抛得高一点，否则那条弧是贴着地飞出去的，读作"滑走了"而不是"被抛出去"。
      vz: toss ? 62 + Math.random() * 26 : 38 + Math.random() * 24,
      age: 0,
      phase: Math.random() * Math.PI * 2,
      bounces: 0,
      resting: false,
      pulling: false,
      pullSpeed: 0,
      trailX: x,
      trailY: y,
    };

    if (this.drops.length < MAX_DROPS) {
      this.drops.push(drop);
      return;
    }

    // 极端情况下地上会有几千个未拾取物。固定容量避免一局跑得越久数组越大；满池后轮换最
    // 早的一格，视觉上仍保持“每次击杀都有一颗刚掉出来”。
    this.drops[this.replaceAt] = drop;
    this.replaceAt = (this.replaceAt + 1) % MAX_DROPS;
  }

  dropGem(x: number, y: number): void {
    this.spawn('gem', x, y);
  }

  /** 掉一件药或符。本体是贴图，这里只管它怎么落地、怎么被吸走。 */
  dropPickup(id: string, x: number, y: number): void {
    this.spawn('pickup', x, y, id);
  }

  dropCoin(x: number, y: number): void {
    this.spawn('coin', x, y);
  }

  update(dt: number, target: CollectibleTarget): void {
    this.collected.gem = 0;
    this.collected.coin = 0;
    this.collected.pickup = 0;
    this.collectedPickups.length = 0;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;

      if (d.pulling) {
        if (this.pull(d, dt, target)) {
          this.emitBurst(d.kind, target.x, target.y);
          this.swapRemoveDrop(i);
          this.collected[d.kind]++;
          if (d.pickup) this.collectedPickups.push(d.pickup);
        }
        continue;
      }

      this.fall(d, dt);
      const dx = target.x - d.x;
      const dy = target.y - d.y;
      // 三种掉落**同一个吸附半径**。药符只多一条：先问收不收得下，收不下就让它留在地上。
      if (d.kind === 'pickup' && d.pickup && target.accepts && !target.accepts(d.pickup)) continue;
      const reach = Math.max(COLLECT_DISTANCE, target.pickupRange);
      if (d.age >= MAGNET_DELAY && dx * dx + dy * dy <= reach * reach) {
        d.pulling = true;
        d.resting = false;
        d.pullSpeed = 34;
        d.z = Math.max(d.z, 2.2);
        d.trailX = d.x;
        d.trailY = d.y;
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].age += dt;
      if (this.bursts[i].age >= BURST_LIFE) this.swapRemoveBurst(i);
    }
  }

  private fall(d: CollectibleDrop, dt: number): void {
    if (d.resting) return;

    d.vz -= GRAVITY * dt;
    d.z += d.vz * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.z > 0) return;

    d.z = 0;
    if (d.bounces === 0 && Math.abs(d.vz) > 15) {
      d.bounces++;
      d.vz = -d.vz * 0.3;
      d.vx *= 0.52;
      d.vy *= 0.52;
      return;
    }

    d.vx = 0;
    d.vy = 0;
    d.vz = 0;
    d.resting = true;
  }

  private pull(d: CollectibleDrop, dt: number, target: CollectibleTarget): boolean {
    const oldX = d.x;
    const oldY = d.y;
    const dx = target.x - d.x;
    const dy = target.y - d.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= COLLECT_DISTANCE) return true;

    // 先轻轻离地，再迅速追上人物。最高速度远大于奔跑速度，所以玩家不会把已触发的宝石甩掉。
    d.pullSpeed = Math.min(300, d.pullSpeed + 720 * dt);
    const step = Math.min(distance, d.pullSpeed * dt);
    d.x += (dx / distance) * step;
    d.y += (dy / distance) * step;
    d.z += (COLLECT_HEIGHT - d.z) * Math.min(1, dt * 11);

    // 这两个点故意落后于宝石，绘制时连成短光尾；目标移动时尾巴也会自然弯向旧位置。
    const follow = Math.min(1, dt * 7);
    d.trailX += (oldX - d.trailX) * follow;
    d.trailY += (oldY - d.trailY) * follow;
    return Math.hypot(target.x - d.x, target.y - d.y) <= COLLECT_DISTANCE;
  }

  private emitBurst(kind: CollectibleKind, x: number, y: number): void {
    const burst = { kind, x, y, age: 0, phase: Math.random() * Math.PI * 2 };
    if (this.bursts.length < MAX_BURSTS) this.bursts.push(burst);
    else this.bursts[Math.floor(Math.random() * MAX_BURSTS)] = burst;
  }

  private swapRemoveDrop(i: number): void {
    const last = this.drops.length - 1;
    if (i !== last) this.drops[i] = this.drops[last];
    this.drops.pop();
    if (this.drops.length > 0) this.replaceAt %= this.drops.length;
    else this.replaceAt = 0;
  }

  private swapRemoveBurst(i: number): void {
    const last = this.bursts.length - 1;
    if (i !== last) this.bursts[i] = this.bursts[last];
    this.bursts.pop();
  }

  draw(
    shapes: ShapeBatch,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    scale: number,
    depthOf: (worldY: number) => number,
    viewport?: { width: number; height: number },
  ): void {
    const toScreen = (x: number, y: number, z: number) =>
      v2(
        rootX + (x - camX) * scale,
        rootY + ((y - camY) * Projection.groundSquash - z * Projection.heightSquash) * scale,
      );

    const inView = (x: number, y: number, z: number): boolean => {
      if (!viewport) return true;
      const sx = rootX + (x - camX) * scale;
      const sy = rootY + ((y - camY) * Projection.groundSquash - z * Projection.heightSquash) * scale;
      const margin = 9 * scale;
      return sx >= -margin && sx <= viewport.width + margin && sy >= -margin && sy <= viewport.height + margin;
    };
    const visible = this.visibleDrops;
    visible.length = 0;
    this.iconDrops.length = 0;
    for (const d of this.drops) {
      if (inView(d.x, d.y, d.z + 2) || inView(d.x, d.y, 0) ||
          (d.pulling && inView(d.trailX, d.trailY, Math.max(1.4, d.z)))) visible.push(d);
    }
    this.drawn = visible.length;

    for (const d of visible) {
      const palette = PALETTES[d.kind];
      // 大量静止掉落物保留四层轮廓；落地/吸附中的继续完整发光。
      const detailed = visible.length <= 160 || !d.resting || d.pulling || d.age < 2;
      const depth = depthOf(d.y) + 0.25 + (d.kind === 'coin' ? COIN_DEPTH_BIAS : 0);
      const bob = d.resting ? 1.65 + Math.sin(d.age * 5.4 + d.phase) * 0.38 : 0;
      const displayZ = d.z + bob;
      const at = toScreen(d.x, d.y, displayZ);
      const ground = toScreen(d.x, d.y, 0);
      const pulse = 0.88 + Math.sin(d.age * 7 + d.phase) * 0.12;
      const r = 1.55 * scale * pulse;

      if (detailed) shapes.ellipse(ground, 2.6 * scale, 1.1 * scale, 0, rgba(12, 31, 34, 105), depth - 0.4);
      if (d.resting && detailed) {
        shapes.ellipseRing(
          ground,
          (3.2 + pulse * 0.6) * scale,
          (1.25 + pulse * 0.24) * scale,
          0,
          Math.max(0.55, 0.34 * scale),
          tint(palette.glow, 56),
          depth - 0.35,
          14,
        );
      }

      if (d.pulling) {
        const tail = toScreen(d.trailX, d.trailY, Math.max(1.4, displayZ * 0.72));
        shapes.capsule(tail, at, Math.max(1.2, scale * 0.75), tint(palette.glow, 112), depth - 0.15);
        shapes.disc(at, r * 2.35, tint(palette.glow, 50), depth - 0.1);
      } else if (detailed) {
        shapes.disc(at, r * 1.9, tint(palette.glow, 32), depth - 0.1);
      }

      if (d.kind === 'pickup') {
        /*
         * 药和符的**本体不在这里画**：那是一张 icon，由 Scene 建精灵贴上去（见 iconDrops）。
         * 这里只画它落在草地上的那几笔标识：
         *
         *   脚下一圈光环   告诉你"这儿有东西"。一地灵石里，位置比长相先被看到。
         *   身后一圈描边   贴图本身没有轮廓，压在一堆人腿之间会糊掉；一圈比图标略大的暗色
         *                  压在底下，图标就从背景里跳出来了。
         *   一点柔光       让它看着是"亮的"，而不是一张贴在草上的纸。
         *
         * 悬浮那一下（bob）上面已经算进 displayZ 了，精灵读的是同一个高度，所以描边和图标
         * 一起上下飘，不会脱节。
         */
        // 比灵石金币大得多。它一局只有几十件，而且要在一地蓝光里被一眼认出来 —— 小了就只是
        // 草地上又一个亮点。这个 R 同时是描边圈和图标的尺寸，两者永远一致。
        const R = r * 3.6;
        shapes.ellipseRing(
          ground, (4.4 + pulse * 0.8) * scale, (1.75 + pulse * 0.3) * scale, 0,
          Math.max(0.7, 0.46 * scale), tint(palette.glow, 92), depth - 0.34, 16,
        );
        shapes.disc(at, R * 1.08, tint(palette.shell, 190), depth);
        shapes.disc(at, R * 0.94, tint(palette.glow, 58), depth + 0.01);
        // 交给 Scene 去贴图标。尺寸跟着颗粒度走，所以缩放时它和场上的人一起变大变小。
        if (d.pickup) this.iconDrops.push({ id: d.pickup, x: at.x, y: at.y, size: R * 2 });
      } else if (d.kind === 'coin') {
        // 立着转的金币。用圆片而不是方块，是为了在一地宝石里靠"圆 + 暖色"一眼分出来。
        //
        // 关键是那条厚度带：s 是绕竖轴转角的余弦，|s| 决定正面被压扁多少，e = √(1-s²)
        // 决定侧面露出多宽。正面朝前时侧面藏在币后面；转到侧立时正面宽度归零，只剩下
        // 那条深色厚度带。少了它，金币就只是一片会变窄的色块，没有立体感。
        const s = Math.cos(d.age * 3.2 + d.phase);
        const face = Math.abs(s);
        const edge = Math.sqrt(Math.max(0, 1 - s * s));
        const R = r * 1.4;
        const thick = r * 0.34;
        const rimX = R * face + thick * edge;
        const faceX = R * face;
        // 正面朝一侧滑开，另一侧才露得出侧面，不然厚度带会对称地长在两边像个光圈。
        const at2 = v2(at.x - Math.sign(s) * thick * edge, at.y);
        shapes.ellipse(at, rimX + r * 0.16, R + r * 0.16, 0, tint(palette.shell, 255), depth);
        shapes.ellipse(at, rimX, R, 0, tint(palette.edge, 255), depth + 0.01);
        shapes.ellipse(at2, Math.max(faceX, r * 0.05), R * 0.9, 0, tint(palette.body, 255), depth + 0.02);
        shapes.ellipse(
          v2(at2.x - faceX * 0.3, at2.y - R * 0.26),
          Math.max(faceX * 0.42, r * 0.03), R * 0.38, 0,
          tint(palette.facet, 255), depth + 0.04,
        );
        shapes.disc(
          v2(at2.x - faceX * 0.34, at2.y - R * 0.42),
          Math.max(0.45, r * 0.18 * (0.35 + 0.65 * face)),
          tint(palette.spark, 245), depth + 0.06,
        );
      } else {
        // 旋转方块在像素尺寸下就是最清楚的宝石轮廓；三层色阶再加一块偏上的白色切面，让它不是
        // 普通蓝色掉落点。轻微摆动只改变切面角度，不会像整颗陀螺一样看不清。
        const angle = Math.PI * 0.25 + Math.sin(d.age * 6.2 + d.phase) * 0.08;
        shapes.rect(at, r * 2.18, r * 2.18, angle, tint(palette.shell, 255), depth);
        shapes.rect(at, r * 1.76, r * 1.76, angle, tint(palette.body, 255), depth + 0.02);
        shapes.rect(
          v2(at.x - r * 0.18, at.y - r * 0.22),
          r * 0.92, r * 0.78, angle,
          tint(palette.facet, 255), depth + 0.04,
        );
        shapes.disc(
          v2(at.x - r * 0.28, at.y - r * 0.42),
          Math.max(0.6, r * 0.22), tint(palette.spark, 245), depth + 0.06,
        );
      }
    }

    for (const burst of this.bursts) {
      if (!inView(burst.x, burst.y, COLLECT_HEIGHT)) continue;
      const palette = PALETTES[burst.kind];
      const t = burst.age / BURST_LIFE;
      const fade = 1 - t;
      const at = toScreen(burst.x, burst.y, COLLECT_HEIGHT);
      const depth = depthOf(burst.y) + 0.7 + (burst.kind === 'coin' ? COIN_DEPTH_BIAS : 0);
      const radius = (1.5 + t * 5.5) * scale;
      shapes.disc(at, radius * 0.7, tint(palette.glow, Math.round(72 * fade)), depth);
      shapes.ellipseRing(
        at,
        radius,
        radius,
        0,
        Math.max(0.7, scale * 0.5 * fade),
        tint(palette.spark, Math.round(220 * fade)),
        depth + 0.02,
        16,
      );
      for (let k = 0; k < 4; k++) {
        const angle = burst.phase + (Math.PI * 2 * k) / 4;
        const inner = radius * 0.35;
        const outer = radius * (0.8 + 0.2 * fade);
        shapes.bar(
          v2(at.x + Math.cos(angle) * inner, at.y + Math.sin(angle) * inner),
          v2(at.x + Math.cos(angle) * outer, at.y + Math.sin(angle) * outer),
          Math.max(0.7, scale * 0.42 * fade),
          tint(palette.spark, Math.round(230 * fade)),
          depth + 0.04,
        );
      }
    }
  }
}
