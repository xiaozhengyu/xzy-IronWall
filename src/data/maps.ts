import type { HudTextKey } from '../ui/text/hudText.types';
import type { CharacterPalette } from '../characters/palette';
import type { UnitDef } from '../characters/unitDef';
import { DEFAULT_LAYOUT, type TerrainLayout } from '../world/terrain';
import {
  DEFAULT_SPAWN_TEMPLATE,
  type SpawnTemplate,
} from './waves';
import { resolveKind, unitKind, type BossKindId, type UnitKindId } from './units';
import { NEUTRAL_MODIFIER, type MapModifier } from './types';
import type { WeatherKind } from '../world/weather';

/**
 * 这张图上会遇到谁。名字、说明、模型全部取自 units.ts 的兵种表 —— 选图时看到的那个人就是
 * 进去之后走过来的那个人，连属性都是同一份。
 *
 * 以前这里要给每一条手写 name 和 note，同一个持盾兵在不同地图上写了多遍。现在只写 id。
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
 *   出兵模板     —— 会遇到什么。地图可以用不同的模板表达不同的打法。
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
   * 加它之前，地图的区别只有地形和出兵比例，所以"这张图难在哪儿"只能靠往模板里塞更多人
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
  // 唯一保留的地图，所有加成保持基准值。
  modifier: NEUTRAL_MODIFIER,
};

export const GameMaps: GameMapDef[] = [
  provingGround,
];
