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
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  const dist = Math.hypot(dx, dy);

  // 范围按目标的身体半径放宽：判的是能不能够到那个人，不是能不能够到他的中心点。
  if (dist > attacker.def.attackRange + target.radius) return false;

  // 贴在身上的时候方向没有意义 —— 一个把你抱住的人在所有方向上都在。
  if (dist <= target.radius) return true;

  // 角度差绕回 [-PI, PI]，免得在 ±PI 那条缝上漏判；再按目标半径在这个距离上张开的角度
  // 放宽，判的是圆和扇形相不相交，不是一个数学点在不在扇形里。
  let da = Math.atan2(dy, dx) - attacker.facing;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return Math.abs(da) <= attacker.def.attackArc * 0.5 + Math.atan2(target.radius, dist);
}
