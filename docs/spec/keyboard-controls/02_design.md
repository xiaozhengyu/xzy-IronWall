# Design: Keyboard Control Layout

## Gameplay Rules

- Movement maps `ArrowUp` to `(0,-1)`, `ArrowDown` to `(0,1)`, `ArrowLeft` to `(-1,0)`, and `ArrowRight` to `(1,0)`.
- The movement vector is normalized, and opposing keys cancel as before.
- Active skill slot order is `Q`, `W`, `E`, `R`; `ShiftLeft` and `ShiftRight` remain the independent sprint input.
- Sprint remains hold-based, mana-limited, and only consumes mana while the player is moving.

## State and Data

- `ACTIVE_SKILL_KEYS`, `ACTIVE_SKILL_CODES`, and `ActiveSkillSlot` grow from three entries to four.
- `SkillLoadout.activeSkillSlots` grows from three run-local entries to four.
- `BattleInput.heldSlots` remains an ordered boolean array and follows the shared four-key constant.
- No save/profile schema, localization key, or asset changes are required.

## Runtime Flow

`Controls` records physical key codes and exposes the normalized arrow-key vector. `main.ts` copies the four active-key states into `BattleInput`; key-down events trigger non-sustained skills through `Battle.triggerActiveSkill`. The HUD and debug menu derive their displayed key order from `ACTIVE_SKILL_KEYS`, while the sprint slot remains appended after the four active slots.

## Module Impact

- Change `src/ui/controls.ts`, `src/game/skillLoadout.ts`, and `src/main.ts` for input and loadout behavior.
- Change `src/game/battle.ts`, `src/ui/hud.ts`, `src/ui/hudQuickbar.ts`, and `src/ui/menu.ts` for slot sizing and player-facing descriptions.
- Update stale control comments in related gameplay/render modules.
- Do not change skill simulation, mouse movement, or persistence boundaries.

## Edge Cases

- Releasing or pressing opposing arrow keys must immediately produce the remaining direction or no movement.
- Losing focus and resuming must clear stale movement, skill, and sprint key states.
- A fourth active skill must be obtainable; a fifth active skill must remain unavailable when all four slots are full.
- Arrow keys must not scroll the browser while the game is receiving keyboard input.

## Design Risks

The HUD now has five skill visuals including sprint. The existing variable-count frame composition is retained so the extra slot does not require new assets.
