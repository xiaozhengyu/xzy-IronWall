import { PROVING_GROUND } from './maps/provingGround';

export type {
  GameMapDef,
  MapEncounter,
  MapFoe,
  MapLandmark,
  MapNoSpawnZone,
  MapPresentation,
  MapSpawnAnchor,
  MapSpawnProfile,
  MapWorld,
  ResolvedMapLandmark,
} from './mapTypes';

/** Registered maps. Keep the registry small until each map has a complete authored encounter. */
export const GameMaps = [PROVING_GROUND];
