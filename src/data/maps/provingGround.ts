import type { HudTextKey } from '../../ui/text/hudText.types';
import type { TerrainLayout } from '../../world/terrain';
import { DEFAULT_SPAWN_TEMPLATE } from '../waves';
import { resolveKind, unitKind, type BossKindId, type UnitKindId } from '../units';
import { NEUTRAL_MODIFIER } from '../types';
import type { GameMapDef, MapFoe, MapTopology } from '../mapTypes';

function foe(id: UnitKindId, noteKey?: HudTextKey): MapFoe {
  const kind = resolveKind(id);
  const def = unitKind(id);
  return {
    id,
    nameKey: def.nameKey,
    noteKey: noteKey ?? def.noteKey,
    def: kind.def,
    palette: kind.palette,
    boss: kind.boss || undefined,
  };
}

function boss(id: BossKindId, nameKey: HudTextKey, noteKey: HudTextKey): MapFoe {
  const kind = resolveKind(id);
  return { id, nameKey, noteKey, def: kind.def, palette: kind.palette, boss: true };
}

const PROVING_LAYOUT: TerrainLayout = {
  surfaceVariation: 0.5,
  dirt: [],
  clearings: [
    { x: 0.23, y: 0.22, rx: 0.095, ry: 0.072, feather: 0.12 },
    { x: 0.5, y: 0.5, rx: 0.13, ry: 0.105, feather: 0.11 },
    { x: 0.19, y: 0.75, rx: 0.06, ry: 0.05, feather: 0.13 },
    { x: 0.52, y: 0.8, rx: 0.13, ry: 0.078, feather: 0.1 },
  ],
  paths: [
    { points: [
      { x: 0.07, y: 0.1 }, { x: 0.2, y: 0.075 }, { x: 0.42, y: 0.07 },
      { x: 0.67, y: 0.075 }, { x: 0.88, y: 0.1 }, { x: 0.93, y: 0.23 },
      { x: 0.92, y: 0.46 }, { x: 0.94, y: 0.68 }, { x: 0.86, y: 0.88 },
      { x: 0.68, y: 0.93 }, { x: 0.48, y: 0.94 }, { x: 0.27, y: 0.92 },
      { x: 0.13, y: 0.88 }, { x: 0.07, y: 0.73 }, { x: 0.06, y: 0.48 },
      { x: 0.07, y: 0.25 }, { x: 0.07, y: 0.1 },
    ], width: 27, feather: 12 },
    { points: [{ x: 0.38, y: 0.38 }, { x: 0.43, y: 0.42 }, { x: 0.5, y: 0.5 }], width: 28, feather: 12 },
    { points: [{ x: 0.61, y: 0.32 }, { x: 0.58, y: 0.4 }, { x: 0.5, y: 0.5 }], width: 25, feather: 11 },
    { points: [{ x: 0.5, y: 0.5 }, { x: 0.65, y: 0.5 }, { x: 0.72, y: 0.49 }], width: 28, feather: 12 },
    { points: [{ x: 0.5, y: 0.5 }, { x: 0.39, y: 0.62 }, { x: 0.32, y: 0.66 }], width: 28, feather: 12 },
    { points: [{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.63 }, { x: 0.52, y: 0.69 }], width: 31, feather: 12 },
    { points: [{ x: 0.68, y: 0.72 }, { x: 0.74, y: 0.68 }, { x: 0.78, y: 0.66 }], width: 25, feather: 10 },
    { points: [{ x: 0.32, y: 0.66 }, { x: 0.24, y: 0.7 }, { x: 0.19, y: 0.75 }], width: 25, feather: 10 },
  ],
  ponds: [],
  pondBlobs: [
    { x: 0.825, y: 0.51, rx: 0.08, ry: 0.14, phase: 0.8 },
    { x: 0.79, y: 0.46, rx: 0.065, ry: 0.082, phase: 1.7 },
    { x: 0.86, y: 0.58, rx: 0.074, ry: 0.095, phase: 2.4 },
    { x: 0.79, y: 0.57, rx: 0.05, ry: 0.07, phase: 3.3 },
  ],
  groves: [
    { x: 0.62, y: 0.19, r: 0.12 },
    { x: 0.72, y: 0.28, r: 0.075 },
    { x: 0.88, y: 0.31, r: 0.07 },
    { x: 0.13, y: 0.43, r: 0.075 },
    { x: 0.15, y: 0.62, r: 0.09 },
    { x: 0.29, y: 0.69, r: 0.07 },
    { x: 0.81, y: 0.79, r: 0.075 },
    { x: 0.9, y: 0.83, r: 0.07 },
  ],
  border: 0.09,
};

const PROVING_TOPOLOGY: MapTopology = {
  regions: [
    { id: 'arena-center', role: 'arena', x: 0.5, y: 0.5, radius: 620, spawnGroup: 'center' },
    { id: 'camp-northwest', role: 'camp', x: 0.24, y: 0.24, radius: 420, spawnGroup: 'northwest' },
    { id: 'grove-northeast', role: 'grove', x: 0.69, y: 0.23, radius: 430, spawnGroup: 'northeast' },
    { id: 'pond-east', role: 'pond', x: 0.79, y: 0.58, radius: 450, spawnGroup: 'east' },
    { id: 'campfire-southwest', role: 'camp', x: 0.21, y: 0.76, radius: 340, spawnGroup: 'southwest' },
    { id: 'boss-south', role: 'boss', x: 0.52, y: 0.8, radius: 520, spawnGroup: 'south' },
  ],
  passages: [
    { id: 'center-to-northwest', from: 'arena-center', to: 'camp-northwest', x: 0.38, y: 0.38, width: 220 },
    { id: 'center-to-northeast', from: 'arena-center', to: 'grove-northeast', x: 0.62, y: 0.38, width: 210 },
    { id: 'center-to-east', from: 'arena-center', to: 'pond-east', x: 0.69, y: 0.51, width: 190 },
    { id: 'center-to-southwest', from: 'arena-center', to: 'campfire-southwest', x: 0.37, y: 0.64, width: 220 },
    { id: 'center-to-south', from: 'arena-center', to: 'boss-south', x: 0.5, y: 0.68, width: 220 },
    { id: 'outer-north', from: 'camp-northwest', to: 'grove-northeast', x: 0.5, y: 0.09, width: 180 },
    { id: 'outer-east', from: 'grove-northeast', to: 'pond-east', x: 0.87, y: 0.39, width: 170 },
    { id: 'outer-south-east', from: 'pond-east', to: 'boss-south', x: 0.78, y: 0.78, width: 180 },
    { id: 'outer-south-west', from: 'boss-south', to: 'campfire-southwest', x: 0.36, y: 0.89, width: 190 },
    { id: 'outer-west', from: 'campfire-southwest', to: 'camp-northwest', x: 0.1, y: 0.5, width: 180 },
  ],
  obstacles: [
    { id: 'camp-wall-northwest', kind: 'wall', shape: 'box', x: 0.175, y: 0.16, width: 220, height: 34, rotation: -0.04, regionId: 'camp-northwest' },
    { id: 'camp-wall-north-east', kind: 'ruin', shape: 'box', x: 0.29, y: 0.15, width: 165, height: 30, rotation: 0.08, regionId: 'camp-northwest' },
    { id: 'camp-wall-west-north', kind: 'ruin', shape: 'box', x: 0.15, y: 0.195, width: 38, height: 185, rotation: -0.03, regionId: 'camp-northwest' },
    { id: 'camp-wall-west-south', kind: 'wall', shape: 'box', x: 0.158, y: 0.29, width: 36, height: 145, rotation: 0.06, regionId: 'camp-northwest' },
    { id: 'camp-wall-east-north', kind: 'ruin', shape: 'box', x: 0.315, y: 0.205, width: 36, height: 140, rotation: 0.03, regionId: 'camp-northwest' },
    { id: 'camp-wall-east-south', kind: 'wall', shape: 'box', x: 0.31, y: 0.29, width: 36, height: 110, rotation: -0.08, regionId: 'camp-northwest' },
    { id: 'camp-fence-south-west', kind: 'fence', shape: 'box', x: 0.205, y: 0.335, width: 100, height: 24, rotation: 0, regionId: 'camp-northwest' },
    { id: 'camp-fence-south-east', kind: 'fence', shape: 'box', x: 0.28, y: 0.335, width: 76, height: 24, rotation: -0.08, regionId: 'camp-northwest' },
    { id: 'camp-rock', kind: 'rocks', shape: 'circle', x: 0.31, y: 0.16, radius: 20, rotation: 0, regionId: 'camp-northwest' },
    { id: 'grove-rock-west', kind: 'rocks', shape: 'circle', x: 0.61, y: 0.18, radius: 21, rotation: 0, regionId: 'grove-northeast' },
    { id: 'grove-rock-east', kind: 'rocks', shape: 'circle', x: 0.76, y: 0.25, radius: 24, rotation: 0, regionId: 'grove-northeast' },
    { id: 'grove-rock-south', kind: 'rocks', shape: 'circle', x: 0.72, y: 0.34, radius: 18, rotation: 0, regionId: 'grove-northeast' },
    { id: 'pond-rock-northwest', kind: 'rocks', shape: 'circle', x: 0.72, y: 0.44, radius: 21, rotation: 0, regionId: 'pond-east' },
    { id: 'pond-rock-northeast', kind: 'rocks', shape: 'circle', x: 0.88, y: 0.44, radius: 23, rotation: 0, regionId: 'pond-east' },
    { id: 'pond-rock-southeast', kind: 'rocks', shape: 'circle', x: 0.88, y: 0.68, radius: 20, rotation: 0, regionId: 'pond-east' },
    { id: 'pond-rock-southwest', kind: 'rocks', shape: 'circle', x: 0.7, y: 0.7, radius: 18, rotation: 0, regionId: 'pond-east' },
    { id: 'campfire-fence-west', kind: 'fence', shape: 'box', x: 0.16, y: 0.73, width: 170, height: 24, rotation: 0.03, regionId: 'campfire-southwest' },
    { id: 'campfire-fence-east', kind: 'fence', shape: 'box', x: 0.27, y: 0.82, width: 135, height: 24, rotation: -0.3, regionId: 'campfire-southwest' },
    { id: 'stone-ring-west-north', kind: 'pillar', shape: 'circle', x: 0.41, y: 0.74, radius: 17, rotation: 0, regionId: 'boss-south' },
    { id: 'stone-ring-north', kind: 'pillar', shape: 'circle', x: 0.47, y: 0.71, radius: 20, rotation: 0, regionId: 'boss-south' },
    { id: 'stone-ring-east-north', kind: 'pillar', shape: 'circle', x: 0.55, y: 0.71, radius: 17, rotation: 0, regionId: 'boss-south' },
    { id: 'stone-ring-east', kind: 'pillar', shape: 'circle', x: 0.62, y: 0.77, radius: 20, rotation: 0, regionId: 'boss-south' },
    { id: 'stone-ring-east-south', kind: 'pillar', shape: 'circle', x: 0.62, y: 0.85, radius: 18, rotation: 0, regionId: 'boss-south' },
    { id: 'stone-ring-south', kind: 'pillar', shape: 'circle', x: 0.55, y: 0.89, radius: 20, rotation: 0, regionId: 'boss-south' },
    { id: 'stone-ring-west-south', kind: 'pillar', shape: 'circle', x: 0.47, y: 0.89, radius: 17, rotation: 0, regionId: 'boss-south' },
    { id: 'stone-ring-west', kind: 'pillar', shape: 'circle', x: 0.4, y: 0.83, radius: 20, rotation: 0, regionId: 'boss-south' },
  ],
  decorations: [
    { id: 'camp-tent-west', kind: 'tent', x: 0.2, y: 0.23, rotation: -0.18, scale: 1, regionId: 'camp-northwest' },
    { id: 'camp-tent-east', kind: 'tent', x: 0.27, y: 0.25, rotation: 0.22, scale: 0.9, regionId: 'camp-northwest' },
    { id: 'camp-log', kind: 'log', x: 0.18, y: 0.31, rotation: 0.12, scale: 1, regionId: 'camp-northwest' },
    { id: 'boss-banner-west', kind: 'banner', x: 0.44, y: 0.77, rotation: 0, scale: 1, regionId: 'boss-south' },
    { id: 'boss-banner-east', kind: 'banner', x: 0.6, y: 0.77, rotation: 0, scale: 1, regionId: 'boss-south' },
    { id: 'campfire-log', kind: 'log', x: 0.18, y: 0.81, rotation: -0.3, scale: 0.9, regionId: 'campfire-southwest' },
    { id: 'pond-reeds-northwest', kind: 'reed', x: 0.755, y: 0.405, rotation: 0, scale: 1, regionId: 'pond-east' },
    { id: 'pond-reeds-north', kind: 'reed', x: 0.83, y: 0.37, rotation: 0, scale: 1.15, regionId: 'pond-east' },
    { id: 'pond-reeds-northeast', kind: 'reed', x: 0.895, y: 0.445, rotation: 0, scale: 0.9, regionId: 'pond-east' },
    { id: 'pond-reeds-east', kind: 'reed', x: 0.91, y: 0.555, rotation: 0, scale: 1.1, regionId: 'pond-east' },
    { id: 'pond-reeds-southeast', kind: 'reed', x: 0.88, y: 0.645, rotation: 0, scale: 1, regionId: 'pond-east' },
    { id: 'pond-reeds-south', kind: 'reed', x: 0.8, y: 0.67, rotation: 0, scale: 1.15, regionId: 'pond-east' },
    { id: 'pond-reeds-southwest', kind: 'reed', x: 0.745, y: 0.61, rotation: 0, scale: 0.85, regionId: 'pond-east' },
  ],
};

export const PROVING_GROUND: GameMapDef = {
  id: 'proving',
  presentation: {
    nameKey: 'mapProvingName',
    tagKey: 'mapProvingTag',
    blurbKey: 'mapProvingBlurb',
    terrainKey: 'mapProvingTerrain',
    weatherNoteKey: 'mapProvingWeather',
    sightKey: 'mapProvingSight',
    foes: [
      foe('thug', 'unitThugNote'),
      foe('peasant', 'unitPeasantNote'),
      foe('spearman', 'unitSpearmanNote'),
      foe('shieldman', 'unitShieldmanNote'),
      foe('archer', 'unitArcherNote'),
      foe('halberdier', 'unitHalberdierNote'),
      foe('cavalry', 'unitCavalryNote'),
      foe('bulwark', 'unitBulwarkNote'),
      foe('lancer', 'unitLancerNote'),
      foe('horseArcher', 'unitHorseArcherNote'),
      boss('elite', 'mapProvingBossName', 'mapBossPending'),
    ],
    objectiveKey: 'mapProvingObjective',
  },
  world: {
    width: 3600,
    height: 3600,
    seed: 20260902,
    layout: PROVING_LAYOUT,
    landmarks: [
      { id: 'start', kind: 'start', x: 0.5, y: 0.5, radius: 180, labelKey: 'setupSpawn' },
      { id: 'camp-northwest', kind: 'campfire', x: 0.25, y: 0.23, radius: 18, labelKey: 'setupCamp' },
      { id: 'camp-northeast', kind: 'campfire', x: 0.58, y: 0.42, radius: 18, labelKey: 'setupCamp' },
      { id: 'camp-southwest', kind: 'campfire', x: 0.31, y: 0.78, radius: 18, labelKey: 'setupCamp' },
      { id: 'camp-southeast', kind: 'campfire', x: 0.72, y: 0.88, radius: 18, labelKey: 'setupCamp' },
    ],
    topology: PROVING_TOPOLOGY,
  },
  weather: 'clear',
  encounter: {
    template: DEFAULT_SPAWN_TEMPLATE,
    modifier: NEUTRAL_MODIFIER,
    bossKind: 'elite',
    bossSchedule: [0, 0, 1, 0, 1, 1, 0, 1],
    spawn: {
      noSpawnZones: [
        { id: 'central-arena', x: 0.5, y: 0.5, radius: 330 },
      ],
      anchors: [
        { id: 'north', regionId: 'grove-northeast', x: 0.5, y: 0.06, radius: 150, weight: 1 },
        { id: 'northeast', regionId: 'grove-northeast', x: 0.86, y: 0.14, radius: 150, weight: 1 },
        { id: 'east', regionId: 'pond-east', x: 0.94, y: 0.5, radius: 150, weight: 1 },
        { id: 'southeast', regionId: 'boss-south', x: 0.86, y: 0.86, radius: 150, weight: 1 },
        { id: 'south', regionId: 'boss-south', x: 0.5, y: 0.94, radius: 150, weight: 1 },
        { id: 'southwest', regionId: 'campfire-southwest', x: 0.14, y: 0.86, radius: 150, weight: 1 },
        { id: 'west', regionId: 'camp-northwest', x: 0.06, y: 0.5, radius: 150, weight: 1 },
        { id: 'northwest', regionId: 'camp-northwest', x: 0.14, y: 0.14, radius: 150, weight: 1 },
      ],
      waveBias: [
        { pattern: 'surround', regionWeights: { northwest: 0.45, northeast: 0.35, east: 0.1, southwest: 0.1, south: 0 } },
        { pattern: 'surround', regionWeights: { northwest: 0.35, northeast: 0.35, east: 0.15, southwest: 0.1, south: 0.05 } },
        { pattern: 'side-pressure', regionWeights: { northwest: 0.4, northeast: 0.4, east: 0.1, southwest: 0.05, south: 0.05 } },
        { pattern: 'side-pressure', regionWeights: { northwest: 0.25, northeast: 0.35, east: 0.25, southwest: 0.1, south: 0.05 } },
        { pattern: 'mixed', regionWeights: { northwest: 0.15, northeast: 0.2, east: 0.3, southwest: 0.15, south: 0.2 } },
        { pattern: 'mixed', regionWeights: { northwest: 0.1, northeast: 0.15, east: 0.3, southwest: 0.2, south: 0.25 } },
        { pattern: 'forward-pressure', regionWeights: { northwest: 0.2, northeast: 0.2, east: 0.2, southwest: 0.2, south: 0.2 } },
        { pattern: 'final', regionWeights: { northwest: 0.15, northeast: 0.2, east: 0.25, southwest: 0.1, south: 0.3 } },
      ],
    },
  },
};

function validateProvingGround(map: GameMapDef): void {
  if (map.encounter.bossSchedule.length !== map.encounter.template.waves.length) {
    throw new Error('Proving Grounds boss schedule count must match wave count');
  }
  if (map.encounter.spawn.waveBias.length !== map.encounter.template.waves.length) {
    throw new Error('Proving Grounds spawn bias count must match wave count');
  }
  const roster = new Set<string>(map.presentation.foes.map((foe) => foe.id));
  for (const wave of map.encounter.template.waves) {
    for (const id of Object.keys(wave.mix)) {
      if (!roster.has(id)) throw new Error(`Proving Grounds roster is missing ${id}`);
    }
  }
  if (!map.presentation.foes.some((foe) => foe.boss && foe.id === map.encounter.bossKind)) {
    throw new Error('Proving Grounds boss kind is missing from the setup roster');
  }
  const landmarkIds = map.world.landmarks.map((landmark) => landmark.id);
  if (new Set(landmarkIds).size !== landmarkIds.length) throw new Error('Proving Grounds landmark ids must be unique');
  if (map.world.landmarks.filter((landmark) => landmark.kind === 'start').length !== 1) {
    throw new Error('Proving Grounds must have exactly one start landmark');
  }
  const anchorIds = map.encounter.spawn.anchors.map((anchor) => anchor.id);
  if (new Set(anchorIds).size !== anchorIds.length) throw new Error('Proving Grounds spawn anchor ids must be unique');
  const regionIds = new Set(map.world.topology.regions.map((region) => region.id));
  if (!regionIds.has('arena-center')) throw new Error('Proving Grounds topology must include the central arena');
  for (const passage of map.world.topology.passages) {
    if (!regionIds.has(passage.from) || !regionIds.has(passage.to)) {
      throw new Error(`Proving Grounds passage ${passage.id} references an unknown region`);
    }
  }
  for (const obstacle of map.world.topology.obstacles) {
    if (!regionIds.has(obstacle.regionId)) throw new Error(`Proving Grounds obstacle ${obstacle.id} references an unknown region`);
  }
  for (const decoration of map.world.topology.decorations) {
    if (!regionIds.has(decoration.regionId)) throw new Error(`Proving Grounds decoration ${decoration.id} references an unknown region`);
  }
  for (const anchor of map.encounter.spawn.anchors) {
    if (!regionIds.has(anchor.regionId)) throw new Error(`Proving Grounds anchor ${anchor.id} references an unknown region`);
  }
}

validateProvingGround(PROVING_GROUND);
