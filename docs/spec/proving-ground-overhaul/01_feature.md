# Feature: Proving Ground Map Overhaul

## Player Problem

The remaining map, Proving Grounds, currently works as a generic arena assembled from shared defaults. Its terrain, props, spawn behavior, enemy preview, boss selection, and wave data are spread across several modules, so the map has little authored spatial identity and the setup preview does not fully describe the combat roster.

## Desired Outcome

Proving Grounds becomes a coherent, authored battlefield while keeping the existing action-survival game identity: a 3600×3600 woodland clearing with a central arena, perimeter tree wall, asymmetric groves, a pond, campfire landmarks, and escalating waves.

The map should have a clear relationship between its layout, landmarks, enemy arrival directions, wave pacing, preview screen, minimap, and long-run performance. The shared engine should remain reusable, but map content should have one authoritative definition.

## In Scope

- Move all Proving Grounds content into an explicit map module with one authoritative world and encounter definition.
- Remove duplicated boot-time map dimensions and seed values from `main.ts`.
- Replace the default/random campfire placement used by this map with explicit authored landmarks.
- Keep the current terrain theme while reworking the central arena, outer route, groves, pond, boundary, and landmark placement.
- Add map-owned spawn anchors and lightweight per-wave spawn patterns without introducing full pathfinding or a scripted event system.
- Align the actual wave roster, setup-screen enemy information, boss type, boss schedule, minimap markers, and victory logic.
- Keep the default clear weather and optional rain/snow switching, while ensuring preview and combat use the same weather state.
- Preserve the existing distant-enemy optimization, terrain baking, field cache, camera model, and reward formulas unless validation proves a targeted adjustment is required.
- Restore a valid persisted map selection when returning to setup; fall back safely to the first registered map when a saved id is invalid.
- Update the Spec and AI change log after implementation.

## Out of Scope

- Adding a second map or building a general-purpose map editor.
- Replacing the core action-survival combat model with authored pathfinding, lane navigation, or a tactical encounter graph.
- Introducing a full scripted event/trigger system, day-night cycle, or weather-based combat modifiers.
- Rewriting all enemy AI, hero progression, item systems, or the rendering engine.
- Database changes or save-format version migration beyond safe fallback for an invalid map id.

## Acceptance Criteria

- [ ] Proving Grounds is defined in one authoritative map module; boot, setup, battle, preview, and minimap consume that definition.
- [ ] No duplicated Proving Grounds width, height, or seed constants remain in `main.ts`.
- [ ] The central start area is traversable and readable, and every authored landmark is reachable without trapping the player or enemies.
- [ ] The pond, groves, tree wall, dirt areas, and campfires form recognizable spatial roles rather than unrelated decoration.
- [ ] Campfires and other map landmarks are deterministic and explicitly positioned.
- [ ] Enemy spawning uses map-owned anchors and per-wave patterns while still respecting terrain collision, active-area margins, and global population budgets.
- [ ] The setup roster and runtime wave roster have an explicit, documented relationship with no silently missing enemy types.
- [ ] The boss type and schedule are map-owned; boss UI, minimap markers, victory checks, and combat spawning agree.
- [ ] Preview, battle rendering, and minimap show the same terrain and landmark positions under the selected weather.
- [ ] The proving-ground wave curve and reward cadence remain playable, with the main build acquired before the final climax rather than only at the end.
- [ ] `npm run build`, `npm run figures`, `npm run bench`, and `git diff --check` pass; manual route, spawn, weather, boss, persistence, and long-run checks are recorded.

## Constraints

- Keep the 3600×3600 proving-ground baseline unless validation demonstrates that the size itself prevents a good experience.
- Keep the existing pixel-art projection, camera grain, terrain baking, distant-enemy representation, and performance budgets as the default constraints.
- Use normalized coordinates for authored landmarks and layout positions where possible; convert to world units at runtime.
- Keep all player-facing copy in the existing localization system.
- Do not commit generated preview files, benchmark outputs, or a Git commit without an explicit user request.
