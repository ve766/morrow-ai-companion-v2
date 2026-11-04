# PR #48 repair — independent test and CI evidence, round 3

- Reviewed SHA: `9aff0424606c89dbf9924e2e831015a11b1b58f4`
- Code SHA: `16620217cd0fd1ace9598fd57c74bc6425a6b16f` (evidence commit `9aff042`)
- Base: `052bcaa9c0320ef5e726c7bf66df85a49055628d`
- Review branch: `audit/pr-40-repair-independent-review` (round-2 review commit `fe076ee`; round-3 review commit is the commit containing this file)
- Reviewer environment: Windows 10.0.26200 x64, Node v22.23.2, npm 10.9.8, vitest 5.0.5, Electron 44.9.3
- `TEMP`/`TMP` pointed at `<repo>\.tmp\es` for the runs below.

## 1. SHA map

| Role | SHA | How confirmed |
|---|---|---|
| PR #48 remote head | `9aff0424606c89dbf9924e2e831015a11b1b58f4` | `git ls-remote git@github.com:ve766/morrow-ai-companion-v2.git refs/heads/fix/pr-40-audit-findings`; `gh pr view 48 --json headRefOid` |
| Implementation code commit | `16620217cd0fd1ace9598fd57c74bc6425a6b16f` | `git log`; round-3 repair report |
| Evidence commit | `9aff0424606c89dbf9924e2e831015a11b1b58f4` | `git log`; docs/results added in this commit |
| Round-2 reviewed SHA | `e1219dc07d52c4458d27c9ec2b9adabb6ff2e173` | round-2 review |
| Round-1 reviewed SHA | `e4aad40a6f08300704a07a7d74303bfb2b7c2dd0` | round-1 review |
| PR #48 base | `feat/stage-4-companion-confirmation-closure` @ `052bcaa9c0320ef5e726c7bf66df85a49055628d` | `git rev-parse`; merge-base is ancestor |
| PR #48 diff | 74 files, +6723 / -207 | `git diff --stat 052bcaa..9aff042`; PR metadata |
| PR #40 | OPEN, head still `052bcaa` | `gh pr view 40` |
| PR #46 | OPEN | `gh pr view 46` |
| PR #49 | Draft, base `fix/pr-40-audit-findings`, OPEN | `gh pr view 49` |

The remote head did not drift during the review. No implementation branch was modified.

## 2. Local commands and results

| Command | Exit | Result | Log |
|---|---|---|---|
| `npx tsc --noEmit` | 0 | no diagnostics | `.tmp/review3/logs/tsc.log` (empty) |
| `npx vitest run` | 0 | **118 files / 1083 tests passed**; duration 175.16s | `.tmp/review3/logs/vitest-full.log` |
| `npx vitest run src/persistence` | 0 | **9 files / 63 tests passed**; includes v47 test (2546ms) and both intent-closure tests | `.tmp/review3/logs/vitest-persistence.log` |
| `npx vitest run <13 Stage 4 + review files>` | 0 | **13 files / 126 tests passed** | `.tmp/review3/logs/vitest-targeted.log` |
| `npm run build` | 0 | electron-vite main/preload/renderer built (renderer 90.77 kB JS, 25.61 kB CSS) | `.tmp/review3/logs/build.log` |
| Reviewer reproduction (`esbuild` + Node) | 0 | `SUMMARY failures=0`; probes A1, A2, B, C, D, E1-E3, X, S, G, O, H, O2, H2, H3 | `.tmp/review3/logs/repro.log` |

The 13 targeted files are the round-2 list (11 Stage 4 files + `stage4-outbox-reflection` +
`intent-reading-pending-closure`).

## 3. PR #48 CI on the reviewed head

Run: [41789069806](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41789069806)

- Head SHA: `9aff0424606c89dbf9924e2e831015a11b1b58f4` (run metadata)
- Head branch: `fix/pr-40-audit-findings`; event `pull_request`
- Status `completed`; conclusion `success`; created 2026-11-04T06:58:40Z
- Latest run on the branch; no older run reused.

| Job | ID | Conclusion | Time | Evidence |
|---|---|---|---|---|
| Windows upgrade path (schema migrations under the real app) | 126437949884 | success | 06:58:53 -> 07:00:38 | `npx vitest run src/persistence`; `Test Files 9 passed (9)`, `Tests 63 passed (63)`; at 07:00:05 the exact `upgrades a v47 database with pending items and keeps them decidable` (1815ms) |
| Typecheck, tests, build and smoke (windows-latest) | 126437950111 | success | 06:58:44 -> 07:05:14 | npm ci; tsc; vitest `118 passed (118)` / `1083 passed (1083)`; build; Electron smoke passed |
| Typecheck, tests, build and smoke (ubuntu-latest) | 126437950251 | success | 06:58:43 -> 07:01:27 | vitest `118 passed (118)` / `1083 passed (1083)`; Electron smoke passed |

Logs: `.tmp/review3/logs/ci-job-126437949884.log`, `.tmp/review3/logs/ci-job-126437950111.log`,
`.tmp/review3/logs/ci-job-126437950251.log` (gitignored local copies).

The CI confirms the local full-suite, persistence and build results on Linux and Windows, and the
v47→v48 test in the Windows upgrade job.

## 4. Reviewer reproduction (real SQLite, production modules)

Script `.tmp/review3/repro.ts` (bundled to `.tmp/review3/repro.cjs`; not the implementer's tests).
It uses `SqliteDatabase.open`, `EventLogService`, `KnowledgeGapService`,
`composeStartupReflectionServices`, `runStartupReflection`, `PendingCognitionService`,
`SqlitePendingItemRepository`, `ReflectionFindingRouter`, `CompanionGoalService`,
`IntentReadingRepository`, `CognitionOutbox`, `buildCognitiveProjectors`, `applyMigrations`,
`buildIntentReading` and `concernDigestOf`.

| Probe | Requirement covered | Outcome |
|---|---|---|
| A1 | second startup gap for the same label | PASS: `ran`, `ran`; 1 finding, 1 route, 1 item, 0 stranded |
| A2 | second manual correction (real producer -> router -> SQLite) | PASS: both bounded runs completed; 1 item, 1 route, 1 finding, 0 stranded |
| B | recover a finding stored without a route | PASS: repaired=1 then 0; route `routed` |
| C | v47 open/done rows upgrade + production decide | PASS: schema 48; rows preserved; `integrity_check=ok`; `foreign_key_check=[]`; route consumed; audit `resolved_by_concern` |
| D | legacy route convergence and unresolved audit | PASS: matched consumed; unmatched `routed` + `routeStatus=null/unresolved/routesUpdated=0` |
| E1-E3 | close/reopen real file; candidate/goal/key/pending/route/audit | PASS: all state survives; decide after reopen; replay unchanged; opposite conflict; one decision audit |
| X | legacy item adopted by a post-upgrade F2, then decide | PASS: F1 and F2 both consumed; audit `linked_with_siblings`, `routesUpdated:2` |
| S | audit privacy | PASS: no event/pending payload contains the marker statement |
| G | schema<48 fail-closed | PASS: schema 47, cognitive unavailable, upsert/decide throw `SCHEMA_UPGRADE_REQUIRED`, reads safe, startup degraded |
| O | rate-limited outbox + recovery failure | PASS: first drain `failed=1`, row `pending/attempts=1`, route null; second drain `done`, route routed |
| H | intent withdrawal via real intent-reading save (v48) | PASS: item `dropped/dismissed`, route `dismissed`, `pending.system_dismissed` actor system, zero `pending.decision` |
| O2 | real outbox retry after a transient route/pending failure, NOT rate-limited | PASS (round-3 fix): first drain `failed=1`, row `pending/attempts=1`, route null; second drain `done`, route `routed`, one pending item |
| H2 | intent withdrawal on a degraded v47 schema | PASS: item stays open; one `pending.schema_unavailable` event; reading still saves |
| H3 | intent closure failure then retry | PASS: first withdrawal leaves item open + `pending.system_dismiss_failed`; second writes `dropped/dismissed` + `pending.system_dismissed` |

The exact JSON lines are in `.tmp/review3/logs/repro.log`.

## 5. NOT_RUN / BLOCKED

| Item | Status | Reason |
|---|---|---|
| Full `npm ci` | NOT_RUN | `npm ci --dry-run` exit 0; CI ran `npm ci` on both platforms. A destructive reinstall was not needed. |
| `npm run eval:stage5` / `eval:stage4a` / `eval:stage3` | NOT_RUN by reviewer | New result files and counts/metadata were checked: 12/12, 7/7, 15+1/16; the review did not need to regenerate them. |
| Stage 5 live | NOT_RUN | Provider cost/time; no new live claim. |
| Local Electron smoke | NOT_RUN locally | CI ran the real app smoke on Ubuntu and Windows for `9aff042`; both passed. |
| Human review, second provider, real-machine install | PENDING_HUMAN / NOT_RUN | External, unchanged. |
