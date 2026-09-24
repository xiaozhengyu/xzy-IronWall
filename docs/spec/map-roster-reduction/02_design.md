# Design: Map Roster Reduction

## Gameplay Rules

There is one selectable battlefield after this change: `proving`. No map-specific difficulty, enemy, weather, or wave rules are introduced or changed. The proving-ground map remains the default and is the only map passed from setup into a run.

## State and Data

- `GameMaps` becomes a one-element array containing `provingGround`.
- The `blackstonePass`, `redSandSteppe`, and `whiteRidgeSnowfield` definitions are removed from `src/data/maps.ts`.
- Their dedicated spawn templates are removed from `src/data/waves.ts` and the compatibility re-exports in `src/game/waves.ts`.
- Their dedicated `HudTextKey` members and English/Chinese values are removed from the text type and language tables.
- `Profile.lastMap` remains `proving`; no persistence migration is required.

## Runtime Flow

`Setup` continues to read the map list from its existing bridge. With one entry, the existing selection and preview code still initializes `proving`, while the next/previous map controls naturally have no alternate target. `main.ts` continues to use `GameMaps[0]` for the boot-time field and cache. Battle construction continues to receive the proving-ground map's existing template and modifier.

## Module Impact

- Change `src/data/maps.ts` to retain only the proving-ground definition and clean map-count comments/imports.
- Change `src/data/waves.ts` and `src/game/waves.ts` to remove the unused map-specific templates and exports.
- Change `src/ui/text/hudText.types.ts`, `src/ui/text/hudText.en.ts`, and `src/ui/text/hudText.zh-CN.ts` to remove unused map keys and values.
- Change `docs/decisions/AI_CHANGELOG.md` and this Spec directory.
- Intentionally leave `src/ui/setup.ts`, `src/main.ts`, `src/game/profile.ts`, generic terrain/weather/unit modules, and general assets untouched.

## Edge Cases

- Existing profiles with `lastMap: 'proving'` continue to load without migration.
- Any stale profile value for a removed map is outside the current persisted state contract; the current code already defaults to `proving` and no new migration is added for this temporary roster reduction.
- The setup map strip must still render correctly when it contains a single card, and the map preview must remain aligned with the existing DOM bounds.

## Design Risks

The main regression risk is leaving a removed localization key or template export referenced by TypeScript. Removing the definitions and running the build plus identifier searches provides a safe check; the change is easily reversible by restoring the data entries if additional maps are reintroduced later.
