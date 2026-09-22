# Design: Boss Clarity and Larger Maps

## Gameplay Rules

Boss rendering uses a shared `BOSS_RENDER_SCALE` of `1.35`, applied only to the projected character model and boss ground ring. It does not alter `Character` stats or collision radius. A boss/minion pair uses the existing crowd spacing plus `BOSS_CLEARANCE = 18` world units. Boss/boss pairs keep the existing rule.

The extra clearance is used consistently by movement separation, corridor look-ahead, and distant-enemy restoration checks. The spatial grid cell-size lower bound includes the extra clearance so pair checks cannot fall into non-adjacent cells.

Map dimensions are multiplied by three in `GameMaps` and the boot-time constants for the proving ground. Terrain layouts remain normalized, so paths, ponds, groves, and borders keep their relative positions and proportions. Wave templates, budgets, and camera view dimensions are unchanged.

## State and Data

- `BOSS_RENDER_SCALE = 1.35` in the scene renderer.
- `BOSS_CLEARANCE = 18` in Battle crowd-distance rules.
- `MAX_BULK` and grid-cell calculations cover the enlarged boss footprint.
- Map dimensions: proving 3600×3600, pass 3300×4800, steppe 4800×4800, snowfield 4200×4200.

## Runtime Flow

1. Scene identifies `Character.boss`, creates a larger projector for the boss model, and scales the boss ring.
2. Battle derives pair distance from boss flags and applies the extra clearance in all movement/restore paths.
3. Field receives the expanded map dimensions; terrain, props, camera clamp, spawn/cull bounds, and minimap consume those dimensions through existing interfaces.

## Module Impact

- `src/render/scene.ts`: boss model/ring scale.
- `src/game/battle.ts`: boss clearance and spatial-grid bounds.
- `src/data/maps.ts`, `src/main.ts`: three-times map dimensions.
- `docs/decisions/AI_CHANGELOG.md`: implementation record.

## Edge Cases

- Multiple bosses do not push each other farther apart than the existing rule.
- A boss enlarged only for rendering still uses the existing collision/stats model.
- The larger maps must not create more wave enemies; the existing world budget remains authoritative.
- Field caches and map previews use the same expanded Field instance.

## Design Risks

Terrain textures and procedural props cover more world area, increasing bake memory and time. The existing patch size and segmented baking remain unchanged so the risk is bounded to total map area; build, figures, bench, and manual edge/crowd checks provide the rollback signal.
