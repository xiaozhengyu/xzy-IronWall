# Design: Minion Yielding for Bosses

## Gameplay Rules

- A normal minion yields only when a living boss is nearby, farther from the player than the minion, and the minion lies inside the boss's forward approach corridor.
- The boss's facing direction represents its pursuit intent. The corridor uses the existing boss/minion crowd distance and look-ahead scale.
- A yielding minion temporarily replaces its ordinary approach vector with a stable lateral direction away from the boss lane. Once outside that lane, the existing chase and crowd rules resume.
- Existing boss/minion clearance remains the minimum readable distance. When overlap correction is necessary, the minion absorbs the correction and the boss position is preserved. Boss/boss and minion/minion separation remain symmetric.

## State and Data

- No persistent or profile state is added.
- Reuse `Character.boss`, `facing`, and `sideBias`, the movement spatial grid, `crowdDistance`, and `BOSS_CLEARANCE`.
- Cache the yield decision with the existing near-enemy `CrowdDecision`; keep the distant path allocation-free and use the same corridor calculation.

## Runtime Flow

1. During the existing crowd look-ahead query, a minion checks nearby bosses in its approach lane, including bosses behind it (the existing query only yields to units ahead of the minion).
2. If a boss is approaching, the minion selects a stable lateral direction and moves aside at a bounded, non-zero yield pace.
3. When the minion clears the corridor, its regular player-directed crowd decision takes over.
4. During final pair separation, boss/minion overlap is corrected on the minion side; all other pair types retain equal correction.

## Module Impact

- `src/game/battle.ts`: boss-lane detection, yielding movement pace, and priority separation.
- `docs/decisions/AI_CHANGELOG.md`: record the gameplay logic change and validation.

## Edge Cases

- A minion already beside the boss moves farther to that same side; an exactly aligned minion uses its stable `sideBias` to avoid frame-to-frame flipping.
- Bosses do not yield to minions and multiple bosses continue to use existing pair spacing.
- A tree or map boundary may still prevent lateral movement; general obstacle pathfinding is explicitly out of scope.
- Hit-stunned bosses keep their existing brief pause; nearby minions may yield based on pursuit facing during that pause.

## Performance and Risk

The query reuses the spatial grid and only adds boss-lane checks within the existing local look-ahead region. Crowd simulation benchmarks should catch regressions. The main tuning risk is over-eager sidestepping; manual checks should confirm yielding is local and temporary rather than making minions orbit bosses.
