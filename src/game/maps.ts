import type { CharacterPalette } from '../characters/palette';
import { PALETTE_RED } from '../characters/palette';
import { UnitPresets, type UnitDef } from '../characters/unitDef';
import { EnemyKinds, type EnemyKindId } from './waves';
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
 * 目前只有一张 —— 就是一直在用的那块测试场地（1200×1200，种子 20260902）。它不是占位：
 * 界面上那张缩略图是**真的**用 Terrain.bakeGround 烘出来的这块地，标记点也是真的营地坐标。
 * 所以这一栏读到的东西和进去之后看到的是同一件事。
 *
 * 尺寸和种子写在这里而不是 main.ts，是为了让"加一张地图"变成往这张表里加一条：Field 本来
 * 就是 (宽, 高, 种子) 三个数构造出来的。真正还没接的是**换地图要重烘地面**那一步 ——
 * 现在只有一张图，开局用的就是启动时烘好的那一份，所以还看不出来。见 main.ts 的 enterMap。
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
  weather: WeatherKind;
}

export const GameMaps: GameMapDef[] = [
  {
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
      // 首领还没接进出兵模板，见 MapFoe.boss。
      { name: '精锐统领', note: '塔盾与重甲，尚未出现在波次里', def: UnitPresets.elite(), palette: PALETTE_RED, boss: true },
    ],
    objective: '抵御不断来袭的敌人。',

    width: 1200,
    height: 1200,
    seed: 20260902,
    weather: 'clear',
  },
];

export function mapById(id: string): GameMapDef {
  return GameMaps.find((map) => map.id === id) ?? GameMaps[0];
}
