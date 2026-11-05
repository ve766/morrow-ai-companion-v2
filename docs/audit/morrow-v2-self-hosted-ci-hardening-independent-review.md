# Morrow V2 Self-Hosted CI Hardening — Independent Review (Issue #57)

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. The only repository write is this file. Throwaway probes were written only under `.tmp/` (gitignored) and removed. Nothing was staged, committed, tagged, pushed, or published.

Review date: 2026-11-05.

Path shorthand used below: `...report.md` = `docs/reports/morrow-v2-self-hosted-ci-hardening-report.md`; `...evidence-index.md` = `docs/reports/morrow-v2-self-hosted-ci-hardening-evidence-index.md`; `...matrix.md` = `docs/testing/morrow-v2-self-hosted-ci-hardening-matrix.md`.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Branch | `feat/morrow-v2-final-closure` |
| Reviewed HEAD | `d7f7b7039abac92b90e7560b80602985aff635ac` |
| Parent | `15a06e5f11367f99399efd0aa13f8f45574541a2` |
| Commit subject | `fix(ci): isolate the NSIS install and always clean it up` |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not merged, head `d7f7b7039abac92b90e7560b80602985aff635ac` |
| Issue | [#57](https://github.com/ve766/morrow-ai-companion-v2/issues/57), `OPEN`, `comments=0` at review time |
| Changed files | 8: `scripts/ci/*` (3 files, one modified, two added) and `docs/*` (5 files, two modified, three added) |
| Product runtime/schema/test changes | none |
| Worktree | clean before this review file; `.tmp/` ignored |
| Registered self-hosted runners | `0` (`actions/runners` total_count=0) |
| Workflow runs on reviewed SHA | `0` (`actions/runs?head_sha=d7f7b70...` total_count=0) |
| Real NSIS install/uninstall | **not performed** |
| Real self-hosted run | **none** |

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall** | **BLOCKER — not ready; do not merge or run on a user machine** |
| **Security (end-to-end)** | **BLOCKER** — the NSIS installer can silently uninstall an existing user Morrow installation; workflow gates themselves are sound |
| **Install target assertion** | **PASS** for normal/tricky paths; one theoretical broken-symlink gap (LOW) |
| **Install isolation (end-to-end)** | **FAIL** — `/D=` isolates the new files, but electron-builder's `uninstallOldVersion` and shortcut/registry writes are not isolated |
| **Cleanup state machine** | **PASS as logic** (5/5 stubbed scenarios); **unreachable in the real runner** because of the step exit-code blocker |
| **Redaction** | **PASS for the required vectors**; MEDIUM gaps for other secret names; LOW false positive on single-quoted values |
| **Evidence archive** | **PASS**; LOW gap: nested junctions are silently skipped, not rejected |
| **PowerShell 5.1** | **FAIL (execution)** — every `Invoke-CiStep` step fails; **PASS (parsing)** for all three scripts |
| **Docs honesty** | **PARTIAL / FAIL** — PENDING status is honest, but the reviewed SHA is not stated, the cited Issue #57 evidence comment does not exist, and several isolation/PowerShell claims are contradicted |
| **Real run** | **ABSENT / PENDING_USER_ACTION** — no real NSIS install/uninstall and no self-hosted run exist |

**Two independent BLOCKERs.** B1 makes the new runner unable to execute a single step on Windows PowerShell 5.1. B2 means that once B1 is fixed, running the installer on a machine with an existing standard Morrow installation will uninstall that installation before installing to the temporary directory. Both must be fixed before this path is used.

## 2. Scope and identity verification

Commands and observed results are in §6. The diff contains only:

```
docs/ci/ci-no-billing-operations.md                (modified)
docs/ci/self-hosted-runner-setup-windows.md        (modified)
docs/reports/morrow-v2-self-hosted-ci-hardening-evidence-index.md   (added)
docs/reports/morrow-v2-self-hosted-ci-hardening-report.md           (added)
docs/testing/morrow-v2-self-hosted-ci-hardening-matrix.md           (added)
scripts/ci/run-self-hosted-ci.ps1                  (modified)
scripts/ci/self-hosted-ci-helpers.ps1              (added)
scripts/ci/test-self-hosted-install-isolation.ps1  (added)
```

`git diff --stat 15a06e5..HEAD`: 8 files, 948 insertions, 106 deletions. No product runtime, schema, migration, or product-test change; the only test addition is `scripts/ci/test-self-hosted-install-isolation.ps1`. The self-hosted workflow is unchanged by this commit but was parsed and reviewed at HEAD because it is the execution path.

## 3. BLOCKER findings

### B1 — BLOCKER: `Invoke-CiStep` cannot read a child exit code on Windows PowerShell 5.1; every step fails

Evidence:

- `scripts/ci/run-self-hosted-ci.ps1:65-66` starts every step with
  `Start-Process ... -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -NoNewWindow`.
- `scripts/ci/run-self-hosted-ci.ps1:78` reads `$code = $process.ExitCode`.
- `scripts/ci/run-self-hosted-ci.ps1:107` throws when `$code -ne 0`. In PowerShell, `$null -ne 0` is `True`.

On Windows PowerShell 5.1, a process object returned by `Start-Process -PassThru -NoNewWindow` with redirected streams has an empty/null `ExitCode` after `WaitForExit(...)`. This is a known PowerShell issue (PowerShell/PowerShell#20400, "Start-Process does not populate the process object's exit code with NoNewWindow switch", `https://github.com/PowerShell/PowerShell/issues/20400`). It is not specific to this machine; the workflow uses `shell: powershell`, i.e. Windows PowerShell 5.1.

Direct reproduction with the exact runner pattern and real `node.exe`:

```
ExitCodeIsNull=True
code=[]
null-ne-0=True
output=v22.23.2
```

The command exited 0 and `node.exe --version` printed successfully, but `$process.ExitCode` was null, so the runner's `$code -ne 0` test is true.

End-to-end harness (all external commands stubbed under `.tmp`; no npm, no NSIS, no Electron):

```
==> node-version
v22.0.0
FAILED: Step 'node-version' failed with exit code
SCENARIO success: exit=1 ... status=FAILED
```

The first step prints its output and is then reported as failed with an empty exit code. Because `Invoke-CiStep` is used for every step (`node-version`, `npm-version`, `git-head`, `npm ci`, typecheck, tests, evaluations, build, smokes, persistence, `package:win`, `installed-app-smoke`), the runner cannot reach the NSIS install at all.

Impact: the Issue #57 runner is non-functional on its documented runtime. The 42/42 probe suite does not catch this because it only exercises the helper functions; it never calls `Invoke-CiStep`. The documented "missing Node" probe also does not catch it because it fails before any step (`steps=0`).

Fix direction (not implemented): use `[System.Diagnostics.Process]`/`ProcessStartInfo` with `WaitForExit(milliseconds)` and `ExitCode`, or cache the process handle before the process exits, or use `-Wait` (which defeats the per-step timeout). The per-step timeout and process-tree kill must be preserved.

### B2 — BLOCKER: the NSIS installer can silently uninstall an existing user Morrow installation

The `/D=` change isolates where the **new** files are installed, but it does not stop electron-builder's installer from finding and uninstalling an existing installation through the shared per-user registry key.

Evidence chain:

1. `package.json:53` sets `appId` to `com.morrow.ai-companion`; `package.json:75-79` sets `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, `createDesktopShortcut: true`, `createStartMenuShortcut: true`.
2. The pinned build tool is `app-builder-lib 26.15.3` (`package-lock.json:1843-1845`). `node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js:157-163` derives a deterministic GUID from `appId` (no random component): `UUID.v5(appInfo.id, ELECTRON_BUILDER_NS_UUID)`.
3. For this appId the computed GUID is deterministic (UUID v5 of `com.morrow.ai-companion`); the per-user uninstall key is
   `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<the same deterministic GUID>`
   (`multiUser.nsh:8-9`; `UNINSTALL_REGISTRY_KEY = Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}`).
4. `installSection.nsh:52` unconditionally calls `!insertmacro uninstallOldVersion SHELL_CONTEXT` before installing the new files.
5. `include/installUtil.nsh:155` reads `UninstallString` from that key; `:169` reads `InstallLocation`; `:210` copies the old uninstaller to `$PLUGINSDIR\old-uninstaller.exe`; `:224` runs it:
   `ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 _?=$installationDir'`.
6. The new install then writes the same `INSTALL_REGISTRY_KEY`/`UNINSTALL_REGISTRY_KEY` (`include/installer.nsh:104,119-123`) and, on uninstall, deletes them (`uninstaller.nsh:250-254`).

The CI script never checks the registry or blocks the installer when an existing installation exists. `Assert-IsolatedInstallTarget` (`scripts/ci/self-hosted-ci-helpers.ps1:44-60`) only checks the filesystem target, and `scripts/ci/run-self-hosted-ci.ps1:140-146` proceeds directly to `Invoke-IsolatedInstall`.

Impact: on a runner account that has a standard Morrow NSIS installation (the normal case for a user's machine), the CI installer will silently uninstall the user's Morrow (assuming the old uninstaller succeeds, the normal case) — deleting its files, shortcuts, and uninstall registration — then install the test copy into `<runDir>\installed-app`, and the CI uninstaller will remove the test copy. The end state is that the user's Morrow is gone. This is the same class of defect Issue #57 is intended to eliminate, and it directly contradicts the runner README claim at `scripts/ci/run-self-hosted-ci.ps1:296` ("no existing user installation is searched, launched, modified or uninstalled") and the docs claim at `docs/ci/self-hosted-runner-setup-windows.md:85-91`.

This finding is static, from the pinned electron-builder 26.15.3 templates. No real NSIS install/uninstall was executed (prohibited by the review rules and by the repo's own PENDING status). The code path is deterministic for any installation built with the same `appId`.

Mitigation direction (not implemented): build the CI installer with a CI-specific `appId`/`guid` so its registry keys cannot match the user's installation; disable `createDesktopShortcut`/`createStartMenuShortcut` for the CI build; and/or run the install smoke in a dedicated Windows user/VM with no existing Morrow. A portable/zip target for the smoke would avoid the NSIS installer entirely. Until then, the self-hosted workflow must not run on a user's daily machine.

## 4. HIGH findings

### H1 — HIGH: installer/uninstaller writes and deletes user state outside the run directory

Even if the old-version uninstall in B2 were avoided (e.g. by a CI-specific GUID), the NSIS install is not confined to `<runDir>\installed-app`:

- `installSection.nsh:68-69` adds start-menu and desktop links; `common.nsh:84-108` names them `$DESKTOP\Morrow.lnk` / `$SMPROGRAMS\Morrow.lnk`; `include/installer.nsh:216-225` creates/overwrites `$newDesktopLink`; `uninstaller.nsh:195,201` deletes the old links.
- `include/installer.nsh:104,119-123` writes `HKCU\Software\<GUID>` and `HKCU\...\Uninstall\<GUID>`; `uninstaller.nsh:250-254` deletes them.

`package.json:78-79` enables both shortcuts, and the runner passes only `/S /D=...` (`scripts/ci/run-self-hosted-ci.ps1:144`; `self-hosted-ci-helpers.ps1:62-71`). The CI uninstaller is invoked with `/S` only (`self-hosted-ci-helpers.ps1:152-162`), so it deletes the same shortcut names and registry keys.

Impact: a CI run can overwrite or delete the user's `Morrow.lnk`, and can overwrite/remove the user's uninstall registration, even when the install directory itself is isolated. The docs' claim that cleanup "only deletes `installed-app` and `smoke-profile`" (`docs/ci/self-hosted-runner-setup-windows.md:89`) is true for the PowerShell `Remove-IsolatedPaths` call but false for the installer/uninstaller as a whole.

### H2 — HIGH: docs overstate what was verified and do not state the reviewed SHA

- `docs/reports/morrow-v2-self-hosted-ci-hardening-report.md:8` and `docs/reports/morrow-v2-self-hosted-ci-hardening-evidence-index.md:4` say the final full SHA and parent are "以 Issue #57 comment 为准" (per the Issue #57 comment). At review time `gh api repos/ve766/morrow-ai-companion-v2/issues/57` reports `comments=0`; there is no such comment. The docs therefore never state the reviewed SHA exactly. This review does: `d7f7b7039abac92b90e7560b80602985aff635ac`.
- `docs/testing/morrow-v2-self-hosted-ci-hardening-matrix.md:29` claims full tests/typecheck `PASS` with evidence "见 Issue #57 comment（129 files / 1156 tests）"; that comment does not exist. This review did not run the full suite (prohibited), so the claim is **unverified**, not confirmed.
- `docs/testing/morrow-v2-self-hosted-ci-hardening-matrix.md:28` says "PowerShell 5.1 解析与运行 PASS ... 42 项探针 exit 0". Parsing passes and the 42 probes pass, but the runner's step execution does not (B1). The "运行 PASS" wording is misleading; the only runner execution documented is the missing-Node probe, which fails before any step.
- `docs/reports/morrow-v2-self-hosted-ci-hardening-report.md:50,57` and `docs/ci/self-hosted-runner-setup-windows.md:85-89` describe the install as isolated and claim no user installation is touched. B2/H1 contradict this at the installer level.
- The honest parts remain honest: `docs/reports/...report.md:9,110-113`, `...evidence-index.md:5,70,79`, and `...matrix.md:32-35,39` all say PARTIAL/PENDING, no runner is registered, no real NSIS install/uninstall or self-hosted run happened, and this is not CI PASS. That is accurate.

### H3 — HIGH: the 42-probe suite does not test the runner's step loop, install path, or cleanup state machine

`scripts/ci/test-self-hosted-install-isolation.ps1` dot-sources only `self-hosted-ci-helpers.ps1` (line 8). It tests the helpers, and at lines 199-202 it only greps the runner text for recursive-scan patterns. It never calls `Invoke-CiStep`, never invokes the runner's install/cleanup `finally` branches, and never runs an installer.

The docs' only successful runner execution is the missing-Node probe (`docs/reports/...evidence-index.md:37-42`), which fails before `Invoke-CiStep` (`steps=0`). Consequently:

- B1 was not caught by the suite.
- B2 was not caught because the suite only checks the install **target**, not the installer's registry behavior.
- The matrix item "finally 在主流程失败时仍执行清理 PASS（代码审查 + 缺失 Node 探针）" (`...matrix.md:21`) is supported only by code review and the pre-step failure; the post-install cleanup branches are not covered by the repo's probe.

This is a coverage gap that creates false confidence in a runner that is currently non-functional.

## 5. MEDIUM / LOW findings

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| M1 | MEDIUM | Redaction covers the required vectors but not other common secret names: `client_secret`, `password`, `secret`, `private_key`, AWS `AKIA...` etc. pass through unchanged and `Test-RedactionResidual` reports them clean. | `self-hosted-ci-helpers.ps1:256-279`; extra probe: `client_secret=<fake sentinel>` and `password=<fake sentinel>` were unchanged, `residualCount=0` |
| M2 | LOW/MEDIUM | `Copy-ArchiveEvidence` silently skips nested junctions instead of rejecting them. PS 5.1 `Get-ChildItem -Recurse -File` does not traverse a junction; the reparse check only runs on enumerated files, so a nested junction yields 0 entries and no throw. No outside file is copied (no leak), but evidence can be silently lost. | `self-hosted-ci-helpers.ps1:218-254`; reparse probe: `recursive-file-count=0`, `chain-on-junction=True`, `copy-entries=0`, `outside-file-still-there=True`, `dest-created=False` |
| M3 | MEDIUM | Workflow/job cancellation, the 180-minute job timeout, runner service stop, or machine reboot kills the PowerShell process; `finally` does not run, so `<runDir>\installed-app`, registry keys, and shortcuts can remain, and no manifest cleanup record is written. The matrix acknowledges only the job timeout. | `.github/workflows/self-hosted-ci.yml:54`; `scripts/ci/run-self-hosted-ci.ps1:156-195`; `...matrix.md:35` |
| M4 | LOW | A pre-created **broken symlink** at `<runDir>\installed-app` is not detected: PS 5.1 `Test-Path` is false for a broken symlink, and `Test-ReparsePointChain` only checks paths that `Test-Path` finds. A dangling **junction** is rejected because `Test-Path` is true (probe A17). Broken-symlink creation requires admin/developer-mode and prediction of the run directory, so this was not demonstrable here. | `self-hosted-ci-helpers.ps1:27-42,44-60`; dangling-junction probe rejected; symlink creation failed with "此操作需要管理员权限" |
| M5 | LOW | `actions/checkout@v4` is a mutable tag, not a commit SHA. The checked-out ref is exact `${{ github.sha }}` and `persist-credentials: false`, so the commit identity requirement is met, but the action itself is not immutable. | `.github/workflows/self-hosted-ci.yml:57-61` |
| M6 | LOW | The manifest is UTF-8 without BOM (intentional). PS 5.1 `Get-Content -Raw` defaults to the ANSI code page; on this Chinese-locale host, parsing the manifest without `-Encoding UTF8` failed because the non-ASCII failure message was misdecoded. With `-Encoding UTF8` it parsed correctly. Consumers should specify UTF-8. | `self-hosted-ci-helpers.ps1:9-11`; `run-self-hosted-ci.ps1:280`; probe: first parse failed, `PARSE-UTF8=OK`, `bom=False` |
| M7 | LOW | On installer failure before any install directory exists, the manifest records `cleanup.status=PASS` (nothing to clean) while `status=FAILED` and `installation.installExitCode=3`. Semantically defensible but easy to misread. | Harness `installer-failure` scenario |
| M8 | LOW | `Test-PathWithin` cannot treat a direct child of a drive root as within that root: `Get-NormalizedPath 'C:\'` keeps the trailing slash, then `Test-PathWithin` appends another `\` and compares `C:\Windows` against `C:\\`. The current runner uses deep paths, so this is latent. | `self-hosted-ci-helpers.ps1:13-25`; probe A19 |
| M9 | LOW | The implementation docs do not state the reviewed SHA; they defer to a nonexistent Issue #57 comment (`comments=0`). The evidence index and report are otherwise honest about PENDING. | `docs/reports/...report.md:8`; `...evidence-index.md:4`; `gh api issues/57` |
| M10 | LOW/INFO | The unchanged hosted `ci.yml` still installs NSIS with `/S` and recursively scans `%LOCALAPPDATA%` for `Morrow.exe` (`.github/workflows/ci.yml:100-104`). It runs on GitHub-hosted `windows-latest`, so there is no user installation there, but if it is ever pointed at a self-hosted/user machine it reintroduces the Issue #57 defect. This commit did not change it. | `.github/workflows/ci.yml:100-104`; `git diff --name-status` excludes `.github/` |
| M11 | INFO | `Invoke-ProcessWithTimeout` rejects an empty `-Arguments` string (`Start-Process -ArgumentList ''` fails parameter validation). The runner always passes `/S /D=...` or `/S`, so it is not hit today. | `self-hosted-ci-helpers.ps1:131-144` |
| M12 | LOW | The installer copy in the archive path (`run-self-hosted-ci.ps1:222-225`) is outside `Copy-ArchiveEvidence`; it uses the installer selected earlier and records the earlier SHA256. A local replacement between selection and copy is a TOCTOU that the checksum file would reveal but the manifest would not. | `run-self-hosted-ci.ps1:140-141,222-225` |
| M13 | LOW | The only local `release/win-unpacked/Morrow.exe` reports `ProductVersion=44.9.3`, `FileVersion=44.9.3`, `ProductName=Electron` (unpatched Electron version info), consistent with the docs' statement that the local NSIS/packaging step was blocked. `Assert-InstalledVersion` would pass via FileVersion `2.0.0` only if electron-builder's resource patch succeeds in a real build; that has not been demonstrated. | `release/win-unpacked/Morrow.exe` (gitignored build output); `run-self-hosted-ci.ps1:148-150`; `self-hosted-ci-helpers.ps1:108-121` |

## 6. Area-by-area verification

### 6.1 Install target isolation — PASS for normal/tricky paths, with one theoretical gap

`Assert-IsolatedInstallTarget` (`self-hosted-ci-helpers.ps1:44-60`) requires the run directory to exist, the target to be a strict child of it (`Test-PathWithin`, lines 20-25), the target not to exist, and no reparse point on the target-to-runDir chain (`Test-ReparsePointChain`, lines 27-42). The adversarial probe results:

| Case | Result |
| --- | --- |
| `runDir\..\outside` | rejected |
| `runDir\sub\..\..\outside` | rejected |
| `runDir\a\b\..\..\..\outside` | rejected |
| `runDir2\installed-app` prefix sibling | rejected |
| trailing separator `runDir\installed-app\` | accepted, normalized to `runDir\installed-app` |
| case differences | accepted (case-insensitive) |
| pre-existing directory | rejected; `keep.txt` SHA256 unchanged |
| pre-existing file | rejected |
| runDir itself is a junction | rejected |
| intermediate junction `runDir\link\installed-app` | rejected |
| dangling junction as the target | rejected (PS `Test-Path` is true, so the pre-existing-target check fires) |
| 8.3 short-name alias | not available on this volume (8.3 disabled); a real alias would not textually match the long runDir and would fail closed |
| broken symlink as the target | not creatable here (admin/developer-mode required); static logic suggests it would be skipped by `Test-Path`/`Test-ReparsePointChain` (M4) |

No install-target bypass was found for the paths that can be created without special privilege. The reparse check correctly rejects the runDir itself, intermediate junctions, and a dangling junction. The only gap is the broken-symlink case (M4), which requires symlink privilege and knowledge of the run directory.

### 6.2 NSIS argument — PASS

`Get-NsisInstallArgument` (`self-hosted-ci-helpers.ps1:62-71`) returns one raw string `/S /D=<absolute path>`, rejects quotes and CR/LF, and relies on `GetFullPath` normalization. The repo probe and the independent probe confirm:

- path with spaces: `/S /D=<...>\a b c\installed-app`; a `.cmd` stub echoes `%*` and receives the exact string;
- `/D=` is last; no quote characters;
- the stub's exit code 7 is propagated by `Invoke-ProcessWithTimeout`;
- quote and newline inputs throw.

The builder config supports `/D=`: `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true` (`package.json:75-77`), and electron-builder's `multiUser.nsh:50-54` explicitly lets `/D=` override `$INSTDIR`. This part is sound. It does not address B2/H1.

### 6.3 No user-install discovery in the script — PASS for the script, FAIL at the installer level

`Get-InstalledExecutable` (`self-hosted-ci-helpers.ps1:92-106`) checks only `<installDir>\Morrow.exe`; it does not recurse. The self-hosted runner has no `%LOCALAPPDATA%` recursive scan: the only remaining recursive scan is in the unchanged hosted `ci.yml:103` (M10). The old-install fixture probe (`old-install-*`, 4 assertions) creates an old `Morrow.exe` and sentinel under a temporary `user profile\AppData\Local\Programs\Morrow`, and confirms the target and cleanup are rejected and the bytes/file count are unchanged. The probe itself hashes the fixture to prove byte-identity, so "not read" is a static-code conclusion about the runner, not a probe observation.

However, the NSIS installer itself searches the HKCU uninstall key and can uninstall the existing installation (B2). So the claim "no existing user installation is searched, launched, modified or uninstalled" is true for the PowerShell script's own logic but false for the run as a whole.

### 6.4 Process termination — PASS

`Stop-ProcessesUnderPath` (`self-hosted-ci-helpers.ps1:164-182`) enumerates `Win32_Process` by leaf name, reads `ExecutablePath`, skips processes whose path is null/empty, and stops only an exact case-insensitive path match. There is no name-only fallback. Independent probe:

- a `Morrow.exe` copy launched from the run's install dir was stopped (1 PID);
- a same-named `Morrow.exe` launched from a different directory survived.

### 6.5 Cleanup state machine — PASS as logic, unreachable in the real runner

Helper-level probes pass: success removes `installed-app` and `smoke-profile`; an unlisted sibling is kept; the second pass is idempotent; a locked file yields `CLEANUP_FAILED` and keeps the directory; a junction is refused and the outside file is kept; `..\outside` is refused.

To exercise the runner's `finally` without real npm/NSIS/Electron, I ran a stubbed harness under `.tmp`: fake `node.exe`, `npm.cmd`, `npx.cmd`, a fake `Morrow.exe` with FileVersion 9.9.9.0, a fake installer that parses `/D=` and creates `installed-app\Morrow.exe` + `Uninstall Morrow.exe`, and a fake uninstaller with a configurable exit code. Because B1 makes the real runner fail at its first step, the harness wrapped `Start-Process` with `-Wait` (a test-only shim; the runner was not modified) so the cleanup branches could be reached. Results:

| Scenario | Exit | cleanup.status | installed-app after | Manifest status | Result |
| --- | --- | --- | --- | --- | --- |
| success | 0 | PASS | removed | PASS | pass |
| post-install smoke failure | 1 | PASS | removed (uninstalled) | FAILED | pass |
| uninstall failure (exit 5) | 1 | CLEANUP_FAILED | kept | FAILED | pass |
| installer failure (exit 3) | 1 | PASS (partial install uninstalled) | absent | FAILED | pass |
| pre-install step failure | 1 | NOT_REQUIRED | absent | FAILED | pass |

The manifest records `installerSha256`, `installedExeSha256`, `uninstaller`, `uninstallerExitCode`, `removedPaths`, `errors`, and the failure message in these scenarios. The state machine logic is correct. In the actual runner, B1 prevents reaching it.

### 6.6 Failure/timeout behavior — PASS for helper timeouts; workflow-level kill remains a residual

- `Invoke-CiStep` has a per-step timeout (`run-self-hosted-ci.ps1:52,68-72`), and every call passes a value (`:118-138`).
- `Invoke-ProcessWithTimeout` uses `taskkill /PID <pid> /T /F` on timeout (`self-hosted-ci-helpers.ps1:131-144`). The repo probe checks only `TimedOut`/`ExitCode`; the independent probe additionally started a child `ping`, and after the 2-second timeout the child PID was gone.
- Main-step failure still runs `finally`: the harness post-install smoke failure removed the installed app and wrote a FAILED manifest.
- Cleanup skipped without record: workflow cancellation, the 180-minute job timeout, runner service stop, machine reboot, or killing the PowerShell process can skip `finally`. The docs acknowledge the job-timeout case (`...matrix.md:35`) but not cancellation/reboot, and no manifest record exists in those cases (M3).

### 6.7 Redaction — PASS for required vectors, gaps remain

`Redact-Text`/`Test-RedactionResidual` (`self-hosted-ci-helpers.ps1:256-279`) were exercised with the required forms:

- `Authorization: Bearer <fake>` (header, and `Basic`);
- JSON `"authorization":"Bearer <fake>"`;
- `"apiKey":"FAKE VALUE WITH SPACES"`;
- `api_key=<fake>`, `token: <fake>`, `refresh_token=<fake>`, `"access_token":"<fake>"`, `x-api-key: <fake>`;
- `ghp_...`, `github_pat_...`, `sk-...`.

The sentinel was absent, `[REDACTED]` was present, benign text survived, the second pass reported 0 residuals, and the raw text was detected. The runner suppresses the offending step's log and blocks archiving when a residual is found (`run-self-hosted-ci.ps1:80-94,197-231`).

Gaps: `client_secret=...` and `password=...` are not redacted and are residual-clean (M1); `token: 'value'` (single quotes) is redacted to `token: '[REDACTED]` but the residual detector flags the leading quote, causing a fail-closed false positive that suppresses output and blocks archiving (LOW, observed). The regex approach is not a general secret scanner.

### 6.8 Evidence archive — PASS, with a nested-reparse gap

`Copy-ArchiveEvidence` (`self-hosted-ci-helpers.ps1:218-254`) enforces:

- source inside the allowed root (strict child or equal) — probe: outside source throws;
- only `LastWriteTimeUtc >= runStart` files — probe: stale-only source yields 0 entries; one fresh file yields 1;
- per-file `source`, `destination`, `size`, `sha256` — probe confirms all four fields and the hash;
- reparse chain on each enumerated file — source-root junction throws; a nested junction is silently skipped because PS 5.1 enumeration does not traverse it (M2);
- destination escape via the relative path — prevented by `Test-PathWithin`;
- name conflict with different content — throws; same content — skipped;
- empty array when nothing new — the missing-Node manifest shows `screenshots/results/transcripts` all 0.

`Get-FreshInstaller` (`self-hosted-ci-helpers.ps1:73-90`) rejects stale `release\Morrow-Setup-*.exe` files and records the fresh installer's name/size/SHA256; the probe confirms stale rejection and fresh selection. The screenshots selection in `run-self-hosted-ci.ps1:199-211` filters top-level reparse directories and requires at least one fresh file. No stale screenshot/result/installer can be archived under the timestamp rule; a file whose timestamp is artificially updated during the run would be included, which is inherent to timestamp-based freshness.

### 6.9 Manifest — PASS

The missing-Node run produced a valid UTF-8 (no BOM) manifest with:

```
status=FAILED
steps=0
cleanup=NOT_REQUIRED
redactionResidual=False
installation.target=<runDir>\installed-app
installation.installer=<null>
installation.installerSha256=<null>
installation.installExitCode=<null>
installation.installedExe=<null>
installation.installedExeSha256=<null>
evidence.screenshots=0
evidence.results=0
evidence.transcripts=0
bom=False
```

The success harness records a non-null `installerSha256` and `installedExeSha256`; the uninstall-failure harness records `cleanup.status=CLEANUP_FAILED`, `uninstallerExitCode=5`, and keeps `installed-app`. `status` is computed from the observed failure and cleanup status (`run-self-hosted-ci.ps1:278`), not pre-filled. The only caveat is the PS 5.1 default-encoding consumer issue (M6).

### 6.10 PowerShell 5.1 — FAIL (execution), PASS (parsing)

- Windows PowerShell version: `5.1.26100.9711`, `Desktop`.
- Parser: all three scripts `PARSE-OK` (exit 0).
- No `$IsWindows`, no `??`, no `??=`, no ternary operators found by fixed-string/regex scan.
- Probe suite: `passed=42 failed=0 total=42`, exit 0.
- The runner's step execution fails (B1): `Start-Process -PassThru -NoNewWindow` with redirection yields a null `ExitCode`, and `$null -ne 0` is true, so the first step throws. The missing-Node probe does not exercise a successful step; the 42 probes do not call `Invoke-CiStep`.

### 6.11 Workflow/security — PASS for gates; one LOW supply-chain note

Both YAML files parse (`python yaml.safe_load`, exit 0). `.github/workflows/self-hosted-ci.yml`:

- triggers: `workflow_dispatch` and tag push `ci-self-hosted-*` only; no `pull_request_target`, no `pull_request`;
- both jobs `runs-on: [self-hosted, Windows, X64, morrow-ci]`; no hosted fallback;
- no `upload-artifact`, no `continue-on-error`;
- `permissions: contents: read` (lines 14-15);
- guard requires repo `ve766/morrow-ai-companion-v2`, ref `refs/heads/feat/morrow-v2-final-closure` or tag `ci-self-hosted-*`, actor and triggering actor `ve766` (lines 26-31); the guard step enforces tag name == `ci-self-hosted-<GITHUB_SHA>` (lines 38-41); `verify` needs guard success (lines 51-52);
- checkout uses `ref: ${{ github.sha }}`, `fetch-depth: 1`, `persist-credentials: false` (lines 57-61);
- `MORROW_CI_EXPECTED_SHA` is passed to the script, which re-verifies `git rev-parse HEAD` (lines 77-81; `run-self-hosted-ci.ps1:10-14`);
- concurrency per ref, `cancel-in-progress: false` (lines 17-19);
- job timeout 180 minutes (line 54), which is the M3 residual.

`actions/checkout@v4` is a mutable tag, not a commit SHA (M5). The checked-out commit is exact, so the "exact-SHA checkout" intent is met for the repository content.

No new hosted run/artifact was created by this commit: `gh api actions/runs?head_sha=d7f7b70...` returns 0; `gh api actions/runners` returns 0. `gh api actions/artifacts` lists 35 historical artifacts (the first 10 shown were created 06:13-08:58Z on 2026-11-05 from earlier hosted `CI` runs with other SHAs); none can be associated with `d7f7b70` because that SHA has no run. The unchanged `ci.yml` still has hosted runners and `upload-artifact` (M10), but it is not part of this commit's path.

### 6.12 Docs honesty — PARTIAL/FAIL

Accurate: the docs consistently say PARTIAL/PENDING, not CI PASS (`...report.md:9,113`; `...evidence-index.md:5,79`; `...matrix.md:4,39`); they say no runner is registered and no real NSIS install/uninstall or self-hosted run exists (`...report.md:110-111`; `...evidence-index.md:70`; `...matrix.md:32-33`); the 42/42 probe count is real; the missing-Node manifest description is real; the PR #54 base and baseline parent are accurate.

Inaccurate or incomplete:

- The reviewed SHA is not stated; it is deferred to an Issue #57 comment that does not exist (`comments=0`) — M9/H2.
- The matrix claims full tests/typecheck PASS with that nonexistent comment as evidence — H2.
- The matrix says PS 5.1 "运行 PASS" although the runner cannot execute a step — B1/H2.
- The docs claim the install is isolated and no user installation is touched; B2/H1 contradict this — H2.
- The docs' residual-risk section mentions only the workflow timeout, not the installer's old-version uninstall, shortcut/registry side effects, cancellation/reboot, or redaction gaps.

### 6.13 Secret scan — PASS

`git diff 15a06e5..HEAD` was scanned for `gh[pousr]_...`, `github_pat_...`, `sk-...`, `AKIA...`, `-----BEGIN ... PRIVATE KEY-----`, `xox[abprs]-`, `AIza...`, `Bearer <20+ chars>`, and assignment-shaped `password|secret|api_key|token|...=16+ chars`. The only hit is the deliberate synthetic fixture `ghp_aaaaaaaaaaaaaaaaaaaaaaaa` in `scripts/ci/test-self-hosted-install-isolation.ps1:147`. No real credential was found. The audit did not print, store, or request any real secret.

### 6.14 Real run — ABSENT

No real NSIS install or uninstall was performed. No self-hosted run exists for `d7f7b70...`; `actions/runners total_count=0`; `actions/runs?head_sha=d7f7b70... total_count=0`. The only runner executions in this review were against a stubbed fake repo/installer under `.tmp`, the missing-Node probe against the real script (which fails before any step), and the wrong-`ExpectedSha` probe (which fails before creating an archive). The real install/uninstall and the real self-hosted run remain **PENDING_USER_ACTION**, exactly as the docs say.

## 7. Commands and real exit codes

| Command | Exit | Observed result |
| --- | --- | --- |
| `git rev-parse HEAD` | 0 | `d7f7b7039abac92b90e7560b80602985aff635ac` |
| `git log -1 --format='%H %P'` | 0 | `d7f7b703... 15a06e5f...` |
| `git status --porcelain` | 0 | empty before this review file |
| `git diff --stat 15a06e5..HEAD` | 0 | 8 files, 948 insertions(+), 106 deletions(-) |
| `git diff --name-status 15a06e5..HEAD` | 0 | only `scripts/ci/` and `docs/` |
| PS 5.1 parser on all three scripts | 0 | `PARSE-OK` x3 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1` | 0 | `passed=42 failed=0 total=42` |
| Adversarial probe (50 checks) | 1 | 46 PASS, 1 SKIP, 3 initial FAIL (2 probe-expectation errors, 1 real LOW gap: nested reparse) |
| Reparse probe | 0 | `recursive-file-count=0`, `chain-on-junction=True`, `copy-entries=0`, outside file intact |
| Direct `Start-Process` exit-code repro | 0 | `ExitCodeIsNull=True`, `null-ne-0=True` |
| Stubbed runner harness **without** the `-Wait` shim | 1 | first step `node-version` failed with an empty exit code |
| Stubbed runner harness **with** the `-Wait` shim | 0 | 5/5 scenarios pass (cleanup state machine) |
| `run-self-hosted-ci.ps1` with missing Node | 1 | manifest `status=FAILED`, `steps=0`, `cleanup=NOT_REQUIRED`, evidence arrays 0, no BOM |
| `run-self-hosted-ci.ps1` with wrong `-ExpectedSha` | 1 | SHA mismatch; no archive directory created |
| Extra probe: timeout tree + redaction | 0 | timeout child killed; required vectors redacted; `client_secret`/`password` not redacted |
| `python yaml.safe_load` both workflows | 0 | both parse |
| `gh api actions/runners` | 0 | `total_count=0` |
| `gh api actions/runs?head_sha=d7f7b70...` | 0 | `total_count=0` |
| `gh api actions/artifacts` | 0 | 35 historical artifacts, none from `d7f7b70...` |
| `gh api pulls/54` | 0 | open, head `d7f7b70...`, base `3812b18...` |
| `gh api issues/57` | 0 | open, `comments=0` |
| Secret scan of the diff | 0 | only the synthetic `ghp_aaaaaaaaaaaaaaaaaaaaaaaa` fixture |

## 8. Residual risks

1. **User installation destruction (B2)** if the workflow is run on a machine with a standard Morrow NSIS install. This is the dominant risk; do not run it there until the installer identity is isolated.
2. **Shortcut/registry modification (H1)** even with a distinct install directory.
3. **Runner non-functionality (B1)** — every step fails on Windows PowerShell 5.1; the path has never executed a successful step.
4. **Cleanup skipped on job cancellation/timeout/reboot (M3)** — a temporary install and registry/shortcut state can remain, with no manifest record.
5. **Redaction gaps (M1)** — `client_secret`, `password`, and other non-listed secret names pass through; the single-quote case causes a fail-closed false positive.
6. **Nested reparse silently skipped (M2)** — evidence can be omitted without a failure; no outside data is copied.
7. **Broken-symlink install target (M4)** — theoretical, requires symlink privilege and run-directory prediction.
8. **Mutable action tag (M5)** — `actions/checkout@v4` is not commit-pinned.
9. **Manifest encoding (M6)** — UTF-8 no BOM plus PS 5.1 default ANSI decoding can break naive consumers on non-UTF-8 locales.
10. **Version assertion unverified against a real packaged exe (M13)** — the local unpacked exe reports Electron 44.9.3; a real electron-builder resource patch is expected to set FileVersion `2.0.0`, but that has not been observed.
11. **Installer copy TOCTOU (M12)** — a local file replacement between selection and copy would be visible in `checksums.sha256` but not in the manifest's earlier `installerSha256`.
12. **Unchanged hosted `ci.yml` (M10)** — still contains the old default-location install and recursive `%LOCALAPPDATA%` scan; safe only because it runs on hosted `windows-latest`.

## 9. Conclusion

The implementation makes real progress on the **target-path** half of Issue #57: the install target is a strict, fresh child of the run directory; traversal, prefix-sibling, pre-existing target, runDir junction, intermediate junction, and dangling junction attempts are rejected; the NSIS `/S /D=` argument survives spaces intact; `Get-InstalledExecutable` is exact; process termination is exact-path; the cleanup helper is idempotent and fail-closed; the evidence archive is fresh-only and hash-recorded; the manifest is observation-based and BOM-free; and the workflow gates are sound.

It is nevertheless **not ready**:

- **B1 (BLOCKER):** `Invoke-CiStep` reads a null `ExitCode` on Windows PowerShell 5.1, so the runner fails at its first step and never reaches the install. The 42/42 probe suite and the missing-Node probe do not cover this path.
- **B2 (BLOCKER):** electron-builder's NSIS installer runs `uninstallOldVersion` against the shared per-user uninstall key before installing. On a machine with an existing standard Morrow installation, `/D=` does not prevent the user's installation from being silently uninstalled. This is the exact defect class Issue #57 is meant to remove.
- **H1:** shortcuts and uninstall registry keys are written/deleted outside the run directory even if B2 is avoided.
- **H2/H3:** the docs do not state the reviewed SHA, cite a nonexistent Issue #57 comment, overstate "PS 5.1 运行 PASS", and claim no user installation is touched; the probe suite does not test the runner's step loop or install/cleanup branches.

No real NSIS install or uninstall was performed, and no real self-hosted run exists (`actions/runners total_count=0`; no run for `d7f7b70...`). The docs' PARTIAL/PENDING status is honest about the absence of a real run, but not about the two blockers above.

**Recommendation: do not merge this CI path for operational use and do not run it on a user's machine.** Fix B1 with a reliable exit-code pattern that preserves per-step timeouts; isolate the CI installer's `appId`/GUID and disable shortcuts (or use a portable/zip target) to remove B2/H1; add a probe that executes a successful `Invoke-CiStep` and a test that a pre-existing HKCU installation is not touched; state the reviewed SHA exactly in the docs; and correct the "PS 5.1 运行 PASS" and "no user installation touched" claims.
