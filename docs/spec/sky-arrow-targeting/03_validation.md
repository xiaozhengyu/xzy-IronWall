# Validation: Sky Arrow Targeting

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Dense enemy group | Use Sky Arrow with several enemies clustered in the selection inset. | Landings favor occupied clusters; the target stays fixed during the descent. |
| Sparse enemies | Use Sky Arrow with one or two visible enemies. | The anchor is selected from a living enemy position; damage still depends on enemies remaining in range at impact. |
| Empty viewport | Cast after clearing nearby enemies. | The arrow falls at a random point within the original safe inset. |
| Movement during descent | Move the player/enemies after the 0.8-second selection and before impact. | The arrow does not retarget; the original area-damage rule applies at 1.08 seconds. |
| Progression variants | Test the skill at base and upgraded levels. | Candidate scoring and target selection work with the current impact radius; damage and range scaling are unchanged. |

## Automated Checks

- `npm run build`
- `npm run bench`
- `git diff --check`

## Visual and Performance Checks

- Confirm the target marker/landing animation still agrees with the stored world coordinates.
- Check that selection is computed only at the 0.8-second transition and does not add per-frame work.
- Compare an empty-area fallback with enemy-cluster landings in a crowded late wave.

## Regression Checklist

- [ ] Launch, 0.8-second target selection, 0.28-second descent, and 1.08-second impact timing remain unchanged.
- [ ] Existing area damage, enemy radius handling, and skill scaling remain unchanged.
- [ ] Empty-area casts remain possible when no eligible enemy exists.
- [ ] Pause, reset, death, and run end still clear the Sky Arrow state.

## Evidence

Record the tested wave, number/placement of eligible enemies, and representative landing locations. Include benchmark output for a crowded wave.
