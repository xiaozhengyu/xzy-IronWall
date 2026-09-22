# AI Change Log

Record substantive AI-assisted implementation changes here. Documentation-only edits do not require an entry.

Use this format:

```md
## YYYY-MM-DD — <feature-slug>

- Spec: `docs/spec/<feature-slug>/`
- Summary: <what changed>
- Impact: <affected systems and user-visible behavior>
- Validation: <commands and manual scenarios>
```

## 2026-09-22 — keyboard-controls

- Spec: `docs/spec/keyboard-controls/`
- Summary: Changed movement to the arrow keys and expanded active skill input from Q/E/R to Q/W/E/R while retaining Shift sprint.
- Impact: Updated run-local skill loadout capacity, keyboard input translation, HUD slot presentation, debug help, and related control documentation.
- Validation: `npm run build`; browser checks for five-slot HUD presentation, `W` skill activation, and updated help text; source-level checks for arrow movement and focus reset behavior.

## 2026-09-22 — experience-magnet

- Spec: `docs/spec/experience-magnet/`
- Summary: Added the timed Charm of Gathering, which temporarily makes the shared collectible pickup range infinite.
- Impact: Added a new drop/use path for the charm, localized copy and icon mapping, while preserving existing drop physics and inventory rules.
- Validation: `npm run build`; `git diff --check`; browser startup smoke check and source-level checks for the drop, use, expiry, and reset paths.

## 2026-09-22 — developer-console

- Spec: `docs/spec/developer-console/`
- Summary: Added a DEV-only F1 developer console for immediate skill/item setup, HP/MP locks, resource refill, invincibility, and existing battle debug controls.
- Impact: Added a dedicated UI component, Battle-owned temporary debug state, direct item grant feedback, skill reset, and reset-safe resource controls without changing Profile data.
- Validation: `npm run build`; `git diff --check`; browser checks for F1 panel, skill equip, Gathering Charm grant, HP/MP locks, reset cleanup, and empty browser error logs; production bundle marker check.
