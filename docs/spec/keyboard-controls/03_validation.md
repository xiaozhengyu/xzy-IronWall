# Validation: Keyboard Control Layout

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Arrow movement | Start a run and hold each arrow key; then hold two adjacent arrows. | The player moves in the requested direction; diagonal speed is normalized. |
| Opposing movement | Hold `ArrowLeft` + `ArrowRight`, then release one. | The player stops while both are held and immediately moves toward the remaining key after one is released. |
| Active skills | Obtain active skills until all four slots are filled; press and hold `Q/W/E/R` as appropriate. | Each key addresses its matching slot; sustained skills follow the held state. |
| Sprint | Hold an arrow key plus either `Shift` key. | The player sprints and spends mana as before; Shift alone does not move or spend mana. |
| UI and browser behavior | Open the pause/debug help and play at a normal browser viewport. | Help shows arrow movement, Q/W/E/R skills, and Shift sprint; arrow keys do not scroll the page. |
| Reset/focus | Pause/resume, switch focus away and back, and restart a run. | Stale movement, skill, and sprint inputs do not remain active. |

## Automated Checks

- `npm run build` — passed.
- `rg -n -i "WASD|Q/E/R|KeyW.*move|KeyA|KeyS|KeyD" src docs` to inspect stale control references.

## Visual and Performance Checks

- Inspect the in-game quickbar at desktop resolution: four active slots plus the fixed Shift sprint slot are visible and labeled correctly.
- No rendering or simulation benchmark is required; this change does not alter geometry or enemy simulation.

## Regression Checklist

- [x] Mouse-held movement still works by preserving the existing pointer path.
- [x] Skill cooldown, mana, and sustained-skill behavior are unchanged by the input remap.
- [x] Full-slot card filtering still prevents unplaceable active skills through the dynamic slot array.
- [x] Pause, reset, victory, defeat, and focus-loss paths still clear the shared key set.
- [x] Production build succeeds with strict TypeScript checks.

## Evidence

`npm run build` passed. In the browser, the HUD showed `Q/W/E/R` plus `⇧`; after filling four active slots, the debug menu showed `Q 突进 · W 回春 · E 狂暴 · R 神兵天降`, and pressing `W` put `回春` on cooldown. The help text showed `↑↓←→`, `Q/W/E/R`, and `Shift`. Arrow-key normalization, browser-scroll prevention, and focus/reset clearing were verified from the input implementation. The Vite development server was stopped after the check.
