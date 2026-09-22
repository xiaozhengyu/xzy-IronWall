# Feature: Expanded Stat Cards

## Background

The run card pool already improves attack, defense, movement, pickup range, health, and mana regeneration. Mana capacity and critical chance are already player stats, but they cannot currently be selected as standalone run upgrades.

## Goal

Add two reusable attribute-card families:

- Max mana: a multiplicative increase to `UnitStats.maxMp`.
- Critical chance: a multiplicative increase to `UnitStats.crit`.

Both cards use the existing random stat steps (`+8%`, `+12%`, `+15%`, `+20%`) and the existing five-pick per-stat cap.

## In Scope

- Add Chinese and English card labels and descriptions.
- Add distinct HUD icons and include both cards in gem and wave card rolls.
- Keep stat application in the existing `StatBonus` / `applyBonuses` path.
- Preserve current-mana behavior: increasing max mana raises the cap but does not refill current mana.

## Out of Scope

- Changing critical-hit damage or critical-hit calculation.
- Adding attack-arc or other character-identity stats to the card pool.
- Changing card probabilities, card caps, or wave reward counts.

## Acceptance Criteria

- The card pool contains ten attribute-card families.
- Max-mana and critical-chance cards apply immediately after selection.
- Critical chance is described as a relative increase, matching the existing multiplicative bonus model.
- Existing card selection, de-duplication, and gold filler behavior remains intact.
