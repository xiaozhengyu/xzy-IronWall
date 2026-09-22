# Feature: Keyboard Control Layout

## Player Problem

The current keyboard layout uses `WASD` for movement and reserves only `Q/E/R` for active skills. This conflicts with the desired arrow-key movement layout and leaves one active skill slot unavailable.

## Desired Outcome

Players move with `↑/↓/←/→`, activate four equipped active skills with `Q/W/E/R`, and continue to hold either `Shift` key for sprint.

## In Scope

- Replace keyboard movement reads with the four arrow keys.
- Expand active skill slots from three to four and map them to `Q/W/E/R`.
- Keep mouse movement, directional normalization, cooldowns, and `Shift` sprint behavior unchanged.
- Update the HUD, debug menu, comments, and control help text to show the new layout.

## Out of Scope

- Rebinding controls through a settings screen.
- Preserving `WASD` as an alternate movement layout.
- Changing skill effects, balance, cooldowns, or mouse movement.

## Acceptance Criteria

- [x] Arrow keys move the player, including normalized diagonal movement and cancellation of opposing keys.
- [x] `W` no longer moves the player; `Q/W/E/R` trigger or hold the corresponding active slots.
- [x] Both `ShiftLeft` and `ShiftRight` still trigger sprint while moving.
- [x] The four active slots and fixed sprint slot are displayed with correct labels.
- [x] Full active slots prevent additional active-skill offers; pause/reset still clear held keys.

## Constraints

- Keep the existing shared key constants as the source of truth for input, battle, HUD, and menu ordering.
- Do not add persistence or database changes; loadout slots remain run-local.
