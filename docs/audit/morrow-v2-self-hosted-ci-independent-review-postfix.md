# Morrow V2 Self-Hosted CI Independent Review — Post-Fix, Issue #56, PR #54, HEAD `902cf5e`

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. The only repository write is this file. Throwaway probes were written only under `.tmp/`; nothing was staged or committed. No `npm ci`, `npm install`, full test suite, packaging step, Electron launch, workflow dispatch, tag creation, or hosted-Actions run was performed. This is a static plus targeted-probe review.

Review date: 2026-11-05.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Branch | `feat/morrow-v2-final-closure` |
| Reviewed HEAD | `902cf5eaca9359663e6647e57a37d9aca7867b58` |
| Parent SHA | `d5ae25df072156b7a302fb8dffca32cccdcc3728` |
| Pre-fix review HEAD | `ee24aa5b00db6eac91509a56ce2fde2c259e54c7` (parent `70e89f1d92975d506e803fff511b83191c9148d0`) |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft, `MERGEABLE`, `mergeStateStatus=CLEAN`, head `902cf5e`, base `3812b18` |
| PR checks | **none** — `statusCheckRollup: []`; check-runs on `902cf5e`: `total_count=0` |
| Self-hosted workflow runs | **none**; `self-hosted-ci.yml` is not registered on the default branch (`gh workflow view` 404) |
| Registered self-hosted runners | **0** (`actions/runners` `total_count=0`) |
| Worktree | clean before review; only this new audit file after |
| Post-fix delta | `git diff --shortstat ee24aa5..HEAD` = 10 files, 585 insertions, 125 deletions; only `.github/workflows/`, `scripts/ci/`, `docs/` |

The post-fix delta contains exactly one workflow file (`.github/workflows/self-hosted-ci.yml`), two CI scripts, five CI/delivery docs, and the two pre-fix audit files added by the author. `.github/workflows/ci.yml` is unchanged since `ee24aa5`; its manual-only trigger was part of the earlier implementation and is still present.

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall Issue #56** | **PARTIAL** — operational path implemented; real self-hosted run has not happened |
| **Security gates** | **PASS** — no fork/PR bypass, hosted fallback, artifact upload, secret, `pull_request_target`, or product change found |
| **Code/static review** | **PARTIAL** — F1/F2/F3/F7 fixed; F4/F5/F6/F8 retain P3 gaps |
| **Workflow dispatchability** | **PASS (static)** — tag-push fallback works without modifying `main`; `workflow_dispatch` remains unavailable until the file is on `main`, and the docs now say so |
| **PowerShell compatibility** | **PASS** — all self-hosted steps use `shell: powershell`; setup preflight exits 0 under Windows PowerShell 5.1 |
| **Installed-app NSIS smoke** | **PASS (implementation) / PENDING (execution)** — silent install + installed-exe `--verify-upgrade` implemented; no real run |
| **Docs honesty** | **PARTIAL** — PENDING/PARTIAL is honest; redaction coverage, the Issue #56 comment record, and “static verification PASS” are overstated |
| **Product runtime change** | **PASS** — none; only CI/workflow/scripts/docs changed |
| **Real self-hosted run** | **PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED** — no runner, no run, no tag push |
| **Merge/release recommendation** | Do not represent this as CI PASS; do not merge or publish on the basis of this CI path until a real run completes and the F4/F5/F8 documentation gaps are corrected |

The two pre-fix blockers (F1 dispatchability and F2 PowerShell 5.1) are genuinely fixed in the current files. The tag-push fallback is a valid GitHub Actions path: for a `push` event GitHub uses the workflow file at the tagged commit, and `github.sha` is the tagged commit for the lightweight tag the docs create; the guard allows the tag ref and `verify` still requires `needs.guard.result == 'success'`. No new blocker under the Issue #56 fork/PR threat model was found. One write-access collaborator caveat is recorded in §9. The remaining items are P3 residuals plus the operational dependency that no runner is registered.

## 2. CI state for the reviewed HEAD

| Run / SHA | Event | Result | Evidence |
| --- | --- | --- | --- |
| `902cf5e` (HEAD) | none | **0 checks / no runs** | `statusCheckRollup=[]`; check-runs `total_count=0` |
| `70e89f1` (pre-fix parent) | `pull_request` | **4/4 failure, 0 steps** | run `42027056929`; billing/spending-limit annotation |
| `84481f8` | `pull_request` | **4/4 failure, 0 steps** | run `42025990645` |
| `6f5fe47` | `pull_request` | **4/4 success** | run `41995422882`; GitHub-hosted runners |

There is no CI PASS for `902cf5e`, and no self-hosted run exists. The old failed runs are historical and are not evidence for this HEAD. The successful parent-code run is not this HEAD.

## 3. Workflow security review

### 3.1 `self-hosted-ci.yml` gates

| Gate | Result | Evidence |
| --- | --- | --- |
| YAML parses | **PASS** | `python yaml.safe_load` exit 0; `on={'workflow_dispatch': None, 'push': {'tags': ['ci-self-hosted-*']}}`; jobs `[guard, verify]` |
| No `pull_request_target` / `pull_request` / `schedule` | **PASS** | parsed trigger; text scan |
| No hosted fallback | **PASS** | both jobs `runs-on: [self-hosted, Windows, X64, morrow-ci]`; no `windows-latest`/`ubuntu-latest` |
| Permissions minimal | **PASS** | `permissions: contents: read` (lines 14-15) |
| Guard checks repository `ve766/morrow-ai-companion-v2` | **PASS** | guard `if` lines 26-31 |
| Guard checks ref branch or `ci-self-hosted-*` tag | **PASS** | lines 28-29 |
| Guard checks `github.actor` and `github.triggering_actor` | **PASS** | lines 30-31 |
| Tag name equals `ci-self-hosted-<GITHUB_SHA>` | **PASS** | guard step lines 38-41; static probe: valid tag passes, wrong tag rejected |
| Guard runs no repository code | **PASS** | guard job has no `uses`, no checkout; only inline `Write-Host` and tag-name check |
| `verify` has `needs: guard` | **PASS** | line 51 |
| `verify` cannot run if guard fails/skips | **PASS** | line 52 `if: needs.guard.result == 'success'`; skipped guard is not `success` |
| Checkout uses exact `${{ github.sha }}` | **PASS** | lines 56-61 |
| Checkout `persist-credentials: false` | **PASS** | parsed boolean false |
| SHA identity re-verified | **PASS** | workflow lines 63-73; script lines 9-12 with `-ExpectedSha` |
| No `upload-artifact` | **PASS** | text scan; archive is local only |
| No `continue-on-error` | **PASS** | text scan |
| No `secrets.` | **PASS** | text scan |
| Concurrency sane | **PASS** | per-ref group, `cancel-in-progress: false` (lines 17-19) |
| Timeouts sane | **PASS** | guard 10 min; verify 180 min |
| Fork cannot trigger the upstream self-hosted runner | **PASS** | `push` tags require write access to the upstream repository; guard also checks repository and actor; no `pull_request` event |
| Tag-trigger trust caveat | **RESIDUAL** | the workflow file used for a tag push is the one at the tagged commit; a write-access collaborator can tag a commit with a modified workflow and bypass the actor allowlist. This is not a fork/PR bypass; see §9.4. |

### 3.2 `ci.yml`

| Gate | Result | Evidence |
| --- | --- | --- |
| Manual-only | **PASS** | parsed `on: workflow_dispatch` |
| No `pull_request_target` / `continue-on-error` / secrets | **PASS** | text scan |
| Hosted runners and `upload-artifact` removed | **NO** | `ci.yml` still uses `windows-latest`/`ubuntu-latest` and `actions/upload-artifact@v4`; this is the legacy hosted workflow, not the no-billing self-hosted path. Do not dispatch it. |
| Required checks verifiable | **UNAVAILABLE** | branch-protection API returns HTTP 403 on this private free repository |

The trigger change on the feature branch intentionally removes automatic PR/push runs. `main` and `release/morrow-v2-final-delivery` still have the old automatic `ci.yml`; a push to those branches still triggers hosted jobs (F10). This is outside the allowed change scope (the task forbids modifying `main`/`release`), but it must not be mistaken for a no-billing guarantee on those branches.

### 3.3 Tag-trigger semantics (F1)

GitHub's documented behavior, which the fix relies on:

- For a `push` event, GitHub searches `.github/workflows` for workflow files present in the associated commit SHA or Git ref of the event, and each run uses the workflow version present in that commit/ref. The `push` section explicitly includes “workflows that are not merged into the default branch.”
- `workflow_dispatch` requires the workflow to exist on the default branch. That is why the manual dispatch button is unavailable while `self-hosted-ci.yml` exists only on `feat/morrow-v2-final-closure`.
- For a tag push, `GITHUB_REF` is `refs/tags/<tag>` and `GITHUB_SHA` is the tagged commit (the “tip commit pushed to the ref”). The docs' `git tag ci-self-hosted-$(git rev-parse origin/feat/morrow-v2-final-closure)` creates a lightweight tag, so the tag name and `github.sha` match exactly.

The guard `if` allows `refs/tags/ci-self-hosted-*`, the guard step rejects any tag name that is not `ci-self-hosted-<GITHUB_SHA>`, and `verify` still depends on the guard. Therefore the tag path removes the F1 blocker **without modifying `main`**. This was verified statically (YAML parse, guard logic probe) and against GitHub's documented semantics; no live tag push was performed. The docs now explicitly state the default-branch limitation and offer the tag fallback (`docs/ci/self-hosted-runner-setup-windows.md:45-64,86`; `docs/ci/ci-no-billing-operations.md:13-16`; `docs/reports/morrow-v2-self-hosted-ci-evidence-index.md:52-61`).

## 4. Per-finding status F1-F12

| # | Pre-fix severity | Status | Evidence | Residual |
| --- | --- | --- | --- | --- |
| F1 | BLOCKER | **PASS** | `.github/workflows/self-hosted-ci.yml:6-12` adds `push.tags: ci-self-hosted-*`; guard `if` lines 26-31 allows the tag ref; guard step lines 38-41 enforces tag name == `ci-self-hosted-<GITHUB_SHA>`; `verify` needs guard/success lines 51-52; checkout exact SHA lines 56-61. Docs: `docs/ci/self-hosted-runner-setup-windows.md:45-64,86`, `docs/ci/ci-no-billing-operations.md:13-16`, `docs/reports/morrow-v2-self-hosted-ci-evidence-index.md:52-61`. Static guard probe: valid tag passes, wrong tag rejected. | `workflow_dispatch` remains unavailable until the workflow is on `main`; the docs say so. Tag push requires write access. |
| F2 | BLOCKER | **PASS** | All four `shell:` entries in `self-hosted-ci.yml` are `powershell` (lines 36, 64, 76, 85); no `pwsh`. `scripts/ci/setup-self-hosted-runner.ps1:8` uses `$env:OS`, not `$IsWindows`. Preflight under `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ci/setup-self-hosted-runner.ps1` exited 0 under PS 5.1.26100.9711 (`node v22.23.2`, `npm 10.9.8`, `git 2.55.0`). Parser exit 0 for both scripts. | Setup script still accepts `ARM64` (line 9) while the workflow requires the `X64` label; docs say x64. Minor, pre-existing. |
| F3 | P2 | **PASS (implementation) / PENDING (execution)** | `scripts/ci/run-self-hosted-ci.ps1:92-113` finds the installer, runs `/S`, waits 180 s, checks exit code, locates `Morrow.exe`, sets `MORROW_SMOKE_EXECUTABLE` and `MORROW_SMOKE_EXPECT_VERSION=2.0.0`, and runs `node scripts/smoke.mjs --verify-upgrade`. `scripts/smoke.mjs:20,236-274,476-484` supports `--verify-upgrade`, `MORROW_SMOKE_EXECUTABLE`, `MORROW_SMOKE_EXPECT_VERSION`, and `MORROW_SMOKE_PROFILE`; the normal smoke writes the manifest at `scripts/smoke.mjs:921`. `package.json` version is `2.0.0`; artifact `Morrow-Setup-2.0.0-x64.exe` matches the filter. | No real runner execution. Expected version is hard-coded `2.0.0`; a version bump will break the step until updated. Recursive `Morrow.exe` fallback could pick a stale install if the canonical paths are absent. |
| F4 | P3 | **PARTIAL** | Console output is now redacted: `run-self-hosted-ci.ps1:46-48` writes the redacted text to the log and `Write-Host`. Regex covers `Authorization: Bearer|token|basic`, `sk-`, `gh[pousr]_`, `github_pat_`, and simple JSON-quoted `apiKey`/`api_key`/`token`/`access_token`. Actual AST probe: `{"apiKey": "FAKE_JSON_APIKEY_444"}` → `{"apiKey": "[REDACTED]"}` (pass); `{"authorization": "Bearer FAKE_JSON_BEARER_777"}` → `{"authorization": "[REDACTED] FAKE_JSON_BEARER_777"}` (leak); `{"apiKey": "FAKE VALUE WITH SPACES"}` → `{"apiKey": "[REDACTED] VALUE WITH SPACES"}` (leak). | JSON-quoted `authorization` with a `Bearer`/`token`/`basic` prefix and values containing spaces are not fully redacted. No fixed command passes a real secret, so this is a P3 residual, not a blocker; the docs overclaim full coverage. |
| F5 | P3 | **PARTIAL** | `$runStart` is parsed from the UTC ISO timestamp and converted to UTC (`run-self-hosted-ci.ps1:118-119`); probe returned `Kind=Utc`, old file excluded, new file included. Results, transcripts, and installer are filtered per file by `LastWriteTimeUtc -ge $runStart` (lines 128-149). Screenshots filter directories by `LastWriteTimeUtc` (lines 120-127) and then copy the whole directory. | The screenshot filter is directory-level, not file-level. A directory touched during the run but containing older files would be copied wholesale. The current producer (`scripts/product-path-smoke.mjs:191-203`) creates a fresh `docs/ui/evidence/<runId>` directory per run, so practical risk is low. |
| F6 | P3 | **PARTIAL** | Missing-`node` probe: exit 1; `run-manifest.json`, `README.txt`, and `checksums.sha256` were all written; manifest had `node=null`, `status=FAILED`, and the failure message. Manifest/README/checksums are inside their own `try/catch` (`run-self-hosted-ci.ps1:155-206`); no `node`/`npm` calls remain in `finally`. | `Pop-Location` is still unguarded at the end of `finally` (line 210); if `Push-Location` fails, it can throw a secondary error. Theoretical for a valid repo path. PS 5.1 `Set-Content -Encoding UTF8` writes a BOM into `run-manifest.json`; Node `JSON.parse` consumers may need to strip it. |
| F7 | P3 | **PASS** | `run-self-hosted-ci.ps1:64-68` reads `node.exe --version`, parses the major version, and throws if it is below 22 before any step runs; `setup-self-hosted-runner.ps1:14` also enforces Node 22+. The workflow prints the version at lines 71-72. | None. |
| F8 | P3 | **PARTIAL** | `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md:8-10` records `ee24aa5` (parent `70e89f1`) and `d5ae25d` (parent `ee24aa5`) as 40-character SHAs. The docs commit `902cf5e` is the actual PR head (verified with `gh pr view 54`) and is described as “本文件所在提交” / “PR #54 head”. However, the claim that “Issue #56 comment 记录最终 full SHA 与 parent” is false: Issue #56 has **0 comments**, no PR #54 comment mentions `902cf5e`/`d5ae25d`, and the PR #54 body still says “Final HEAD: `70e89f1...`”. | The docs commit SHA is not recorded in text (self-reference is impossible without a follow-up amendment); the Issue-comment claim is inaccurate; the PR body is stale. “Static verification PASS” is broader than the residual F4/F5/F6 evidence supports. |
| F9 | P3 | **PARTIAL (residual)** | `gh api .../branches/feat%2Fmorrow-v2-final-closure/protection` and `.../branches/main/protection` both return HTTP 403 (“Upgrade to GitHub Pro or make this repository public”); `statusCheckRollup=[]`; required checks cannot be verified. Docs say an administrator must confirm. | Administrator action; not a code blocker. PR #54 currently has zero checks. |
| F10 | P3 | **PARTIAL (residual)** | `main` `ci.yml` still has `push: branches: [main]` and `pull_request`; `release/morrow-v2-final-delivery` has the same; `self-hosted-ci.yml` returns 404 on both. The feature branch is manual-only. Docs state `main`/`release` were not modified. | A push to `main`/`release` still triggers the failing hosted jobs. The task forbids modifying those branches; do not push there. |
| F11 | P3 | **PARTIAL (residual)** | `actions/checkout@v4` is tag-pinned, not SHA-pinned (`self-hosted-ci.yml:57`); consistent with existing workflows. | Supply-chain hardening; not a new bypass. |
| F12 | P3 | **PASS (fixed) / residual** | Guard checks both `github.actor` and `github.triggering_actor` (lines 30-31), so a re-run by another actor is blocked. | New tag-trigger caveat: the workflow file at the tagged commit defines the guard, so a write-access collaborator can tag a commit with a modified workflow and run code on the self-hosted runner. Not a fork/PR bypass; see §9.4. |

## 5. Script review

### 5.1 `scripts/ci/run-self-hosted-ci.ps1`

| Check | Result | Evidence |
| --- | --- | --- |
| Exact SHA guard before commands | **PASS** | lines 9-12; wrong-SHA run exited 1 with “Checkout SHA mismatch”, created no archive, ran no step |
| Every native command checks `$LASTEXITCODE` | **PASS** | `Invoke-CiStep` lines 43-58; probe `cmd.exe /c "exit 7"` through `Out-String` returned `code=7` |
| Failure stops dependent steps | **PASS** | `throw` on non-zero; `catch` records failure; later steps skipped |
| `finally` archive runs on command failure | **PASS** | lines 114-152; missing-`node` probe wrote manifest/README/checksums |
| Manifest fields | **PASS** | repo/ref/sha/expectedSha/runUrl/runner/node/npm/actor/triggeringActor/start/finish/steps/installerSha256/failure/status |
| Per-step logs with start/end times | **PASS** | `logs\NN-name.log`; manifest records `startedAt`/`finishedAt`/`exitCode` |
| Results | **PASS** | copies up to five new result and transcript files; F5 residual |
| Installers + SHA256 | **PASS** | copies the fresh installer and writes `.sha256`; F5 residual for freshness |
| Screenshots | **PARTIAL** | copies the latest new evidence directory; directory-level filter (F5) |
| Checksums | **PASS** | SHA256 for every archive file except `checksums.sha256` |
| README | **PASS** | status/failure/step table/installer hash/archive description |
| Archive outside repo | **PASS** | default `%LOCALAPPDATA%\Morrow\CI`; not under the repository |
| Console + file-log redaction | **PARTIAL** | console is now redacted; JSON-quoted `authorization`/spaced values still leak (F4) |
| No secrets in commands | **PASS** | fixed command list; no token/PAT/key arguments |
| No hosted fallback / artifact upload | **PASS** | none |
| No product runtime/source changes | **PASS** | only build/test/package/copy |
| Installed-app NSIS smoke | **PASS (implementation)** | lines 92-113; execution pending |
| Node 22 enforcement | **PASS** | lines 64-68 |

### 5.2 `scripts/ci/setup-self-hosted-runner.ps1`

| Check | Result | Evidence |
| --- | --- | --- |
| Read-only preflight | **PARTIAL** | creates `RunnerRoot` and `_work`; allowed by Issue #56, not strictly read-only |
| No token argument | **PASS** | only `-RunnerRoot` |
| No automatic registration | **PASS** | prints official interactive instructions; does not run `config.cmd` |
| No token persistence/fetch | **PASS** | no token variable, download, or `Invoke-WebRequest` |
| Official interactive instructions | **PASS** | Settings → Actions → Runners → New; `config.cmd`; short-lived token only at the prompt |
| No administrator requirement | **PASS** | script does not require elevation |
| PowerShell 5.1 compatibility | **PASS** | `$env:OS` check; preflight exit 0 under PS 5.1 |
| ARM64 vs X64 labels | **PARTIAL** | allows `ARM64` while the workflow requires `X64`; docs say x64 |
| Work folder consistency | **PASS** | creates `_work`, matching the official prompt |

## 6. Docs honesty

| Doc | Status | Findings |
| --- | --- | --- |
| `docs/ci/self-hosted-runner-setup-windows.md` | **PASS** | PowerShell 5.1+ and the `powershell -File` command now work; the `workflow_dispatch` default-branch prerequisite is stated at line 50 and repeated at line 86; the tag fallback is documented at lines 52-64; token handling and data isolation are good. |
| `docs/ci/ci-no-billing-operations.md` | **PASS** | Honest `PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED`; the tag fallback and default-branch caveat are stated; installed-app smoke is described; hosted compute/storage warnings and rollback are present. |
| `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md` | **PARTIAL** | Status is honestly PARTIAL/PENDING, not CI PASS. F8's Issue #56 comment claim is false; the redaction probe is described as “全部替换” although JSON-quoted `authorization` with a Bearer prefix and spaced values leak; “Node 22 检查” cites stale lines 61-63 (actual 64-68); “静态验收完成” is broader than the residual evidence. |
| `docs/reports/morrow-v2-self-hosted-ci-evidence-index.md` | **PARTIAL** | Honest PENDING/BLOCKED status; static commands are listed. The same false “Issue #56 comment 记录最终 full SHA 与 parent” claim appears at line 6; line 74's redaction list overstates JSON `authorization` coverage; line 85's “代码/脚本/静态验证 PASS” is broader than the residual F4/F5/F6 evidence. |
| `docs/testing/morrow-v2-self-hosted-ci-acceptance-matrix.md` | **PARTIAL** | PENDING rows are honest and “not CI PASS” is explicit. Row 15's screenshot freshness is directory-level, not per-file; row 16's redaction probe does not cover the leaking JSON `authorization` case; row 17 cites stale lines 61-63 (actual 64-68); row 26 correctly records that `main`/`release` were not modified. |

The docs do **not** claim CI PASS, do **not** claim a runner is registered, and do **not** claim a real self-hosted run happened. Those honesty requirements pass. The overclaims are limited to redaction completeness, the non-existent Issue #56 comment record, and the breadth of “static verification PASS”.

## 7. Static / no-product-change check

| Check | Result |
| --- | --- |
| `git diff --shortstat ee24aa5..HEAD` | 10 files, 585 insertions, 125 deletions |
| Changed paths | only `.github/workflows/`, `scripts/ci/`, and `docs/` |
| Product/test/schema/provider/cognition changes | **none** |
| `git diff --check ee24aa5..HEAD` | exit 0 |
| Diff secret scan (`ghp_`, `github_pat_`, `sk-`, `Bearer `, `api_key=`) | 0 credential-shaped matches; 3 documentation mentions of `api_key=` with placeholder/ellipsis text and no values |
| Full test suite / packaging / Electron | not run; prohibited for this review, and no product/test file changed |

## 8. Commands and exit codes

All commands were run from the repository root on 2026-11-05.

| Command | Exit | Result |
| --- | --- | --- |
| `git rev-parse HEAD` | 0 | `902cf5eaca9359663e6647e57a37d9aca7867b58` |
| `git log -1 --format='%H %P'` | 0 | `902cf5e... d5ae25d...` |
| `git status --porcelain` | 0 | clean before review |
| `git diff --shortstat ee24aa5..HEAD` | 0 | 10 files, 585 insertions(+), 125 deletions(-) |
| `git diff --name-status ee24aa5..HEAD` | 0 | 1 workflow, 2 scripts, 7 docs; no product/test/schema |
| `git diff --check ee24aa5..HEAD` | 0 | no whitespace errors |
| `python yaml.safe_load` both workflows | 0 | `self-hosted on=[workflow_dispatch, push]`, jobs `[guard, verify]`; `ci on=[workflow_dispatch]` |
| PowerShell Parser, run script | 0 | `run OK`; PS 5.1.26100.9711 |
| PowerShell Parser, setup script | 0 | `setup OK` |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/setup-self-hosted-runner.ps1` | 0 | `node=v22.23.2`, `npm=10.9.8`, `git 2.55.0`; runner root printed |
| Wrong-SHA guard (`-ExpectedSha 000...`) | 1 | `Checkout SHA mismatch`; no archive directory created |
| Missing-`node` probe (`PATH` without node) | 1 | `run-manifest.json`, `README.txt`, `checksums.sha256` written; `node=null`, `status=FAILED` |
| Redaction AST probe | 0 | Bearer/token/Basic, `sk-`, `github_pat_`, simple JSON `apiKey`/`api_key` redacted; JSON `authorization: Bearer ...` and spaced values leak (see F4) |
| UTC freshness probe | 0 | `parsedKind=Utc`; old file excluded; new file included |
| Tag-guard logic probe | 0 | valid `ci-self-hosted-<sha>` passes; wrong tag rejected |
| `$LASTEXITCODE` after `Out-String` probe | 0 | `code=7` |
| `gh pr view 54 --json ...` | 0 | OPEN, MERGEABLE, CLEAN, head `902cf5e`, base `3812b18`, `statusCheckRollup=[]` |
| `gh api .../commits/902cf5e/check-runs` | 0 | `total_count=0` |
| `gh api .../actions/runners` | 0 | `total_count=0` |
| `gh api .../actions/workflows` | 0 | only `CI` (`.github/workflows/ci.yml`) |
| `gh workflow view self-hosted-ci.yml` | 1 | HTTP 404 “not found on the default branch” |
| `gh api .../contents/.github/workflows/self-hosted-ci.yml?ref=main` | 1 | HTTP 404 |
| `gh api .../contents/.github/workflows/ci.yml?ref=main` | 0 | old `push: branches: [main]` + `pull_request` |
| `gh api .../contents/.github/workflows/ci.yml?ref=release/morrow-v2-final-delivery` | 0 | old `push: branches: [main]` + `pull_request` |
| `gh api .../contents/.github/workflows/self-hosted-ci.yml?ref=release/...` | 1 | HTTP 404 |
| `gh api .../branches/main/protection` | 1 | HTTP 403; branch protection not readable |
| `gh api .../branches/feat%2Fmorrow-v2-final-closure/protection` | 1 | HTTP 403 |
| `gh api .../actions/workflows/self-hosted-ci.yml/runs` | 1 | HTTP 404 (workflow not registered) |
| `gh api .../issues/56` | 0 | `comments=0`; title `CI 零新增账单恢复...` |
| `gh pr view 54 --json body` | 0 | body still says `Final HEAD: 70e89f1...` |
| `git status --porcelain` after writing this file | 0 | only this new audit file (untracked) |

## 9. Residual risks and user action

1. **Runner registration (operational blocker):** no runner is registered (`total_count=0`). Register a repository-scoped Windows x64 runner with labels `self-hosted, Windows, X64, morrow-ci` under a dedicated low-privilege account. Until then, the status is `PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED`, not CI PASS.
2. **First real run:** after registration, trigger the tag fallback on the exact HEAD (`git tag ci-self-hosted-<full SHA>`, `git push origin <tag>`) or use `workflow_dispatch` only after the workflow is on `main`. No real self-hosted run exists yet; the tag path is statically verified, not executed.
3. **Redaction gap (F4):** JSON-quoted `authorization` with a `Bearer`/`token`/`basic` prefix and values containing spaces can leak their tail. Review logs before sharing; if the redaction boundary must be strict, extend the regex and re-probe.
4. **Tag-trigger trust caveat (F12 residual):** because GitHub uses the workflow file at the tagged commit, a collaborator with write access can push a tag at a commit with a modified workflow and run code on the self-hosted runner without the actor guard. This is not a fork/PR bypass (push tags require write access), but it weakens the actor allowlist against write-access collaborators. If that matters, restrict tag creation with a repository ruleset/tag protection (note: branch-protection API is 403 on this private free repo), or require a different trusted trigger.
5. **Screenshot freshness (F5):** the filter is directory-level. The current product-path smoke creates a fresh directory per run, so this is low risk; if the producer changes to reuse a directory, filter files instead.
6. **Archive robustness (F6):** `Pop-Location` is unguarded; `run-manifest.json` is written with a BOM under PS 5.1. Normal failure paths work; consider guarding the pop and writing UTF-8 without BOM.
7. **Docs accuracy (F8):** add the actual final 40-character SHA and parent to the Issue/PR record (Issue #56 currently has 0 comments), correct the false “Issue #56 comment” claim, update the stale PR body “Final HEAD”, and narrow the “static verification PASS” and redaction claims to what was actually probed.
8. **Branch protection (F9):** the API is 403; an administrator must confirm required checks. PR #54 currently has zero checks.
9. **`main`/`release` scope (F10):** both still have the old automatic hosted `ci.yml`; a push there still triggers hosted jobs. Do not push to those branches; the task forbids modifying them.
10. **Checkout pinning (F11):** `actions/checkout@v4` is tag-pinned; pin to a SHA for supply-chain hardening.
11. **Hosted workflow:** do not dispatch `.github/workflows/ci.yml` for the no-billing path; it still uses GitHub-hosted runners and `actions/upload-artifact@v4`.
12. **No merge/release on this basis:** the CI path is implemented but has no real self-hosted run and still has the P3 doc/code gaps above. Do not merge PR #54 or publish a Release on the basis of this CI path until the runner run completes and the docs are corrected.

## 10. Conclusion

- **F1/F2 blockers are fixed.** The tag-push fallback is a valid no-`main`-modification dispatch path, and the documented PowerShell 5.1 setup now exits 0. The `verify` job remains gated on the guard.
- **F3/F7 are implemented.** The script silently installs the NSIS package, locates the installed executable, sets the smoke environment, and runs `--verify-upgrade`; Node 22 is enforced before any step.
- **F4/F5/F6/F8 are PARTIAL P3 residuals.** Console redaction is fixed but JSON-quoted `authorization`/spaced values leak; screenshot freshness is directory-level; `Pop-Location` is unguarded and the manifest has a BOM; the final docs commit SHA and the claimed Issue #56 comment record are missing/inaccurate.
- **F9-F11 are residuals; F12's actor check is fixed.** Branch protection is unreadable (403), `main`/`release` retain the old hosted triggers, and `actions/checkout` is tag-pinned; the tag-trigger write-access caveat is recorded. No fork/PR bypass was found.
- **Security gates: PASS.** No `pull_request_target`, hosted fallback, artifact upload, `continue-on-error`, secret, or product change was found in the self-hosted workflow. The tag trigger requires write access and the guard checks repository/actor/triggering_actor; a fork cannot push an upstream tag.
- **Overall Issue #56: PARTIAL / PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED.** No real self-hosted run exists; there are no check-runs on `902cf5e`; the only registered workflow is the hosted `CI`; zero runners are registered. This is not CI PASS and must not be represented as COMPLETE.
