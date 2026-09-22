# Feature: Boss Clarity and Larger Maps

## Player Problem

Bosses are difficult to distinguish from the surrounding crowd, especially when a normal-looking boss is mixed into dense waves. The current maps also feel cramped, limiting readable movement and making the battlefield look smaller than the wave system suggests.

## Desired Outcome

Every boss should read as a large, important target with visible space around it. All maps should provide three times the current width and height while preserving their terrain identity and normal camera view.

## In Scope

- Apply a uniform visual scale to all boss characters and their ground rings.
- Add extra separation between bosses and non-boss enemies during movement and restoration.
- Expand spatial-grid lookup bounds for the larger boss clearance distance.
- Multiply every map width and height by three, including the boot-time default map dimensions.
- Keep normalized terrain layouts, seeds, wave templates, enemy budgets, combat stats, and camera view unchanged.
- Update SDD and the AI change log.

## Out of Scope

- Boss HP, damage, movement speed, attack range, or wave timing changes.
- Changes to enemy density budgets or the number of enemies per wave.
- New boss types, boss UI, or map-specific terrain redesign.

## Acceptance Criteria

- [ ] All boss models are visibly larger than nearby minions, including the knight boss variant.
- [ ] Minions maintain a readable buffer around bosses while moving and returning from the distant pool.
- [ ] Map dimensions are exactly three times their previous width and height.
- [ ] Camera clamping, spawning, culling, minimap bounds, and terrain layouts still use the expanded Field dimensions.
- [ ] Existing combat behavior and wave budgets remain unchanged.

## Constraints

- Keep the Boss/minion clearance in world units and account for it in spatial-grid coverage.
- Preserve the existing procedural terrain and normalized layout model.
- Watch terrain bake memory/time and crowd simulation cost after the size increase.
