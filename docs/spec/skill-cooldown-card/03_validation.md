# Validation: Skill Cooldown Card

## Automated Checks

- [x] `npm run build`
- [x] `npm run figures`
- [x] `npm run bench`
- [x] `git diff --check`

## Manual / Source-Level Scenarios

| Scenario | Expected result |
| --- | --- |
| Roll a spirit-stone reward | The cooldown card may appear with localized name and a 2%, 3%, 4%, or 5% detail. |
| Roll a wave reward | The cooldown card may appear in the nine-card pool; three-pick behavior remains unchanged. |
| Select while skill cooldowns are running | Existing skill cooldown timers and the current attack cooldown decrease immediately. |
| Cast / trigger skills after selection | Newly started cooldowns use the accumulated additive reduction for active, projectile, guard, attack, and sprint skills. |
| Automatic attack after selection | Skill cooldown portion is reduced; swing animation length remains unchanged. |
| Select the card five times over the run | Total reduction is no more than 25%; the card family leaves the shelf after its fifth selection. |
| Reset the run | Cooldown reduction returns to zero and no prior cooldown state remains. |
| Reset debug skill loadout mid-run | The current run's cooldown reduction remains applied. |
| Exhaust other cards / fill wave reward | Existing gold fillers and fixed nine-card wave layout still work. |

## Regression Checklist

- [ ] Ordinary `StatBonus` cards keep their current application behavior.
- [ ] Skill acquisition, skill upgrades, and icon/key de-duplication remain intact.
- [ ] Chinese and English dictionaries satisfy the typed text-key contract.
- [ ] Offline previews still generate successfully.

## Evidence

Record build output, figure-generation output, and diff checks after implementation. Manual live-game checks remain separate if no browser session is available.
