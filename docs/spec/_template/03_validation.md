# Validation: <Feature Name>

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| <Normal flow> | <How to exercise it> | <Observable result> |
| <Edge case> | <How to exercise it> | <Observable result> |

## Automated Checks

- `npm run build`
- `<Additional command, if applicable>`

## Visual and Performance Checks

- `npm run figures` for procedural-rendering changes.
- `npm run bench` for simulation, crowd, or geometry changes.
- <Browser viewport, screenshot, or benchmark target>

## Regression Checklist

- [ ] Existing controls and game-state transitions still work.
- [ ] Pause, reset, victory, and defeat paths behave correctly.
- [ ] Localization and release-build behavior remain correct.

## Evidence

Record screenshots, benchmark output, or other evidence supporting the acceptance criteria.
