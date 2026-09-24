import { PROVING_GROUND } from './maps/provingGround';

export type {
  GameMapDef,
  MapEncounter,
  MapFoe,
  MapLandmark,
  MapDecoration,
  MapObstacle,
  MapPassage,
  MapRegion,
  MapSpawnBias,
  MapNoSpawnZone,
  MapPresentation,
  MapSpawnAnchor,
  MapSpawnProfile,
  MapTopology,
  MapWorld,
  ResolvedMapLandmark,
  ResolvedMapDecoration,
  ResolvedMapObstacle,
  ResolvedMapPassage,
  ResolvedMapRegion,
  ResolvedMapTopology,
} from './mapTypes';

/** Registered maps. Keep the registry small until each map has a complete authored encounter. */
export const GameMaps = [PROVING_GROUND];
