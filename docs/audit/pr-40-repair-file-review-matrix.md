# PR #48 changed-file review matrix

- Reviewed head: `e4aad40a6f08300704a07a7d74303bfb2b7c2dd0`
- Base: `052bcaa9c0320ef5e726c7bf66df85a49055628d` (`feat/stage-4-companion-confirmation-closure`)
- Diff: 57 files, +3507 / -190 (matches `gh pr view 48 --json files` and local `git diff --stat`)
- Every changed file is listed below. "Finding IDs" refer to the audit findings in Issue #45 / Issue #47.
- Status vocabulary: OK / OK-WITH-NOTE / DEFECT (reviewer did not fix defects).

## A. Production source

| File | Change | Conclusion | Finding IDs |
|---|---|---|---|
| `src/self-model/reflection-concern.ts` | New: NFKC/whitespace/zero-width/punctuation normalization, versioned concern key, current+legacy pending digests | OK. Normalization preserves negation/time/entities/numbers; tests cover the non-merge cases. Version constant = 1. | P1-01 |
| `src/self-model/reflection-mapping.ts` | `dedupeKeyOf` uses concern key for `memory_gap/open_question/intent_correction/consistency_note`; evidence-consuming kinds keep full identity | OK. Stored finding identity now drops evidence for concern kinds, which is what prevents second-row creation; new evidence is not appended to the existing finding (provenance stays in the event journal / historical F2 row). Design trade-off documented. | P1-01 |
| `src/cognition/pending-items.ts` | `PendingAuditSink` required type; `PendingSchemaUnavailableError`; `findReflectionConcern` current+legacy keys; `absorbReflection` reuse; `complete/drop` removed; `decide` only mutation | OK-WITH-NOTE. Original primitives removed. NOTE: does not prevent the separate `IntentReadingRepository.closeOpenItems` status-only write (not in this file). | P1-01, P3-06, P3-07, P3-11 |
| `src/cognition/reflection-routing.ts` | Per-finding ingest isolation; `recoverUnrouted`; re-observation archive; durable failure/lifecycle events; schema abort | DEFECT (partial). Normal second-finding path and recovery are correct; `recoverUnrouted` returns `failed` instead of throwing, and the outbox caller ignores it. | P1-01, P3-08 |
| `src/persistence/cognitive-context-repository.ts` | Required audit sink; decision terminal-state guard; `resolveLegacyRoutes`; audit `routeStatus/routeResolution/routesUpdated`; `complete/drop` removed | DEFECT (partial). Direct legacy decision works; when a legacy item has already been adopted by a new finding, only the new route converges and the original route stays `routed`. | P2-03, P3-06, P3-07, P3-11 |
| `src/app/startup-composition.ts` | `runStartupReflection` returns ran/skipped/failed/degraded; never throws; recovery; lifecycle audit | OK. Producer failure, rate limit, partial ingest and schema degradation are differentiated. | P1-01, P3-08, P3-11 |
| `src/app/companion-service.ts` | Projector calls recovery on rate-limit/schema; passes schemaVersion to ChatService; finalization skips drafts below v48 | DEFECT (partial). The rate-limited branch ignores `recoverUnrouted().failed`; outbox completes while a finding is unrouted. | P1-01, P3-11 |
| `src/app/index.ts` | Logs non-`ran` startup status; startup result used | OK-WITH-NOTE. Startup is fail-safe. Manual reflection still maps a schema error to `STORAGE_ERROR` (see P3-11 note). | P3-08, P3-11 |
| `src/app/ipc.ts` | Schema error import/mapping; removed dead import | OK. `PendingSchemaUnavailableError` -> `SCHEMA_UPGRADE_REQUIRED`; no message leak. | P3-10, P3-11 |
| `src/renderer/src/pending-ui.ts` | Discriminated result rendering; feedback element; re-enable retry; refresh on conflict/not_found | OK. All four result statuses plus IPC failure handled; buttons re-enabled. | P3-12 |
| `src/renderer/index.html` | Added `#pending-feedback` (`role=status aria-live=polite`) | OK. | P3-12 |
| `src/preload/index.ts` | Removed `PendingItemIdRequest` import | OK. | P3-10 |
| `src/shared/contracts.ts` | Added `SCHEMA_UPGRADE_REQUIRED`; removed `PendingItemIdRequest` | OK. | P3-10, P3-11 |
| `src/shared/validation.ts` | Removed `parsePendingItemIdRequest` | OK. No references remain. | P3-10 |
| `src/self-model/reflection-service.ts` | Moved two docstrings to their functions; no algorithm change | OK. | P3-09 |
| `src/evaluation/git-metadata.ts` | New: branch/branchReason/commit/workingTree reader with git-unavailable/detached/failure reasons | OK. | P2-05 |
| `evals/stage-5/run.ts` | Scripted/live payload branch metadata dynamic | OK. New result matches actual branch. | P2-05 |
| `evals/stage-4a/run.ts` | Scripted/live payload branch metadata dynamic | OK. New result matches actual branch; dirty reason documented. | P2-05 |
| `evals/stage-2/ablation/run.ts` | Pass EventLogService to pending repository | OK. | P3-06 |
| `evals/stage-2/runner/cli.ts` | Pass EventLogService to pending repository | OK. | P3-06 |

## B. Tests

| File | Change | Conclusion | Finding IDs |
|---|---|---|---|
| `src/self-model/reflection-concern.test.ts` | New: normalization/version/non-merge tests | OK. Covers full-width/whitespace/zero-width equality and negation/number/time/entity/kind differences. | P1-01 |
| `src/self-model/reflection-mapping.test.ts` | +2: concern identity ignores evidence; evidence-consuming kinds keep it | OK. | P1-01 |
| `src/cognition/reflection-routing.test.ts` | +3 required P1 tests, legacy convergence/unresolved, audit privacy, durable-sink | OK. Tests are real SQLite and assert routes/items/audits, not only throws. Missing the required outbox rate-limit regression. | P1-01, P2-03, P3-06 |
| `src/cognition/pending-items.test.ts` | complete->decide; compile-time/runtime decision boundary | OK. `@ts-expect-error` for one-arg repository and removed `complete`; runtime guard. | P3-06, P3-07 |
| `src/app/stage4-startup-composition.integration.test.ts` | +3: second gap; rate-limit skipped; producer failure; existing abort case | OK. Second-gap test uses the real composition and SQLite. | P1-01, P3-08 |
| `src/app/stage4-reflection-producer.integration.test.ts` | +1: second correction through real producer/router/SQLite | OK. Asserts one item and zero stranded findings. | P1-01 |
| `src/app/stage4-restart-consistency.integration.test.ts` | New: real close/reopen, pending decision, candidate accept, second reopen | OK. Uses `SqliteDatabase.open(path)` on the same file. | P2-04 |
| `src/persistence/migrations.test.ts` | +1: real v47 fixture with open/done pending + run/finding/route, upgrade and decide | OK. Asserts columns, row preservation, integrity/FK, production decide, audit. | P2-02, P2-03 |
| `src/persistence/pending-schema-gate.test.ts` | New: real v47 degraded DB, upsert/decide fail closed, startup degraded | OK. Uses a reserved index name to make v48 fail realistically. Does not cover ChatService finalization. | P3-11 |
| `src/app/ipc.test.ts` | +1 schema error mapping | OK. | P3-11 |
| `src/evaluation/git-metadata.test.ts` | New: 5 cases (clean, detached/dirty, ENOENT, command failure, override) | OK. | P2-05 |
| `tests/pending-ui.test.ts` | New: accepted, conflict, not_found, IPC failure, unchanged | OK. Real bridge shape; DOM stub is appropriate for the node test environment. | P3-12 |
| `src/app/b1-strategy-payload.integration.test.ts` | Constructor injection only | OK; no assertion weakened. | P3-06 |
| `src/app/b4-recovery.integration.test.ts` | Constructor injection only | OK. | P3-06 |
| `src/app/b5-reflection-safety.integration.test.ts` | Constructor injection only | OK. | P3-06 |
| `src/app/cognitive-continuity-phase24.integration.test.ts` | Constructor injection only | OK. | P3-06 |
| `src/app/interest-payload-invalidation.integration.test.ts` | Constructor injection only | OK. | P3-06 |
| `src/app/turn-context-fidelity.integration.test.ts` | Constructor injection only | OK. | P3-06 |
| `src/app/turn-state-sequence.integration.test.ts` | Constructor injection only | OK. | P3-06 |
| `tests/b4-child-crash.test.ts` | Constructor injection only | OK. | P3-06 |
| `tests/helpers/b4-crash-child.ts` | Constructor injection only | OK. | P3-06 |
| `tests/helpers/companion-stack.ts` | Constructor injection only | OK. | P3-06 |

## C. CI and documentation

| File | Change | Conclusion | Finding IDs |
|---|---|---|---|
| `.github/workflows/ci.yml` | Step renamed to "Persistence and migration tests (up to the current schema, includes v47 feature paths)" | OK. Windows job log contains the v47 test name. | P2-02 |
| `docs/reports/stage-4-migration-verification.md` | Replaced unsupported "previous schema→current PASS" with the v47 test row; corrected legacy-route sentence | OK-WITH-NOTE. Row 28 still cites non-reopen tests for "restart"; the new restart test exists but is not cited there. | P2-02, P2-03, P2-04 |
| `docs/architecture/database-schema.md` | Corrected legacy-row decision semantics | OK. | P2-03 |
| `docs/testing/stage-4-companion-confirmation-acceptance-matrix.md` | Restart row now references the new real test; P09 scope explicit | OK. | P2-04 |
| `docs/testing/stage-4-final-repair-acceptance-matrix.md` | Same correction | OK. | P2-04 |
| `docs/architecture/pr-40-audit-findings-runtime-and-state-machine.md` | New call graph / state machine / transaction / recovery description | OK-WITH-NOTE. Matches code except it claims the rate-limited recovery prevents "row done but finding unrouted"; the reviewer probe shows that is not true when recovery fails. | P1-01 |
| `docs/testing/pr-40-audit-findings-acceptance-matrix.md` | New 12-finding acceptance matrix | OK-WITH-NOTE. Claims all PASS; reviewer finds P1-01/P2-03/P3-07 incomplete. | All |
| `docs/reports/pr-40-audit-findings-repair-report.md` | New repair report | OK-WITH-NOTE. Implementation description matches code; status claims overstate the outbox and legacy-adoption cases. | All |
| `docs/reports/pr-40-audit-findings-evidence-index.md` | New evidence index | OK-WITH-NOTE. Correctly documents historical branch mislabels; CI section written before the run finished. | P2-05 |
| `docs/reports/pr-40-audit-findings-work-log.md` | New work log | OK. Environment/timeline match. | All |

## D. Eval results and machine evidence

| File | Change | Conclusion | Finding IDs |
|---|---|---|---|
| `evals/pr-40-audit-findings/results/20261104T051210Z-dd9f59b10c7c812c3af36684a32d15193bda7d50-repair.json` | New machine result, all 12 marked FIXED | OK-WITH-NOTE. Metadata and commands match my runs; `ci.status` is stale `PENDING`; statuses do not match the independent review. | All |
| `evals/stage-5/results/20261104T050753Z-dd9f59b.json` | New result | OK. 12/12; `branch=fix/pr-40-audit-findings`, reason `ok`, tree `clean`; SHA matches filename. | P2-05 |
| `evals/stage-4a/results/20261104T050814Z-dd9f59b.json` | New result | OK. 7/7; branch dynamic, tree `dirty` (Stage 5 result uncommitted at generation time) — honest. | P2-05 |
| `evals/stage-3/results/20261104T050848Z-dd9f59b.json` | New result | OK. 15 PASS + 1 NOT_RUN / 16; historical schema has no branch field. | P2-05 |
| `evals/stage-3/results/20261104T050848Z-dd9f59b-summary.json` | New summary | OK. Consistent with the result file. | P2-05 |

## E. Historical files check

`git diff --name-status 052bcaa..e4aad40` shows only `A` (added) for all `evals/**/results/**` entries;
no pre-existing result JSON was modified. The 24 historical Stage 5/4-A/3 results are untouched.

## F. Summary

- 57/57 changed files reviewed.
- 2 files carry the blocking defects: `src/app/companion-service.ts` (outbox completion) and
  `src/cognition/reflection-routing.ts` + `src/persistence/cognitive-context-repository.ts`
  (legacy adoption route convergence).
- 1 additional production status-only path outside the diff: `src/persistence/intent-reading-repository.ts`
  (P3-07 acceptance gap).
- No test was weakened; all one-line integration-test changes are required constructor injection.
