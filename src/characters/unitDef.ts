/**
 * 让一个单位看起来不同于另一个的全部东西。骨架和动画代码是共用的，只有这里在变 ——
 * 这正是程序化画人而不是画六套精灵图的意义。
 *
 * 相对 overlord 做了裁剪：去掉了马匹、伙夫、盾墙、火枪这些战阵专用的分支，割草游戏用不上。
 */

export type WeaponKind = 'none' | 'sword' | 'spear' | 'halberd' | 'bow' | 'hammer';
export type ShieldKind = 'none' | 'round' | 'tower';
/** 头部装备，按遮住脸的程度递增。 */
export type HelmetKind = 'topknot' | 'soft' | 'cap' | 'kettle' | 'conical' | 'great';
export type ArmorKind = 'cloth' | 'leather' | 'lamellar' | 'plate';

export interface UnitDef {
  weapon: WeaponKind;
  shield: ShieldKind;
  helmet: HelmetKind;
  armor: ArmorKind;

  /** 马鬃盔缨。 */
  plume: boolean;
  /** 肩甲。 */
  pauldrons: boolean;
  /** 腰带下的甲裙。 */
  skirt: boolean;
  quiver: boolean;
  /** 枪头下的布穗。 */
  tassel: boolean;
  /** 身后的阵营色斗篷。 */
  cape: boolean;
  /** 双持：副手也握一把同样的武器。目前只有锤子支持。 */
  dualWield: boolean;

  /** 四肢和躯干的粗细倍率。 */
  bulk: number;
  /** 武器长度倍率。 */
  reach: number;
  /** 整体身高倍率。 */
  stature: number;

  /**
   * 肚子，0 = 没有，1 = 满。
   *
   * 光靠调 bulk 是做不出胖子的：bulk 等比例放大整个躯干，得到的是一个"大只"的人，
   * 不是一个胖子。骨架默认腰最细（腰 3.15 < 胸 3.95），而胖子恰恰相反 —— 最宽的地方
   * 在肚子。这个值把腰的横截面插值到超过胸，轮廓才会在中间鼓出来。
   */
  paunch: number;

  /**
   * 头部装备相对其材质的亮度，也是让一排人能互相区分的主要手段。整条色阶一起平移，
   * 所以它仍然是一条色阶，只有相对身体的明暗在动。
   */
  helmetTone: number;

  /**
   * 攻击判定：以自己为圆心、朝向为轴的一个扇形。范围是世界单位，张角是弧度。
   *
   * 判定不看武器实际扫过哪里 —— 发招的那一刻目标在扇形里就算中。武器、冲击弧这些
   * 只负责表现。真按几何碰撞判会带来两个麻烦：判定跟着动画的每一次微调漂移，而且
   * 同样一刀"看着中了却没中"的情况会非常多。范围调成比看上去略大一点，宁可宽一点。
   */
  attackRange: number;
  attackArc: number;
}

const DEFAULTS: UnitDef = {
  weapon: 'none',
  shield: 'none',
  helmet: 'topknot',
  armor: 'cloth',
  plume: false,
  pauldrons: false,
  skirt: false,
  quiver: false,
  tassel: false,
  cape: false,
  dualWield: false,
  bulk: 1,
  reach: 1,
  stature: 1,
  paunch: 0,
  helmetTone: 1,
  attackRange: 10,
  attackArc: 1.6,
};

export const makeUnitDef = (overrides: Partial<UnitDef> = {}): UnitDef => ({ ...DEFAULTS, ...overrides });

/** 杆长。枪、戟共用。 */
export const shaftLength = (def: UnitDef): number => 15 * def.reach;

/** 握点到杆尾占全长的比例。 */
export const BUTT_FRACTION = 0.3;

export const BASE_BLADE_LENGTH = 11;
export const bladeLength = (def: UnitDef): number => BASE_BLADE_LENGTH * def.reach;

/**
 * 单手锤的柄长。比剑短得多 —— 锤子的威胁来自头部的质量，不是长度，而且双持时两根长柄
 * 会在身前绞成一团。
 */
export const hammerLength = (def: UnitDef): number => 6.4 * def.reach;

/**
 * 锤头的半径。圆锤，画成一个三色阶的球。
 *
 * 刻意夸张：乘上武将的 bulk 之后是 2.75，比他自己的头骨（半径 2.5）还大一圈。真实比例的
 * 锤子在这个尺寸下就是拳头上的一个疙瘩，读不出重量。
 *
 * 大小本身不是之前那版失败的原因 —— 那次的问题是箍几乎和锤头一样大，两个相交的圆读作
 * 一把扳手的开口，再加一个顶尖坐实了这个错觉。箍缩小、尖去掉之后，头可以放心地做大。
 */
export const HAMMER_HEAD_RADIUS = 2.05;

export const isTwoHanded = (def: UnitDef): boolean => def.weapon === 'spear' || def.weapon === 'halberd' || def.weapon === 'bow';

// ---------------------------------------------------------------- 预设

export const UnitPresets = {
  /**
   * 玩家操控的武将：胖子，双持圆锤。
   *
   * 轮廓是这里唯一真正的设计目标 —— 屏幕上几百个人的时候，玩家要能在半秒内找到自己。
   * 三个特征各自负责一件事：
   *   肚子   —— 中间鼓出来的轮廓，和所有杂兵的直筒身形都不一样，远看也认得出。
   *   双持   —— 两侧各多出一块金属，是身体两边对称的"耳朵"，杂兵谁也没有。
   *   盔缨   —— 头顶那三个像素，人堆里唯一高过所有人的东西。
   *
   * 矮而宽，不是等比例放大：bulk 单独调大只会得到一个"大只"的人。stature 压到 0.94
   * 才让他真的矮下去，于是同样的宽度读作胖而不是高大。
   */
  warlord: (): UnitDef =>
    makeUnitDef({
      weapon: 'hammer',
      dualWield: true,
      helmet: 'conical',
      armor: 'lamellar',
      plume: true,
      pauldrons: true,
      skirt: true,
      bulk: 1.34,
      stature: 0.94,
      paunch: 1,
      reach: 1,
      helmetTone: 1.2,
      // 武将扫得又远又宽，这是他能割草而杂兵不能的全部原因。
      attackRange: 34,
      attackArc: 1.9,
    }),

  /** 披风剑士，轮廓最大，一眼能在人堆里找到。 */
  hero: (): UnitDef =>
    makeUnitDef({
      weapon: 'sword',
      helmet: 'conical',
      armor: 'plate',
      plume: true,
      pauldrons: true,
      skirt: true,
      cape: true,
      bulk: 1.05,
      helmetTone: 1.25,
      attackRange: 16,
      attackArc: 1.7,
    }),

  /** 最基础的杂兵：无甲、软帽、一把刀。 */
  thug: (): UnitDef =>
    makeUnitDef({ weapon: 'sword', helmet: 'soft', armor: 'cloth', bulk: 0.95, attackRange: 11, attackArc: 1.6 }),

  /** 持盾兵：正面难打，得绕后。 */
  shieldman: (): UnitDef =>
    makeUnitDef({
      weapon: 'sword',
      shield: 'round',
      helmet: 'cap',
      armor: 'leather',
      helmetTone: 1.1,
      attackRange: 11,
      attackArc: 1.5,
    }),

  /** 长枪兵：够得远。 */
  spearman: (): UnitDef =>
    // 枪够得远但扇面窄：从正面很难贴上去，绕侧面就没事。
    makeUnitDef({
      weapon: 'spear',
      helmet: 'kettle',
      armor: 'leather',
      tassel: true,
      reach: 0.9,
      attackRange: 20,
      attackArc: 0.9,
    }),

  /** 弓手：远程。 */
  // 弓手目前也是近战：还没有抛射物，让他站远了空拉弓只会看着像卡住了。
  archer: (): UnitDef =>
    makeUnitDef({
      weapon: 'bow',
      helmet: 'soft',
      armor: 'cloth',
      quiver: true,
      bulk: 0.92,
      attackRange: 13,
      attackArc: 1.4,
    }),

  /** 精英：重甲、大盾、戟。 */
  elite: (): UnitDef =>
    makeUnitDef({
      weapon: 'halberd',
      shield: 'tower',
      helmet: 'great',
      armor: 'plate',
      pauldrons: true,
      skirt: true,
      bulk: 1.12,
      stature: 1.06,
      helmetTone: 0.9,
      attackRange: 19,
      attackArc: 1.5,
    }),
};
