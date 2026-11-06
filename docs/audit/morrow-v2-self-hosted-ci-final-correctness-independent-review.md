# Morrow V2 Self-Hosted CI Final Correctness — Independent Review (Issue #58)

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. The only repository write is this file. Throwaway probes were created only under `.tmp/` (gitignored) and removed. Nothing was staged, committed, tagged, pushed, or published. No `npm ci`, `npm install`, full test suite, `npm run build`, `npm run package:win`, NSIS installer, or Electron/Morrow launch was executed. Read-only `gh api` GETs were used. No token, key, or secret is reproduced here.

Review date: 2026-11-06.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Branch | `feat/morrow-v2-final-closure` |
| **Reviewed HEAD (exact)** | **`ba8e479ebc12e960e5678fbcc33a34a35449fec9`** |
| HEAD parent | `60a445e2a7aecf300816b8941ad4611c561aebe0` |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| Commit subject | `fix(ci): unique run dirs, terminal manifests, full smoke-tree cleanup` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, head `ba8e479...`, base `release/morrow-v2-final-delivery`, not merged |
| Issue | [#58](https://github.com/ve766/morrow-ai-companion-v2/issues/58), `OPEN`, 0 comments at review time |
| Diff `60a445e..HEAD` | 6 files: 3 new `docs/reports/*.md`, 3 modified `scripts/ci/*.ps1`; +801 / -94 |
| Product runtime/schema/test changes | none |
| Worktree | clean before this file; `.tmp/` ignored |
| Registered self-hosted runners | `0` (`actions/runners` total_count=0) |
| Workflow runs on reviewed SHA | `0` (`actions/runs?head_sha=ba8e479...` total_count=0) |
| Artifacts from reviewed SHA | none (35 historical artifacts from other SHAs; newest 2026-11-05T08:58Z) |
| Real NSIS install/uninstall | **not performed** |
| Real self-hosted run | **none** |

The reviewed SHA is stated exactly above. The new docs do **not** state it; see F1.

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall** | **PARTIAL / PENDING_USER_ACTION — no BLOCKER or HIGH found in the three fixes; real NSIS install/uninstall and real self-hosted run are absent** |
| runDir uniqueness / atomic creation / fail-closed | **PASS** — independent 24-result probe: 22 PASS, 0 FAIL, 2 INFO |
| Manifest / final exit-code consistency | **PASS (core)** — 27-result probe: 24 PASS, 0 FAIL, 3 INFO; fault paths leave FAILED/exitCode 1, never PASS; LOW findings F4/F5 |
| Checksum chain | **PASS (core)** — cycle-free, `checksumsFileSha256` matches, every listed hash recomputes; **MEDIUM** finding F2 on unlisted `.tmp`/hidden files vs the absolute coverage claim |
| Process-tree ownership / cleanup | **PASS (core)** — root, descendant, outside-process, PID/path mismatch, access-denied, no-op, and static no-name-kill probes pass; **MEDIUM** finding F3 (ownership records not persisted), LOW findings F6/F7/F8 |
| PS 5.1 compatibility | **PASS** — Parser 3/3; all probes ran on Windows PowerShell `5.1.26100.9711` |
| Docs honesty | **PARTIAL** — no CI PASS / runner / real-run claim is made, but the reviewed SHA is deferred to a nonexistent Issue #58 comment (F1) and the test numbers are author-asserted (F14) |
| Real NSIS install/uninstall | **ABSENT / PENDING_USER_ACTION** |
| Real self-hosted run | **ABSENT / PENDING_USER_ACTION** — 0 runners, 0 runs |

No BLOCKER or HIGH finding exists. The three correctness fixes are implemented and independently verified at the unit/probe/static level. The overall status cannot exceed **PARTIAL / PENDING_USER_ACTION** because no real NSIS install/uninstall and no real self-hosted workflow run exist.

## 2. Commands and real exit codes

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | `ba8e479ebc12e960e5678fbcc33a34a35449fec9` |
| `git rev-parse HEAD^` | `60a445e2a7aecf300816b8941ad4611c561aebe0` |
| `git status --porcelain` | empty (clean) |
| `git diff --stat 60a445e..HEAD` | 6 files, 801 insertions(+), 94 deletions(-) |
| `git diff --check 60a445e..HEAD` | exit **0** |
| PS 5.1 Parser on the 3 `scripts/ci/*.ps1` | 3/3 `PARSE OK`, exit **0** |
| PyYAML `safe_load` on `.github/workflows/ci.yml` and `self-hosted-ci.yml` | `True`/`True`, exit **0** |
| Added-line secret scan (`ghp_`, `github_pat_`, `sk-`, private-key, `AKIA`, `xox`) | no matches, grep exit 1 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1` | `passed=89 failed=0 total=89`, exit **0** |
| Independent runDir probe | `passed=22 failed=0 info=2 total=24`, exit **0** |
| Independent manifest/checksum probe | `passed=24 failed=0 info=3 total=27`, exit **0** |
| Independent process probe (first run) | `passed=20 failed=4 info=2 total=26`, exit **1** — 4 FAILs were probe-harness defects, see §4.4 |
| Focused process probes (hidden-window fixtures, code scan) | exit **0**; access-denied errors=2/remaining=1; no-op errors=1/remaining=1; only PID-based `taskkill` in code |
| `-ExcludePids` probe | exit **0**; excluded child re-added as descendant (F7) |
| Missing-Node runner probe, 2 runs | both exit **1**; `status=FAILED stage=execution`; two distinct run dirs |
| Independent archive verification of both runner runs | `passed=36 failed=0 total=36`, exit **0** |
| Wrong-SHA guard | exit **1**; archive root not created |
| `gh api .../actions/runners` | `total_count: 0` |
| `gh api ".../actions/runs?head_sha=ba8e479..."` | `total_count: 0` |
| `gh pr view 54` | `OPEN`, head `ba8e479...`, `mergedAt: null` |
| `gh issue view 58` | `OPEN`, `commentCount: 0` |

Author-reported but **not independently rerun** (prohibited): `npm run typecheck` exit 0; `npm test` 129 files / 1156 tests passed (197.31s). These remain author assertions; see F14.

## 3. Findings

### F1 — MEDIUM — Reviewed SHA not stated; deferred to a nonexistent Issue #58 comment

- Files: `docs/reports/morrow-v2-self-hosted-ci-final-correctness-closeout.md:8`, `docs/reports/morrow-v2-self-hosted-ci-final-correctness-evidence-index.md:4`.
- Both say: `代码 SHA：本文件所在提交（最终 full SHA 以 Issue #58 comment 为准）`.
- Issue #58 has **0 comments** (`gh issue view 58`), so the referenced authority does not exist. The prior R3 review flagged the identical pattern for Issue #57 (`docs/audit/morrow-v2-self-hosted-ci-hardening-independent-review-r3.md:44,241,257`); it has been repeated.
- Impact: the reviewed artifact identity is ambiguous inside the repository. This review states the exact SHA (`ba8e479...`) instead.
- Recommendation: add the exact SHA to the closeout/evidence index (or post the Issue #58 comment and reference it), as R3 recommended.

### F2 — MEDIUM — Checksum coverage claim is broader than the implementation

- Files: `scripts/ci/self-hosted-ci-helpers.ps1:404-405` (enumeration and exclusions), `:395` (`checksumPolicy`), `scripts/ci/run-self-hosted-ci.ps1:370` (README claim).
- The policy string and README say only `run-manifest.json` and `checksums.sha256` are excluded. The implementation additionally excludes every `*.tmp` file and, because `Get-ChildItem -Recurse -File` is called without `-Force`, every hidden/system file.
- Independent probe: a normal archive contained `leftover.tmp` and a hidden `hidden.txt`; both were present in the archive but absent from `checksums.sha256` (probe `N10`/`N11`/`N12`, unlisted=`hidden.txt,leftover.tmp`). The manifest still reported `status=PASS` and `archive.integrity=verified`.
- Impact: the archive can contain files not covered by the checksum list while the README claims "every archive file" is listed. This does not cause a false PASS or an exit-code mismatch, but it is a real integrity-coverage gap and a false absolute claim.
- Recommendation: enumerate with `-Force`; either include `.tmp` files or document the exclusion in the policy string and README. Consider failing closed if an unlisted file exists.

### F3 — MEDIUM — Owned process records are not persisted in the manifest

- File: `scripts/ci/run-self-hosted-ci.ps1:184-196`.
- `Get-OwnedProcesses` returns full records (PID, PPID, Name, ExecutablePath, CreationDate, Reason), but the runner only stores `ownedCount`, `stopped` (PIDs), `remaining`, and `errors`. `$owned` is local to the `finally` block and is never added to `$processTree`.
- Impact: after a successful cleanup the archive cannot independently show which processes were considered owned, from which path, with which creation time, or why. The acceptance matrix row 15 ("进程树归属记录（PID/PPID/路径/创建时间/原因）") is true of the helper's in-memory records but not of the persisted manifest. This is an auditability gap, not a false PASS.
- Recommendation: set `$processTree.owned = @($owned)` (or a compact projection) before stopping, and include it in the manifest.

### F4 — LOW — README failure leaves no diagnostic in the archive

- Files: `scripts/ci/self-hosted-ci-helpers.ps1:397-402`, `scripts/ci/run-self-hosted-ci.ps1:380-384`.
- A README write failure correctly produces `status=FAILED`, `failedStage=readme`, `exitCode=1` (probe `R1`/`R2`). The error text is returned in `$result.Errors`, but the manifest has no error field for this stage and the runner only writes `finalization-error.txt` when `FailedStage -eq 'manifest'`.
- Independent probe of the fault path: the manifest contained only `archive` + `status` + `failedStage` + `exitCode`; no `README write failed` text.
- Impact: the failure is correctly FAILED/non-zero, but the cause is not preserved in the archive. Recommendation: persist `$result.Errors` (e.g., `archive.error`) for every finalizer failure.

### F5 — LOW — Manifest-write failure leaves no terminal `run-manifest.json`

- Files: `scripts/ci/self-hosted-ci-helpers.ps1:440-462`, `scripts/ci/run-self-hosted-ci.ps1:374-384`.
- When the atomic manifest write fails (e.g., `run-manifest.json.tmp` is a directory), `Complete-RunArchive` returns `FAILED`/`manifest`; the fallback write also fails. Independent probe `M1`/`M2`: no `run-manifest.json` exists at all (not a PASS manifest), and `$result.Errors` reports both failures.
- Impact: fail-closed is correct and the runner exits 1, but the archive has no machine-readable terminal status; the only signals are the process exit code and `finalization-error.txt` written by the runner. This is a residual gap against "the manifest must match the final exit code/status" (there is no manifest to match). Recommendation: write a fallback manifest to a different filename (e.g., `run-manifest.failed.json`) or document this mode explicitly.

### F6 — LOW — Orphaned outside-path children are not owned after the parent exits

- File: `scripts/ci/self-hosted-ci-helpers.ps1:466-514`.
- Ownership is path-based (executable under the unique install dir) plus a live-parent descendant walk. Independent probe `P13`: a child launched by the smoke parent from `cmd.exe` (outside the install dir) survived its parent's exit and was **not** owned; a same-path orphan (`P11`/`P12`) was owned and stopped.
- Impact: realistic Electron children run from the same `Morrow.exe` path and are covered, but an orphaned outside-path child (e.g., a shell or helper launched by the app) can escape the snapshot. It cannot be a user's Morrow, and an uninstall that then fails is fail-closed (CLEANUP_FAILED), not a false PASS. Residual risk, LOW.

### F7 — LOW — `-ExcludePids` is bypassed by the descendant walk

- File: `scripts/ci/self-hosted-ci-helpers.ps1:472` (exclusion only in the path-based loop) vs `:490-511` (descendant BFS has no exclusion check).
- Independent probe: a child explicitly passed in `-ExcludePids` was re-added as a `descendant` record (`excludedCount=4`, child still present).
- Impact: none in the runner (it does not pass `-ExcludePids`), but the helper contract is misleading and a future caller could stop a PID it asked to exclude. Recommendation: check `ExcludePids` in the BFS as well.

### F8 — LOW — `Stopped` can list a PID whose stop action did nothing

- File: `scripts/ci/self-hosted-ci-helpers.ps1:552-563,591-595`.
- A no-op injected `StopAction` does not throw, so the PID is appended to `Stopped` before verification; the later verification still reports it in `Remaining` with an error (probe: `stopped=1 remaining=1 errors=1 stoppedContains=True`). The runner uses `errors` to mark `CLEANUP_FAILED`, so there is no false PASS.
- Recommendation: only add to `Stopped` after the post-stop verification confirms exit, or rename the field to `Attempted`.

### F9 — LOW — Author's access-denied/timeout probes are timing-sensitive

- File: `scripts/ci/test-self-hosted-install-isolation.ps1:365-379`; helper `CloseMainWindow` at `scripts/ci/self-hosted-ci-helpers.ps1:542-551`.
- The fixtures are visible-console PowerShell copies. In my first independent fixture run, `CloseMainWindow()` terminated the fixture before the injected `StopAction` ran, so the access-denied/timeout assertions saw `remaining=0` and would fail; with `-WindowStyle Hidden` the intended paths passed (access-denied errors=2/remaining=1; no-op errors=1/remaining=1). The author's suite passed 89/89 in my run, but the probes are not deterministic by construction.
- Recommendation: use hidden-window fixtures (or a switch to skip `CloseMainWindow` in probes) for the access-denied/timeout cases.

### F10 — LOW — Dead code: `Stop-ProcessesUnderPath`

- File: `scripts/ci/self-hosted-ci-helpers.ps1:223-241`.
- After the rewrite the runner uses `Get-OwnedProcesses`/`Stop-OwnedProcessTree`; `Stop-ProcessesUnderPath` has no caller (grep across `scripts/`, `.github/`). It uses name-filtered WMI enumeration and a path equality check. No current impact; remove it or mark it internal to avoid a future caller mistaking it for the new tree-aware path.

### F11 — LOW — Workflow's "Print local archive location" can print a stale archive

- File: `.github/workflows/self-hosted-ci.yml:83-91`.
- The step runs `if: always()` and prints the newest directory under `%LOCALAPPDATA%\Morrow\CI`. On a wrong-SHA failure (before any run dir is created) it can print a previous run's archive, which is misleading in the job log. Not changed by this commit; LOW.

### F12 — LOW — NSIS uninstaller hand-off timing is unexercised

- Files: `scripts/ci/self-hosted-ci-helpers.ps1:211-221`, `scripts/ci/run-self-hosted-ci.ps1:207-214`.
- `Invoke-IsolatedUninstall` waits for the uninstaller process to exit; an NSIS uninstaller may hand off to a temp copy. If the temp copy outlives the original, the subsequent `Remove-IsolatedPaths` can race and fail, producing `CLEANUP_FAILED` (fail-closed) rather than a false PASS. This cannot be settled without the real NSIS install/uninstall, which is PENDING_USER_ACTION.

### F13 — LOW — Dirty worktree is not recorded

- File: `scripts/ci/run-self-hosted-ci.ps1:11-14`.
- The runner verifies HEAD equals `-ExpectedSha` but does not check `git status --porcelain` or record a dirty flag. In the workflow the checkout is fresh, but a local run on a dirty tree would produce an archive whose `sha` claims the commit. Recommendation: record `worktreeDirty` or refuse a dirty tree.

### F14 — INFO — Author-reported tests are not independently rerun

- `docs/reports/morrow-v2-self-hosted-ci-final-correctness-closeout.md:84-85` and the acceptance matrix row 22 claim `npm run typecheck` exit 0 and `npm test` 129 files / 1156 tests. Per the review constraints these were not rerun. The 89/89 probe suite **was** independently rerun and matches. The typecheck/full-test numbers remain author assertions.

### F15 — INFO — Pre-existing synthetic token in the probe suite

- `scripts/ci/test-self-hosted-install-isolation.ps1:167` contains `ghp_` + 24 `a` characters as a redaction fixture. It is pre-existing (unchanged by this commit), synthetic, and not a real credential. The added-line secret scan found no secrets.

### F16 — INFO — `run-identity.json` remains `RUNNING` in a terminal archive

- `scripts/ci/run-self-hosted-ci.ps1:26-35` writes `status: RUNNING` with `note: 'Non-terminal. run-manifest.json is authoritative.'`. In the missing-Node archives the identity file still says `RUNNING` while the manifest says `FAILED`. This is documented and intentional; no contradiction, but an independent reader must know the manifest is authoritative.

### F17 — INFO — `Test-ProcessRecordOwned` trusts a descendant record's reason over its path

- File: `scripts/ci/self-hosted-ci-helpers.ps1:528-536`.
- If `MainModule` is readable and its path is outside the install dir, the function still returns true when `Record.Reason -eq 'descendant'`; if `MainModule` throws, it returns true for descendants without a path check. This is intentional to cover helpers such as `conhost.exe` (my probes observed a conhost descendant), and the runner's records come from `Get-OwnedProcesses`, not from external input. A forged record with a matching creation time could bypass the path check, but it is not reachable from the current runner.
- Recommendation: carry the parent PID/ownership chain in the record and re-verify it, or document the trust assumption.

## 4. Evidence per requirement

### 4.1 runDir — PASS

`New-UniqueRunDirectory` (`scripts/ci/self-hosted-ci-helpers.ps1:355-384`) validates a hex-only SHA, normalizes the archive root, refuses a pre-existing run directory, creates the run directory and five subdirectories with `New-Item` **without `-Force`**, and checks the run-directory chain for reparse points after creation. The runner creates it at `run-self-hosted-ci.ps1:19` with a GUID runId and writes `run-identity.json` at `:26`, before the first `Invoke-CiStep` at `:124` (line-order probe: unique=19, identity=26, firstStep=124).

Independent results (24 results, 22 PASS / 0 FAIL / 2 INFO):

- Same `-Stamp`/`-Sha`/`-RunId` twice: second throws `Refusing to reuse an existing run directory`; the first directory's marker bytes, marker timestamp, run-directory timestamp, and file set are unchanged (`A2`-`A6`).
- Pre-created exact run directory with a 6-byte sentinel and fixed timestamp: call throws; sentinel bytes and timestamp are identical; no subdirectories are added (`B1`-`B4`).
- `-Sha '..\evil'`, `-Sha '../../evil'`, and a non-hex SHA: all throw; no escaped `evil` directory is created (`C1`-`C4`).
- Junction at the exact run-directory path: call throws; the junction target's file is byte-identical and gains no subdirectories (`D1`-`D4`).
- Two concurrent calls with identical identity: exactly one succeeds, one throws, one directory exists (`F1`).
- AST check inside `New-UniqueRunDirectory`: 3 `New-Item` calls, 0 `-Force` parameters (`G1`).
- Extra hardening INFO: `-Stamp '..\..\evil-stamp'` throws `Run directory escaped the archive root`; `-RunId '..\evil-runid'` throws during subdirectory creation. Neither is used by the runner (GUID runId, no stamp), but both fail closed.

### 4.2 Manifest — PASS (core)

`Complete-RunArchive` (`scripts/ci/self-hosted-ci-helpers.ps1:386-464`) writes README, builds and verifies checksums, sets `archive`, then atomically writes the manifest, re-parses it, and compares `status`/`exitCode`. The runner computes a single terminal `$status` (`run-self-hosted-ci.ps1:285-292`), writes the manifest with `exitCode` 0 only for PASS (`:319`), and exits 1 unless the finalizer returns PASS (`:389`).

Independent results (27 results, 24 PASS / 0 FAIL / 3 INFO):

- Normal path: result PASS, manifest PASS/exitCode 0, README present, no BOM, `checksumsFileSha256` equals SHA256(checksums.sha256), every listed line recomputes, `fileCount` equals the line count (`N1`-`N9`).
- `README.txt` as a directory: result FAILED/readme, manifest FAILED/exitCode 1, directory intact (`R1`-`R3`).
- `checksums.sha256` as a directory: result FAILED/checksums, manifest FAILED/exitCode 1, `archive.integrity=failed` (`C1`-`C3`).
- `run-manifest.json.tmp` as a directory: result FAILED/manifest, no PASS manifest, both errors reported (`M1`-`M3`).
- FAILED/archive input preserved as FAILED/archive/1; CLEANUP_FAILED input preserved as CLEANUP_FAILED/1; empty run directory PASS with fileCount 1 (`F1`, `K1`, `E1`/`E2`).
- `run-manifest.json` as a directory: FAILED/manifest (`D1`).
- No PASS manifest exists in any fault case (`X1`).

Runner-level: the missing-Node probe produced `status=FAILED`, `failedStage=execution`, `exitCode=1`, `cleanup=NOT_REQUIRED`, `processTree=NOT_REQUIRED`, `archive.integrity=verified`, fileCount=2, and exit 1 in both runs. The wrong-SHA guard exited 1 before creating any run directory. No code path upgrades a failure to PASS: `$result.Status` starts from the manifest status and is only overwritten with FAILED; the runner's `$status` is computed once and never reassigned.

### 4.3 Checksum chain — PASS (core), with F2

- `checksums.sha256` excludes `run-manifest.json` and itself; the manifest records the checksum file's SHA256. There is no cycle: manifest -> checksums -> files, and the manifest is not in the list.
- Independent verification of both missing-Node archives: 36/36 checks passed, including all listed hashes recomputing and the manifest hash matching.
- The `.tmp`/hidden-file exclusion (F2) means "every archive file" is not literally covered; the core cycle-free/verifiable requirement is met.

### 4.4 Process tree — PASS (core), with F3/F6/F7/F8/F9

`Get-OwnedProcesses` (`:466-514`) records PID, PPID, Name, ExecutablePath, CreationDate, and Reason for processes under the unique install dir created at/after `Since`, then walks live descendants. `Test-ProcessRecordOwned` (`:516-537`) checks PID existence, creation time within 2 s, path, or descendant reason. `Stop-OwnedProcessTree` (`:539-596`) closes windows, waits, force-stops, waits up to 10 s, and reports `Remaining`/`Errors`. The runner gates uninstall on `$treeOk` (`run-self-hosted-ci.ps1:204-222`), skips it with `Uninstall skipped: process tree was not confirmed stopped`, marks `CLEANUP_FAILED`, and keeps `installed-app` on failure.

Independent results:

- Root `Morrow.exe` (a copied PowerShell) under a fake install dir is owned, `Test-ProcessRecordOwned` is true, `-ExcludePids` removes it when it is the root, and it is stopped with `Remaining=0` (`P1`-`P6`).
- A live parent that spawns an outside-path `cmd.exe` child: the child is owned as `descendant`, passes the ownership test, and both are stopped (`P7`-`P10`).
- A parent that exits quickly leaving a same-path child: the child is owned as `install-path` (`P11`); the first-run `P12` stop assertion was contaminated by a lingering fixture record, and the isolated rerun shows `owned=2, remaining=0` with the child stopped.
- An outside-path process is not owned and stays alive (`P14`/`P15`).
- A record for the current probe PID with a foreign install path: `Test-ProcessRecordOwned` is false and `Stop-OwnedProcessTree` does not kill the probe (`P16`/`P17`).
- A record with a wrong creation time is rejected and the process stays alive (`P18`/`P19`).
- Access-denied stop action: the first-run `P20` was invalidated because `CloseMainWindow` closed the visible-console fixture before the action; the hidden-window rerun reports errors=2, remaining=1, process alive.
- No-op stop action: the first-run `P21` was invalidated the same way; the hidden-window rerun reports errors=1, remaining=1, and `Stopped` misleadingly contains the PID (`P22`).
- Static: no `taskkill /IM` command and no `Stop-Process -Name`; the only `taskkill` invocations are PID-based `/PID ... /T /F` in the step timeout helpers (`:139`, `:179`). The `/IM` occurrences are comment/test text. The runner's gate is before `Invoke-IsolatedUninstall` and the final exit is 1 for non-PASS (`P23`-`P26`).
- First process probe run: 4 FAILs were harness defects, not implementation failures. `P12` was a cross-fixture/timing artifact (isolated rerun clean); `P20`/`P21` were caused by `CloseMainWindow()` closing visible-console fixtures before the injected action (hidden-window reruns exercise the intended paths); `P23`'s regex matched comment/test-assertion text. The corrected probes exit 0.

### 4.5 Runner probes — PASS

- Missing-Node (PATH without `node`, git/System32/Windows/PowerShell only): two runs, both exit 1, `FAILED/execution/exitCode=1`, distinct runIds and run directories, `run-identity.json`/`README.txt`/`checksums.sha256` present, no BOM, checksums recompute, manifest excluded from the list, fileCount=2. Independent archive verification 36/36.
- Wrong-SHA: exit 1, `Checkout SHA mismatch`, archive root not created.
- The full PASS path through the runner (install + smoke + uninstall) was not executed (prohibited); only the finalizer's PASS path was unit-probed.

### 4.6 Static — PASS

Parser 3/3, YAML 2/2, `git diff --check` exit 0, no added secrets, diff limited to `scripts/ci` + `docs/reports`, no product runtime/schema/test changes. The test suite gained 33 assertions with no deletions (155 added lines, 0 deleted); 56 prior + 33 new = 89.

## 5. Docs honesty

Honest:

- No CI PASS claim: both closeout and evidence index say "不是 CI PASS", "PARTIAL / PENDING_USER_ACTION".
- No registered runner: `actions/runners total_count=0` is stated and true.
- No real self-hosted run: stated as PENDING/BLOCKED and true (0 runs on the reviewed SHA).
- Real NSIS install/uninstall and real process-tree cleanup are explicitly listed as not executed.
- The missing-Node probe fields in the evidence index (FAILED/execution/1, cleanup/tree NOT_REQUIRED, integrity verified, fileCount 2, no BOM) match my independent reproduction exactly.
- The 89/89 count matches; 56+33 is accurate.
- PR #54 OPEN, base, and the baseline `60a445e` parent `4428477` match.

Not honest / incomplete:

- F1: the reviewed SHA is deferred to a nonexistent Issue #58 comment (0 comments). The task requires the reviewed SHA stated exactly; the docs do not.
- F14: typecheck/full-test numbers are author-asserted, not independently rerun.
- Acceptance matrix row 20 is marked `PASS（代码审查）` for the uninstall/delete gate; that is accurate as a static review, but the real NSIS path remains PENDING.
- Acceptance matrix row 24 is correctly left `PENDING` for the independent review; this file completes that row's review but does not change the real-run status.

## 6. Remote state

- `actions/runners`: `total_count=0`, no runners.
- `actions/runs?head_sha=ba8e479...`: `total_count=0`; no run on the reviewed SHA.
- Artifacts: 35 historical, newest 2026-11-05T08:58Z, all from other SHAs; none from `ba8e479`.
- PR #54: `OPEN`, head `ba8e479ebc12e960e5678fbcc33a34a35449fec9`, base `release/morrow-v2-final-delivery`, `mergedAt: null`.
- Issue #58: `OPEN`, 0 comments.
- No tag points at HEAD; nothing was dispatched, created, or published by this review.

## 7. Residual risks

1. **No real NSIS install/uninstall and no real self-hosted run.** The entire NSIS orchestration, uninstaller hand-off (F12), real Electron child tree, and real manifest/cleanup evidence are unexercised. This is the dominant reason the status is PARTIAL.
2. **Checksum coverage (F2).** `.tmp` and hidden files can exist in the archive unlisted; the README/policy claim is broader than the behavior.
3. **Ownership evidence (F3).** The manifest records counts/PIDs, not the full path/creation/reason records used to justify stopping a process.
4. **Orphaned outside-path children (F6).** A child that leaves the install path and outlives its parent is not owned; the realistic Electron tree is covered, but a helper/shell is not.
5. **PID reuse / unreadable paths.** Creation-time tolerance is 2 s and unreadable `ExecutablePath` values are skipped rather than treated as unknown; an elevated child could be missed. The next layer (NSIS process check/uninstall failure) is fail-closed.
6. **TOCTOU respawn.** A process created after the final ownership snapshot but before uninstall could interfere; the uninstaller/removal failure path is CLEANUP_FAILED, not a false PASS.
7. **Finalizer fault modes (F4/F5).** README failures lose their diagnostic; manifest-write failures leave no terminal manifest at all.
8. **Test determinism (F9).** The access-denied/timeout probes depend on `CloseMainWindow` timing.
9. **Workflow timeout/cancellation.** A 180-minute job timeout, cancellation, runner stop, or reboot can skip the `finally` block; a partial `<runDir>` with a GUID name remains and is not reused. Documented by the author.
10. **Dirty worktree (F13)** is not recorded; CI uses a fresh checkout, local runs could mislabel the SHA.
11. **`actions/checkout@v4`** is a mutable tag (prior R3 residual, unchanged by this commit).
12. **NSIS uninstaller hand-off (F12)** is untested; a race would surface as CLEANUP_FAILED (fail-closed), not PASS.

## 8. Conclusion

The three Issue #58 fixes are present, coherent, and independently verified at the unit/probe/static level:

- `New-UniqueRunDirectory` is GUID-unique, refuses pre-existing/path-escape/reparse-point targets, creates subdirectories without `-Force`, leaves old bytes/timestamps unchanged, and the runner writes `run-identity.json` before any step.
- `Complete-RunArchive` makes README/checksum/manifest/verification failures terminal FAILED with `exitCode=1`; no path upgrades a failure to PASS; the checksum chain is cycle-free and independently recomputable.
- `Get-OwnedProcesses`/`Test-ProcessRecordOwned`/`Stop-OwnedProcessTree` identify path/creation/descendant-owned processes, stop only those, verify exit, report access-denied/no-op/timeout as errors/remaining, never use name-based `taskkill`, and the runner skips uninstall/delete and marks CLEANUP_FAILED when the tree is not confirmed stopped.

No BLOCKER or HIGH finding was found. The MEDIUM findings are an overbroad checksum-coverage claim (F2), unpersisted ownership records (F3), and the deferred reviewed SHA (F1); none produces a false PASS or a false zero exit code.

**The overall status is PARTIAL / PENDING_USER_ACTION.** There is no real NSIS install/uninstall and no real self-hosted run: 0 registered runners, 0 workflow runs on `ba8e479ebc12e960e5678fbcc33a34a35449fec9`, and no artifacts from this commit. This is not COMPLETE and not CI PASS.
