import { drawCharacterUpperBody } from '../characters/renderer';
import { flatPalette, type CharacterPalette } from '../characters/palette';
import type { Character } from '../game/character';
import { clamp, v2, type Vec2 } from '../core/math';
import { rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/** 法相主体：保留金铜、暗金和暖白三个层次，透明度足够让中央的玩家完整露出来。 */
const DHARMA_PALETTE: CharacterPalette = {
  ...flatPalette(rgba(220, 126, 22, 54)),
  skin: rgba(255, 183, 57, 58),
  skinShade: rgba(154, 72, 10, 62),
  skinLight: rgba(255, 231, 148, 72),
  hair: rgba(116, 51, 7, 64),
  hairLight: rgba(238, 143, 26, 66),
  cloth: rgba(200, 103, 13, 48),
  clothShade: rgba(112, 46, 5, 58),
  clothLight: rgba(255, 174, 45, 62),
  leather: rgba(176, 83, 10, 54),
  leatherDark: rgba(88, 35, 4, 62),
  leatherLight: rgba(247, 156, 35, 62),
  steel: rgba(255, 207, 83, 58),
  steelShade: rgba(158, 82, 11, 62),
  steelDark: rgba(91, 36, 4, 66),
  steelLight: rgba(255, 241, 171, 76),
  trim: rgba(255, 229, 132, 78),
  felt: rgba(155, 70, 8, 58),
  feltShade: rgba(80, 28, 3, 64),
  feltLight: rgba(244, 149, 27, 64),
  binding: rgba(255, 222, 124, 72),
  plume: rgba(255, 204, 72, 72),
  plumeShade: rgba(151, 72, 8, 62),
};

const DHARMA_GLOW = flatPalette(rgba(255, 211, 104, 34));
const RIM_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * 用玩家此刻的上半身模型画出随身法相。
 *
 * 大模型的胯部锚在玩家脚下稍低处，因此袍摆包住玩家下半身、头肩罩住玩家上半身。投影器直接
 * 使用 player.facing，所以这不是一张朝向固定的贴图：转身时肩宽、头盔侧面和双臂遮挡都会跟着
 * 改变。
 */
export function drawDharmaAspect(
  shapes: ShapeBatch,
  player: Character,
  at: Vec2,
  grain: number,
  left: number,
  total: number,
): void {
  const age = total - left;
  const appear = 1 - (1 - clamp(age / 0.22, 0, 1)) ** 3;
  const breathe = 1 + Math.sin(age * 2.4) * 0.012;
  const scale = grain * (2.25 + appear * 0.7) * breathe;

  // 最后 0.7 秒短促明灭，提示外壳即将消失。
  if (left < 0.7 && Math.sin((0.7 - left) * 28) < -0.45) return;

  // 先在原点求出放大后胯部的屏幕偏移，再反推根节点，使法相的袍摆始终落在玩家脚边。
  const probe = new Projector(v2(0, 0), player.facing, Projection.groundSquash, scale);
  const hip = probe.screen(player.pose.hip);
  const root = v2(at.x - hip.x, at.y - hip.y + grain * 1.5);
  const rim = Math.max(1.5, grain * 0.8);

  // 四向淡金轮廓让半透明外壳在敌群中仍然完整，但不额外画圆环、佛像或独立护罩。
  for (const [dx, dy] of RIM_OFFSETS) {
    const p = new Projector(
      v2(root.x + dx * rim, root.y + dy * rim),
      player.facing,
      Projection.groundSquash,
      scale,
      at.y,
    );
    drawCharacterUpperBody(shapes, player.pose, p, DHARMA_GLOW, player.def, { silhouette: true });
  }

  drawCharacterUpperBody(
    shapes,
    player.pose,
    new Projector(root, player.facing, Projection.groundSquash, scale, at.y),
    DHARMA_PALETTE,
    player.def,
    { silhouette: true },
  );
}
