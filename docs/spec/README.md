# Spec-Driven Development

This repository uses a lightweight three-document SDD workflow designed for a TypeScript/Pixi.js game.

## Workflow

1. Create a feature directory named `docs/spec/<feature-slug>/`.
2. Complete `01_feature.md` before design or coding. Record the player problem, desired outcome, scope, constraints, and acceptance criteria.
3. Complete `02_design.md` for gameplay rules, state transitions, data definitions, runtime flow, affected modules, and edge cases. Cover simulation, rendering, UI, and audio only when relevant.
4. Complete `03_validation.md` with manual scenarios, automated commands, screenshots, performance checks, and regression criteria.
5. Implement only within the approved scope. Update the documents when the design changes.
6. After implementation, compare the result with all three documents, run the relevant checks, and record substantive logic changes in `docs/decisions/AI_CHANGELOG.md`.

Use [`_template/`](./_template/) as the starting point. Keep feature slugs short and stable, for example `skill-balance` or `map-weather`.

## Required Checks

Every change must pass `npm run build`. Rendering changes should also run `npm run figures`; simulation or crowd-performance changes should run `npm run bench`. Database work is not currently part of this project. If it is added later, include both a dated upgrade script under `database/upgrade/` and the matching initialization change under `database/init/`.
