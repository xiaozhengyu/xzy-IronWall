# Feature: Sky Arrow Targeting

## Player Problem

Sky Arrow currently chooses a uniformly random point in the safe inset of the spawn viewport. The landing can be empty even when enemies are on screen, making the skill feel unreliable.

## Desired Outcome

Prefer landing points near enemy groups while keeping the upward launch, visible descent, fixed landing point, and existing area damage. The skill should still have a valid random fallback when no eligible enemies are present.

## In Scope

- At the existing 0.8-second target-selection moment, choose a landing anchor from living enemies inside the current spawn-viewport inset.
- Weight candidate anchors by the number of living enemies within the skill's impact radius.
- Preserve a uniform random fallback over the existing safe inset when no eligible enemy is present.
- Keep the chosen target fixed through the 0.28-second descent.

## Out of Scope

- Changing skill damage, radius, cooldown, mana cost, animation timing, or card behavior.
- Tracking enemies after the target has been selected.
- Guaranteeing a hit when enemies move out of the impact radius before landing.
- Changing other skills or enemy behavior.

## Acceptance Criteria

- [ ] If living enemies are inside the target-selection area, denser groups have a higher probability of being selected than isolated enemies.
- [ ] The target is selected once at 0.8 seconds and remains unchanged until the existing 1.08-second impact.
- [ ] If the selection area has no living enemies, the existing random safe-area behavior is used.
- [ ] Damage still uses the existing `castRing` hit rule, skill radius, power, and level scaling.
- [ ] Target selection performs bounded work once per cast, not once per frame.

## Constraints

- Use `BattleView.spawn` and preserve its existing horizontal `0.78` and vertical `0.72` safe-area margins.
- Do not change persisted data, balance tables, localization, or rendering assets.
