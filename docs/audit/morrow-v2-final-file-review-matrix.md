# Morrow V2 Final File Review Matrix (Issue #53)

- Reviewed working-tree HEAD: `bebfde60fcabc0f9d22cf5be5752c24da4129356`
- Implementation SHA: `d9b28aecb47ff136bbdbda492c5be20ffc53bbd4`
- Acceptance/evidence commit: `28665dfbcb724749ec56df0b8cfdb80578a3f84c`
- Base: `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- PR #54 head: `28665df` (the local docs commit `bebfde6` is not in the PR)
- Diff: 157 files changed vs base (20130 insertions, 484 deletions); 150 files at the PR head.

Legend: **PASS** = reviewed and consistent with the issue; **PASS+P3** = reviewed with a non-blocking residual; **BLOCKING** = merge blocker; **HISTORICAL** = retained prior-stage evidence, not final-SHA proof.

## 1. Production files (every production file changed vs base)

| # | File | Change reviewed | Conclusion |
| --- | --- | --- | --- |
| 1 | `.github/workflows/ci.yml` | Adds Electron product-path step/artifact upload and `windows-package-smoke`; renames the persistence step. | **BLOCKING** — product-path step fails on Ubuntu and Windows; package smoke fails at the seed smoke with `3221225477`; Windows upgrade job is persistence-only. |
| 2 | `package.json` | Adds `smoke:product-path` and `eval:provider-multi-source` scripts. | PASS — scripts resolve and run; no dependency/version changes. |
| 3 | `scripts/product-path-smoke.mjs` | New renderer DOM → bridge → IPC → SQLite → OS SafeStorage acceptance; restart/continuity checks. | **BLOCKING** — `seedScript` (`:230`) has top-level `await` and is evaluated at `:352` without an async wrapper; both CI platforms fail with SyntaxError before check 1. |
| 4 | `src/app/companion-service.ts` | Provider profile lifecycle, health/capability invalidation, shared endpoint resolver, discovery consent/policy, secret transaction, legacy provider save. | PASS+P3 — P1-1/P1-2/P1-5 and service-side P1-3/P1-4/P2-1 are closed; P1-3 lacks a UI-layer assertion and P1-4 real OS path is unverified; P3 consent action not stored. |
| 5 | `src/app/index.ts` | Production startup composition, pending/reflection wiring, consent dialog action label, provider consent copy. | PASS+P3 — wiring is correct; custom remote profiles still see DeepSeek-specific consent title/pricing text (`:98-124`). |
| 6 | `src/app/ipc.ts` | Profile list/save/delete/default/discover handlers, generic provider error messages, schema-upgrade mapping, pending decision result. | PASS — trusted-sender gate, parsers and error mapping reviewed; no secret in responses. |
| 7 | `src/app/startup-composition.ts` | New production reflection dependency graph and bounded startup outcome. | PASS — used by `index.ts` and tests; no auto-executed actions. |
| 8 | `src/cognition/pending-items.ts` | Stage 4 decision API, concern identity, `runBounded` error preservation. | PASS — transaction-backed decisions and tests; no bare status update path left. |
| 9 | `src/cognition/reflection-routing.ts` | Transactional finding ingestion, failure isolation, `recoverUnrouted`, lifecycle events. | PASS — tests cover routing/recovery; no external egress. |
| 10 | `src/evaluation/git-metadata.ts` | New real git identity helper for evidence. | PASS+P3 — reports branch/commit/tree honestly; `MORROW_EVAL_SHA` can override the commit for future runs. |
| 11 | `src/motivation/companion-goal.ts` | Candidate accept/reject decision transaction, source check, required audit. | PASS — goal creation only on explicit accept; audit failure rolls back. |
| 12 | `src/persistence/cognitive-context-repository.ts` | Pending decision transaction, route terminal state, legacy route convergence. | PASS — item/route/audit commit together; tests pass. |
| 13 | `src/persistence/database.ts` | `SchemaIdentityError` fail-closed open; other migration failures still degrade to the recorded version. | PASS+P3 — foreign identity fails closed; degraded-open observability for non-identity v49 failure is untested. |
| 14 | `src/persistence/intent-reading-repository.ts` | Intent withdrawal closes open questions through `resolveSystem`. | PASS — failure leaves items open and records the failure; no bare status update. |
| 15 | `src/persistence/migrations.ts` | v49 `provider-multi-source-profiles-final`, Provider v48 bridge, v48 structure checks, 40-char id CHECK. | PASS+P3 — 31/31 independent probes; 41–64-char Provider v48 id fails closed without data loss (manual recovery). |
| 16 | `src/preload/index.ts` | Typed bridge additions for profile CRUD/discovery and companion goals. | PASS — no secret exposure; IPC channel names match. |
| 17 | `src/providers/endpoint-resolver.ts` | Single chat/models URL resolver with trailing-slash and path-prefix normalization. | PASS — 13/13 resolver probes; no duplicate `/v1`/`/chat/completions`. |
| 18 | `src/providers/endpoint-security.ts` | Endpoint classification, private-address parsing, DNS policy, masking/digest. | PASS — 32/32 classification and 12/12 private-address probes; redirect probe clean. |
| 19 | `src/providers/openai-compatible.ts` | Adapter uses resolver, request-time policy for custom proxy, `redirect:'error'`, bounded retry and error classification. | PASS+P3 — no auth on blocked requests; full error body is read before the 4 KB slice. |
| 20 | `src/providers/provider-policy.ts` | Adds `model-discovery` action; consent/payload assessment unchanged. | PASS+P3 — action is in the preview, not the consent record; hash/endpoint binding prevents practical reuse. |
| 21 | `src/providers/provider-registry.ts` | Profile validation, 40-char id, official/local/custom rules, private-network rejection. | PASS+P3 — save/IPC/UI reject official overrides; request-time validator does not reject an official `endpointPath` on a pre-existing row. |
| 22 | `src/renderer/index.html` | Provider profile form, goal candidate section, pending feedback, endpoint-path help. | PASS — labels/help match resolver semantics; no inline script. |
| 23 | `src/renderer/src/goal-candidates-ui.ts` | Candidate/formal goal rendering and accept/reject bridge calls. | PASS — uses `textContent`, request guards, no HTML injection. |
| 24 | `src/renderer/src/goals-ui.ts` | Exports `refreshGoalViews` for candidate UI. | PASS — no behavior change. |
| 25 | `src/renderer/src/main.ts` | Initializes goal-candidate and provider-profile panels. | PASS — init order is after shell; no duplicate listeners observed. |
| 26 | `src/renderer/src/pending-ui.ts` | Discriminated decision result feedback; disables buttons during request. | PASS — conflict/not-found shown, not treated as success. |
| 27 | `src/renderer/src/provider-profiles-ui.ts` | Profile list/create/edit/test/discover/default/delete UI; key-cleared prompt. | PASS+P3 — no key display; warning appears after save, not before; official edit/delete disabled by code but not covered by a UI test. |
| 28 | `src/self-model/reflection-concern.ts` | Concern normalization/key/digest identity. | PASS — conservative normalization; no user text stored in pending detail. |
| 29 | `src/self-model/reflection-mapping.ts` | Concern kinds dedupe by statement; evidence-consuming kinds keep full identity. | PASS — tests cover both branches. |
| 30 | `src/self-model/reflection-service.ts` | Adds `open_question` finding from one-conversation knowledge gaps. | PASS — producer reads only Morrow’s own gap events; findings are local. |
| 31 | `src/shared/companion.ts` | Provider profile/health/capability/types and discovery result. | PASS — types match DB/IPC/UI. |
| 32 | `src/shared/contracts.ts` | New IPC channels, profile types, pending decision result, companion goals bridge. | PASS — no removed channel still referenced; `tsc` clean. |
| 33 | `src/shared/errors.ts` | Adds `SCHEMA_UPGRADE_REQUIRED` and `PROVIDER_ENDPOINT_BLOCKED`. | PASS — IPC failure map covers both. |
| 34 | `src/shared/validation.ts` | Provider profile parsers, 40-char id, official rejection at IPC, legacy provider parser. | PASS — 40/41 boundary tested; raw NUL in the API-key regex is the existing control-character convention (base already had one). |
| 35 | `evals/stage-2/ablation/run.ts` | Wires `EventLogService` into the pending repository. | PASS — eval stack compiles/runs. |
| 36 | `evals/stage-2/runner/cli.ts` | Same pending-repository wiring. | PASS — no behavior change. |
| 37 | `evals/stage-3/runner/harness.ts` | Event log wiring and real git metadata. | PASS — harness matches production wiring. |
| 38 | `evals/stage-3/shared/real-provider.ts` | Event log wiring for goals/readings/pending. | PASS — no secret handling change. |
| 39 | `evals/stage-4a/run.ts` | Uses `readGitMetadata` instead of hard-coded branch. | PASS — evidence identity is more honest. |
| 40 | `evals/stage-5/run.ts` | Uses `readGitMetadata` instead of hard-coded branch. | PASS — evidence identity is more honest. |
| 41 | `evals/provider-multi-source/run.ts` | New real-provider evidence script: env key, profile/IPC/connection/non-stream/stream/local, sanitized JSON/transcript. | PASS+P3 — honest `BLOCKED_QUOTA`; blocked runs omit HTTP status/latency/attempts/exit code. |

## 2. Test files (grouped; every changed test/helper listed)

| Group | Files | Conclusion |
| --- | --- | --- |
| New provider integration | `src/app/provider-multi-source.integration.test.ts` (18), `src/app/provider-multi-source-ipc.integration.test.ts` (2), `src/app/provider-continuity.integration.test.ts` (1), `src/app/provider-manual-chat.integration.test.ts` (modified) | PASS — P1/P2 service/IPC/continuity coverage; no real OS store; official UI disabled not asserted. |
| New provider unit tests | `src/providers/endpoint-resolver.test.ts` (4), `src/providers/endpoint-security.test.ts` (7) | PASS — required boundary table covered; redirect is covered by adapter code/probe, not this unit file. |
| Stage 4 new integration | `src/app/stage4-goal-candidate-e2e.test.ts`, `stage4-outbox-reflection.integration.test.ts`, `stage4-reflection-producer.integration.test.ts`, `stage4-restart-consistency.integration.test.ts`, `stage4-startup-composition.integration.test.ts` | PASS — full suite 1128 tests; no skip/weakening. |
| Stage 4 new unit/UI | `src/app/pending-schema-gate.test.ts` (1), `src/persistence/intent-reading-pending-closure.test.ts`, `src/self-model/reflection-concern.test.ts`, `src/self-model/reflection-mapping.test.ts`, `src/evaluation/git-metadata.test.ts`, `tests/goal-candidates-ui.test.ts`, `tests/pending-ui.test.ts`, `tests/provider-profiles-ui.test.ts` | PASS — schema gate, closure, concern identity, git metadata and decision/profile UI covered; official-button-disabled assertion is missing. |
| Migration tests | `src/persistence/migrations.test.ts` (23 tests; v49 group 6) | PASS — release/Stage4/Provider/bridge/repeat/rollback/40-41 boundary; no Provider v48 41-char existing-row test. |
| Existing test wiring changes | `src/app/b1-strategy-payload.integration.test.ts`, `src/app/b4-recovery.integration.test.ts`, `src/app/b5-reflection-safety.integration.test.ts`, `src/app/cognitive-continuity-phase24.integration.test.ts`, `src/app/interest-payload-invalidation.integration.test.ts`, `src/app/turn-context-fidelity.integration.test.ts`, `src/app/turn-state-sequence.integration.test.ts`, `src/cognition/pending-items.test.ts`, `src/cognition/reflection-routing.test.ts`, `src/motivation/companion-goal.test.ts`, `src/motivation/goal-lifecycle.test.ts`, `tests/b4-child-crash.test.ts`, `tests/c1-mainchain.test.ts`, `tests/correction-round.test.ts`, `tests/helpers/b4-crash-child.ts`, `tests/helpers/companion-stack.ts` | PASS — constructor/wiring changes only; no assertions relaxed. `companion-stack` provider factory now returns a mock profile wrapper, which is consistent with the policy interface. |
| Existing IPC test changes | `src/app/ipc.test.ts` | PASS — profile/pending/companion-goal handlers and error mapping covered; no assertion weakening. |

## 3. Docs (grouped)

| Group | Files | Conclusion |
| --- | --- | --- |
| Final closure docs | `docs/audit/morrow-v2-final-closure-baseline.md`, `docs/architecture/morrow-v2-final-integrated-architecture.md`, `docs/architecture/morrow-v2-final-migration-and-recovery.md`, `docs/testing/morrow-v2-final-acceptance-matrix.md`, `docs/reports/morrow-v2-final-delivery-report.md`, `docs/reports/morrow-v2-final-evidence-index.md`, `docs/reports/morrow-v2-final-work-log.md` | PASS with **blocking inconsistencies** — SHAs/base/version/test counts match; status `PARTIAL`, “5 historical skips”, real-provider metadata, Windows real-app upgrade and CI/product-path claims do not match the red CI. Not in PR #54 at head `28665df`. |
| Historical Stage 4/provider docs | `docs/audit/provider-multi-source-baseline-audit.md`, `docs/architecture/provider-multi-source-architecture.md`, `docs/architecture/provider-security-and-consent.md`, `docs/architecture/pr-40-audit-findings-runtime-and-state-machine.md`, `docs/reports/pr-40-*`, `docs/reports/provider-multi-source-*`, `docs/reports/stage-4-*`, `docs/testing/pr-40-*`, `docs/testing/provider-multi-source-*`, `docs/testing/stage-4-*` | HISTORICAL — retained with their own SHAs; not final-SHA evidence. No historical evidence rewritten. |
| General schema index | `docs/architecture/database-schema.md` | **Stale** — header says “当前 v48” and omits v49; should be updated or marked historical. |

## 4. Evidence / results (grouped)

| Group | Files | Conclusion |
| --- | --- | --- |
| Product-path local | `evals/morrow-v2-final/results/20261104T124128Z-125af6f6.json` (FAILED, `2147483651`), `20261104T124142Z-933adad0.json` (FAILED, `3221225477`), matching transcripts | PASS for honesty — FAILED is recorded, not PASS; no checks ran. Not acceptance evidence. |
| CI product-path artifacts | `morrow-product-path-ubuntu-latest` run `20261104T130546Z-3935d1df`; `morrow-product-path-windows-latest` run `20261104T131238Z-d673030f` | **FAILED** — both JSONs record the seed `SyntaxError`; zero checks. |
| Real provider | `evals/provider-multi-source/results/20261104T123748Z-5fc34109.json` + transcript; `20261104T123809Z-02e942cb.json` + transcript | PASS for honesty — both `BLOCKED_QUOTA`, no PASS, no key/Authorization/body; metadata incomplete (P3). |
| Historical provider run | `evals/provider-multi-source/results/20261104T114033Z-10e4a3e2.json` + transcript | HISTORICAL — commit `34098fb`, detached, `BLOCKED_QUOTA`; not final-SHA evidence. |
| Stage 3/4/5 eval results added | `evals/stage-3/results/*`, `evals/stage-4a/results/*`, `evals/stage-5/results/*`, `evals/stage-4-companion-confirmation/results/*`, `evals/pr-40-audit-findings/results/*` | HISTORICAL — prior-stage runs; not re-run for this review and not treated as final closure proof. |

## 5. Matrix summary

- 41 production files reviewed individually.
- Blocking: `scripts/product-path-smoke.mjs` (top-level await), `.github/workflows/ci.yml` (red product-path/package jobs), and the final docs/status inconsistency.
- All provider P1/P2 code locations were found at the current HEAD and independently probed; no open P1/P2 security defect was reproduced. P1-3 is PARTIAL only because the UI-layer rejection assertion is missing (service/IPC enforce); P1-4 is PARTIAL because the real OS SafeStorage path has no passing evidence.
- Migration code passes 31/31 independent probes; the only migration edge is the documented fail-closed 41–64-char Provider v48 id.
- No real provider key or Authorization token was found; the only key-like literals are fake descriptive test fixtures, and the evidence files contain none.
