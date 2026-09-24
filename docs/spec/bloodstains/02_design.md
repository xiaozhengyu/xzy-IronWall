# Design: Persistent Bloodstains

## Death Event and Lifetime

`Battle.strike()` is the shared enemy damage/kill path. When `Character.takeHit()` reports a lethal hit, Battle queues a small `BloodstainEvent` containing world position, visual scale, and deterministic variation seed. Scene consumes the queue during drawing. It does not attach data to the enemy, because corpses sink and are recycled after a short hold.

Battle exposes a run/reset revision. When Scene observes a new revision, it clears the stain cache. This keeps stains through the final result display while making `Battle.reset()` the single lifecycle boundary for a new run.

## Rendering

Render stains as visible crimson hard-edged pixel splatters above ground detail and static ground scatter (brushes, rocks, and logs), but below trees, camp props, pickups, and characters. Use normal alpha compositing with a lighter red palette and moderate opacity; do not multiply near-black RGB values into the ground, which makes the marks read as black. Scene renders ground footsteps, fine terrain detail, and ground scatter into a dedicated mesh, then places the stain chunk sprites, then the normal world-entity mesh. Map coordinates are translated into the same texture-space resolution as the baked ground. A sparse grid of fixed-size transparent RGBA chunks stores the accumulated pixels. A frame batches stamps per dirty chunk and uploads only changed chunks; no marks are redrawn as ShapeBatch primitives each frame, and there is no arbitrary mark-count cap that would violate the run-long persistence requirement.

The layer is bound to the active field dimensions. Out-of-map kill positions are ignored. Clearing a run zeros allocated chunk pixels and clears queued events; chunk storage may be reused for the next run.

## Settings and Localization

- Add `ProfileSettings.bloodstains`, default `true`; existing Profile merge-with-defaults loading supplies the new value to older saves.
- Add a “Bloodstains” on/off row to `SummaryScreen` ESC settings.
- The setting controls layer visibility only. Stains continue to accumulate while hidden, so turning it back on during the same run restores all current-run marks.
- Add a localized settings label and connect the hook through `main.ts` to Profile and Scene.

## Module Impact

- `src/game/battle.ts`: lethal enemy event queue and reset revision.
- `src/render/bloodstainLayer.ts`, `src/render/scene.ts`: sparse ground-texture chunks, stamp rasterization, visibility and run reset; separate ground mesh places stains above fine detail and static scatter but below world entities.
- `src/game/profile.ts`: persistent display preference with backward-compatible defaults.
- `src/ui/summary.ts`, `src/ui/text/hudText.*`, `src/main.ts`: ESC toggle, localization, and setting propagation.
- `docs/decisions/AI_CHANGELOG.md`: record the implementation and verification.

## Edge Cases

- A single Battle update may kill many enemies; events are batched and each changed texture chunk is uploaded once for that draw.
- Rapid toggle changes do not clear the map cache.
- A scene redraw without a simulation update must not duplicate a stain; only newly queued kill events are consumed.
- Switching fields or resetting for a new run clears old map marks; the result screen does not.
- Empty chunks are not allocated; stain pixels are clipped at map boundaries.
- Setup previews and the item gallery hide the stain layer without clearing run data.

## Performance

The map-sized logical resolution is fixed and sparse chunks are allocated only where kills occur. Draw work is a bounded set of chunk sprites, while kill-time rasterization and texture updates occur only on changed chunks. This avoids unbounded per-frame geometry growth as kill counts rise.
