# Morrow V2 Windows RC Independent Review — Final Artifact Verification (Issue #55, PR #54, code `fad6a94`, HEAD `84481f8`)

Independent reviewer: separate context; did not write this implementation. No product code, test, migration, CI, existing doc, evidence, or RC binary was modified. The only repository writes are this file and `docs/audit/morrow-v2-rc-file-review-matrix.md`. Throwaway probes were written only under `.tmp/review3/`. No `.tmp/*key*` or `.tmp/second-provider/*` file was opened. The worktree was clean before the review; after the review the only changes are the two updated review documents.

Review date: 2026-11-05. This final verification closes the previous delta review's P1 artifact finding at `e0fbbcf` and confirms the rebuilt portable RC.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Local checkout | `E:\Hasee\Documents\morrow v2\zcode\stage3-audit\repo` |
| Branch | `feat/morrow-v2-final-closure` |
| Frozen RC HEAD | `84481f83383613c01e9ca35bc9700d54d23314e2` |
| RC code/test SHA | `fad6a94eef19ce5cfbdca9f4c0e1af0aca08074c` |
| RC docs/binary commit | `84481f8` (parent `e0fbbcf`; code unchanged since `fad6a94`) |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft, `MERGEABLE`, `mergeStateStatus=UNSTABLE` |
| PR head at review | `84481f83383613c01e9ca35bc9700d54d23314e2` (matches frozen HEAD) |
| Last green code-SHA CI | run `41995422882`, head `6f5fe47` (parent code), 4/4 PASS |
| Frozen-HEAD CI | run `42025990645`, head `84481f8`, 4/4 FAIL, all jobs 0-step |
| Worktree | clean before; only the two review docs updated after |

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Code review (source fixes)** | **PASS_WITH_NON_BLOCKING_BACKLOG** |
| **RC portable artifact** | **PASS** (P1 from the previous review is closed) |
| **Overall RC delivery** | **PARTIAL** |
| **NSIS installer / install / first launch / installed screenshots** | **BLOCKED** |
| **Frozen-SHA CI** | **BLOCKED by GitHub billing** (4/4 0-step) |
| **Docs consistency** | **PARTIAL** (P3 residual only) |
| **Secret / user-data scan** | **PASS** |
| **Merge recommendation** | **DO NOT MERGE / DO NOT RELEASE yet** (external blockers remain; the portable itself is now correct) |

The previous P1 is closed: the portable RC now contains the `fad6a94` renderer fixes. The artifact is a real, hash-verified PE with the new copy, the 1320px CSS rule, and the new renderer asset. The remaining blockers are external/acceptance: no complete NSIS installer, no installed-app launch/screenshots, frozen-SHA CI is 4/4 0-step due GitHub billing, and the RC-SHA product-path/continuity run is still unavailable.

## 2. Final artifact verification

| Check | Result |
| --- | --- |
| File | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` |
| Size | **100,542,249 bytes** (filesystem and `git cat-file -s` agree) |
| SHA256 | **`e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b`** (computed; `.sha256` matches) |
| PE | `MZ`; `file` reports `PE32 executable for MS Windows 4.00 (GUI), Intel i386, Nullsoft Installer self-extracting archive, 5 sections` |
| Version | `FileVersion 2.0.0`, `ProductVersion 2.0.0`; embedded `app.asar` package.json version `2.0.0` |
| Signature | **NotSigned** (SmartScreen may warn; documented as a limitation) |
| Embedded 7z payload | offset **50,493**; length **100,491,756**; SHA256 **`8cd634704c47f16bada8399ffd302ae69ae3b21f54a7ad730ed02215069b1272`** — differs from the old `e0fbbcf` payload (`9376f882…c86194`) and the old `29d4645` payload, proving a real rebuild |
| Embedded `app.asar` | SHA256 **`e6866f86e772166b3aa28657af662d77e0fc3234c27b0a84913f8a9fcdc597de`** — differs from the old `c74ada93…96e5c8`; size 1,149,407 bytes |
| Embedded renderer HTML | Contains “没有显式默认 Provider 时” (1) and “每次模型服务发送” (1); the old “启用后，对话会优先使用本地模型” and “每次 DeepSeek 发送仍需单独确认” are **absent** |
| Embedded renderer CSS | Asset **`index-Bj03RVHd.css`**; contains `1320px` (1) and 6 `overflow-wrap` occurrences (source has 6); the old `index-Dt_urrZb.css` is gone |
| Fresh-build match | The embedded HTML/CSS differ from the fresh `out/` only by a leading `;` line and a trailing newline; the substantive content is identical (diff exit 1 for those cosmetic differences only) |
| Real vs mock | Real 100 MB PE with a real Electron/7z payload; not an empty or mock file |

**Artifact verdict: PASS.** The P1 artifact finding is closed. The new payload and asar differ from the old build, the new copy/CSS are present, the old copy/CSS are absent, and the asset name matches the fresh build.

## 3. CI state

| Run | Head | Conclusion | Evidence |
| --- | --- | --- | --- |
| `41995422882` | `6f5fe47` (parent code) | **success** | 4/4 PASS; runner IDs `1000001030`–`1000001033`; 9–17 steps |
| `42025990645` | `84481f8` (frozen HEAD) | **failure** | 4/4 FAIL; `runner_id=0`, `runner_name=""`, `steps=[]`; 2s; no logs; check-run annotation: “The job was not started because recent account payments have failed or your spending limit needs to be increased.” |

The workflow file is unchanged from the green parent run; the failure is account/billing infrastructure, not code. The parent PASS is not the frozen-SHA CI. The prior code-level CI defect (stale `dataPolicy` in `smoke.mjs`) is fixed in source, so a restored CI run should pass that assertion; no CI steps executed on `fad6a94`/`84481f8` (all four jobs are 0-step).

The evidence index records the billing annotation and the user action; the CI table still stops at `ac00627` and does not cite run `42025990645`. The delivery report and work log still use the generic “Actions 启动/runner 分配基础设施失败” wording.

## 4. B1–B4 final status

| Area | Item | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Range focus ring | **PASS** | `style.css:364`; `outline: none` removed |
| B1 | Light muted contrast | **PASS** | `#66676d`: 4.949 on `#f3f0e8`, 4.649 on `#ede9df`, 5.397 on `#fbfaf6`, 5.636 on `#ffffff`; design-system updated |
| B1 | Long-text wrapping | **PASS** | `.pending-item-meta` wraps (`style.css:441`); embedded CSS has 6 `overflow-wrap` |
| B1 | 390 self-model/nav | **PASS (code), UNVERIFIED** | `style.css:523` one column; `style.css:501-502` nav wrap; screenshots remain parent-code copies |
| B1 | 1280 composer | **PASS in code and artifact; visual unverified** | `style.css:491` 1320px rule; embedded `index-Bj03RVHd.css` contains `1320px`; no RC-SHA screenshot |
| B1 | Provider delete state cleanup | **PARTIAL (P3)** | `save()` still does not call `disarmDelete()` (`provider-profiles-ui.ts:225-251`) |
| B1 | Built-in delete disabled | **PASS** | `provider-profiles-ui.ts:114-117`; test |
| B1 | `providerUiReady` | **PASS** | Set after `loadProfiles()` finally (`provider-profiles-ui.ts:217-222`); product-path waits |
| B1 | Reduced-motion canvas | **PASS** | `presence-ui.ts:102-107`; static draw |
| B2 | Companion UI copy | **PASS** | `companion-ui.ts:318-319,471` “模型服务请求” |
| B2 | `index.html` copy | **PASS** | Lines 369/395 fixed in source and embedded in the new binary |
| B2 | `dataPolicy` + smoke | **PASS** | `app/index.ts:77`, `contracts.ts:146`, `smoke.mjs:514` all match |
| B3 | Tautology removed | **PASS** | `product-path-smoke.mjs:600-609,632` real restart reads |
| B3 | Goal task/progress fixture | **PASS (SQL)** | `product-path-smoke.mjs:409-435`; v49 columns/FKs valid |
| B3 | Per-row allowlist | **PASS structurally; P3** | `:380` `[{ key, reason }]`; reason is still table-level; not field-level; unexecuted on RC SHA |
| B3 | Complete diff arrays | **PASS** | `removed`/`changed`/`added` arrays |
| B3 | Execution on RC SHA | **BLOCKED** | No product-path run on `fad6a94`/`84481f8` |
| B4 | Non-stream 1 MiB | **PASS** | `openai-compatible.ts:6-8,334-338` |
| B4 | Reader/cancel/UTF-8/CL | **PASS** | `bounded-body.ts`; 10 tests |
| B4 | Adapter tests | **PARTIAL (P3)** | Only oversized + valid; no exact-1-MiB/UTF-8/empty/parse-failure adapter cases |
| B4 | Discovery 1,048,576 | **PASS** | `companion-service.ts:442`; test header 1,048,577 |

## 5. Install / launch / NSIS

| Item | Verdict | Evidence |
| --- | --- | --- |
| NSIS installer | **BLOCKED_HOST_EXECUTION_POLICY** | `release/Morrow-Setup-2.0.0-x64.exe` is a 189,850-byte incomplete stub; the app payload is a separate 100 MB `.nsis.7z`; no complete NSIS installer |
| Install / first launch / restart | **BLOCKED_HOST_ELECTRON_CRASH** | Host Electron 44 exits `0xC0000005`; no installed-app evidence |
| Installed-app screenshots | **BLOCKED** | The 9 PNGs in `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/` are byte-identical copies of the parent-code `6f5fe47` screenshots; the manifest says so; no new visual evidence for the 1280/390 fixes |

The docs do not claim COMPLETE and do not present parent screenshots as installed-app evidence. The main residual evidence gap is that the B1 visual fixes have no RC-SHA screenshot; the 1280 rule is now in the binary but not visually verified.

## 6. Docs consistency

### 6.1 Fixed RC deliverables

All fixed paths exist. The new hash/size is present in the delivery report, evidence index, acceptance matrix, install guide, result JSON, and transcript. The acceptance matrix's old-hash inconsistency is fixed. The evidence index build time is now `2026-11-05T20:15:00Z`, matching the result JSON's `builtAt`. The evidence index records the billing annotation and the user action.

### 6.2 Residual P3 inconsistencies

| # | File:line | Finding |
| --- | --- | --- |
| D1 | `docs/reports/morrow-v2-rc-evidence-index.md:37-47` | CI table still stops at `ac00627`; it does not cite the frozen-HEAD run `42025990645`. |
| D2 | `docs/reports/morrow-v2-rc-delivery-report.md:16-18`; `morrow-v2-rc-work-log.md:40-42` | CI cause remains generic “Actions 启动/runner 分配基础设施失败”; the billing annotation and user action are only in the evidence index. |
| D3 | `evals/morrow-v2-rc/transcripts/20261105T195500Z-rc-fad6a94.md` | BLOCKED section still says “CI on `ac00627`”; the current code SHA is `fad6a94` and the frozen HEAD is `84481f8`. |
| D4 | `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/manifest.md:3` | Screenshots are parent-code `6f5fe47` copies; they cannot verify the new 1280/390/CSS fixes. The manifest is honest, but the directory name implies the new RC. |

No empty final-HEAD fields were found. The old Issue #53 docs still carry their historical banners; the design-system token table and contrast wording are correct.

## 7. Secret / user-data scan

The new payload contains no `sk-`, `Bearer <token>`, private-key header, AWS/GitHub/Slack/Google token, or user data. Tracked-text scan still shows only the synthetic `sk-lik…tion` adversarial fixture, no real user paths in RC docs, and only fake `example.com` emails and synthetic phone fixtures. The screenshots contain no key material. **PASS.**

## 8. Residual risks and blockers

1. **NSIS/install/launch (P2):** no complete NSIS installer; host Electron crash blocks installed-app launch and screenshots.
2. **CI billing (P2 external):** run `42025990645` is 4/4 0-step; user must fix GitHub payment/spending limit.
3. **Docs CI references (P3):** add run `42025990645`, fix the transcript's `ac00627` reference, and record the billing cause in the delivery report/work log.
4. **Screenshot evidence (P3):** the 9 screenshots are parent-code copies; the 1280/390 fixes are not visually verified on the RC SHA.
5. **B3 per-row reason (P3):** shape is per-row, but the reason is still the table-level constant; no field-level validation; unexecuted on RC SHA.
6. **B4 adapter coverage (P3):** exact-1-MiB/UTF-8/empty/parse-failure adapter tests missing.
7. **Delete save disarm (P3):** `save()` does not disarm delete.
8. **Artifact trust (P3):** unsigned and not reproducibly built; the embedded content matches the fresh build substantively.
9. **Provider/local external blockers:** `BLOCKED_QUOTA` and `BLOCKED_LOCAL_SERVICE_NOT_RUNNING`.

## 9. Exact commands and exit codes

All commands were run from the repository root on 2026-11-05.

| Command | Exit | Result |
| --- | --- | --- |
| `git rev-parse HEAD` | 0 | `84481f83383613c01e9ca35bc9700d54d23314e2` |
| `git status --porcelain` | 0 | clean before review |
| `gh pr view 54 --json ...` | 0 | OPEN, not draft, MERGEABLE, UNSTABLE, head `84481f8` |
| `gh pr checks 54` | 1 | 4/4 fail, run `42025990645` |
| `gh api .../actions/runs/42025990645/jobs` | 0 | `runner_id=0`, `runner_name=""`, `steps=[]`, 2s |
| `gh api .../check-runs/<id>/annotations` | 0 | billing/spending-limit message on all 4 |
| `stat -c '%s' <exe>` | 0 | 100542249 |
| `sha256sum <exe>` | 0 | `e18a13a5…40c1b` |
| `git cat-file -s 84481f8:<exe>` | 0 | 100542249 |
| `file <exe>` | 0 | PE32 NSIS self-extracting archive |
| 7z payload probe | 0 | offset 50,493; length 100,491,756; SHA256 `8cd63470…b1272` |
| asar probe | 0 | SHA256 `e6866f86…c597de`; package.json 2.0.0 |
| embedded copy probe | 0 | new copy present (1); old copy absent (0) |
| embedded CSS probe | 0 | `1320px` (1); 6 `overflow-wrap`; `index-Bj03RVHd.css` |
| fresh-build diff | 1 | only a leading `;` and trailing newline differ; substantive content identical |
| `npx vitest run` (code `fad6a94`, unchanged) | 0 | 129 files / 1156 tests / 0 skipped |
| targeted B1–B4 tests | 0 | 4 files / 31 tests |
| `npx tsc --noEmit` | 0 | PASS |
| `npm run build` | 0 | PASS; fresh `out/` matches the embedded content substantively |
| `npm run evaluate` / `evaluate:cognition` | 0 | PASS with `TEMP`/`TMP=<repo>/.tmp/es` |
| `git status --porcelain` (after) | 0 | only the two updated review docs |

## 10. Findings

| # | Severity | File:line | Finding | Conclusion |
| --- | --- | --- | --- | --- |
| F1 | **CLOSED (was P1)** | `Morrow-2.0.0-x64-portable.exe` | New payload/asar differ from the old build; new copy/CSS present; old copy/CSS absent; docs hash/size updated | **PASS** — P1 closed. |
| F2 | **P2 / acceptance** | `release/Morrow-Setup-2.0.0-x64.exe` | NSIS installer remains an incomplete stub; install/launch/screenshots blocked | **BLOCKED** — unchanged. |
| F3 | **P2 / external CI** | run `42025990645` | 4/4 0-step; billing/spending-limit annotation | **BLOCKED** — user must fix GitHub billing. |
| F4 | P3 / docs | `morrow-v2-rc-evidence-index.md:37-47`; `delivery-report.md:16-18`; `work-log.md:40-42`; transcript | CI table lacks run `42025990645`; generic CI cause; transcript says `ac00627` | **P3** — update references. |
| F5 | P3 / evidence | `manifest.md:3` | Screenshots are parent-code copies; no RC-SHA visual evidence for 1280/390 | **P3** — capture after launch is unblocked. |
| F6 | P3 / B3 | `product-path-smoke.mjs:380` | Per-row shape, but reason is table-level; no field-level validation; unexecuted on RC SHA | **P3** — backlog. |
| F7 | P3 / B4 | `openai-compatible.test.ts` | Adapter tests omit exact-1-MiB/UTF-8/empty/parse-failure cases | **P3** — add boundary cases. |
| F8 | P3 / B1 | `provider-profiles-ui.ts:225-251` | `save()` does not disarm delete | **P3** — unchanged. |
| F9 | P3 / artifact | `Morrow-2.0.0-x64-portable.exe` | Unsigned; no reproducible build | **P3** — sign/document before public release. |

## 11. Conclusion

- The final portable RC is correct: size **100,542,249**, SHA256 **`e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b`**, real PE32 NSIS+7z, new payload/asar, new copy/CSS, old copy/CSS absent, and docs updated to the new hash.
- Code review: **PASS_WITH_NON_BLOCKING_BACKLOG**. Overall RC: **PARTIAL**. NSIS/install/launch and frozen-SHA CI remain BLOCKED; the CI is 4/4 0-step due GitHub billing; the provider/local external blockers remain.
- Do not merge or publish a Release until the NSIS/install/launch path and CI are resolved or explicitly accepted as blockers. The portable RC itself can be tried on a normal Windows host.
