# AI Change Log

Record substantive AI-assisted implementation changes here. Documentation-only edits do not require an entry.

Use this format:

```md
## YYYY-MM-DD — <feature-slug>

- Spec: `docs/spec/<feature-slug>/`
- Summary: <what changed>
- Impact: <affected systems and user-visible behavior>
- Validation: <commands and manual scenarios>
```

## 2026-09-24 — persistent-bloodstains

- Spec: `docs/spec/bloodstains/`
- Summary: Added persistent, pixel-art ground stains on lethal enemy hits and a saved ESC setting to hide or show them.
- Impact: Stains are independent of corpse lifetime, remain through the run result, clear on the next Battle reset, and are stored in sparse fixed-resolution texture chunks. Ground detail and static scatter render below stains, while trees/props/units remain above; normal alpha blending and a brighter red palette keep them from becoming black on multiply. Corrected chunk stamping/layout to use the map's actual top-left-origin coordinates so the full field accepts marks.
- Validation: `npm run build`; `npm run figures`; default and wave-8 `npm run bench` (0.48 ms / 0.87 ms total CPU after the map-coordinate fix); `git diff --check`; manual browser checks for kill placement, full-map coverage, ground-scatter occlusion, run reset, and the saved visibility toggle remain to be performed.

## 2026-09-24 — developer-card-testing

- Spec: `docs/spec/developer-console/`
- Summary: Added an F1 card tester with every attribute-card roll, currently legal skill acquisition/upgrades, and both gold-card values.
- Impact: Test cards dispatch through the real reward hooks without advancing normal card-round/cap state; selecting a gold card permanently adds its value to saved coins and is labeled accordingly.
- Validation: `npm run build`; `git diff --check`; developer-browser card application, gold persistence, and production DEV-boundary checks remain to be performed.

## 2026-09-24 — skill-cooldown-card

- Spec: `docs/spec/skill-cooldown-card/`
- Summary: Added a shared reward card that reduces every skill's cooldown by a randomized 2–5% per selection, capped at 25% per run.
- Impact: Existing and future skill cooldowns update immediately; attack swing animation time remains unchanged for future attacks, and run-local reductions reset with a new run.
- Validation: `npm run build`; `npm run figures`; `git diff --check`; manual reward selection and in-game cooldown checks remain to be performed.

## 2026-09-24 — proving-ground-topology

- Spec: `docs/spec/proving-ground-topology/`
- Summary: Added authored Proving Grounds regions, passages, hard obstacles, visual-only camp decorations, collision integration, overview tree clusters, and region-biased wave spawn selection. After comparing the first in-game screenshots with the approved target, reduced dirt coverage, reshaped paths and pond banks, adjusted tree/rock scale, added shore reeds, and changed the south ring to standing pillars.
- Impact: The single playable map now has a central arena, outer loop, side spaces, static route blockers, readable camp/boss landmarks, and wave-specific directional pressure, with a closer palette and silhouette match to the target. Existing water traversal, enemy AI, terrain baking, and population budgets remain unchanged.
- Validation: First implementation passed `npm run build`, `npm run figures`, default/wave-8 benchmarks, `git diff --check`, and a browser setup/start-wave smoke. Current obstacle/visual correction passed `npm run build` and `npm run figures`; updated default/wave-8 benchmarks and live in-game screenshot comparison remain pending.

## 2026-09-24 — map-roster-reduction

- Spec: `docs/spec/map-roster-reduction/`
- Summary: Reduced the runtime map roster to the proving ground and removed the three retired map definitions, dedicated spawn templates, and unused localized map copy.
- Impact: Setup now offers only “演武荒野”; its boot-time field, default waves, weather controls, and combat behavior remain unchanged. Generic terrain, weather, unit, and wave systems are unchanged.
- Validation: `npm run build`; `npm run figures`; `git diff --check`; active-source identifier search; single-map setup and start-run smoke checks remain to be performed.

## 2026-09-24 — proving-ground-overhaul

- Spec: `docs/spec/proving-ground-overhaul/`
- Summary: Rebuilt Proving Grounds around an authoritative map module with explicit world landmarks, authored campfires, perimeter spawn anchors, per-wave spawn patterns, map-owned boss scheduling, complete setup roster data, safe map persistence fallback, and shared preview/battle/minimap coordinates.
- Impact: The proving-ground theme and action-survival engine remain intact, while boot dimensions, terrain, props, encounter data, boss selection, and spawn direction now flow from the map definition. The offline preview retains a compatibility path for one-off wave templates.
- Validation: `npm run build`; `npm run figures`; `npm run bench`; `$env:WAVE='8'; npm run bench`; `git diff --check`; local browser smoke check reached setup with the complete roster and started wave 1 without console warnings/errors.

## 2026-09-24 — boss-minion-yield

- Spec: `docs/spec/boss-minion-yield/`
- Summary: Added temporary lateral yielding for minions in an approaching boss's lane and made boss/minion separation move only the minion.
- Impact: Bosses ignore ordinary minions as movement blockers; yielding ends after the minion clears the lane. Boss/boss and minion/minion spacing, combat stats, attacks, and wave rules are unchanged. Terrain can still constrain sidesteps because general pathfinding remains out of scope.
- Validation: `npm run build`; `npm run figures`; `npm run bench`; `$env:WAVE='8'; npm run bench`; `git diff --check`. In-game observation of a controlled boss passing through a minion lane remains pending.

## 2026-09-24 — elite-health-bars

- Spec: `docs/spec/elite-health-bars/`
- Summary: Added health bars above living boss-flagged enemies and a persistent pause/settings toggle, enabled by default.
- Impact: Bars use existing HP/maxHP and boss state, remain in the Pixi scene overlay, and do not change combat values. Existing saves inherit the enabled setting without a version bump.
- Validation: `npm run build`; `npm run figures`; `npm run bench`; `git diff --check`. A live in-game screenshot with a spawned boss is not yet captured.

## 2026-09-23 — ui-redesign

- Spec: `docs/spec/ui-redesign/`
- Summary: Split battlefield and hero selection into two steps; added category tabs to the shop; separated cumulative and latest-run history; widened pause/result panels; changed wave cards to readable horizontal tiles while preserving nine options and three picks.
- Impact: Setup state now retains its step and selections after shop visits; DOM preview bounds continue to position Pixi-rendered map, hero, and foe stages. Current-item descriptions refresh with locale changes. No combat balance, purchase prices, or reward counts changed.
- Validation: `npm run build`; `git diff --check`; browser preview covered setup navigation, shop categories/return state, bilingual copy, pause settings, current-item strip, and nine-card three-pick selection at a 1034×582 game stage. The embedded browser could not be resized to 1366×768 or 1920×1080 during this pass.

## 2026-09-23 — sky-arrow-targeting

- Spec: `docs/spec/sky-arrow-targeting/`
- Summary: Replaced Sky Arrow's unconditional random landing with a one-time, enemy-density-weighted anchor selection at the existing 0.8-second mark; retained the random safe-area fallback when no living enemies are eligible.
- Impact: Sampled anchors are weighted by living enemies within the existing impact radius. The chosen point remains fixed during descent, and the existing 1.08-second impact timing and `castRing` damage behavior are unchanged.
- Validation: `npm run build`; `npm run bench`; `git diff --check`. Manual in-game dense/empty-area casts remain to be observed.

## 2026-09-22 — keyboard-controls

- Spec: `docs/spec/keyboard-controls/`
- Summary: Changed movement to the arrow keys and expanded active skill input from Q/E/R to Q/W/E/R while retaining Shift sprint.
- Impact: Updated run-local skill loadout capacity, keyboard input translation, HUD slot presentation, debug help, and related control documentation.
- Validation: `npm run build`; browser checks for five-slot HUD presentation, `W` skill activation, and updated help text; source-level checks for arrow movement and focus reset behavior.

## 2026-09-22 — experience-magnet

- Spec: `docs/spec/experience-magnet/`
- Summary: Added the timed Charm of Gathering, which temporarily makes the shared collectible pickup range infinite.
- Impact: Added a new drop/use path for the charm, localized copy and icon mapping, while preserving existing drop physics and inventory rules.
- Validation: `npm run build`; `git diff --check`; browser startup smoke check and source-level checks for the drop, use, expiry, and reset paths.

## 2026-09-22 — developer-console

- Spec: `docs/spec/developer-console/`
- Summary: Added a DEV-only F1 developer console for immediate skill/item setup, HP/MP locks, resource refill, invincibility, and existing battle debug controls.
- Impact: Added a dedicated UI component, Battle-owned temporary debug state, direct item grant feedback, skill reset, and reset-safe resource controls without changing Profile data.
- Validation: `npm run build`; `git diff --check`; browser checks for F1 panel, skill equip, Gathering Charm grant, HP/MP locks, reset cleanup, and empty browser error logs; production bundle marker check.

## 2026-09-22 — damage-number-scale

- Spec: `docs/spec/damage-number-scale/`
- Summary: Decoupled damage-number glyph size from camera grain, merged rapid hits on the same target, added density-aware culling, moved enemy damage text away from actors, and added persistent player display toggles.
- Impact: Preserved combat simulation while reducing visual obstruction through smaller, higher, offset, and user-filterable feedback; added independent damage, healing, mana, buff, and level display settings.
- Validation: `npm run build`; `npm run figures`; `git diff --check`; local game startup smoke check; manual offset and display-toggle checks remain to be performed.

## 2026-09-22 — minimap-display

- Spec: `docs/spec/minimap-display/`
- Summary: Moved the minimap to the upper-left HUD, separated it from the upper-right resource panel, removed the persistent pause hint, and added a persistent player visibility toggle.
- Impact: Preserved minimap markers and zoom behavior while allowing the minimap Canvas draw call to be skipped when hidden.
- Validation: `npm run build`; `npm run figures`; `git diff --check`; manual HUD position, toggle, and persistence checks remain to be performed.

## 2026-09-22 — wave-card-reward

- Spec: `docs/spec/wave-card-reward/`
- Summary: Added a wave-completion reward flow with nine visible cards and three immediate selections, while preserving the existing spirit-stone three-card, one-choice flow.
- Impact: Wave completion now pauses the game for a 3×3 card choice; wave and spirit-stone rewards queue sequentially, exhausted pools use gold fillers, and selected cards cannot be chosen twice.
- Validation: `npm run build`; `npm run figures`; `npm run bench`; `git diff --check`; local browser smoke test verified wave 1 → wave 2, nine-card rendering, 0/3 → 1/3 → 2/3 selection progress, immediate skill grants, and queued spirit-stone cards. Follow-up CSS tuning shortened wave cards so the 3×3 panel clears the fixed current-items strip.

## 2026-09-22 — boss-scale-map-size

- Spec: `docs/spec/boss-scale-map-size/`
- Summary: Enlarged all boss renderings, added a readable minion-to-boss clearance, and expanded every map to three times its previous width and height.
- Impact: Bosses remain visually distinct in dense waves while preserving combat stats; larger normalized maps provide more traversal space without changing wave budgets or camera view size.
- Validation: `npm run build`; `npm run figures`; `npm run bench`; `git diff --check`; manual boss spacing, map-edge traversal, and minimap-bound checks remain to be performed.

## 2026-09-22 — card-stat-expansion

- Spec: `docs/spec/card-stat-expansion/`
- Summary: Added max-mana and critical-chance attribute cards to the run reward pool.
- Impact: Attribute cards now cover ten stat families; both new cards use the existing multiplicative `StatBonus` path, stat cap, icon de-duplication, gem rewards, and wave rewards.
- Validation: `npm run build`; `npm run figures`; `npm run bench`; `git diff --check`; manual card appearance, immediate stat update, and cap checks remain to be performed.
