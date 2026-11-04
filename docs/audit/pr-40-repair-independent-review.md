# PR #40 repair — independent review, round 3 (Issue #47 / PR #48)

- Repository: `ve766/morrow-ai-companion-v2`
- Reviewed implementation PR: [#48](https://github.com/ve766/morrow-ai-companion-v2/pull/48) — OPEN, not merged
- Reviewed head SHA: `9aff0424606c89dbf9924e2e831015a11b1b58f4` (confirmed with `git ls-remote` via SSH and GitHub)
- Implementation code commit: `16620217cd0fd1ace9598fd57c74bc6425a6b16f`; evidence commit: `9aff042`
- Base branch / base SHA: `feat/stage-4-companion-confirmation-closure` @ `052bcaa9c0320ef5e726c7bf66df85a49055628d`
- Review branch: `audit/pr-40-repair-independent-review` (round-2 review commit `fe076eebc9c2d3faa5e5f798e6f26615aef39274`; round-3 review commit is the commit containing this file)
- Round-3 review time (UTC): 2026-11-04T07:13:50Z
- Reviewer: independent context; did not implement the changes and did not modify production code, tests, migrations or historical results
- Prior rounds: round 1 `e4aad40` DO_NOT_MERGE; round 2 `e1219dc` DO_NOT_MERGE (non-rate-limited outbox retry, P1)

## 1. Verdict

**PASS_WITH_NON_BLOCKING_BACKLOG**

The round-2 P1 is fixed and independently reproduced:

- The outbox success branch now calls `recoverUnrouted()` after a successful `ingestRun` and throws
  `REFLECTION_RECOVERY_INCOMPLETE` if `failed > 0` (`src/app/companion-service.ts:1048-1052`).
- My real-router probe O2 now produces: first drain `failed=1`, row `pending/attempts=1`, finding
  route `null`; after the trigger is removed, second drain (not rate-limited, no new findings) marks
  the row `done`, the stranded finding is `routed`, and exactly one pending item exists.
- The repository's new real-router test
  `recovers a finding stranded by a transient pending write on a non-rate-limited retry` covers the
  same path with production composition, real outbox/ledger and SQLite.

Manual reflection now runs recovery and maps `PendingSchemaUnavailableError` to
`ApplicationError('SCHEMA_UPGRADE_REQUIRED')` (`src/app/index.ts:459-471`; the code is added to
`ApplicationErrorCode` and the IPC failure map). Intent withdrawal failures no longer abort the
intent-reading save: non-schema closure failures leave the item open and record
`pending.system_dismiss_failed`; a later withdrawal retries (`src/persistence/intent-reading-repository.ts:191-220`).
The new failure/retry test and my probe H3 confirm it.

All 12 findings are now closed. The remaining items are non-blocking test/evidence gaps:

- P3-08: DB-not-ready and timeout tests are still absent (the new repeated-startup-with-finding test
  is meaningful; audit-write failure is covered).
- P3-11: the manual-reflection schema mapping is source-verified but has no direct test of the
  `index.ts` closure (the `runBounded` error-preservation test is the nearest).
- The repair report says `intent-reading-pending-closure.test.ts` covers degraded schema; that file
  has success and failure/retry tests, not a degraded-schema test. My probe H2 covers the behavior.
- The round-3 machine result still records `ci.status=PENDING` although CI 41789069806 is green.

None of these is a P1 or required P2, so the verdict is PASS_WITH_NON_BLOCKING_BACKLOG.

## 2. Per-finding matrix

| ID | Severity | Status | Source / symbol | Tests and independent evidence | Note |
|---|---|---|---|---|---|
| AUD45-P1-01 | P1 | **VERIFIED_FIXED** | `reflection-concern.ts`; `reflection-mapping.ts:79-84`; `pending-items.ts:310-343`; `reflection-routing.ts:157-219,255-298`; `companion-service.ts:1006-1052`; `index.ts:459-471` | A1/A2/B pass; O passes (rate-limited recovery); **O2 passes** (non-rate-limited retry: row pending then done only after route `routed`, one item); new real-router test; manual recovery source | Second-gap/correction, rate-limited recovery, non-rate-limited retry and manual recovery are all fixed. |
| AUD45-P2-02 | P2 | **VERIFIED_FIXED** | `migrations.test.ts:549-610`; `.github/workflows/ci.yml:75`; `stage-4-migration-verification.md:24` | Local persistence 9 files / 63 tests; CI job 126437949884 at 07:00:05 has the exact v47 test (1815ms), 9/63 | v47 fixture + production decide. |
| AUD45-P2-03 | P2 | **VERIFIED_FIXED** | `cognitive-context-repository.ts:233-281,382-411`; `reflection-routing.ts:285` | Probe X passes: original and new routes consumed, audit `linked_with_siblings`, `routesUpdated:2`; test `converges every route of a legacy concern adopted by a later observation`; C/D still pass | Sibling convergence applied to decisions and system closures. |
| AUD45-P2-04 | P2 | **VERIFIED_FIXED** | `stage4-restart-consistency.integration.test.ts`; two acceptance matrices | Probe E1/E2/E3 close/reopen real file, candidate/goal/creation key/pending/route/audit; decide after reopen; second reopen | No regression. |
| AUD45-P2-05 | P2 | **VERIFIED_FIXED** | `git-metadata.ts`; stage-5/4a run | Round-3 results: Stage 5 branch `fix/pr-40-audit-findings`, reason ok, tree clean, 12/12; Stage 4-A same branch, dirty documented, 7/7; Stage 3 15+1/16; historical files only added | No regression. |
| AUD45-P3-06 | P3 | **VERIFIED_FIXED** | `PendingAuditSink` required; all construction sites | tsc 0; pending-items and intent-reading construction sites; runtime guard | No no-op sink. |
| AUD45-P3-07 | P3 | **VERIFIED_FIXED** | `pending-items.ts:97-105,373-384`; `cognitive-context-repository.ts:307-380`; `intent-reading-repository.ts:191-240` | H (success), H2 (degraded), H3 (failure then retry); `intent-reading-pending-closure.test.ts` 2 tests | Non-schema closure failure records `pending.system_dismiss_failed` and leaves the item open; later withdrawal succeeds. |
| AUD45-P3-08 | P3 | **VERIFIED_FIXED** (coverage gaps) | `startup-composition.ts:42-160`; `index.ts:367-375` | skipped/producer-failure/partial-ingest/schema; lifecycle-audit-failure; repeated-startup-with-finding | DB-not-ready and timeout tests still absent. |
| AUD45-P3-09 | P3 | **VERIFIED_FIXED** | `reflection-service.ts:629-670` | Source review + tsc | Correct docstrings. |
| AUD45-P3-10 | P3 | **VERIFIED_FIXED** | `validation.ts`; `contracts.ts`; `ipc.ts`; `preload/index.ts` | Repository grep; tsc 0 | No references. |
| AUD45-P3-11 | P3 | **VERIFIED_FIXED** | `cognitive-context-repository.ts:139-141`; `pending-items.ts:77-84`; `ipc.ts:175,197`; `companion-service.ts:2406-2420`; `index.ts:459-471`; `errors.ts:8` | Probe G (fail-closed), H2 (degraded intent close); pending-schema-gate + ipc tests; runBounded error test; source mapping | Manual reflection now maps schema to `SCHEMA_UPGRADE_REQUIRED`; no direct test of that closure. |
| AUD45-P3-12 | P3 | **VERIFIED_FIXED** | `pending-ui.ts:52-119`; `index.html:159` | `tests/pending-ui.test.ts` 5 branches | No regression. |

## 3. Non-blocking backlog

- P3-08: add DB-not-ready and timeout tests; the repeated-startup test now uses a finding, which is
  the meaningful duplicate check.
- P3-11: add a direct test for the manual-reflection `SCHEMA_UPGRADE_REQUIRED` mapping (the closure
  lives in `index.ts`); the current `runBounded` test only proves error preservation.
- Repair report: `intent-reading-pending-closure.test.ts` does not contain the claimed degraded-schema
  test; either add it or correct the sentence. Reviewer probe H2 confirms the behavior.
- Machine result `evals/pr-40-audit-findings/results/20261104T065544Z-1662021...-repair.json` still
  says `ci.status=PENDING`; CI 41789069806 on `9aff042` is green. Record it in the final evidence.

## 4. External items

| Item | Status | Reason |
|---|---|---|
| Human naturalness review | PENDING_HUMAN | External |
| Second real provider | NOT_RUN | No credentials |
| Real-machine install/upgrade | PENDING_HUMAN | External |
| Stage 5 live rerun | NOT_RUN | Paid/time-bounded; no new live claim |
| Local Electron smoke | NOT_RUN locally | CI ran the real smoke on Ubuntu and Windows for `9aff042`; both passed |
| Full `npm ci` | NOT_RUN | `npm ci --dry-run` exit 0; CI ran `npm ci` on both platforms |

## 5. Constraints observed at round 3

- At round-3 review time PR #48 was OPEN and PR #40 head was `052bcaa`; PR #49 remains a Draft with
  base `fix/pr-40-audit-findings`.
- No production code, tests, migrations or historical result files were modified by this review.
- The review branch merged `origin/fix/pr-40-audit-findings`; only the review files are changed by
  the review commits.

## 6. Final review after merge (PR #40 head `4284cb1`)

- PR #40: **OPEN**, base `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
  (unchanged), head `4284cb1b6856faf27f5a43dd4980a2c11404b4db`.
- PR #48: **MERGED** at 2026-11-04T07:35:28Z, merge commit `4284cb1`; final PR #48 head
  `bb9e409c7b4fda5c03d3180254363ec66b8cb929` (code `1662021`, plus the round-3 CI-closure evidence).
- Merge tree verification: `4284cb1^{tree}` = `7b2f5391402a241ee8c79c62853b028696af981b` =
  `bb9e409^{tree}`. The merge parents are `052bcaa` (PR #40 previous head) and `bb9e409` (PR #48).
  No merge resolution changed the PR #48 tree.
- Delta from the round-3 reviewed head `9aff042` to the final PR #48 head `bb9e409` is 3 files only:
  `docs/reports/pr-40-audit-findings-evidence-index.md` (+1 CI closure row),
  `docs/reports/pr-40-audit-findings-repair-report.md` (intent-degraded coverage corrected), and the
  new `evals/pr-40-audit-findings/results/20261104T072000Z-1662021...-ci-closure.json`.
  No `src/**`, `tests/**`, migration, schema or historical result file changed.
- Final head contains all 12 fixes: `REFLECTION_RECOVERY_INCOMPLETE` on both outbox branches and
  manual reflection, `SCHEMA_UPGRADE_REQUIRED` manual mapping, sibling route convergence
  (`linked_with_siblings`), `resolveSystem`/`pending.system_dismiss_failed`, `git-metadata`, the
  v47 migration test, the schema gate, and the pending UI result branches.
- CI: run [41793346804](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41793346804) on
  `4284cb1`, conclusion success:
  - Ubuntu `126451574972`: 118 files / 1083 tests; Electron smoke passed
  - Windows `126451574936`: 118 files / 1083 tests; Electron smoke passed
  - Windows upgrade `126451574534`: 9 files / 63 tests; `upgrades a v47 database with pending items
    and keeps them decidable` observed at 07:36:33 (2005ms)
- Independent runs on `4284cb1`: `npx tsc --noEmit` exit 0; `npx vitest run` exit 0, **118 files /
  1083 tests passed**; `npx vitest run src/persistence` exit 0, **9/63**; targeted 13 files exit 0,
  **13 files / 126 tests**; `npm run build` exit 0. Reviewer probes A1/A2/B/C/D/E1-E3/X/S/G/O/H/O2/
  H2/H3 all pass, including O2 (row pending -> done only after the stranded finding is routed).
- Release/main and other PRs: `release/morrow-v2-final-delivery` is still
  `3812b185398c0442fcc0d0ba5b180713cafee1d9`; `main` is still `8b207b7d7b80b91ed4369d02fd6ef7e170b81133`;
  PR #35, #38 and #41 remain OPEN and were not modified. PR #40 was not merged to release/main.
- **Final verdict: PASS_WITH_NON_BLOCKING_BACKLOG.** All 12 findings remain VERIFIED_FIXED; no
  regression found. Remaining backlog: P3-08 DB-not-ready/timeout tests; P3-11 has no direct test of
  the `index.ts` schema mapping; the degraded intent-withdrawal behavior is covered by reviewer probe
  H2 rather than a repository test (the repair report no longer claims the intent test file contains
  it, though it still points at the startup degraded test); the historical round-3 machine result
  still records `ci.status=PENDING`, now superseded by the CI-closure JSON.
