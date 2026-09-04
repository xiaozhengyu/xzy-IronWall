import { clamp, v2, type Vec2 } from '../core/math';
import { type Rgba, rgba } from '../render/color';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 穿云箭飞的那把**大剑**。
 *
 * 招式本身是玩家写的（见 Battle 的 skyArrow）：起手冲天出屏，0.8 秒后在当前视口里抽一个
 * 落点，从天而降砸下去再炸一圈。原来天上掉下来的是一支小箭 —— 一根细杆加两撇倒钩，在满屏
 * 几百个人的画面里读作一根牙签。这一招要等将近一秒才落地，等待本身就是在给它攒份量，掉下来
 * 的东西必须配得上那个等待。
 *
 * 换成一把约三个人高的巨剑：有刃、有血槽、有护手、有柄。它是一个**物体**而不是一道光，
 * 眼睛对"一个东西"的敏感度远高于对"一片亮度"。
 *
 * 这个文件只管画。剑在哪儿、什么朝向由 skyArrowBlade 从招式状态算出来，运行时的 Scene 和
 * 离线的 tools/preview.ts 都调它 —— 位置逻辑只有一份，两边不会画到不同的地方去。
 */

/** 各部件沿"剑尖 → 柄尾"这条轴的位置，0 = 剑尖，1 = 柄尾。 */
// 刃占七成半、柄占两成，护手在两者交界。剑之所以是剑，一多半是这个比例定的 —— 刃短了
// 读作匕首，柄长了读作长柄武器。
const GUARD_AT = 0.74;
const GRIP_END = 0.95;
/** 刃从护手往剑尖收到多细。1 = 不收（读作铁棍），0 = 收成针。 */
const TIP_TAPER = 0.42;

export function drawSkyBlade(
  shapes: ShapeBatch,
  /** 剑尖在缓冲里的位置。 */
  tip: Vec2,
  /** 柄尾在缓冲里的位置。 */
  butt: Vec2,
  /** 垂直于剑身的单位向量（缓冲空间，已含地面压扁）。 */
  side: Vec2,
  /** 刃有多宽，缓冲像素。 */
  width: number,
  alpha: number,
  tint: Rgba,
  depth: number,
): void {
  if (alpha <= 3) return;

  const at = (t: number): Vec2 => v2(tip.x + (butt.x - tip.x) * t, tip.y + (butt.y - tip.y) * t);
  const off = (p: Vec2, k: number): Vec2 => v2(p.x + side.x * k, p.y + side.y * k);

  const guard = at(GUARD_AT);
  const gripEnd = at(GRIP_END);
  /** 刃身中段。收尖分两段做：一段等宽一段收窄，比一路线性收更像剑。 */
  const mid = at(GUARD_AT * 0.42);

  const dark = rgba(18, 26, 40, Math.round(alpha * 0.92));
  const steel = rgba(tint.r, tint.g, tint.b, alpha);
  const shade = rgba(
    Math.round(tint.r * 0.62),
    Math.round(tint.g * 0.66),
    Math.round(tint.b * 0.72),
    alpha,
  );
  const light = rgba(255, 255, 255, alpha);
  const gold = rgba(246, 206, 96, alpha);

  // 描边先画，而且只比刃宽一点点。
  //
  // 第一版给了 1.55 倍，加上柄那一段 0.85 倍的黑边比柄本身还粗 —— 整把剑读作"一根黑棍加
  // 一道金杠"。描边的作用是在花底色上切出轮廓，不是当主体，所以 1.22 就够。
  // 描边**分段跟着刃走**。第一版整条按最宽处画，而刃往剑尖收到 0.42 —— 于是靠近剑尖那半段
  // 是"一条粗黑边裹着一根细白线"，整把剑越往前越像根黑棍。描边只该比它包住的东西宽一点点。
  shapes.bar(mid, guard, width * 1.22, dark, depth);
  shapes.bar(tip, mid, width * TIP_TAPER * 1.5, dark, depth);
  shapes.bar(guard, gripEnd, width * 0.5, dark, depth);

  // 刃：护手那半段等宽，往剑尖收到 TIP_TAPER。
  shapes.bar(mid, guard, width, steel, depth + 0.01);
  shapes.bar(tip, mid, width * TIP_TAPER, steel, depth + 0.01);

  // 血槽：顺着刃身中线的一道暗痕。它是让一块平涂的钢读成"一片刀"最省的一笔 —— 少了它，
  // 这么宽的刃就是一张灰纸片。
  shapes.bar(mid, guard, width * 0.2, shade, depth + 0.02);

  // 贴着单侧的亮边，压在血槽之上。刃的体积由"亮边 + 血槽"这两条线撑起来。
  shapes.bar(off(mid, -width * 0.34), off(guard, -width * 0.34), width * 0.2, light, depth + 0.03);

  // 护手：垂直于剑身的一道横档，往两边各探出一个刃宽。
  //
  // 第一版给了 ±1.7 个刃宽 —— 刃才宽 11 个单位，护手却横跨 37，比刃长的一半还多，整把剑
  // 读作"一根金柱穿了块铁片"。护手是配角，探出一个刃宽就够认了。
  shapes.bar(off(guard, -width * 1.05), off(guard, width * 1.05), width * 0.66, dark, depth + 0.04);
  shapes.bar(off(guard, -width * 0.92), off(guard, width * 0.92), width * 0.4, gold, depth + 0.05);

  // 柄和柄尾。
  shapes.bar(guard, gripEnd, width * 0.34, rgba(112, 78, 46, alpha), depth + 0.03);
  shapes.disc(gripEnd, width * 0.3, gold, depth + 0.05);
}

/** 一把剑此刻摆在哪儿。null = 这一刻不该画（箭已出屏、还没落下来的那段空拍）。 */
export interface BladePose {
  tip: Vec2;
  butt: Vec2;
  side: Vec2;
  width: number;
  alpha: number;
}

/** 剑有多长多宽，世界单位。约三个人高（人高 19）。 */
export const SKY_BLADE_LENGTH = 54;
// 12 而不是 9.5：俯冲段大半程只看得到刃身（柄还在画面上方），此时"是不是一把大剑"全靠
// 刃的宽度说话。窄了就读作一道光柱。
export const SKY_BLADE_WIDTH = 12;

/** 冲天段和俯冲段各占多久，秒。和 Battle 里 skyArrow 的时间轴对齐。 */
const RISE_TIME = 0.18;
const FALL_START = 0.8;
const FALL_TIME = 0.28;

/**
 * 穿云箭这一刻的剑。
 *
 * 冲天段剑尖朝上（它正往上飞），俯冲段剑尖朝下（它正往下砸）—— 剑尖永远指着运动方向，
 * 这是"飞出去的东西"和"掉下来的东西"在画面上唯一的区别。
 *
 * 竖直摆位，所以侧向就是屏幕的水平轴：这一招是垂直起落的，不吃地面那套压扁。
 *
 * @param playerAt 玩家脚下在缓冲里的位置（冲天段从这里出发）
 * @param groundAt 落点在缓冲里的位置（俯冲段砸向这里）
 * @param screenH  缓冲高度，用来把剑送出屏幕顶
 */
export function skyArrowBlade(
  age: number,
  playerAt: Vec2,
  groundAt: Vec2,
  screenH: number,
  grain: number,
): BladePose | null {
  const length = SKY_BLADE_LENGTH * grain;
  const width = SKY_BLADE_WIDTH * grain;
  const side = v2(1, 0);

  if (age < RISE_TIME) {
    // 冲天：从玩家脚下一路冲出屏幕顶。越到后面越淡 —— 它是"飞走了"，不是"消失了"。
    const t = age / RISE_TIME;
    const y = playerAt.y - t * (screenH + length);
    return { tip: v2(playerAt.x, y - length), butt: v2(playerAt.x, y), side, width, alpha: Math.round(235 * (1 - t * 0.5)) };
  }

  if (age < FALL_START) return null; // 空拍：人在等天外一剑。

  const t = Math.min((age - FALL_START) / FALL_TIME, 1);
  // 剑尖一开始就压着屏幕顶进来，不是从"屏幕顶再往上一整个剑长"的位置出发。
  //
  // 后者听着更"物理"，实际是：整个俯冲只有 0.28 秒，而剑本身就有一屏的三分之一长 —— 从
  // 一整个剑长之外出发的话，大半程剑还在画面上方，玩家只在最后两三帧看到它。让剑尖贴着
  // 顶边入场，整段俯冲都是可见的。
  const ENTER = length * 0.15;
  const tipY = -ENTER + (groundAt.y + ENTER) * t;
  return {
    tip: v2(groundAt.x, tipY),
    butt: v2(groundAt.x, tipY - length),
    side,
    width,
    alpha: 235,
  };
}

/**
 * 开天使用的地面飞剑姿态。剑尖、柄尾都已经由 Scene 投影到缓冲空间；这里只补出与剑身垂直
 * 的宽度轴，以及出现、消失时很短的淡入淡出。剑的具体造型仍由 drawSkyBlade 统一绘制。
 */
export function heavenSplitBlade(
  age: number,
  left: number,
  butt: Vec2,
  tip: Vec2,
  grain: number,
): BladePose {
  const dx = tip.x - butt.x;
  const dy = tip.y - butt.y;
  const length = Math.hypot(dx, dy) || 1;
  const enter = clamp(age / 0.06, 0, 1);
  const exit = clamp(left / 0.1, 0, 1);
  return {
    tip,
    butt,
    side: v2(-dy / length, dx / length),
    width: SKY_BLADE_WIDTH * grain,
    alpha: Math.round(235 * enter * exit),
  };
}
