import { drawCharacter } from '../characters/renderer';
import type { CharacterPalette } from '../characters/palette';
import type { Character } from '../game/character';
import { v2, type Vec2 } from '../core/math';
import { rgb } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 神兵天降：一排金身重甲兵从天上砸下来，端着矛朝前推过去。
 *
 * 这个文件只管**长什么样**（金色、怎么落、怎么散），判定和推进在 battle.ts 的
 * advanceHeavenGuards 里。分开的理由和天地法相那边一样：牌面演示（ui/skillDemo）要用同一份
 * 画法，而它手上没有 Battle。
 *
 * 画的是**真的重甲兵**（unitAppearance('bulwark')），不是一个金色的形状：同一份骨架、同一套
 * 步态、同一杆锁死的长矛。玩家在人堆里见过这个轮廓 —— 那正是这一招要借的东西，金色只是说
 * "这一排是我召来的"。
 */

/**
 * 金身。
 *
 * 和天地法相那份（DHARMA_PALETTE）是两种东西：法相是罩在玩家身上的一层壳，半透明才能让
 * 里面的人露出来；这一排是**实打实站在地上的人**，透出草皮会让他们读作幻影，而这一招的
 * 卖点恰恰是"一堵会走的墙撞进人堆里"。所以这里全部不透明。
 *
 * 色值保留原调色板的**明暗次序**，只把色相全部压到金上：钢（甲、盔、盾沿）最亮、罩袍中间、
 * 盾面和杆子最暗。一整片同一个亮度的金子在出货尺寸下是一个金色的团，看不出哪儿是盾、哪儿
 * 是矛 —— 而这一招唯一要读出来的就是那排平举的矛。
 */
export const HEAVEN_GUARD_PALETTE: CharacterPalette = {
  skin: rgb(255, 226, 146),
  skinShade: rgb(186, 134, 38),
  skinLight: rgb(255, 240, 190),
  hair: rgb(150, 100, 24),
  hairLight: rgb(206, 148, 42),

  cloth: rgb(208, 150, 44),
  clothShade: rgb(122, 80, 16),
  clothLight: rgb(236, 184, 72),

  leather: rgb(158, 106, 26),
  leatherDark: rgb(88, 56, 12),
  leatherLight: rgb(196, 140, 40),

  // 钢是最亮的一档：甲、盔和盾沿加起来是这个人身上面积最大的金属，金身要亮就得亮在这儿。
  steel: rgb(244, 200, 88),
  steelShade: rgb(176, 124, 32),
  steelDark: rgb(98, 64, 14),
  steelLight: rgb(255, 242, 178),
  trim: rgb(255, 246, 200),

  felt: rgb(166, 114, 28),
  feltShade: rgb(92, 58, 12),
  feltLight: rgb(206, 150, 44),
  binding: rgb(255, 238, 168),

  plume: rgb(255, 216, 108),
  plumeShade: rgb(158, 104, 22),
  // 矛杆压暗一档：它横在最亮的那面盾前面，同一个亮度会让两样糊成一块。
  wood: rgb(168, 116, 30),
  woodDark: rgb(94, 60, 12),
  // 盾面比盾沿暗两档 —— 这一排从正面看过来就是五块带亮边的金板。
  shieldFace: rgb(190, 132, 36),
  shieldRim: rgb(246, 206, 96),

  horseCoat: rgb(176, 124, 32),
  horseShade: rgb(98, 64, 14),
  horseLight: rgb(214, 158, 48),
  horseMane: rgb(88, 56, 12),
};

/** 轮廓光那几遍刷的颜色。一个纯亮金，比金身本身还亮一档。 */
const GOLD_RIM: CharacterPalette = ((): CharacterPalette => {
  const glow = rgb(255, 238, 158);
  const flat: Record<string, unknown> = {};
  for (const key of Object.keys(HEAVEN_GUARD_PALETTE)) flat[key] = glow;
  return flat as unknown as CharacterPalette;
})();

const RIM_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * 从多高砸下来，世界单位。
 *
 * 30 是人身高（约 19）的一倍半。再高一点看着更壮观，但落点那一帧之前他整个人在画面外，
 * 玩家只会看到"地上凭空多了一排人"—— 而这一招的开场白正是那一下砸。
 */
export const HEAVEN_GUARD_DROP_HEIGHT = 30;

/**
 * 这一排横着排开时彼此隔多远，世界单位。
 *
 * 重甲兵的盾连边约 8.3 个单位宽，13 让盾与盾之间只剩一条缝 —— 读作一堵墙，而不是五个各走
 * 各的人。再密就互相穿模（他们不走人群分离，各走各的直线）。
 */
export const HEAVEN_GUARD_SPACING = 13;

/**
 * 这一排落在玩家身前多远，世界单位。
 *
 * 落在脚下的话第一帧就把玩家埋在五个人中间，谁也看不见谁；而太远就成了"在别处发生的事"。
 * 18 大约是两个身位：玩家站在队列后面半步，像个把人推出去的人。
 */
export const HEAVEN_GUARD_LEAD = 18;

/** 第 index 个（0 起）在这一排里的横向偏移，世界单位。左右对称，所以奇数个时正中那个偏移为 0。 */
export const heavenGuardOffset = (index: number, count: number): number =>
  (index - (count - 1) * 0.5) * HEAVEN_GUARD_SPACING;

/**
 * 还在天上时离地多高。t 是这一段的剩余比例，1 = 刚放出来，0 = 落地。
 *
 * 平方而不是线性：砸下来的东西是加速的，匀速落体读作"被吊着放下来"。
 */
export const heavenGuardFall = (t: number): number => HEAVEN_GUARD_DROP_HEIGHT * t * t;

/**
 * 画一个金身重甲兵。
 *
 * @param at    他脚下那一点在屏幕上的位置（落地之后的位置，不含滞空）。
 * @param lift  离地多高，世界单位。抬的是**画面**，不是姿势：整个人按投影往上挪，影子留在
 *              地上并按 lift 缩小（drawCharacter 自己做）。这一条让"他还在天上"这件事在
 *              俯视角里读得出来 —— 高和远在屏幕上是同一个方向的位移，只有影子能区分。
 * @param fade  收尾进度，1 = 还实心，0 = 该没了。小于 1 时开始明灭。
 */
export function drawHeavenGuard(
  shapes: ShapeBatch,
  guard: Character,
  at: Vec2,
  grain: number,
  lift: number,
  fade = 1,
): void {
  // 收尾不做淡出做明灭：这套渲染没有整体 alpha（要淡出就得每帧重建一整份调色板），而且
  // 一个"闪两下就没了"的金人比一个慢慢变透明的更像法术收了 —— 和天地法相收势那几帧同一条路。
  if (fade < 1 && Math.sin((1 - fade) * 34) < -0.3) return;

  // 抬起来的是屏幕位置，深度仍按脚下那一行算（Projector 的最后一个参数）：不这么做的话，
  // 一个从天上掉下来的人会因为屏幕位置偏上而被排到后排人的后面，落地那一瞬间又跳回前面。
  const top = v2(at.x, at.y - lift * Projection.heightSquash * grain);
  const off = Math.max(1, Math.round(grain * 0.4));

  for (const [dx, dy] of RIM_OFFSETS) {
    const p = new Projector(
      v2(top.x + dx * off, top.y + dy * off),
      guard.facing,
      Projection.groundSquash,
      grain,
      at.y - 0.5,
    );
    drawCharacter(shapes, guard.pose, p, GOLD_RIM, guard.def, { silhouette: true });
  }

  drawCharacter(
    shapes,
    guard.pose,
    new Projector(top, guard.facing, Projection.groundSquash, grain, at.y),
    // 用他自己身上那份，不是这里的模块常量：召出来的那个 Character 本来就拿着
    // HEAVEN_GUARD_PALETTE（见 battle.ts 的 castSkill），两边读同一个来源就不会有"改了金色却
    // 只改对一半"这种事。
    guard.palette,
    guard.def,
    { lift },
  );
}
