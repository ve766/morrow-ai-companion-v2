# Morrow V2 Windows RC Independent Review — Delta Re-review (Issue #55, PR #54, code `fad6a94`, HEAD `e0fbbcf`)

Independent reviewer: separate context; did not write this implementation. No product code, test, migration, CI, existing doc, evidence, or RC binary was modified. The only repository writes are this file and `docs/audit/morrow-v2-rc-file-review-matrix.md`. Throwaway probes were written only under `.tmp/review2/`. No `.tmp/*key*` or `.tmp/second-provider/*` file was opened. The worktree was clean before the review; after the review the only changes are the two updated review documents.

Review date: 2026-11-05. This is a delta re-review of the previous review at `29d4645`; the previous review's fixed findings are re-tested, and the new RC commit is checked for provenance.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Local checkout | `E:\Hasee\Documents\morrow v2\zcode\stage3-audit\repo` |
| Branch | `feat/morrow-v2-final-closure` |
| Frozen RC HEAD | `e0fbbcff0a9fbfebd6dd50a293d877060de74d75` |
| RC code/test SHA | `fad6a94eef19ce5cfbdca9f4c0e1af0aca08074c` |
| RC docs/binary commit | `e0fbbcf` (parent `fad6a94`) |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft, `MERGEABLE`, `mergeStateStatus=UNSTABLE` |
| PR head at review | `e0fbbcff0a9fbfebd6dd50a293d877060de74d75` (matches frozen HEAD) |
| Previous reviewed HEAD | `29d464545d081836c4aa36e76e2b9f950b020f2f` (code `ac00627`) |
| Last green code-SHA CI | run `41995422882`, head `6f5fe47` (parent code), 4/4 PASS |
| Frozen-HEAD CI | run `42023327920`, head `e0fbbcf`, 4/4 FAIL, all jobs 0-step |
| Worktree | clean before; only the two review docs updated after |

The PR head was `29d4645` when this delta review started; the implementer then committed `e0fbbcf` (docs/binary on top of `fad6a94`). The review is against the stable `e0fbbcf` head.

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Code review (source fixes)** | **PASS_WITH_NON_BLOCKING_BACKLOG** |
| **RC portable artifact** | **FAIL** (wrapper-only rewrap; app payload is the old `ac00627` build) |
| **Overall RC delivery** | **PARTIAL** |
| **NSIS installer / install / first launch / installed screenshots** | **BLOCKED** |
| **Frozen-SHA CI** | **BLOCKED by GitHub billing** (4/4 0-step) |
| **Docs consistency** | **PARTIAL** |
| **Secret / user-data scan** | **PASS** (no real secret, Authorization value, private key, or user data found) |
| **Merge recommendation** | **DO NOT MERGE / DO NOT RELEASE** until the portable is rebuilt from `fad6a94` |

The source fixes are correct: the smoke assertion now matches the app, both residual copy strings are fixed, the design-system token is corrected, the 1320px chat rule and `.pending-item-meta` wrapping are present, and the product-path allowlist is now per-row `{key, reason}`. Full tests, typecheck, build, and both offline evaluations pass.

The **new portable RC is not rebuilt from `fad6a94`**. Its embedded 7z payload and `app.asar` are byte-identical to the old `29d4645`/`ac00627` binary; only the NSIS wrapper changed (the hash/size difference is wrapper-only). The shipped app therefore still contains the old copy strings and lacks the 1320px CSS rule and the provider-metadata wrapping. This is a new blocking artifact-provenance finding (F1). There is no secret leak, data corruption, or runtime product regression, so the code verdict is not FAILED; the artifact verdict is FAIL.

## 2. Delta fixes — source verification

| Fix | Source status | Evidence | Shipped in binary? |
| --- | --- | --- | --- |
| `scripts/smoke.mjs:514` dataPolicy | **PASS** | Now expects `local-first-consented-provider-egress-memory-goals-reminders`; matches `src/app/index.ts:77` exactly (probe `MATCH: true`) | N/A (script not packaged) |
| `src/renderer/index.html` local copy | **PASS** | Line 369 now: “没有显式默认 Provider 时，对话会优先使用本地模型” | **NO** — embedded HTML still says “启用后，对话会优先使用本地模型” |
| `src/renderer/index.html` cognitive copy | **PASS** | Line 395 now: “每次模型服务发送仍需单独确认” | **NO** — embedded HTML still says “每次 DeepSeek 发送仍需单独确认” |
| `docs/ui/design-system.md` muted token/contrast | **PASS** | Line 14 `#66676d`; line 70 “纸面对 `#f3f0e8` 约 4.95:1” | N/A (docs only) |
| 1280 composer | **PASS in source; visual unverified** | `style.css:491` `@media (max-width: 1320px)` sets `.chat-messages` 18vh/32vh and `.presence-hero` 18px/16px | **NO** — embedded CSS has no `1320px` rule |
| `.pending-item-meta` wrapping | **PASS in source** | `style.css:441` adds `overflow-wrap: anywhere` | **NO** — embedded CSS has 5 `overflow-wrap` occurrences vs 6 in source |
| Product-path per-row allowlist | **PASS structurally; P3 residual** | `product-path-smoke.mjs:380` `added.map((key) => ({ key, reason }))` | N/A (script not packaged); not executed on RC SHA |
| CI billing annotation in RC evidence | **PASS in evidence index** | `morrow-v2-rc-evidence-index.md:47` records the exact billing annotation and the user action | N/A |
| Smoke code-level CI defect (prior F1) | **CLOSED** | The assertion now matches; a restored CI run would no longer fail on `dataPolicy` | N/A |

## 3. Critical artifact finding — the new portable is not the new code

The new binary metadata matches the user's claim:

| Check | Result |
| --- | --- |
| File | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` |
| Size | **100,541,544 bytes** (filesystem and `git cat-file -s` agree) |
| SHA256 | **`fd584ffd53f74ffb3d7c93804a8d92a308a84c7ffb2d04b9da7532f73e8ab1da`** (computed; `.sha256` matches) |
| PE | `MZ`; `file` reports `PE32 executable for MS Windows 4.00 (GUI), Intel i386, Nullsoft Installer self-extracting archive, 5 sections` |
| Version | `FileVersion 2.0.0`, `ProductVersion 2.0.0` |
| Signature | **NotSigned** |

However, the content is stale:

1. **Embedded 7z payload is byte-identical to the old binary.** New binary: 7z magic at offset **50,490**, payload length **100,491,054**, payload SHA256 **`9376f8821c32c284ea82be25307942a8f8d85b66a442cd0666e2750a99c86194`**. The old `29d4645` binary (extracted from git) has the 7z magic at offset **50,491**, the same payload length, and the **same payload SHA256**.
2. **Embedded `app.asar` is byte-identical to the old one.** Both old and new `app.asar` SHA256 = **`c74ada9350dfb988ab6807ad8d2244c6854653c0d25b23dc0aab20c6ba96e5c8`**. Inside it:
   - `out/renderer/index.html` SHA256 `719e796d1f7d83dc628a0b6375ee2468ca37b14ef4a899adf2832af3d22dbf1f` — contains “启用后，对话会优先使用本地模型” and “每次 DeepSeek 发送仍需单独确认”, and **not** the new copy.
   - `out/renderer/assets/index-Dt_urrZb.css` SHA256 `948ad3e168747c89f0d12c76f83c7d348a2f4bce6bcc012d5b2567a0567ae2ca` — **no** `1320px` media query; 5 `overflow-wrap` occurrences (source has 6; `.pending-item-meta` has none).
   - `out/main/index.js` SHA256 `739a8332145619a3eae815aff8615ae8e191ec7463539ac5747335dcbfcefbd4` — unchanged.
3. **The wrapper differs, the payload does not.** Comparing the old and new exe: the NSIS wrapper differs in **11,576 of 50,490 bytes**, the 7z offset shifts by 1 byte, and the payload is identical. The new SHA256/size difference is wrapper-only.
4. **A fresh build at HEAD produces the new code.** After `npm run build` on `e0fbbcf`, `out/renderer/index.html` SHA256 `5189070f1141579efa8c14136403b26edad0f80fd91fa303160250f4505591f5` contains both new copy strings, and `out/renderer/assets/index-Bj03RVHd.css` SHA256 `f366a75db8f1b69970746ed0235807fa018fb814d05cef64edaf14a21611ee95` contains the `1320px` rule. The binary's asar still carries the old `index-Dt_urrZb.css` (948ad3e1…), so it was packaged from a stale `out/`/`win-unpacked`, not from the current source.
5. **The recorded build command cannot have produced the new content.** `morrow-v2-rc-evidence-index.md:19` records only `npx electron-builder --win portable ...` (no `npm run build`). `.tmp/rc-portable/Morrow-Setup-2.0.0-x64.exe` is still the old binary (`cf662590…8e67`), and `.tmp/rc-portable/win-unpacked/resources/app.asar` is the old asar. The new committed binary was not produced by the recorded command in this workspace.

**Artifact verdict: FAIL.** The file is a real PE and its hash/size match the claim, but it does not contain the `fad6a94` renderer fixes. The delivery report's “Portable RC 已构建” with the new hash is misleading as to content; the evidence index's build time is still `2026-11-05T19:05:00Z` (old build), while the new result JSON says `builtAt 2026-11-05T19:54:00Z`.

## 4. CI state

| Run | Head | Conclusion | Evidence |
| --- | --- | --- | --- |
| `41995422882` | `6f5fe47` (parent code) | **success** | 4/4 PASS; runner IDs `1000001030`–`1000001033`; 9–17 steps |
| `42023327920` | `e0fbbcf` (frozen HEAD) | **failure** | 4/4 FAIL; `runner_id=0`, `runner_name=""`, `steps=[]`; 2s; no logs; check-run annotation: “The job was not started because recent account payments have failed or your spending limit needs to be increased.” |

The workflow file is unchanged from the green parent run; the failure is account/billing infrastructure, not code. The parent PASS is not the frozen-SHA CI. The prior code-level CI defect (stale `dataPolicy` in `smoke.mjs`) is now fixed in source, so a restored CI run should pass that assertion; **no CI steps executed** on `fad6a94`/`e0fbbcf` (all four jobs are 0-step).

The evidence index now records the billing annotation (line 47) and the user action; the delivery report and work log still use the generic “Actions 启动/runner 分配基础设施失败” wording and do not cite run `42023327920`.

## 5. B1–B4 status after the delta

| Area | Item | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Range focus ring | **PASS** | `style.css:364`; `outline: none` removed |
| B1 | Light muted contrast | **PASS** | `#66676d`: 4.949 on `#f3f0e8`, 4.649 on `#ede9df`, 5.397 on `#fbfaf6`, 5.636 on `#ffffff`; design-system updated |
| B1 | Long-text wrapping | **PASS in source** | `.pending-item-meta` now wraps (`style.css:441`); embedded binary does not contain it |
| B1 | 390 self-model/nav | **PASS (code), UNVERIFIED** | `style.css:523` one column; `style.css:501-502` nav wrap; screenshots are parent-code copies |
| B1 | 1280 composer | **PASS in source, UNVERIFIED** | `style.css:491` 1320px rule; no RC-SHA screenshot; embedded binary lacks the rule |
| B1 | Provider delete state cleanup | **PARTIAL (P3)** | `save()` still does not call `disarmDelete()` (`provider-profiles-ui.ts:225-251`); unchanged |
| B1 | Built-in delete disabled | **PASS** | `provider-profiles-ui.ts:114-117`; test |
| B1 | `providerUiReady` | **PASS** | Set after `loadProfiles()` finally (`provider-profiles-ui.ts:217-222`); product-path waits |
| B1 | Reduced-motion canvas | **PASS** | `presence-ui.ts:102-107`; static draw |
| B2 | Companion UI copy | **PASS** | `companion-ui.ts:318-319,471` “模型服务请求” |
| B2 | `index.html` copy | **PASS in source** | Lines 369/395 fixed; embedded binary still old |
| B2 | `dataPolicy` + smoke | **PASS** | `app/index.ts:77`, `contracts.ts:146`, `smoke.mjs:514` all match |
| B3 | Tautology removed | **PASS** | `product-path-smoke.mjs:600-609,632` real restart reads |
| B3 | Goal task/progress fixture | **PASS (SQL)** | `product-path-smoke.mjs:409-435`; v49 columns/FKs valid |
| B3 | Per-row allowlist | **PASS structurally; P3** | `:380` `[{ key, reason }]`; reason is still table-level; not field-level; unexecuted on RC SHA |
| B3 | Complete diff arrays | **PASS** | `removed`/`changed`/`added` arrays |
| B3 | Execution on RC SHA | **BLOCKED** | No product-path run on `fad6a94`/`e0fbbcf` |
| B4 | Non-stream 1 MiB | **PASS** | `openai-compatible.ts:6-8,334-338` |
| B4 | Reader/cancel/UTF-8/CL | **PASS** | `bounded-body.ts`; 10 tests |
| B4 | Adapter tests | **PARTIAL (P3)** | Only oversized + valid; no exact-1-MiB/UTF-8/empty/parse-failure adapter cases |
| B4 | Discovery 1,048,576 | **PASS** | `companion-service.ts:442`; test header 1,048,577 |

## 6. Install / launch / NSIS

| Item | Verdict | Evidence |
| --- | --- | --- |
| NSIS installer | **BLOCKED_HOST_EXECUTION_POLICY** | `release/Morrow-Setup-2.0.0-x64.exe` is a 189,850-byte incomplete stub; the app payload is a separate 100 MB `.nsis.7z`; no complete NSIS installer |
| Install / first launch / restart | **BLOCKED_HOST_ELECTRON_CRASH** | Host Electron 44 exits `0xC0000005`; no installed-app evidence |
| Installed-app screenshots | **BLOCKED** | The 9 PNGs in `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/` are byte-identical copies of the parent-code `6f5fe47` screenshots; the manifest says so; no new visual evidence for the B1 fixes |

## 7. Docs consistency

### 7.1 Fixed RC deliverables

All fixed paths exist, including the new run-specific result/transcript/screenshots. The new result JSON and transcript point to `fad6a94` and the new hash/size. The install guide and evidence index use the new hash. The evidence index records the billing annotation.

### 7.2 Inconsistencies

| # | File:line | Finding | Severity |
| --- | --- | --- | --- |
| D1 | `docs/testing/morrow-v2-rc-acceptance-matrix.md:14` | Row 6 still lists the **old** SHA256 `cf662590…8e67` while the size is the new 100,541,544; the new hash is `fd584ffd…b1da`. A user verifying the artifact against this matrix gets a mismatch. | **P2** |
| D2 | `docs/reports/morrow-v2-rc-evidence-index.md:17` | Build time still `2026-11-05T19:05:00Z` (old build); the new result JSON says `builtAt 2026-11-05T19:54:00Z`. | P3 |
| D3 | `docs/reports/morrow-v2-rc-evidence-index.md:37-47` | CI table does not list the frozen-HEAD run `42023327920`; it stops at `ac00627`. | P3 |
| D4 | `docs/reports/morrow-v2-rc-delivery-report.md:16-18`; `morrow-v2-rc-work-log.md:40-42` | CI cause remains generic “Actions 启动/runner 分配基础设施失败”; the billing annotation and user action are only in the evidence index. | P3 |
| D5 | `evals/morrow-v2-rc/transcripts/20261105T195500Z-rc-fad6a94.md` | BLOCKED section still says “CI on `ac00627` failed”; the current code SHA is `fad6a94` and the frozen HEAD is `e0fbbcf`. | P3 |
| D6 | `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/manifest.md:3` | Screenshots are parent-code `6f5fe47` copies (byte-identical to the old set); they cannot verify the new 1280/390/CSS fixes. The manifest is honest, but the directory name implies the new RC. | P3 |
| D7 | `docs/reports/morrow-v2-rc-delivery-report.md:40-42`; `morrow-v2-rc-evidence-index.md:12-16` | Both present the new hash as a rebuilt RC; the content is the old app payload (F1). | P1 (artifact) |

No empty final-HEAD fields were found. The old Issue #53 docs still carry their historical banners; the design-system token table and contrast wording are now correct.

## 8. Secret / user-data scan

The new binary's payload is the old one, so the prior scan applies unchanged; no new secret-bearing content was introduced. Tracked-text scan still shows only the synthetic `sk-lik…tion` adversarial fixture, no `Bearer <token>`, no private key, no AWS/GitHub/Slack/Google tokens, no real user paths in RC docs, and only fake `example.com` emails and synthetic phone fixtures. The new screenshots contain no key material. **PASS.**

## 9. Residual risks and blockers

1. **Artifact provenance (P1):** the new portable is a wrapper-only rewrap; rebuild with `npm run build` followed by electron-builder from a clean `out/`/`win-unpacked`, then re-hash and re-capture.
2. **NSIS/install/launch (P2):** unchanged host blockers.
3. **CI billing (P2 external):** run `42023327920` is 4/4 0-step; user must fix GitHub payment/spending limit.
4. **Acceptance matrix hash (P2 docs):** update `cf662590…8e67` to `fd584ffd…b1da` (after the rebuild, use the final hash).
5. **Docs build time / CI run / transcript (P3):** update to the actual build time, cite run `42023327920`, and fix the `ac00627` reference.
6. **1280 composer visual evidence (P3):** the source rule exists but no RC-SHA screenshot verifies it; the committed screenshots are parent-code.
7. **B3 per-row reason (P3):** shape is per-row, but the reason is still the table-level constant; no field-level validation; unexecuted on RC SHA.
8. **B4 adapter coverage (P3):** exact-1-MiB/UTF-8/empty/parse-failure adapter tests missing.
9. **Delete save disarm (P3):** unchanged.
10. **Provider/local external blockers:** `BLOCKED_QUOTA` and `BLOCKED_LOCAL_SERVICE_NOT_RUNNING`.

## 10. Exact commands and exit codes

All commands were run from the repository root on 2026-11-05. `TEMP`/`TMP` were set to `<repo>/.tmp/es` for vitest/evaluations.

| Command | Exit | Result |
| --- | --- | --- |
| `git rev-parse HEAD` | 0 | `e0fbbcff0a9fbfebd6dd50a293d877060de74d75` |
| `git status --porcelain` | 0 | clean before review |
| `gh pr view 54 --json ...` | 0 | OPEN, not draft, MERGEABLE, UNSTABLE, head `e0fbbcf` |
| `gh pr checks 54` | 1 | 4/4 fail, run `42023327920` |
| `gh api .../actions/runs/42023327920/jobs` | 0 | `runner_id=0`, `runner_name=""`, `steps=[]`, 2s |
| `gh api .../check-runs/<id>/annotations` | 0 | billing/spending-limit message on all 4 |
| `npx tsc --noEmit` | 0 | PASS |
| `npx vitest run` | 0 | **129 files / 1156 tests passed / 0 skipped** (174.83s) |
| targeted B1–B4 tests | 0 | 4 files / 31 tests passed |
| `npm run build` | 0 | PASS; fresh `out/` has the new copy and 1320px CSS |
| `npm run evaluate` | 0 | PASS; `passed:true` |
| `npm run evaluate:cognition` | 0 | PASS; `passed:true`, 0 network calls |
| `stat -c '%s' <exe>` | 0 | 100541544 |
| `sha256sum <exe>` | 0 | `fd584ffd…b1da` |
| `git cat-file -s e0fbbcf:<exe>` | 0 | 100541544 |
| `file <exe>` | 0 | PE32 NSIS self-extracting archive |
| payload comparison (old `29d4645` exe vs new) | 0 | 7z offset 50,491 vs 50,490; payload length 100,491,054 both; payload SHA256 `9376f882…c86194` both |
| asar comparison | 0 | SHA256 `c74ada93…96e5c8` both; HTML/CSS/main byte-identical |
| fresh `out/` check | 0 | new copy present; `index-Bj03RVHd.css` has `1320px` |
| `.tmp/rc-portable` check | 0 | still the old exe (`cf662590…8e67`) and old asar |
| `git status --porcelain` (after) | 0 | only the two updated review docs |

## 11. Findings

| # | Severity | File:line | Finding | Reproduction | Conclusion |
| --- | --- | --- | --- | --- | --- |
| F1 | **P1 / blocking artifact** | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` | The new binary is a wrapper-only rewrap of the old `ac00627` app payload; the `fad6a94` renderer fixes are not shipped. | Compare the embedded 7z payload/asar hashes with the old binary; inspect the embedded HTML/CSS. | **FAIL** — rebuild with `npm run build` then electron-builder from a clean `out/`/`win-unpacked`. |
| F2 | **P2 / docs** | `docs/testing/morrow-v2-rc-acceptance-matrix.md:14` | Acceptance matrix still lists the old SHA256 `cf662590…8e67`. | Read row 6; compare with the binary hash. | **FAIL** — update to the final hash after the rebuild. |
| F3 | **P2 / acceptance** | `release/Morrow-Setup-2.0.0-x64.exe` | NSIS installer remains an incomplete stub; install/launch/screenshots blocked. | Compare the stub size with the payload; docs state the block. | **BLOCKED** — unchanged. |
| F4 | **P2 / external CI** | run `42023327920` | 4/4 0-step; check-run annotation says payments failed/spending limit. | `gh api .../check-runs/<id>/annotations`. | **BLOCKED** — user must fix GitHub billing. |
| F5 | P3 / docs | `morrow-v2-rc-evidence-index.md:17,37-47`; `transcript...fad6a94.md` | Stale build time, missing frozen-HEAD run, and `ac00627` reference in the transcript. | Read the lines; compare with run `42023327920` and `fad6a94`. | **P3** — update. |
| F6 | P3 / B1 | `style.css:491`; `manifest.md:3` | 1320px rule exists in source but no RC-SHA screenshot verifies it; the committed screenshots are parent-code. | Read the CSS; inspect the manifest. | **P3** — capture after launch is unblocked; the current binary lacks the rule anyway. |
| F7 | P3 / B3 | `product-path-smoke.mjs:380` | Per-row shape is correct, but the reason is still a table-level constant; no field-level validation; unexecuted on RC SHA. | Read `ALLOWED_ADDITION_REASONS` and the map. | **P3** — per-field validation remains backlog. |
| F8 | P3 / B4 | `openai-compatible.test.ts` | Adapter tests omit exact-1-MiB/UTF-8/empty/parse-failure cases. | Read the 12 adapter tests. | **P3** — add boundary cases. |
| F9 | P3 / B1 | `provider-profiles-ui.ts:225-251` | `save()` does not disarm delete. | Arm delete, submit the form. | **P3** — unchanged. |
| F10 | P3 / artifact | `Morrow-2.0.0-x64-portable.exe` | Unsigned; no reproducible build. | `Get-AuthenticodeSignature` → NotSigned. | **P3** — sign/document before public release. |

## 12. Conclusion

- The `fad6a94` source fixes are correct: smoke dataPolicy, both copy strings, design-system token/contrast, 1320px chat rule, `.pending-item-meta` wrapping, and per-row allowlist shape. Full tests (129/1156), typecheck, build, and both offline evaluations pass.
- The **new portable RC does not contain those renderer fixes**. Its 7z payload and `app.asar` are byte-identical to the old `ac00627` build; only the NSIS wrapper changed. The artifact verdict is **FAIL**, and the docs' new hash/build-time evidence is inconsistent with the content.
- NSIS installation, installed-app launch, and installed screenshots remain blocked; the frozen-HEAD CI remains 4/4 0-step due GitHub billing (run `42023327920`). The parent-SHA PASS is not the frozen-SHA CI.
- Code verdict: **PASS_WITH_NON_BLOCKING_BACKLOG**. Overall RC: **PARTIAL**. Do not merge or publish a Release until the portable is rebuilt from `fad6a94` with a clean `npm run build`, the binary is re-hashed, and the acceptance matrix hash is corrected.
