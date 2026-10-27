# Algorithm Catalog — Cognitive Update Pack v0.2

**Status:** isolated research catalog. Nothing here is imported by Morrow's runtime.

Maturity labels:

- **SPEC:** written contract only.
- **PROTOTYPE:** executable reference without repeatable tests.
- **TESTED:** deterministic unit tests pass; not validated on product data.
- **VALIDATED:** pre-registered dataset and acceptance criteria passed.
- **INTEGRATION_CANDIDATE:** validated and reviewed for a product integration proposal.

No module below is VALIDATED or INTEGRATION_CANDIDATE.

| ID | Module | Version | Depends on | Reference | Maturity | Evidence |
|---|---|---|---|---|---|---|
| C-01 | Evidence and confidence management | 0.2.0 | none | `updateEvidenceConfidence` | TESTED | Dedup/clip/counter tests |
| C-02 | Retrieval fusion ranking | 0.2.0 | C-01 eligibility signals | `fuseRelevanceScores` | TESTED | Missing-signal, threshold, hard-gate tests |
| C-03 | Conflict detection and correction | 0.2.0 | time ranges | `detectFactConflict` | TESTED | simultaneous conflict, temporal update, attribute mismatch |
| C-04 | Temporal decay and forgetting | 0.2.0 | category config | `temporalDecay` | TESTED | category half-life, retracted exclusion |
| C-05 | Context budget optimization | 0.2.0 | eligibility + utility/cost | `selectContextUnderBudget` | TESTED | exact DP vs greedy, hard gate, impossible budget |
| C-06 | Pre-answer metacognitive check | 0.2.0 | evidence/claim records | `metacognitiveCheck` | TESTED | support, conflict, inference, subject, context-only, retired |
| C-07 | Personality stability and preference evolution | 0.2.0 | independent preference evidence | `updatePersonalityState` | TESTED | bounded delta, fact exclusion, dedup |
| C-08 | Computed affective/interest state | 0.2.0 | state vector + event | `updateAffectiveState` | TESTED | bounds, decay, representation disclaimer |

## Shared constraints

- All inputs are caller-supplied plain objects; no storage or network access.
- All outputs are deterministic for identical inputs.
- Eligibility/permission is applied before ranking or utility.
- Missing semantic values are `null`/absent and omitted from fusion; never fabricated.
- Confidence and utility are not probabilities unless separately calibrated.
- C-08 is a computed state vector, not evidence of subjective experience.

## Promotion requirements

A module may move to VALIDATED only after:

1. frozen dataset and metric definitions;
2. baseline and candidate run on identical cases;
3. held-out evaluation not used for tuning;
4. per-case failures retained;
5. privacy/revocation regression gate passes;
6. an independent reviewer signs the evidence.

Moving to INTEGRATION_CANDIDATE additionally requires a product owner, migration/rollback plan, and explicit authorization.
