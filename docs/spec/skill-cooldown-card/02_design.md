# Design: Skill Cooldown Card

## Card Definition and Rolling

Add a dedicated cooldown-reduction offer to the existing shared stat-card shelf. Reuse the four existing roll steps (8, 12, 15, 20) at a 0.25 scale, yielding 2%, 3%, 4%, or 5%. Reuse the existing five-pick per-family cap. This makes the maximum additive run reduction 25% without changing card de-duplication or reward composition. The offer uses the existing scroll HUD icon, localized name/detail keys, and a distinct offer effect field rather than `StatBonus`, since cooldown is not a `UnitStats` field.

## Runtime Effect

`HudCardPicker` routes the selected reduction to a dedicated HUD hook. `Battle` owns the accumulated run reduction and clamps it to 25%. `SkillLoadout` owns a run cooldown scale, combines it with each skill's existing level rate, and rescales already-running skill cooldown timers when the scale changes. The current automatic-attack cooldown timer is rescaled at selection; its next cooldown duration is computed as the unchanged swing duration plus the skill cooldown multiplied by both the level rate and run scale.

The cooldown scale applies across all `SkillId`s, including sprint and skills obtained after the card. Skills with a zero cooldown are unchanged. Cooldown state and the run reduction reset on a fresh run; debug skill-loadout reset preserves the run's cooldown reduction.

## Localization and Integration

- Add `cardSkillCooldown` and `cardSkillCooldownDetail` to `HudTextKey` and both locale dictionaries.
- Connect the card-specific callback in `main.ts` to `Battle.addRunSkillCooldownReduction`.
- Keep the existing `StatBonus` flow untouched for ordinary attribute cards.

## Risks and Edge Cases

- Attack cooldown includes both swing time and skill cooldown; only future cooldown durations scale the skill component. The live timer is reduced proportionally when the card is selected, while the independent attack animation guard still prevents a swing from being interrupted.
- Sustained skills only start their cooldown under their existing release/exhaustion rules; the reduction changes that resulting cooldown, not the sustain duration.
- Five maximum rolls reach exactly the 25% cap. The card is removed from the shelf after five selections using the existing per-family cap.
- Existing icon-based de-duplication may omit this card from a particular row if another offer already uses its icon; this matches all current card families.
