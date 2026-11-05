# Morrow V2 Windows RC Independent Review (Issue #55, PR #54, frozen HEAD `29d4645`)

Independent reviewer: separate context; did not write this implementation. No product code, test, migration, CI, existing doc, evidence, or RC binary was modified. The only repository writes are this file and `docs/audit/morrow-v2-rc-file-review-matrix.md`. Throwaway probes were written only under `.tmp/review/`. No `.tmp/*key*` or `.tmp/second-provider/*` file was opened. The worktree was clean before the review; after the review the only changes are the two new review documents (untracked).

Review date: 2026-11-05.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Local checkout | `E:\Hasee\Documents\morrow v2\zcode\stage3-audit\repo` |
| Branch | `feat/morrow-v2-final-closure` |
| Frozen RC HEAD | `29d464545d081836c4aa36e76e2b9f950b020f2f` |
| RC code/test SHA | `ac00627d0dc50677fc3b21ab0ae19c29f08fe9f7` |
| RC docs/binary commit | `29d4645` (parent `ac00627`) |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft, `MERGEABLE`, `mergeStateStatus=UNSTABLE` |
| PR head at review | `29d464545d081836c4aa36e76e2b9f950b020f2f` (matches frozen HEAD) |
| PR reviews | none (`reviews: []`) |
| Last green code-SHA CI | run `41995422882`, head `6f5fe47` (parent code), 4/4 PASS |
| Frozen-HEAD CI | run `42018244011`, head `29d4645`, 4/4 FAIL, all jobs 0-step |
| Worktree | clean before the review; only the two new review docs are untracked after it |

The prior Issue #53 review docs (`docs/audit/morrow-v2-final-independent-review.md`, `morrow-v2-final-file-review-matrix.md`) describe `df8f802`; they are historical and are not used as evidence for this RC.

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall RC delivery** | **PARTIAL** |
| **Code review (B1–B4)** | **PARTIAL** |
| **RC portable artifact** | **PASS** |
| **NSIS installer / install / first launch / installed screenshots** | **BLOCKED** |
| **Frozen-SHA CI** | **BLOCKED by GitHub billing**, and additionally **FAIL (code)** on a deterministic smoke assertion |
| **Docs consistency** | **PARTIAL** |
| **Secret / user-data scan** | **PASS** (no real secret, Authorization value, private key, or user data found) |
| **Merge recommendation** | **DO NOT MERGE / DO NOT RELEASE yet** |

The portable RC is a real, hash-verified Windows executable containing the `ac00627` build. However, the required install path (NSIS), installed-app launch, installed screenshots, and the frozen-SHA CI are all blocked. In addition, the frozen SHA carries a code-level CI defect: `scripts/smoke.mjs:514` still asserts the old `dataPolicy` string, so the Electron smoke step will fail even after the GitHub billing block is removed. There is no secret leak, data corruption, or runtime product regression, so the verdict is not FAILED.

## 2. CI state and independent diagnosis

### 2.1 Actual runs

| Run | Head | SHA meaning | Conclusion | Jobs |
| --- | --- | --- | --- | --- |
| `41995422882` | `6f5fe47` | parent code | **success** | 4/4 PASS; runner IDs `1000001030`–`1000001033`; 9–17 steps per job |
| `42005665855` | `df8f802` | earlier code | failure | 4/4 0-step |
| `42007647526` | `ff5b787` | docs | failure | 4/4 0-step |
| `42004491868` | `eac8fbd` | docs | failure | 4/4 0-step |
| `42001850336` | `13ce2a6` | docs | failure | 4/4 0-step |
| `42011815669` | `ac00627` | RC code/test | failure | 4/4 0-step |
| **`42018244011`** | **`29d4645`** | **frozen HEAD** | **failure** | **4/4 0-step** |

`gh pr checks 54` on the frozen HEAD returns:

```
Typecheck, tests, build and smoke (ubuntu-latest)      fail  2s  run 42018244011 / job 127214087371
Typecheck, tests, build and smoke (windows-latest)     fail  2s  run 42018244011 / job 127214087160
Windows package, install and installed-app smoke       fail  3s  run 42018244011 / job 127214087232
Windows upgrade path (schema migrations under the real app) fail 4s run 42018244011 / job 127214086983
```

### 2.2 Evidence for the 0-step failures

For run `42018244011` and every earlier failed run:

- every job has `runner_id: 0`, `runner_name: ""`, `runner_group_id: 0`, and `steps: []`;
- jobs start and complete in 2–4 seconds;
- job logs are unavailable (`gh run view --log` → `log not found`; job annotations endpoint for the Actions job → HTTP 404);
- no artifacts are produced (`artifacts.total_count = 0`).

The check-run annotations for **every** failed job (including the frozen HEAD) contain:

> The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings

The same annotation is present on `ac00627`, `ff5b787`, and `df8f802`; the green `6f5fe47` run has no failure annotation. The repository is private (`private: true`), so Actions minutes are billed. `repos/.../actions/permissions` returns `enabled: true, allowed_actions: all`.

The workflow file is **byte-identical** between the green parent SHA and the frozen SHA:

```
git show 6f5fe47:.github/workflows/ci.yml | sha256sum  → bbf633b23151e8fc691ed42eaddb7d2736e7b68d2b9ade394d88fd610f3e71e5
git show 29d4645:.github/workflows/ci.yml | sha256sum  → bbf633b23151e8fc691ed42eaddb7d2736e7b68d2b9ade394d88fd610f3e71e5
git diff 6f5fe47 29d4645 -- .github/workflows/ci.yml  → empty
```

**Conclusion:** the 0-step failures are **account/billing infrastructure**, not code or workflow. The specific external action required is to fix the GitHub account payment/spending limit. This is more precise than the RC docs' wording “Actions 启动/runner 分配基础设施失败”, which omits the billing annotation and the user action.

**Parent-SHA PASS is not accepted as frozen-SHA CI.** The frozen HEAD is `29d4645`, and its CI is 4/4 FAIL. The green `41995422882` run is on the parent code SHA `6f5fe47`.

### 2.3 Additional code-level CI failure on the frozen SHA

The frozen SHA is **not merely infra-blocked**. `scripts/smoke.mjs:514` still asserts the pre-RC `dataPolicy` value:

```js
assert.equal(info.dataPolicy, 'local-first-consented-deepseek-egress-memory-goals-reminders')
```

The app now returns `local-first-consented-provider-egress-memory-goals-reminders` (`src/app/index.ts:77`, `src/shared/contracts.ts:146`). This assertion is deterministic and is reached by the CI step “Electron smoke (real app, isolated profile, no network egress)” on both Ubuntu and Windows (`.github/workflows/ci.yml:53-60`). Therefore, even if the billing block is removed, the two “Typecheck, tests, build and smoke” jobs will fail at the smoke step. The RC docs' local verification table omits `npm run smoke`, so this was not caught locally. This is the highest-severity code-review finding in this round.

## 3. B1–B4 review

| Area | Item | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Range slider keyboard focus ring | **PASS** | `src/renderer/src/style.css:364` adds `input[type="range"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }`; the previous `outline: none` is removed (line 363). |
| B1 | Light-theme muted contrast ≥ 4.5:1 | **PASS** | `--muted: #66676d` (`style.css:43`). Computed WCAG ratios: on `#f3f0e8` 4.949, on `#ede9df` 4.649, on `#fbfaf6` 5.397, on `#ffffff` 5.636. Dark `#8595ae`: 6.628/6.271/5.828. `tests/design-tokens.test.ts` recomputes bg/panel in both themes. |
| B1 | Long-text safe wrapping | **PARTIAL** | Added to `.chat-message-body`, `.suggestion-claim`, `.memory-content`, goal/reminder/task meta, `.provider-facts span`. `.pending-item-meta` (provider profile endpoint/model/health) at `style.css:441` still has no `overflow-wrap`. |
| B1 | 390 self-model grid / nav | **PASS (code), UNVERIFIED on RC SHA** | `style.css:523` makes `.self-model-grid` one column at ≤640; `style.css:501-502` makes nav wrap 2×2 with `overflow-x: visible`. No RC-SHA screenshot or automated layout test exists. The committed 390 screenshots are from parent code `6f5fe47` and still show the nav cut (`04 设…` at the right edge). |
| B1 | 1280 composer | **FAIL (P3)** | The chat height reduction is inside `@media (max-width: 1180px)` (`style.css:491-493`), so it does not apply at 1280. The 1280 screenshot (parent code, unchanged layout above 1180) shows the composer starting near y≈658 and the send button below the 800px fold. The RC report line 29 claims “<1180 … composer 在首屏可达”, which is not a 1280 fix. |
| B1 | Provider delete state cleanup | **PARTIAL** | `provider-profiles-ui.ts:143-147` disarms on edit; `:178-180` disarms on any non-delete card click (covers test/discover/default). The form `save()` (`:225-251`) does **not** disarm, although the task explicitly includes “保存”. The 5s timer eventually clears it. |
| B1 | Built-in profile delete disabled | **PASS** | `provider-profiles-ui.ts:114-117` disables delete for `deepseek`, `spark`, `local-openai` and sets a title reason; the service still returns `FORBIDDEN` (`companion-service.ts:708`). Test added at `tests/provider-profiles-ui.test.ts`. |
| B1 | `providerUiReady` after real loading | **PASS** | `provider-profiles-ui.ts:217-222` sets the marker in `loadProfiles()`'s `finally` (success or failure); the module-init assignment is removed. `scripts/product-path-smoke.mjs:179-186` waits for the marker with a 10s deadline. |
| B1 | Reduced-motion canvas | **PASS** | `presence-ui.ts:102-107` draws once and sets `frame = 0` under `prefers-reduced-motion`; resize (`:38`) and pointer move (`:121`) redraw statically. No continuous rAF. |
| B2 | Companion UI DeepSeek copy | **PASS** | `companion-ui.ts:318-319,471` now say “模型服务请求”. |
| B2 | `index.html` old DeepSeek copy | **PARTIAL** | Line 377 is fixed with “无显式默认 Provider 时优先于 DeepSeek”. Line 369 still says “启用后，对话会优先使用本地模型” without the explicit-default caveat. Line 395 still says “每次 DeepSeek 发送仍需单独确认”. Both strings are present in the shipped `app.asar` renderer HTML. |
| B2 | `app/index.ts` HTTPS/local and dataPolicy | **PASS** | `app/index.ts:104` now says remote HTTPS / local loopback HTTP; `:77` and `contracts.ts:146` use `...provider-egress...`. |
| B2 | Local-priority copy accuracy | **PARTIAL** | Line 377 fixed; line 369 residual (see above). |
| B2 | CI smoke consistency | **FAIL (blocking)** | `scripts/smoke.mjs:514` stale assertion; see §2.3. |
| B3 | Remove `continuityAfterRestart = continuityBefore` tautology | **PASS** | `scripts/product-path-smoke.mjs:600-609` now reads `continuityBefore` in start #2, stops, then `:632` reads `continuityAfterRestart` in start #3. No self-assignment remains. |
| B3 | Real goal task/progress fixture | **PASS (SQL valid)** | `product-path-smoke.mjs:409-435` inserts `goal_tasks`, `companion_goals`, `companion_goal_progress` rows with valid v49 columns and FK values; `FULL_CONTINUITY_TABLES` includes `goal_tasks`, `companion_goals`, `companion_goal_progress` (`:275-283`). The bridge `continuityScript` still reads only `goals`, not task/progress; the DB full-field snapshot is the evidence for those two tables. |
| B3 | Per-row allowlist reasons | **PARTIAL** | `:288-302` replaces table-level counts with `ALLOWED_ADDITION_REASONS` and `:376-382` records `{ reason, keys }` per table. The reason is still table-level, not per-row/per-field; added-row field values are not inspected. Unexpected tables still fail (`result.added`). |
| B3 | Complete diff arrays | **PASS** | `removed`/`changed` are arrays; `added` now stores key arrays instead of counts. The result/transcript prints `removed`, `changed`, `unexpectedAdded`, `allowedChanges`, `allowedAdditions`. |
| B3 | Execution on RC SHA | **BLOCKED** | No `product-path-smoke` run exists for `ac00627`/`29d4645`; the new script is syntactically valid (`node --check` exit 0) but unexecuted. The last product-path PASS is parent `6f5fe47` run `20261105T084141Z-45483dd6`. |
| B4 | Non-stream body exact 1 MiB | **PASS** | `src/providers/openai-compatible.ts:6-8` `MAX_NON_STREAM_BODY_BYTES = 1_048_576`; `:334-338` uses `readBoundedText`. |
| B4 | Real byte counting / cancel | **PASS** | `bounded-body.ts:37-62` counts `value.byteLength`, cancels at `total > maxBytes`, releases the lock. |
| B4 | UTF-8 multibyte | **PASS** | Incremental `TextDecoder` with `{ stream: true }`; test splits `你` across chunks. |
| B4 | Content-Length not trusted | **PASS** | `bounded-body.ts:27-34` rejects early only when declared > limit; actual bytes still enforced when missing/understated/overstated. |
| B4 | Parse failure / empty body | **PASS** | `JSON.parse` failure and empty body map to `PROVIDER_RESPONSE`; no body or credential is echoed. |
| B4 | Tests | **PARTIAL** | `bounded-body.test.ts` has 10 tests (exact limit, over + cancel, missing/understated/overstated CL, UTF-8 split, read error, cancel throw, empty, 4 KiB). The adapter adds only oversized (1,048,577) + valid JSON. No adapter-level exact-1-MiB success, UTF-8 boundary, empty-body, or JSON-parse-failure test. |
| B4 | Discovery remains 1,048,576 | **PASS** | `src/app/companion-service.ts:442`; oversized test header `1048577` (`provider-multi-source.integration.test.ts`). |

## 4. RC artifact verification

| Check | Result |
| --- | --- |
| File | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` |
| Size | **100,541,545 bytes** (filesystem, `stat`, and `git cat-file -s` all agree) |
| SHA256 | **`cf662590c2ad2d3f5574bc758d933276082f3fb405e71b2d28117d07dec98e67`** (computed; `.sha256` file matches) |
| PE | `MZ` header; `file` reports `PE32 executable for MS Windows 4.00 (GUI), Intel i386, Nullsoft Installer self-extracting archive, 5 sections` (the 32-bit NSIS stub is normal for electron-builder portable; the payload is x64) |
| Payload | Embedded `7z` signature at offset 50,491; listing shows a real Electron app (`Morrow.exe`, `resources/app.asar`, `resources/default_app.asar`, `locales/*.pak`, `version`) |
| Embedded app | `app.asar` package.json: `"name": "morrow-ai-companion-v2", "version": "2.0.0"` |
| Embedded code matches `ac00627` | `app.asar` contains `local-first-consented-provider-egress-memory-goals-reminders` (1; old `deepseek-egress` 0), `1048576` (2), `模型服务请求` (5), `overflow-wrap` (5), `#66676d` (1), `providerUiReady` (1); the built renderer HTML also contains the fixed local-priority caveat and the residual “每次 DeepSeek 发送仍需单独确认” |
| Version info | `FileVersion 2.0.0`, `ProductVersion 2.0.0`, `FileDescription: Local-first AI companion with a traceable cognitive loop` |
| Code signature | **NotSigned** (SmartScreen may warn; the install guide mentions SmartScreen but not that the file is unsigned) |
| Real vs mock | Real 100 MB PE with a real Electron/7z payload; not an empty or mock file |

**Artifact verdict: PASS.** The binary is genuine and demonstrably built from the RC code. Its provenance still relies on the recorded build command rather than a reproducible build (no reproducible-build hash), and it is unsigned; both are residual risks, not artifact failures.

## 5. Install / launch / NSIS verdict

| Item | Verdict | Evidence |
| --- | --- | --- |
| NSIS installer | **BLOCKED_HOST_EXECUTION_POLICY** | `release/Morrow-Setup-2.0.0-x64.exe` is only 189,850 bytes (an incomplete stub); the app payload is a separate 100,205,549-byte `morrow-ai-companion-v2-2.0.0-x64.nsis.7z`. No complete NSIS installer exists in the repo. The docs state the stub execution returns exit 2 / hangs. I did not execute the stub. |
| Clean-profile install / first launch / restart | **BLOCKED_HOST_ELECTRON_CRASH** | Docs state the host Electron 44 exits `0xC0000005` even with `--no-sandbox`; no installed-app evidence. I did not execute the portable binary. |
| Installed-app screenshots | **BLOCKED** | `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/manifest.md:3-4` explicitly says the 9 PNGs are from parent code `6f5fe47` run `20261105T084141Z-45483dd6` and are **not** installed-app screenshots. The RC acceptance matrix row 8 marks this BLOCKED. This is honest and does not present parent screenshots as installed evidence. |
| Upgrade/migration to v49 under the real app | **BLOCKED for real install; PASS for tests** | Matrix row 9 says migration tests 6 groups PASS, real install upgrade BLOCKED. |

The docs do **not** claim COMPLETE and do **not** present parent-SHA screenshots as installed-app evidence. The main residual problem is that the B1 layout fixes have no RC-SHA visual evidence: the committed 390 screenshots are pre-fix and visibly show the nav cut the fix was meant to remove.

## 6. Docs consistency

### 6.1 Fixed RC deliverables

All ten fixed paths exist (the two audit paths are this review and its matrix):

| Deliverable | Status |
| --- | --- |
| `docs/reports/morrow-v2-rc-delivery-report.md` | exists; PARTIAL, honest blockers |
| `docs/reports/morrow-v2-rc-evidence-index.md` | exists; honest, missing ac00627 run ID |
| `docs/reports/morrow-v2-rc-work-log.md` | exists; honest, generic CI cause |
| `docs/testing/morrow-v2-rc-acceptance-matrix.md` | exists; BLOCKED labels honest |
| `docs/audit/morrow-v2-rc-independent-review.md` | this file |
| `docs/audit/morrow-v2-rc-file-review-matrix.md` | written with this review |
| `docs/install/windows-installation-guide.md` | exists; portable/NSIS/launch limits stated |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/` | exists; 9 PNG + manifest; source disclosed as parent code |
| `evals/morrow-v2-rc/results/20261105T191500Z-rc-ac00627.json` | exists; PARTIAL, blockers listed |
| `evals/morrow-v2-rc/transcripts/20261105T191500Z-rc-ac00627.md` | exists; same |
| `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` (+ `.sha256`) | exists; verified |

### 6.2 Historical labels and stale claims

- The five Issue #53 docs (`morrow-v2-final-delivery-report.md`, `morrow-v2-final-evidence-index.md`, `morrow-v2-final-work-log.md`, `morrow-v2-final-acceptance-matrix.md`, `docs/ui/acceptance-matrix.md`) now start with a “历史基线（Issue #53）” banner. No empty final-HEAD field remains (the only grep hit is the prior review quoting the old empty field, which has been fixed).
- Residual P3: some historical docs still use the phrase “最终 HEAD” internally (e.g., `morrow-v2-final-work-log.md:129,135,161`; `morrow-v2-final-acceptance-matrix.md:87`; `morrow-v2-final-evidence-index.md:69,86`). The top banner mitigates this, but the wording is still ambiguous.
- `docs/ui/design-system.md:14` still lists the light `--muted` as `#6e6f73`, while the code is `#66676d`. Line 70 was updated but contains the typo “在纸面  对  约 4.95:1”; the 4.95 figure is true for `#f3f0e8` but the `#ede9df` ratio is 4.649 (still ≥4.5).
- `docs/ui/acceptance-matrix.md:26` still claims 390×844 PASS “表单/卡片不溢出”, but the committed 390 screenshot shows the nav cut at the right edge (pre-fix parent code). This is a historical claim contradicted by its own evidence.
- `docs/reports/morrow-v2-rc-delivery-report.md:29` claims the 1280 composer issue was addressed; the CSS rule only applies at ≤1180, so 1280 is unchanged.
- `docs/reports/morrow-v2-rc-evidence-index.md:45` says the RC `ac00627` run was “未获得可信 run” without citing run `42011815669`; the run exists and is 4/4 0-step.
- The RC docs cite the code SHA `ac00627` but never name the frozen HEAD `29d4645`. This is understandable (the docs are committed in that HEAD), and `git diff ac00627 29d4645` contains only docs/evidence/installer, but the review records it for traceability.
- `docs/testing/morrow-v2-rc-acceptance-matrix.md:20` marks “全字段连续性（含 goal task/progress）” as **PASS（代码/本地测试）**. The new `product-path-smoke.mjs` is not executed by `vitest` and was not run on the RC SHA; the “local test” wording overstates the evidence. The row also says the RC-SHA Electron run is BLOCKED, which is honest.

## 7. Secret / user-data scan

Method: scan all `git ls-files` text files (excluding binaries/images/archives) and the RC binary for high-signal patterns; mask any match before reporting.

| Pattern | Result |
| --- | --- |
| OpenAI-style `sk-...` | 2 matches in `evaluation/fixtures/cognitive-alpha-adversarial-v1.json` and its generated report; both are the synthetic adversarial fixture value (`sk-lik…tion`, 38 chars, next to `"Schedule a meeting…"`), not a real key |
| `Bearer <token>` | 0 |
| Private key PEM | 0 |
| AWS `AKIA…` / GitHub `ghp_…` / Slack `xox…` / Google `AIza…` | 0 each |
| `Authorization:` header values | only documentation/test assertions; no value |
| Real user paths `C:\Users\…` in RC docs | 0 |
| Emails | only `relay.example.com` / `evil.example` in tests |
| Phone-number regex | only synthetic `138****00` test fixtures and digit runs inside SHA-256 hashes (false positives) |
| RC binary | 0 `sk-`, 0 `Bearer <token>`, 0 private-key headers |

Screenshots show the fake profile “Product Path A”, no key material, and no real conversation. The secret scan verdict is **PASS**. The 100 MB binary in git is a repository-size risk, not a secret risk.

## 8. Residual risks and blockers

1. **Blocking CI defect (code):** `scripts/smoke.mjs:514` old `dataPolicy` assertion. Fix is one line; until then the frozen SHA cannot be CI-green even with billing restored.
2. **External CI blocker:** GitHub account payment/spending limit (private repo Actions minutes). User action: fix billing / raise the spending limit, then rerun the frozen SHA.
3. **NSIS installer missing:** only a 189 KB incomplete stub plus a separate `nsis.7z` payload exist; no complete installer.
4. **Install/launch/installed screenshots blocked:** host Electron `0xC0000005`; no installed-app evidence.
5. **No RC-SHA product-path run:** B3 changes and the B1 layout fixes are unexecuted on the RC SHA.
6. **B1 residual gaps:** 1280 composer still below the fold; provider profile metadata (`.pending-item-meta`) not wrapped; save() does not disarm delete.
7. **B2 residual copy:** `index.html:369` and `:395` still name DeepSeek/local priority without the explicit-default caveat; these strings ship in the portable binary.
8. **Docs precision:** CI cause (billing), 1280 claim, design-system token, 390 PASS claim, and the “PASS (code/local test)” continuity wording need correction.
9. **Artifact trust:** binary is unsigned and not reproducibly built; the embedded `ac00627` markers are strong but not a formal provenance proof.
10. **Provider/local-model external blockers:** `BLOCKED_QUOTA` and `BLOCKED_LOCAL_SERVICE_NOT_RUNNING` remain; no new requests were made and no mock was substituted.

## 9. Exact commands and exit codes

All commands were run from the repository root on 2026-11-05. `TEMP`/`TMP` were set to `<repo>/.tmp/es` for vitest/evaluations.

| Command | Exit | Result |
| --- | --- | --- |
| `git status --porcelain` | 0 | empty (clean) |
| `git rev-parse HEAD` | 0 | `29d464545d081836c4aa36e76e2b9f950b020f2f` |
| `gh pr view 54 --json ...` | 0 | OPEN, not draft, MERGEABLE, UNSTABLE, head `29d4645`, base `3812b18` |
| `gh pr checks 54` | 1 | 4/4 fail, run `42018244011` |
| `gh api repos/.../actions/runs/42018244011` | 0 | conclusion failure; 4 jobs |
| `gh api repos/.../actions/runs/42018244011/jobs` | 0 | `runner_id=0`, `runner_name=""`, `steps=[]` |
| `gh api repos/.../check-runs/<id>/annotations` | 0 | billing/spending-limit message on all 4 |
| `gh api repos/.../actions/runs/41995422882/jobs` | 0 | 4/4 success, 9–17 steps, runner IDs 1000001030–33 |
| `gh api repos/.../branches/.../protection` | 403 | not available on this private free-plan repo |
| `npx tsc --noEmit` | 0 | PASS |
| `npx vitest run` | 0 | **129 files / 1156 tests passed / 0 skipped** (212.16s) |
| `npx vitest run tests/design-tokens.test.ts tests/provider-profiles-ui.test.ts src/providers/openai-compatible.test.ts src/providers/bounded-body.test.ts` | 0 | 4 files / 31 tests passed |
| `npm run build` | 0 | PASS |
| `npm run evaluate` | 0 (with TEMP/TMP) | PASS; `passed:true` |
| `npm run evaluate:cognition` | 0 (with TEMP/TMP) | PASS; `passed:true`, 0 network calls |
| `npm run evaluate` / `evaluate:cognition` **without** TEMP/TMP override | 1 | environmental: the runner writes to the OS temp dir; with the documented repo TEMP it passes |
| `node --check scripts/product-path-smoke.mjs` | 0 | syntax valid |
| `stat -c '%s' <exe>` | 0 | 100541545 |
| `sha256sum <exe>` | 0 | `cf662590…8e67` |
| `git cat-file -s 29d4645:<exe>` | 0 | 100541545 |
| `file <exe>` | 0 | PE32 NSIS self-extracting archive |
| Python 7z/asar probe | 0 | real Electron payload; app.asar version 2.0.0; `ac00627` markers present |
| Secret/PII Python scan | 0 | counts as in §7 |
| `git status --porcelain` (after) | 0 | only the two new review docs are untracked; no product/test/docs/evidence changes |

## 10. Findings

| # | Severity | File:line | Finding | Reproduction | Conclusion |
| --- | --- | --- | --- | --- | --- |
| F1 | **P1 / blocking CI** | `scripts/smoke.mjs:514` | Smoke asserts the old `dataPolicy` string; the app returns the new one. CI Electron smoke will fail deterministically after billing is fixed. | Compare `src/app/index.ts:77` with `scripts/smoke.mjs:514`; or run `npm run smoke` on a working Electron host. | **FAIL** — fix the assertion to `local-first-consented-provider-egress-memory-goals-reminders` and rerun. |
| F2 | **P2 / RC acceptance** | `release/Morrow-Setup-2.0.0-x64.exe` (189,850 B), `release/*.nsis.7z` | No complete NSIS installer; only a stub plus payload. | `find . -name '*.exe'`; compare the stub size with the 100 MB payload. | **BLOCKED** — do not call the RC an installer; portable is the only artifact. |
| F3 | **P3 / evidence** | `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/manifest.md:3-4` | All 9 screenshots are parent-code `6f5fe47`; they cannot verify the B1 fixes; the 390 image still shows the pre-fix nav cut. | Open `memory-390x844.png` / `settings-390x844.png`; read the manifest. | **P3 evidence gap**, honestly labeled; capture on the RC SHA after launch is unblocked. |
| F4 | **P3 / docs** | `docs/reports/morrow-v2-rc-delivery-report.md:17-18`; `morrow-v2-rc-work-log.md:42` | CI diagnosis says “Actions 启动/runner 分配基础设施失败” but omits the actual billing/spending-limit annotation and the user action. | `gh api .../check-runs/<id>/annotations`. | **P3** — state the billing cause and required action. |
| F5 | **P3 / B2** | `src/renderer/index.html:369`, `:395` | Residual misleading copy: unconditional local priority; cognitive state still described as “DeepSeek 发送”. Both ship in `app.asar`. | `grep -n` the lines; `grep -a` the extracted `app.asar`. | **PARTIAL** — generalize the copy. |
| F6 | **P3 / B1** | `src/renderer/src/style.css:491-493`; `morrow-v2-rc-delivery-report.md:29` | 1280 composer is not fixed; the height rule only applies at ≤1180. The 1280 screenshot shows the send button below the fold. | Read the media query; view `chat-1280x800.png`. | **PARTIAL** — either add a 1280 rule or document the scroll behavior with evidence. |
| F7 | **P3 / B1** | `src/renderer/src/style.css:441` | `.pending-item-meta` (provider profile endpoint/model/health) has no `overflow-wrap`; long unbroken values can overflow. | Inspect the rule; no wrapping properties. | **PARTIAL** — add wrapping for provider metadata. |
| F8 | **P3 / B1** | `src/renderer/src/provider-profiles-ui.ts:225-251` | `save()` does not call `disarmDelete()`; the task explicitly includes save. | Arm delete, submit the form; the armed state persists until the 5s timer. | **PARTIAL** — disarm in `save()`. |
| F9 | **P3 / B3** | `scripts/product-path-smoke.mjs:288-302,376-382` | Allowlist reason is table-level; added-row fields are not inspected. | Read `ALLOWED_ADDITION_REASONS` and `diffFullSnapshots`. | **PARTIAL** — per-row/field validation remains backlog. |
| F10 | **P3 / B4** | `src/providers/openai-compatible.ts:334-340`; `openai-compatible.test.ts` | Redundant `ProviderBodyLimitError` branch (both branches throw `PROVIDER_RESPONSE`); adapter tests omit exact-1-MiB/UTF-8/empty/parse-failure cases. | Read the catch; run the 12 adapter tests. | **P3** — simplify and add boundary cases. |
| F11 | **P3 / docs** | `docs/ui/design-system.md:14,70` | Token table still lists `#6e6f73`; line 70 has the typo “纸面  对  约 4.95:1”; 4.95 is not true on `#ede9df` (4.649). | `grep -n`; recompute contrast. | **P3** — update the token and wording. |
| F12 | **P3 / docs** | `docs/ui/acceptance-matrix.md:26`; `docs/testing/morrow-v2-rc-acceptance-matrix.md:20` | 390 PASS claim contradicted by its own screenshot; continuity “PASS (code/local test)” overstates an unexecuted script. | Compare the screenshot; check `vitest` coverage of `product-path-smoke.mjs` (none). | **P3** — mark the 390 claim historical/partial and the continuity evidence as code-only. |
| F13 | **P3 / artifact** | `Morrow-2.0.0-x64-portable.exe` | Unsigned; SmartScreen may warn; no reproducible build. | `Get-AuthenticodeSignature` → NotSigned. | **P3 risk** — sign before public release or document prominently. |

No finding meets the FAILED criteria (secret leak, data corruption, runtime product regression). The highest-impact issue is F1, which blocks CI readiness; F2/F3 block the installable-RC acceptance.

## 11. Conclusion

- The RC portable artifact is real and matches the RC code; local typecheck, 129/1156 tests, build, and both offline evaluations pass with the documented TEMP override.
- The frozen-SHA CI is not green. The 0-step failures are GitHub **billing/spending-limit** infrastructure, not code; the parent-SHA PASS (`6f5fe47`) is not the frozen-SHA CI. Separately, `scripts/smoke.mjs:514` is a deterministic code-level CI failure that must be fixed before any rerun can be green.
- NSIS installation, installed-app launch, and installed-app screenshots remain blocked; the docs honestly mark them BLOCKED and do not present parent screenshots as installed evidence.
- B1/B2/B3/B4 are largely implemented, but B2 has residual shipped copy, B1 has the 1280/composer and provider-metadata gaps, B3's allowlist is not per-field and is unexecuted on the RC SHA, and B4's adapter tests are thinner than the task requested.
- Overall: **PARTIAL**. Do not merge or publish a Release until F1 is fixed and CI is green, and do not describe this as an installable RC until the NSIS/install/launch blockers are resolved.
