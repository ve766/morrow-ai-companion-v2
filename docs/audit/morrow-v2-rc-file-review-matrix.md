# Morrow V2 Windows RC File Review Matrix (Issue #55, PR #54, frozen HEAD `29d4645`)

Independent reviewer: separate context; did not write this implementation. Only this file and `docs/audit/morrow-v2-rc-independent-review.md` were written. No product code, test, migration, CI, existing doc, evidence, or RC binary was modified. The worktree was clean before the review; after the review the only changes are the two new review documents (untracked).

## 0. Scope and method

- Frozen RC HEAD: `29d464545d081836c4aa36e76e2b9f950b020f2f`.
- RC code/test SHA: `ac00627d0dc50677fc3b21ab0ae19c29f08fe9f7`.
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`.
- `29d4645`'s parent is `ac00627`. `git diff ac00627 29d4645` contains **only docs/evidence/installer** (25 files, no production code). The RC code delta is `ac00627` vs its parent `ff5b787` (17 files), plus the adjacent `df8f802` discovery-limit fix (2 files). Both are listed below so every production file changed in this RC round is covered.
- Evidence used: `git diff --name-status eac8fbd 29d4645` (46 files), `git diff ff5b787 ac00627` (17 files), `git diff eac8fbd df8f802` (2 files), `git diff ac00627 29d4645` (25 files); full `npx vitest run` (129 files / 1156 tests / 0 skipped, exit 0); targeted 4 files / 31 tests (exit 0); `npx tsc --noEmit` (0); `npm run build` (0); `npm run evaluate` and `npm run evaluate:cognition` (0 with `TEMP`/`TMP` set to `<repo>/.tmp/es`); `node --check scripts/product-path-smoke.mjs` (0).

## 1. Production / test / script files — RC code delta `ff5b787..ac00627` (17 files)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 1 | `evals/provider-multi-source/run.ts` | `dataPolicy` fixture literal updated | Harness-only fixture update; consistent with the new `AppInfo` union; PASS. |
| 2 | `scripts/product-path-smoke.mjs` | Tautology removed; real restart baseline read; goal task/progress fixture; per-table reason + added-row keys | B3 is materially improved and syntactically valid, but the new script is not executed on the RC SHA and the allowlist is table-level, not per-field; **PARTIAL**. |
| 3 | `src/app/backup-ipc.test.ts` | 3 `dataPolicy` fixture literals updated | Test fixture only; full suite passes; PASS. |
| 4 | `src/app/index.ts` | `dataPolicy` generalized; consent Bearer sentence corrected for local HTTP | Both B2 fixes are correct and user-visible; PASS. |
| 5 | `src/app/ipc.test.ts` | `dataPolicy` fixture updated | Test fixture only; PASS. |
| 6 | `src/app/provider-multi-source-ipc.integration.test.ts` | `dataPolicy` fixture updated | Test fixture only; PASS. |
| 7 | `src/app/stage4-goal-candidate-e2e.test.ts` | `dataPolicy` fixture updated | Test fixture only; PASS. |
| 8 | `src/providers/openai-compatible.test.ts` | Added non-stream oversized (1,048,577) reject + valid JSON parse | Covers the primary B4 regression; missing exact-1-MiB/UTF-8/empty/parse-failure adapter cases; PASS with P3. |
| 9 | `src/providers/openai-compatible.ts` | Non-stream success uses `readBoundedText(1_048_576)`; redundant catch branch | Real byte-counted 1 MiB bound, cancel, UTF-8, no body leak; PASS with P3 style/coverage. |
| 10 | `src/renderer/index.html` | Local-priority caveat added at line 377 | B2 incomplete: line 369 still claims unconditional local priority and line 395 still says “DeepSeek 发送”; both ship in `app.asar`; **PARTIAL**. |
| 11 | `src/renderer/src/companion-ui.ts` | 3 “DeepSeek 请求” strings generalized to “模型服务请求” | B2 copy fixed in all 3 locations; PASS. |
| 12 | `src/renderer/src/presence-ui.ts` | Reduced-motion path draws once and stops the rAF loop; resize/pointer redraw | No continuous redraw under reduced motion; PASS. |
| 13 | `src/renderer/src/provider-profiles-ui.ts` | `providerUiReady` set after `loadProfiles()` finally; built-in delete disabled; disarm on edit/card click | Real loading state and built-in guard are correct; `save()` does not disarm delete; PASS with P3. |
| 14 | `src/renderer/src/style.css` | Range focus ring; light `--muted:#66676d`; wrapping for chat/memory/suggestion/goal/provider facts; 390 nav wrap and self-model single column; ≤1180 chat height | Contrast passes (4.649–5.636); 1280 composer unchanged and `.pending-item-meta` unwrapped; PASS with P3. |
| 15 | `src/shared/contracts.ts` | `AppInfo.dataPolicy` union value updated | Type is consistent with `src/app/index.ts`; PASS. |
| 16 | `tests/design-tokens.test.ts` | New WCAG contrast test for both themes (bg + panel) | Recomputable guard; does not test `--bg-soft` (`#ede9df`, 4.649) but actual value passes; PASS. |
| 17 | `tests/provider-profiles-ui.test.ts` | New built-in local delete-disabled test | Asserts `disabled` and the reason title; PASS. |

## 2. Adjacent RC-chain files — discovery 1 MiB fix `eac8fbd..df8f802` (2 files)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 18 | `src/app/companion-service.ts` | `MAX_DISCOVERY_BODY_BYTES` 1,000,000 → 1,048,576 | Exact 1 MiB restored; PASS. |
| 19 | `src/app/provider-multi-source.integration.test.ts` | Oversized `Content-Length` header 1,000,001 → 1,048,577 | Boundary test matches the exact limit; PASS. |

## 3. Files added/changed by the frozen docs/binary commit `ac00627..29d4645` (25 files)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 20 | `docs/install/windows-installation-guide.md` | New user guide | Portable run, first config, local model, data/key paths, backup/rollback, and all BLOCKED limits are honest; PASS. |
| 21 | `docs/reports/morrow-v2-rc-delivery-report.md` | New RC delivery report | PARTIAL, no COMPLETE claim; NSIS/install/launch/CI marked blocked; CI cause omits the billing annotation, 1280 claim inaccurate; PASS with P3. |
| 22 | `docs/reports/morrow-v2-rc-evidence-index.md` | New evidence index | Artifact/hash/tests honest; screenshots explicitly parent-code and not installed; ac00627 run ID missing; PASS with P3. |
| 23 | `docs/reports/morrow-v2-rc-work-log.md` | New work log | Commands/exit codes and blockers recorded; CI cause generic; PASS with P3. |
| 24 | `docs/testing/morrow-v2-rc-acceptance-matrix.md` | New acceptance matrix | CI/NSIS/install/screenshots BLOCKED honestly; line 20 “PASS (code/local test)” overstates the unexecuted B3 script; PASS with P3. |
| 25 | `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/manifest.md` | New screenshot manifest | Explicitly says source is parent code `6f5fe47` run `20261105T084141Z-45483dd6` and not installed-app; PASS (directory name still says `rc-ac00627`, a labeling risk). |
| 26 | `.../chat-1440x900.png` | New built-app screenshot | Parent-code image; no secret/user data; does not evidence RC-SHA changes; PASS as labeled. |
| 27 | `.../chat-1280x800.png` | New built-app screenshot | Shows composer partly below the 800px fold; parent-code layout; P3 evidence gap. |
| 28 | `.../chat-390x844.png` | New built-app screenshot | Parent-code image; not installed-app; PASS as labeled. |
| 29 | `.../memory-1440x900.png` | New built-app screenshot | Parent-code image; no secret/user data; PASS as labeled. |
| 30 | `.../memory-1280x800.png` | New built-app screenshot | Parent-code image; PASS as labeled. |
| 31 | `.../memory-390x844.png` | New built-app screenshot | Shows the pre-fix 390 nav cut (`04 设…`); cannot verify the B1 fix; P3 evidence gap. |
| 32 | `.../settings-1440x900.png` | New built-app screenshot | Parent-code image; shows “密钥：已保存在本机安全存储”, no key value; PASS as labeled. |
| 33 | `.../settings-1280x800.png` | New built-app screenshot | Parent-code image; PASS as labeled. |
| 34 | `.../settings-390x844.png` | New built-app screenshot | Shows the pre-fix 390 nav cut; P3 evidence gap. |
| 35 | `evals/morrow-v2-rc/results/20261105T191500Z-rc-ac00627.json` | New machine result | PARTIAL; lists PASS for tsc/tests/build/evals and BLOCKED for NSIS/launch/product-path/provider/local; honest. |
| 36 | `evals/morrow-v2-rc/transcripts/20261105T191500Z-rc-ac00627.md` | New readable transcript | Same status; explicitly says screenshots are not installed-app; honest. |
| 37 | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` | New RC binary | 100,541,545 bytes, SHA256 `cf662590…8e67`, real PE32 NSIS+7z Electron payload, app.asar 2.0.0 with `ac00627` markers; **PASS**. |
| 38 | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe.sha256` | New checksum | Matches the computed SHA256; PASS. |
| 39 | `docs/reports/morrow-v2-final-delivery-report.md` | Issue #53 historical banner + SHA label | Historical banner present; residual “最终 HEAD” wording mitigated by banner; P3. |
| 40 | `docs/reports/morrow-v2-final-evidence-index.md` | Historical banner + SHA label | Historical banner present; internal “最终 HEAD” wording remains; P3. |
| 41 | `docs/reports/morrow-v2-final-work-log.md` | Historical banner | Historical banner present; internal “最终 HEAD `eede520` CI 4/4 PASS” remains; P3. |
| 42 | `docs/testing/morrow-v2-final-acceptance-matrix.md` | Historical banner + empty HEAD field replaced | The former empty “最终 HEAD” field is fixed; historical banner present; P3. |
| 43 | `docs/ui/acceptance-matrix.md` | Historical banner | Banner present; 390 PASS claim still contradicted by the committed screenshot; P3. |
| 44 | `docs/ui/design-system.md` | Contrast line updated | Token table still lists `#6e6f73` (code `#66676d`) and line 70 has a typo/4.95-only-on-bg claim; P3. |

## 4. Prior-review docs modified earlier in the same round (`ff5b787`, docs-only)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 45 | `docs/audit/morrow-v2-final-independent-review.md` | Prior Issue #53 review on `df8f802` | Historical review; does not cover the RC `ac00627` fixes and is not used as RC evidence; P3 context only. |
| 46 | `docs/audit/morrow-v2-final-file-review-matrix.md` | Prior Issue #53 matrix | Historical matrix; same limitation; P3 context only. |

## 5. Regression introduced by omission (not changed in the RC round)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 47 | `scripts/smoke.mjs` | **Not changed**; line 514 still asserts the old `dataPolicy` | **FAIL / blocking CI**: the app returns `local-first-consented-provider-egress-memory-goals-reminders`, so the CI Electron smoke step fails deterministically even after the GitHub billing block is removed. Fix the assertion to the new value. |

## 6. Summary

| Category | Files | Verdict |
| --- | --- | --- |
| RC code delta `ff5b787..ac00627` | 17 | 14 PASS, 3 PARTIAL (index.html, style.css, product-path-smoke.mjs) |
| Adjacent discovery fix `eac8fbd..df8f802` | 2 | PASS |
| Frozen docs/binary commit `ac00627..29d4645` | 25 | artifact PASS; docs PARTIAL/P3 |
| Prior review docs `ff5b787` | 2 | docs-only historical context |
| Omission regression | 1 (`scripts/smoke.mjs`) | **FAIL / blocking CI** |
| Total changed files in the full RC round `eac8fbd..29d4645` | 46 (44 production/docs/evidence/artifact + 2 prior audit docs) | Overall **PARTIAL** |

No file-level finding is a secret leak, data corruption, or runtime product regression. The blocking items are the stale smoke assertion (F1) and the external/acceptance blockers (NSIS, install/launch, frozen-SHA CI billing), as detailed in `docs/audit/morrow-v2-rc-independent-review.md`.
