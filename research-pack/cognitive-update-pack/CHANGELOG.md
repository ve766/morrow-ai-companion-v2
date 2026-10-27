# Changelog

## 0.1.0-draft — initial pack

- Established a separate, non-runtime research package.
- Defined the end-to-end cognitive algorithm blueprint.
- Cataloged candidate operators and their contracts.
- Added dependency-free JavaScript reference operators for lifecycle gating, lexical candidate generation, transparent ranking, and character-budget context selection.
- Added a reference retrieval composition algorithm and Node built-in tests.
- Defined evaluation fixtures, metrics, release gates, and later extraction strategy.
- These reference operators are not imported by Morrow's runtime.
- Tests have been authored but have not yet been executed in this environment.

- Added `MATHEMATICAL_SPEC.md` with proposed lifecycle-gate, multilingual lexical similarity, ranking, recency, conflict, context-budget, abstention, payload-audit, memory-proposal, and evaluation-metric formulas.
- Added a formula-to-code coverage table so specified mathematics is not confused with implemented behavior.
- No test execution or quality improvement is claimed by this documentation change.

## 0.2.0-draft — eight-module update pack

Reason: the product diagnosis showed that delivery could be correct while evidence support, conflict handling, correction persistence, retrieval precision, and evaluation remained weak. This revision adds isolated algorithms and tests; it does not integrate them.

### Added

- `src/cognitive-v2.js` with reference implementations for:
  - evidence confidence with source deduplication;
  - fusion ranking with missing-signal omission and renormalized weights;
  - structured conflict detection with time overlap;
  - category-aware temporal decay;
  - exact dynamic-programming context budget selection plus greedy comparison;
  - structured pre-answer metacognitive check;
  - bounded personality/preference update;
  - computed affective/interest state update.
- `test/cognitive-v2.test.js` with 18 tests.
- `ALGORITHM_CATALOG.md`, `IMPLEMENTATION_STATUS.md`, `SAFETY_AND_PRIVACY.md`.
- Incremental v0.2 sections in `MATHEMATICAL_SPEC.md`; v0.1 text preserved.
- Operator contracts O-11 through O-18.
- v0.2 evaluation datasets, metrics, ablations and promotion gates.

### Verification

Command: `npm test` in `research-pack/cognitive-update-pack`  
Result: **24 tests passed, 0 failed** on Node v22.22.2, Windows x64.  
Network/model calls: 0.

### Maturity

All new modules are **TESTED** at unit level only. None is VALIDATED or INTEGRATION_CANDIDATE. No runtime integration exists.

### Deliberate non-changes

- `MATHEMATICAL_SPEC.md` v0.1 sections were not rewritten.
- The production runtime was not modified.
- No semantic model, vector store, tokenizer, or external service was introduced.

