# Feature: Wave-End Card Rewards

## Player Problem

The game already offers a three-card choice when the player collects enough spirit stones, but wave completion has no explicit reward beat. Players should receive a clear build decision after surviving each wave without removing the existing spirit-stone progression.

## Desired Outcome

At the end of each wave, the game pauses and shows exactly nine upgrade cards. The player chooses three cards in succession; each choice applies immediately and the battle resumes after the third choice. Spirit-stone rewards remain a separate three-card, one-choice flow.

## In Scope

- Trigger a wave reward once when the wave director advances a wave.
- Show nine cards in a compact 3×3 layout and allow three selections.
- Reuse the existing stat, skill, skill-upgrade, and gold card effects.
- Queue wave and spirit-stone rewards so two overlays never overlap.
- Preserve mouse selection and extend numeric selection to cards 1–9.
- Clear pending rewards on death, victory, reset, or a new run.
- Update localization, SDD documents, and the AI change log.

## Out of Scope

- New card types, permanent progression, or balance changes to existing card effects.
- Changes to wave duration, spawn budgets, spirit-stone thresholds, or combat simulation.
- Saving unfinished card selections across runs.

## Acceptance Criteria

- [ ] Each normal wave transition queues one nine-card reward.
- [ ] Exactly nine cards are visible and exactly three distinct cards can be selected.
- [ ] Selected cards apply immediately; the overlay closes after the third selection.
- [ ] Spirit-stone three-card choices still work independently.
- [ ] Simultaneous rewards are processed sequentially without loss or overlap.
- [ ] Death, victory, reset, and new-run paths leave no stale reward overlay.

## Constraints

- Keep card effects owned by the existing Battle hooks.
- Use gold cards as deterministic fillers when fewer than nine valid offers remain.
- No database or external service changes are required.
