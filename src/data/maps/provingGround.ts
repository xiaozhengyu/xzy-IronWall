import type { HudTextKey } from '../../ui/text/hudText.types';
import { DEFAULT_LAYOUT } from '../../world/terrain';
import { DEFAULT_SPAWN_TEMPLATE } from '../waves';
import { resolveKind, unitKind, type BossKindId, type UnitKindId } from '../units';
import { NEUTRAL_MODIFIER } from '../types';
import type { GameMapDef, MapFoe } from '../mapTypes';

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
    layout: DEFAULT_LAYOUT,
    landmarks: [
      { id: 'start', kind: 'start', x: 0.5, y: 0.5, radius: 180, labelKey: 'setupSpawn' },
      { id: 'camp-northwest', kind: 'campfire', x: 0.25, y: 0.23, radius: 18, labelKey: 'setupCamp' },
      { id: 'camp-northeast', kind: 'campfire', x: 0.67, y: 0.22, radius: 18, labelKey: 'setupCamp' },
      { id: 'camp-southwest', kind: 'campfire', x: 0.31, y: 0.78, radius: 18, labelKey: 'setupCamp' },
      { id: 'camp-southeast', kind: 'campfire', x: 0.84, y: 0.86, radius: 18, labelKey: 'setupCamp' },
    ],
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
        { id: 'north', x: 0.5, y: 0.06, radius: 150, weight: 1 },
        { id: 'northeast', x: 0.86, y: 0.14, radius: 150, weight: 1 },
        { id: 'east', x: 0.94, y: 0.5, radius: 150, weight: 1 },
        { id: 'southeast', x: 0.86, y: 0.86, radius: 150, weight: 1 },
        { id: 'south', x: 0.5, y: 0.94, radius: 150, weight: 1 },
        { id: 'southwest', x: 0.14, y: 0.86, radius: 150, weight: 1 },
        { id: 'west', x: 0.06, y: 0.5, radius: 150, weight: 1 },
        { id: 'northwest', x: 0.14, y: 0.14, radius: 150, weight: 1 },
      ],
    },
  },
};

function validateProvingGround(map: GameMapDef): void {
  if (map.encounter.bossSchedule.length !== map.encounter.template.waves.length) {
    throw new Error('Proving Grounds boss schedule count must match wave count');
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
}

validateProvingGround(PROVING_GROUND);
