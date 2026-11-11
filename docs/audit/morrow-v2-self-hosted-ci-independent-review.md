# Morrow V2 Self-Hosted CI Independent Review — Issue #56, PR #54, HEAD `ee24aa5`

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. The only repository writes are this file and `docs/audit/morrow-v2-self-hosted-ci-file-review-matrix.md`. Throwaway probes were written only under `.tmp/`. Nothing was staged or committed.

Review date: 2026-11-05.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Branch | `feat/morrow-v2-final-closure` |
| Frozen HEAD | `ee24aa5b00db6eac91509a56ce2fde2c259e54c7` |
| Parent SHA | `70e89f1d92975d506e803fff511b83191c9148d0` |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft, `MERGEABLE`, `mergeStateStatus=CLEAN`, head `ee24aa5`, base `3812b18` |
| PR checks | **none** — `gh pr checks 54` returns “no checks reported”; `statusCheckRollup: []`; HEAD check-runs `total_count=0` |
| Last run on HEAD | **none** |
| Parent-HEAD run | `42027056929` @ `70e89f1`: **4/4 failure, 0 steps**, billing/spending-limit annotation |
| Prior frozen-HEAD run | `42025990645` @ `84481f8`: **4/4 failure, 0 steps** |
| Last green parent-code run | `41995422882` @ `6f5fe47`: 4/4 success (9/10/17/17 steps) — **not this HEAD** |
| Self-hosted workflow runs | **none**; `.github/workflows/self-hosted-ci.yml` is not registered on the default branch |
| Registered self-hosted runners | **0** (`actions/runners` total_count=0) |
| Worktree | clean before review; only the two review docs after |

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall Issue #56** | **BLOCKED** (operational) |
| **Security gates** | **PASS** — no bypass, hosted fallback, token leak, required-check deletion, or product change |
| **Code/static review** | **PARTIAL** |
| **Workflow dispatchability** | **BLOCKED** — workflow is not on the default branch |
| **PowerShell compatibility** | **BLOCKED** — documented `powershell` setup fails; workflow requires `pwsh` (PowerShell 7) |
| **Installed-app NSIS smoke** | **FAIL / PARTIAL** — packaging exists, install/launch verification is absent |
| **Docs honesty** | **PARTIAL** — PENDING/PARTIAL is honest, but several instructions are not executable as written |
| **Product runtime change** | **PASS** — none; only CI/workflow/scripts/docs changed |
| **Real workflow_dispatch** | **PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED**, additionally blocked by the workflow-default-branch and PowerShell findings |
| **Merge/release recommendation** | **Do not merge or publish on this CI path yet** |

No security bypass, hosted fallback, token leak, required-check deletion, or product change was found. The delivery is nevertheless not operational: `workflow_dispatch` is unavailable because the new workflow is not on the default branch; the documented setup command fails on Windows PowerShell 5.1; and the self-hosted script does not perform the Issue #56 B.7 installed-app smoke. This is why the overall verdict is **BLOCKED**, not COMPLETE or PARTIAL-only.

## 2. CI state for the frozen HEAD

| Run / SHA | Event | Result | Evidence |
| --- | --- | --- | --- |
| `ee24aa5` (HEAD) | none | **0 checks / no runs** | `check-runs total_count=0`; `status total_count=0`; `statusCheckRollup=[]` |
| `70e89f1` (parent) | `pull_request` | **4/4 failure, 0 steps** | run `42027056929`; each job `runner_name=""`, `steps_count=0`; 2–3 s |
| `84481f8` | `pull_request` | **4/4 failure, 0 steps** | run `42025990645` |
| `6f5fe47` | `pull_request` | **4/4 success** | run `41995422882`; steps 9/10/17/17; GitHub-hosted runners |

The failed check-run annotation is:

> “The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings”

This confirms the known billing/spending-limit cause. The parent-code PASS is **not** accepted as this HEAD's CI. There is no CI PASS for `ee24aa5`, and no self-hosted run exists.

## 3. Workflow security review

### 3.1 `self-hosted-ci.yml` gates

| Gate | Result | Evidence |
| --- | --- | --- |
| YAML parses | **PASS** | `python yaml.safe_load` exit 0 for both workflow files |
| Only `workflow_dispatch` | **PASS** | parsed `on: {workflow_dispatch: null}`; no `push`/`pull_request`/`schedule` |
| No `pull_request_target` | **PASS** | text scan; none |
| No hosted fallback | **PASS** | both jobs use `[self-hosted, Windows, X64, morrow-ci]`; no `windows-latest`/`ubuntu-latest` |
| Labels exactly `[self-hosted, Windows, X64, morrow-ci]` | **PASS** | both `runs-on` lists match exactly |
| Guard checks repository `ve766/morrow-ai-companion-v2` | **PASS** | guard job `if` expression |
| Guard checks ref `refs/heads/feat/morrow-v2-final-closure` | **PASS** | guard job `if` expression |
| Guard checks actor `ve766` | **PASS** | guard job `if` expression uses `github.actor` |
| `verify` has `needs: guard` | **PASS** | parsed `needs: guard` |
| `verify` cannot run if guard fails/skips | **PASS** | `if: needs.guard.result == 'success'`; skipped guard yields `skipped`, not `success` |
| No repository code runs before guard passes | **PASS** | guard has no checkout and no `uses`; only inline `Write-Host` identity logging |
| Checkout uses exact `${{ github.sha }}` | **PASS** | checkout `with.ref: ${{ github.sha }}` |
| Checkout `persist-credentials: false` | **PASS** | parsed boolean false |
| SHA identity is verified | **PASS** | `git rev-parse HEAD` compared to `${{ github.sha }}`; script repeats the guard with `-ExpectedSha` |
| Permissions minimal | **PASS** | `permissions: contents: read` only |
| Concurrency sane | **PASS** | per-ref group, `cancel-in-progress: false` |
| Timeouts sane | **PASS** | guard 10 min; verify 180 min |
| No artifact upload | **PASS** | no `upload-artifact` |
| No `continue-on-error` | **PASS** | text scan; none |
| No secrets in workflow | **PASS** | no `secrets.` or token inputs |
| Workflow registered on default branch | **FAIL** | `main` has no `self-hosted-ci.yml` (404); `gh workflow list --all` shows only `CI`; `gh workflow view self-hosted-ci.yml` returns 404 “not found on the default branch” |
| `pwsh` available on a stock self-hosted Windows runner | **FAIL** | workflow uses `shell: pwsh` in four steps and `pwsh -File`; self-hosted Windows runners do not ship PowerShell 7; docs require only PowerShell 5.1+ |

### 3.2 `ci.yml`

| Gate | Result | Evidence |
| --- | --- | --- |
| Manual-only | **PASS** | `on: workflow_dispatch` |
| Original jobs/commands preserved | **PASS** | parsed `jobs` dict is identical between `70e89f1` and `ee24aa5`; `git diff --numstat` is `3/3` and touches only the trigger/comment |
| No required-check deletion or fake green | **PASS** | no job/step removed, no `continue-on-error`, no dummy job |
| No security weakening | **PASS** | no `pull_request_target`, no permission changes, no secret exposure |
| Required checks verifiable | **UNAVAILABLE** | branch-protection API returns HTTP 403 (“Upgrade to GitHub Pro or make this repository public”); docs correctly say an administrator must confirm |

The trigger change intentionally removes automatic PR/push runs to avoid further hosted billing. This is allowed by Issue #56, but it also means PR #54 currently has zero checks. It is a signal loss, not a deleted required check or a fake PASS.

## 4. Critical findings

| # | Severity | File:line | Finding | Conclusion |
| --- | --- | --- | --- | --- |
| F1 | **BLOCKER** | `.github/workflows/self-hosted-ci.yml:6-7`; `docs/ci/self-hosted-runner-setup-windows.md:45`; `docs/ci/ci-no-billing-operations.md:13`; `docs/reports/morrow-v2-self-hosted-ci-evidence-index.md:34` | The workflow exists only on `feat/morrow-v2-final-closure`; `main` returns 404 and `gh workflow list` shows only `CI`. GitHub requires a `workflow_dispatch` workflow to exist on the default branch; the “Run workflow” button is not available. The docs instruct the user to select “Self-hosted Windows CI” in Actions, which cannot appear. | **BLOCKED** — the user cannot perform the one-time action even after registering a runner. |
| F2 | **BLOCKER** | `scripts/ci/setup-self-hosted-runner.ps1:8`; `docs/ci/self-hosted-runner-setup-windows.md:8,19`; `.github/workflows/self-hosted-ci.yml:29,53,65,70,74` | The documented setup command is `powershell ... -File scripts/ci/setup-self-hosted-runner.ps1`; under Windows PowerShell 5.1 `$IsWindows` is `$null`, so the script throws “This guide targets Windows x64” and exits 1. The workflow itself uses `shell: pwsh`/`pwsh -File`, requiring PowerShell 7, but the docs only require PowerShell 5.1+ and never mention installing `pwsh`. | **BLOCKED** — the documented preflight fails, and the workflow's guard/verify steps will fail on a runner without PowerShell 7. |
| F3 | **P2** | `scripts/ci/run-self-hosted-ci.ps1:77`; `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md:23,60`; `docs/ci/ci-no-billing-operations.md:41`; `docs/testing/morrow-v2-self-hosted-ci-acceptance-matrix.md:17,26` | The script runs `npm run package:win` but never installs the NSIS installer, launches the installed executable, or verifies the installed app on an isolated profile. Issue #56 B.7 explicitly requires that installed-app smoke. The existing hosted `ci.yml` `windows-package-smoke` job has this sequence, but the self-hosted path does not reuse it. The docs imply installation smoke is part of the run and mark it merely host-pending. | **PARTIAL/FAIL** — even after a runner is available, the workflow will not satisfy B.7 or the “真实 NSIS/安装/启动” acceptance. |
| F4 | P3 | `scripts/ci/run-self-hosted-ci.ps1:26-33` | File logs are redacted after `Tee-Object`, but the same output is printed to the Actions console unredacted. The regex covers `Authorization: Bearer`, `sk-…`, and `api_key=`/`api-key:`; a synthetic probe showed JSON-quoted `"apiKey": "…"` and `"api_key": "…"` are not redacted, nor are `Authorization: token`, `Authorization: Basic`, `ghp_`, or `github_pat_`. | **P3 residual** — no real secret is in the commands, but the redaction boundary is incomplete. |
| F5 | P3 | `scripts/ci/run-self-hosted-ci.ps1:81-105` | Screenshots copy the latest `docs/ui/evidence` directory, results/transcripts copy the latest five files, and the installer copies the latest `release\Morrow-Setup-*.exe` regardless of whether this run produced them. A failed step can archive stale evidence from an earlier run. | **P3 residual** — evidence provenance is not tied to the current SHA/run. |
| F6 | P3 | `scripts/ci/run-self-hosted-ci.ps1:110-132,160` | Manifest construction is inside `finally` and calls `node --version`/`npm --version`; if Node/npm is missing, the `finally` throws and checksums/README may not be written. `Pop-Location` is outside `try/finally`, so a failed `Push-Location` can cause a secondary throw. | **P3 residual** — normal failures archive correctly; tool-missing edge cases are not guaranteed. |
| F7 | P3 | `scripts/ci/run-self-hosted-ci.ps1:59`; `.github/workflows/self-hosted-ci.yml:60-61`; `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md:23` | Node 22 is enforced only by the setup script (`setup-self-hosted-runner.ps1:14`); the workflow and run script only print `node --version`. The delivery report claims “Node 22 检查” in the verify job. | **P3** — version gate is weaker than documented. |
| F8 | P3 | `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md:7`; `docs/reports/morrow-v2-self-hosted-ci-evidence-index.md:4`; PR #54 body | The docs record only baseline `70e89f1`, not the final 40-character HEAD `ee24aa5` or its parent `70e89f1` as the final pair. The PR body still says “Final HEAD: 70e89f1”. No actual command transcript/exit-code table is attached. | **P3** — completeness/consistency, not a security issue. |
| F9 | P3 | `ci.yml`; branch protection | Branch-protection API is unavailable (403) on the private free repository; required checks cannot be verified. PR #54 has zero checks after the trigger change. | **P3** — administrator must confirm required checks; docs already say so. |
| F10 | P3 | `.github/workflows/ci.yml`; `main`/`release` branches | The manual-only change exists only on the feature branch. `main` and `release/morrow-v2-final-delivery` still have the old automatic `ci.yml`, and neither has the self-hosted workflow. Pushing to `main` still triggers the failing hosted jobs. | **P3** — task constraints forbid modifying `main`/`release`; docs should state the scope. |
| F11 | P3 | `.github/workflows/self-hosted-ci.yml:46` | `actions/checkout@v4` is tag-pinned, not SHA-pinned. Existing workflows use the same convention. | **P3** — supply-chain hardening, not a new bypass. |
| F12 | P3 | `.github/workflows/self-hosted-ci.yml:24` | The guard uses `github.actor`; on a re-run, `github.actor` remains the original actor while `github.triggering_actor` is the re-run initiator. A write-access collaborator could re-run a `ve766` run. The branch itself is trusted and the collaborator already has write access, so this is not a fork/PR bypass. | **P3** — hardening: consider `github.triggering_actor` if the actor allowlist must be absolute. |

## 5. Script review

### 5.1 `scripts/ci/run-self-hosted-ci.ps1`

| Check | Result | Evidence |
| --- | --- | --- |
| Exact SHA guard before commands | **PASS** | lines 9-12; wrong-SHA run exits 1 with “Checkout SHA mismatch” and executes no step |
| Every native command checks `$LASTEXITCODE` | **PASS** | `Invoke-CiStep` captures `$LASTEXITCODE` after `Tee-Object`; a probe with `cmd.exe /c "exit 7"` returned `CODE=7` |
| Failure stops dependent steps | **PASS** | `throw` on non-zero; `catch` records failure; later steps skipped |
| `finally` archive runs on command failure | **PASS (normal failures)** | `finally` copies evidence and writes manifest/README/checksums; see F6 for tool-missing edge cases |
| Manifest fields | **PASS** | repo/ref/sha/expectedSha/runUrl/runner/node/npm/actor/start/finish/steps/failure/status |
| Per-step logs with start/end times | **PASS** | `logs\NN-name.log`; manifest records `startedAt`/`finishedAt`/`exitCode` |
| Results | **PASS** | copies up to five `evals/morrow-v2-final` result and transcript files; see F5 for provenance |
| Installers + SHA256 | **PASS** | copies latest `Morrow-Setup-*.exe` and writes `.sha256`; see F5 for stale-file risk |
| Screenshots | **PASS** | copies latest `docs/ui/evidence` directory; see F5 |
| Checksums | **PASS** | SHA256 for every archive file except `checksums.sha256` |
| README | **PASS** | status/failure/step table/archive description |
| Archive outside repo | **PASS** | default `%LOCALAPPDATA%\Morrow\CI`; not under the repository |
| Redaction of Bearer/sk-/api_key | **PARTIAL** | file logs redacted; console output unredacted; JSON-quoted forms missed (F4) |
| No secrets in commands | **PASS** | fixed command list; no token/PAT/key arguments |
| No hosted fallback | **PASS** | no hosted runner references |
| No artifact upload | **PASS** | no upload command |
| No product runtime/source changes | **PASS** | only runs build/test/package and copies artifacts |
| Installed-app NSIS smoke | **MISSING** | only `npm run package:win`; no silent install, installed-exe launch, or installed-app verification (F3) |
| Node 22 enforcement | **PARTIAL** | logs only; setup script enforces (F7) |

### 5.2 `scripts/ci/setup-self-hosted-runner.ps1`

| Check | Result | Evidence |
| --- | --- | --- |
| Read-only preflight | **PARTIAL** | creates `RunnerRoot`, `work`, `logs`; allowed by Issue #56, but not strictly read-only |
| No token argument | **PASS** | only `-RunnerRoot` parameter |
| No automatic registration | **PASS** | prints official interactive instructions; does not run `config.cmd` |
| No token persistence/fetch | **PASS** | no token variable, no download, no `Invoke-WebRequest` |
| Official interactive instructions | **PASS** | Settings → Actions → Runners → New; `config.cmd`; short-lived token only at the prompt |
| No administrator requirement | **PASS** | script itself does not require elevation; docs note service install needs local permission |
| PowerShell 5.1 compatibility | **FAIL** | `$IsWindows` is `$null` in Windows PowerShell 5.1; the documented `powershell ... -File` command exits 1 before any check |
| ARM64 vs X64 labels | **PARTIAL** | allows `ARM64`, while the workflow requires the `X64` label; docs say x64 |
| Work folder consistency | **PARTIAL** | creates `work`; official config prompt uses `_work`; the extra directory is unused |

Wrong-SHA guard output (exit 1):

```
Checkout SHA mismatch: expected 0000000000000000000000000000000000000000, got ee24aa5b00db6eac91509a56ce2fde2c259e54c7
```

No archive directory was created and no `node`/`npm` step ran.

Setup-script output under Windows PowerShell 5.1 (exit 1):

```
Morrow self-hosted runner preflight (no token is read or stored by this script).
This guide targets Windows x64.
... if (-not $IsWindows) { throw 'This guide targets Windows x64.' }
```

The `$IsWindows` probe under PowerShell 5.1 returned `IsWindows is null`.

## 6. Docs honesty

| Doc | Status | Findings |
| --- | --- | --- |
| `docs/ci/self-hosted-runner-setup-windows.md` | **PARTIAL** | Token handling, labels, start/stop/update/uninstall, and data isolation are good. But it requires PowerShell 5.1+ and gives a `powershell` command that fails; it never mentions PowerShell 7/`pwsh`; it instructs the user to select a workflow that is not on the default branch; it does not state that the workflow must first reach `main`. |
| `docs/ci/ci-no-billing-operations.md` | **PARTIAL** | Honest about `PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED`, hosted compute/storage warnings, rollback, and archive handling. Repeats the unavailable “Self-hosted Windows CI → Run workflow” action; line 41 implies an install smoke that the script does not run. |
| `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md` | **PARTIAL** | Root-cause evidence is accurate (runs, 0-step jobs, billing annotation, parent PASS not accepted). Status is honestly PARTIAL/PENDING and says “not CI PASS”. Missing the final `ee24aa5`/parent pair; “Node 22 检查” and “static acceptance complete” overstate what was tested; line 60 implies install smoke. |
| `docs/reports/morrow-v2-self-hosted-ci-evidence-index.md` | **PARTIAL** | Honest PENDING/BLOCKED status; static commands are listed; existing hosted evidence is correctly labeled historical. No final SHA; “implementation commit: see PR head” is not a 40-character SHA; line 53's “static verification PASS” is too broad; the Actions dispatch instruction is not available. |
| `docs/testing/morrow-v2-self-hosted-ci-acceptance-matrix.md` | **PARTIAL** | PENDING rows are honest and “not CI PASS” is explicit. Row 10 lists the B.5 command set but omits the B.7 installed-app smoke; row 19 is host-pending even though no install step exists; row 20's “hosted workflow manual” applies only to the feature branch, not `main`/`release`. |

The docs do **not** claim CI PASS, do **not** claim a runner is registered, and do **not** claim a real workflow_dispatch ran. They contain no token values, no Authorization values, and no user data. Those honesty requirements pass.

## 7. Static / no-product-change check

| Check | Result |
| --- | --- |
| `git diff 70e89f1..ee24aa5 --stat` | 9 files, 551 insertions, 3 deletions |
| Changed paths | only `.github/workflows/`, `scripts/ci/`, and `docs/` (5 docs) |
| Product/test/schema/provider/cognition changes | **none** |
| `git diff --check` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| Full test suite | not rerun; no product/test file changed, and the previous review already ran the suite on unchanged product code |
| `.gitignore` | archive/runner defaults are outside the repo; `release/`, `out/`, `node_modules/`, and `.tmp/` are ignored; no archive/runner entry is required |

## 8. Commands and exit codes

All commands were run from the repository root on 2026-11-05.

| Command | Exit | Result |
| --- | --- | --- |
| `git rev-parse HEAD` | 0 | `ee24aa5b00db6eac91509a56ce2fde2c259e54c7` |
| `git status --porcelain` | 0 | clean before review |
| `git diff --stat 70e89f1..ee24aa5` | 0 | 9 files, 551 insertions, 3 deletions |
| `git diff --name-status 70e89f1..ee24aa5` | 0 | 1 modified, 8 added; only CI/scripts/docs |
| `git diff --check 70e89f1..ee24aa5` | 0 | no whitespace errors |
| `gh pr view 54 --json ...` | 0 | OPEN, MERGEABLE, CLEAN, head `ee24aa5`, base `3812b18`, `statusCheckRollup=[]` |
| `gh pr checks 54` | 1 | “no checks reported on the 'feat/morrow-v2-final-closure' branch” |
| `gh api .../commits/ee24aa5/check-runs` | 0 | `total_count=0` |
| `gh api .../commits/ee24aa5/status` | 0 | `state=pending`, `total_count=0` |
| `gh api .../commits/70e89f1/check-runs` | 0 | 4 check-runs, all `failure` |
| `gh api .../actions/runs/42027056929/jobs` | 0 | 4 jobs, all `failure`, `steps_count=0`, `runner_name=""` |
| `gh api .../actions/runs/42025990645/jobs` | 0 | 4 jobs, all `failure`, `steps_count=0` |
| `gh api .../actions/runs/41995422882/jobs` | 0 | 4 jobs, all `success`, steps 9/10/17/17 |
| `gh api .../check-runs/127243784615/annotations` | 0 | billing/spending-limit message |
| `gh api .../actions/runners` | 0 | `total_count=0` |
| `gh api .../actions/workflows` | 0 | only `CI` (`.github/workflows/ci.yml`) |
| `gh workflow list --all` | 0 | only `CI` |
| `gh workflow view self-hosted-ci.yml` | 1 | 404 “not found on the default branch” |
| `gh api .../contents/.github/workflows/self-hosted-ci.yml?ref=main` | 1 | 404 |
| `gh api .../contents/.github/workflows/self-hosted-ci.yml?ref=release/morrow-v2-final-delivery` | 1 | 404 |
| `gh api .../contents/.github/workflows/ci.yml?ref=main` | 0 | old automatic `push`/`pull_request` trigger |
| `gh api .../branches/feat%2Fmorrow-v2-final-closure/protection` | 1 | HTTP 403; branch protection not readable |
| `python yaml.safe_load` both workflows | 0 | YAML OK |
| PowerShell Parser, run script | 0 | `run OK` |
| PowerShell Parser, setup script | 0 | `setup OK` |
| Wrong-SHA guard (`-ExpectedSha 000…`) | 1 | SHA mismatch; no commands; no archive |
| Setup script under Windows PowerShell 5.1 | 1 | `$IsWindows` null; “This guide targets Windows x64” |
| `$IsWindows` probe under PowerShell 5.1 | 0 | `IsWindows is null` |
| `$LASTEXITCODE` after native pipeline probe | 0 | `CODE=7` |
| Redaction regex probe | 0 | Bearer/sk-/api_key= redacted; JSON-quoted apiKey/api_key not redacted |
| `npx tsc --noEmit` | 0 | PASS |

## 9. Residual risks and user action

1. **Workflow availability (blocker):** the workflow must exist on the default branch (`main`) before GitHub exposes “Run workflow”. The task forbids the agent from modifying `main`/`release`, so the user or repository administrator must merge/cherry-pick the workflow to `main`, or change the default branch. The docs must state this prerequisite; currently they do not.
2. **PowerShell 7 (blocker):** install PowerShell 7 (`pwsh`) on the runner and run the setup script with `pwsh` (or fix the `$IsWindows` check and document the actual minimum). The workflow's `shell: pwsh` steps require it; a stock self-hosted Windows runner does not include it.
3. **Installed-app smoke (requirement gap):** add a step that installs the produced NSIS package silently, launches the installed executable on an isolated profile, verifies the version/profile, and archives the result. `npm run package:win` alone does not satisfy Issue #56 B.7.
4. **Runner registration:** no runner is registered (`total_count=0`). After F1/F2 are resolved, register one repository-scoped Windows x64 runner with labels `self-hosted, Windows, X64, morrow-ci`, ideally under a dedicated low-privilege account.
5. **Branch protection/required checks:** the API is 403 on this private free repository; an administrator must confirm whether required checks exist and how the manual-only `ci.yml` interacts with them. PR #54 currently has zero checks.
6. **Hosted billing:** do not rerun the hosted jobs; they are 0-step due to the billing/spending limit. No new hosted run was created by `ee24aa5` (0 check-runs), and the self-hosted workflow does not upload artifacts. The manual-only `ci.yml` still uses GitHub-hosted runners and still contains `actions/upload-artifact@v4`; manually dispatching it would consume compute/storage. Use only the self-hosted path once it is operational.
7. **Redaction/evidence provenance:** review logs before sharing; avoid real provider keys; consider redacting the console stream and JSON-quoted key forms, and record per-run provenance for copied screenshots/results/installers.
8. **No merge/release:** do not merge PR #54 or publish a Release on the basis of this delivery. The real self-hosted `workflow_dispatch` has not run, and the installed-app path is not implemented.

## 10. Conclusion

- **Security gates: PASS.** The guard is correctly structured, `verify` is gated on guard success, checkout is SHA-exact with `persist-credentials: false`, permissions are read-only, and there is no hosted fallback, `pull_request_target`, artifact upload, `continue-on-error`, token handling, or product change.
- **Code/static: PARTIAL.** The run script's SHA guard, exit-code propagation, archive, and redaction are largely sound, but the installed-app smoke is missing and redaction/evidence provenance have gaps. The setup script fails on the documented PowerShell 5.1.
- **Overall Issue #56: BLOCKED.** The workflow is not on the default branch, so the user cannot dispatch it; the documented setup path fails; and the installed-app acceptance is not implemented. Real workflow_dispatch remains `PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED` and is additionally blocked by F1/F2.
- Do not merge or publish a Release until the workflow is reachable on the default branch, PowerShell 7 is a documented prerequisite (or the script is fixed), the installed-app smoke is added, and one real self-hosted run on `ee24aa5` (or a later frozen SHA) completes with archived evidence.
