# Morrow V2 Windows RC File Review Matrix — Final Artifact Verification (Issue #55, PR #54, code `fad6a94`, HEAD `84481f8`)

Independent reviewer: separate context; did not write this implementation. Only this file and `docs/audit/morrow-v2-rc-independent-review.md` were updated. No product code, test, migration, CI, existing doc, evidence, or RC binary was modified. The worktree was clean before the review; after the review the only changes are the two updated review documents.

## 0. Scope and method

- Frozen RC HEAD: `84481f83383613c01e9ca35bc9700d54d23314e2`.
- RC code/test SHA: `fad6a94eef19ce5cfbdca9f4c0e1af0aca08074c` (unchanged since `fad6a94`; `84481f8` is docs/binary only).
- Previous reviewed HEAD: `e0fbbcff0a9fbfebd6dd50a293d877060de74d75` (the wrapper-only stale artifact).
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`.
- `84481f8` delta: 11 files — the rebuilt portable, checksum, result, transcript, 5 RC docs, and the 2 prior audit docs.
- Evidence: binary hash/size/PE, 7z payload/asar extraction, embedded copy/CSS probes, fresh-build diff, CI run `42025990645` API queries. The full test suite was run on the unchanged code SHA `fad6a94` (129 files / 1156 tests / 0 skipped, exit 0); typecheck/build/evaluations also pass on the same code.

## 1. `84481f8` final docs/binary delta (11 files)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 1 | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` | Rebuilt portable | **PASS** — 100,542,249 bytes, SHA256 `e18a13a5…40c1b`; real PE32 NSIS+7z; new payload/asar; new copy/CSS present, old absent. Prior P1 closed. |
| 2 | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe.sha256` | New checksum | **PASS** — matches the new binary. |
| 3 | `evals/morrow-v2-rc/results/20261105T195500Z-rc-fad6a94.json` | New hash/size/builtAt | **PASS** — 100,542,249 / `e18a13a5…40c1b` / `builtAt 2026-11-05T20:15:00Z`; PARTIAL and blockers honest. |
| 4 | `evals/morrow-v2-rc/transcripts/20261105T195500Z-rc-fad6a94.md` | New hash/size | **PASS with P3** — hash/size updated; BLOCKED section still says “CI on `ac00627`”. |
| 5 | `docs/reports/morrow-v2-rc-delivery-report.md` | New hash/size | **PASS with P3** — new hash/size; CI cause still generic, no run `42025990645`. |
| 6 | `docs/reports/morrow-v2-rc-evidence-index.md` | New hash/size, build time, billing annotation | **PASS with P3** — build time now `20:15:00Z` and matches the result; CI table still stops at `ac00627`. |
| 7 | `docs/reports/morrow-v2-rc-work-log.md` | New size | **PASS with P3** — size updated; CI cause generic. |
| 8 | `docs/testing/morrow-v2-rc-acceptance-matrix.md` | New hash/size | **PASS** — row 6 now uses `e18a13a5…40c1b`; the prior old-hash inconsistency is fixed. |
| 9 | `docs/install/windows-installation-guide.md` | New hash/size | **PASS** — new hash/size; NSIS/launch limits honest. |
| 10 | `docs/audit/morrow-v2-rc-independent-review.md` | Prior delta review | Superseded by this final verification; now documents `84481f8`. |
| 11 | `docs/audit/morrow-v2-rc-file-review-matrix.md` | Prior delta matrix | Superseded by this final matrix; now documents `84481f8`. |

## 2. `fad6a94` source-fix delta (7 files, unchanged)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 12 | `scripts/smoke.mjs` | `dataPolicy` assertion fixed | **PASS** — matches `src/app/index.ts:77`; prior CI smoke defect closed. |
| 13 | `src/renderer/index.html` | Local/cognitive copy fixed | **PASS** — new copy present in source and in the final binary; old copy absent. |
| 14 | `src/renderer/src/style.css` | 1320px rule + `.pending-item-meta` wrapping | **PASS** — present in source and in the final binary (`index-Bj03RVHd.css`, `1320px`, 6 `overflow-wrap`). |
| 15 | `docs/ui/design-system.md` | `#66676d` + contrast wording | **PASS** — matches the code; 4.95 on `#f3f0e8` (4.649 on `#ede9df`). |
| 16 | `scripts/product-path-smoke.mjs` | Per-row `{ key, reason }` | **PASS structurally; P3** — per-row shape, but reason is still table-level; unexecuted on RC SHA. |
| 17 | `docs/audit/morrow-v2-rc-independent-review.md` | Prior audit | Superseded by this final verification. |
| 18 | `docs/audit/morrow-v2-rc-file-review-matrix.md` | Prior matrix | Superseded by this final matrix. |

## 3. Carried-forward RC code delta `ac00627`/`df8f802` (19 files, unchanged)

The prior conclusions still hold; the final artifact now contains the `fad6a94` renderer fixes.

| # | File | One-line conclusion |
| --- | --- | --- |
| 19 | `evals/provider-multi-source/run.ts` | dataPolicy fixture updated; harness-only; PASS. |
| 20 | `src/app/backup-ipc.test.ts` | dataPolicy fixture updated; PASS. |
| 21 | `src/app/companion-service.ts` | discovery limit exactly 1,048,576; PASS. |
| 22 | `src/app/index.ts` | dataPolicy + consent Bearer copy corrected; PASS. |
| 23 | `src/app/ipc.test.ts` | dataPolicy fixture updated; PASS. |
| 24 | `src/app/provider-multi-source-ipc.integration.test.ts` | dataPolicy fixture updated; PASS. |
| 25 | `src/app/provider-multi-source.integration.test.ts` | oversized header 1,048,577; PASS. |
| 26 | `src/app/stage4-goal-candidate-e2e.test.ts` | dataPolicy fixture updated; PASS. |
| 27 | `src/providers/openai-compatible.test.ts` | non-stream oversized + valid; PASS with P3 (missing exact/UTF-8/empty/parse-failure). |
| 28 | `src/providers/openai-compatible.ts` | bounded non-stream 1 MiB; PASS with P3 redundant catch. |
| 29 | `src/renderer/src/companion-ui.ts` | 3 “模型服务请求” copy fixes; PASS. |
| 30 | `src/renderer/src/presence-ui.ts` | reduced-motion static draw; PASS. |
| 31 | `src/renderer/src/provider-profiles-ui.ts` | providerUiReady after load, builtin delete disabled, disarm on edit/card; save not; PASS with P3. |
| 32 | `src/shared/contracts.ts` | dataPolicy union updated; PASS. |
| 33 | `tests/design-tokens.test.ts` | WCAG test for bg/panel both themes; PASS (bg-soft untested but 4.649). |
| 34 | `tests/provider-profiles-ui.test.ts` | builtin local delete disabled test; PASS. |
| 35 | `src/renderer/index.html` (carried) | prior B2 fixes; now also fixed in `fad6a94`; source and binary PASS. |
| 36 | `src/renderer/src/style.css` (carried) | prior B1 fixes; now also fixed in `fad6a94`; source and binary PASS. |
| 37 | `scripts/product-path-smoke.mjs` (carried) | prior B3 fixes; now per-row; source PASS, unexecuted. |

## 4. Summary

| Category | Files | Verdict |
| --- | --- | --- |
| `84481f8` final docs/binary | 11 | artifact **PASS**; docs P3 residual |
| `fad6a94` source fixes | 7 | PASS (1 structural P3) |
| Carried-forward RC code delta | 19 | unchanged; PASS with P3 residuals |
| Overall code review | — | **PASS_WITH_NON_BLOCKING_BACKLOG** |
| Overall RC | — | **PARTIAL** (NSIS/install/CI/external blockers) |

The prior P1 artifact finding and the prior P2 acceptance-matrix hash finding are closed. The final portable contains the new copy and CSS; the remaining blockers are NSIS/install/launch, billing-blocked CI, parent-code screenshots, and P3 backlog items.
