# Feature: Full Game UI Redesign

## Player Problem

IronWall has a coherent pixel-art identity, but several screens present many choices and settings at once. The shop and pause panel are dense, and the wave reward inventory can compete with the cards for space. The setup screen also asks players to compare heroes, maps, weather, and enemy previews simultaneously.

## Desired Outcome

Give each screen one clear task, make its primary action easy to find, and keep the game world visually dominant during combat. Use the broad information hierarchy of *Deep Rock Galactic: Survivor* as a reference while retaining IronWall's own pixel art, dark navy panels, and brass highlights.

## In Scope

- Split setup into two steps: choose a battlefield and weather, then choose a hero and start the run.
- Reorganize the shop into Root, Mentor, and Supplies categories without changing prices or purchase rules.
- Clarify the distinction between cumulative and recent-run history.
- Rebalance pause and result panels so primary actions remain easy to reach.
- Reassess the wave-reward presentation, starting from nine options and three selections; give the selected-count indicator and held-item strip dedicated space.
- Refine HUD grouping and shared panel, heading, button, selection, and focus treatments.
- Keep Chinese and English UI text and existing mouse/keyboard behavior.
- Consider targeted interaction changes when a prototype shows they materially improve usability.

## Out of Scope

- Unrelated combat-balance, economy, progression-math, or save-data changes.
- Adding heroes, maps, items, or game modes.
- Replacing IronWall's pixel-art assets or copying another game's art, logos, or exact screen.
- Database or backend changes.

## Acceptance Criteria

- [ ] Setup presents map/weather selection first and hero selection second, with a visible step indicator and working Back/Next actions.
- [ ] Returning to the previous setup step preserves the selected map, weather, and hero; starting the run uses the displayed selections.
- [ ] The shop shows one category at a time, keeps currency visible, and clearly communicates item effects, ownership/level, and cost.
- [ ] History clearly separates account-wide totals from the latest run.
- [ ] Pause and result states remain distinct; pause actions stay visible while settings are organized and reachable.
- [ ] At 1366×768, the reward presents nine total options and allows three picks; names, full effects, selection count, and held items remain unobscured. Show all nine in a 3×3 grid by default; if that cannot meet the readability target, compare an approved three-round flow (three cards, pick one each round) while preserving nine total offers and three picks.
- [ ] Combat HUD information stays near screen edges and preserves a clear central battlefield.
- [ ] The redesigned screens remain legible and usable at 1920×1080 and 1366×768, in Chinese and English.
- [ ] IronWall's pixel-art presentation and visual identity remain intact.

## Constraints

- Keep the existing 16:9 game stage and ensure DOM overlays remain aligned with Pixi-rendered previews.
- Reuse existing profile, shop, history, reward, and settings data unless a documented UX improvement requires a narrowly scoped interaction change.
- Do not change combat formulas, prices, reward probabilities, or progression values as incidental UI work.
- Reference material: [Funday Games character-selection screen](https://www.fundaygames.dk/deep-rock-galactic-survivor) and [Deep Rock Galactic: Survivor Steam screenshots](https://store.steampowered.com/app/2321470/Deep_Rock_Galactic_Survivor/).
