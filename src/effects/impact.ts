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
}

export interface ShockwaveOptions {
  life?: number;
  from?: number;
  to?: number;
  span?: number;
  power?: number;
  weight?: number;
  overhead?: boolean;
  tint?: Rgba;
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

  get count(): number {
    return this.waves.length;
  }

  /**
   * @param heading 推进方向的角度，和 actor.facing 用同一套地面坐标。
   */
  spawn(x: number, y: number, heading: number, options: ShockwaveOptions = {}): void {
    this.waves.push({
      x,
      y,
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
    });
  }

  update(dt: number): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.age += dt;
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

      // 弧一边跑一边变薄。宽度不用管：张角固定，弧长随半径自己长出去，这正是"越跑越宽"。
      const thickness = lerp(3.4, 1.0, t) * w.power * w.weight * scale;

      const tint = w.tint;
      const bright = rgba(tint.r, tint.g, tint.b, alpha);
      const dark = rgba(58, 46, 32, Math.round(alpha * 0.7));
      const bias = w.overhead ? DEPTH_OVERHEAD : DEPTH_GROUND_FX;

      // 整圈的弧没有"两端"，收细只会在接缝处切出一道细缝。
      const closed = w.span >= Math.PI * 1.98;
      const segments = arcSegments(w.span);

      let prev = this.arcPoint(w, radius, 0, toScreen);
      for (let i = 1; i <= segments; i++) {
        const next = this.arcPoint(w, radius, i / segments, toScreen);

        // 两端收细。粗细均匀的弧两头是两个突兀的方头，读作一段管子；收细之后它才是一道
        // 中间最强、往两侧耗散的波前。
        const mid = (i - 0.5) / segments;
        const taper = closed ? 1 : Math.pow(Math.sin(Math.PI * mid), 0.7);
        const segWidth = thickness * taper;

        if (segWidth > 0.35) {
          // 每一段按自己的屏幕行取深度：弧横跨好几行，站在弧中间的人应该压住身后那半段、
          // 被身前那半段压住。整条弧共用一个深度的话，人要么整个浮在弧上，要么整个沉下去。
          const rowDepth = (prev.y + next.y) * 0.5 * Projector.DEPTH_PER_ROW + bias;
          shapes.bar(prev, next, segWidth * 1.7, dark, rowDepth);
          shapes.bar(prev, next, segWidth, bright, rowDepth + 0.01);
        }
        prev = next;
      }

      // 落点那一下的白闪，只活最初的五分之一段。它和向外跑的弧是两件事：弧说的是能量
      // 去了哪儿，闪说的是它从哪儿出来的。
      const flash = clamp(1 - t / (w.overhead ? 0.34 : 0.2), 0, 1);
      if (flash > 0.01) {
        const center = toScreen(w.x, w.y);
        const fr = lerp(2.2, 5.5, ease) * w.power * w.weight * scale;
        shapes.ellipse(
          center,
          fr,
          fr * Projection.groundSquash,
          0,
          rgba(255, 250, 232, Math.round(210 * flash * flash)),
          center.y * Projector.DEPTH_PER_ROW + bias - 0.01,
        );
      }
    }
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
