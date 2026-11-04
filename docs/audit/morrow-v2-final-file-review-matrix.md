# Morrow V2 Final File Review Matrix (Issue #53)

- Reviewed HEAD: `a8458898ab8936c122aed3ba76030339fbfd94e5` (pushed)
- Final code SHA: `d07b3f4b951fab2bd522413c789850055a49fe61`
- Base: `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- PR #54 head: `a8458898ab8936c122aed3ba76030339fbfd94e5`
- Current CI: run `41862065143`, head `a845889`, 4/4 PASS, PR `CLEAN`
- Prior code-SHA CI: run `41859315790`, head `d07b3f4`, 4/4 PASS
- Diff vs base: 169 files changed, 21080 insertions, 493 deletions.

Legend: **PASS** = reviewed and consistent with the issue; **PASS+P3** = reviewed with a non-blocking residual; **BLOCKING** = merge blocker; **HISTORICAL** = retained prior-stage evidence, not final-SHA proof.

## 1. Production files (every production file changed vs base)

| # | File | Change reviewed | Conclusion |
| --- | --- | --- | --- |
| 1 | `.github/workflows/ci.yml` | Product-path is Windows-only; package job no longer disables sandbox; product-path artifact upload. | PASS — final HEAD CI 4/4 PASS; Windows product-path step passed. |
| 2 | `evals/provider-multi-source/run.ts` | Records `failure.httpStatus`, latency, attempts, `streamDeltaCount`, `exitCode`. | PASS+P3 — blocked runs now carry HTTP 403/latency/attempts/deltas/exit; evidence commit is `c1f4450`, not final `d07b3f4` (provider code unchanged after `c1f4450`). |
| 3 | `evals/stage-2/ablation/run.ts` | Pending repository event-log wiring. | PASS — eval stack compiles/runs. |
| 4 | `evals/stage-2/runner/cli.ts` | Same wiring. | PASS — no behavior change. |
| 5 | `evals/stage-3/runner/harness.ts` | Event-log wiring and real git metadata. | PASS — harness matches production wiring. |
| 6 | `evals/stage-3/shared/real-provider.ts` | Event-log wiring for goals/readings/pending. | PASS — no secret handling change. |
| 7 | `evals/stage-4a/run.ts` | Uses `readGitMetadata` instead of hard-coded branch. | PASS — evidence identity more honest. |
| 8 | `evals/stage-5/run.ts` | Uses `readGitMetadata` instead of hard-coded branch. | PASS — evidence identity more honest. |
| 9 | `package.json` | Adds `smoke:product-path` and `eval:provider-multi-source`. | PASS — scripts resolve and run. |
| 10 | `scripts/product-path-smoke.mjs` | Async IIFE seed; awaited final snapshot; provider-panel readiness; graceful `window.close()`; baseline identity/content continuity; Windows CI. | PASS — current HEAD product-path artifact `20261104T155831Z-899f5cb0` PASS 18/18; committed `154241` PASS matches prior code-SHA artifact. |
| 11 | `src/app/companion-service.ts` | Provider lifecycle, health invalidation, shared resolver, discovery consent/policy, secret transaction, `httpStatus` propagation. | PASS — P1-1/P1-2/P1-4/P1-5 and service-side P1-3/P2-1 closed; P3 consent action not stored. |
| 12 | `src/app/index.ts` | Production startup composition, pending/reflection wiring, consent dialog action label. | PASS+P3 — wiring correct; custom remote profiles still see DeepSeek-specific consent title/pricing (`:98-124`). |
| 13 | `src/app/ipc.ts` | Profile CRUD/discovery handlers, generic provider errors, schema-upgrade mapping, pending decision result. | PASS — trusted-sender gate, parsers and error mapping reviewed; no secret in responses. |
| 14 | `src/app/startup-composition.ts` | Production reflection graph and bounded startup outcome. | PASS — used by `index.ts` and tests; no auto-executed actions. |
| 15 | `src/cognition/pending-items.ts` | Stage 4 decision API, concern identity, `runBounded` error preservation. | PASS — transaction-backed decisions and tests. |
| 16 | `src/cognition/reflection-routing.ts` | Transactional finding ingestion, failure isolation, `recoverUnrouted`. | PASS — tests cover routing/recovery; no external egress. |
| 17 | `src/evaluation/git-metadata.ts` | Real git identity helper for evidence. | PASS+P3 — honest branch/commit/tree; `MORROW_EVAL_SHA` can override the commit. |
| 18 | `src/motivation/companion-goal.ts` | Candidate accept/reject transaction, source check, required audit. | PASS — goal creation only on explicit accept; audit failure rolls back. |
| 19 | `src/persistence/cognitive-context-repository.ts` | Pending decision transaction, route terminal state, legacy route convergence. | PASS — item/route/audit commit together; tests pass. |
| 20 | `src/persistence/database.ts` | `SchemaIdentityError` fail-closed open; other migration failures degrade. | PASS+P3 — foreign identity fails closed; degraded-open path not tested. |
| 21 | `src/persistence/intent-reading-repository.ts` | Intent withdrawal closes open questions via `resolveSystem`. | PASS — failure leaves items open and records the failure. |
| 22 | `src/persistence/migrations.ts` | v49 `provider-multi-source-profiles-final`, Provider v48 bridge, v48 structure checks, 40-char id CHECK. | PASS+P3 — 17/17 independent probes; 41–64-char Provider v48 id fails closed without data loss. |
| 23 | `src/preload/index.ts` | Typed bridge additions for profile CRUD/discovery and companion goals. | PASS — no secret exposure; channel names match. |
| 24 | `src/providers/endpoint-resolver.ts` | Single chat/models URL resolver with trailing-slash/path-prefix normalization. | PASS — 8/8 resolver probes; no duplicate `/v1`/`/chat/completions`. |
| 25 | `src/providers/endpoint-security.ts` | Endpoint classification, private-address parsing, DNS policy, masking/digest. | PASS — 30/30 classification and 10/10 private-address probes; redirect probe clean. |
| 26 | `src/providers/openai-compatible.ts` | Adapter uses resolver, request-time policy for custom proxy, `redirect:'error'`, bounded retry, `httpStatus` on errors. | PASS+P3 — no auth on blocked requests; full error body read before 4 KB slice. |
| 27 | `src/providers/provider-policy.ts` | Adds `model-discovery` action; consent/payload assessment. | PASS+P3 — action in preview, not consent record; hash/endpoint binding prevents practical reuse. |
| 28 | `src/providers/provider-registry.ts` | Profile validation, 40-char id, official/local/custom rules, private-network rejection. | PASS+P3 — save/IPC/UI reject official overrides; request-time validator does not reject an official `endpointPath` on a pre-existing row. |
| 29 | `src/renderer/index.html` | Provider profile form, goal candidates, pending feedback, endpoint-path help. | PASS — labels/help match resolver semantics; no inline script. |
| 30 | `src/renderer/src/goal-candidates-ui.ts` | Candidate/formal goal rendering and accept/reject bridge calls. | PASS — uses `textContent`, request guards, no HTML injection. |
| 31 | `src/renderer/src/goals-ui.ts` | Exports `refreshGoalViews`. | PASS — no behavior change. |
| 32 | `src/renderer/src/main.ts` | Initializes goal-candidate and provider-profile panels. | PASS — init order after shell. |
| 33 | `src/renderer/src/pending-ui.ts` | Discriminated decision result feedback; disables buttons during request. | PASS — conflict/not-found shown, not treated as success. |
| 34 | `src/renderer/src/provider-profiles-ui.ts` | Profile list/create/edit/test/discover/default/delete UI; key-cleared prompt. | PASS — no key display; official edit/delete disabled and now covered by `tests/provider-profiles-ui.test.ts:143`. |
| 35 | `src/self-model/reflection-concern.ts` | Concern normalization/key/digest identity. | PASS — conservative normalization; no user text stored in pending detail. |
| 36 | `src/self-model/reflection-mapping.ts` | Concern kinds dedupe by statement; evidence-consuming kinds keep full identity. | PASS — tests cover both branches. |
| 37 | `src/self-model/reflection-service.ts` | Adds `open_question` finding from one-conversation knowledge gaps. | PASS — reads only Morrow’s own gap events; findings local. |
| 38 | `src/shared/companion.ts` | Provider profile/health/capability/types and discovery result. | PASS — types match DB/IPC/UI. |
| 39 | `src/shared/contracts.ts` | New IPC channels, profile types, pending decision result, companion goals bridge. | PASS — no removed channel still referenced; `tsc` clean. |
| 40 | `src/shared/errors.ts` | `ApplicationError` carries `httpStatus` (`:27-33`). | PASS — adapter/discovery/health/eval all use it. |
| 41 | `src/shared/validation.ts` | Provider profile parsers, 40-char id, official rejection at IPC, legacy provider parser. | PASS — 40/41 boundary tested; raw NUL in the API-key regex matches the existing control-character convention. |

## 2. Test files (grouped; every changed test/helper listed)

| Group | Files | Conclusion |
| --- | --- | --- |
| New provider integration | `src/app/provider-multi-source.integration.test.ts` (18), `src/app/provider-multi-source-ipc.integration.test.ts` (2), `src/app/provider-continuity.integration.test.ts` (1), `src/app/provider-manual-chat.integration.test.ts` (modified) | PASS — P1/P2 service/IPC/continuity coverage; real OS store is covered by product-path CI, not this group. |
| New provider unit tests | `src/providers/endpoint-resolver.test.ts` (5), `src/providers/endpoint-security.test.ts` (7) | PASS — required boundary table covered; redirect covered by adapter code/probe. |
| Stage 4 new integration | `src/app/stage4-goal-candidate-e2e.test.ts`, `stage4-outbox-reflection.integration.test.ts`, `stage4-reflection-producer.integration.test.ts`, `stage4-restart-consistency.integration.test.ts`, `stage4-startup-composition.integration.test.ts` | PASS — full suite 1129 tests; no skip/weakening. |
| Stage 4 new unit/UI | `src/app/pending-schema-gate.test.ts` (1), `src/persistence/intent-reading-pending-closure.test.ts`, `src/self-model/reflection-concern.test.ts`, `src/self-model/reflection-mapping.test.ts`, `src/evaluation/git-metadata.test.ts`, `tests/goal-candidates-ui.test.ts`, `tests/pending-ui.test.ts`, `tests/provider-profiles-ui.test.ts` | PASS — schema gate, closure, concern identity, git metadata, decision UI and official-profile disabled test covered. |
| Migration tests | `src/persistence/migrations.test.ts` (23 tests; v49 group 6) | PASS — release/Stage4/Provider/bridge/repeat/rollback/40-41 boundary; no Provider v48 41-char existing-row test. |
| Existing test wiring changes | `src/app/b1-strategy-payload.integration.test.ts`, `src/app/b4-recovery.integration.test.ts`, `src/app/b5-reflection-safety.integration.test.ts`, `src/app/cognitive-continuity-phase24.integration.test.ts`, `src/app/interest-payload-invalidation.integration.test.ts`, `src/app/turn-context-fidelity.integration.test.ts`, `src/app/turn-state-sequence.integration.test.ts`, `src/cognition/pending-items.test.ts`, `src/cognition/reflection-routing.test.ts`, `src/motivation/companion-goal.test.ts`, `src/motivation/goal-lifecycle.test.ts`, `tests/b4-child-crash.test.ts`, `tests/c1-mainchain.test.ts`, `tests/correction-round.test.ts`, `tests/helpers/b4-crash-child.ts`, `tests/helpers/companion-stack.ts` | PASS — constructor/wiring changes only; no assertions relaxed. |
| Existing IPC test changes | `src/app/ipc.test.ts` | PASS — profile/pending/companion-goal handlers and error mapping covered. |

## 3. Docs (grouped)

| Group | Files | Conclusion |
| --- | --- | --- |
| Final closure docs | `docs/audit/morrow-v2-final-closure-baseline.md`, `docs/architecture/morrow-v2-final-integrated-architecture.md`, `docs/architecture/morrow-v2-final-migration-and-recovery.md`, `docs/testing/morrow-v2-final-acceptance-matrix.md`, `docs/reports/morrow-v2-final-delivery-report.md`, `docs/reports/morrow-v2-final-evidence-index.md`, `docs/reports/morrow-v2-final-work-log.md` | PASS with **P3 polish** — SHAs/base/version/test counts/status PARTIAL match; docs link the prior code-SHA CI run (`41859315790`), not the final HEAD run (`41862065143`); real-provider runs are at `c1f4450`; acceptance 1.9/5.3 and 4.4 need updates; baseline 403 string unsupported. |
| Historical Stage 4/provider docs | `docs/audit/provider-multi-source-baseline-audit.md`, `docs/architecture/provider-multi-source-architecture.md`, `docs/architecture/provider-security-and-consent.md`, `docs/architecture/pr-40-audit-findings-runtime-and-state-machine.md`, `docs/reports/pr-40-*`, `docs/reports/provider-multi-source-*`, `docs/reports/stage-4-*`, `docs/testing/pr-40-*`, `docs/testing/provider-multi-source-*`, `docs/testing/stage-4-*` | HISTORICAL — retained with their own SHAs; not final-SHA evidence. No historical evidence rewritten. |
| General schema index | `docs/architecture/database-schema.md` | PASS — updated to v49 with the v49 row and v48/v49 invariants. |

## 4. Evidence / results (grouped)

| Group | Files | Conclusion |
| --- | --- | --- |
| Product-path PASS (committed) | `evals/morrow-v2-final/results/20261104T154241Z-1430f856.json`, transcript | PASS — 18/18 checks, Electron 44.9.3, sandbox enabled, OS secret digests, restart/clear/rekey/delete; byte-identical to prior code-SHA CI artifact. |
| Product-path PASS (current HEAD CI) | `20261104T155831Z-899f5cb0.json` in run `41862065143` artifact | PASS — 18/18 checks, same code/script; not committed, but proves final HEAD. |
| Product-path local FAILED | `20261104T124128Z-125af6f6.json` (`2147483651`), `20261104T124142Z-933adad0.json` (`3221225477`), transcripts | PASS for honesty — FAILED recorded, not PASS; local host Electron crash remains. |
| Real provider current | `20261104T135205Z-75b01260.json` + transcript; `20261104T135210Z-abf69f16.json` + transcript | PASS for honesty — both `BLOCKED_QUOTA`, HTTP 403/latency/attempts/deltas/exit, no key/Authorization/body; commit `c1f4450` (P3 docs). |
| Real provider intermediate | `20261104T135122Z-61925d68.json`, `20261104T135128Z-4b52e060.json` + transcripts | HISTORICAL — `bebfde6`/`c1f4450` working-tree runs; `BLOCKED_QUOTA`; not final code-SHA evidence. |
| Real provider earlier | `20261104T123748Z-5fc34109.json`, `20261104T123809Z-02e942cb.json`, `20261104T114033Z-10e4a3e2.json` + transcripts | HISTORICAL — prior runs; honest BLOCKED_QUOTA/BLOCKED_NO_SECRET; not final-SHA evidence. |
| Stage 3/4/5 eval results added | `evals/stage-3/results/*`, `evals/stage-4a/results/*`, `evals/stage-5/results/*`, `evals/stage-4-companion-confirmation/results/*`, `evals/pr-40-audit-findings/results/*` | HISTORICAL — prior-stage runs; not re-run for this review and not treated as final closure proof. |

## 5. Matrix summary

- 41 production files reviewed individually.
- No blocking finding remains. All Issue #53 §三 P1/P2 items are CLOSED:
  - P1-1 health/capability invalidation, P1-2 shared endpoint resolver, P1-3 official profile at service/IPC/UI, P1-4 secret binding with real OS SafeStorage evidence, P1-5 discovery consent/policy.
  - P2-1 40-char id across registry/validation/DB/OS store, P2-2 endpoint security boundaries, P2-3 error/path semantics.
- Migration: 17/17 independent checks; 41–64-char Provider v48 id fails closed without data loss (P3).
- Security: 73/73 independent assertions; no real provider key or Authorization token in tracked files or evidence.
- Product path: Windows CI PASS 18/18 on both the final code SHA and the final docs-only HEAD; local host crash remains honestly recorded.
- Remaining backlog: P3 docs/evidence polish, external provider quota/local-service blocks, and hardening items that do not affect safety, data integrity or the core companion experience.

**Verdict: PASS_WITH_NON_BLOCKING_BACKLOG.**
