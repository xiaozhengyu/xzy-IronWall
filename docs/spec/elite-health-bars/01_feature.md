# Feature: Elite and Boss Health Bars

## Player Problem

High-health elite and boss enemies can take a long time to defeat, but their remaining health is not visible. Players cannot easily tell whether sustained attacks are making progress.

## Desired Outcome

Show a compact health bar above each living boss-class enemy and let players turn these bars off from the pause/settings panel.

## In Scope

- Render a health bar for living enemies marked `boss`, including the current elite and knight-boss kinds.
- Reflect the enemy's current `hp / maxHp` ratio without adding numeric labels.
- Add a persistent “Elite/Boss health bars” display setting to the pause/settings panel.
- Default the setting to enabled for new and existing saves; apply changes immediately.
- Localize the setting label in Chinese and English.

## Out of Scope

- Showing health bars for regular minions or the player.
- Changing enemy health, defense, damage, boss wave timing, or hit behavior.
- Adding boss names, numeric health text, or new health-bar art assets.
- Changing save version or introducing database/backend data.

## Acceptance Criteria

- [ ] Living `boss`-flagged enemies display a health bar anchored above the unit; normal minions do not.
- [ ] The fill tracks `hp / maxHp`, stays within 0–100%, and disappears when the enemy dies or leaves the rendered viewport.
- [ ] The bar remains readable over crowded combat and at different camera zoom levels without covering the player HUD.
- [ ] The pause/settings toggle hides and restores all elite/boss bars immediately.
- [ ] The setting persists across reloads; existing saves without the field default to enabled.
- [ ] Chinese and English labels update with the game locale.
- [ ] Enemy health, damage, and death behavior are unchanged.

## Constraints

- Use the existing `Character.hp`, `Character.maxHp`, and `Character.boss` state.
- Keep health bars in the Pixi render path and preserve the pixel-art presentation.
- Do not add per-frame enemy searches beyond the existing render traversal.
