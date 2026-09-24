# Validation: Persistent Bloodstains

## Automated Checks

- [x] `npm run build`
- [x] `npm run figures`
- [x] `npm run bench`
- [x] `$env:WAVE='8'; npm run bench`
- [x] `git diff --check`

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Lethal hit | Kill one enemy, then wait for its corpse to sink | A pixel bloodstain remains at the kill position after the body disappears. |
| Ground-detail occlusion | Kill enemies near grass, bushes, rocks, and logs, then let the scene redraw | Stains remain visible above ground scatter while still being behind trees, props, pickups, and characters. |
| Blood color | Kill enemies on dirt and grass | Stains read as crimson red, not black, while the ground remains visible through the edges. |
| Full map coverage | Kill enemies in the map center, right half, bottom half, and near all four borders | Every in-map kill produces a stain; no half-map coordinate region is silently discarded. |
| Nonlethal hit | Hit an enemy without killing it | No persistent stain appears. |
| Knockback | Kill an enemy with a strong launch | The stain stays ground-anchored at the fatal-hit position and does not travel with the corpse. |
| Multiple kills | Kill a dense group, then move away and return | Each kill adds a stain; prior stains remain visible without duplicate stamps on redraw. |
| Result screen | Finish or lose a run | Stains remain visible behind the result panel. |
| New run | Return to setup and start another run | Previous-run stains are cleared. |
| Setting off/on | Turn stains off and back on from ESC settings during a run | Off hides all current and future stains; on reveals all stains accumulated in the current run. |
| Setting persistence | Change the setting, reload, and inspect the ESC settings row | The chosen state persists, including when loading a Profile created before this setting existed. |
| Gameplay isolation | Walk and collide over stained ground; compare kill/drop counts | Stains do not affect movement, collision, drops, or combat outcomes. |

## Regression Checklist

- [ ] Weather and ground texture rendering remain aligned while the camera moves and zooms.
- [ ] Switching maps and battle reset do not retain stains from the previous run.
- [ ] The result screen retains the finished run's stains.
- [ ] Sparse chunks and queued events remain bounded during a high-kill wave.
- [ ] Both locale dictionaries satisfy the typed text-key contract.

## Evidence

Automated checks passed after the map-coordinate fix: build, figures, default benchmark (0.48 ms total CPU), wave-8 benchmark (0.87 ms total CPU), and diff check. Manual in-game kill placement, full-map coverage, ground-scatter occlusion, settings toggle, and result/reset lifecycle checks remain; the local browser was previously opened to setup but Computer Use could not proceed to the battle screen.
