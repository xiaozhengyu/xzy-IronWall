# Validation: Boss Clarity and Larger Maps

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Boss readability | Start a wave containing a boss and observe it inside the crowd | Boss model is visibly larger, ring is larger, and the target remains identifiable |
| Boss clearance | Let minions approach and surround a boss | Minions stop with a visible buffer instead of overlapping the boss body |
| Boss variants | Test both the elite and knight-boss map variants | Both variants use the same visual scale and separation rule |
| Large-map traversal | Walk toward each map edge and inspect the minimap | Player can traverse the expanded area; camera and minimap stay within bounds |
| Wave stability | Run several waves on the expanded proving ground | Wave timing, enemy budgets, combat damage, and spawn cadence remain unchanged |

## Automated Checks

- `npm run build`
- `npm run figures`
- `npm run bench`
- `git diff --check`

## Visual and Performance Checks

- Compare Boss/minion size at the same camera grain before and after the change.
- Verify terrain bake completes for all four maps and no map preview is blank.
- Check benchmark output for crowd simulation and terrain rendering regressions.

## Regression Checklist

- [ ] Boss victory/deadline logic remains unchanged.
- [ ] Debug jump-to-wave and reset paths still work.
- [ ] Camera, spawn, culling, restoration, and minimap bounds use Field dimensions.
- [ ] Existing wave card, combat text, controls, and HUD behavior remains intact.

## Evidence

Record build, figure, benchmark, and manual gameplay results after implementation.
