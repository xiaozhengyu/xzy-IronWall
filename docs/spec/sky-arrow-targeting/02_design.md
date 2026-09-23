# Design: Sky Arrow Targeting

## Gameplay Rules

- The launch begins exactly as before.
- When the arrow crosses age `0.8` seconds, form the same inset rectangle from `view.spawn` using horizontal margin factor `0.78` and vertical margin factor `0.72`.
- Eligible anchors are living enemies whose centers fall inside that rectangle.
- If there are no eligible anchors, choose `targetX` and `targetY` with the current uniform random formula.
- Otherwise, sample up to 16 eligible enemy anchors. For each sampled anchor, count living enemies within `arrow.radius + enemy.radius`, matching the existing `castRing` collision boundary. Select one sampled anchor with probability proportional to that count.
- Store the chosen enemy position in `skyArrow.targetX/targetY`. Do not retarget during descent.
- At age `1.08` seconds, call the existing `castRing`; damage, visual ring, and timing remain unchanged.

## State and Data

- No profile, save, balance, or localization data changes.
- The existing `skyArrow` runtime state remains sufficient; selection uses temporary local candidates and scores.
- A fixed sample cap bounds target-selection work in dense waves.

## Runtime Flow

1. `castSkill` initializes the Sky Arrow state with its existing radius, power, and skill scale.
2. `advanceSkills` increments age each frame.
3. On the single `0.8`-second threshold crossing, a helper in `Battle` samples enemy-centered landing candidates from the safe viewport and weights each candidate by local enemy count. Empty areas use the existing random fallback.
4. The renderer reads the stored target while the arrow descends.
5. At `1.08` seconds, the existing ring damage path resolves only enemies still within range.

## Module Impact

- `src/game/battle.ts`: add the enemy-density target helper and call it at the existing selection threshold.
- No rendering, HUD, data, or persistence changes.

## Edge Cases

- No alive enemies in the selection inset: retain uniform random fallback.
- One eligible enemy: select its position; it may still move before impact.
- Enemy dies or leaves the blast radius during descent: do not retarget; existing collision logic decides the hit.
- Enemies near the map edge: anchors remain within the existing viewport inset; the damage ring may still hit nearby enemies just outside it.
- Multiple sampled anchors have the same density: weighted selection naturally gives them equal probability.

## Design Risks

- Sampling enemy anchors favors occupied regions while preserving some randomness; the fixed 16-anchor cap avoids scanning every possible point on the screen.
- A very sparse crowd may still produce a miss if the selected enemy moves before impact. Tracking is intentionally excluded so the skill retains a dodge window.
