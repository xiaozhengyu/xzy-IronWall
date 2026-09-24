# Validation: Proving Ground Spatial Topology

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Full traversal | Start at the center and visit the northwest camp, northeast grove, east pond bay, southwest campfire route, and south stone array | Every region is reachable; each side region has a return route; no passage traps the player |
| Obstacle clearance | Walk and sprint through every authored passage with the hero and observe ordinary enemies entering the same area | Actors do not snag on invisible edges; passages remain wide enough for the intended traffic |
| Start safety | Start a fresh run and inspect the first minute | The center remains readable and open; no authored obstacle overlaps the start or early spawn area |
| Campfire route | Visit every campfire and return to the center | Campfires remain reachable, visually legible, and useful as route nodes |
| Wave geography | Observe waves 1-2, 3-4, 5-6, 7, and 8 while moving between regions | Pressure shifts from central introduction to side pressure, outer rotation, and a south-led climax without sudden close-range blocking |
| Boss region | Reach the configured boss waves and observe the boss entrance | The boss favors the intended late-game region, has a valid fallback, and does not spawn inside obstacles or the active view |
| Minimap consistency | Compare setup preview, minimap, and world view at each region | Landmarks, region placement, field bounds, and major obstacles align across surfaces |
| Persistence and reset | Return to setup, restart a run, and switch weather | Topology coordinates remain stable; field reset does not duplicate or remove obstacles |
| Long run | Simulate or play through wave 8 while traversing the outer loop | Population remains bounded, spawn fallback remains stable, and no collision or landmark leak appears |

## Automated Checks

- `npm run build`
- `npm run figures`
- `npm run bench`
- `$env:WAVE='8'; npm run bench`
- `git diff --check`
- Static validation for unique topology ids and valid region references.
- Graph validation that all regions are reachable from the center.
- Geometry validation that protected landmarks, spawn anchors, and start areas do not overlap hard obstacles.
- Source validation that no new topology data is duplicated in `main.ts`, `Battle`, or preview-only code.

## Performance Checks

- Compare default and wave-8 `battle.update` timings before and after obstacle integration.
- Record collision candidate count with no actors, normal wave population, and wave-8 population.
- Confirm static obstacle data is resolved once per field and not allocated per frame.
- Confirm terrain baking and distant-enemy representation remain within the existing baseline.

## Visual Checks

- Compare the full-map preview against `screenshots/proving-ground-topology-target.png` for the central negative space, side-region silhouettes, outer loop, pond placement, campfire route, and south boss space.
- Inspect combat-scale views of every passage to verify hard and soft obstacles read differently.
- Confirm the map does not become a uniform wall of props or a visually noisy maze.
- Confirm the palette roles match the target: dark perimeter forest, olive grass, warm dirt routes, cool blue water, and gray-brown hard obstacles.
- Confirm camp tents, logs, banners, and campfires remain secondary landmarks and do not obscure the route or combat arena.
- Confirm the generated vegetation and ground detail remain restrained enough that the authored routes and region silhouettes stay readable.
- Confirm setup overview, minimap, and battle camera use the same authored positions and visual language.
- Confirm weather variants preserve topology readability and do not move obstacles or landmarks.

## Regression Checklist

- [ ] Hero movement, sprint, collision, reset, and defeat/victory flows remain valid.
- [ ] Enemy movement and attack behavior remain unchanged apart from spawn location.
- [ ] Existing tree and campfire collision still works with authored obstacles present.
- [ ] Setup map, battle scene, minimap, offline figures, and field cache use the same topology source.
- [ ] Boss health bars, minimap markers, and result statistics remain unaffected.
- [ ] Production build retains the existing DEV-only control boundary.
- [ ] No generated `.preview-*.png`, `.bench.mjs`, `dist/`, or `node_modules/` files are committed.

## Evidence

- Topology, authored obstacles, decorations, region-biased spawn weights, and overview rendering are implemented in the map/field/props pipeline.
- The first in-game comparison showed 41% dirt and undersized trees/oversized rocks. The current visual correction narrows dirt clearings and paths, adds irregular pond banks and reeds, enlarges tree crowns, reduces rock blockers, and changes the south ring to standing pillars.
- `npm run build` passed after the latest obstacle rendering changes.
- `npm run figures` generated overview, route-scale, and combat-scale comparisons using the actual 3600×3600 map dimensions.
- The updated full-map preview is `screenshots/proving-ground-topology-revised.png`; a three-scale detail sheet is `screenshots/proving-ground-topology-revised-detail.png`.
- Current material coverage in the 41×41 layout sample before the last narrowing pass was approximately 26% grass, 31% dirt, 37% forest, and 5% water; the last pass narrowed paths and clearings further.
- The latest Windows browser screenshot comparison could not run because the Computer Use safety layer could not determine the existing Edge window's URL and stopped automation. A live battle screenshot and updated performance benchmarks remain pending.
