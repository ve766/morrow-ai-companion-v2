# Morrow Cognitive Algorithm & Operator Update Pack

**Pack version:** 0.1.0-draft  
**Status:** isolated research package; not integrated into Morrow runtime  
**Target:** Morrow V2  
**Branch:** `research/cognitive-update-pack-v0.1`

## Purpose

Develop and validate reusable cognitive algorithms and candidate operators now, while keeping them outside the running Morrow product. When the product reaches the agreed integration milestone, select only proven components from this pack and integrate them deliberately.

This pack is a workbench for algorithm design, reference contracts, evaluation cases, and later portable implementations. Its presence on this branch does **not** mean Morrow's runtime now uses these operators.

## Non-negotiable boundaries

- Do not modify the product's existing runtime path from this pack.
- Do not create a second production memory store, personality store, or event log.
- Do not force a large refactor to adopt an operator.
- Keep existing algorithms as the baseline until comparative tests show a measurable improvement.
- Prefer deterministic, inspectable code; use an LLM only when a task genuinely requires semantic interpretation.
- Do not allow learned preferences or reflective outputs to silently rewrite system policy, permissions, or source memories.
- Do not send private conversation content to external models during evaluation without explicit authorization.
- Do not claim implementation, quality gains, or test success until backed by executable tests and recorded results.

## Pack contents

- `ALGORITHM_BLUEPRINT.md`: the end-to-end cognitive algorithm and its invariants.
- `MATHEMATICAL_SPEC.md`: proposed equations, variables, constraints, evaluation metrics, and formula-to-code coverage.
- `OPERATOR_CATALOG.md`: candidate operator contracts, responsibilities, and boundaries.
- `EVALUATION_PLAN.md`: datasets, metrics, regression cases, and release gates.
- `INTEGRATION_PLAN.md`: how proven pieces may later be extracted without prematurely integrating them.
- `CHANGELOG.md`: changes and evidence for each pack revision.

## Development loop

1. Record a concrete failure mode or unmet capability.
2. Add a reproducible test case before changing behavior.
3. Implement or revise a candidate algorithm/operator inside this pack only.
4. Compare against a frozen baseline on the same fixtures.
5. Record quality, safety, latency, and resource results.
6. Keep, revise, or reject the candidate based on evidence.
7. Integrate later only if the component has a clear owner, stable contract, and proven benefit.

## Versioning policy

- **PATCH:** clarification or compatible test/fixture additions.
- **MINOR:** backward-compatible operator or algorithm capability additions.
- **MAJOR:** incompatible contract changes or changed semantics that require consumers to adapt.

Version numbers describe this pack, not the Morrow product version.

## Current limitations

This is an initial design pack, not a finished cognitive engine. The mathematical specification formalizes candidate methods but does not prove effectiveness; several formulas are not implemented yet. No runtime integration, model training, or performance claim is implied. Candidate operators must be implemented and tested before being considered stable.
