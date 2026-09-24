# Validation: Minion Yielding for Bosses

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Minion in boss lane | Spawn/advance a boss behind a group of minions moving toward the player | Minions in the boss's forward corridor sidestep; the boss continues forward without being visibly pushed back |
| Lane clears | Let the boss pass the yielding minions | Minions return to normal pursuit and do not orbit or remain displaced |
| Dense crowd | Observe the behavior with a late-wave crowd around a boss | Yielding stays local; ordinary minion flow and attacks continue |
| Boss variants | Test elite and knight-boss kinds | Both boss kinds receive the same movement priority |
| Boss/boss | Bring two bosses close together | Existing boss/boss spacing remains unchanged |
| Distant simulation | Zoom or move so boss/minion pairs are outside the active viewport, then return | They continue the same movement rules without a visible update discontinuity |
| Obstacles | Observe yielding near trees, campfires, and map borders | Existing collision remains valid; obstacle pathfinding is not implied by this feature |

## Automated Checks

- [x] `npm run build`
- [x] `npm run figures`
- [x] `npm run bench`
- [x] `$env:WAVE='8'; npm run bench` (PowerShell late-wave crowd run)
- [x] `git diff --check`

## Regression Checklist

- [ ] Boss/minion clearance and boss health bars remain intact.
- [ ] Ordinary minion/minion separation and attack behavior remain unchanged.
- [ ] Boss movement, attacks, hit stun, wave timing, and boss deadlines remain unchanged.
- [ ] No new per-frame allocation is introduced in crowd movement.

## Evidence

Build, rendering previews, and both default and late-wave benchmarks passed. `battle.update` measured 0.37 ms in the default run and 2.94 ms at wave 8 on this machine. These are post-change measurements; no before/after benchmark baseline was captured. Manual boss-lane traversal, temporary sidestep, and return-to-pursuit checks remain pending.
