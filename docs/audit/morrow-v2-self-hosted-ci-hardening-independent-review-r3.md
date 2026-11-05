# Morrow V2 Self-Hosted CI Hardening — Independent Final Re-Review (R3, Issue #57)

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. The only repository write is this file. Throwaway probes were created only under `.tmp/` (gitignored) and removed. Nothing was staged, committed, tagged, pushed, or published. No `npm ci`, `npm install`, full test suite, `npm run build`, `npm run package:win`, NSIS installer, or Electron/Morrow launch was executed. Read-only `gh api` GETs were used.

Review date: 2026-11-05.

Prior reviews: `docs/audit/morrow-v2-self-hosted-ci-hardening-independent-review.md` (reviewed `d7f7b70`, found B1/B2) and `docs/audit/morrow-v2-self-hosted-ci-hardening-independent-review-r2.md` (reviewed `f92b132`, confirmed B1/B2 fixed by design and found N1, the shadowed CI artifact name).

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Branch | `feat/morrow-v2-final-closure` |
| Reviewed code-fix SHA | `ea5f9ab8082023f46a658106bd6accee2f2ed8b6` |
| Reviewed HEAD | `4428477a9f63862d3e3b83ca3ad706943b1b18c7` |
| HEAD parent | `ea5f9ab8082023f46a658106bd6accee2f2ed8b6` |
| Code-fix parent | `f92b1322cba776968aa4a033512308c1ee6f0a79` (R2 review SHA) |
| Commit subjects | `ea5f9ab` = `fix(ci): name the CI installer through win.artifactName`; `4428477` = `docs(ci): correct the probe count to 56` |
| Base | `release/morrow-v2-final-delivery` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, head `4428477...`, not merged |
| Issue | [#57](https://github.com/ve766/morrow-ai-companion-v2/issues/57), `OPEN`, `comments=0` at review time |
| `ea5f9ab..HEAD` | **docs only**: 3 docs files, 5 insertions(+), 5 deletions(-) |
| `f92b132..ea5f9ab` | 6 files: the R2 review file, 3 docs, `run-self-hosted-ci.ps1` (1 line), `test-self-hosted-install-isolation.ps1` (1 line) |
| Product runtime/schema/test changes | none |
| Worktree | clean before this review file; `.tmp/` ignored |
| Registered self-hosted runners | `0` (`actions/runners` total_count=0) |
| Workflow runs on `4428477` / `ea5f9ab` | `0` / `0` (`actions/runs?head_sha=...` total_count=0) |
| Artifacts | 35 historical, newest 08:58Z from other SHAs; none from `4428477` or `ea5f9ab` |
| Real NSIS install/uninstall | **not performed** |
| Real self-hosted run | **none** |

The HEAD is docs-only; all executable behavior under review is at `ea5f9ab`. The R2 review file was committed in `ea5f9ab`; it reviewed `f92b132`, not the N1 fix.

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall** | **PARTIAL / PENDING_USER_ACTION — no remaining blocker found in code/static review; real NSIS install/uninstall and real self-hosted run are absent** |
| N1 — CI installer artifact name | **FIXED — verified** |
| B1 — PS 5.1 step exit code | **FIXED — remains fixed and verified** |
| B2 — NSIS old-version uninstall | **FIXED by design/static evidence — the CI variant cannot match the user's original appId/GUID; now reachable because N1 is fixed** |
| H1 — writes outside `<runDir>` | **RESOLVED for shortcuts; residual unique-GUID HKCU keys are acceptable residual** |
| H2 — docs honesty | **PARTIALLY FIXED** — 56 count and PENDING status are correct; reviewed SHA still deferred to a nonexistent Issue #57 comment; evidence-index line 51 and the manifest example are stale; test numbers author-asserted |
| H3 — probe coverage | **PARTIALLY FIXED** — 56 probes include the static artifact-name guard; step loop, install/cleanup state machine, and real NSIS orchestration are still not covered by the repo probes (the step loop was verified only by an independent probe) |
| MEDIUM — redaction/junction fixes | **FIXED** |
| MEDIUM — workflow-timeout `finally` | **DOCUMENTED residual** |
| MEDIUM — checkout commit pinning | **RESIDUAL (LOW)** — `actions/checkout@v4` is a mutable tag |
| Static checks | **PASS** |
| Real NSIS install/uninstall | **ABSENT / PENDING_USER_ACTION** |
| Real self-hosted run | **ABSENT / PENDING_USER_ACTION** — 0 runners, 0 runs |

**No remaining blocker was found.** The R2 N1 blocker is fixed: the CI build now uses `-c.win.artifactName`, which overrides `build.win.artifactName`, and the effective CI installer name matches the runner's `Morrow-CI-Setup-*.exe` glob. The overall status remains **PARTIAL / PENDING_USER_ACTION** solely because no real NSIS install/uninstall and no real self-hosted run exist; this is not COMPLETE and not CI PASS.

## 2. N1 — FIXED and verified

### 2.1 The one-line fix

`git diff f92b132..ea5f9ab -- scripts/ci/run-self-hosted-ci.ps1` shows exactly:

```
-    '-c.artifactName=Morrow-CI-Setup-${version}-${arch}.${ext}',
+    '-c.win.artifactName=Morrow-CI-Setup-${version}-${arch}.${ext}',
```

at `scripts/ci/run-self-hosted-ci.ps1:139`. The R2 defect was that the top-level `-c.artifactName` was shadowed by `package.json:72` `build.win.artifactName = "Morrow-Setup-${version}-${arch}.${ext}"` because `PlatformPackager.artifactPatternConfig` prefers `platformSpecificBuildOptions.artifactName` over `config.artifactName` (`node_modules/app-builder-lib/out/platformPackager.js:551-557`). Passing the override at the same `win` level removes the shadowing.

### 2.2 Effective-config simulation

Using the pinned `electron-builder` CLI (`createYargs` + `configureBuildCommand` + `normalizeOptions`) and `deepAssign` over the current `package.json` `build` config:

```
cli-win-artifactName=Morrow-CI-Setup-${version}-${arch}.${ext}
merged-win-artifactName=Morrow-CI-Setup-${version}-${arch}.${ext}
effective-pattern=Morrow-CI-Setup-${version}-${arch}.${ext}
effective-ci-installer=Morrow-CI-Setup-2.0.0-x64.exe
runner-glob-matches=true
shortcuts=false/false oneClick=false perMachine=false allowDir=true
output=release-ci guid=3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c appId=com.morrow.ai-companion.ci
```

The effective name now matches `Get-FreshInstaller -RelativeDirectory 'release-ci' -Pattern 'Morrow-CI-Setup-*.exe'` (`run-self-hosted-ci.ps1:142`). The other CI-build overrides are intact: unique `appId`, unique `nsis.guid`, desktop/start-menu shortcuts disabled, `runAfterFinish=false`, output `release-ci`, and the package's `oneClick=false`/`perMachine=false`/`allowToChangeInstallationDirectory=true` survive the deep merge.

### 2.3 New regression probe

`scripts/ci/test-self-hosted-install-isolation.ps1:239` adds:

```powershell
Assert-True 'runner-ci-artifact-name-wins' ($runnerText -match '-c\.win\.artifactName=Morrow-CI-Setup-') 'win.artifactName overrides build.win.artifactName'
```

Official suite result: `probe summary: passed=56 failed=0 total=56`, exit 0; `runner-ci-artifact-name-wins` PASS.

The probe is a text grep of the runner. It would catch a revert to `-c.artifactName`, but it would not catch a future electron-builder precedence change; for the pinned 26.15.3 the effective-config simulation above covers that, and a real build/install test remains PENDING_USER_ACTION.

**N1 status: FIXED.** The CI variant is now produced under the name the runner searches for, so the runner can reach the process-check gate and the isolated install.

## 3. B1 — remains FIXED

- `Invoke-CapturedProcess` (`scripts/ci/self-hosted-ci-helpers.ps1:154-193`) still uses `System.Diagnostics.Process` with redirected streams, `WaitForExit(ms)`, the parameterless `WaitForExit()`, then `$process.ExitCode` (line 189).
- `Invoke-CiStep` (`scripts/ci/run-self-hosted-ci.ps1:53-95`) still delegates to `Invoke-CapturedProcess` (lines 60-64), reads `$captured.ExitCode` (line 64), and contains no `Start-Process`.
- Official 56-probe suite: `captured-process-exit-code` (exit 0), `captured-process-nonzero` (exit 7), `captured-process-timeout` (`TimedOut=True`, null exit) all PASS.
- Independent R3 probe (9/9 PASS, exit 0): `node.exe --version` exit 0; `cmd /d /s /c "exit 7"` exit 7; 1-second timeout `TimedOut=True` and null exit; the extracted real `Invoke-CiStep` ran a successful step (exit 0, log written) and threw `Step 'exit-seven' failed with exit code 7` with the recorded exit code 7.
- The N1 fix touched only the `npx electron-builder` argument list; it did not change the step runner.

**B1 status: FIXED, no regression.**

## 4. B2 — remains FIXED by design

### 4.1 Runner configuration unchanged except the artifact name

`scripts/ci/run-self-hosted-ci.ps1:132-141` still builds the CI variant with:

- `-c.appId=com.morrow.ai-companion.ci`
- `-c.nsis.guid=3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c`
- `-c.nsis.createDesktopShortcut=false`
- `-c.nsis.createStartMenuShortcut=false`
- `-c.nsis.runAfterFinish=false`
- `-c.win.artifactName=Morrow-CI-Setup-${version}-${arch}.${ext}` (the N1 fix)
- `-c.directories.output=release-ci`

The deep-merge simulation confirms `oneClick=false`, `perMachine=false`, `allowToChangeInstallationDirectory=true`, shortcuts `false/false`, `guid=3f2b8c1e-...`, `output=release-ci`.

### 4.2 Template chain (unchanged, pinned electron-builder 26.15.3)

- `NsisTarget.js:157`: `guid = options.guid || UUID.v5(appInfo.id, ELECTRON_BUILDER_NS_UUID)`.
- `multiUser.nsh:8-9`: `INSTALL_REGISTRY_KEY "Software\${APP_GUID}"`; `UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"`.
- `allowOnlyOneInstallerInstance.nsh:14`: the installer mutex is `CreateMutex(..., t"${APP_GUID}")`.
- `installSection.nsh:52`: `uninstallOldVersion` is called before installing.
- `installUtil.nsh:155-176`: `uninstallOldVersion` reads `UninstallString`/`InstallLocation` from those GUID-derived keys; `:210-224` copies and runs the old uninstaller.
- `NsisTarget.js:474-482`: `DO_NOT_CREATE_DESKTOP_SHORTCUT` and `DO_NOT_CREATE_START_MENU_SHORTCUT` are defined, and they guard both creation (`include/installer.nsh:190-240`) and deletion (`uninstaller.nsh:193-205`).

The original appId's deterministic UUID v5 (`92ffd461-...`) differs from the CI GUID `3f2b8c1e-...`; the CI appId's derived GUID (`9b063060-...`) is overridden by the explicit `nsis.guid`. Therefore `uninstallOldVersion` cannot find the user's original uninstall key, the mutex is distinct, and the shortcut creation/deletion code is compiled out.

### 4.3 Release installer still never executed

`npm run package:win` remains `npm run build && electron-builder --win nsis --x64 --publish never` (build only). The runner selects the release installer at line 126, and `$releaseInstaller` is used only at lines 231-234 (copy + SHA256), 267-268 (manifest), and 301 (README). `Invoke-IsolatedInstall` is called only with `$installer.FullName` from `release-ci` (line 149). No code path executes the release installer.

### 4.4 Process-check gate still before install

`run-self-hosted-ci.ps1:144-146` still calls `Test-NsisProcessCheckAvailable` before `Assert-IsolatedInstallTarget` (line 147) and `Invoke-IsolatedInstall` (line 149). The gate refuses to install when PowerShell/`Get-CimInstance` is unavailable or the process-scope policy is `Restricted`, preventing the NSIS fallback to name-based `taskkill /IM Morrow.exe` (`allowOnlyOneInstallerInstance.nsh:81-100`). The logical conditions match `IS_POWERSHELL_AVAILABLE` (`:45-58`), with the same two LOW parity caveats noted in R2 (`-NoProfile` and PATH `powershell.exe` vs `$SYSDIR` with profile).

### 4.5 Answer to the B2 question

A user's existing Morrow with the original appId/GUID **cannot be matched, uninstalled, or have its shortcuts/registry keys rewritten by the CI variant**. The install target is a fresh child of `<runDir>`, shortcuts are disabled in both creation and deletion, the registry keys and mutex are keyed by the unique CI GUID, and the process check filters by `$INSTDIR` with a gate against the name-based fallback. The only theoretical exception is a pre-existing tampered HKCU key at the CI GUID pointing at the user's installation, which requires local registry write access and is out of scope.

**B2 status: FIXED by design/static evidence; now operationally reachable because N1 is fixed.** The real NSIS install/uninstall remains unexecuted.

## 5. H1 — shortcuts resolved; residual unique-GUID registry keys

The CI variant still writes outside `<runDir>`:

- `HKCU\Software\3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c` with `InstallLocation`, `KeepShortcuts`, `ShortcutName` (`include/installer.nsh:104-108`). `MENU_FILENAME` is not defined because `menuCategory` is not set.
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c` with `DisplayName` (`Morrow 2.0.0`), `UninstallString`, `QuietUninstallString`, `DisplayVersion`, `DisplayIcon`, `Publisher` (if set), `NoModify`, `NoRepair`, `EstimatedSize` (`include/installer.nsh:119-167`).

These keys are unique to the CI GUID, cannot collide with the user's original keys, and are deleted by the uninstaller (`uninstaller.nsh:250-254`). No shortcuts are created or deleted; no file associations are configured. The residual is a temporary second `Morrow 2.0.0` entry in Apps & Features during the run, and stale CI-only keys if cleanup fails. Neither modifies or removes the user's installation. **Acceptable residual risk, not a blocker.** The docs do not mention these residual keys; minor documentation gap.

## 6. H2 — docs honesty: partially fixed

Accurate now:

- The probe count is 56 in the report (`report.md:123`), matrix (`matrix.md:32`), and evidence index (`evidence-index.md:13,24,53`); the real run is 56/56, exit 0.
- The status is `PARTIAL / PENDING_USER_ACTION`, not COMPLETE and not CI PASS (`report.md:9,132`; `evidence-index.md:5,87`; `matrix.md:4,43`).
- No registered runner is claimed: `report.md:130` and `matrix.md:36-37` say `actions/runners=0` / `BLOCKED_RUNNER_NOT_REGISTERED`; the real API returns 0.
- No real NSIS install/uninstall or self-hosted run is claimed; both are PENDING_USER_ACTION (`report.md:61,130-132`; `evidence-index.md:78`; `matrix.md:36-37`).
- The docs now document the `win.artifactName` fix (`report.md:56`) and the new probe (`matrix.md:16`, row 7b2).

Remaining doc issues (not blockers):

- **The reviewed SHA is still not stated.** `report.md:8` and `evidence-index.md:4` still say the full SHA and parent are "以 Issue #57 comment 为准" (per the Issue #57 comment), but Issue #57 has `comments=0`. The review file is the authoritative SHA record: code fix `ea5f9ab8082023f46a658106bd6accee2f2ed8b6`, docs-only HEAD `4428477a9f63862d3e3b83ca3ad706943b1b18c7`.
- `evidence-index.md:51` still says the full test/typecheck results are in the Issue #57 comment ("结果见 Issue #57 comment；本文件不预填未执行的结果"), a dangling reference that also contradicts the report/matrix numbers.
- The test numbers `129 files / 1156 tests passed` are author-asserted. This review did not run the suite (prohibited). They are consistent with the prior run on the unchanged product code (`fad6a94` is an ancestor; `git diff --name-only fad6a94..HEAD` has no `src/` or `tests/` change), but they are not independently verified here.
- `report.md:81-103` still shows a stale manifest example with `installer: "Morrow-Setup-2.0.0-x64.exe"` and no `releaseInstaller`/`releaseInstallerSha256`, contradicting `report.md:59` and the actual runner manifest fields.
- `matrix.md:32` says "PowerShell 5.1 解析与运行 PASS" citing the 56 probes; the 56 probes do not call `Invoke-CiStep`. The full step loop is verified only by this review's independent probe.

No CI PASS or registered-runner claim was found; the honest PARTIAL/PENDING status is intact.

## 7. H3 — probe coverage: partially fixed

The 56 probes now include the static `runner-ci-artifact-name-wins` guard for N1, plus the prior `captured-process-*`, argument quoting, install-target isolation, junctions, cleanup helpers, uninstaller discovery, redaction, evidence, installer selection, and exact-exe lookup. They still do **not**:

- call `Invoke-CiStep` or exercise the runner's step loop (the missing-Node probe fails before any step, `steps=0`);
- exercise the post-install `finally` cleanup branches or the install/cleanup state machine;
- build or install any NSIS installer;
- assert the effective artifact name through a real build (the new probe is a text grep; the effective-config simulation in this review covers the pinned version);
- exercise the NSIS process-check gate on a host where PowerShell/`Get-CimInstance` is unavailable.

This review's independent probe extracted the real `Invoke-CiStep` and verified success/non-zero (9/9 PASS), so the B1-specific step-loop gap is covered for this review. The install/cleanup state machine and real NSIS orchestration remain untested; `matrix.md:24` item 14 is still code-review + missing-Node, and item 7b is static/PENDING.

## 8. MEDIUM items

| ID | Item | Status |
| --- | --- | --- |
| M1 | `client_secret`/`password`/`secret` redaction and second-pass scan | **FIXED.** `Redact-Text`/`Test-RedactionResidual` include `client_secret`, `password`, `passwd`, `secret` (`self-hosted-ci-helpers.ps1:325-326,336`). Official probe `redaction-*` 6/6 PASS. Other secret names (`private_key`, AWS `AKIA...`, etc.) remain out of scope; this is a regex filter, not a general secret scanner. |
| M2 | Nested evidence junctions silently skipped | **FIXED.** `Copy-ArchiveEvidence` enumerates all children recursively and throws on any reparse point (`self-hosted-ci-helpers.ps1:285-289`); probe `evidence-nested-junction-rejected` PASS. |
| M2b | Dangling junction/symlink install target | **FIXED for dangling junctions.** `Assert-IsolatedInstallTarget`/`Test-ReparsePointChain` use `Get-Item -Force` instead of `Test-Path` (`self-hosted-ci-helpers.ps1:31-34,53-59`); probe `dangling-junction-target-rejected` PASS. A dangling **symlink** could not be created on this host (`mklink /D` requires admin/developer mode), so that case is unverified; the `Get-Item` change is directionally correct. LOW residual. |
| M3 | Workflow cancellation/job timeout can skip `finally` | **DOCUMENTED residual.** `report.md:116` and `matrix.md:28` record the 180-minute job timeout; cancellation/runner stop/reboot are the same class but are not separately listed. No manifest is written in those cases. |
| M5 | Checkout not commit-pinned | **REMAINS LOW.** `.github/workflows/self-hosted-ci.yml:57-61` still uses `actions/checkout@v4` (mutable tag), with `ref: ${{ github.sha }}`, `fetch-depth: 1`, `persist-credentials: false`; the runner re-verifies `git rev-parse HEAD` (`run-self-hosted-ci.ps1:11-14`). The content commit is exact; the action itself is not immutable. |
| — | `Invoke-CapturedProcess` `.cmd` wrapper quoting | **LOW latent.** The wrapper uses `/d /s /c "<exe> <args>"`; with `/s`, an absolute `.cmd` path containing spaces is split and fails. The runner only passes bare `npm.cmd`/`npx.cmd`, which resolve via PATH and work. |
| — | `Invoke-ProcessWithTimeout` exit code | **FIXED.** Parameterless `WaitForExit()` before `ExitCode` (`self-hosted-ci-helpers.ps1:147-149`); official probe `raw-argument-exit-code` (exit 3) and `uninstall-exit-code` (exit 5) PASS. |

## 9. Commands and real exit codes

| Command | Exit | Observed result |
| --- | --- | --- |
| `git rev-parse HEAD` | 0 | `4428477a9f63862d3e3b83ca3ad706943b1b18c7` |
| `git rev-parse HEAD^` | 0 | `ea5f9ab8082023f46a658106bd6accee2f2ed8b6` |
| `git status --porcelain` | 0 | empty before this review file |
| `git diff --stat ea5f9ab..HEAD` | 0 | 3 docs files, 5 insertions(+), 5 deletions(-) — docs only |
| `git diff --name-status ea5f9ab..HEAD` | 0 | only `docs/reports/*` and `docs/testing/*` |
| `git diff --stat f92b132..ea5f9ab` | 0 | 6 files, 287 insertions(+), 2 deletions(-) |
| `git diff --name-status f92b132..ea5f9ab` | 0 | R2 review, 3 docs, `run-self-hosted-ci.ps1`, `test-self-hosted-install-isolation.ps1` |
| `git diff --stat f92b132..HEAD` | 0 | 6 files, 291 insertions(+), 6 deletions(-) |
| `git diff f92b132..ea5f9ab -- scripts/ci/run-self-hosted-ci.ps1` | 0 | `-c.artifactName` → `-c.win.artifactName` (one line) |
| `git diff f92b132..ea5f9ab -- scripts/ci/test-self-hosted-install-isolation.ps1` | 0 | adds `runner-ci-artifact-name-wins` (one line) |
| Effective-config simulation (pinned electron-builder) | 0 | effective CI installer `Morrow-CI-Setup-2.0.0-x64.exe`; glob matches true; shortcuts false/false; oneClick false; perMachine false; allowDir true; output `release-ci`; guid set; appId set |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1` | 0 | `passed=56 failed=0 total=56`; `runner-ci-artifact-name-wins` PASS |
| Independent B1 probe | 0 | 9/9 PASS (node 0; exit 7; timeout null; real `Invoke-CiStep` success + non-zero) |
| PS 5.1 parser on all three scripts | 0 | `PARSE-OK` x3 |
| `node -e` YAML parse both workflows | 0 | `YAML-OK` for `ci.yml` and `self-hosted-ci.yml` |
| `run-self-hosted-ci.ps1` with wrong `-ExpectedSha` | 1 | `Checkout SHA mismatch`; no archive directory created |
| `git diff --check f92b132..HEAD` | 0 | no whitespace errors |
| `git diff --check ea5f9ab..HEAD` | 0 | no whitespace errors |
| Secret scan of `git diff f92b132..HEAD` | 0 | 0 hits (no token, key, private key, Bearer, or assignment-shaped secret in the incremental diff) |
| `gh api actions/runners` | 0 | `total_count=0` |
| `gh api actions/runs?head_sha=4428477...` | 0 | `total_count=0` |
| `gh api actions/runs?head_sha=ea5f9ab...` | 0 | `total_count=0` |
| `gh api actions/artifacts` | 0 | 35 historical artifacts, newest 08:58Z from other SHAs; none from `4428477` or `ea5f9ab` |
| `gh api issues/57` | 0 | open, `comments=0` |
| `gh api pulls/54` | 0 | open, head `4428477...`, base `release/morrow-v2-final-delivery` |

## 10. Residual risks

1. **No real NSIS install/uninstall:** all B2 evidence is static from the pinned electron-builder templates and configuration. The real installer behavior (registry keys, mutex, uninstaller, process check) has not been executed on this host or any runner.
2. **No real self-hosted run:** `actions/runners=0`; 0 runs on `4428477` and `ea5f9ab`; no artifact from either SHA. Acceptance remains PENDING_USER_ACTION.
3. **Residual HKCU keys outside `<runDir>`:** the CI variant writes/removes unique-GUID keys (`Software\3f2b8c1e-...` and its Uninstall entry). Cleanup failure leaves stale CI-only keys; a temporary duplicate `Morrow 2.0.0` Apps & Features entry can appear. No user installation data is modified.
4. **Process-check parity gap:** `Test-NsisProcessCheckAvailable` uses `-NoProfile` and PATH `powershell.exe`; NSIS uses `$SYSDIR` PowerShell with the profile. A profile that sets process-scope `Restricted`, or PATH shadowing, could theoretically let the gate pass while NSIS falls back to name-based `taskkill`. LOW.
5. **`finally` can be skipped:** workflow cancellation, the 180-minute job timeout, runner service stop, or reboot can kill the process; no manifest/cleanup record is written. Documented as residual; cancellation/reboot are not separately listed.
6. **Coverage gap:** the 56 probes do not call `Invoke-CiStep`, do not exercise the install/cleanup state machine, and do not build/install NSIS. The step loop was verified only by this review's independent probe; real NSIS orchestration remains untested.
7. **N1 probe is static:** `runner-ci-artifact-name-wins` greps the command line; the effective artifact name is verified by simulation for the pinned electron-builder version, not by a real build.
8. **Docs:** the reviewed SHA is still deferred to the nonexistent Issue #57 comment; `evidence-index.md:51` is dangling; the manifest example is stale; the test numbers are author-asserted.
9. **Checkout action is a mutable tag:** `actions/checkout@v4`, though the checked-out commit is exact and re-verified.
10. **`.cmd` wrapper latent quoting:** absolute `.cmd` paths with spaces fail; current runner calls use bare `npm.cmd`/`npx.cmd` and are safe.
11. **Dangling symlink target:** unverified because creation requires admin/developer mode; the `Get-Item` change likely closes it.
12. **Redaction is regex-based:** `client_secret`/`password`/`secret` are covered, but other secret names and formats are out of scope.
13. **Fixed CI GUID:** all CI runs share the same identity. A single runner executes one job at a time, so concurrent installs are not expected; a stale CI install (cleanup failure) may be uninstalled by a later CI run. This is the CI's own identity, not the user's installation.

## 11. Conclusion

- **N1 is fixed.** The CI build now passes `-c.win.artifactName=Morrow-CI-Setup-...`, which overrides `build.win.artifactName`; the effective artifact is `release-ci\Morrow-CI-Setup-2.0.0-x64.exe`, matching the runner's `Get-FreshInstaller` glob. The official 56-probe suite passes, including the new `runner-ci-artifact-name-wins` guard.
- **B1 remains fixed.** `Invoke-CapturedProcess` uses `System.Diagnostics.Process` and real `ExitCode`; `Invoke-CiStep` delegates to it and contains no `Start-Process`; the independent 9/9 probe confirms 0/7/timeout and the real step loop.
- **B2 remains fixed by design.** The CI variant uses a unique `appId` and explicit unique GUID, disables desktop/start-menu shortcuts (creation and deletion compiled out), installs into a fresh `<runDir>` child, and the release installer is only hashed/copied, never executed. A user's existing Morrow with the original appId/GUID cannot be matched or uninstalled by the CI variant. The process-check gate refuses the name-based `taskkill` fallback under the same logical conditions as NSIS (two LOW parity caveats).
- **H1** is resolved for shortcuts; the residual unique-GUID HKCU keys are acceptable residual, not a blocker.
- **H2/H3** are partially fixed: the 56 count and PENDING status are honest, but the reviewed SHA is still deferred to a nonexistent Issue #57 comment, `evidence-index.md:51` and the manifest example are stale, the test numbers are author-asserted, and the 56 probes still do not cover the step loop, install/cleanup state machine, or real NSIS orchestration.
- **No remaining blocker was found in code/static review.** The overall status remains **PARTIAL / PENDING_USER_ACTION** because no real NSIS install/uninstall and no real self-hosted run exist. This is not COMPLETE and not CI PASS.

**Recommendation:** register a runner and run the workflow on the final SHA on a dedicated VM/user; capture the real `installation`/`cleanup`/`evidence` manifest; optionally add a real-build artifact-name assertion; state the reviewed SHA `ea5f9ab8082023f46a658106bd6accee2f2ed8b6` (HEAD `4428477a9f63862d3e3b83ca3ad706943b1b18c7`) in the report/evidence index or post the Issue #57 comment; update `evidence-index.md:51` and the stale manifest example. Until the real run exists, the acceptance status should stay PARTIAL / PENDING_USER_ACTION.
