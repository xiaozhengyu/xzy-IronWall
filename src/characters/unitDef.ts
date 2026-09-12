/**
 * 让一个单位看起来不同于另一个的全部东西。骨架和动画代码是共用的，只有这里在变 ——
 * 这正是程序化画人而不是画六套精灵图的意义。
 *
 * 相对 overlord 做了裁剪：去掉了马匹、伙夫、盾墙、火枪这些战阵专用的分支，割草游戏用不上。
 */

export type WeaponKind = 'none' | 'sword' | 'spear' | 'halberd' | 'bow' | 'hammer';
export type ShieldKind = 'none' | 'round' | 'tower';
/** 头部装备，按遮住脸的程度递增。 */
export type HelmetKind = 'topknot' | 'soft' | 'cap' | 'kettle' | 'conical' | 'great' | 'visor';
export type ArmorKind = 'cloth' | 'leather' | 'lamellar' | 'plate';

export interface UnitDef {
  weapon: WeaponKind;
  shield: ShieldKind;
  helmet: HelmetKind;
  armor: ArmorKind;

  /** 马鬃盔缨：从盔顶往后垂下去的一束马尾。 */
  plume: boolean;
  /**
   * 盔冠：伏在盔顶上、前后走向的一道刷子，和 plume 是两种东西。
   *
   * 马尾长在头后面，所以从正面看只是耳朵后一点颜色；盔冠长在头顶上，任何朝向都在
   * 轮廓的最高处。人堆里要认出一个人靠的是后者。两个都开也行，参考图上就是一道盔冠
   * 加一截往后飘的尾。
   */
  crest: boolean;
  /**
   * 颈甲。头和胸之间只有 0.2 个单位的空隙，所以这套骨架本来就没有脖子 —— 头是直接坐在
   * 肩上的。一条比头略宽、比肩略窄的钢带垫在下巴底下，头才读作"扣在铠甲上"而不是
   * "摆在铠甲上"。
   */
  gorget: boolean;
  /** 膝甲：膝盖上的一枚钢碗。 */
  poleyns: boolean;
  /**
   * 皮质的袖子、手套和靴子。
   *
   * 默认的袖子是罩袍色压暗一档，于是整个人从肩到脚是同一个色相的一团。参考图把四肢换成
   * 棕皮，红罩袍就被夹在两块棕色中间 —— 阵营色的面积小了，反而更响。
   */
  leatherKit: boolean;
  /** 斜挎过胸口的皮带。 */
  baldric: boolean;
  /** 甲裙正前方垂下来的一条罩袍垂片。 */
  tabard: boolean;
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

  /**
   * 骑在马上。
   *
   * 这是一个单位身上**最响**的一条：马肩隆就有十个单位高，骑手的头因此落在 24 上下，比
   * 步兵高出一半。人堆里认出骑兵靠的就是这个高度差，不是马本身的细节 —— 出货尺寸下那匹马
   * 只有二十来个像素长。
   *
   * 它同时改三件事：姿势（胯坐在鞍上、脚挂在马腹两侧，见 CharacterAnimator）、渲染（先画马
   * 再画人，见 drawCharacter）、以及战斗里的移动速度（在 waves.ts 的出兵表里给）。
   */
  mounted: boolean;
  /**
   * 马衣。侧裙、胸甲、臀甲、颈甲和面甲，全套阵营色加钢边。
   *
   * 和 mounted 分开是因为它是**这匹马有多贵**：轻骑兵骑的是光马，重骑兵才披甲。两者在
   * 出货尺寸下也分得开 —— 侧裙那一块是马身上唯一大到能读出来的甲。
   */
  barding: boolean;

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

}

// attackRange 和 attackArc 原来在这里。它们搬到 data/types.ts 的 UnitStats 上去了 ——
// 这个文件开头那句话是"让一个单位看起来不同于另一个的全部东西"，而判定范围不是长相，
// 是强度。现在每个兵种的范围和张角写在 data/units.ts，每个角色的写在 data/heroes.ts。

const DEFAULTS: UnitDef = {
  weapon: 'none',
  shield: 'none',
  helmet: 'topknot',
  armor: 'cloth',
  plume: false,
  crest: false,
  gorget: false,
  poleyns: false,
  leatherKit: false,
  baldric: false,
  tabard: false,
  pauldrons: false,
  skirt: false,
  quiver: false,
  tassel: false,
  cape: false,
  dualWield: false,
  mounted: false,
  barding: false,
  bulk: 1,
  reach: 1,
  stature: 1,
  paunch: 0,
  helmetTone: 1,
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
   * 玩家操控的武将：精悍体型，双持圆锤。
   *
   * 轮廓是这里唯一真正的设计目标 —— 屏幕上几百个人的时候，玩家要能在半秒内找到自己。
   * 两个特征各自负责一件事：
   *   双持   —— 两侧各多出一块金属，是身体两边对称的"耳朵"，杂兵谁也没有。
   *   盔缨   —— 头顶那三个像素，人堆里唯一高过所有人的东西。
   *
   * 身形保持略高于杂兵，但腰腹明显收窄；辨识度交给双锤与盔缨，不再依赖肥胖轮廓。
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
      bulk: 1.16,
      stature: 0.98,
      paunch: 0.28,
      reach: 1,
      helmetTone: 1.2,
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
    }),

  /** 最基础的杂兵：无甲、软帽、一把刀。 */
  thug: (): UnitDef =>
    makeUnitDef({ weapon: 'sword', helmet: 'soft', armor: 'cloth', bulk: 0.95 }),

  /** 持盾兵：正面难打，得绕后。 */
  shieldman: (): UnitDef =>
    makeUnitDef({
      weapon: 'sword',
      shield: 'round',
      helmet: 'cap',
      armor: 'leather',
      helmetTone: 1.1,
    }),

  /** 长枪兵：够得远。 */
  spearman: (): UnitDef =>
    // 枪够得远但扇面窄：从正面很难贴上去，绕侧面就没事。
    makeUnitDef({
      weapon: 'spear',
      helmet: 'kettle',
      armor: 'leather',
      tassel: true,
      // 杆长 15 × 2.6 = 39 个世界单位；角色连头盔约 18.3，高度超过两个完整角色。
      reach: 2.6,
    }),

  /** 弓手：远程。 */
  archer: (): UnitDef =>
    makeUnitDef({
      weapon: 'bow',
      helmet: 'soft',
      armor: 'cloth',
      quiver: true,
      bulk: 0.92,
    }),

  /**
   * 骑士：面甲盔 + 盔冠 + 圆盾 + 剑。照着 example/role (4).png 那张参考图搭的。
   *
   * 这张参考图和这套骨架的比例本来就对得上（头 22%、躯干 33%、腿 45%，骨架是 27/29/40），
   * 所以它一个骨骼数字都没动 —— 差距全在部件上：一颗有面甲的头、垫在下巴底下的颈甲、
   * 圆的而不是方的肩甲、和罩袍拉开色相的皮四肢。
   *
   * **这是个 boss，不进 EnemyKinds。** 两条理由，性能只是其中比较轻的那条：
   *
   *   贵 —— 出货那一档（grain 4）他是 120 个图元 / 920 个顶点，差不多两个杂兵。等概率
   *   混进出怪表就是场上六分之一，实测视口内四百人时图元 26.3k → 30.1k、顶点占那 400k
   *   缓冲从 54% 涨到 60%。不会崩，但那六个百分点是给地形和特效留的。
   *
   *   更要紧的是他不该被看烂 —— 面甲、盔冠、颈甲、金护手这些是为"这个人不一样"准备的，
   *   一屏站二十个的时候它们什么也不说明了。杂兵的辨识度靠轮廓（枪最长、盾最方、弓手
   *   最瘦），boss 的辨识度才靠细节。他的 attackRange 16 / attackArc 1.7 也是 boss 的量级
   *   （杂兵是 11 / 1.6），当普通兵放出去，难度会跟着一起变。
   *
   * 真要做 boss 的话这里还差血量、受击反馈和出场逻辑 —— 那些不属于 UnitDef，它只管长相。
   */
  knight: (): UnitDef =>
    makeUnitDef({
      weapon: 'sword',
      shield: 'round',
      helmet: 'visor',
      // 参考图上他一身钢，这里却挂 leather —— armor 决定的是"躯干上铺什么"，不是
      // 这个人有多硬。
      //
      // plate 把躯干本色调成罩袍和钢的中间色再压一条阵营色宽带，出来是灰蓝胸甲上横着
      // 一道红；lamellar 会在胸口铺掉三分之二躯干高的钢带。两条都让金属占了大面积，
      // 而参考图正好相反：一件红袍罩在钢上，钢只从领口、腰带、肩甲和裙摆边缘漏出来。
      // cloth 的躯干就是一整块罩袍本色，上面只有腰带一条皮带 —— 领口那块钢交给
      // gorget，肩上那两块交给 pauldrons，胸前那条斜的交给 baldric。金属于是全都落在
      // 轮廓的边上，中间留给红色，和参考图的分配一致。
      //
      // （leather 试过了：它在胸口还有一条 1.4 单位高的皮带，加上腰带和挎带，躯干
      // 三分之二是棕的，人读作一个棕色的箱子。）
      armor: 'cloth',
      crest: true,
      gorget: true,
      poleyns: true,
      leatherKit: true,
      baldric: true,
      tabard: true,
      pauldrons: true,
      skirt: true,
      bulk: 1.08,
      helmetTone: 1.1,
    }),

  /** 精英：重甲、大盾、刀。 */
  elite: (): UnitDef =>
    makeUnitDef({
      weapon: 'sword',
      shield: 'tower',
      helmet: 'great',
      armor: 'plate',
      pauldrons: true,
      skirt: true,
      // 首领只有这一个外观，而他要在一千个红甲里被一眼认出来。属性上的"硬"是打起来才知道的，
      // 看一眼就知道的只有个头 —— 所以他比旁边的人高出一头、宽出一圈。
      bulk: 1.5,
      stature: 1.34,
      helmetTone: 0.9,
    }),

  /**
   * 戟兵：过顶劈砍。
   *
   * halberd 这套动作（applyHalberd：抬到身后再从身前落下）一直躺在 animator 里没人用 ——
   * 之前一个预设都没挂它。补上它不要任何新几何：戟走的是和长枪同一条 drawPolearm，多的只是
   * 杆头上的斧刃。
   *
   * 定位夹在长枪兵和持盾兵之间：比枪短、比刀长，扇面也居中。人堆里认他靠"抡起来的那一下"——
   * 全场只有他把武器举过头顶。
   */
  halberdier: (): UnitDef =>
    makeUnitDef({
      weapon: 'halberd',
      helmet: 'kettle',
      armor: 'lamellar',
      pauldrons: true,
      skirt: true,
      bulk: 1.02,
      reach: 1.7,
      helmetTone: 1.05,
    }),

  // ------------------------------------------------------------ 骑兵
  //
  // 三种坐骑单位共有的那件事：**高**。马肩隆十个单位，骑手的头因此在 24 上下，而步兵是
  // 18.3 —— 一队骑兵混在人海里，认出他们靠的是这条比所有人高出一截的天际线，不是马身上
  // 的任何细节（出货尺寸下整匹马也就二十来像素长）。
  //
  // 攻击范围一律给得比同样武器的步兵大：人坐在鞍上，手离地面本来就远了一大截，按步兵那个
  // 数给会出现"贴到马肚子上了还打不着"。
  //
  // **stature 一律留在 1。** 它是在 IK 之后把每个关节的 z 整体缩一遍（见 applyStature），
  // 而马的姿势不走那一遍 —— 给骑兵一个非 1 的身高倍率，人就会陷进马背里或者浮在马背上。
  // 想让骑兵有高矮之分得先让缩放也作用到坐骑上，那是另一件事。

  /** 骑兵：马上持剑，光马不披甲。轻装轮廓和枪骑兵、骑射区分开。 */
  cavalry: (): UnitDef =>
    makeUnitDef({
      weapon: 'sword',
      shield: 'none',
      helmet: 'cap',
      armor: 'leather',
      mounted: true,
      pauldrons: true,
      skirt: true,
      bulk: 1.02,
      helmetTone: 1.1,
    }),

  /**
   * 枪骑兵：马上端一杆长枪，马披全套马衣。
   *
   * 这是重的那一档 —— 马衣的侧裙是马身上唯一大到能读出来的一块甲，所以"贵"这件事在出货
   * 尺寸下也说得清。枪的 reach 比步兵长枪短一档：马背上那杆枪要是也有 2.6，杆尾会一直
   * 戳在马屁股里。
   */
  lancer: (): UnitDef =>
    makeUnitDef({
      weapon: 'spear',
      helmet: 'visor',
      armor: 'plate',
      mounted: true,
      barding: true,
      crest: true,
      gorget: true,
      pauldrons: true,
      skirt: true,
      tassel: true,
      bulk: 1.06,
      reach: 2.0,
      helmetTone: 1.15,
    }),

  /** 骑射：马上开弓。跑得最快、最瘦，站得最远。 */
  horseArcher: (): UnitDef =>
    makeUnitDef({
      weapon: 'bow',
      helmet: 'conical',
      armor: 'cloth',
      mounted: true,
      quiver: true,
      leatherKit: true,
      bulk: 0.94,
      helmetTone: 1.05,
    }),
};

/**
 * 形象的名字。数据层用它指一份长相，而不是用下标 —— 下标的表"只能往后加"，中间插一条
 * 就会把所有角色悄悄换成别人。
 */
export type UnitPresetId = keyof typeof UnitPresets;

export const unitAppearance = (id: UnitPresetId): UnitDef => UnitPresets[id]();
