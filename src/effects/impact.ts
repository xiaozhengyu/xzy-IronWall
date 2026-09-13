import type { Pose } from '../characters/rig';
import { type UnitDef, hammerLength } from '../characters/unitDef';
import { clamp, lerp, v2 } from '../core/math';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 向前推进的冲击弧。
 *
 * 落点吐出一道弧形波，沿着挥击的方向一路跑出去，越跑越宽、越跑越淡，人留在原地。
 *
 * 几何上它是一个以落点为圆心、半径随时间增长的圆的**一段扇形弧**，而不是一个平移的固定
 * 形状。两者在画面上是一回事（弧顶以扩张速度向前走、弧随半径变宽），但用扩张半径来表达
 * 要简单得多，不需要维护形状自己的曲率。
 *
 * **纯表现，不参与判定。** 命中与否由 game/combat.ts 的扇形判定在发招那一刻一次算清，
 * 这道弧只是把"这一下打向了那边"画出来。曾经让判定跟着波前逐帧推进，那样更"真实"，
 * 但换来的是判定随动画漂移、以及大量"看着中了却没中"。弧的视觉长度和兵种的 attackRange
 * 调成大致相当就够了 —— 画面不撒谎，但也不必是判定本身。
 *
 * 存世界地面坐标，不是屏幕坐标 —— 砸完之后玩家会走开，波该继续沿它自己的方向跑。也没有
 * 做进 CharacterRenderer：人物渲染是无状态的（给一个姿势画一帧），而特效跨帧存在，
 * 和是谁放出来的已经没关系了。
 */

/**
 * 弧顶在生命周期 t（0..1）时距圆心多远。
 *
 * 导出是给"破空"那个技能用的：它的判定要跟着波前跑，而判定和画面必须用**同一条**曲线 ——
 * 各写一份的话，两边任何一次微调都会让"看着扫到了却没死"回来（impact.ts 顶上那段说的
 * 正是这件事）。这个函数是纯几何，导出它不会把判定逻辑漏进特效模块。
 *
 * easeOut：起手极快随后迅速慢下来。匀速推进读起来像一块被推着走的板子。
 */
export function frontRadius(t: number, from: number, to: number, power = 1): number {
  const ease = 1 - (1 - t) * (1 - t) * (1 - t);
  return lerp(from, to, ease) * power;
}

interface Shockwave {
  /** 落点，也是弧的圆心。 */
  x: number;
  y: number;
  /** Velocity inherited from the emitter at cast time, in world units per second. */
  vx: number;
  vy: number;
  /** 推进方向，和 actor.facing 用同一套地面角度。 */
  heading: number;
  age: number;
  life: number;
  /** 弧顶到圆心的起始与终止距离，世界单位。 */
  from: number;
  to: number;
  /** 弧张开的角度，弧度。 */
  span: number;
  /** 强度，一起缩放距离、粗细和亮度。1 是标准的一次砸击。 */
  power: number;
  /** 粗细倍率。技能要压过人堆，得比平砍粗一截。 */
  weight: number;
  /** 画在人群之上还是贴着地。见 DEPTH_OVERHEAD。 */
  overhead: boolean;
  tint: Rgba;
  /** Multiplier for the impact flash; fan attacks can share one origin without overexposing it. */
  flash: number;
  /** Multiplier for detached rays; several mini waves should not each emit a full burst. */
  sparks: number;
  /** Multiplier for the delayed inner echo. Set to zero when the move already has authored layers. */
  trail: number;
  /** Different moves share one renderer, while keeping distinct silhouettes. */
  style: ShockwaveStyle;
  /** Stable variation for the jagged rim and sparks. */
  seed: number;
}

export type ShockwaveStyle = 'slash' | 'ring' | 'surge' | 'burst';

export interface ShockwaveOptions {
  life?: number;
  from?: number;
  to?: number;
  span?: number;
  power?: number;
  weight?: number;
  overhead?: boolean;
  tint?: Rgba;
  flash?: number;
  sparks?: number;
  trail?: number;
  velocityX?: number;
  velocityY?: number;
  style?: ShockwaveStyle;
}

/** 贴地那一档：压在地面投影和影子之上，但在人的腿之下。平砍用它。 */
const DEPTH_GROUND_FX = -18;

/**
 * 压在人群之上那一档。技能用它。
 *
 * 这是技能特效从"基本看不见"变成"看得见"的**主要**原因。贴地那一档在空场上很好看，但一到
 * 实战，弧扫过的地方恰恰站满了人 —— 它被几十条腿盖住，玩家只能从人倒下的顺序反推刚才打了
 * 什么。而技能是玩家主动按出来的一次动作，它必须在画面上有一个明确的回应。
 *
 * 24 是按人物各部件的深度挑的：头是 +8，所以 +24 稳稳压过同一排的所有人；而下一排的腿在
 * +32，所以**站在更靠近镜头那一排的人仍然挡得住它**。完全置顶（给一个极大的深度）会让弧
 * 糊在整个画面最前面，读作贴在屏幕上的一张贴纸，而不是发生在场地里的一件事。
 */
const DEPTH_OVERHEAD = 24;

/** 默认的弧色：暖白。 */
const ARC_TINT = rgb(252, 244, 220);

/**
 * 弧上取多少段。按张角给，不是定死一个数。
 *
 * 定死 16 段对一个 100 度的弧刚好，但"回旋"那一招张角是整整 360 度 —— 同样 16 段画出来是
 * 个正十六边形，边角一清二楚。段数跟着张角走，每段大约 6 度，弧多长都是弧。
 */
const arcSegments = (span: number): number => Math.max(8, Math.min(44, Math.round(span / 0.105)));

export class ImpactEffects {
  private waves: Shockwave[] = [];
  private serial = 0;

  get count(): number {
    return this.waves.length;
  }

  /**
   * 一下全抹掉。重开一局用（见 Battle.reset）。
   *
   * 漏了这一行的后果是：上一局最后那一招的弧会跨过结算和选人界面，在新的一局开场
   * 那几帧里接着飘出来 —— 上一局的弹片和扭曲都已经在 reset 里清了，只有这一层没有。
   */
  clear(): void {
    this.waves.length = 0;
  }

  /**
   * @param heading 推进方向的角度，和 actor.facing 用同一套地面坐标。
   */
  spawn(x: number, y: number, heading: number, options: ShockwaveOptions = {}): void {
    this.waves.push({
      x,
      y,
      vx: options.velocityX ?? 0,
      vy: options.velocityY ?? 0,
      heading,
      age: 0,
      life: options.life ?? 0.4,
      from: options.from ?? 3,
      // 弧顶推出去多远。这个值要让"弧的最远处"和挥击者的 attackRange 对得上：弧的圆心
      // 在落点（身前约 9.5 单位），所以最远处离人是 9.5 + to * power。武将的 power 是
      // 1.34、范围 34，于是 to 取 18 —— 画面正好画到打得到的地方为止。
      // 画得比判定远，玩家就会反复遇到"扫到了却没死"；画得比判定近则相反，两种都难受。
      to: options.to ?? 18,
      // 大约 100 度。再窄读作一发飞出去的弹丸，再宽就退回成"一个圈"了。
      span: options.span ?? 1.75,
      power: options.power ?? 1,
      weight: options.weight ?? 1,
      overhead: options.overhead ?? false,
      tint: options.tint ?? ARC_TINT,
      flash: options.flash ?? 1,
      sparks: options.sparks ?? 1,
      trail: options.trail ?? 1,
      style: options.style ?? ((options.span ?? 1.75) >= Math.PI * 1.98 ? 'ring' : 'slash'),
      seed: ++this.serial,
    });
  }

  update(dt: number): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.age += dt;
      // A projectile inherits the caster's velocity once, then flies independently along that vector.
      // It is deliberately not attached to the caster: turning after release must not bend the wave.
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      // 交换删除。冲击波之间没有先后关系，不需要保持顺序，深度排序在 ShapeBatch 里做。
      if (w.age >= w.life) {
        this.waves[i] = this.waves[this.waves.length - 1];
        this.waves.pop();
      }
    }
  }

  /** 弧顶当前距落点多远。 */
  private radiusAt(w: Shockwave): number {
    return frontRadius(clamp(w.age / w.life, 0, 1), w.from, w.to, w.power);
  }

  /**
   * @param camX/camY   镜头中心所在的世界地面坐标（也就是玩家的位置）
   * @param rootX/rootY 那个点画在缓冲里的哪个像素上
   * @param scale       每世界单位多少缓冲像素，和人物的 grain 用同一个值
   */
  draw(shapes: ShapeBatch, camX: number, camY: number, rootX: number, rootY: number, scale: number): void {
    const toScreen = (wx: number, wy: number) =>
      v2(rootX + (wx - camX) * scale, rootY + (wy - camY) * Projection.groundSquash * scale);

    for (const w of this.waves) {
      const t = clamp(w.age / w.life, 0, 1);

      // 弧顶按 easeOut 前冲：起手极快，随后迅速慢下来。匀速推进读起来像一块被推着走的
      // 板子，而不是一次冲击释放出去的能量。
      const ease = 1 - (1 - t) * (1 - t) * (1 - t);
      const radius = this.radiusAt(w);

      // 亮度衰减用 1.3 次方而不是平方。平方掉得太快，弧跑到一半就成了草地上一道发暗的
      // 橄榄色 —— 而这个颜色本来就浅，在绿地上全靠亮度撑对比。变细和两端收尖已经足够
      // 表达耗散，不需要再靠变暗。
      const fade = 1 - t;
      // 压在人群之上那一档**先保持全亮，最后才化掉**，不是一路变淡。
      //
      // 一路变淡的弧在半条命的时候只剩四成不透明度，压在绿草和红衣上混出来是一条橄榄色的
      // 带子 —— 形状还在，但已经不像"一道光"了。前六成保持全亮、后四成快速化掉，读起来才是
      // 闪出来又收回去。贴地那一档相反：它是平砍的余波，快进快出才不碍事。
      const alpha = w.overhead
        // 峰值压在 200 而不是 240：弧盖在人群之上，全不透明会把底下正在倒的人整段挡掉 ——
        // 而"谁被打中了"恰恰是这一下最该看见的东西。留一点透，弧是弧、人也还在。
        ? Math.round(200 * clamp(fade * 2.4, 0, 1))
        : Math.round(240 * Math.pow(fade, 1.3));
      if (alpha <= 2) continue;

      // 主波不再是一根单色线：暗边托住轮廓，彩色能量带负责识别，白热核心负责重量。
      const styleWeight = w.style === 'burst' ? 1.18 : w.style === 'surge' ? 0.94 : 1;
      const thickness = lerp(3.8, 1.05, t) * w.power * w.weight * styleWeight * scale;

      const tint = w.tint;
      const hotMix = w.style === 'surge' ? 0.78 : 0.66;
      const hot = rgba(
        Math.round(lerp(tint.r, 255, hotMix)),
        Math.round(lerp(tint.g, 255, hotMix)),
        Math.round(lerp(tint.b, 255, hotMix)),
        Math.round(alpha * clamp(1.25 - t * 0.45, 0, 1)),
      );
      const energy = rgba(tint.r, tint.g, tint.b, Math.round(alpha * 0.96));
      const glow = rgba(tint.r, tint.g, tint.b, Math.round(alpha * 0.22));
      const dark = rgba(46, 34, 28, Math.round(alpha * 0.72));
      const bias = w.overhead ? DEPTH_OVERHEAD : DEPTH_GROUND_FX;

      // 整圈的弧没有"两端"，收细只会在接缝处切出一道细缝。
      const closed = w.span >= Math.PI * 1.98;
      const segments = arcSegments(w.span);

      // 外晕、墨色壳、能量色、白热刃依次叠起来；外沿带稳定锯齿，避免读成规整 UI 圆环。
      const jagged = (w.style === 'burst' ? 0.9 : w.style === 'surge' ? 0.55 : 0.35) * w.power;
      this.drawArcLayer(shapes, w, radius, segments, closed, thickness * 2.7, glow, bias, toScreen, jagged, 0);
      this.drawArcLayer(shapes, w, radius, segments, closed, thickness * 1.85, dark, bias, toScreen, jagged * 0.72, 0.01);
      this.drawArcLayer(shapes, w, radius, segments, closed, thickness * 1.22, energy, bias, toScreen, jagged * 0.35, 0.02);
      this.drawArcLayer(shapes, w, radius, segments, closed, thickness * 0.42, hot, bias, toScreen, 0, 0.03);

      // 慢半拍的内层余波制造厚度；远射波再多留一道细残影，读起来像撕开空气。
      if (t > 0.055 && w.trail > 0) {
        const trailFade = clamp((t - 0.055) * 5.5, 0, 1) * fade * w.trail;
        const gap = lerp(1.2, w.style === 'burst' ? 7.5 : 5.2, ease) * w.power;
        const trailRadius = Math.max(w.from * w.power * 0.35, radius - gap);
        this.drawArcLayer(
          shapes,
          w,
          trailRadius,
          segments,
          closed,
          thickness * 0.52,
          rgba(tint.r, tint.g, tint.b, Math.round(150 * trailFade)),
          bias,
          toScreen,
          jagged * 0.5,
          -0.01,
          w.style !== 'ring',
        );
        if (w.style === 'surge') {
          this.drawArcLayer(
            shapes,
            w,
            Math.max(w.from * w.power * 0.2, trailRadius - gap * 0.62),
            segments,
            closed,
            thickness * 0.27,
            rgba(hot.r, hot.g, hot.b, Math.round(105 * trailFade)),
            bias,
            toScreen,
            0,
            -0.02,
            true,
          );
        }
      }

      this.drawEnergySpikes(shapes, w, radius, thickness, alpha, bias, toScreen);

      // 落点那一下的白闪，只活最初的五分之一段。它和向外跑的弧是两件事：弧说的是能量
      // 去了哪儿，闪说的是它从哪儿出来的。
      const flash = clamp(1 - t / (w.overhead ? 0.34 : 0.2), 0, 1) * w.flash;
      if (flash > 0.01) {
        const center = toScreen(w.x, w.y);
        const fr = lerp(2.2, 5.5, ease) * w.power * w.weight * scale;
        shapes.ellipse(
          center,
          fr * 1.9,
          fr * Projection.groundSquash * 1.9,
          0,
          rgba(tint.r, tint.g, tint.b, Math.round(90 * flash * flash)),
          center.y * Projector.DEPTH_PER_ROW + bias - 0.01,
        );
        shapes.ellipse(
          center,
          fr,
          fr * Projection.groundSquash,
          0,
          rgba(255, 252, 238, Math.round(235 * flash * flash)),
          center.y * Projector.DEPTH_PER_ROW + bias,
        );
      }
    }
  }

  /** 一层弧；broken 用稳定缺口把余波切成能量碎片，而不是另一条完整圆线。 */
  private drawArcLayer(
    shapes: ShapeBatch,
    w: Shockwave,
    radius: number,
    segments: number,
    closed: boolean,
    thickness: number,
    color: Rgba,
    bias: number,
    toScreen: (wx: number, wy: number) => { x: number; y: number },
    jagged: number,
    depthOffset: number,
    broken = false,
  ): void {
    let prev = this.arcPoint(w, radius + this.edgeNoise(w, 0) * jagged, 0, toScreen);
    for (let i = 1; i <= segments; i++) {
      const u = i / segments;
      const next = this.arcPoint(w, radius + this.edgeNoise(w, u) * jagged, u, toScreen);
      const mid = (i - 0.5) / segments;
      const taper = closed ? 1 : Math.pow(Math.sin(Math.PI * mid), 0.62);
      const pulse = 0.88 + 0.12 * Math.sin(i * 2.73 + w.seed * 1.91);
      const segWidth = thickness * taper * pulse;
      const gap = broken && ((i + w.seed * 3) % 9 === 0 || (i + w.seed) % 13 === 0);
      if (!gap && segWidth > 0.3) {
        const rowDepth = (prev.y + next.y) * 0.5 * Projector.DEPTH_PER_ROW + bias + depthOffset;
        shapes.bar(prev, next, segWidth, color, rowDepth);
      }
      prev = next;
    }
  }

  /** 波前刺出的短芒与脱离火花，是“震”与“碎”的来源。 */
  private drawEnergySpikes(
    shapes: ShapeBatch,
    w: Shockwave,
    radius: number,
    thickness: number,
    alpha: number,
    bias: number,
    toScreen: (wx: number, wy: number) => { x: number; y: number },
  ): void {
    const t = clamp(w.age / w.life, 0, 1);
    if (t < 0.035 || t > 0.82) return;
    const baseCount = w.style === 'burst' ? 16 : w.style === 'ring' ? 10 : w.style === 'surge' ? 8 : 6;
    const count = Math.round(baseCount * w.sparks);
    if (count <= 0) return;
    const sparkAlpha = Math.round(alpha * clamp((0.82 - t) * 1.8, 0, 1));
    const tint = w.tint;
    const closed = w.span >= Math.PI * 1.98;
    for (let i = 0; i < count; i++) {
      const h = this.hash(w.seed * 37 + i * 101);
      const distributed = (i + 0.24 + h * 0.52) / count;
      const u = closed ? distributed - Math.floor(distributed) : clamp(distributed, 0.04, 0.96);
      const angle = w.heading + (u - 0.5) * w.span;
      const inner = radius - (1.1 + h * 1.7) * w.power;
      const reach = (w.style === 'burst' ? 6.8 : 4.1) * (0.55 + h * 0.8) * w.power * (1 - t * 0.35);
      const outer = radius + reach;
      const a = toScreen(w.x + Math.cos(angle) * inner, w.y + Math.sin(angle) * inner);
      const b = toScreen(w.x + Math.cos(angle) * outer, w.y + Math.sin(angle) * outer);
      const depth = (a.y + b.y) * 0.5 * Projector.DEPTH_PER_ROW + bias + 0.04;
      shapes.bar(
        a,
        b,
        Math.max(0.7, thickness * (0.1 + h * 0.08)),
        rgba(tint.r, tint.g, tint.b, sparkAlpha),
        depth,
      );

      if ((i + w.seed) % 3 === 0) {
        const sparkR = outer + (2.2 + h * 3.5) * w.power;
        const center = toScreen(w.x + Math.cos(angle) * sparkR, w.y + Math.sin(angle) * sparkR);
        const tangent = angle + Math.PI * 0.5;
        const half = (0.7 + h * 1.3) * Math.max(1, thickness * 0.13);
        const p0 = v2(
          center.x - Math.cos(tangent) * half,
          center.y - Math.sin(tangent) * half * Projection.groundSquash,
        );
        const p1 = v2(
          center.x + Math.cos(tangent) * half,
          center.y + Math.sin(tangent) * half * Projection.groundSquash,
        );
        shapes.bar(p0, p1, Math.max(0.75, thickness * 0.1), rgba(255, 248, 220, sparkAlpha), depth + 0.01);
      }
    }
  }

  private edgeNoise(w: Shockwave, u: number): number {
    return Math.sin(u * Math.PI * 18 + w.seed * 2.17) * 0.58 + Math.sin(u * Math.PI * 31 - w.seed * 0.73) * 0.42;
  }

  private hash(n: number): number {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  /** 弧上参数 u（0..1，从一端扫到另一端）处的屏幕点。 */
  private arcPoint(
    w: Shockwave,
    radius: number,
    u: number,
    toScreen: (wx: number, wy: number) => { x: number; y: number },
  ): { x: number; y: number } {
    const angle = w.heading + (u - 0.5) * w.span;
    return toScreen(w.x + Math.cos(angle) * radius, w.y + Math.sin(angle) * radius);
  }
}

/**
 * 武器这一击落在世界地面的哪一点。
 *
 * 从姿势里真正的武器末端推出来，而不是"人身前固定若干单位" —— 后者在动作参数一改就和
 * 画面对不上，而这类偏差恰恰是最难查的：特效本身没问题，只是位置不对。
 *
 * 姿势是身体局部坐标（x = 右，y = 前），这里用的基和 Projector.ground 完全相同。
 */
export function weaponImpactPoint(
  pose: Pose,
  def: UnitDef,
  actorX: number,
  actorY: number,
  facing: number,
): { x: number; y: number } {
  const reach = def.weapon === 'hammer' ? hammerLength(def) : 0;

  // 双持取两个锤头的中点；单持就是那一个。
  let localX = pose.weaponGrip.x + pose.weaponDir.x * reach;
  let localY = pose.weaponGrip.y + pose.weaponDir.y * reach;
  if (def.dualWield) {
    localX = (localX + pose.offhandGrip.x + pose.offhandDir.x * reach) * 0.5;
    localY = (localY + pose.offhandGrip.y + pose.offhandDir.y * reach) * 0.5;
  }

  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  return {
    x: actorX + localX * sin + localY * cos,
    y: actorY - localX * cos + localY * sin,
  };
}
