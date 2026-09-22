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
