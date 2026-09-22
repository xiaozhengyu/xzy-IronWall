# Repository Guidelines

## Project Structure & Module Organization

IronWall is a browser-based action game built with TypeScript, Vite, and Pixi.js.

- `src/main.ts` is the composition root, game-state coordinator, and main loop.
- `src/game/` contains simulation rules; `src/data/` contains hero, unit, map, wave, item, and balance definitions.
- `src/render/`, `src/characters/`, `src/effects/`, and `src/world/` implement procedural presentation.
- `src/ui/` contains DOM HUD and menus; `src/audio/` contains Web Audio integration.
- `assets/` stores audio/HUD art, `public/` stores static files, `screenshots/` stores documentation images, and `tools/` contains offline preview/benchmark scripts.
- No automated test suite currently exists.

## Build, Test, and Development Commands

```bash
npm install                         # Install locked dependencies
npm run dev                         # Start the Vite development server
npm run build                       # Type-check and create a production build
npm run preview                     # Serve the production build locally
npm run figures                     # Generate offline rendering previews
npm run bench                       # Measure CPU simulation and geometry costs
$env:WAVE='8'; npm run bench        # PowerShell: benchmark a late wave
```

Use `npm run dev` for interactive work. `figures` and `bench` write ignored temporary outputs; do not commit them.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, single-quoted strings, strict typing, and explicit `type` imports where appropriate. Use `PascalCase` for classes/types, `camelCase` for functions/variables, and `UPPER_SNAKE_CASE` for constants. Keep tunable gameplay values in `src/data/` and player-facing text in `src/ui/text/`. No formatter or linter is configured; `npm run build` is the static check.

## Testing Guidelines

There is no test runner or coverage threshold. Before submitting changes, run `npm run build`; use `npm run figures` for rendering changes and `npm run bench` for simulation or crowd-performance changes. Manually exercise affected UI screens and include screenshots for visual changes.

## Commit & Pull Request Guidelines

Recent commits use concise conventional-style subjects such as `feat(setup): ...`, `feat(i18n): ...`, `balance: ...`, `docs: ...`, and `chore(release): ...`. Keep commits focused. Pull requests should summarize behavior changes, list validation commands, include before/after screenshots for visual work, and report benchmarks for performance-sensitive changes. Do not commit `node_modules/`, `dist/`, `.preview-*.png`, or `.bench.mjs`.

## Release and Configuration Notes

Keep Vite's `base: './'` setting so builds work when hosted under a subpath or iframe. Production code relies on `import.meta.env.DEV` to remove developer-only controls; preserve that boundary when adding debug features.
