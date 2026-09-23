# Validation: Full Game UI Redesign

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Setup flow | Choose a map and weather, continue, choose a hero, go Back, then continue and start. | Choices persist across steps; map, weather, hero, and rendered previews match the selections. |
| Setup utilities | Open and close shop/history from setup on each step; change language. | The setup step and selections remain intact; all visible labels update in the chosen language. |
| Shop categories | Switch Root, Mentor, and Supplies; inspect owned, maxed, and unaffordable entries; make a valid purchase. | Only the chosen category is displayed; currency, cost, ownership, and existing purchase outcomes are correct. |
| History | Switch heroes and inspect cumulative totals and the latest run. | The two scopes are visually distinct and values remain associated with the selected hero/run. |
| Pause and result | Pause, change settings, resume; separately exercise end confirmation, victory, and defeat. | Primary actions remain reachable; each state has the correct title, details, settings, and action. |
| Wave reward | Open a wave reward with held items; select three of the nine cards using the approved presentation. | Nine total options and three picks are preserved; names, effects, selection count, and held items are unobscured. |
| HUD readability | Play with the minimap and combat-text display options on and off; inspect crowded combat. | HUD groups stay at the screen edges, toggles work, and the central battlefield remains readable. |
| Viewports | Exercise setup, shop, pause, history, and reward screens at 1920×1080 and 1366×768. | No primary action is clipped; text and controls remain legible; Pixi previews stay aligned with their frames. |
| Reduced motion | Enable operating-system reduced motion and open/close panels. | Transitions respect the existing reduced-motion behavior. |

## Automated Checks

- `npm run build`
- `git diff --check`

## Visual and Performance Checks

- Capture before/after screenshots for setup, shop, history, pause, wave reward, and active HUD at both target viewports.
- Verify DOM overlays align with Pixi-rendered hero, map, and enemy previews.
- Confirm all nine names and full effects, selection count, and held items fit without overlap at 1366×768. If they do not, compare the 3×3 grid with three rounds of three cards (pick one per round), including choice time and pacing impact.
- `npm run figures` and `npm run bench` are not required unless implementation also changes procedural rendering or simulation/performance paths.

## Regression Checklist

- [ ] Hero/map/weather selection and run-start callbacks preserve current behavior.
- [ ] Shop prices, stock limits, purchases, and profile persistence are unchanged.
- [ ] History data and pause/result state transitions are unchanged.
- [ ] Wave reward follows the approved offer-count and pick-count design; any change from nine offers/three picks has a documented usability rationale and pacing review.
- [ ] Chinese and English text, keyboard/mouse input, sound/music, minimap, and combat-text settings still work.
- [ ] Development-only controls remain excluded from production builds.

## Evidence

The in-task browser preview was reviewed at a 1034×582 game stage for setup, shop, history, pause with a held item, and the nine-card reward. The embedded browser did not expose viewport resizing, so 1366×768 and 1920×1080 remain unverified. The wave reward was visually checked without held items; the separate held-item strip was checked in pause/result layout.
