# Design: Proving Ground Spatial Topology

## Design Principles

1. Change the spatial grammar before adding visual decoration.
2. Use a few strong obstacle groups instead of many small blockers.
3. Keep the map loopable: every side space must have a way in and a way out.
4. Let topology influence spawn direction, not enemy navigation.
5. Keep terrain material, authored topology, and encounter tuning separate.

## Visual Target

The visual reference is `screenshots/proving-ground-topology-target.png`. It is a layout and rendering target, not a request for pixel-for-pixel reproduction of generated artwork.

### Must Match Closely

- The center is a large, light, visually quiet negative-space arena.
- The outer tree wall is dark and dense enough to frame the playable field without becoming the main tactical maze.
- The northwest camp, northeast grove, east pond bay, southwest campfire route, and south stone array have distinct silhouettes at overview scale.
- The outer route remains readable as a continuous warm dirt band with broad branches into the center.
- Hard obstacles read as grouped, chunky pixel silhouettes: broken walls, fences, stone clusters, and ruins.
- The pond reads as a cool, flat stepped shape with a rocky edge rather than as a soft gradient.
- Campfire and banners act as small high-contrast landmarks.
- Grass is the dominant ground material outside the authored arenas and paths. Dirt clearings remain separated by green space; paths are winding bands rather than axis-aligned rectangles.
- Trees are several times taller than a character in the same camera view; authored boulders are small enough to read as rocks, while the south array uses upright stone silhouettes.
- The pond has an irregular edge, a narrow shoreline, and visible vegetation/rocks on the banks. Its footprint stays in the east bay.
- Ground color variation stays broad and restrained; small noisy patches must not compete with the authored clearings and route silhouettes.

### Can Be Simplified

- Individual tree shapes, grass tufts, flowers, reeds, logs, and small rocks may be procedurally repeated.
- Soft painted lighting and ambient occlusion are not required; use the existing hard color ramps and compact shadow bands.
- The exact texture noise and every prop variation do not need to match the generated image.

### Rendering Budget

- Prefer the existing baked ground surface for static material masks.
- Keep decorative detail sparse enough for the current terrain draw pass and dense-wave budget.
- Author only the obstacle and landmark props that change route readability; filler vegetation remains generated.
- Use the same resolved field coordinates for full-map setup preview, minimap, and battle camera.

## Data Model

`GameMapDef` remains the single source of map content. The existing terrain and landmark data are extended with a map-owned topology section:

```ts
interface MapRegion {
  id: string;
  role: 'arena' | 'camp' | 'grove' | 'pond' | 'boss';
  // x/y are normalized; radius is world units.
  x: number;
  y: number;
  radius: number;
  spawnGroup: string;
}

interface MapPassage {
  id: string;
  from: string;
  to: string;
  // x/y are normalized; width is world units.
  x: number;
  y: number;
  width: number;
}

type MapObstacle = {
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

interface MapTopology {
  regions: readonly MapRegion[];
  passages: readonly MapPassage[];
  obstacles: readonly MapObstacle[];
  decorations: readonly MapDecoration[];
}

interface MapDecoration {
  id: string;
  kind: 'tent' | 'banner' | 'log' | 'reed';
  x: number;
  y: number;
  rotation: number;
  scale: number;
  regionId: string;
}
```

Positions use normalized coordinates; obstacle sizes and passage widths use world units. A map definition may retain `TerrainLayout` for generated materials, but terrain material must not silently create gameplay collision. Trees, props, and authored obstacles remain separate collision sources.

Spawn anchors gain a `regionId`. Wave data or the encounter definition supplies region weights for each wave. The existing lightweight `SpawnPattern` remains the high-level pattern name; region weights provide the map-specific bias.

## Runtime Responsibilities

### Map data module

`src/data/maps/provingGround.ts` owns the region list, passage graph, obstacle groups, spawn-anchor ownership, and wave region weights. It also keeps the current terrain layout, landmarks, encounter template, and boss schedule.

### Field

`Field` resolves normalized topology coordinates to world coordinates at construction time. It exposes immutable resolved regions, passages, and obstacles to the scene, minimap, collision adapter, and validation/debug views. Topology is static for a run.

### Collision

The existing collision pipeline continues to resolve movement through a set of simple circular blockers. Terrain trees and props remain in the set; authored box obstacles are converted to a conservative collision representation or a small collection of circles. The first implementation should prefer the simplest representation that preserves passage widths and prevents actors from crossing hard obstacles.

Water remains walkable. The pond changes route readability through its shape and adjacent obstacles, not by becoming a new movement rule.

### Battle and spawn selection

Battle consumes the map encounter's region-weighted spawn profile. It chooses a region or anchor according to the current wave pattern, then runs the existing free-spot, no-spawn, active-view, terrain, obstacle, and population checks. If the chosen region has no valid position, selection falls back to another weighted region and then to the existing safe circular fallback.

Battle does not query region roles or perform pathfinding. Once an enemy is spawned, existing movement and combat behavior remains authoritative.

`Props` renders visual-only topology decorations such as tents, banners, and logs. These decorations share authored coordinates but never enter collision or spawn-free checks.

### Preview and minimap

Setup preview and minimap consume resolved regions, major obstacles, landmarks, and the same field dimensions. Regions may be shown as subdued outlines or tinted areas; obstacles should be simplified rather than rendered as debug geometry in the final presentation.

The setup overview should approximate the target image's composition and color hierarchy. The battle camera shows only a local crop, but it must use the same palette, terrain masks, obstacle silhouettes, and landmark art so that moving from the overview into combat does not change the map's visual identity.

## Approved Layout and Topology Rules

- The central arena has the authored start point and at least three exits.
- Every intended passage has at least 96 world units of clear width after obstacle inflation; the primary mounted/boss route targets 128 world units.
- The northwest camp has two entrances, with a southeast-facing opening toward the center.
- The northeast grove gap is a side route, not a sealed forest pocket.
- The east pond bay has a readable route around the shoreline and at least one return connection.
- The south stone array is open enough for a boss encounter and has a north exit plus an outer-loop exit.
- The southwest campfire route connects to both the center and the outer loop.
- The perimeter tree wall remains a soft visual boundary.
- No hard obstacle may overlap the start landmark, a campfire interaction radius, a spawn anchor radius, or another hard obstacle after resolution.
- No obstacle group may close every passage between two connected regions.

## Spawn Rhythm

The eight-wave encounter keeps the existing action-survival curve while changing spatial emphasis:

| Waves | Primary regions | Intended pressure |
| --- | --- | --- |
| 1-2 | north and west perimeter | readable central introduction |
| 3-4 | northwest camp and northeast grove | side pressure and ranged spacing |
| 5-6 | east pond bay and southwest route | outer-loop rotation and mobile threats |
| 7 | rotating side/rear groups | punish permanent edge hugging without teleporting blockers |
| 8 | south stone array plus east/north side groups | multi-direction climax with a preserved escape route |

The spawn resolver must avoid placing enemies directly in front of a moving player at close range. A region bias is a probability preference, not a guarantee; runtime safety checks remain authoritative.

## Validation Rules

The map constructor or a dedicated validator should check:

- unique region, passage, obstacle, landmark, and anchor ids;
- every passage endpoint references a known region;
- the region graph reaches every region from the central arena;
- exactly one start landmark exists;
- obstacle and passage dimensions are positive;
- no authored obstacle intersects protected start, campfire, or spawn areas;
- every wave region id and anchor region id resolves;
- the boss's preferred region has a valid fallback region;
- the resolved topology remains inside the playable field margin.

Validation should fail clearly during map construction rather than silently moving authored content.

## Implementation Sequence

1. Add topology, obstacle, and decoration types without changing map content.
2. Add resolved topology to `Field` and a static collision adapter.
3. Author the five regions, passages, and obstacle groups in Proving Grounds.
4. Migrate spawn anchors to region ownership and add wave region weights.
5. Add restrained visual-only decorations and update minimap/setup preview and offline preview compatibility.
6. Validate traversal, spawn safety, wave rhythm, performance, and visual readability.

## Risks and Mitigations

- Too many hard obstacles can make the map feel like a maze. Keep the center open and validate two-way exits.
- Conservative circle conversion can make box obstacles too large. Compare the resolved collision footprint against the authored passage width.
- Region-biased spawning can feel scripted. Keep a weighted fallback and preserve the existing surrounding-pressure behavior.
- More blockers can increase collision checks. Keep obstacle groups small, static, and spatially filtered if benchmark data requires it.
- Minimap overlays can become noisy. Show only major region silhouettes and landmark icons at overview scale.

## Non-Goals Confirmed

This design does not introduce height, line-of-sight rules, pathfinding, dynamic destruction, new water physics, or a map editor.
