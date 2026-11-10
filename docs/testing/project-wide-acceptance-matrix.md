# Project-wide acceptance matrix (Issue #81)

Code SHA under test: `60ae6fe11e751bd7e5b80df942d231eade98b8eb`.
Branch: `fix/morrow-project-wide-final-convergence-20261110`.
Environment: Windows 10.0.26200 x64, Node 22.23.2, Electron 44.9.3.
Logs: `docs/reports/results/project-wide/run-20261110T0630Z-60ae6fe/`.

Status is deliberately not a single PASS for the whole task. `PASS` means the
named scenario was executed; `PARTIAL` means it ran but a named sub-scenario is
missing; `BLOCKED_*` and `PENDING_HUMAN` are not green.

| # | Scenario | Command / evidence | Result |
| ---: | --- | --- | --- |
| 1 | Source and recursive DAG: derived chain, cycle, broken chain, retracted root, cross-owner, forged root/cluster, deleted memory subject, same root ×100 | `npx vitest run src/self-model/reflection-state-gate.test.ts` (14 tests) | **PASS** |
| 2 | Deletion: conversation delete removes mood contribution and replays the rest; live state revalidation downgrades/retracts | `npx vitest run src/affective-state/mood-service.test.ts` (7 tests), gate test 8 | **PARTIAL**: reflection finding/route row purge is still missing |
| 3 | Outbox: assistant commit and inner observation are one transaction; crash/retry behavior | `npx vitest run src/app/stage3-remediation.integration.test.ts src/app/b4-recovery.integration.test.ts` | **PARTIAL**: transactional, no lease/dead-letter row for this obligation |
| 4 | Mood: pause/resume, clock rollback, reopen, single-source deletion, replay idempotency | mood-service tests | **PASS** |
| 5 | Personality: user style only G2; G1 unchanged; restart continuity | `npx vitest run src/app/stage3-remediation.integration.test.ts` (6 tests, D-1) | **PARTIAL**: separation PASS, no intrinsic G1 writer |
| 6 | Investigation: full transitions, illegal transition, hypotheses, evidence validity, deadline suspension/resume, reopen | `npx vitest run src/self-model/investigation.test.ts` (6 tests) | **PARTIAL**: durable state machine PASS, no autonomous external evidence collector |
| 7 | Retrieval: fixed dataset 100/500/1000/5000, Recall@5, MRR, misrecall, leaks, p50/p95 | `scripts/memory-retrieval-benchmark.ts`, raw JSON | **PARTIAL**: lexical benchmark PASS; semantic channel `BLOCKED` by no ONNX model/runtime |
| 8 | Chat UI: renderer → preload → IPC → ChatService → loopback SSE → SQLite | `npm run smoke:chat-ui` (built app); packaged smoke against `C:\morrow81test\Morrow.exe` and portable exe | **PASS** (see consent note in #9) |
| 9 | Provider: real cloud non-stream + SSE, or precise block | no `MORROW_TEST_API_KEY`, no `DEEPSEEK_API_KEY` in the environment | **BLOCKED_NO_SECRET** for cloud; loopback contract path PASS |
| 10 | Native consent dialog interaction | packaged smoke logs `auto:false`, `grant:false`, then a remembered grant after ~5s; no human click was independently observed | **PENDING_HUMAN** (do not read the chat PASS as consent-UX acceptance) |
| 11 | Windows: install, start, chat, uninstall in isolation | installer `C:\morrow-out\Morrow-2.0.0-x64-custom-setup.exe`; install `/S /D=C:\morrow81test`, exit 0; smoke PASS; uninstall `/S`, exit 0, directory removed | **PASS** for BUILT + INSTALL_VERIFIED + APP_STARTED + CHAT_VERIFIED + UNINSTALL_VERIFIED |
| 12 | Portable ZIP | extracted to `C:\morrow81portable`, smoke PASS | **PASS** |
| 13 | Regression: typecheck, full suite twice, build | `npm run typecheck`; `npx vitest run` ×2 green; `npm run build` | **PASS** (logs in results directory) |
| 14 | CI | Both workflows are `workflow_dispatch` only (GitHub-hosted minutes exhausted; self-hosted needs a runner token that this task must not request). `gh pr checks 82` reports no checks. | **NOT_RUN** (external constraint, not PASS) |

## Package evidence

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Morrow-2.0.0-x64-custom-setup.exe` | 158,332,209 | `80c15fb5aac6e54bd1aab92226b31c345ea9d490da6f33f751b5e570c202f7a9` |
| `Morrow-2.0.0-x64-portable-final.zip` | 162,762,914 | `276cc9aba550fdc62d0cbd266fe970797e257013229fc463723309c4fe48148c` |

Both were built from `out/` produced at code SHA `60ae6fe`. Paths:
`C:\morrow-out\` and `release/` on the build machine; they are not committed.

## Isolation

- Install directory: `C:\morrow81test` (new, removed by uninstall).
- Portable: `C:\morrow81portable` (new).
- App data: `.tmp/*-profile*` and `C:\Users\Hasee\AppData\Roaming\Morrow` as
  created by the acceptance runs; no V1 path (`F:\morrow1`) was touched.
- No existing V2 user data was reset, migrated or cleared.
