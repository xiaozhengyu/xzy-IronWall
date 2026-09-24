# Feature: Skill Cooldown Card

## Background

Run rewards currently offer attribute, skill-acquisition, skill-upgrade, and gold cards. Players can improve attack rate, but there is no card that reduces the cooldown component shared by all skills.

## Goal

Add a run-only card that reduces the cooldown of every skill, including skills equipped later in the same run.

## In Scope

- Add the card to the shared spirit-stone and wave reward pools.
- Roll a 2%, 3%, 4%, or 5% reduction per selection and allow at most five selections per run (maximum 25%).
- Apply each selection immediately to active cooldown timers and to cooldowns started afterward.
- Cover automatic attacks, projectile skills, guards, active skills, and sprint. Skills with no cooldown remain unaffected.
- Preserve the attack animation duration: future automatic-attack cooldown reduction only scales the skill cooldown component, not the swing-time component.
- Add Chinese and English card copy, a distinct existing HUD icon, validation notes, and a changelog entry.

## Out of Scope

- Changing attack animation timing, mana costs, skill damage, or skill upgrade rules.
- Adding persistent/profile progression or changing card-roll probabilities and reward counts.

## Acceptance Criteria

- The card can appear in both reward modes and is not offered more than once in a single card row.
- Each selection reduces current cooldowns and future cooldowns by its rolled percentage; reductions add, with a 25% maximum across five selections.
- Cooldown reductions reset when a new run starts and remain run-local.
- Automatic attacks retain their normal swing animation duration; only their skill cooldown component is reduced for subsequent attacks.
- Localized card labels and details display the actual rolled reduction.
- Existing stat-card, skill-card, gold-filler, and wave-reward behavior is unchanged.
