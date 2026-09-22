import type { HudTextKey } from '../ui/text/hudText.types';
import type { CharacterPalette } from '../characters/palette';
import type { UnitDef } from '../characters/unitDef';
import { DEFAULT_LAYOUT, type TerrainLayout } from '../world/terrain';
import {
  DEFAULT_SPAWN_TEMPLATE,
  PASS_SPAWN_TEMPLATE,
  SNOWFIELD_SPAWN_TEMPLATE,
  STEPPE_SPAWN_TEMPLATE,
  type SpawnTemplate,
} from './waves';
import { resolveKind, unitKind, type BossKindId, type UnitKindId } from './units';
import { NEUTRAL_MODIFIER, type MapModifier } from './types';
import type { WeatherKind } from '../world/weather';

/**
 * 这张图上会遇到谁。名字、说明、模型全部取自 units.ts 的兵种表 —— 选图时看到的那个人就是
 * 进去之后走过来的那个人，连属性都是同一份。
 *
 * 以前这里要给每一条手写 name 和 note，同一个持盾兵在四张图上写了四遍。现在只写 id。
 */
export interface MapFoe {
  nameKey: HudTextKey;
  noteKey: HudTextKey;
  def: UnitDef;
  palette: CharacterPalette;
  /** 首领。目前还没进出兵模板，摆在这里是让玩家先认识轮廓。 */
  boss?: boolean;
}

/** 从兵种表里取一种兵。取不到当场炸 —— 宁可炸也别默默画错人。 */
function foe(id: UnitKindId, noteKey?: HudTextKey): MapFoe {
  const kind = resolveKind(id);
  const def = unitKind(id);
  return {
    nameKey: def.nameKey,
    noteKey: noteKey ?? def.noteKey,
    def: kind.def,
    palette: kind.palette,
    boss: kind.boss || undefined,
  };
}

/** 这张图的首领。每张图挑一个，名字各自不同，属性是同一档。 */
function boss(id: BossKindId, nameKey: HudTextKey, noteKey: HudTextKey): MapFoe {
  const kind = resolveKind(id);
  return { nameKey, noteKey, def: kind.def, palette: kind.palette, boss: true };
}

/**
 * 备战界面上能选的地图。
 *
 * 一张图是**四样东西**凑起来的，缺一样它就还是同一张图换了个名字：
 *
 *   尺寸和种子   —— 场地多大、噪声怎么摇。种子只改明暗成团和边界毛糙，单靠它换不出新图。
 *   布局         —— 场院、水塘、林子摆在哪儿，树墙有多厚（TerrainLayout）。**这才是让两张
 *                   图看起来不一样的东西**：树墙厚就逼仄，薄就开阔；水塘大就绕路。
 *   出兵模板     —— 会遇到什么。隘口出重步兵、荒原出骑兵、雪原出弓手，三张图的打法因此不同。
 *   天气         —— 默认那一档。玩家在备战界面上还能改，这里给的是"这地方本来什么样"。
 *
 * 界面读的只是这张表，加一张图就是往下面那个数组里再加一条。
 */
export interface GameMapDef {
  id: string;
  /** 下面这些都只存 key，文字在 ui/text 的语言包里。 */
  nameKey: HudTextKey;
  /** 列表卡片上的环境标签，一个词。 */
  tagKey: HudTextKey;
  /** 一两句环境描述。 */
  blurbKey: HudTextKey;
  /** 战场环境三行：地形 / 天气 / 视野。 */
  terrainKey: HudTextKey;
  weatherNoteKey: HudTextKey;
  sightKey: HudTextKey;
  /** 主要敌人，外加一个首领。右栏列名字，中栏下面摆模型。 */
  foes: MapFoe[];
  /** 本局目标。没有胜负结算之前，就照实写。 */
  objectiveKey: HudTextKey;

  width: number;
  height: number;
  seed: number;
  /** 这张图上摆了什么。见 TerrainLayout。 */
  layout: TerrainLayout;
  /** 这张图的出兵表。 */
  template: SpawnTemplate;
  weather: WeatherKind;
  /**
   * 这张图对敌人的加成。
   *
   * 加它之前，四张图的区别只有地形和出兵比例，所以"这张图难在哪儿"只能靠往模板里塞更多人
   * 去表达 —— 而人数早就顶到帧耗时的预算了。有了这一层，同一个持盾兵在隘口比在荒原更推不动，
   * 不用多放一个人。见 MapModifier。
   */
  modifier: MapModifier;
}

/**
 * 演武荒原：一直在用的那块测试场地（3600×3600，种子 20260902）。
 *
 * 它同时是启动时烘好的那一份 —— 开局直接进这张图不用重烘地面。所以它的三个数一个都不能改，
 * 改了就得连 main.ts 里的 FIELD_W / FIELD_H / FIELD_SEED 一起改。
 */
const provingGround: GameMapDef = {
  id: 'proving',
  nameKey: 'mapProvingName',
  tagKey: 'mapProvingTag',
  blurbKey: 'mapProvingBlurb',
  terrainKey: 'mapProvingTerrain',
  weatherNoteKey: 'mapProvingWeather',
  sightKey: 'mapProvingSight',
  foes: [
    foe('thug', 'unitThugNote'),
    foe('spearman', 'unitSpearmanNote'),
    foe('shieldman', 'unitShieldmanNote'),
    foe('archer', 'unitArcherNote'),
    foe('cavalry', 'unitCavalryNote'),
    // 首领还没接进出兵模板，见 MapFoe.boss。属性已经有了（units.ts 的 elite），缺的只是出场。
    boss('elite', 'mapProvingBossName', 'mapBossPending'),
  ],
  objectiveKey: 'mapProvingObjective',

  width: 3600,
  height: 3600,
  seed: 20260902,
  layout: DEFAULT_LAYOUT,
  template: DEFAULT_SPAWN_TEMPLATE,
  weather: 'clear',
  // 基准图，全是 1。别的三张和它比。
  modifier: NEUTRAL_MODIFIER,
};

/**
 * 黑石隘口：一条南北向的窄谷。
 *
 * 地图是竖的（3300×4800），树墙加厚到 18%，两侧再各探进来一大片林子把中段掐细 —— 走位空间
 * 只有演武荒原的一半上下。配上一整队重步兵和戟兵，这张图问的是"顶不顶得住"。
 *
 * 一条土路从北贯到南：那既是唯一一条走得开的通道，也是玩家在这张图上唯一的地标。
 */
const blackstonePass: GameMapDef = {
  id: 'pass',
  nameKey: 'mapPassName',
  tagKey: 'mapPassTag',
  blurbKey: 'mapPassBlurb',
  terrainKey: 'mapPassTerrain',
  weatherNoteKey: 'mapPassWeather',
  sightKey: 'mapPassSight',
  foes: [
    foe('bulwark', 'unitBulwarkNote'),
    foe('shieldman', 'unitShieldmanNote'),
    foe('halberdier', 'unitHalberdierNote'),
    foe('spearman', 'unitSpearmanNote'),
    foe('thug', 'unitThugNote'),
    boss('elite', 'mapPassBossName', 'mapBossPending'),
  ],
  objectiveKey: 'mapPassObjective',

  width: 3300,
  height: 4800,
  seed: 41207,
  layout: {
    dirt: [
      // 一条贯穿南北的土路，压在正中。窄（半宽 6%）而长（半高 42%）。
      { x: 0.5, y: 0.5, hw: 0.06, hh: 0.42, r: 40 },
      // 南北两头各一块场院，是路的两个端点。
      { x: 0.5, y: 0.12, hw: 0.14, hh: 0.05, r: 34 },
      { x: 0.5, y: 0.88, hw: 0.14, hh: 0.05, r: 34 },
    ],
    ponds: [],
    // 左右各两片往里探的林子，两两错开 —— 对齐的话中段是一条等宽的走廊，读作一根管子。
    groves: [
      { x: 0.02, y: 0.36, r: 0.2 },
      { x: 0.98, y: 0.5, r: 0.2 },
      { x: 0.02, y: 0.66, r: 0.17 },
      { x: 0.98, y: 0.18, r: 0.15 },
    ],
    border: 0.18,
  },
  template: PASS_SPAWN_TEMPLATE,
  weather: 'clear',
  // 顶不顶得住：血厚一成半、防御高三成，而且越往后越硬。速度反过来压一档 —— 一堵墙不该
  // 跑得快，它的压力来自推不动，不是来自追得上。
  modifier: {
    enemyHp: 1.15,
    enemyAttack: 1,
    enemyDefense: 1.3,
    enemySpeed: 0.95,
    hpPerWave: 0.04,
    defensePerWave: 0.04,
    expRate: 1.15,
  },
};

/**
 * 赤沙荒原：最大最空的一张（4800×4800），树墙薄到 6%。
 *
 * 骑兵的地方。开阔意味着两件事同时成立：敌人有地方加速冲过来，玩家也有地方跑。这张图的
 * 打法是不停地移动，站桩会被三面围住。
 *
 * 地上散着五处踩秃的沙地，那是这张图上仅有的地标 —— 一片全是草的开阔地会让玩家彻底失去
 * 方位感（小地图救不了，人不会一直盯着小地图看）。
 */
const redSandSteppe: GameMapDef = {
  id: 'steppe',
  nameKey: 'mapSteppeName',
  tagKey: 'mapSteppeTag',
  blurbKey: 'mapSteppeBlurb',
  terrainKey: 'mapSteppeTerrain',
  weatherNoteKey: 'mapSteppeWeather',
  sightKey: 'mapSteppeSight',
  foes: [
    foe('cavalry', 'unitCavalryNote'),
    foe('lancer', 'unitLancerNote'),
    foe('horseArcher', 'unitHorseArcherNote'),
    foe('peasant', 'unitPeasantNote'),
    // 荒原是骑兵的地方，首领也换成骑着马的那一个。
    boss('knightBoss', 'mapSteppeBossName', 'mapBossPending'),
  ],
  objectiveKey: 'mapSteppeObjective',

  width: 4800,
  height: 4800,
  seed: 778301,
  layout: {
    dirt: [
      { x: 0.3, y: 0.28, hw: 0.13, hh: 0.1, r: 60 },
      { x: 0.72, y: 0.34, hw: 0.1, hh: 0.13, r: 55 },
      { x: 0.5, y: 0.54, hw: 0.17, hh: 0.09, r: 70 },
      { x: 0.26, y: 0.74, hw: 0.11, hh: 0.11, r: 50 },
      { x: 0.76, y: 0.78, hw: 0.14, hh: 0.08, r: 58 },
    ],
    // 一处小水塘，压在角上 —— 开阔地上唯一走不过去的东西，正好当一个方位锚。
    ponds: [{ x: 0.16, y: 0.5, hw: 0.07, hh: 0.09, r: 44 }],
    // 只有一片探进来的林子。多了就不叫荒原了。
    groves: [{ x: 0.9, y: 0.6, r: 0.09 }],
    // 8%：比演武荒原（11%）薄一截，但不能再薄了 —— 走位边界固定退到 64 个单位
    // （Field.edgeMargin），树墙得比它厚，人贴到底的时候身后才还有树。4800 × 0.08 = 384，
    // 正好留一倍余量。
    border: 0.08,
  },
  template: STEPPE_SPAWN_TEMPLATE,
  weather: 'clear',
  // 又快又脆，正好和隘口相反。速度只敢加一成二：再多，末波的骑兵经追击倍率放大之后会追过
  // 玩家的冲刺，冲刺这张脱身牌就废了（见 balance.ts 的 MAX_ENEMY_SPEED）。
  modifier: {
    enemyHp: 0.9,
    enemyAttack: 1,
    enemyDefense: 0.85,
    enemySpeed: 1.12,
    hpPerWave: 0,
    defensePerWave: 0,
    expRate: 1.1,
  },
};

/**
 * 白岭雪原：默认下雪的一张（4200×4200）。
 *
 * 出兵表里弓手和骑射合计占到一半，是"被箭磨死"的那一张。地形上给了对策：三片探进场内的
 * 林子和一大片冻湖把开阔地切碎，躲得进去。
 *
 * 天气默认给 snow —— 这是第一张不用玩家自己去右栏点一下才下雪的图。积雪堆和水洼的位置跟着
 * 种子一次生成（见 Terrain.placeWeatherPatches），所以雪化了再下还是堆在同样的地方。
 */
const whiteRidgeSnowfield: GameMapDef = {
  id: 'snowfield',
  nameKey: 'mapSnowName',
  tagKey: 'mapSnowTag',
  blurbKey: 'mapSnowBlurb',
  terrainKey: 'mapSnowTerrain',
  weatherNoteKey: 'mapSnowWeather',
  sightKey: 'mapSnowSight',
  foes: [
    foe('archer', 'unitArcherNote'),
    foe('horseArcher', 'unitHorseArcherNote'),
    foe('shieldman', 'unitShieldmanNote'),
    foe('spearman', 'unitSpearmanNote'),
    boss('elite', 'mapSnowBossName', 'mapBossPending'),
  ],
  objectiveKey: 'mapSnowObjective',

  width: 4200,
  height: 4200,
  seed: 20261, // 小种子：noise 里 seed 是直接乘进相位的，量级换一档，成团的样子就完全是另一份
  layout: {
    dirt: [
      // 环湖一圈踩出来的路，拆成四块摆在湖的四边。
      { x: 0.5, y: 0.2, hw: 0.16, hh: 0.05, r: 38 },
      { x: 0.5, y: 0.8, hw: 0.16, hh: 0.05, r: 38 },
      { x: 0.2, y: 0.5, hw: 0.05, hh: 0.14, r: 34 },
    ],
    // 一大片冻湖压在正中。它是这张图的中心问题：绕过去要多走一半路，走上去无遮无挡。
    ponds: [{ x: 0.53, y: 0.5, hw: 0.19, hh: 0.16, r: 76 }],
    groves: [
      { x: 0.14, y: 0.22, r: 0.13 },
      { x: 0.85, y: 0.34, r: 0.12 },
      { x: 0.3, y: 0.86, r: 0.14 },
    ],
    border: 0.13,
  },
  template: SNOWFIELD_SPAWN_TEMPLATE,
  weather: 'snow',
  // 箭更疼。血和防御几乎不动 —— 这张图的难点是"躲不躲得开"，不是"打不打得动"，把敌人
  // 调硬只会让人在箭雨底下站得更久。
  modifier: {
    enemyHp: 1,
    enemyAttack: 1.15,
    enemyDefense: 0.95,
    enemySpeed: 1,
    hpPerWave: 0,
    defensePerWave: 0.02,
    expRate: 1.2,
  },
};

export const GameMaps: GameMapDef[] = [
  provingGround,
  blackstonePass,
  redSandSteppe,
  whiteRidgeSnowfield,
];
