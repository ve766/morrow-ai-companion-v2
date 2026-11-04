# PR #48 repair — independent test and CI evidence

- Reviewed SHA: `e4aad40a6f08300704a07a7d74303bfb2b7c2dd0`
- Code SHA: `dd9f59b10c7c812c3af36684a32d15193bda7d50`
- Base: `052bcaa9c0320ef5e726c7bf66df85a49055628d`
- Review branch: `audit/pr-40-repair-independent-review` (created from the actual reviewed SHA)
- Reviewer environment: Windows 10.0.26200 x64, Node v22.23.2, npm 10.9.8, vitest 5.0.5, Electron 44.9.3
- `TEMP`/`TMP` pointed at `<repo>\.tmp\es` for the runs below.

## 1. SHA map

| Role | SHA | How confirmed |
|---|---|---|
| PR #48 remote head | `e4aad40a6f08300704a07a7d74303bfb2b7c2dd0` | `git ls-remote git@github.com:ve766/morrow-ai-companion-v2.git refs/heads/fix/pr-40-audit-findings`; `gh pr view 48 --json headRefOid` |
| Local review base (same commit) | `e4aad40a6f08300704a07a7d74303bfb2b7c2dd0` | `git rev-parse HEAD` after checkout |
| Implementation code commit | `dd9f59b10c7c812c3af36684a32d15193bda7d50` | `git log`, PR metadata, repair report |
| PR #48 base branch | `feat/stage-4-companion-confirmation-closure` @ `052bcaa9c0320ef5e726c7bf66df85a49055628d` | `git rev-parse feat/stage-4-companion-confirmation-closure`; merge-base is ancestor |
| PR #48 diff | 57 files, +3507 / -190 | `gh pr view 48 --json files`; local `git diff --stat 052bcaa..e4aad40` (identical) |
| PR #40 | OPEN, head still `052bcaa9c0320ef5e726c7bf66df85a49055628d` | `gh pr view 40` |
| PR #46 | OPEN | `gh pr view 46` |

The remote head did not drift during the review. No implementation branch was modified.

## 2. Local commands and results

| Command | Exit | Result | Log |
|---|---|---|---|
| `node -v` / `npm -v` / `npx vitest --version` | 0 | v22.23.2 / 10.9.8 / 5.0.5 | terminal |
| `npm ci --dry-run` | 0 | `added 50 packages` (only optional cross-platform Rollup/esbuild binaries; no lockfile conflict; postinstall ran `ensure-electron`). Treated as install-tree verification, not a full reinstall. | `.tmp/review/logs/npm-ci-dry-run.log` |
| `npx tsc --noEmit` | 0 | no diagnostics | `.tmp/review/logs/tsc.log` (empty) |
| `npx vitest run` | 0 | **116 files / 1073 tests passed**; duration 165.54s | `.tmp/review/logs/vitest-full.log` |
| `npx vitest run src/persistence` | 0 | **8 files / 61 tests passed**; includes `upgrades a v47 database with pending items and keeps them decidable` (1378ms) | `.tmp/review/logs/vitest-persistence.log` |
| `npx vitest run <11 Stage 4 files>` | 0 | **11 files / 116 tests passed** | `.tmp/review/logs/vitest-targeted.log` |
| `npm run build` | 0 | electron-vite main/preload/renderer built (renderer 90.77 kB JS, 25.61 kB CSS) | `.tmp/review/logs/build.log` |
| Reviewer reproduction script (`esbuild` bundle + Node) | 0 | `SUMMARY failures=0`; 12 probes A1, A2, B, C, D, E1-E3, X, S, G, O, H | `.tmp/review/logs/repro.log` |

The 11 targeted files were:
`src/cognition/reflection-routing.test.ts`, `src/cognition/pending-items.test.ts`,
`src/motivation/goal-lifecycle.test.ts`, `src/app/ipc.test.ts`,
`src/app/stage4-startup-composition.integration.test.ts`,
`src/app/stage4-reflection-producer.integration.test.ts`,
`src/app/stage4-goal-candidate-e2e.test.ts`,
`src/app/stage4-restart-consistency.integration.test.ts`,
`tests/goal-candidates-ui.test.ts`, `tests/pending-ui.test.ts`,
`src/persistence/pending-schema-gate.test.ts`.

These counts match the repair report's `116/1073`, `8/61` and `11 files / 116 tests` exactly.

## 3. PR #48 CI on the reviewed head

Run: [41778144360](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41778144360)

- Head SHA: `e4aad40a6f08300704a07a7d74303bfb2b7c2dd0` (run metadata)
- Head branch: `fix/pr-40-audit-findings`
- Event: `pull_request`; status `completed`; conclusion `success`; created 2026-11-04T05:15:32Z
- This is the latest run on the head branch; no older run was used.

| Job | ID | Conclusion | Time | Evidence |
|---|---|---|---|---|
| Typecheck, tests, build and smoke (ubuntu-latest) | 126403195893 | success | 05:15:35 -> 05:19:00 | npm ci --ignore-scripts; tsc; vitest `116 passed (116)` / `1073 passed (1073)`; build; Electron smoke passed (log line 667) |
| Typecheck, tests, build and smoke (windows-latest) | 126403196220 | success | 05:15:35 -> 05:23:31 | npm ci; tsc; vitest `116 passed (116)` / `1073 passed (1073)`; build; Electron smoke passed (log line 1103) |
| Windows upgrade path (schema migrations under the real app) | 126403196244 | success | 05:15:35 -> 05:17:38 | `npx vitest run src/persistence`; `Test Files 8 passed (8)`, `Tests 61 passed (61)`; log at 05:17:08 has `v48 pending decision terminal state (1)` and the exact test `upgrades a v47 database with pending items and keeps them decidable` (1699ms); step name is `Persistence and migration tests (up to the current schema, includes v47 feature paths)` |

Logs: `.tmp/review/logs/ci-job-126403195893.log`, `.tmp/review/logs/ci-job-126403196220.log`,
`.tmp/review/logs/ci-job-126403196244.log` (gitignored local copies).

The CI confirms this review's local full-suite, persistence and build results on both Linux and
Windows, and confirms the v47→v48 test actually runs in the Windows upgrade job.

## 4. Reviewer reproduction (real SQLite, production modules)

Script `.tmp/review/repro.ts` (bundled to `.tmp/review/repro.cjs`; not the implementer's tests).
It uses `SqliteDatabase.open`, `EventLogService`, `KnowledgeGapService`,
`composeStartupReflectionServices`, `runStartupReflection`, `PendingCognitionService`,
`SqlitePendingItemRepository`, `ReflectionFindingRouter`, `CompanionGoalService`,
`IntentReadingRepository`, `CognitionOutbox`, `buildCognitiveProjectors`, `applyMigrations`, and
`buildIntentReading`.

| Probe | Requirement covered | Outcome |
|---|---|---|
| A1 | second startup gap for the same label | PASS: `ran`, `ran`; 1 finding, 1 route, 1 item, 0 stranded |
| A2 | second manual correction (real producer -> router -> SQLite) | PASS: both bounded runs completed; 1 item, 1 route, 1 finding, 0 stranded; no `STORAGE_ERROR` |
| B | recover a finding stored without a route | PASS: repaired=1 then 0; route `routed` |
| C | v47 open/done rows upgrade to v48 and decide via production repository | PASS: schema 48; columns present; rows preserved; `integrity_check=ok`; `foreign_key_check=[]`; item done; route consumed; audit `resolved_by_concern` |
| D | legacy route convergence and unresolved audit | PASS: matched route consumed; unmatched route stays `routed` with `routeStatus=null/unresolved/routesUpdated=0` |
| E1-E3 | close/reopen real file; candidate/goal/creation key/pending/route/audit | PASS: all state survives; decide after reopen; replay unchanged; opposite conflict; one decision audit; second reopen keeps terminal state |
| X | v47 legacy item + F1 route + post-upgrade re-observation F2 + decide | **FAIL against the P2-03 invariant**: item done; F2 consumed; original F1 route still `routed`; audit `linked`, no explanation of F1 |
| S | audit privacy | PASS: no event payload or pending summary/detail contains the marker statement |
| G | schema<48 fail-closed | PASS: schema 47, cognitive unavailable, upsert/decide throw `SCHEMA_UPGRADE_REQUIRED`, reads safe, startup degraded |
| O | rate-limited outbox with a transient recovery failure | **FAIL against the P1-01 outbox contract**: outbox `done`, attempts 0, finding route `null`; later manual recovery repaired it |
| H | intent-reading `stop_previous` closes a legacy open_question item | **FAIL against the P3-07 boundary**: item done, decision null, route routed, no decision audit; later decide returns `conflict/current=null` |

The exact JSON lines are in `.tmp/review/logs/repro.log`. The failures are reproducible against the
production functions, not only by reading code.

## 5. NOT_RUN / BLOCKED

| Item | Status | Reason |
|---|---|---|
| Full destructive `npm ci` | NOT_RUN | `npm ci --dry-run` exit 0; a full reinstall would rebuild Electron and is not needed to trust the checked-out tree. CI ran `npm ci` on both platforms. |
| `npm run eval:stage5` / `eval:stage4a` / `eval:stage3` | NOT_RUN by reviewer | Existing new results and their counts/metadata were checked; this review did not need to regenerate expensive eval outputs. The repair's result files are internally consistent (12/12, 7/7, 15+1/16). |
| Stage 5 live | NOT_RUN | Provider cost/time; no new live claim is made by this review. |
| Local Electron smoke | NOT_RUN locally | CI ran the real app smoke on Ubuntu and Windows for `e4aad40`; both passed. |
| Human review, second provider, real-machine install | PENDING_HUMAN / NOT_RUN | External, unchanged. |
