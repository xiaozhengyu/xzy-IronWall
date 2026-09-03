import type { Character } from './character';

/**
 * 攻击判定：以攻击者为圆心、朝向为轴的一个扇形，发招那一刻在里面就算中。
 *
 * 不做武器的几何碰撞，这是刻意的。真按武器扫过的形状判会带来两个问题：判定跟着动画的
 * 每一次微调一起漂移（改一个手部姿势的高度就可能让一整套招式打不中人），而且"看着中了
 * 却没中"会非常频繁 —— 一把从俯视角看只有几像素宽的剑，玩家对它到底扫过哪里没有可靠
 * 直觉。扇形判定和玩家心里的预期一致：朝那边挥，那边的人就倒。
 *
 * 敌我用的是同一个函数。玩家凭什么打中，敌人就凭什么打中，谁也不吃暗亏。
 */
export function inAttackArc(attacker: Character, target: Character): boolean {
  return inSector(attacker, target, attacker.def.attackRange, attacker.def.attackArc);
}

/**
 * 同一个扇形判定，但范围和张角由外面给 —— 技能用这条路（见 game/skills.ts）。
 *
 * 拆出来而不是给 inAttackArc 加两个可选参数：敌人和玩家的基础攻击走的是"按兵种属性判"，
 * 技能走的是"按这一招判"，两者读起来是两件事。而且整圈技能传的 arc 是 2π，落到
 * `|da| <= arc/2` 上恒真 —— 那条角度分支对它根本没有意义，写成一个通用函数反而更清楚
 * 它只是"半径 + 张角"这么简单。
 */
export function sweptBy(
  target: Character,
  x: number,
  y: number,
  heading: number,
  radius: number,
  arc: number,
  nearHalfWidth = 0,
): boolean {
  const dx = target.x - x;
  const dy = target.y - y;
  const dist = Math.hypot(dx, dy);

  // 判的是"波前已经越过他了没有"，不是"他正好在波前那一圈上"。
  //
  // 带状判定（|dist - radius| < 厚度）在低帧率下会直接漏人：波一帧推进十几个单位，带子
  // 才两三个单位宽，中间的人就被跳过去了。改成"半径以内"之后不会漏 —— 上一帧就在里面
  // 的人早就死了，所以实际效果仍然是一圈一圈往外扫。
  if (dist > radius + target.radius) return false;
  if (dist <= target.radius) return true;

  let da = Math.atan2(dy, dx) - heading;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  if (Math.abs(da) <= arc * 0.5 + Math.atan2(target.radius, dist)) return true;

  /*
   * 扇形之外再补一条**等宽的走廊**。
   *
   * 一个纯扇形在圆心附近窄得没有意义：张角 0.9 弧度的波，在离落点十个单位处只有八九个
   * 单位宽 —— 一个人的位置。于是玩家看到的是"波飞出去之后横扫一大片，可脚底下只死了一两
   * 个"，而那一两个恰恰是他正对着的、最该死的。
   *
   * 补一条固定半宽的走廊，近处按走廊算、远处按扇形算（两者取并集，交界处自然过渡到扇形
   * 更宽的那一侧）。这不是"把张角调大"——调大张角会让远端宽得离谱，而远端本来就够宽了。
   */
  if (nearHalfWidth <= 0) return false;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const along = dx * cos + dy * sin;
  if (along < 0 || along > radius) return false;
  const perp = Math.abs(-dx * sin + dy * cos);
  return perp <= nearHalfWidth + target.radius;
}

export function inSector(
  attacker: Character,
  target: Character,
  range: number,
  arc: number,
): boolean {
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  const dist = Math.hypot(dx, dy);

  // 范围按目标的身体半径放宽：判的是能不能够到那个人，不是能不能够到他的中心点。
  if (dist > range + target.radius) return false;

  // 贴在身上的时候方向没有意义 —— 一个把你抱住的人在所有方向上都在。
  if (dist <= target.radius) return true;

  // 角度差绕回 [-PI, PI]，免得在 ±PI 那条缝上漏判；再按目标半径在这个距离上张开的角度
  // 放宽，判的是圆和扇形相不相交，不是一个数学点在不在扇形里。
  let da = Math.atan2(dy, dx) - attacker.facing;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return Math.abs(da) <= arc * 0.5 + Math.atan2(target.radius, dist);
}
