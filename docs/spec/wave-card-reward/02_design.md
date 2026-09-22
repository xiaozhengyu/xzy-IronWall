# Design: Wave-End Card Rewards

## Gameplay Rules

The existing spirit-stone mode remains `3 cards / 1 pick`. A wave mode uses `9 cards / 3 picks`. A selected card is applied immediately through the existing `HudCardHooks`; a wave-mode picker closes only after its third valid selection. Each selection advances the existing run card round so current obtain/upgrade availability rules remain coherent.

The wave director emits a one-shot clear pulse when it advances. Debug jumps do not emit the pulse. The first completed wave and the transition into the final-wave holding phase each count once; if the run ends on that frame, the normal end-run cleanup hides the overlay.

Offers are drawn from the existing stat, skill-obtain, and skill-upgrade pools with the current de-duplication rules. Wave mode keeps at least one skill offer when available. If the pool cannot fill nine cards, gold offers fill the remaining slots, guaranteeing a fixed nine-card layout.

## State and Data

- `HudCardMode`: `gem` or `wave`.
- Picker state tracks mode, required picks, completed picks, and selected card indices.
- HUD tracks independent pending flags for spirit-stone and wave rewards.
- `WaveDirector.takeWaveCleared()` exposes a consumable transition pulse; no persistence field is added.
- Add localized card-selection progress text in Chinese and English.

## Runtime Flow

1. `WaveDirector.advance()` marks one clear pulse.
2. `Battle` exposes the pulse; `main.ts` queues it after `battle.update()` and before drawing.
3. `Hud` prioritizes a pending wave reward, then a pending spirit-stone reward.
4. `HudCardPicker.show(mode)` rolls the corresponding count and pauses the world through the existing ticker guard.
5. Mouse or numeric input applies each selected offer. The picker remains open until the mode's pick quota is met.
6. `hide()` and run reset clear visual state and pending work.

## Module Impact

- `src/game/waves.ts`, `src/game/battle.ts`: wave-clear pulse.
- `src/main.ts`, `src/ui/hud.ts`: event handoff and reward queue.
- `src/ui/hudCardPicker.ts`, `.css`: two modes, nine-card layout, three-pick behavior.
- `src/ui/text/hudText.*`: selection progress localization.
- `docs/decisions/AI_CHANGELOG.md`: implementation record.

## Edge Cases

- A wave clear and spirit-stone threshold in one frame are queued, never nested.
- A card already selected in wave mode is disabled and cannot be selected twice.
- With no progression offers left, all nine slots show valid gold fillers.
- Death, victory, disabling cards, and starting a new run use existing cleanup paths.

## Design Risks

The nine-card panel is denser than the current picker. A compact 3×3 layout keeps all choices visible while reusing the same card component. Wave-mode cards use a shorter aspect ratio, smaller preview stage, and slightly smaller text so the panel ends above the fixed current-items strip; this is CSS-only and does not change reward logic.
