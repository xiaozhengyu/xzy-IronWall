import type { CharacterPalette } from '../characters/palette';
import type { UnitDef } from '../characters/unitDef';
import type { HudTextKey } from '../ui/text/hudText.types';
import type { TerrainLayout } from '../world/terrain';
import type { WeatherKind } from '../world/weather';
import type { BossKindId, UnitKindId } from './units';
import type { MapModifier } from './types';
import type { SpawnPattern, SpawnTemplate } from './waves';

/** Setup-screen enemy presentation data. Runtime waves remain authoritative for actual spawns. */
export interface MapFoe {
  id: UnitKindId;
  nameKey: HudTextKey;
  noteKey: HudTextKey;
  def: UnitDef;
  palette: CharacterPalette;
  boss?: boolean;
}

/** Authored map point. x/y are normalized to the map; radius is world units. */
export interface MapLandmark {
  id: string;
  kind: 'start' | 'campfire' | 'objective';
  x: number;
  y: number;
  radius: number;
  labelKey?: HudTextKey;
}

/** Directional source used by the shared spawn pipeline. x/y are normalized to the map. */
export interface MapSpawnAnchor {
  id: string;
  regionId: string;
  x: number;
  y: number;
  radius: number;
  weight: number;
}

/** A normalized circular area in which world and wave spawning are forbidden. */
export interface MapNoSpawnZone {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface MapRegion {
  id: string;
  role: 'arena' | 'camp' | 'grove' | 'pond' | 'boss';
  /** Normalized center; radius is world units. */
  x: number;
  y: number;
  radius: number;
  spawnGroup: string;
}

export interface MapPassage {
  id: string;
  from: string;
  to: string;
  /** Normalized center; width is world units. */
  x: number;
  y: number;
  width: number;
}

export type MapObstacle = {
  id: string;
  kind: 'wall' | 'fence' | 'rocks' | 'ruin' | 'pillar';
  x: number;
  y: number;
  rotation: number;
  regionId: string;
} & (
  | { shape: 'circle'; radius: number }
  | { shape: 'box'; width: number; height: number }
);

export interface MapTopology {
  regions: readonly MapRegion[];
  passages: readonly MapPassage[];
  obstacles: readonly MapObstacle[];
  decorations: readonly MapDecoration[];
}

export interface MapDecoration {
  id: string;
  kind: 'tent' | 'banner' | 'log' | 'reed';
  x: number;
  y: number;
  rotation: number;
  scale: number;
  regionId: string;
}

export interface MapSpawnBias {
  pattern: SpawnPattern;
  regionWeights: Readonly<Record<string, number>>;
}

export interface MapSpawnProfile {
  noSpawnZones: readonly MapNoSpawnZone[];
  anchors: readonly MapSpawnAnchor[];
  waveBias: readonly MapSpawnBias[];
}

export interface MapEncounter {
  template: SpawnTemplate;
  modifier: MapModifier;
  bossKind: BossKindId;
  bossSchedule: readonly number[];
  spawn: MapSpawnProfile;
}

export interface MapPresentation {
  nameKey: HudTextKey;
  tagKey: HudTextKey;
  blurbKey: HudTextKey;
  terrainKey: HudTextKey;
  weatherNoteKey: HudTextKey;
  sightKey: HudTextKey;
  foes: readonly MapFoe[];
  objectiveKey: HudTextKey;
}

export interface MapWorld {
  width: number;
  height: number;
  seed: number;
  layout: TerrainLayout;
  landmarks: readonly MapLandmark[];
  topology: MapTopology;
}

export interface GameMapDef {
  id: string;
  presentation: MapPresentation;
  world: MapWorld;
  weather: WeatherKind;
  encounter: MapEncounter;
}

/** Runtime world-space form used by Field, setup pins, and the minimap. */
export interface ResolvedMapLandmark extends Omit<MapLandmark, 'x' | 'y'> {
  x: number;
  y: number;
}

export interface ResolvedMapRegion extends Omit<MapRegion, 'x' | 'y'> {
  x: number;
  y: number;
}

export interface ResolvedMapPassage extends Omit<MapPassage, 'x' | 'y'> {
  x: number;
  y: number;
}

export type ResolvedMapObstacle = {
  id: string;
  kind: 'wall' | 'fence' | 'rocks' | 'ruin' | 'pillar';
  x: number;
  y: number;
  rotation: number;
  regionId: string;
} & (
  | { shape: 'circle'; radius: number }
  | { shape: 'box'; width: number; height: number }
);

export interface ResolvedMapTopology {
  regions: readonly ResolvedMapRegion[];
  passages: readonly ResolvedMapPassage[];
  obstacles: readonly ResolvedMapObstacle[];
  decorations: readonly ResolvedMapDecoration[];
}

export interface ResolvedMapDecoration extends Omit<MapDecoration, 'x' | 'y'> {
  x: number;
  y: number;
}
