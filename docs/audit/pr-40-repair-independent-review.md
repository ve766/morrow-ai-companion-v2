# PR #40 repair — independent review (Issue #47 / PR #48)

- Repository: `ve766/morrow-ai-companion-v2`
- Reviewed implementation PR: [#48](https://github.com/ve766/morrow-ai-companion-v2/pull/48) — OPEN, not merged
- Reviewed head SHA: `e4aad40a6f08300704a07a7d74303bfb2b7c2dd0` (confirmed with `git ls-remote` via SSH and GitHub)
- Implementation code SHA inside the PR: `dd9f59b10c7c812c3af36684a32d15193bda7d50`
- Base branch / base SHA: `feat/stage-4-companion-confirmation-closure` @ `052bcaa9c0320ef5e726c7bf66df85a49055628d`
- Review branch: `audit/pr-40-repair-independent-review` (created from the actual reviewed head)
- Review time (UTC): 2026-11-04T05:44:25Z
- Reviewer: independent review context (different agent/context from the implementer); did not write the implementation
- Reference audit: [PR #46](https://github.com/ve766/morrow-ai-companion-v2/pull/46), Issue #45
- Reference repair reports: `docs/reports/pr-40-audit-findings-repair-report.md`, `docs/testing/pr-40-audit-findings-acceptance-matrix.md`, `docs/architecture/pr-40-audit-findings-runtime-and-state-machine.md`, `docs/reports/pr-40-audit-findings-evidence-index.md`, `evals/pr-40-audit-findings/results/20261104T051210Z-dd9f59b10c7c812c3af36684a32d15193bda7d50-repair.json`

## 1. Verdict

**DO_NOT_MERGE**

The main P1 mechanisms are real and mostly fixed: a second concern observation no longer throws
`PENDING_LINK_MISMATCH`; the concern identity and normalization exist and are versioned; a stranded
finding can be recovered; the v47→v48 upgrade works on a real database; the real close/reopen test
exists; the eval branch metadata is dynamic. The full local suite (116 files / 1073 tests), persistence
suite (8/61), targeted 11-file suite (11/116), typecheck and build all pass, and the PR #48 CI run on
`e4aad40` is green on all three jobs.

However, two required contracts are not closed:

1. **AUD45-P1-01 (P1) — rate-limited outbox can still be completed while a finding remains unrouted.**
   `buildCognitiveProjectors` calls `recoverUnrouted()` and discards its `{repaired, failed}` result
   (`src/app/companion-service.ts:1006-1043`). `recoverUnrouted` deliberately catches per-finding
   failures and returns `failed > 0` instead of throwing (`src/cognition/reflection-routing.ts:186-219`).
   Therefore, when recovery itself fails once (a transient write failure), the projector returns
   normally and `CognitionOutbox.drain` marks the projection `done` (`src/app/cognitive-outbox.ts:264-284`).
   My independent reproduction `O` produced: outbox `status=done, attempts=0`, finding route `null`,
   and only a later manual `recoverUnrouted()` repaired it. This is exactly the prohibited
   "rate-limit/skip marks the projection done while a finding is unrouted" case, and the required
   outbox regression test was not added. The finding has a durable `reflection.finding_ingest_failed`
   event, so it is not silently lost, but the outbox completion semantics are wrong and no retry is
   scheduled by the outbox.
2. **AUD45-P2-03 (P2) — a legacy item adopted by a post-upgrade re-observation leaves the original
   route stranded.** When a v47 item is upgraded with `finding_id=NULL` and, before the user decides,
   a new observation of the same concern creates finding F2, `ingestFinding` adopts F2 as the item's
   finding (`src/cognition/reflection-routing.ts:285`). `decide` then takes the `finding_id`-non-null
   branch and converges only F2 (`src/persistence/cognitive-context-repository.ts:233-267`). The
   original F1 route (the route that belonged to the item before the upgrade) remains `routed` after the
   item is terminal, and no `finding_reobserved`/`unresolved` audit explains it. My reproduction `X`
   confirms: item `done/accepted`, new route `consumed`, original route `routed`, audit
   `routeResolution: linked`. This is the same "item terminal + route left routed without explanation"
   state the finding required to eliminate.

A third required boundary is also not fully met (non-blocking, P3): the intent-reading business path
closes `source='open_question'` pending rows with raw SQL (`src/persistence/intent-reading-repository.ts:181-187`),
setting `status='done'` without `decision`, route terminal state or audit. The old `complete`/`drop`
primitives are gone, but the Issue's required "no public entry can change status only" property does
not hold for this path. Reproduction `H`: item `done`, `decision=null`, route `routed`, zero
`pending.decision` audit rows, and a subsequent `decide` returns `conflict` with `current=null`.

Because any unresolved P1 blocks a PASS under Issue #47 §5, the verdict is **DO_NOT_MERGE**. The
implementation is close; the blocking items are narrow and independently reproducible.

## 2. Per-finding matrix

| ID | Severity | Status | Source / symbol | Tests and evidence | Reviewer note |
|---|---|---|---|---|---|
| AUD45-P1-01 | P1 | **STILL_OPEN** (core fixed; outbox contract not) | `src/self-model/reflection-concern.ts` (`normalizeConcern`, `concernKeyOf`, `concernDigestOf`, `legacyConcernDigestOf`, `reflectionPendingKeys`); `src/self-model/reflection-mapping.ts:79-84`; `src/cognition/pending-items.ts:310-343`; `src/cognition/reflection-routing.ts:157-178,186-219,255-298`; `src/app/companion-service.ts:1006-1043`; `src/app/startup-composition.ts:90-160` | `reflection-routing.test.ts` `ingests a second finding for the same concern without PENDING_LINK_MISMATCH`, `routes later findings when one finding cannot be routed, and records the failure`, `recovers a finding that was stored without a route, idempotently`; `stage4-startup-composition.integration.test.ts` `a second startup gap for the same label keeps the run successful`; `stage4-reflection-producer.integration.test.ts` `a second correction event does not fail manual ingestion`; `reflection-concern.test.ts` 4; `reflection-mapping.test.ts` 2. My probes A1/A2/B pass; probe O fails the outbox contract | Second gap/correction now succeed; one pending item; no stranded finding in the normal path; recovery is idempotent. **Blocking residual:** rate-limited projector marks outbox done when `recoverUnrouted()` returns `failed>0`; the required outbox regression (`route temporarily fails -> retry -> not done`) is absent. |
| AUD45-P2-02 | P2 | **VERIFIED_FIXED** | `src/persistence/migrations.test.ts:549-610` (`upgrades a v47 database with pending items and keeps them decidable`); `.github/workflows/ci.yml:75`; `docs/reports/stage-4-migration-verification.md:24` | Local `npx vitest run src/persistence` = 8 files / 61 tests, exit 0; CI Windows upgrade job `126403196244` log at 05:17:08 contains the exact v47 test name and `8 passed / 61 passed` | CI step name now matches actual coverage; the doc's unsupported "previous schema→current PASS" row was replaced with the real test. |
| AUD45-P2-03 | P2 | **STILL_OPEN** (direct legacy decision fixed; adoption edge not) | `src/persistence/cognitive-context-repository.ts:233-267,302-331`; `src/cognition/reflection-routing.ts:285` | `migrations.test.ts` v47 case; `reflection-routing.test.ts` `converges a legacy item route by its stored concern digest`, `does not guess a legacy route when the concern cannot be proven`, legacy compatibility audit case. My probes C/D pass; probe X fails the terminal-route invariant | Direct upgrade→decide is correct (route consumed, audit `resolved_by_concern`; unprovable stays `routed` with `routeStatus:null/unresolved`). **Blocking residual:** post-upgrade re-observation adopts the legacy item to F2, so only F2 is consumed; original F1 route remains `routed` with no explaining audit. |
| AUD45-P2-04 | P2 | **VERIFIED_FIXED** | `src/app/stage4-restart-consistency.integration.test.ts`; `docs/testing/stage-4-companion-confirmation-acceptance-matrix.md:33`; `docs/testing/stage-4-final-repair-acceptance-matrix.md:59` | Local targeted suite passes; my probe E1/E2/E3 closes the real SQLite file, reopens it, verifies candidate/goal/creation key/pending/route/audit, then decides after reopen and reopens again | Real file close/reopen, not same-connection re-select. P09 remains described as memory/address/personality only. |
| AUD45-P2-05 | P2 | **VERIFIED_FIXED** | `src/evaluation/git-metadata.ts`; `evals/stage-5/run.ts:169-177,230-240`; `evals/stage-4a/run.ts:108-116,233-241` | `git-metadata.test.ts` 5 (branch/clean, detached, ENOENT, command failure, override, empty); local new result files: Stage 5 `branch=fix/pr-40-audit-findings,branchReason=ok,workingTree=clean`; Stage 4-A same branch, `workingTree=dirty` with the documented reason; historical result files are only added, none modified (`git diff --name-status` shows `A` only) | Dynamic branch/null+reason; old 24 result files untouched; evidence index documents the historical mislabel. |
| AUD45-P3-06 | P3 | **VERIFIED_FIXED** | `src/cognition/pending-items.ts:60-71` (`PendingAuditSink`); `src/persistence/cognitive-context-repository.ts:132-136`; all production/eval/test constructors grep-checked | `pending-items.test.ts` `@ts-expect-error` constructor contract + `requires a durable audit sink for decisions`; `npx tsc --noEmit` exit 0 | One-argument construction exists only inside the intentional `@ts-expect-error` test. Runtime `PENDING_AUDIT_UNAVAILABLE` guard retained; no no-op sink in production. |
| AUD45-P3-07 | P3 | **STILL_OPEN** (original primitives removed; another status-only path remains) | `src/cognition/pending-items.ts` (complete/drop removed); `src/persistence/cognitive-context-repository.ts` (complete/drop removed); **residual:** `src/persistence/intent-reading-repository.ts:181-187` | `pending-items.test.ts` `has no public write path that changes status without a decision` (but only asserts the removed methods); `ipc.test.ts` removed-channel test. My probe H | `complete`/`drop` have no callers, but `IntentReadingRepository.closeOpenItems()` updates `cognitive_pending_items SET status='done'` for legacy `source='open_question'` rows with no decision/route/audit. This violates the Issue's required "no public entry can change status only" property. |
| AUD45-P3-08 | P3 | **VERIFIED_FIXED** (behavior; test coverage partial) | `src/app/startup-composition.ts:42-160`; `src/app/index.ts:367-375` | `stage4-startup-composition.integration.test.ts` `returns skipped...`, `reports producer failure...`, existing abort test; `pending-schema-gate.test.ts` degraded case | Returns `ran/skipped/failed/degraded`; never blocks window; durable lifecycle events. Missing required tests for audit-write failure, DB-not-ready, repeated startup and timeout (non-blocking backlog). |
| AUD45-P3-09 | P3 | **VERIFIED_FIXED** | `src/self-model/reflection-service.ts:629-670` | Source review + `npx tsc --noEmit` | `pickOpenQuestionCandidate` and `pickMorrowGapCandidate` now each own the correct docstring; algorithm unchanged. |
| AUD45-P3-10 | P3 | **VERIFIED_FIXED** | `src/shared/validation.ts`; `src/shared/contracts.ts`; `src/app/ipc.ts`; `src/preload/index.ts` | Repository grep: no `parsePendingItemIdRequest` / `PendingItemIdRequest` outside the repair report; tsc 0 | No dangling references. |
| AUD45-P3-11 | P3 | **VERIFIED_FIXED** (core; residual mapping/test gaps) | `src/persistence/cognitive-context-repository.ts:139-141`; `src/cognition/pending-items.ts:77-84`; `src/app/ipc.ts:175,197`; `src/app/companion-service.ts:2406-2420`; `src/app/startup-composition.ts:135-160` | `pending-schema-gate.test.ts` (real v47 degraded DB; upsert/decide throw; read safe; startup degraded); `ipc.test.ts` schema mapping; my probe G | Fail-closed `SCHEMA_UPGRADE_REQUIRED`, no SQL against missing columns, main chat continues, degradation recorded. Residual: manual reflection wraps the schema error into `STORAGE_ERROR` (`src/app/index.ts:457-467`), and there is no ChatService-finalization/recovery-retry test. |
| AUD45-P3-12 | P3 | **VERIFIED_FIXED** | `src/renderer/src/pending-ui.ts:52-119`; `src/renderer/index.html:159` | `tests/pending-ui.test.ts` accepted, conflict, not_found, IPC failure, unchanged (5) | result.status is rendered; conflict/not_found refresh; failure re-enables buttons; `#pending-feedback` is `role=status aria-live=polite`. |

## 3. Blocking conditions

1. **AUD45-P1-01 outbox completion.** When `recoverUnrouted()` returns `failed > 0`, the reflection
   projector must not return success. Throw (so `CognitionOutbox` retries/parks the row) or mark the
   projection failed/degraded explicitly. Add the required regression test: a route failure injection
   plus a rate-limited run, asserting the outbox row is not `done`, no pending/audit duplicate on
   replay, and a later retry routes the finding. File: `src/app/companion-service.ts:1006-1043`.
2. **AUD45-P2-03 legacy adoption.** When `ingestFinding` adopts a legacy `finding_id=NULL` item to a
   new finding, converge every provable route for that concern (same statement digest, same kind) or
   record an explicit archival/unresolved audit for the original route. Add a test: v47 open item + F1
   route → upgrade → second gap (F2) → decide; assert the item, F1 route and F2 route are consistent
   and the audit explains the history. Files: `src/cognition/reflection-routing.ts:255-298`,
   `src/persistence/cognitive-context-repository.ts:233-267`.

## 4. Non-blocking backlog observed

- **P3-07**: remove/route the `IntentReadingRepository.closeOpenItems()` status-only update through the
  decision path (or record an explicit implicit-decision audit). It currently affects only legacy
  `source='open_question'` rows, which the current producer no longer creates, but the invariant is
  stated absolutely in Issue #47.
- **P3-08**: add the missing failure tests (audit write failure, DB not ready, repeated startup, timeout).
- **P3-11**: map `PendingSchemaUnavailableError` in the manual reflection IPC path to
  `SCHEMA_UPGRADE_REQUIRED` instead of `STORAGE_ERROR`; add a ChatService finalization test and a
  post-upgrade recovery retry test.
- **Documentation**: `docs/reports/stage-4-migration-verification.md:28` still cites
  `stage4-goal-candidate-e2e.test.ts` / `reflection-routing.test.ts` as "restart" evidence; those do
  not close/reopen a database. Point this row at `stage4-restart-consistency.integration.test.ts` too.
- **Evidence freshness**: the machine result at `evals/pr-40-audit-findings/results/...-repair.json`
  says `ci.status = PENDING`; the actual CI run on `e4aad40` is green (run 41778144360). The PR body
  also points readers to a comment; record the run in the final evidence if the file is refreshed
  (do not rewrite history silently).

## 5. External / not-run items

| Item | Status | Reason |
|---|---|---|
| Human naturalness review | PENDING_HUMAN | External review |
| Second real provider | NOT_RUN | No second provider credentials in this environment |
| Real-machine install/upgrade | PENDING_HUMAN | External |
| Stage 5 live rerun | NOT_RUN | Paid/time-bounded provider; no new live claim made |
| Local Electron smoke | NOT_RUN locally | CI ran the real Electron smoke on ubuntu-latest and windows-latest for `e4aad40`; both passed |
| Full `npm ci` | NOT_RUN | `npm ci --dry-run` exit 0 (only 50 optional cross-platform packages would be added); the installed tree already runs the full suite/build. A destructive reinstall was not needed |

## 6. Constraints observed

- PR #48 remains OPEN; PR #40 and PR #46 remain OPEN; PR #40 head is still `052bcaa` (not moved).
- No production code, tests, migrations or historical result files were modified by this review.
- This branch adds only the five review deliverables; review scripts/logs live under gitignored `.tmp/`.
