# Cognitive Algorithm & Operator Evaluation Plan

**Version:** 0.1.0-draft  
**Status:** evaluation design; results not yet collected

## 1. Evaluation rule

No candidate is called better without a recorded baseline, reproducible fixtures, and comparable runs. Passing CI alone is insufficient evidence of cognitive quality.

## 2. Required test groups

### Retrieval relevance
- Exact wording match.
- Semantic paraphrase with little or no lexical overlap.
- Multi-turn references such as “that earlier plan” or “the option I rejected.”
- Subject mismatch and conversation-scope mismatch.
- Stale versus recent information.
- Conflicting memories and explicit user corrections.
- Missing evidence, where correct behavior is abstention.

### Memory lifecycle
- Active, superseded, revoked, and deleted records.
- Repeated candidate extraction and deduplication.
- Conflicting candidate facts that must remain separate.
- Explicit correction targeting the correct memory.
- Wrong-target correction attempts.
- No reintroduction of deleted/revoked content through caches or derived summaries.

### Context assembly
- Small and large budgets.
- Required metadata survives selection.
- Relevant low-lexical-overlap evidence is not dropped without a measured reason.
- Contradictions are surfaced rather than silently merged.
- Selected and omitted items have explainable reasons.
- Exact budget compliance.

### Provider egress
- Consent absent, expired, mismatched, or revoked.
- Sensitive and unrelated memory exclusion.
- Payload changed after preflight.
- Serialization changes that add fields after audit.
- Local versus remote destination policy.
- Credentials and secrets never appear in logs or diagnostics.

### Answer grounding
- Correct use of relevant evidence.
- Respect for explicit correction.
- Conflict acknowledgement.
- Abstention when no reliable evidence exists.
- No invented memory claims.
- Stylistic differences are not mislabeled as factual grounding failures.

## 3. Metrics

Use only metrics appropriate to the available labels:

- Recall@k: whether labeled relevant memories appear among the top k.
- MRR: how early the first relevant item appears.
- Precision@k / nDCG@k when graded relevance labels are available.
- Extraction precision and recall against annotated candidate memories.
- Lifecycle exclusion rate for revoked/deleted/wrong-scope records.
- Context evidence coverage under a fixed budget.
- Unsupported assertion rate and correction-respect rate.
- End-to-end success rate across complete multi-turn scenarios.
- p50/p95 latency and resource cost for candidate and baseline implementations.

Do not invent numeric confidence values or set arbitrary pass thresholds without a rationale. For hard safety fixtures (such as revoked memory or unauthorized payload), expected exclusion is 100%; any leak blocks promotion.

## 4. Experimental protocol

1. Freeze and identify the baseline commit and configuration.
2. Version the fixture dataset and labels.
3. Run baseline and candidate on the same cases and resource limits.
4. Separate deterministic tests from model-dependent tests.
5. For model-dependent tests, record provider/model/version, prompt/config hash, and whether network access was used.
6. Inspect failures by case ID; do not report only aggregate scores.
7. Include at least one end-to-end test that inspects the exact final serialized provider request.
8. Record regressions, latency, and resource costs.
9. Keep candidate isolated if results are inconclusive.
10. Promote only after required safety and compatibility checks pass.

## 5. Release gates

A candidate may be considered for integration only when:
- its contract is stable and documented;
- unit tests cover success, edge, abstention, and failure cases;
- integration tests verify the actual composition path;
- no hard safety regression exists;
- quality improvement is reproducible or a documented safety/reliability improvement justifies it;
- performance/resource cost is acceptable;
- rollback or fallback behavior is demonstrated;
- integration can be done without a broad unrelated refactor.

## 6. Report template

For each candidate:
- Hypothesis:
- Baseline commit/config:
- Candidate version:
- Dataset/fixture version:
- Commands and environment:
- Baseline results:
- Candidate results:
- Case-level failures:
- Safety regression check:
- Latency/resource comparison:
- Decision: keep / revise / reject / defer
- Rationale:
