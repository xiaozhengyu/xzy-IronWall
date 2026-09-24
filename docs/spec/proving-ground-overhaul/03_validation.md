# Validation: Proving Ground Map Overhaul

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Boot and setup | Load the game and open the battlefield step | The map, dimensions, default clear weather, authored preview, and localized copy load from the unified map definition |
| Landmark route | From the central start, walk to each campfire, the upper-left yard, the lower-right pond, and both groves | Every landmark is reachable; the player is not trapped or forced through an unintended tree collision; route roles are visually legible |
| Start area | Start a fresh run and observe the first minute | The player begins in a clear central area; early enemies do not spawn inside the protected opening zone; the first wave reads as an introduction |
| Spawn patterns | Observe stationary play and sustained movement through early, middle, and final waves | Enemy pressure changes direction according to wave patterns while still feeling like one coherent surrounding threat; no enemy appears inside the visible area or obstacle |
| Wave roster | Record enemy types entering each wave and compare with setup information | All runtime enemy types are documented; preview semantics are clear; no type is silently omitted from the relevant encounter data |
| Boss schedule | Play through the configured boss waves and inspect health bars, minimap markers, and victory behavior | The configured boss kind appears at the configured waves; boss markers persist correctly; final boss completion drives the intended victory path |
| Weather | In setup, switch clear/rain/snow and then start a run from each state | The preview and battle ground match the chosen weather; terrain landmarks and collision positions do not move; weather does not introduce unintended combat modifiers |
| Preview consistency | Drag and zoom the setup map, then enter battle and inspect the same areas | Terrain, pond, trees, campfires, start point, and map boundaries correspond between preview, battle, and minimap |
| Persistence fallback | Start with a valid saved map id, then test a missing/removed id | Valid ids restore safely; invalid ids fall back to Proving Grounds without a crash or prompt |
| Long run | Play or simulate through the final wave while moving across the map and visiting landmarks | Population remains bounded, distant enemies recycle/restore without visible popping, frame time remains within the accepted baseline, and no landmark or drop system leaks |

## Automated Checks

- `npm run build`
- `npm run figures`
- `npm run bench`
- `$env:WAVE='8'; npm run bench`
- `git diff --check`
- Static validation that every wave enemy id resolves to a unit and every boss/landmark/spawn-anchor id is valid and unique.
- Static validation that the boot field dimensions/seed are derived from the map definition rather than duplicated constants.

## Visual and Performance Checks

- Capture or inspect the setup map at overview, center zoom, and landmark zoom.
- Compare the central arena, outer route, pond, groves, campfires, and edge wall at the shipped camera grain.
- Compare stationary and moving-player wave figures to verify spawn-pattern pressure.
- Record default and wave-8 battle timing, world population, active enemy count, and terrain bake time.
- Confirm map preview and minimap terrain caches are reused rather than rebuilt every frame.

## Regression Checklist

- [ ] Existing hero selection, weather controls, and setup navigation still work.
- [ ] Existing combat controls, skills, pickups, pause, reset, victory, and defeat paths still work.
- [ ] The field cache, terrain baking, camera clamps, collision, culling, and distant-enemy restoration remain valid.
- [ ] Enemy roster, boss display, minimap markers, and result statistics use the same map encounter definition.
- [ ] Chinese and English localization have no missing map, roster, or objective keys.
- [ ] Production build does not include development-only controls outside the existing `import.meta.env.DEV` boundary.

## Evidence

Implementation evidence so far:

- `npm run build` passed after the map model, field, battle, setup, minimap, and offline-preview compatibility changes.
- `npm run figures` passed after restoring the one-off template adapter used by offline preview scripts.
- `npm run bench` passed; wave-8 benchmark passed with `battle.update` at 3.07 ms and total CPU at 5.27 ms in the current benchmark scene.
- `git diff --check` passed.
- Static source validation found no retired-map identifiers, removed `WaveSpec.bosses` references, or missing proving-ground roster ids.
- Local browser smoke check reached setup with the complete proving-ground roster, entered hero selection, started wave 1, and reported no browser warnings or errors during the first seconds of combat.

Remaining manual evidence should cover landmark traversal, long-run movement, weather switching, boss milestones, and the final-wave battlefield.
