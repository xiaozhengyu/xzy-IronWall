# Validation: Map Roster Reduction

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Single-map setup | Open the setup screen and inspect the battlefield selector | Only “演武荒野” is shown; no next/previous action can select another map; its preview and details render normally |
| Start run | Select the available hero and start a run | The run starts on the proving ground with its existing terrain, clear default weather, enemy roster, and wave progression |
| Localization | Switch between Chinese and English in setup | The sole map remains available and its localized name/details render without missing-key text |
| Existing default | Reload the game or use a profile whose last map is `proving` | Setup and boot initialization still use `proving` without a save migration prompt |

## Automated Checks

- `npm run build`
- `npm run figures`
- `git diff --check`
- Search active source for removed map ids and keys; only the retained `proving` map should remain in runtime map data.

## Visual and Performance Checks

- `npm run figures` should complete and keep the proving-ground preview available.
- No simulation or crowd-performance change is expected, so `npm run bench` is not required.
- Inspect the single-card setup layout at the existing preview viewport if a browser smoke check is available.

## Regression Checklist

- [ ] Existing controls and game-state transitions still work.
- [ ] Pause, reset, victory, and defeat paths behave correctly.
- [ ] Localization and release-build behavior remain correct.
- [ ] The proving-ground boot-time field cache still uses the same dimensions, seed, and layout.

## Evidence

Record the build, figures, diff-check, and identifier-search results after implementation.
