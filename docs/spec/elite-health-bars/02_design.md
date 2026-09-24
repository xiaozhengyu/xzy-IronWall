# Design: Elite and Boss Health Bars

## Gameplay Rules

- This is a display-only feature; combat calculations do not change.
- Draw bars only for enemies with `boss === true` and `alive === true`.
- Compute fill as `clamp(hp / maxHp, 0, 1)`, guarding against non-positive `maxHp`.
- Keep the fill bar visible at full health; the setting controls all eligible bars together.

## State and Data

- Add `eliteBossHealthBars: boolean` to `ProfileSettings`, defaulting to `true`.
- `Profile.load()` already merges stored settings over fresh defaults; old saves therefore inherit the enabled default without a version bump.
- Add a `Profile` getter/setter that saves only when the value changes.
- Add a typed localized setting label in the Chinese and English HUD text tables.

## Runtime Flow

1. `Scene.draw()` checks the setting while traversing the existing enemy list.
2. For each rendered, living boss-class enemy, project the head position through the camera and draw a compact dark-backed bar with a contrasting fill above it.
3. Keep the bar anchored to the rendered unit and scaled with the same camera grain/model scale. Draw it in the scene overlay order so nearby sprites do not hide the health information; the DOM HUD remains above the scene.
4. `SummaryScreen` exposes the toggle in its existing pause display settings. The callback updates Profile and the Scene flag immediately; initial startup seeds both from Profile.

## Module Impact

- `src/render/scene.ts`: boss-health-bar rendering and visibility flag.
- `src/game/profile.ts`: persistent setting, default, and accessor.
- `src/ui/summary.ts`: pause-settings row and live toggle state.
- `src/main.ts`: initialize and connect the setting.
- `src/ui/text/hudText.types.ts`, `hudText.zh-CN.ts`, `hudText.en.ts`: typed labels and translations.
- `docs/decisions/AI_CHANGELOG.md`: record the behavior change.

## Edge Cases

- Full-health enemies show a full bar; dead enemies stop showing one immediately.
- A zero or invalid maximum health produces an empty safe ratio instead of NaN/Infinity.
- Offscreen units follow the existing scene culling and therefore do not draw bars.
- Bosses passing behind foreground minions still retain a legible bar through overlay ordering.
- Switching locale or toggling during pause updates the setting label/state without changing the run.

## Design Risks

- Too many or overly wide bars can add clutter; restrict bars to boss-flagged enemies and keep them compact.
- A fixed screen-space offset can detach the bar from the sprite at unusual zoom; derive placement from the unit's projected head and camera scale.
