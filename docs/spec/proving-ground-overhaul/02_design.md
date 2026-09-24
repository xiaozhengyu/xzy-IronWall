# Design: Proving Ground Map Overhaul

## Gameplay Rules

Proving Grounds remains an eight-wave action-survival battlefield. The map's authored geometry creates readable routes and combat spaces; it does not introduce tactical pathfinding or scripted encounter stages.

### Spatial roles

- The center is a clear start and early-wave arena.
- A large upper-left dirt yard is a recognizable secondary fighting space.
- A lower-right pond is a visual orientation landmark and remains traversable during this phase.
- Two asymmetric groves shape an outer route and create side pressure without sealing the map into a corridor.
- The perimeter tree wall is both a visible boundary and a soft enclosure for the combat space.
- Four authored campfires form a stable resupply loop between the center and outer route.

### Spawn rules

The existing spawn and distant-enemy pipeline remains authoritative for population, culling, restoration, and performance. Proving Grounds adds only the spatial inputs:

- A central no-spawn region protects the opening arena.
- Six to eight perimeter spawn anchors provide deterministic directional sources.
- A wave selects a lightweight `SpawnPattern` such as `surround`, `forward-pressure`, `side-pressure`, `mixed`, or `final`.
- The pattern biases anchor selection; the final position still uses terrain/prop collision checks and active-area margins.
- Player movement can retain the current forward bias, but the map may weight side or rear anchors by pattern.
- Spawn anchors never override global population caps, wave budgets, or free-spot validation.

### Wave and boss rules

The default eight-wave curve is re-authored for clear teaching and escalation: basic melee, spear pressure, shield durability, ranged threat, halberd reach, mounted/heavy pressure, mixed mobile pressure, and a final mixed climax.

Each wave owns its enemy mix, population targets, and spawn pattern. The map encounter definition owns the boss kind and schedule. The current `BOSS_KIND` global is removed from the battle decision path; Proving Grounds explicitly selects the elite boss during this phase.

Early waves should teach the normal roster before a boss appears. A mid-run boss check and a final boss climax are preferred over an unexplained boss on every early wave. Exact wave numbers and counts are tuning values validated through figures, bench runs, and manual play.

Card rewards continue to derive their first-card cadence from the selected spawn template. The target remains full core-build access before the final climax, with the last waves providing time to use the build.

## State and Data

Introduce a map-owned definition with explicit boundaries. The exact TypeScript names may follow existing naming conventions, but the data must represent these concepts:

```ts
interface MapLandmark {
  id: string;
  kind: 'start' | 'campfire' | 'spawn-anchor' | 'objective';
  x: number;
  y: number;
  radius: number;
  labelKey?: HudTextKey;
}

interface SpawnAnchor {
  id: string;
  x: number;
  y: number;
  radius: number;
  weight: number;
}

interface MapSpawnProfile {
  noSpawnZones: readonly MapZone[];
  anchors: readonly SpawnAnchor[];
}

interface MapEncounter {
  template: SpawnTemplate;
  modifier: MapModifier;
  bossKind: BossKindId;
  bossSchedule: readonly number[];
  spawn: MapSpawnProfile;
}
```

`GameMapDef` should group the existing presentation, world, weather, and encounter data instead of keeping them as unrelated top-level fields. `TerrainLayout` remains responsible for generated terrain geometry; authored landmarks are separate so a campfire or spawn anchor cannot accidentally become a visual terrain primitive.

The runtime enemy roster should be derived from or validated against the wave mixes. The setup screen may show a curated preview roster, but that must be named as presentation data and must not be confused with the complete runtime roster.

`Profile.lastMap` is restored by resolving the saved id against the registered map list. Invalid or removed ids fall back to index zero and are not allowed to crash setup.

## Runtime Flow

1. `src/data/maps/provingGround.ts` owns the authored Proving Grounds definition.
2. `src/data/maps.ts` registers the single map and exposes shared map types.
3. Boot derives the initial `Field` dimensions, seed, and layout from the registered map instead of duplicate constants.
4. `Field` constructs `Terrain`, `Weather`, `GroundSurface`, and props from the map world definition. Explicit landmarks are placed deterministically.
5. Setup reads presentation, map weather, landmarks, and preview roster. The map preview uses the same `Field` and weather state as combat.
6. Starting a run passes the map encounter definition to `Battle`, sets the field, resets the player to the authored start point, and initializes the selected weather.
7. `Battle` uses the encounter template and boss schedule, while its existing population, spawn, recycle, collision, and distant-motion systems remain shared.
8. `Scene` and `Minimap` consume the same field and landmark metadata. The setup map, battle scene, and minimap must resolve the same normalized coordinates to the same world positions.
9. On returning to setup, the profile resolves the saved map id safely and preserves the single-map fallback behavior.

## Module Impact

### New or reorganized map data

- `src/data/maps/provingGround.ts`: authored Proving Grounds content and encounter definition.
- `src/data/maps.ts`: map registry and shared map types.
- `src/data/types.ts` or a focused map-data type module: landmark, spawn-profile, and boss-schedule types.
- `src/data/waves.ts`: re-authored proving-ground wave data and spawn-pattern fields.

### World and battle integration

- `src/world/terrain.ts`: consume the explicit terrain layout without embedding proving-ground assumptions.
- `src/world/props.ts`: support deterministic authored campfires/landmarks for this map.
- `src/game/field.ts`: initialize map-owned landmarks and expose them to render/minimap systems.
- `src/game/battle.ts`: accept map-owned spawn profile and boss schedule; preserve shared budgets and distant-enemy mechanics.
- `src/game/profile.ts`: safe last-map restore/fallback.
- `src/main.ts`: remove duplicate field constants and route map data through the unified definition.

### UI and rendering

- `src/ui/setup.ts`: use explicit map presentation and landmark data; clarify complete roster versus curated preview.
- `src/render/scene.ts`: render the same authored world and landmarks in preview and battle.
- `src/ui/minimap.ts`: display authored start/camp/objective/boss landmarks from the shared field.
- `src/ui/text/*`: update map and roster copy without hard-coded map-specific text outside localization.

### Intentionally untouched boundaries

- Hero progression, item behavior, generic weather simulation, skill behavior, and rendering primitives remain unchanged unless a validation failure requires a narrow adapter change.
- No database or migration files are needed.

## Edge Cases

- A saved map id is absent or refers to a removed map: use the first registered map and continue without a migration prompt.
- An authored landmark overlaps a tree, pond, or another landmark: validate during map construction or build-time checks and fail clearly rather than silently moving it.
- A spawn anchor has no free position because of terrain or props: probe within the anchor radius, then fall back to another valid anchor; never spawn inside the active view or an obstacle.
- The central start zone is temporarily crowded by a wave: no-spawn protection applies to wave spawning and world seeding, while ordinary enemy pursuit can still approach it.
- Weather changes during setup: update the same cached field and rebake only the weather-dependent ground layer; landmark coordinates do not change.
- Preview and battle use different camera spans: both use the same world coordinates and only change projection/zoom.
- The final boss is killed before the wave timer ends: victory checks use the map-owned final boss schedule and existing wave completion semantics, not a global boss assumption.

## Design Risks

- A large new map data contract can spread through `main.ts`, `Battle`, `Field`, and UI. Keep adapters narrow and migrate one flow at a time.
- Authored spawn anchors can reduce the current sense of being surrounded if weights are too directional. Compare stationary and moving-player figures before locking them.
- More explicit props and landmarks can make the map feel over-designed or visually noisy. Keep the central area sparse and validate at both overview and combat zoom.
- Retuning wave populations may change frame cost. The global world budget and `npm run bench` are release gates.
- The existing terrain comments and historical tuning notes contain stale values. Update them as part of implementation so future tuning uses the actual numbers.
