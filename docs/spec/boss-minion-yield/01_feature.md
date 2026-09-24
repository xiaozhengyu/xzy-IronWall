# Feature: Minion Yielding for Bosses

## Player Problem

Bosses can appear motionless when ordinary enemies crowd their approach lane. The current crowd system gives units mostly symmetric separation and does not make minions actively clear a path for a boss.

## Desired Outcome

Bosses should retain their forward pressure through a crowd. Nearby minions should briefly sidestep out of an approaching boss's lane, then resume pursuing the player after the boss passes.

## In Scope

- Detect a nearby boss approaching a normal minion from behind along the boss's pursuit direction.
- Let the minion take a stable lateral step while preserving the existing boss/minion clearance.
- Give minions priority during boss/minion overlap correction so separation does not push the boss backward.
- Apply the same movement behavior to visible and distant simulated enemies.

## Out of Scope

- Adding a general pathfinding system or changing obstacle collision rules.
- Changing boss/minion stats, attack behavior, crowd budgets, or spawn timing.
- Changing how minions yield to other minions or how bosses separate from other bosses.

## Acceptance Criteria

- [ ] A minion in the near-ahead lane of an approaching boss visibly sidesteps instead of holding the lane.
- [ ] The minion resumes normal pursuit once it has cleared the boss lane.
- [ ] Boss/minion spacing remains at least the existing crowd clearance when the terrain permits.
- [ ] Pair separation moves a minion away from a boss without moving the boss backward.
- [ ] Bosses and distant enemies still update correctly; ordinary crowd flow and performance remain acceptable.

## Constraints

- Reuse the movement spatial grid and stable `sideBias`; avoid per-frame allocations in the crowd hot path.
- Keep the existing shared boss/minion clearance and ordinary enemy movement behavior.
