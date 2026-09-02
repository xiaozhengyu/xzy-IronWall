import { type Rgba, rgb } from '../render/color';

/**
 * 一个单位身上所有的颜色。移植自 overlord 的 CharacterPalette。
 *
 * 每种材质两个值，不是三个，而且两个值之间的落差很大。
 *
 * 原本每种材质都带阴影、中间、高光三档。那是给大面积上色的做法，而对一个只有八像素宽的
 * 东西恰好完全错误：三个值塞进一条肢体里各占一个像素，眼睛会直接把它们平均回一个柔和的
 * 单色，人物于是读作模压塑料。参考美术把调色板花在另一个方向上 —— 每个部件是一块平涂，
 * 对比留在部件之间：浅色盔顶压深色盔檐、深色盔檐压明亮的脸、明亮的脸压中灰的锁甲。
 * 这个在任何尺寸下都读得出来，因为一个硬边台阶哪怕只有一像素宽，它仍然是个台阶。
 *
 * 所以 Light 系列大多等于对应的中间色。保留字段是因为确实有少数几个地方需要真正的第三个
 * 值 —— 头盔顶上的那道亮条、盾牌的边 —— 那些是刻意挑出来的，不是到处铺的。
 */
export interface CharacterPalette {
  skin: Rgba;
  skinShade: Rgba;
  skinLight: Rgba;
  hair: Rgba;
  hairLight: Rgba;

  /** 罩袍 / 外衣：阵营色。 */
  cloth: Rgba;
  clothShade: Rgba;
  clothLight: Rgba;

  leather: Rgba;
  leatherDark: Rgba;
  leatherLight: Rgba;

  steel: Rgba;
  steelShade: Rgba;
  steelDark: Rgba;
  steelLight: Rgba;
  /** 重甲上的金色包边。 */
  trim: Rgba;

  /**
   * 没有头盔的兵戴的软帽。用自己的色阶而不是头发的提亮版：提亮过的头骨是一个光滑的浅色
   * 球，没有帽檐、上面什么也没有，二十像素下读作一个发髻而不是一颗头。毡料加上浅色系带
   * 能让同一个轮廓有深色圆顶、亮线和一弯皮肤 —— 五个像素里三个值，这才让它读作"戴着
   * 东西的头"。
   */
  felt: Rgba;
  feltShade: Rgba;
  feltLight: Rgba;
  binding: Rgba;

  plume: Rgba;
  plumeShade: Rgba;
  wood: Rgba;
  woodDark: Rgba;
  shieldFace: Rgba;
  shieldRim: Rgba;
}

const base = (): Omit<CharacterPalette, 'cloth' | 'clothShade' | 'clothLight' | 'plume' | 'plumeShade' | 'shieldFace' | 'shieldRim'> => ({
  // 皮肤是一块平涂。它是人物身上最亮的东西，也是指明这人朝哪儿看的那块面板，绝不能被打碎。
  skin: rgb(232, 194, 152),
  skinShade: rgb(150, 112, 80),
  skinLight: rgb(232, 194, 152),

  hair: rgb(58, 40, 28),
  hairLight: rgb(58, 40, 28),

  leather: rgb(92, 66, 42),
  leatherDark: rgb(44, 30, 20),
  leatherLight: rgb(92, 66, 42),

  felt: rgb(62, 58, 72),
  feltShade: rgb(30, 28, 38),
  feltLight: rgb(62, 58, 72),
  binding: rgb(198, 188, 164),

  // 钢是唯一保留四个真实色阶的材质：它得同时撑起盔顶、盔身、盔檐线和贴着它们的锁甲。
  steel: rgb(172, 178, 190),
  steelShade: rgb(112, 118, 132),
  steelDark: rgb(46, 50, 62),
  steelLight: rgb(216, 222, 234),
  trim: rgb(206, 168, 78),

  wood: rgb(120, 86, 54),
  woodDark: rgb(62, 44, 28),
});

/** 玩家阵营。 */
export const PALETTE_BLUE: CharacterPalette = {
  ...base(),
  cloth: rgb(56, 92, 172),
  clothShade: rgb(26, 42, 96),
  clothLight: rgb(56, 92, 172),
  plume: rgb(72, 116, 208),
  plumeShade: rgb(30, 48, 112),
  shieldFace: rgb(64, 100, 176),
  shieldRim: rgb(180, 186, 198),
};

/** 敌方阵营。 */
export const PALETTE_RED: CharacterPalette = {
  ...base(),
  cloth: rgb(168, 56, 48),
  clothShade: rgb(84, 24, 24),
  clothLight: rgb(168, 56, 48),
  plume: rgb(198, 72, 58),
  plumeShade: rgb(92, 26, 24),
  shieldFace: rgb(170, 58, 50),
  shieldRim: rgb(180, 186, 198),
};

/** 无甲杂兵：没有阵营染色，只有本色麻布。 */
export const PALETTE_PEASANT: CharacterPalette = {
  ...base(),
  hair: rgb(88, 60, 34),
  hairLight: rgb(88, 60, 34),
  cloth: rgb(148, 138, 114),
  clothShade: rgb(78, 72, 58),
  clothLight: rgb(148, 138, 114),
  plume: rgb(140, 130, 108),
  plumeShade: rgb(72, 66, 54),
  shieldFace: rgb(138, 116, 82),
  shieldRim: rgb(96, 78, 54),
};

export const paletteForFaction = (faction: number): CharacterPalette =>
  faction === 0 ? PALETTE_BLUE : PALETTE_RED;
