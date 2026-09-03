import type { Pose } from '../characters/rig';
import { type UnitDef, hammerLength } from '../characters/unitDef';
import { clamp, lerp, v2 } from '../core/math';
import { rgba } from '../render/color';
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
}

export interface ShockwaveOptions {
  life?: number;
  from?: number;
  to?: number;
  span?: number;
  power?: number;
}

/** 冲击波在深度上的位置：压在地面投影和影子之上，但在人的腿之下。 */
const DEPTH_GROUND_FX = -18;

/** 弧上取多少段。太少弧会读成折线，太多纯属浪费 —— 一道弧就是几十个图元。 */
const ARC_SEGMENTS = 16;

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
      const alpha = Math.round(240 * Math.pow(fade, 1.3));
      if (alpha <= 2) continue;

      // 弧一边跑一边变薄。宽度不用管：张角固定，弧长随半径自己长出去，这正是"越跑越宽"。
      const thickness = lerp(3.4, 1.0, t) * w.power * scale;

      const bright = rgba(252, 244, 220, alpha);
      const dark = rgba(58, 46, 32, Math.round(alpha * 0.7));

      let prev = this.arcPoint(w, radius, 0, toScreen);
      for (let i = 1; i <= ARC_SEGMENTS; i++) {
        const next = this.arcPoint(w, radius, i / ARC_SEGMENTS, toScreen);

        // 两端收细。粗细均匀的弧两头是两个突兀的方头，读作一段管子；收细之后它才是一道
        // 中间最强、往两侧耗散的波前。
        const mid = (i - 0.5) / ARC_SEGMENTS;
        const taper = Math.pow(Math.sin(Math.PI * mid), 0.7);
        const segWidth = thickness * taper;

        if (segWidth > 0.35) {
          // 每一段按自己的屏幕行取深度：弧横跨好几行，站在弧中间的人应该压住身后那半段、
          // 被身前那半段压住。整条弧共用一个深度的话，人要么整个浮在弧上，要么整个沉下去。
          const rowDepth = (prev.y + next.y) * 0.5 * Projector.DEPTH_PER_ROW + DEPTH_GROUND_FX;
          shapes.bar(prev, next, segWidth * 1.7, dark, rowDepth);
          shapes.bar(prev, next, segWidth, bright, rowDepth + 0.01);
        }
        prev = next;
      }

      // 落点那一下的白闪，只活最初的五分之一段。它和向外跑的弧是两件事：弧说的是能量
      // 去了哪儿，闪说的是它从哪儿出来的。
      const flash = clamp(1 - t / 0.2, 0, 1);
      if (flash > 0.01) {
        const center = toScreen(w.x, w.y);
        const fr = lerp(2.2, 5.5, ease) * w.power * scale;
        shapes.ellipse(
          center,
          fr,
          fr * Projection.groundSquash,
          0,
          rgba(255, 250, 232, Math.round(210 * flash * flash)),
          center.y * Projector.DEPTH_PER_ROW + DEPTH_GROUND_FX - 0.01,
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
