# Validation: Wave-End Card Rewards

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Wave reward | Start a run and wait for the first wave transition | A paused overlay shows exactly nine cards in a 3×3 grid |
| Three picks | Select three different wave cards by mouse | Each effect applies immediately; the overlay closes after pick three |
| Numeric input | Reopen a wave reward through a later wave and press keys 1–9 | The matching card is selected; selected cards cannot be chosen again |
| Spirit-stone reward | Collect enough spirit stones | The existing three-card, one-choice overlay still appears and closes after one choice |
| Reward queue | Arrange a wave transition and spirit-stone threshold in the same frame | Wave reward appears first, then spirit-stone reward; overlays never overlap |
| Exhausted pool | Use the developer console or play until progression cards are exhausted | Wave mode still shows nine cards, using gold fillers where necessary |
| Cleanup | Die or finish the run while a reward is pending/open, then start a new run | No stale overlay or pending reward appears in the new run |

## Automated Checks

- `npm run build`
- `npm run figures`
- `git diff --check`

## Visual and Performance Checks

- Verify the wave picker at the standard 16:9 viewport and at a narrow viewport.
- Confirm the compact 3×3 panel remains readable and ends above the fixed current-items strip.
- Confirm the world remains paused during both picker modes.

## Regression Checklist

- [ ] Existing card effects and skill loadout updates still work.
- [ ] Existing spirit-stone progress and card thresholds are unchanged.
- [ ] Wave debug jumps do not falsely grant rewards.
- [ ] Pause, reset, victory, defeat, and localization paths remain correct.

## Evidence

Record build output, figure generation output, and manual screenshots after implementation.
