# Validation: Elite and Boss Health Bars

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Boss bar visibility | Start a run and observe an elite/boss spawn. | A compact full health bar appears above it; nearby normal minions have no bar. |
| Health changes | Damage the boss with repeated attacks. | The bar decreases in sync with actual HP and reaches empty when the boss dies. |
| Crowded scene | Fight with a dense minion group around a boss. | The boss bar remains readable and attached to the boss. |
| Camera zoom | Zoom in and out while a boss is visible. | The bar stays above the boss and scales consistently with the scene. |
| Setting off/on | Pause, turn bars off, resume; then turn them back on. | All eligible bars disappear and return immediately without affecting combat. |
| Persistence | Change the setting, reload, and inspect the pause panel. | The selected value persists. A save without the new field defaults to on. |
| Localization | Switch between Chinese and English in the pause panel. | The setting label is localized and its selected state is preserved. |

## Automated Checks

- `npm run build`
- `npm run figures`
- `npm run bench`
- `git diff --check`

## Visual and Performance Checks

- Capture a boss health bar at 1366×768 and 1920×1080, including one crowded scene and two camera zoom levels.
- Confirm the health-bar draw cost remains small with the maximum configured boss count.
- Verify settings do not add bars to regular minions.

## Regression Checklist

- [ ] Boss health, damage, hit feedback, and death behavior are unchanged.
- [ ] Boss minimap markers and ground rings remain visible.
- [ ] Settings survive reload and old saves load with bars enabled.
- [ ] Production builds contain no developer-only controls.

## Evidence

Build, figures, bench, and diff checks passed. A live in-game screenshot with a spawned boss and manual setting/persistence checks remain to be captured; record viewport and camera zoom when performed.
