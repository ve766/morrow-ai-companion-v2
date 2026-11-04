# PR #40 repair — independent review, round 2 (Issue #47 / PR #48)

- Repository: `ve766/morrow-ai-companion-v2`
- Reviewed implementation PR: [#48](https://github.com/ve766/morrow-ai-companion-v2/pull/48) — OPEN, not merged
- Reviewed head SHA: `e1219dc07d52c4458d27c9ec2b9adabb6ff2e173` (confirmed with `git ls-remote` via SSH and GitHub)
- Implementation code commit: `1f736c6b788527bbffad186267679b1df63ff0a1`; evidence commit: `e1219dc`
- Base branch / base SHA: `feat/stage-4-companion-confirmation-closure` @ `052bcaa9c0320ef5e726c7bf66df85a49055628d`
- Review branch: `audit/pr-40-repair-independent-review` (round-1 commit `db8b2412d37ef454ce4e1c3e7f297c357a7b0589`; round-2 review commit is the commit containing this file)
- Round-2 review time (UTC): 2026-11-04T06:35:02Z
- Reviewer: independent context; did not implement the changes and did not modify production code, tests, migrations or historical results
- Round-1 review: `docs/audit/pr-40-repair-independent-review.md` at `e4aad40` (DO_NOT_MERGE); the three round-1 blockers were P1-01 outbox, P2-03 legacy adoption and P3-07 status-only intent close

## 1. Verdict

**DO_NOT_MERGE**

The three round-1 findings I reproduced are fixed at this head:

- **O** (rate-limited outbox + recovery failure): the row now stays `pending` with `failed` count and completes only after recovery succeeds; schema failures rethrow after recording `cognition.pending_schema_unavailable`.
- **X** (legacy item adopted by a post-upgrade observation): both the original and new routes are now `consumed`, with audit `routeResolution: linked_with_siblings` and `routesUpdated: 2`.
- **H / H2** (intent withdrawal): the item is closed as a system `dismissed` decision, the same-concern route is `dismissed`, `pending.system_dismissed` is written with actor `system`, and the degraded schema leaves the item open with `pending.schema_unavailable`.

The full local suite (118 files / 1080 tests), persistence suite (9/62), targeted 13-file suite (13/123), typecheck and build all pass; CI run 41783721663 on `e1219dc` is green on Ubuntu, Windows and the Windows upgrade job.

One P1-class retry path is still open, and I reproduced it with the real outbox, real reflection service and real router:

- **Outbox retry when the reflection run is NOT rate-limited.** First drain: a real transient route/pending write failure makes the projector throw; the row stays `pending` (`attempts=1`), and the finding has no route. Second drain: `reflection.run('post_conversation')` runs again, finds no new findings (the cursor advanced), `ingestRun([])` succeeds, and the projector returns. The outbox marks the row `done` (`attempts=1`) while the finding's route is still `null`. The finding has a durable `reflection.finding_ingest_failed` record and can be repaired by a later startup or a rate-limited recovery, but the outbox obligation is already `done` and no outbox retry occurs. This is the required "routing temporarily fails, then retry" case; the new `stage4-outbox-reflection` test only simulates the rate-limited branch with a fake `recover` function and does not exercise this real-router path. Source: `src/app/companion-service.ts` success branch at lines 1030-1044 does not call `recoverUnrouted`; recovery is only in the skipped branch at 1022-1028.

Two P3-level items also remain: the round-2 claim that manual reflection maps schema errors to `SCHEMA_UPGRADE_REQUIRED` is not implemented (`src/app/index.ts:457-467` still throws `ApplicationError('STORAGE_ERROR')`; the imported `PendingSchemaUnavailableError` is unused), and the repair report/acceptance matrix claim that mapping. These are non-blocking but the evidence is inaccurate.

## 2. Round-1 finding outcomes at `e1219dc`

| ID | Severity | Status | Evidence |
|---|---|---|---|
| AUD45-P1-01 | P1 | **STILL_OPEN (partial)** | Rate-limited recovery path fixed (probe O: pending -> done, route routed); re-observation/second-gap path fixed (A1/A2/B); **non-rate-limited outbox retry still completes with an unrouted finding (probe O2)**. Required real-router outbox regression absent. |
| AUD45-P2-03 | P2 | **VERIFIED_FIXED** | Probe X: legacy item adopted by F2; decide consumes F1 and F2; audit `linked_with_siblings/routesUpdated:2`; test `converges every route of a legacy concern adopted by a later observation`. |
| AUD45-P3-07 | P3 | **VERIFIED_FIXED** | Probe H: item `dropped/dismissed`, route `dismissed`, `pending.system_dismissed` actor `system`, no forged `pending.decision`; probe H2: degraded schema leaves item open and records `pending.schema_unavailable`; `IntentReadingRepository` now requires the audit sink and all construction sites inject it. |

## 3. Full per-finding matrix (all 12)

| ID | Severity | Status | Source / symbol | Tests and independent evidence | Note |
|---|---|---|---|---|---|
| AUD45-P1-01 | P1 | **STILL_OPEN** | `reflection-concern.ts`; `reflection-mapping.ts:79-84`; `pending-items.ts:310-343`; `reflection-routing.ts:157-219,255-298`; `companion-service.ts:1006-1044` | A1/A2/B pass; O passes (rate-limited recovery keeps row pending then repairs); **O2 fails** (non-rate-limited retry marks done, route null). Tests: `reflection-routing` second-concern/failure-isolation/recovery; `stage4-startup-composition` second gap; `stage4-reflection-producer` second correction; `stage4-outbox-reflection` two projector-level tests (fake `recover`) | Core second-gap/correction and rate-limited path are fixed. Remaining P1: successful retry does not run recovery, so a durable failed finding can stay unrouted while the row is done until a later startup/rate-limited pass. |
| AUD45-P2-02 | P2 | **VERIFIED_FIXED** | `migrations.test.ts:549-610`; `.github/workflows/ci.yml:75`; `stage-4-migration-verification.md:24` | Local persistence 9 files / 62 tests; CI job 126420936201 at 06:10:50 has the exact v47 test (1972ms), 9 files / 62 tests | v47 fixture with open/done rows, run/finding/route; upgrade and production decide. |
| AUD45-P2-03 | P2 | **VERIFIED_FIXED** | `cognitive-context-repository.ts:233-281,382-411`; `reflection-routing.ts:285` | Probe C/D still pass; probe X now passes: original and new routes consumed, audit `linked_with_siblings`, `routesUpdated:2`; test `converges every route of a legacy concern adopted by a later observation` | Sibling convergence is applied to every decision; exact route first, then provable same-concern routes. |
| AUD45-P2-04 | P2 | **VERIFIED_FIXED** | `stage4-restart-consistency.integration.test.ts`; two acceptance matrices | Probe E1/E2/E3 close/reopen real file, candidate/goal/creation key/pending/route/audit; decide after reopen; second reopen | No regression. |
| AUD45-P2-05 | P2 | **VERIFIED_FIXED** | `git-metadata.ts`; stage-5/4a run | New round-2 results: Stage 5 `branch=fix/pr-40-audit-findings, ok, clean`; Stage 4-A same branch, `dirty` documented; Stage 3 no branch field; historical result files only added | No regression; old results untouched. |
| AUD45-P3-06 | P3 | **VERIFIED_FIXED** | `PendingAuditSink` required; all construction sites | `tsc --noEmit` 0; `pending-items.test.ts` compile/runtime; `IntentReadingRepository` also now requires the sink | No no-op sink found in production. |
| AUD45-P3-07 | P3 | **VERIFIED_FIXED** | `pending-items.ts:97-105,373-384`; `cognitive-context-repository.ts:307-380`; `intent-reading-repository.ts:186-220` | Probe H/H2; `intent-reading-pending-closure.test.ts`; `pending-items.test.ts` boundary tests | Status-only path removed; system closure writes decision/route/audit. Note: non-schema closure errors now abort the intent-reading save (fail-closed; no test). |
| AUD45-P3-08 | P3 | **VERIFIED_FIXED** (coverage gaps) | `startup-composition.ts:42-160`; `index.ts:367-375` | skipped/producer-failure/partial-ingest/schema tests; new lifecycle-audit-failure and repeated-startup tests | Repeated-startup test uses a no-finding DB (weak); DB-not-ready and timeout tests still absent. |
| AUD45-P3-09 | P3 | **VERIFIED_FIXED** | `reflection-service.ts:629-670` | Source review + tsc | Correct docstrings, no algorithm change. |
| AUD45-P3-10 | P3 | **VERIFIED_FIXED** | `validation.ts`; `contracts.ts`; `ipc.ts`; `preload/index.ts` | Repository grep; tsc 0 | No references remain. |
| AUD45-P3-11 | P3 | **VERIFIED_FIXED** (claimed extra absent) | `cognitive-context-repository.ts:139-141`; `pending-items.ts:77-84`; `ipc.ts:175,197`; `companion-service.ts:2406-2420` | Probe G; `pending-schema-gate.test.ts`; `ipc.test.ts`; probe H2 | Repository gate/IPC/ChatService/startup/outbox are fixed. **Round-2 claim not implemented:** manual reflection still throws `ApplicationError('STORAGE_ERROR')` (`index.ts:457-467`); the imported `PendingSchemaUnavailableError` is unused, and the repair report/acceptance matrix claim the mapping. |
| AUD45-P3-12 | P3 | **VERIFIED_FIXED** | `pending-ui.ts:52-119`; `index.html:159` | `tests/pending-ui.test.ts` 5 branches | No regression. |

## 4. Blocking condition

1. **P1-01 outbox retry, non-rate-limited path.** Call `recoverUnrouted()` after every successful reflection run (not only on a rate-limit skip), and throw `REFLECTION_RECOVERY_INCOMPLETE` if it returns `failed > 0`. Add a real-router/real-SQLite regression: transient pending/route write failure on the first drain, drop the failure, second drain must not complete the row until `recoverUnrouted()` has routed the finding. Current source: `src/app/companion-service.ts:1030-1044`; probe O2.

The remaining P3 items do not block on their own: manual-reflection schema mapping (P3-11 claim), missing DB-not-ready/timeout tests (P3-08), and the stale `8 files / 61 tests` row in the acceptance matrix (actual 9/62).

## 5. External items

| Item | Status | Reason |
|---|---|---|
| Human naturalness review | PENDING_HUMAN | External |
| Second real provider | NOT_RUN | No credentials |
| Real-machine install/upgrade | PENDING_HUMAN | External |
| Stage 5 live rerun | NOT_RUN | Paid/time-bounded; no new live claim |
| Local Electron smoke | NOT_RUN locally | CI ran the real smoke on Ubuntu and Windows for `e1219dc`; both passed |
| Full `npm ci` | NOT_RUN | `npm ci --dry-run` exit 0; CI ran `npm ci` on both platforms |

## 6. Constraints observed

- PR #48 remains OPEN; PR #40 and PR #46 remain OPEN; PR #40 head is still `052bcaa`; PR #49 remains a Draft with base `fix/pr-40-audit-findings`.
- No production code, tests, migrations or historical result files were modified by this review.
- The review branch merged `origin/fix/pr-40-audit-findings`; only the five review files are changed by the review commits.
