# Mainline asset inventory (Issue #85)

- Repository: `ve766/morrow-ai-companion-v2`
- Baseline main: `8b207b7d7b80b91ed4369d02fd6ef7e170b81133`
- Integration branch: `integration/morrow-mainline-asset-convergence-20261110`
- Product line integrated: `fix/morrow-p0-evidence-deletion-closure-20261110` (375 commits ahead of main, main is its ancestor)
- Stage 1 code SHA: `def61eab532e88bfaf8e0a3096176d66d65cc84f` (P0 line + C1–C4 remediation)
- Branch count: 51 refs (50 non-main + main). Every ref is in the table below; the machine-readable matrix is `branch-inheritance-matrix.csv`.

## 1. Branch inventory and disposition

| Branch | Tip | Relation to product line | Ahead main | Unique vs product | PR | Decision |
| --- | --- | --- | ---: | ---: | --- | --- |
| `audit/pr-40-independent-review` | `99cea8db4415` | DIVERGED | 237 | 1 | #46:OPEN | RESEARCH_ONLY |
| `audit/pr-40-repair-independent-review` | `27a12762921c` | DIVERGED | 250 | 7 | #49:OPEN | RESEARCH_ONLY |
| `audit/provider-multi-source-independent-review` | `626a3cf4b80b` | DIVERGED | 241 | 5 | #52:OPEN | RESEARCH_ONLY |
| `chore/phase-1-engineering-consistency` | `12f83e19172d` | DIVERGED | 6 | 6 | #2:OPEN | RESEARCH_ONLY |
| `docs/project-state-baseline` | `f55ef0ab518e` | DIVERGED | 4 | 4 | #5:OPEN | RESEARCH_ONLY |
| `feat/ai-life-core-upgrade-20261107` | `b63c99836100` | DIVERGED | 338 | 2 | #64:OPEN | REPLACED_WITH_PROOF |
| `feat/cognitive-loop-v1-phase2` | `d8cdfba0588a` | ANCESTOR_OF_P0 | 35 | 0 | #12:OPEN | INHERITED_IN_LINEAGE |
| `feat/cognitive-loop-v1-phase2-3-reliability` | `872367ccfddb` | ANCESTOR_OF_P0 | 46 | 0 | #13:OPEN | INHERITED_IN_LINEAGE |
| `feat/cognitive-loop-v1-phase2-4-continuity` | `d858cd91a24a` | ANCESTOR_OF_P0 | 60 | 0 | - | INHERITED_IN_LINEAGE |
| `feat/cognitive-loop-v1-slice1` | `e76c1d2bd2bb` | ANCESTOR_OF_P0 | 4 | 0 | #9:OPEN | INHERITED_IN_LINEAGE |
| `feat/cognitive-loop-v1-slice2` | `c5696a944d78` | ANCESTOR_OF_P0 | 7 | 0 | #10:OPEN | INHERITED_IN_LINEAGE |
| `feat/cognitive-loop-v1-slice2-2` | `d1d22aed34a1` | ANCESTOR_OF_P0 | 9 | 0 | #11:OPEN | INHERITED_IN_LINEAGE |
| `feat/cognitive-operators-algorithm-v2` | `8b207b7d7b80` | ANCESTOR_OF_P0 | 0 | 0 | - | INHERITED_IN_LINEAGE |
| `feat/morrow-v2-final-closure` | `68468cfca95b` | ANCESTOR_OF_P0 | 331 | 0 | #54:OPEN | INHERITED_IN_LINEAGE |
| `feat/morrow-v2-product-closure-20261107` | `e1d85137b64f` | ANCESTOR_OF_P0 | 336 | 0 | #62:OPEN | INHERITED_IN_LINEAGE |
| `feat/morrow-v2-product-complete-20261106` | `68468cfca95b` | ANCESTOR_OF_P0 | 331 | 0 | - | INHERITED_IN_LINEAGE |
| `feat/personality-affect-integration-20261108` | `83dab6ad8b2a` | ANCESTOR_OF_P0 | 347 | 0 | #73:OPEN | INHERITED_IN_LINEAGE |
| `feat/phase-2-companion-core` | `e252d062581b` | DIVERGED | 46 | 46 | #3:OPEN | PORT_AND_ADAPT |
| `feat/phase-2.2-memory-reliability` | `25e80004256a` | DIVERGED | 105 | 105 | #4:OPEN | PORT_AND_ADAPT |
| `feat/provider-multi-source-foundation` | `326e68adfd1b` | ANCESTOR_OF_P0 | 238 | 0 | #51:OPEN | INHERITED_IN_LINEAGE |
| `feat/stage-2-continuous-companion-cognition` | `205bfb096fba` | DIVERGED | 62 | 1 | - | PORT_AND_ADAPT |
| `feat/stage-2-delivery-hardening` | `84670792fa08` | ANCESTOR_OF_P0 | 137 | 0 | #15:OPEN | INHERITED_IN_LINEAGE |
| `feat/stage-3-long-term-companion` | `548d40e48465` | ANCESTOR_OF_P0 | 197 | 0 | #19:OPEN | INHERITED_IN_LINEAGE |
| `feat/stage-4-companion-confirmation-closure` | `4284cb1b6856` | ANCESTOR_OF_P0 | 244 | 0 | #40:OPEN | INHERITED_IN_LINEAGE |
| `feat/stage-4a-companion-continuity` | `57d2ff39ee1e` | ANCESTOR_OF_P0 | 212 | 0 | #24:OPEN | INHERITED_IN_LINEAGE |
| `feat/stage-5-relational-presence` | `a889ca819ed4` | ANCESTOR_OF_P0 | 216 | 0 | #26:OPEN | INHERITED_IN_LINEAGE |
| `feat/stage-6-appraisal-engine` | `b4d3bd408de9` | ANCESTOR_OF_P0 | 225 | 0 | - | INHERITED_IN_LINEAGE |
| `feat/whole-project-return-to-core-20261107` | `02b6938a3947` | ANCESTOR_OF_P0 | 338 | 0 | #66:OPEN | INHERITED_IN_LINEAGE |
| `feature/algorithm-v2-phase-a` | `a6f9e0be683b` | DIVERGED | 19 | 19 | #1:OPEN | PORT_AND_ADAPT |
| `fix/audit-driven-companion-remediation-20261109` | `094ca2cf35b8` | ANCESTOR_OF_P0 | 361 | 0 | #80:OPEN | INHERITED_IN_LINEAGE |
| `fix/chat-consent-latency-20261108` | `b9988861e49f` | ANCESTOR_OF_P0 | 342 | 0 | #70:OPEN | INHERITED_IN_LINEAGE |
| `fix/core-subjectivity-final-closure-20261109` | `1b7ba085fba4` | ANCESTOR_OF_P0 | 357 | 0 | #77:OPEN | INHERITED_IN_LINEAGE |
| `fix/memory-reliability-v0.1` | `dca6486af4d1` | DIVERGED | 117 | 117 | #6:OPEN | PORT_AND_ADAPT |
| `fix/morrow-core-cognitive-closure-20261108` | `efdbf52a25e8` | ANCESTOR_OF_P0 | 339 | 0 | #68:OPEN | INHERITED_IN_LINEAGE |
| `fix/morrow-p0-evidence-deletion-closure-20261110` | `4bf63efaa786` | SAME_AS_P0 | 375 | 0 | #84:OPEN | MERGE_AS_IS |
| `fix/morrow-project-wide-final-convergence-20261110` | `dc2743d7a387` | ANCESTOR_OF_P0 | 370 | 0 | #82:OPEN | INHERITED_IN_LINEAGE |
| `fix/phase-2.2.10-memory-trust-hardening` | `60a88b854646` | DIVERGED | 134 | 134 | #8:OPEN | PORT_AND_ADAPT |
| `fix/phase-2.2.9-memory-reliability-hardening` | `34cb6605931f` | DIVERGED | 120 | 120 | #7:OPEN | PORT_AND_ADAPT |
| `fix/pr-40-audit-findings` | `bb9e409c7b4f` | ANCESTOR_OF_P0 | 243 | 0 | #48:MERGED | INHERITED_IN_LINEAGE |
| `fix/stage-5-final-closeout` | `b4d3bd408de9` | ANCESTOR_OF_P0 | 225 | 0 | #30:OPEN | INHERITED_IN_LINEAGE |
| `fix/stage-5-review-findings` | `9d54c6e02dea` | ANCESTOR_OF_P0 | 221 | 0 | #28:OPEN | INHERITED_IN_LINEAGE |
| `fix/whole-product-subject-closure-20261108` | `45b067c036a6` | ANCESTOR_OF_P0 | 354 | 0 | #75:OPEN | INHERITED_IN_LINEAGE |
| `infra/shared-real-model-test-contract` | `5bb221ead8bd` | DIVERGED | 2 | 2 | #21:OPEN | TEST_ONLY |
| `integration/morrow-mainline-asset-convergence-20261110` | `8b207b7d7b80` | ANCESTOR_OF_P0 | 0 | 0 | - | BASELINE |
| `main` | `8b207b7d7b80` | ANCESTOR_OF_P0 | 0 | 0 | - | BASELINE |
| `release/morrow-v2-final-delivery` | `3812b185398c` | ANCESTOR_OF_P0 | 228 | 0 | #35:OPEN | INHERITED_IN_LINEAGE |
| `report/project-work-report-2026-10-26` | `89f4397d5ae9` | DIVERGED | 1 | 1 | - | RESEARCH_ONLY |
| `reports/algorithm-v2` | `eeeb6b42bfb0` | DIVERGED | 1 | 1 | - | RESEARCH_ONLY |
| `research/cognitive-update-pack-v0.1` | `be27778adbf9` | DIVERGED | 16 | 16 | - | RESEARCH_ONLY |
| `research/glm-morrow-rd-preparation-20261103` | `f5a4273a6bb0` | DIVERGED | 229 | 1 | #41:OPEN | RESEARCH_ONLY |
| `research/morrow-agent-capability-architecture-v1` | `efa4be9c8015` | DIVERGED | 231 | 3 | #38:OPEN | RESEARCH_ONLY |

## 2. What “inherited in lineage” means here

For an ancestor branch, `git rev-list product..branch` is 0: every commit is in the product line. That is a commit-graph proof, not a runtime proof. Stage 1 sampled the production call chain for Stage 2–6, Provider, UI and the P0 lifecycle in `src/app/companion-service.ts`, `src/app/index.ts`, `src/self-model/*`, `src/affective-state/*`, `src/persistence/migrations.ts` and the integration suite. Each branch is marked `INHERITED_IN_LINEAGE`; stages 3–5 still owe a file-level runtime map for PR #64/Stage 3–6 assets.

## 3. Key non-ancestor assets

| Asset | Source | Unique commits | Paths | Decision and reason |
| --- | --- | ---: | --- | --- |
| Semantic/hybrid retrieval (PR #1 line) | `feature/algorithm-v2-phase-a` `a6f9e0be` | 19 | `src/memory/retrieval/*`, `src/evaluation/retrieval-*`, `src/app/*retrieval*` | **PORT_AND_ADAPT** in stage 2. Real encoder is optional `@huggingface/transformers`, lexical fallback, benchmark harness. Not merged in stage 1 because the current assembler is a different implementation and needs a controlled candidate-channel port. |
| Early memory reliability/trust | `feat/phase-2.2-memory-reliability` `25e8000`; `fix/memory-reliability-v0.1` `dca6486`; `fix/phase-2.2.9` `34cb660`; `fix/phase-2.2.10` `60a88b8` | 105–134 | retrieval admission, correction target binding, provenance, migration fixtures | **PORT_AND_ADAPT** in stage 2. Compare each fix against current `MemoryService`/`ContextAssembler`; do not fork a second memory implementation. |
| Structured self-model + persistent consent | `feat/ai-life-core-upgrade-20261107` `8667e16` | 2 | `src/self-model/self-model-state.ts`, provider consent scopes | **REPLACED_WITH_PROOF** pending stage 3 equivalence check: current line already has `self_model_states` (migration v53 area) and `provider_consent_grants`; no duplicate service was added. |
| Turn-context schema 2 fields | `feat/stage-2-continuous-companion-cognition` `205bfb0` | 1 | `src/cognition/turn-context.ts`, repository compatibility | **PORT_AND_ADAPT** in stage 3. Current line has schema 2 but a simpler uncertainty shape; reconcile field semantics rather than overwrite. |
| PR #40 audit/repair line | `audit/pr-40-*`, `fix/pr-40-audit-findings` | 1–7 | `docs/audit/*`, eval review JSON | **RESEARCH_ONLY** (PR #48 MERGED into PR #40 branch, not main; PR #49 is DO_NOT_MERGE). The code repair is already in the product lineage; audit conclusions are evidence, not runtime. |
| Provider multi-source | `feat/provider-multi-source-foundation` `326e68a` | 0 vs product | `src/providers/*`, profiles/consent | **INHERITED_IN_LINEAGE**; loopback/contracts remain, real cloud is BLOCKED_NO_SECRET. |
| Agent research | `research/morrow-agent-capability-architecture-v1`, `research/glm-*` | docs only | architecture reports | **RESEARCH_ONLY**; no Agent runtime in this task. |
| Shared real-model test contract | `infra/shared-real-model-test-contract` | 2 | non-secret env template, contract | **TEST_ONLY**; can be ported when a real secret exists. |

## 4. Stage-1 integration performed

1. Fetched every remote head and recorded its tip SHA (51 refs).
2. Fast-forwarded the integration branch from main `8b207b7` to the product tip `4bf63ef`; main is an ancestor, so no merge conflict or rewritten commit was needed. This is the only “merge” performed in stage 1.
3. Applied C1–C4 remediation on top of the integrated line at `def61ea`: outbox drain lock, DB-error propagation, current-node owner/correlation agreement, recursive memory lineage. Added fault tests.
4. No divergent branch was merged wholesale. The remaining unique code lines are listed as stage 2/3 port work, not as inherited.

## 5. Missing/blocked references

- `integration/...` branch itself is the local execution ref; its remote currently equals main (8b207b7) until this branch is pushed.
- PR #48 is MERGED only into `feat/stage-4-companion-confirmation-closure`; it is not evidence of main integration. PR #49 is OPEN and its audit verdict is not a merge approval.
- No branch was deleted, closed or force-pushed.
