# Feature: Persistent Bloodstains

## Background

Enemy bodies collapse and are eventually recycled. Their death has no lasting ground mark, so a cleared fight leaves no visible trace. Players need an optional, persistent visual record of enemies defeated during the current run.

## Goal

Leave a pixel-art bloodstain at each enemy's fatal-hit position and keep it visible through the run's result screen. Clear run-local stains when a new run starts.

## In Scope

- Add one ground-anchored dark-crimson pixel splatter for each enemy killed by the player.
- Keep stains independent from `Character` corpses so body sinking/recycling does not remove them.
- Preserve all stains for the entire run, including the result screen; clear them on the next battle reset.
- Add a Profile-backed on/off setting in the ESC settings panel, default enabled. Turning it off hides stains immediately without deleting current-run marks; turning it back on reveals them again.
- Keep rendering cost and memory bounded using persistent, fixed-resolution ground texture chunks rather than per-frame replay of an ever-growing mark list.
- Update localization, Spec, and `docs/decisions/AI_CHANGELOG.md`.

## Out of Scope

- Blood effects for player damage, nonlethal enemy hits, or environmental events.
- Blood trails attached to moving or flying corpses, physics/collision changes, or blood cleanup during the run.
- Weather-based washing, fading, save/load of in-progress runs, or cross-run persistence.

## Acceptance Criteria

- Every lethal enemy hit creates one ground stain at the enemy's position when killed; nonlethal hits and player deaths do not.
- Stains remain after the enemy body sinks or is recycled and remain visible through victory/defeat results.
- Starting another run clears prior stains.
- The ESC setting defaults on, persists across reloads, hides/reveals stains immediately, and old Profile data receives the default without reset.
- Stains do not alter movement, collision, drops, kills, or combat simulation.
- All stains remain for a run without a per-run record cap; storage is bounded by the map texture resolution, with sparse chunks allocated as needed.
