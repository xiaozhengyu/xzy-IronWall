# Design: Full Game UI Redesign

## Design Direction

Use *Deep Rock Galactic: Survivor* as a reference for task flow and information hierarchy: a clear mission path, focused selection screens, a prominent selected character, compact upgrade choices, and fixed resource/action areas. Keep IronWall's deep navy surfaces, restrained brass focus color, and crisp pixel-art sprites. Do not copy the reference game's characters, icons, logos, or exact screen composition.

Shared UI rules cover page headers, section labels, panel surfaces, spacing, button hierarchy, selected/focus states, and reduced-motion behavior. The 16:9 play stage remains the coordinate basis.

## Gameplay Rules

- Setup becomes a two-step presentation flow: battlefield and weather, then hero and run start.
- Existing combat formulas, prices, reward probabilities, progression values, and persistence remain unchanged unless a separate, evidence-backed design decision requires it.
- The current nine-options/three-picks wave reward is the baseline. First refine the 3×3 presentation. If it cannot show every card name and full effect at 1366×768 without overlap, compare it with three rounds of three cards (pick one per round). Document the effect on comparison, choice time, and run pacing before implementation.

## State and Data

- Add only transient setup navigation state (`battlefield` or `hero`) inside the setup UI.
- Preserve selected map, weather, and hero when navigating Back and Next.
- Shop category selection is transient UI state; purchases continue to use existing profile data and transaction callbacks.
- Do not add persisted fields, balance values, reward counts, or database data.

## Runtime Flow

1. **Battlefield step:** show a map selector, large map preview, weather controls, and the selected map's objective/terrain details. The footer advances to hero selection.
2. **Hero step:** show the chosen map as a compact breadcrumb/summary, hero portraits in a clear selector, and the selected hero's large pixel-art preview, role, attributes, and skills. The footer provides Back and Start actions.
3. **Shop:** provide Root, Mentor, and Supplies category navigation. Keep currency visible and show existing items with their current effect, level/stock, and cost. Category switching does not alter purchase behavior.
4. **History:** retain hero/run navigation while visually separating cumulative totals from the latest run.
5. **Pause/result:** use a shared visual shell but preserve separate state titles and actions. Keep resume/end or result-confirm actions in a persistent footer; place run summary and settings in clearly labeled regions.
6. **Wave reward:** start with the 3×3 nine-card grid and three-pick progress. Reserve a separate strip for held items so it cannot overlap the cards. If the 3×3 layout cannot meet the 1366×768 readability target after refinement, use the documented three-round comparison and preserve nine total offers and three total picks.
7. **Combat HUD:** retain the minimap, wave/time, resources/progression, and combat controls in edge-aligned groups. Keep the center clear for the battlefield.

The setup layout exposes elements such as `heroStage`, `mapFrame`, and `foeSlots` to the render loop. Any layout change must keep their measured DOM bounds aligned with the Pixi preview drawing. Game-state transitions continue through existing callbacks and state ownership in `main.ts`.

## Module Impact

- Likely UI modules: `src/ui/setup.ts` and `setup.css`; `shop.ts` and `shop.css`; `history.ts` and `history.css`; `summary.ts` and `summary.css`; `hudCardPicker.ts`, `hudCardPicker.css`, `currentItems.ts`, and `currentItems.css`; relevant `hud*.css` files.
- `src/main.ts` may need focused integration updates for setup-step actions and DOM-to-canvas preview bounds.
- Add typed Chinese/English text entries only for labels that cannot reuse existing copy.
- Do not change simulation, balance, profile schema, or rendering assets.

## Edge Cases

- Back/Next navigation preserves all current setup choices, including after opening and closing the shop or history screen.
- Locale changes update both setup steps and every open UI panel without resetting selection.
- Insufficient currency, maxed upgrades, full supply stock, and empty history retain their existing behavior and remain understandable.
- Pause, resume, end confirmation, victory, defeat, and wave-card completion keep their existing state transitions.
- At smaller supported viewports, internal content may adapt or scroll, but primary actions and the wave-card selection count remain reachable and visible.

## Design Risks

- Splitting setup adds a navigation step; a persistent step indicator and retained choices should make progress clear.
- Moving DOM regions can misalign the Pixi-drawn hero/map previews; use measured element bounds as the single source of layout positions.
- Category tabs reduce the visible number of shop items; category names and currency visibility must make the full catalog easy to discover.
- Interaction changes can affect choice time and run pacing; keep current rules by default and validate any proposed alternative against the readability problem it is meant to solve.
