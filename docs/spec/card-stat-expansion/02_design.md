# Design: Expanded Stat Cards

## Card Definition

`src/ui/hudCardPicker.ts` extends `STAT_CARDS` with `maxMp` and `crit`. The max-mana card uses the existing stats icon and the critical-chance card uses the unused skull icon. Icon uniqueness is preserved so both cards can coexist with the current card de-duplication rule.

## Data Flow

1. `roll()` creates the two offers using the same `STAT_STEPS` selection as existing attribute cards.
2. The selected offer produces a `StatBonus` keyed by `maxMp` or `crit`.
3. `HudCardHooks.onStatCard()` forwards it to `Battle.addRunBonus()`.
4. `Battle.applyPlayerStats()` resolves the updated player stats through `applyBonuses()`.

No new Battle API is needed. `UnitStats`, `StatBonus`, and the percentage-combination rules already support both fields.

## UI and Localization

Add typed text keys and Chinese/English entries for the two card names and details. The Chinese critical-chance copy explicitly says “相对提升” so players do not read `+20%` as twenty percentage points.

## Compatibility

The cards participate in the existing `STAT_CARD_CAP`, icon de-duplication, gem-card, and wave-card flows. The fixed nine-card wave layout and gold filler behavior do not change.
