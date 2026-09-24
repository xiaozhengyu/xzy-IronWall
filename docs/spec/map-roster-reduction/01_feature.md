# Feature: Map Roster Reduction

## Player Problem

The setup screen currently exposes four maps, but the next playable scope only needs the existing proving ground. The other three maps should not remain selectable or leave unused map-specific data in the runtime roster.

## Desired Outcome

The setup screen offers only “演武荒野” (`proving`). Starting a run continues to use the existing proving-ground dimensions, terrain, weather, enemy roster, and wave behavior.

## In Scope

- Keep `proving` as the sole entry in `GameMaps`.
- Remove the `pass`, `steppe`, and `snowfield` map definitions from the runtime map data.
- Remove localization keys and spawn templates that become unreferenced because those maps are removed.
- Preserve the existing setup flow, default map state, profile `lastMap` value, weather controls, and combat behavior for `proving`.
- Record the change in the AI change log.

## Out of Scope

- Changes to the proving-ground terrain, dimensions, seed, enemy balance, or wave timing.
- Changes to generic weather, terrain, unit, or wave systems.
- Save migration, database changes, or removal of general-purpose assets.
- Reworking the map-selection layout beyond rendering the remaining map.

## Acceptance Criteria

- [ ] `GameMaps` contains exactly one map with id `proving`.
- [ ] The setup screen has no selectable cards or text for Blackstone Pass, Red Sand Steppe, or Whiteridge Snowfield in either supported language.
- [ ] Starting the game still uses the existing proving-ground field and default wave template.
- [ ] The TypeScript production build succeeds and no removed map identifiers remain in active source data or localization types.

## Constraints

- Keep the existing `GameMaps[0]` boot-time cache contract intact.
- Do not commit generated preview files, build output, or a Git commit as part of this change.
