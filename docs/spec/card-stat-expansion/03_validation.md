# Validation: Expanded Stat Cards

## Automated Checks

- [ ] `npm run build`
- [ ] `npm run figures`
- [ ] `npm run bench`
- [ ] `git diff --check`

## Manual Checks

| Scenario | Expected result |
| --- | --- |
| Open a gem reward with an available pool | Max-mana and critical-chance cards can appear with localized text and distinct icons. |
| Select max mana | The max-mana display increases; current mana is not automatically refilled. |
| Select critical chance | Subsequent critical rolls use the increased chance. |
| Repeat either stat five times | The same attribute card is no longer offered after reaching its existing cap. |
| Open a nine-card wave reward | The 3×3 layout, three-pick flow, and gold fillers remain unchanged. |
