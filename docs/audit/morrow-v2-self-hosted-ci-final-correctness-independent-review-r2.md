# Morrow V2 Self-Hosted CI Final Correctness — Independent Review R2 (Issue #58)

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. The only repository write is this file. Throwaway probes were created only under `.tmp/` (gitignored) and removed. Nothing was staged, committed, tagged, pushed, or published. No `npm ci`, `npm install`, full test suite, `npm run build`, `npm run package:win`, NSIS installer, or Electron/Morrow launch was executed. Read-only `gh api` GETs were used. No token, key, or secret is reproduced here.

Review date: 2026-11-06.

Prior review: `docs/audit/morrow-v2-self-hosted-ci-final-correctness-independent-review.md`, which reviewed `ba8e479ebc12e960e5678fbcc33a34a35449fec9` and found three MEDIUM findings (F1 docs SHA, F2 checksum coverage, F3 process records) and no BLOCKER/HIGH.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Branch | `feat/morrow-v2-final-closure` |
| **Reviewed code SHA (exact)** | **`e325b48859bda287f2b2b65cec79c8d2ad52a96b`** |
| Current HEAD (docs-only follow-up) | `b7acd4c832dbff3c99e5e7de48783aa59c5a64dd` (parent `e325b48`; 4 docs files only) |
| Code-fix parent / prior reviewed SHA | `ba8e479ebc12e960e5678fbcc33a34a35449fec9` |
| Commit subjects | `e325b48` = `fix(ci): cover hidden evidence and persist process-tree ownership`; `b7acd4c` = `docs(ci): record the final correctness review and accepted residuals` |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, head `b7acd4c...` (current), reviewed code `e325b48...`, base `release/morrow-v2-final-delivery`, not merged |
| Issue | [#58](https://github.com/ve766/morrow-ai-companion-v2/issues/58), `OPEN`, 0 comments at review time |
| Diff `ba8e479..e325b48` | 7 files: 4 docs (`3 reports` modified, prior review file added) + 3 `scripts/ci` modified; +333 / -36 |
| Diff `e325b48..b7acd4c` | 4 docs files (this R2 file + 3 reports); +285 / -7; **no code, test, or workflow change** |
| Product runtime/schema/test changes | none |
| Worktree | clean at `b7acd4c`; this R2 file is the only repository write in this review (the `b7acd4c` docs follow-up includes it) |
| Registered self-hosted runners | `0` (`actions/runners` total_count=0) |
| Workflow runs on reviewed SHA | `0` (`actions/runs?head_sha=e325b48...` total_count=0) |
| Artifacts from reviewed SHA | none (35 historical artifacts from other SHAs; newest 2026-11-05T08:58Z) |
| Real NSIS install/uninstall | **not performed** |
| Real self-hosted run | **none** |

This file is authoritative for the reviewed code SHA `e325b48859bda287f2b2b65cec79c8d2ad52a96b`. The prior review file is authoritative for `ba8e479...` only. `b7acd4c832dbff3c99e5e7de48783aa59c5a64dd` is a docs-only follow-up that records this review and closes the F1 header/evidence-index staleness; it does not change the code under review.

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall** | **PARTIAL / PENDING_USER_ACTION — no BLOCKER or HIGH; real NSIS install/uninstall and real self-hosted run remain absent** |
| F1 — reviewed SHA / docs identity | **FIXED (docs-only follow-up `b7acd4c`)** — at `e325b48` the closeout §6 recorded `ba8e479...` and pointed to this file, but the headers/evidence index were stale; `b7acd4c` updates the headers to `e325b48...`, lists both reviews, and updates acceptance row 24 to PASS. This file states the exact code SHA |
| F2 — checksum coverage (hidden / `.tmp`) | **FIXED (core)** — `-Force`, no blanket `.tmp` exclusion, policy matches; independent 5-file archive lists `.hidden-evidence` and `leftover.tmp`, all hashes recompute. Two LOW edge residuals: F18 (`run-manifest.json.tmp` listed then consumed) and F19 (leaf-name exclusion hides a nested same-named file) |
| F3 — process-tree ownership persistence | **FIXED** — `processTree.records = @($owned)`; records contain PID/PPID/Name/ExecutablePath/CreationDate/Reason; `-ExcludePids` checked in the path loop and the descendant walk |
| F4 — README failure diagnostics | **FIXED** — `archive.readmeWritten=false` and `archive.errors` contain the README failure; manifest remains FAILED/exitCode 1; no PASS manifest |
| F5 — manifest-write failure terminal manifest | **OPEN / LOW** — no `run-manifest.json` when the manifest itself cannot be written; `finalization-error.txt` and exit code 1 remain the only signals |
| F6 — orphaned outside-path child | **OPEN / LOW, now documented** — path ownership plus live-parent descendants; an outside-path child that outlives its parent is not owned; closeout now records this residual; Electron renderer/GPU/utility/crashpad run from the install dir |
| F7 — `-ExcludePids` descendant bypass | **FIXED** — checked in both loops; independent probe confirms both a same-path child and an outside-path descendant are excluded |
| F8 — `Stopped` lists a no-op PID | **OPEN / LOW** — `Stopped` is appended before post-stop verification; `Remaining`/`Errors` remain accurate and the runner uses errors for CLEANUP_FAILED |
| F9 — access-denied/timeout probe timing | **OPEN / LOW** — visible-console fixtures depend on `CloseMainWindow` timing; 92/92 passed in my run, but the construction is not deterministic |
| F10 — dead `Stop-ProcessesUnderPath` | **FIXED** — function removed; no caller in `scripts/` or `.github/` |
| F11 — workflow stale archive print | **OPEN / LOW** — `if: always()` prints the newest prior archive on a pre-run-dir failure; unchanged |
| F12 — NSIS uninstaller hand-off | **PENDING real run** — not exercised; a race would be CLEANUP_FAILED (fail-closed) |
| F13 — dirty worktree not recorded | **OPEN / LOW** — HEAD checked, worktree cleanliness not recorded; unchanged |
| F14 — author-reported typecheck/full tests | **INFO** — not rerun per constraints; 92/92 probe suite was rerun |
| PS 5.1 compatibility | **PASS** — Parser 3/3; all probes ran on Windows PowerShell `5.1.26100.9711` |
| Docs honesty | **PASS (with F14 caveat)** — no CI PASS/runner/real-run claim; headers/evidence index now state `e325b48...` and list both reviews (`b7acd4c`); real NSIS/self-hosted remain PENDING_USER_ACTION; typecheck/full-test numbers are author-asserted |
| Real NSIS install/uninstall | **ABSENT / PENDING_USER_ACTION** |
| Real self-hosted run | **ABSENT / PENDING_USER_ACTION** — 0 runners, 0 runs |

No BLOCKER or HIGH finding exists. The three MEDIUM findings from the first review are fixed or reduced to LOW residuals. The overall status remains **PARTIAL / PENDING_USER_ACTION** solely because no real NSIS install/uninstall and no real self-hosted workflow run exist.

## 2. Commands and real exit codes

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | `b7acd4c832dbff3c99e5e7de48783aa59c5a64dd` (current docs HEAD) |
| `git rev-parse e325b48` | `e325b48859bda287f2b2b65cec79c8d2ad52a96b` (reviewed code SHA) |
| `git rev-parse e325b48^` | `ba8e479ebc12e960e5678fbcc33a34a35449fec9` |
| `git status --porcelain` | empty at `b7acd4c` before this review revision; this R2 file is the only repository write |
| `git diff --stat ba8e479..e325b48` | 7 files, 333 insertions(+), 36 deletions(-) |
| `git diff --stat e325b48..b7acd4c` | 4 docs files, 285 insertions(+), 7 deletions(-) |
| `git diff --check ba8e479..b7acd4c` | exit **0** |
| PS 5.1 Parser on the 3 `scripts/ci/*.ps1` | 3/3 `PARSE OK`, exit **0** |
| PyYAML `safe_load` on `.github/workflows/ci.yml` and `self-hosted-ci.yml` | `True`/`True`, exit **0** |
| Added-line secret scan (`scripts/ci`, `docs/reports`; precise token patterns) | no real matches, grep exit 1; the only `ghp_` strings are documentation text in the prior review file |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1` | `passed=92 failed=0 total=92`, exit **0** |
| Independent fix probe (runDir + F2/F4/F5 + F3) | `passed=30 failed=0 total=30`, exit **0** |
| Edge probe (`run-manifest.json.tmp` file; nested `run-manifest.json`; hidden subdir file) | exit **0**; see F18/F19 and hidden-subdir PASS |
| Missing-Node runner probe, 2 runs | both exit **1**; `status=FAILED stage=execution`; two distinct run dirs |
| Independent archive verification of both runs | `passed=40 failed=0 total=40`, exit **0**; `processTree.records=[]`, `archive.readmeWritten=true`, `archive.errors=[]` |
| Wrong-SHA guard | exit **1**; archive root not created |
| Dead-helper scan (`Stop-ProcessesUnderPath` in `scripts/ci`, `.github`) | no matches, grep exit 1 |
| Name-kill scan | no `taskkill /IM` command and no `Stop-Process -Name`; only PID-based `taskkill.exe /PID ... /T /F`; `/IM` appears only in a comment and a test assertion |
| `gh api .../actions/runners` | `total_count: 0` |
| `gh api ".../actions/runs?head_sha=e325b48..."` | `total_count: 0` |
| `gh api ".../actions/runs?head_sha=b7acd4c..."` | `total_count: 0` |
| `gh pr view 54` | `OPEN`, head `b7acd4c...`, `mergedAt: null` |
| `gh issue view 58` | `OPEN`, `commentCount: 0` |

Author-reported but **not independently rerun** (prohibited): `npm run typecheck` exit 0; `npm test` 129 files / 1156 tests passed (182.99s in the updated closeout). These remain author assertions; see F14.

## 3. Findings

### F1 — FIXED (docs-only follow-up `b7acd4c`) — reviewed SHA / docs identity

- At `e325b48`: `docs/reports/morrow-v2-self-hosted-ci-final-correctness-closeout.md:102-106` recorded the first review SHA `ba8e479ebc12e960e5678fbcc33a34a35449fec9`, summarized the three MEDIUM findings and fixes, and pointed to this file; but `closeout.md:8` and `evidence-index.md:4` still deferred to a nonexistent Issue #58 comment (0 comments), `evidence-index.md:16` still labeled the first review as the final one, and acceptance row 24 was still `PENDING`. That was the PARTIAL state recorded at the code review.
- `b7acd4c` (docs-only, parent `e325b48`): updates both headers to `代码 SHA: e325b48859bda287f2b2b65cec79c8d2ad52a96b` plus a `文档 HEAD` line, lists both review files in the evidence index, updates acceptance matrix row 24 to `PASS（无 BLOCKER/HIGH）`, and adds rows 28-30 for the LOW residuals (manifest-write failure, orphaned outside-path child, nested same-name/pre-existing tmp).
- This file states the exact reviewed code SHA `e325b48859bda287f2b2b65cec79c8d2ad52a96b`; the reviewed code is unchanged by `b7acd4c`. F1 is fixed.

### F2 — FIXED (core) — hidden files and leftover `.tmp` are now covered

- Files: `scripts/ci/self-hosted-ci-helpers.ps1:375-387,404-411`; `scripts/ci/run-self-hosted-ci.ps1:372`.
- `Get-ChildItem -LiteralPath $runFull -Recurse -File -Force` now includes hidden/system files; the blanket `-and $_.Extension -ne '.tmp'` exclusion is gone. The policy string now says only `run-manifest.json` and `checksums.sha256` are excluded and that every other file, including hidden files, is listed.
- Independent probe: an archive containing `results\result.json`, `plain.txt`, a Hidden `.hidden-evidence`, and `leftover.tmp` produced 5 checksum lines; both `.hidden-evidence` and `leftover.tmp` are listed; all 5 hashes recompute; the set of listed relative paths equals the set of all archive files excluding `run-manifest.json` and `checksums.sha256`; the manifest reports `readmeWritten=true`, `errors=[]`, `status=PASS`, `exitCode=0` (`M1`-`M8`). A hidden file in a subdirectory is also listed (`C`).
- Residual F18 (LOW): a leftover `run-manifest.json.tmp` **file** at checksum time is listed, then `Write-AtomicJson` consumes it by moving it to `run-manifest.json`; the final archive has a listed-but-missing file (`status=PASS`, `fileCount=3`, `listed-but-missing=run-manifest.json.tmp`). This is not reachable in the normal one-shot runner (the temp file is created after the checksum stage), but it is reachable on a retry with a leftover temp file. Recommendation: exclude the finalizer's own temp path or write it outside the checksummed tree; optionally re-verify the final archive after the manifest write.
- Residual F19 (LOW): exclusion is by leaf name (`$_.Name`), so a nested file named `run-manifest.json` (for example, copied evidence) is unlisted though it is not the archive manifest (`status=PASS`, `nestedListed=false`). Recommendation: compare the relative path (`run-manifest.json` / `checksums.sha256`) instead of the leaf name.

### F3 — FIXED — process-tree ownership records are persisted; `-ExcludePids` covers descendants

- Files: `scripts/ci/run-self-hosted-ci.ps1:52-59,185-187,335`; `scripts/ci/self-hosted-ci-helpers.ps1:452-501` (ExcludePids at `:458,481`).
- The runner initializes `processTree.records = @()` and assigns `$processTree.records = @($owned)` before stopping; the manifest serializes `processTree = $processTree`.
- Independent probe: `Get-OwnedProcesses` returned 7 records; every record has `ProcessId`, `ParentProcessId`, `Name`, `ExecutablePath`, `CreationDate`, and `Reason`; a same-path child is `install-path`, an outside-path `cmd.exe` child is `descendant`; `-ExcludePids` removes both the same-path child and the descendant (`P1`-`P7`).
- The missing-Node runner archives contain `processTree.records: []` (no install), proving the field serializes in the real manifest.

### F4 — FIXED — README failure is now persisted

- Files: `scripts/ci/self-hosted-ci-helpers.ps1:376-384,404-411`.
- A `README.txt` directory fault produced `status=FAILED`, `failedStage=readme`, manifest `FAILED`/`exitCode=1`, `archive.readmeWritten=false`, and `archive.errors` containing `README write failed: ...` (`M9`-`M11`). The checksum fault persists `archive.integrity=failed` and non-empty `archive.errors` (`M12`/`M13`). No fault case produced a PASS manifest (`M15`).

### F5 — OPEN / LOW — manifest-write failure still leaves no terminal manifest

- Files: `scripts/ci/self-hosted-ci-helpers.ps1:426-448`, `scripts/ci/run-self-hosted-ci.ps1:374-384`.
- A `run-manifest.json.tmp` directory fault still returns `FAILED`/`manifest` and no `run-manifest.json`; `finalization-error.txt` plus exit code 1 are the only terminal signals (`M14`). This is fail-closed and not a false PASS, but it remains a gap against "the manifest must match the final exit code/status" (there is no manifest to match). Recommendation unchanged: write a fallback manifest under a different name or document this mode.

### F6 — OPEN / LOW, now documented — orphaned outside-path child

- File: `scripts/ci/self-hosted-ci-helpers.ps1:452-501`.
- Ownership is path-based plus a live-parent descendant walk. An outside-path child that outlives its parent is not owned (prior probe `P13`). The closeout now records this residual (`closeout.md:95-96`): Electron renderer/GPU/utility/crashpad run from the install dir, so the realistic tree is covered. No user Morrow impact; an uninstall that then fails is CLEANUP_FAILED (fail-closed).

### F7 — FIXED — `-ExcludePids` descendant bypass

- File: `scripts/ci/self-hosted-ci-helpers.ps1:481`.
- The descendant loop now checks `$ExcludePids` before adding a record. Independent probe: excluding a same-path child and an outside-path descendant leaves both out of the result (`owned=2`, both excluded).

### F8 — OPEN / LOW — `Stopped` still lists a no-op PID

- File: `scripts/ci/self-hosted-ci-helpers.ps1:539-551`.
- A no-op `StopAction` does not throw, so the PID is appended to `Stopped` before verification; `Remaining`/`Errors` correctly report the live process. The runner uses `errors` to mark CLEANUP_FAILED, so there is no false PASS. Recommendation: append only after post-stop verification, or rename the field to `Attempted`.

### F9 — OPEN / LOW — access-denied/timeout probe timing

- File: `scripts/ci/test-self-hosted-install-isolation.ps1:365-379`; helper `CloseMainWindow` at `scripts/ci/self-hosted-ci-helpers.ps1:529-537`.
- The visible-console fixtures can be terminated by `CloseMainWindow()` before the injected `StopAction` runs; my first-review fixture run hit this, and the hidden-window reruns exercised the intended paths. The author's 92/92 suite passed in my run, but the construction is timing-sensitive. Recommendation: hidden-window fixtures or a probe switch to skip `CloseMainWindow`.

### F10 — FIXED — dead helper removed

- `Stop-ProcessesUnderPath` is gone from `scripts/ci/self-hosted-ci-helpers.ps1`; grep over `scripts/ci` and `.github` finds no function and no caller. Historical docs still mention the old implementation as a root cause, which is correct history.

### F11 — OPEN / LOW — workflow stale archive print

- File: `.github/workflows/self-hosted-ci.yml:83-91` (unchanged by this commit). `if: always()` prints the newest directory under `%LOCALAPPDATA%\Morrow\CI`; on a wrong-SHA failure (no new run dir) it can print a previous archive. LOW.

### F12 — PENDING real run — NSIS uninstaller hand-off

- Files: `scripts/ci/self-hosted-ci-helpers.ps1:211-221` (uninstall), `scripts/ci/run-self-hosted-ci.ps1:207-214`.
- `Invoke-IsolatedUninstall` waits for the uninstaller process; an NSIS uninstaller may hand off to a temp copy. A race would surface as CLEANUP_FAILED (fail-closed), not PASS. Cannot be settled without the real NSIS install/uninstall.

### F13 — OPEN / LOW — dirty worktree not recorded

- File: `scripts/ci/run-self-hosted-ci.ps1:11-14` (unchanged). HEAD is checked against `-ExpectedSha`, but a dirty worktree is not recorded; CI uses a fresh checkout, local runs could mislabel the SHA.

### F14 — INFO — author-reported tests

- The closeout claims `npm run typecheck` exit 0 and `npm test` 129 files / 1156 tests (182.99s). Per the review constraints these were not rerun; the 92/92 probe suite was independently rerun and matches. The typecheck/full-test numbers remain author assertions.

### F15 — INFO — synthetic token

- `scripts/ci/test-self-hosted-install-isolation.ps1:167` contains `ghp_` + 24 `a` characters as a pre-existing redaction fixture; it is synthetic, not a real credential. The precise added-line secret scan found no real secrets.

### F16 — INFO — `run-identity.json` remains `RUNNING` in a terminal archive

- `scripts/ci/run-self-hosted-ci.ps1:26-35` writes `status: RUNNING` with a note that `run-manifest.json` is authoritative. The missing-Node archives show identity `RUNNING` and manifest `FAILED`. Documented and intentional.

### F17 — INFO — descendant reason bypasses the path check

- `scripts/ci/self-hosted-ci-helpers.ps1:521-522`. `Test-ProcessRecordOwned` returns true for `Reason='descendant'` even when the path is outside the install dir, and when `MainModule` is unreadable. This is intentional for conhost/crashpad-style helpers; records come from `Get-OwnedProcesses`, not external input. A forged record with a matching creation time could bypass the path check, but it is not reachable from the current runner.

### F18 — LOW (new) — `run-manifest.json.tmp` can be listed then consumed

- File: `scripts/ci/self-hosted-ci-helpers.ps1:385-396,431`.
- If a leftover `run-manifest.json.tmp` **file** exists at checksum time, it is listed in `checksums.sha256`; `Write-AtomicJson` then moves it to `run-manifest.json`. Independent edge probe: `status=PASS`, `tmpListed=true`, `tmpStillExists=false`, `fileCount=3`, `listed-but-missing=run-manifest.json.tmp`. Normal one-shot runs create the temp file after the checksum stage, so this is not on the normal path; it is reachable on a retry with a leftover temp file. Recommendation: exclude the finalizer's own temp path or write it outside the checksummed tree; optionally re-verify the final archive after the manifest write.

### F19 — LOW (new) — exclusion is by leaf name, not relative path

- File: `scripts/ci/self-hosted-ci-helpers.ps1:387`.
- `Where-Object { $_.Name -ne 'checksums.sha256' -and $_.Name -ne 'run-manifest.json' }` excludes a nested file with either name anywhere in the tree. Independent edge probe: a nested `sub\run-manifest.json` was not listed (`status=PASS`, `nestedListed=false`), so the policy's "every other file" is false for that edge. Recommendation: compare the relative path, not the leaf name.

## 4. Evidence per requirement

### 4.1 Identity and diff

Current HEAD is `b7acd4c832dbff3c99e5e7de48783aa59c5a64dd` (docs-only follow-up); the reviewed code SHA is `e325b48859bda287f2b2b65cec79c8d2ad52a96b`, whose parent is `ba8e479ebc12e960e5678fbcc33a34a35449fec9`. `ba8e479..e325b48` touches only `scripts/ci` and `docs` (three report updates plus the committed first review file); `e325b48..b7acd4c` touches only docs (this R2 file plus three reports). No product runtime, schema, test, or workflow changes. Worktree was clean at `b7acd4c` before this review revision.

### 4.2 runDir (unchanged, re-probed)

Independent 8-assertion re-probe: reuse throws and old marker bytes/timestamp are unchanged; a pre-created run dir with a sentinel throws and the sentinel is unchanged; `-Sha '..\evil'` throws; a junction at the exact run-dir path throws and the target content is intact (`R1`-`R8`). The missing-Node runner produced two distinct run dirs/runIds with the reviewed SHA in the manifest.

### 4.3 F2 — checksum coverage

Normal archive: 5 checksum lines, `.hidden-evidence` and `leftover.tmp` listed, all hashes recompute, listed set equals all files minus manifest/checksums, policy text matches (`M1`-`M8`). Hidden file in a subdirectory is listed (`C`). Residuals F18/F19 as above.

### 4.4 F3 — process records and ExcludePids

7 owned records with all six fields; same-path child `install-path`; outside-path child `descendant`; both excluded via `-ExcludePids` (`P1`-`P5`); runner assigns `processTree.records` and serializes `processTree` (`P6`/`P7`). The missing-Node archives contain `processTree.records: []` and the manifest field serializes.

### 4.5 F4/F5 — README and fault manifests

README failure: `FAILED`/`readme`, manifest `FAILED`/1, `archive.readmeWritten=false`, `archive.errors` contains the error (`M9`-`M11`). Checksum failure: `FAILED`/`checksums`, manifest `FAILED`/1, `archive.integrity=failed`, non-empty `archive.errors` (`M12`/`M13`). Manifest-write failure: `FAILED`/`manifest`, no PASS manifest (`M14`); no fault case produced a PASS manifest (`M15`).

### 4.6 Dead code / name kill

`Stop-ProcessesUnderPath` has no definition or caller in `scripts/ci`/`.github` (grep exit 1). The only `taskkill` invocations are PID-based `/PID ... /T /F`; `/IM` appears only in a comment and the test assertion. No `Stop-Process -Name`.

### 4.7 Runner probes

Missing-Node: two runs, both exit 1, `FAILED`/`execution`/`exitCode=1`, distinct runIds/dirs, `run-identity.json`/`README.txt`/`checksums.sha256` present, no BOM, checksums recompute, manifest/checksums excluded, fileCount=2, `processTree.records=[]`, `archive.readmeWritten=true`, `archive.errors=[]`; 40/40 archive checks. Wrong-SHA: exit 1, archive root not created. The full PASS path (install + smoke + uninstall) was not executed (prohibited); only the finalizer PASS path is unit-probed.

## 5. Docs honesty

Honest:

- No CI PASS: closeout/evidence index say `PARTIAL / PENDING_USER_ACTION`, not CI PASS.
- No registered runner: `actions/runners total_count=0` is stated and true.
- No real self-hosted run: stated as PENDING/BLOCKED and true (0 runs on `e325b48...`).
- Real NSIS install/uninstall and real process-tree cleanup remain explicitly not executed.
- 92/92 probe count and 56+36 split match my rerun.
- The missing-Node manifest fields in the evidence index (`processTree.records: []`, `readmeWritten`, `errors`, policy text, fileCount 2) match my independent reproduction.
- The closeout now records the first review SHA `ba8e479...` and the orphaned outside-path residual (F6).
- `b7acd4c` updates the closeout/evidence-index headers to `e325b48859bda287f2b2b65cec79c8d2ad52a96b`, lists both review files, and marks acceptance row 24 `PASS（无 BLOCKER/HIGH）`; the docs no longer defer to the nonexistent Issue #58 comment.
- PR #54 OPEN, base, and the baseline `60a445e` parent `4428477` match.

Not fully honest / incomplete:

- F14: typecheck/full-test numbers are author-asserted, not independently rerun.
- `b7acd4c` is a docs-only commit; it does not add code evidence for the real NSIS/self-hosted path, which remains PENDING_USER_ACTION.

## 6. Remote state

- `actions/runners`: `total_count=0`.
- `actions/runs?head_sha=e325b48...`: `total_count=0`; no run on the reviewed code SHA.
- `actions/runs?head_sha=b7acd4c...`: `total_count=0`; no run on the docs-only follow-up.
- Artifacts: 35 historical, newest 2026-11-05T08:58Z, all from other SHAs; none from `e325b48` or `b7acd4c`.
- PR #54: `OPEN`, head `b7acd4c832dbff3c99e5e7de48783aa59c5a64dd` (current), reviewed code `e325b48859bda287f2b2b65cec79c8d2ad52a96b`, base `release/morrow-v2-final-delivery`, `mergedAt: null`.
- Issue #58: `OPEN`, 0 comments.
- No tag points at HEAD; nothing was dispatched, created, or published by this review.

## 7. Residual risks

1. **No real NSIS install/uninstall and no real self-hosted run.** The NSIS orchestration, uninstaller hand-off (F12), real Electron child tree, and real manifest/cleanup evidence remain unexercised. This is the dominant reason the status is PARTIAL.
2. **F18/F19 checksum edges.** A leftover `run-manifest.json.tmp` file can be listed then consumed; a nested same-named file is unlisted. Neither is on the normal one-shot path, and neither causes a false exit code, but an independent verifier could see a missing or unlisted file.
3. **F5 manifest-write failure.** No terminal manifest exists when the manifest itself cannot be written; exit code 1 and `finalization-error.txt` are the only signals.
4. **F6 orphaned outside-path child.** Path/descendant ownership covers the realistic Electron tree but not an outside-path child that outlives its parent; documented by the author.
5. **F8 `Stopped` field.** It can list a PID whose stop action did nothing; `Remaining`/`Errors` and the runner's CLEANUP_FAILED gate remain accurate.
6. **F9 test timing.** Access-denied/timeout probes depend on `CloseMainWindow` timing.
7. **PID reuse / unreadable paths.** Creation-time tolerance is 2 s; unreadable `ExecutablePath` values are skipped rather than treated as unknown. The next layer (NSIS process check/uninstall failure) is fail-closed.
8. **TOCTOU respawn.** A process created after the final snapshot but before uninstall could interfere; uninstall/removal failure is CLEANUP_FAILED, not PASS.
9. **Workflow timeout/cancellation.** A 180-minute job timeout, cancellation, runner stop, or reboot can skip the `finally` block; a partial GUID-named `<runDir>` remains and is not reused.
10. **Dirty worktree (F13)** is not recorded; CI uses a fresh checkout, local runs could mislabel the SHA.
11. **`actions/checkout@v4`** is a mutable tag (prior R3 residual, unchanged).
12. **NSIS uninstaller hand-off (F12)** is untested; a race would surface as CLEANUP_FAILED, not PASS.

## 8. Conclusion

The three MEDIUM findings from the first review are resolved at the core level:

- **F2 fixed**: hidden files and leftover `.tmp` files are enumerated with `-Force` and listed; the policy text matches; all listed hashes recompute; a complete-coverage probe confirms the listed set equals all archive files minus the manifest and checksum file. Two LOW edge residuals remain (F18/F19).
- **F3 fixed**: the manifest now persists `processTree.records` with PID/PPID/Name/ExecutablePath/CreationDate/Reason for every owned process, and `-ExcludePids` is honored in both the path loop and the descendant walk.
- **F1 fixed in `b7acd4c`**: the docs-only follow-up updates the closeout/evidence-index headers to `e325b48...`, lists both review files, and marks acceptance row 24 `PASS`; this file states the exact reviewed code SHA `e325b48859bda287f2b2b65cec79c8d2ad52a96b`. The reviewed code is unchanged by `b7acd4c`.

F4 is fixed (README failure persisted as `archive.readmeWritten=false` + `archive.errors`), F7 is fixed, and F10 is fixed. F5, F6, F8, F9, F11, F12, F13 remain open at LOW or PENDING real-run level. No BLOCKER or HIGH finding exists.

**The overall status is PARTIAL / PENDING_USER_ACTION.** There is no real NSIS install/uninstall and no real self-hosted run: 0 registered runners, 0 workflow runs on `e325b48859bda287f2b2b65cec79c8d2ad52a96b` or `b7acd4c832dbff3c99e5e7de48783aa59c5a64dd`, and no artifacts from either commit. This is not COMPLETE and not CI PASS.
