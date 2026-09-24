# Feature: Proving Ground Spatial Topology

## Status

Approved design; visual correction implemented, with final live-scene comparison pending.

## Player Problem

The current Proving Grounds map has recognizable materials and landmarks, but its playable space is still a mostly continuous grass field. Water is traversable, authored hard obstacles are absent, and wave pressure mostly arrives from a uniform perimeter ring. As a result, movement, combat positioning, and route choice change very little between areas or waves.

## Desired Outcome

Make Proving Grounds read and play as one authored battlefield: a central training arena connected to an outer loop, four side combat spaces, and a southwest resupply node. The map should create meaningful decisions about when to rotate, take a side route, return to the center, or use a campfire without introducing pathfinding or a new elevation system. The visual target is the hard-edged pixel overview in `screenshots/proving-ground-topology-target.png`.

The 2026-09-24 in-game comparison showed that the first implementation does not meet this visual target. Its dirt regions merge into most of the field, roads and pond are rectangular, trees are too small, and rocks are disproportionately large. Visual acceptance requires comparison against an actual full-map capture and at least one combat-scale capture, not only a successful build or offline figure.

## Goals

- Establish a central arena, an outer traversal loop, four side regions with distinct combat roles, and a resupply node.
- Add authored static obstacles that create short reroutes, partial cover, and recognizable silhouettes.
- Keep every region reachable from the center and avoid dead-end traps.
- Bind wave spawn pressure to regions and directional groups instead of one uniform perimeter.
- Keep the existing action-survival combat, population budgets, terrain baking, camera, and distant-enemy pipeline.
- Define topology in the map module so setup, battle, minimap, collision, and validation consume the same data.

## In Scope

- A map-owned topology model for regions, passages, and static obstacles.
- Simple circle and box obstacle collision for players and enemies.
- Region ownership on spawn anchors and per-wave region weights.
- Topology validation for reachability, obstacle safety, and spawn/landmark clearance.
- Minimap and preview representation of authored regions and major obstacles where useful.
- Repositioning or reshaping existing Proving Grounds terrain features to support the approved layout.
- Reworking the authored palette, terrain masks, vegetation clusters, water edge, and static prop silhouettes to match the visual target.

## Out of Scope

- Real elevation, cliffs, ramps, multi-level traversal, or height-aware projectiles.
- Enemy pathfinding, tactical navigation, or a scripted encounter graph.
- Dynamic obstacle destruction, movable props, or destructible terrain.
- Changing water into a new collision layer; water remains traversable in this phase.
- Adding another map or building a general-purpose map editor.
- Rewriting enemy AI, hero progression, item systems, or the rendering engine.

## Approved Spatial Structure

- Central Proving Arena: the largest open area, authored start point, and early-wave teaching space.
- Northwest Abandoned Camp: partial ruins and fences with two entrances.
- Northeast Grove Gap: a curved side route shaped by forest, rocks, and open passages.
- East Pond Bay: a visible route turn around the existing pond and shoreline obstacles.
- South Stone Array: an open late-wave and boss space with an incomplete ring.
- Southwest Campfire Route: a resupply node connected to the center and the outer loop.
- Perimeter tree wall: a soft boundary and visual frame, not the main tactical obstacle.

## Acceptance Criteria

- [ ] The center connects to every authored region through at least one validated passage.
- [ ] The outer route contains no unavoidable dead end and has at least one return route to the center.
- [ ] Every hard obstacle is represented by simple collision geometry and is absent from the start point, campfire interaction area, and spawn-safe areas.
- [ ] No intended passage has less than 96 world units of clear width after collision resolution; the primary mounted/boss route targets at least 128 world units.
- [ ] Early waves remain readable in the center; middle waves introduce side pressure; late waves use the south/east spaces for escalation.
- [ ] Spawn selection is region-biased but still respects terrain, obstacle, active-view, no-spawn, and population checks.
- [ ] Setup, battle, minimap, collision, and offline preview resolve the same authored topology coordinates.
- [ ] The full-map overview and combat-scale views share the visual target's palette roles, zone silhouettes, obstacle language, and landmark readability; decorative detail may be simplified but must not change the spatial read.
- [ ] `npm run build`, `npm run figures`, `npm run bench`, wave-8 bench, and `git diff --check` pass.
- [ ] Manual traversal confirms every region is reachable and no obstacle traps the player or enemies.

## Constraints

- Preserve the 3600×3600 map baseline unless validation shows a specific topology problem that cannot be solved through layout.
- Preserve the existing pixel-art projection, terrain baking, weather flow, camera model, and performance budget.
- Keep map-authored positions normalized and obstacle dimensions explicit in world units.
- Keep player-facing copy in the existing localization system.
- Do not commit generated previews, benchmark outputs, or a Git commit without explicit user authorization.
