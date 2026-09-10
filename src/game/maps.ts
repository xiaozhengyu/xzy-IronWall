import type { CharacterPalette } from '../characters/palette';
import { PALETTE_RED } from '../characters/palette';
import { UnitPresets, type UnitDef } from '../characters/unitDef';
import { DEFAULT_LAYOUT, type TerrainLayout } from '../world/terrain';
import {
  DEFAULT_SPAWN_TEMPLATE,
  EnemyKinds,
  PASS_SPAWN_TEMPLATE,
  SNOWFIELD_SPAWN_TEMPLATE,
  STEPPE_SPAWN_TEMPLATE,
  type EnemyKindId,
  type SpawnTemplate,
} from './waves';
import type { WeatherKind } from '../world/weather';

/**
 * 这张图上会遇到谁。名字和一句说明是界面用的，def 和 palette 是**真的**那一份 ——
 * 小兵直接取自 waves.ts 的出兵表，所以选图时看到的模型就是进去之后走过来的那个人。
 */
export interface MapFoe {
  name: string;
  note: string;
  def: UnitDef;
  palette: CharacterPalette;
  /** 首领。目前还没进出兵模板，摆在这里是让玩家先认识轮廓。 */
  boss?: boolean;
}

/** 从出兵表里取一种兵。取不到就说明 waves.ts 改过名字，宁可当场炸也别默默画错人。 */
function foe(id: EnemyKindId, name: string, note: string): MapFoe {
  const kind = EnemyKinds.find((entry) => entry.id === id);
  if (!kind) throw new Error(`Unknown enemy kind: ${id}`);
  return { name, note, def: kind.def, palette: kind.palette };
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
  name: string;
  /** 列表卡片上的环境标签，一个词。 */
  tag: string;
  /** 一两句环境描述。 */
  blurb: string;
  /** 战场环境三行：地形 / 天气 / 视野。 */
  terrain: string;
  weatherNote: string;
  sight: string;
  /** 主要敌人，外加一个首领。右栏列名字，中栏下面摆模型。 */
  foes: MapFoe[];
  /** 本局目标。没有胜负结算之前，就照实写。 */
  objective: string;

  width: number;
  height: number;
  seed: number;
  /** 这张图上摆了什么。见 TerrainLayout。 */
  layout: TerrainLayout;
  /** 这张图的出兵表。 */
  template: SpawnTemplate;
  weather: WeatherKind;
}

/**
 * 演武荒原：一直在用的那块测试场地（1200×1200，种子 20260902）。
 *
 * 它同时是启动时烘好的那一份 —— 开局直接进这张图不用重烘地面。所以它的三个数一个都不能改，
 * 改了就得连 main.ts 里的 FIELD_W / FIELD_H / FIELD_SEED 一起改。
 */
const provingGround: GameMapDef = {
  id: 'proving',
  name: '演武荒原',
  tag: '林地',
  blurb: '四面合围的一块平地，边上是围死的树墙，中间散着几处水塘和踩出来的土路。',
  terrain: '草地为主，几片林地和水塘，土路穿过中央',
  weatherNote: '晴，局内可切雨雪',
  sight: '全场开阔，只有林地和树墙挡视线',
  foes: [
    foe('thug', '杂兵', '数量最多，贴身砍'),
    foe('spearman', '长枪兵', '够得比杂兵远一点'),
    foe('shieldman', '持盾兵', '正面难打，绕后'),
    foe('archer', '弓手', '站远处放箭'),
    foe('cavalry', '骑兵', '后段才来，比谁都高、比谁都快'),
    // 首领还没接进出兵模板，见 MapFoe.boss。
    { name: '精锐统领', note: '塔盾与重甲，尚未出现在波次里', def: UnitPresets.elite(), palette: PALETTE_RED, boss: true },
  ],
  objective: '抵御不断来袭的敌人。',

  width: 1200,
  height: 1200,
  seed: 20260902,
  layout: DEFAULT_LAYOUT,
  template: DEFAULT_SPAWN_TEMPLATE,
  weather: 'clear',
};

/**
 * 黑石隘口：一条南北向的窄谷。
 *
 * 地图是竖的（1100×1600），树墙加厚到 18%，两侧再各探进来一大片林子把中段掐细 —— 走位空间
 * 只有演武荒原的一半上下。配上一整队重步兵和戟兵，这张图问的是"顶不顶得住"。
 *
 * 一条土路从北贯到南：那既是唯一一条走得开的通道，也是玩家在这张图上唯一的地标。
 */
const blackstonePass: GameMapDef = {
  id: 'pass',
  name: '黑石隘口',
  tag: '峡谷',
  blurb: '两壁夹着的一条南北向窄谷，中段被两侧的林子掐得最细，一条土路从头贯到尾。',
  terrain: '一条纵贯的土路，两侧密林压到路边，没有水',
  weatherNote: '阴，风大',
  sight: '最差的一张：中段两侧的林子挡死侧向视野',
  foes: [
    foe('shieldman', '持盾兵', '这张图的主力，正面推不动'),
    foe('halberdier', '戟兵', '举过头顶砸下来，够得比刀远'),
    foe('spearman', '长枪兵', '躲在盾后面往外扎'),
    foe('thug', '杂兵', '填在队列缝里'),
    { name: '隘口守将', note: '塔盾与重甲，尚未出现在波次里', def: UnitPresets.elite(), palette: PALETTE_RED, boss: true },
  ],
  objective: '在窄谷里顶住六波推进。',

  width: 1100,
  height: 1600,
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
};

/**
 * 赤沙荒原：最大最空的一张（1600×1600），树墙薄到 6%。
 *
 * 骑兵的地方。开阔意味着两件事同时成立：敌人有地方加速冲过来，玩家也有地方跑。这张图的
 * 打法是不停地移动，站桩会被三面围住。
 *
 * 地上散着五处踩秃的沙地，那是这张图上仅有的地标 —— 一片全是草的开阔地会让玩家彻底失去
 * 方位感（小地图救不了，人不会一直盯着小地图看）。
 */
const redSandSteppe: GameMapDef = {
  id: 'steppe',
  name: '赤沙荒原',
  tag: '荒原',
  blurb: '一整片跑得开的沙草地，边上那圈林子薄得几乎挡不住视线，地上散着几块踩秃的沙土。',
  terrain: '大片开阔草地，五处沙土，边缘只有一层薄林',
  weatherNote: '晴，日头很足',
  sight: '最好的一张：一眼能看到对面的林线',
  foes: [
    foe('cavalry', '骑兵', '开局就有，冲得最快'),
    foe('lancer', '枪骑兵', '披着马衣，够得最远'),
    foe('horseArcher', '骑射', '边跑边放箭，追不上'),
    foe('peasant', '流民', '徒步的那一部分，填数量'),
    { name: '荒原头人', note: '塔盾与重甲，尚未出现在波次里', def: UnitPresets.elite(), palette: PALETTE_RED, boss: true },
  ],
  objective: '在开阔地上撑过六波骑兵冲锋。',

  width: 1600,
  height: 1600,
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
    // （Field.edgeMargin），树墙得比它厚，人贴到底的时候身后才还有树。1600 × 0.08 = 128，
    // 正好留一倍余量。
    border: 0.08,
  },
  template: STEPPE_SPAWN_TEMPLATE,
  weather: 'clear',
};

/**
 * 白岭雪原：默认下雪的一张（1400×1400）。
 *
 * 出兵表里弓手和骑射合计占到一半，是"被箭磨死"的那一张。地形上给了对策：三片探进场内的
 * 林子和一大片冻湖把开阔地切碎，躲得进去。
 *
 * 天气默认给 snow —— 这是第一张不用玩家自己去右栏点一下才下雪的图。积雪堆和水洼的位置跟着
 * 种子一次生成（见 Terrain.placeWeatherPatches），所以雪化了再下还是堆在同样的地方。
 */
const whiteRidgeSnowfield: GameMapDef = {
  id: 'snowfield',
  name: '白岭雪原',
  tag: '雪原',
  blurb: '一片积着雪的缓坡，中间是冻住的大湖，三片杉林从边上探进来，能挡箭。',
  terrain: '中央一片冻湖，三片探入场内的林子，其余是积雪的草地',
  weatherNote: '雪，默认就在下',
  sight: '中等：湖面一览无余，林子里看不清',
  foes: [
    foe('archer', '弓手', '这张图的主力，站得最远'),
    foe('horseArcher', '骑射', '边跑边放，位置一直在变'),
    foe('shieldman', '持盾兵', '压在前排替弓手挡'),
    foe('spearman', '长枪兵', '贴着盾往外扎'),
    { name: '雪原猎首', note: '塔盾与重甲，尚未出现在波次里', def: UnitPresets.elite(), palette: PALETTE_RED, boss: true },
  ],
  objective: '在箭雨底下撑过六波。',

  width: 1400,
  height: 1400,
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
};

export const GameMaps: GameMapDef[] = [
  provingGround,
  blackstonePass,
  redSandSteppe,
  whiteRidgeSnowfield,
];

export function mapById(id: string): GameMapDef {
  return GameMaps.find((map) => map.id === id) ?? GameMaps[0];
}
