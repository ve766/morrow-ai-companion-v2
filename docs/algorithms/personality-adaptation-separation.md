# Personality adaptation separation (G1 / G2 / intrinsic)

Status: **separation implemented; an intrinsic G1 writer is still missing**.
This document states what the code does at `60ae6fe`, including that limit.

## 1. Three layers, three ledgers

| Layer | Storage | Who may write | What it means |
| --- | --- | --- | --- |
| User-authored baseline | `personality_profile` / revisions | The user, through the profile editor | What the user asked Morrow to be. `applyGrowth(baseline, offsets)` clips the result to 0–100. |
| G1 intrinsic drift | `personality_growth_signals` | Nothing in the current production path (this is the gap) | Intended: Morrow's own evidence-gated presentation drift. |
| G2 user adaptation | `user_interaction_signals` | The turn projector, from the user's explicit style request | How to adapt to *this* user, never Morrow's identity. |
| Intrinsic traits | `morrow_trait_observations` / `morrow_trait_revisions` | `MorrowTraitService` evidence gate | Slow traits (curiosity, persistence, carefulness, openness, responsibility) formed from Morrow-owned appraisals. |

The user style request ("回答直接一点") is derived by
`deriveGrowthSignals()` and written **only** to G2. Before Issue #81 the same
signal was also written to G1; that mirror is removed.

## 2. G1 guard rails (when a writer exists)

`src/personalization/personality-growth.ts` defines the storage contract that
an intrinsic writer must use:

- append-only rows `(dimension, turn_id, signal, weight, source, at)` with a
  unique `(dimension, turn_id)` key, so retries converge;
- effective offset is a fold over rows, not an incremental update:
  `offset = clamp(Σ signal·weight·step·decay, ±8)`;
- decay uses age halves; the rows are kept, only their weight decays;
- at least 2 independent sources are required before a non-zero offset
  (`evidenceCount` below the gate → offset 0);
- effective profile = `clip(baseline + offset, 0, 100)`;
- rollback is `growth.rollback()` / deleting the source rows, which recomputes
  the fold.

The trait gate is a separate intrinsic path: `morrow_trait_*` rows and their
revisions. It is not silently mapped onto warmth/directness/humor; such a
mapping would be an invented algorithm, so it is not done.

## 3. G2 adaptation

`UserInteractionProfileService.apply()` stores one row per
`(dimension, turn_id)` with the derived signal and source. The prompt builder
reads it as a separate adaptation line (`describeInteraction`), not as part of
the personality numbers. G2 is per-user and can be revised by later turns or
cleared with the profile.

## 4. Evidence and rollback

- User style requests are `origin=user`; they can never enter the trait gate
  (the mapper filters user-context candidates) and are no longer written to G1.
- G1 evidence, if introduced, must pass the same F1 lineage rules: persisted
  root, active source, Morrow owner, verified cluster. A user id is not enough.
- Tests: `src/app/stage3-remediation.integration.test.ts` D-1 asserts G1 stays
  at 0 after one and two style turns, G2 gains evidence, and a restart preserves
  G2 offsets.

## 5. Honest gap

There is no active production writer for G1. The previous writer was the user
style projector, which was pollution, not intrinsic growth. Consequently this
task delivers the **separation** and the intrinsic trait ledger, but not a new
Morrow-owned presentation-drift writer. Calling F4 fully complete would
overstate the code. The matrix records F4 as PARTIAL for this reason.
