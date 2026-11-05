# Morrow V2 Self-Hosted CI Hardening — Independent Re-Review (R2, Issue #57)

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. The only repository write is this file. Throwaway probes were created only under `.tmp/` (gitignored) and removed. Nothing was staged, committed, tagged, pushed, or published. No `npm ci`, `npm install`, full test suite, `npm run build`, `npm run package:win`, NSIS installer, or Electron/Morrow launch was executed. Read-only `gh api` GETs were used.

Review date: 2026-11-05.

First review: `docs/audit/morrow-v2-self-hosted-ci-hardening-independent-review.md` (reviewed `d7f7b70`, returned B1/B2 blockers).

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Branch | `feat/morrow-v2-final-closure` |
| Reviewed HEAD | `f92b1322cba776968aa4a033512308c1ee6f0a79` |
| Parent | `d7f7b7039abac92b90e7560b80602985aff635ac` |
| Commit subject | `fix(ci): address the install-hardening review blockers` |
| Base | `release/morrow-v2-final-delivery` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, head `f92b132...`, not merged |
| Issue | [#57](https://github.com/ve766/morrow-ai-companion-v2/issues/57), `OPEN`, `comments=0` at review time |
| Changed files | 9: `scripts/ci/*` (3) and `docs/*` (6) |
| Product runtime/schema/test changes | none |
| Worktree | clean before this review file; `.tmp/` ignored |
| Registered self-hosted runners | `0` (`actions/runners` total_count=0) |
| Workflow runs on reviewed SHA | `0` (`actions/runs?head_sha=f92b132...` total_count=0) |
| Real NSIS install/uninstall | **not performed** |
| Real self-hosted run | **none** |

`git diff --stat d7f7b70..HEAD`: 9 files, 601 insertions(+), 56 deletions(-). `git diff --name-status` contains only `scripts/ci/run-self-hosted-ci.ps1`, `scripts/ci/self-hosted-ci-helpers.ps1`, `scripts/ci/test-self-hosted-install-isolation.ps1`, and six docs files. No `src/`, `tests/`, `package.json`, `package-lock.json`, or `.github/` change.

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall** | **FAIL / PARTIAL — one remaining functional BLOCKER (N1); no remaining user-harm blocker; real run PENDING_USER_ACTION** |
| B1 — PS 5.1 step exit code | **FIXED — independently verified** |
| B2 — NSIS old-version uninstall | **FIXED by design/static evidence — the CI variant cannot match the user's original appId/GUID; not operationally reachable because of N1** |
| N1 — CI installer artifact name | **BLOCKER (functional, fail-closed)** |
| H1 — writes outside `<runDir>` | **RESOLVED for shortcuts; residual unique-GUID HKCU keys are acceptable residual** |
| H2 — docs honesty | **PARTIALLY FIXED** — counts/status updated; reviewed SHA still not stated; Issue #57 comment reference still dangling; test numbers author-asserted |
| H3 — probe coverage | **PARTIALLY FIXED** — helper-level B1 covered; step loop, install/cleanup state machine, and real NSIS orchestration are not covered by the 55 probes |
| MEDIUM — redaction/junction fixes | **FIXED** |
| MEDIUM — workflow-timeout `finally` | **DOCUMENTED residual** |
| MEDIUM — checkout commit pinning | **RESIDUAL (LOW)** — `actions/checkout@v4` is a mutable tag |
| Static checks | **PASS** |
| Real NSIS install/uninstall | **ABSENT / PENDING_USER_ACTION** |
| Real self-hosted run | **ABSENT / PENDING_USER_ACTION** — 0 runners, 0 runs |

**One functional BLOCKER remains (N1): the CI installer is built under a different artifact name than the runner searches for, so the runner fails before installing. It fails closed and does not touch a user installation, but the isolated CI install is never reached.** No remaining user-harm blocker was found: B2's destruction of an existing user Morrow is fixed by the unique appId/GUID and disabled shortcuts.

## 2. B1 — FIXED and verified

### 2.1 Code path

- `Invoke-CapturedProcess` (`scripts/ci/self-hosted-ci-helpers.ps1:154-193`) starts `System.Diagnostics.Process` with `UseShellExecute=false`, redirects stdout/stderr, waits with `WaitForExit(ms)`, calls the parameterless `WaitForExit()`, then reads `$process.ExitCode` (line 189).
- `Invoke-CiStep` (`scripts/ci/run-self-hosted-ci.ps1:53-95`) delegates to `Invoke-CapturedProcess` (lines 60-64), reads `$captured.ExitCode` (line 64), and contains no `Start-Process`.
- The old `Start-Process -PassThru` pattern is still used by `Invoke-ProcessWithTimeout` for the installer/uninstaller and the NSIS gate, but it now calls the parameterless `WaitForExit()` before reading `ExitCode` (`self-hosted-ci-helpers.ps1:147-149`).

### 2.2 Official probe

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1`

Real result: `probe summary: passed=55 failed=0 total=55`, exit 0. The relevant probes:

- `captured-process-exit-code` — `node.exe --version` exit 0.
- `captured-process-nonzero` — `cmd /d /s /c "exit 7"` exit 7.
- `captured-process-timeout` — 1-second timeout, `timedOut=True`, null exit.
- `nsis-process-check-available` — the NSIS process-check gate is usable on this host.

### 2.3 Independent probe

A throwaway probe under `.tmp/` (removed) reproduced the old failure and exercised the real step function:

| Check | Result |
| --- | --- |
| Old `Start-Process -PassThru` + redirection, `node.exe --version` | `ExitCode` is null; `$null -ne 0` is true — the original B1 defect is real on this host |
| `Invoke-CapturedProcess node.exe --version` | exit 0, output `v22.23.2` |
| `Invoke-CapturedProcess cmd /d /s /c "exit 7"` | exit 7 |
| `Invoke-CapturedProcess` with `ping -n 30 127.0.0.1` and 1s timeout | `TimedOut=True`, `ExitCode=null`, no `ping` left |
| Extracted the real `Invoke-CiStep` function from the runner and ran it | 20/20 checks PASS, exit 0 |
| Step success (`node --version`) | no throw, recorded exit 0, log written |
| Step non-zero (`exit 7`) | threw `Step 'exit-seven' failed with exit code 7`, recorded exit 7 |
| Step timeout (1s) | threw `Step 'timeout-step' timed out after 1 seconds.`, recorded `timedOut=True`, null exit |
| Step redaction (`client_secret=<fake sentinel>`) | log contains `[REDACTED]`, sentinel absent, `redactionBlocked=False` |
| Static | `Invoke-CiStep` contains `Invoke-CapturedProcess`, no `Start-Process`, reads `$captured.ExitCode` |

**B1 status: FIXED.** The runner's step loop now propagates real exit codes on Windows PowerShell 5.1, and the timeout path still kills the process tree.

## 3. B2 — FIXED by design; not operational because of N1

### 3.1 Template evidence (pinned electron-builder 26.15.3)

- `node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js:157`:
  `guid = options.guid || UUID.v5(appInfo.id, ELECTRON_BUILDER_NS_UUID)`.
- `node_modules/app-builder-lib/templates/nsis/multiUser.nsh:8-9`:
  `INSTALL_REGISTRY_KEY "Software\${APP_GUID}"`;
  `UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"`.
- `node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh:14`:
  the installer mutex is `CreateMutex(..., t"${APP_GUID}")`.
- `node_modules/app-builder-lib/templates/nsis/installSection.nsh:52`:
  `!insertmacro uninstallOldVersion SHELL_CONTEXT` is called before installing.
- `node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh:155-176` reads `UninstallString` and `InstallLocation` from those keys; `:210-224` copies and runs the old uninstaller.

Therefore the registry keys, the mutex, and the old-version uninstall are all keyed by `APP_GUID`. The original `appId` `com.morrow.ai-companion` derives a deterministic UUID v5 (computed with the pinned namespace: `92ffd461-...`); the CI appId `com.morrow.ai-companion.ci` would derive `9b063060-...`, but the runner passes an explicit `-c.nsis.guid=3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c`, which overrides the derivation. The CI GUID is different from the user GUID, so `uninstallOldVersion` cannot find the user's uninstall key.

### 3.2 Runner configuration

`scripts/ci/run-self-hosted-ci.ps1:132-141` builds the CI variant with:

- `-c.appId=com.morrow.ai-companion.ci`
- `-c.nsis.guid=3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c`
- `-c.nsis.createDesktopShortcut=false`
- `-c.nsis.createStartMenuShortcut=false`
- `-c.nsis.runAfterFinish=false`
- `-c.artifactName=Morrow-CI-Setup-${version}-${arch}.${ext}`
- `-c.directories.output=release-ci`

Electron-builder CLI parsing was simulated with the pinned `createYargs`/`configureBuildCommand`/`normalizeOptions`: `"false"` values are coerced to boolean `false` (the shortcut options are not truthy strings). A `deepAssign` simulation of the CLI config over `package.json` `build` retains `oneClick=false`, `perMachine=false`, `allowToChangeInstallationDirectory=true`, and applies `createDesktopShortcut=false`, `createStartMenuShortcut=false`, `runAfterFinish=false`, `guid=3f2b8c1e-...`, `output=release-ci`.

Shortcut creation and deletion are compiled out: `NsisTarget.js:474-482` defines `DO_NOT_CREATE_DESKTOP_SHORTCUT` and `DO_NOT_CREATE_START_MENU_SHORTCUT`, which guard both `include/installer.nsh:190-240` (creation) and `uninstaller.nsh:193-205` (deletion). The CI variant therefore does not create or delete `$DESKTOP\Morrow.lnk` or `$SMPROGRAMS\Morrow.lnk`.

### 3.3 Process-kill fallback gate

`allowOnlyOneInstallerInstance.nsh:45-58` (`IS_POWERSHELL_AVAILABLE`) treats PowerShell as available only when `Get-CimInstance` exists and the process-scope execution policy is not `Restricted`. `KILL_PROCESS` (`:81-100`) filters `Win32_Process` by `$_.Path.StartsWith('$INSTDIR', ...)` when available; otherwise it falls back to `taskkill /IM "${_FILE}"`, which could kill a user's running `Morrow.exe`.

`Test-NsisProcessCheckAvailable` (`self-hosted-ci-helpers.ps1:195-203`) runs `powershell.exe -NoProfile -Command "if ((Get-Command Get-CimInstance ...) -and ((Get-ExecutionPolicy -Scope Process) -ne 'Restricted')) { exit 0 } else { exit 1 }"`. It is called at `run-self-hosted-ci.ps1:144-146` before `Assert-IsolatedInstallTarget` and `Invoke-IsolatedInstall`; a false result throws and no install occurs. The logical conditions match `IS_POWERSHELL_AVAILABLE`.

Two LOW gaps remain in the parity: the gate uses `-NoProfile` and `powershell.exe` from PATH, while NSIS uses `$SYSDIR\WindowsPowerShell\v1.0\powershell.exe` with the profile loaded. A profile that sets process-scope `Restricted` (or a PATH shadow) could make the gate pass while NSIS falls back to name-based `taskkill`. This is a theoretical fail-open, not a demonstrated path; the normal case is equivalent.

### 3.4 Release installer is never executed

`npm run package:win` is `npm run build && electron-builder --win nsis --x64 --publish never` (build only). The runner selects the release installer at `run-self-hosted-ci.ps1:126`, and `$releaseInstaller` is used only at lines 231-234 (copy + SHA256), 267-268 (manifest), and 301 (README). `Invoke-IsolatedInstall` is called only with `$installer.FullName` (line 149), which comes from `release-ci` (line 142). No code path executes `$releaseInstaller.FullName`.

### 3.5 Answer to the B2 question

A user's existing Morrow with the original appId/GUID **cannot be matched, uninstalled, or have its shortcuts/registry keys rewritten by the CI variant**:

- `uninstallOldVersion` reads only the CI GUID's `UNINSTALL_REGISTRY_KEY`/`INSTALL_REGISTRY_KEY`;
- the mutex is the CI GUID;
- the install target is a fresh child of `<runDir>`;
- shortcuts are disabled in both creation and deletion;
- the process check filters by `$INSTDIR` when PowerShell is available, and the gate refuses the name-based fallback.

The only theoretical exception is a pre-existing tampered HKCU key at the CI GUID pointing at the user's installation, which requires local registry write access and is out of scope.

### 3.6 N1 — BLOCKER (functional): the CI installer name is shadowed

`package.json:72` sets `build.win.artifactName = "Morrow-Setup-${version}-${arch}.${ext}"`. The runner passes `-c.artifactName=Morrow-CI-Setup-${version}-${arch}.${ext}` at the top level (`run-self-hosted-ci.ps1:139`). Electron-builder's precedence is target-specific > platform-specific > top-level:

`node_modules/app-builder-lib/out/platformPackager.js:551-557`:
```js
artifactPatternConfig(targetSpecificOptions, defaultPattern) {
    const userSpecifiedPattern = targetSpecificOptions?.artifactName
        || this.platformSpecificBuildOptions.artifactName
        || this.config.artifactName;
    ...
}
```
`this.platformSpecificBuildOptions` is `config.win` (`platformPackager.js:50`). `build.win.artifactName` is present, so the top-level `-c.artifactName` is ignored for the Windows NSIS target. The CI build therefore produces `release-ci\Morrow-Setup-2.0.0-x64.exe`, not `release-ci\Morrow-CI-Setup-*.exe`.

`Get-FreshInstaller -RelativeDirectory 'release-ci' -Pattern 'Morrow-CI-Setup-*.exe'` (`run-self-hosted-ci.ps1:142`) then throws `No installer matching Morrow-CI-Setup-*.exe produced by this run in ...\release-ci.` The runner catches the failure, runs `finally` (no install attempted), writes a FAILED manifest, and exits 1. This was demonstrated with a simulated `release-ci\Morrow-Setup-2.0.0-x64.exe`: the CI pattern threw, while the `Morrow-Setup-*.exe` pattern matched the same file.

Impact: the run fails closed; no user installation is touched. But the isolated CI install is never reached, so the B2 fix is not operational and the docs' claim that `release-ci\Morrow-CI-Setup-*.exe` is installed is false. The 55 probes do not catch it: `ci-installer-selected` uses a hand-created file with the expected name, and `runner-builds-ci-installer` only greps the runner text.

Fix direction: pass `-c.win.artifactName=...` or `-c.nsis.artifactName=...` (target-specific), or use the `Morrow-Setup-*.exe` pattern inside `release-ci`; add a probe/assertion for the effective artifact name or a real build test.

**B2 status: the user-harm defect is fixed by design/static evidence; the CI variant is not operationally reachable until N1 is fixed.**

## 4. H1 — shortcuts resolved; residual unique-GUID registry keys

The CI variant still writes outside `<runDir>`:

- `HKCU\Software\3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c` with `InstallLocation`, `KeepShortcuts`, `ShortcutName` (`include/installer.nsh:104-108`). `MENU_FILENAME` is not defined because `menuCategory` is not set, so `MenuDirectory` is not written.
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c` with `DisplayName` (`Morrow 2.0.0`), `UninstallString`, `QuietUninstallString`, `DisplayVersion`, `DisplayIcon`, `Publisher` (if set), `NoModify`, `NoRepair`, `EstimatedSize` (`include/installer.nsh:119-167`).

These keys are unique to the CI GUID, cannot collide with the user's `92ffd461-...`/original keys, and are deleted by the uninstaller (`uninstaller.nsh:250-254`). No shortcuts are created or deleted. No file associations are configured. The residual is: a temporary second `Morrow 2.0.0` entry in Apps & Features during the run, and stale CI-only keys if cleanup fails; neither modifies or removes the user's installation. This is **acceptable residual risk, not a blocker**. The docs do not mention these residual keys; that is a minor documentation gap.

## 5. H2 — docs honesty: partially fixed

Accurate now:

- Probe count is 55 in the report (`report.md:122`), matrix (`matrix.md:31`), and evidence index section 3 (`evidence-index.md:53`); the real run is 55/55, exit 0.
- The report/matrix state the typecheck/test results (`report.md:130`, `matrix.md:32`) instead of deferring only to a comment.
- The status remains `PARTIAL / PENDING_USER_ACTION`; no CI PASS or real self-hosted run is claimed (`report.md:9,131`; `evidence-index.md:5,78`; `matrix.md:4,42`).
- No runner is claimed registered; `actions/runners=0` and no run on `f92b132` are real.

Remaining overstatements/inconsistencies:

- **The reviewed SHA is still not stated.** `report.md:8` and `evidence-index.md:4` still say the full SHA and parent are "以 Issue #57 comment 为准" (per the Issue #57 comment), but Issue #57 has `comments=0`. The exact SHA is `f92b1322cba776968aa4a033512308c1ee6f0a79` (parent `d7f7b70...`). This was H2/M9 and is not fixed.
- `evidence-index.md:13` still says the probe script has "42 项" while section 3 says 55. Inconsistent.
- `evidence-index.md:51` still says the full test/typecheck results are in the Issue #57 comment ("结果见 Issue #57 comment；本文件不预填未执行的结果"), contradicting the report/matrix numbers and citing a nonexistent comment.
- The test numbers `129 files / 1156 tests passed` are author-asserted. This review did not run the suite (prohibited). They are consistent with the prior run on the unchanged product code (`fad6a94` is an ancestor; `git diff --name-only fad6a94..HEAD` has no `src/` or `tests/` change), but they are not independently verified here.
- `matrix.md:31` says "PowerShell 5.1 解析与运行 PASS" citing the 55 probes. The 55 probes do not call `Invoke-CiStep`; they call `Invoke-CapturedProcess`. The full step loop is verified only by this review's independent probe, not by the repository's probe.
- `report.md:81-103` still shows a stale manifest example with `installer: "Morrow-Setup-2.0.0-x64.exe"` and no `releaseInstaller`/`releaseInstallerSha256`; the actual runner records the CI variant in `installer` and the release variant in `releaseInstaller`.
- `report.md:53`, `self-hosted-runner-setup-windows.md:87`, and `ci-no-billing-operations.md:47` claim the installed artifact is `release-ci\Morrow-CI-Setup-*.exe`. N1 makes that false in practice.
- `evidence-index.md:18` lists the first review file (`...independent-review.md`) as the independent review of the final SHA; it reviewed `d7f7b70`, not `f92b132`. This file (r2) is the re-review.

No CI PASS/runner claim was found; the honest PARTIAL/PENDING status is intact.

## 6. H3 — probe coverage: partially fixed

The 55 probes cover the B1 fix at the helper level (`captured-process-*`), plus argument quoting, install-target isolation, junctions, cleanup helpers, uninstaller discovery, redaction, evidence, installer selection, and exact-exe lookup. They do **not**:

- call `Invoke-CiStep` or exercise the runner's step loop (the missing-Node probe fails before any step, `steps=0`);
- exercise the post-install `finally` cleanup branches or the install/cleanup state machine;
- build or install any NSIS installer;
- assert the effective CI installer artifact name (N1);
- exercise the NSIS process-check gate on a host where PowerShell/`Get-CimInstance` is unavailable.

This review's independent probe extracted the real `Invoke-CiStep` and verified success/non-zero/timeout/redaction (20/20), so the B1-specific step-loop gap is covered for this review. The install/cleanup state machine and real NSIS orchestration remain untested; `matrix.md:24` item 14 is still "code review + missing-Node probe", and item 7b is static/PENDING.

## 7. MEDIUM items

| ID | Item | Status |
| --- | --- | --- |
| M1 | `client_secret`/`password`/`secret` redaction and second-pass scan | **FIXED.** `Redact-Text`/`Test-RedactionResidual` now include `client_secret`, `password`, `passwd`, `secret` (`self-hosted-ci-helpers.ps1:325-326,336`). Official probe `redaction-*` 6/6 PASS; the step-loop probe redacted `client_secret=<fake>` and left the second pass clean. Other secret names (`private_key`, AWS `AKIA...`, etc.) remain out of scope; this is a regex filter, not a general secret scanner. |
| M2 | Nested evidence junctions silently skipped | **FIXED.** `Copy-ArchiveEvidence` enumerates all children recursively and throws on any reparse point (`self-hosted-ci-helpers.ps1:285-289`). Probe `evidence-nested-junction-rejected` PASS. |
| M2b | Dangling junction/symlink install target | **FIXED for dangling junctions.** `Assert-IsolatedInstallTarget`/`Test-ReparsePointChain` now use `Get-Item -Force` instead of `Test-Path`, so a dangling junction is seen and rejected (`self-hosted-ci-helpers.ps1:31-34,53-59`); probe `dangling-junction-target-rejected` PASS. A dangling **symlink** could not be created on this host (`mklink /D` requires admin/developer mode; `New-Item -ItemType SymbolicLink` refused a missing target), so that case is unverified. The `Get-Item` change is directionally correct for it. LOW residual. |
| M3 | Workflow cancellation/job timeout can skip `finally` | **DOCUMENTED residual.** `report.md:116` and `matrix.md:28` record that the 180-minute job timeout can kill the job and skip `finally`; cancellation/runner stop/reboot are the same class but are not separately listed. No manifest is written in those cases. |
| M5 | Checkout not commit-pinned | **REMAINS LOW.** `.github/workflows/self-hosted-ci.yml:57-61` still uses `actions/checkout@v4` (mutable tag), with `ref: ${{ github.sha }}`, `fetch-depth: 1`, `persist-credentials: false`; the runner re-verifies `git rev-parse HEAD` (`run-self-hosted-ci.ps1:11-14`). The content commit is exact; the action itself is not immutable. |
| — | `Invoke-CapturedProcess` `.cmd` wrapper quoting | **LOW latent.** The wrapper uses `/d /s /c "<exe> <args>"`; with `/s`, an absolute `.cmd` path containing spaces is split and fails (observed with a throwaway `.cmd` under a spaced path). The runner only passes bare `npm.cmd`/`npx.cmd`, which resolve via PATH and work (verified: `npm.cmd --version` exit 0, `npx.cmd --version` exit 0). |
| — | `Invoke-ProcessWithTimeout` exit code | **FIXED.** Parameterless `WaitForExit()` before `ExitCode` (`self-hosted-ci-helpers.ps1:147-149`); official probe `raw-argument-exit-code` (exit 3) and `uninstall-exit-code` (exit 5) PASS. |

## 8. Commands and real exit codes

| Command | Exit | Observed result |
| --- | --- | --- |
| `git rev-parse HEAD` | 0 | `f92b1322cba776968aa4a033512308c1ee6f0a79` |
| `git rev-parse HEAD^` | 0 | `d7f7b7039abac92b90e7560b80602985aff635ac` |
| `git status --porcelain` | 0 | empty before this review file |
| `git diff --stat d7f7b70..HEAD` | 0 | 9 files, 601 insertions(+), 56 deletions(-) |
| `git diff --name-status d7f7b70..HEAD` | 0 | only `scripts/ci/` and `docs/` |
| `powershell.exe` version | 0 | `5.1.26100.9711`, `Desktop` |
| PS 5.1 parser on all three scripts | 0 | `PARSE-OK` x3 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1` | 0 | `passed=55 failed=0 total=55` |
| Independent captured/step-loop probe | 0 | 20/20 PASS (old null exit reproduced; 0/7/timeout; real `Invoke-CiStep` success/non-zero/timeout/redaction) |
| Bare `npm.cmd`/`npx.cmd` through `Invoke-CapturedProcess` | 0 | npm 10.9.8 exit 0; npx 10.9.8 exit 0 |
| Absolute `.cmd` path with spaces through `Invoke-CapturedProcess` | 1 | latent quoting failure (not used by the runner) |
| `run-self-hosted-ci.ps1` with missing Node | 1 | manifest `status=FAILED`, `steps=0`, `cleanup=NOT_REQUIRED`, evidence arrays 0, `bom=False` |
| `run-self-hosted-ci.ps1` with wrong `-ExpectedSha` | 1 | `Checkout SHA mismatch`; no archive directory created |
| `node -e` YAML parse both workflows | 0 | `YAML-OK` for `ci.yml` and `self-hosted-ci.yml` |
| `git diff --check d7f7b70..HEAD` | 0 | no whitespace errors |
| Secret scan of `git diff d7f7b70..HEAD` | 0 | 3 `ghp_` hits, all the synthetic all-`a` fixture (1 test script, 2 first-review doc); 0 other patterns |
| Artifact precedence simulation (pinned electron-builder) | 0 | effective CI name `Morrow-Setup-2.0.0-x64.exe`; `Morrow-CI-Setup-*.exe` glob does not match |
| Config merge simulation (pinned electron-builder) | 0 | `oneClick=false`, `perMachine=false`, `allowToChangeInstallationDirectory=true`, shortcuts false, `guid=3f2b8c1e-...`, output `release-ci` |
| Simulated `Get-FreshInstaller` with `release-ci\Morrow-Setup-2.0.0-x64.exe` | 0 | CI pattern throws; `Morrow-Setup-*.exe` pattern matches |
| Dangling junction probe | 0 | rejected by `Assert-IsolatedInstallTarget` |
| Dangling symlink probe | 0 | not creatable (`mklink /D` requires admin; `New-Item SymbolicLink` refused missing target) |
| `gh api actions/runners` | 0 | `total_count=0` |
| `gh api actions/runs?head_sha=f92b132...` | 0 | `total_count=0` |
| `gh api actions/runs?head_sha=d7f7b70...` | 0 | `total_count=0` |
| `gh api actions/artifacts` | 0 | 35 historical artifacts, newest 08:58Z from other SHAs; none from `f92b132` |
| `gh api issues/57` | 0 | open, `comments=0` |
| `gh api pulls/54` | 0 | open, head `f92b132...`, base `release/morrow-v2-final-delivery` |
| `git diff --name-only fad6a94..HEAD` filtered for `src/`/`tests/` | 0 (no output) | product code under test unchanged since the 129 files/1156 tests run |

## 9. Residual risks

1. **N1 (functional blocker):** the CI installer is named `Morrow-Setup-2.0.0-x64.exe` in `release-ci`, not `Morrow-CI-Setup-*.exe`; `Get-FreshInstaller` throws and the run fails before installing. Fail-closed, no user harm, but the self-hosted path is not usable until fixed.
2. **No real NSIS install/uninstall:** all B2 evidence is static from the pinned electron-builder templates and configuration. The real installer behavior (registry keys, mutex, uninstaller, process check) has not been executed on this host or any runner.
3. **No real self-hosted run:** `actions/runners=0`; no run on `f92b132` or `d7f7b70`; no artifact from either SHA. The acceptance status is PENDING_USER_ACTION.
4. **Residual HKCU keys outside `<runDir>`:** the CI variant writes/removes unique-GUID keys (`Software\3f2b8c1e-...` and its Uninstall entry). Cleanup failure leaves stale CI-only keys; a temporary duplicate `Morrow 2.0.0` Apps & Features entry can appear. No user installation data is modified.
5. **Process-check parity gap:** `Test-NsisProcessCheckAvailable` uses `-NoProfile` and PATH `powershell.exe`; NSIS uses `$SYSDIR` PowerShell with the profile. A profile that sets process-scope `Restricted`, or PATH shadowing, could theoretically let the gate pass while NSIS falls back to name-based `taskkill`. LOW.
6. **`finally` can be skipped:** workflow cancellation, the 180-minute job timeout, runner service stop, or reboot can kill the process; no manifest/cleanup record is written. Documented as residual; cancellation/reboot are not separately listed.
7. **Coverage gap:** the 55 probes do not call `Invoke-CiStep`, do not exercise the install/cleanup state machine, and do not build/install NSIS. The step loop was verified only by this review's independent probe; real NSIS orchestration remains untested.
8. **Docs:** the reviewed SHA is not stated; the "Issue #57 comment" reference is dangling (`comments=0`); the evidence index still says 42 items; the manifest example is stale; the test numbers are author-asserted; the `release-ci\Morrow-CI-Setup-*` claim is false until N1 is fixed.
9. **Checkout action is a mutable tag:** `actions/checkout@v4`, though the checked-out commit is exact and re-verified.
10. **`.cmd` wrapper latent quoting:** absolute `.cmd` paths with spaces fail; current runner calls use bare `npm.cmd`/`npx.cmd` and are safe.
11. **Dangling symlink target:** unverified because creation requires admin/developer mode; the `Get-Item` change likely closes it.
12. **Redaction is regex-based:** `client_secret`/`password`/`secret` are now covered, but other secret names and formats are out of scope.
13. **Fixed CI GUID:** all CI runs share the same identity. A single runner executes one job at a time, so concurrent installs are not expected; a stale CI install (cleanup failure) may be uninstalled by a later CI run. This is the CI's own identity, not the user's installation.

## 10. Conclusion

- **B1 is fixed and verified.** `Invoke-CapturedProcess` uses `System.Diagnostics.Process` and real `ExitCode`; `Invoke-CiStep` delegates to it; the official 55-probe suite and an independent step-loop probe both pass. The old `Start-Process` null-exit defect was reproduced on this host and no longer affects the step loop.
- **B2's user-harm defect is fixed by design.** The CI variant uses a unique `appId` and explicit unique GUID, disables desktop/start-menu shortcuts (creation and deletion compiled out), installs into a fresh `<runDir>` child, and the release installer is only hashed/copied, never executed. A user's existing Morrow with the original appId/GUID cannot be matched or uninstalled by the CI variant. The process-check gate refuses the name-based `taskkill` fallback under the same logical conditions as NSIS (with two LOW parity caveats).
- **One functional BLOCKER remains (N1):** `build.win.artifactName` shadows the top-level `-c.artifactName`, so the CI build produces `release-ci\Morrow-Setup-2.0.0-x64.exe`, while the runner searches for `Morrow-CI-Setup-*.exe` and throws. The run fails closed; no user installation is touched, but the isolated install is never reached and the docs' artifact-name claim is false.
- **H1** is resolved for shortcuts; the residual unique-GUID HKCU keys are acceptable residual, not a blocker.
- **H2/H3** are partially fixed: counts and status are honest, but the reviewed SHA is still not stated, the Issue #57 comment reference is still dangling, and the 55 probes still do not cover the step loop, install/cleanup state machine, or real NSIS orchestration.
- **No real NSIS install/uninstall and no self-hosted run exist.** `actions/runners=0`; 0 runs on `f92b132`; no artifact from it. The overall status is at most **PARTIAL / PENDING_USER_ACTION**, not COMPLETE, not CI PASS.

**Recommendation:** fix N1 (`-c.win.artifactName=...` or `-c.nsis.artifactName=...`, or use the `Morrow-Setup-*.exe` pattern inside `release-ci`); add a probe/assertion for the effective artifact name or a real build test; state the reviewed SHA `f92b1322cba776968aa4a033512308c1ee6f0a79` in the report/evidence index; remove the nonexistent Issue #57 comment reference or post the comment; update the evidence-index 42-to-55 count and the stale manifest example; then register a runner and perform the real NSIS install/uninstall on a dedicated user/VM. Until N1 is fixed, the self-hosted CI path should not be considered operational.
