# Morrow V2 Final Software Delivery — Independent Review (Issue #59)

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. The only repository write is this file. Throwaway probes were created only under `.tmp/` (gitignored) and removed. Nothing was staged, committed, tagged, pushed, or published. No `npm ci`, `npm install`, full test suite, `npm run build`, `npm run package:win`, NSIS installer, or user-facing installer was executed. Read-only `gh api` GETs were used. No API key, token, or secret is reproduced here; `.tmp/spark.key` was not read.

Review date: 2026-11-06.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Branch | `feat/morrow-v2-final-closure` |
| **Reviewed HEAD (exact)** | **`f209d5899bbc5b5aa979cb28faf5461527ebb48b`** |
| Parent | `1acd646227f7c7fa63ea041d49c52085ea0eba2f` |
| Commit subject / time | `feat(ci): generate a per-run NSIS identity and record final delivery evidence` / `2026-11-06T13:46:59+08:00` |
| Base (PR API) | `release/morrow-v2-final-delivery` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, `merged=false`, head `f209d5899bbc5b5aa979cb28faf5461527ebb48b` |
| Diff `1acd646..HEAD` | 11 files, +485 / -54: `.gitignore`, 7 docs, 3 `scripts/ci` files |
| Product runtime / schema / test changes | **none** — no `src/`, `tests/`, `package.json`, lockfile, schema, or workflow change |
| Worktree before this file | clean (`git status --porcelain` empty) |
| Registered self-hosted runners | `0` (`actions/runners` `total_count=0`) |
| Workflow runs on reviewed SHA | `0` (`actions/runs?head_sha=f209d58...` `total_count=0`) |
| Artifacts on reviewed SHA | `0` (35 historical artifacts exist from other SHAs; none matched `f209d58...`) |
| Real NSIS install / launch / uninstall | **not performed** |
| Real self-hosted run | **none** |

The reviewed commit is 20 minutes after the last package attempt recorded in `.tmp` (`ci14`, 13:26, which failed before NSIS at the Node module collector) and 41 minutes after the last NSIS-stage attempt (`ci13`, 13:05). No log shows the new `Get-CiInstallerArguments` output ever being passed to electron-builder. This matters for finding F1.

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall** | **PARTIAL — BLOCKER F1 on the self-hosted CI packaging path; not COMPLETE and not CI PASS** |
| Dynamic identity generation | **PASS** — `New-CiInstallerIdentity` calls `[guid]::NewGuid()` per call; 50/50 unique and valid; CI appId `com.morrow.ai-companion.ci` differs from user appId |
| Dynamic identity actually compiled into an installer | **FAIL / BLOCKED** — no CI variant installer was ever produced; F1 makes the new invocation fail before the build even on a healthy runner |
| Cross-run archive immutability | **PASS** — bundled 107-probe suite plus an independent repeat: Run A `CLEANUP_FAILED` bytes/hash/length/mtime (including hidden) unchanged after Run B |
| Official user NSIS installer build | **PASS (artifact only; not executed)** — `release\Morrow-Setup-2.0.0-x64.exe`, 111,771,999 bytes, SHA256 `5aeb4027...`, real PE32 NSIS archive |
| CI NSIS variant build | **FAIL** — no `release-ci` installer; deterministic argv bug F1 plus the documented host block |
| Install / launch / uninstall acceptance | **NOT RUN / PENDING_USER_ACTION** |
| Electron host block | **CONFIRMED** — minimal Electron app exits `0xC0000005` (3221225477); `electron.exe --version` raw status `0x80000003` (shell exit 3) |
| Product regression | **AUTHOR-ASSERTED, NOT RERUN** — prohibited by review constraints; no product code changed in this diff |
| Provider evidence | **PASS (evidence integrity)** — sanitized 200/67-token and 400/10404 files; authenticity not re-requested (no Provider network requests) |
| Docs honesty | **PARTIAL** — acceptance status is honest (no install/launch/uninstall PASS; PARTIAL); the `Morrow CI` shortcut-isolation claim is false (F2) |
| Self-hosted workflow run | **PENDING_USER_ACTION** — 0 runners; no run and no artifact on the reviewed SHA |
| Workflow / security (static) | **PASS** — guard, self-hosted labels, no hosted fallback, no artifact upload in the self-hosted workflow, no `pull_request_target` |
| Secret scan | **PASS** — no credential-shaped value in the diff, new docs, or provider evidence files |

## 2. Findings

### F1 — BLOCKER (code): the unquoted `Morrow CI` argument is split; the CI package step fails with `Unknown argument: CI`

`Get-CiInstallerArguments` returns one array element containing a space:

- `scripts/ci/self-hosted-ci-helpers.ps1:353` — `'-c.nsis.shortcutName=Morrow CI'`
- `scripts/ci/run-self-hosted-ci.ps1:153` — passed to `Invoke-CiStep 'windows-nsis-ci-package' 'npx.cmd' ...`
- `scripts/ci/self-hosted-ci-helpers.ps1:156` — `Invoke-CapturedProcess` joins all arguments with `' '`
- `scripts/ci/self-hosted-ci-helpers.ps1:159` — only the `.cmd` executable path is wrapped; the joined argument string is not quoted

Because `npx.cmd` forwards `%*` verbatim to Node, electron-builder receives two tokens, not one:

```
NODEARG=[-c.nsis.shortcutName=Morrow]
NODEARG=[CI]
```

I reproduced this by dot-sourcing the reviewed helper and passing the exact `Get-CiInstallerArguments` output through `Invoke-CapturedProcess` to a `.cmd` stub that forwards `%*` to a Node script. The stub exited 0 and printed the split above. A second probe loaded the reviewed `configureBuildCommand` and electron-builder's `.strict()` parser with the same split argv; it printed `Unknown argument: CI` and exited 1 (`node_modules/electron-builder/out/cli/cli.js:32` uses `.strict()`).

Impact:

- On any healthy self-hosted runner, `windows-nsis-ci-package` fails at CLI parsing before packaging. The pending self-hosted run cannot pass as written.
- If a future CLI tolerated the stray positional, `shortcutName` would be `Morrow`, not `Morrow CI`. `package.json:78-79` keeps `createDesktopShortcut` and `createStartMenuShortcut` true, and electron-builder's NSIS templates create/delete `$DESKTOP\Morrow.lnk` and the Start Menu shortcut by `SHORTCUT_NAME` (`node_modules/app-builder-lib/templates/nsis/common.nsh:93,104,106`, `uninstaller.nsh:195,201`). The CI variant would then overwrite the user's `Morrow.lnk` on install and delete it on uninstall — exactly the user-side effect the old shortcut-disable options were avoiding.
- The `107/107` probe suite does not catch this: `scripts/ci/test-self-hosted-install-isolation.ps1:415-417` checks the returned array/string, not the argv that reaches the child process.

This is a host-independent defect introduced by this commit, not the documented host/security-software block. The fix should quote each argument (or the whole token) before it reaches `cmd.exe`, and add a forwarding-stub probe that asserts one `-c.nsis.shortcutName=Morrow CI` token and no stray `CI`.

### F2 — HIGH (docs/validation): the new "fix" was never built, and the documented root cause is contradicted by the evidence

- The commit is at 13:46; the last NSIS build attempts (`ci10`–`ci13`, 12:55–13:05) all failed with `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`; `ci14` (13:26) failed earlier at the Node module collector. No successful build with the new `shortcutName` argument is recorded, and no `release-ci` installer exists.
- `ci12` (13:02) used `.tmp/electron-builder-ci.json` with `createDesktopShortcut=true`, `createStartMenuShortcut=true`, `shortcutName: "Morrow CI"`, a unique GUID and `release-ci12` output — and still failed at the NSIS step. That directly contradicts the implication in `docs/reports/morrow-v2-final-software-delivery-report.md:31` that removing the shortcut-disable options is the fix.
- The docs themselves state that any CLI override, any different output directory, and any different artifact name fail on this host (`docs/reports/morrow-v2-final-software-delivery-report.md:28`, `docs/reports/morrow-v2-final-software-delivery-evidence-index.md:51-54`, `docs/install/windows-troubleshooting.md:44-46`). The CI variant still passes many CLI overrides and a different output directory/name, so the new invocation is not validated even ignoring F1.
- The docs do mark acceptance row 9 as `PENDING_USER_ACTION` (`docs/testing/morrow-v2-final-software-acceptance-matrix.md:23`); that is honest. The false part is the stronger claim that the replacement shortcut name avoids the user `Morrow` shortcut: `docs/reports/morrow-v2-final-software-delivery-report.md:31`, `docs/ci/ci-no-billing-operations.md:47`, `docs/ci/self-hosted-runner-setup-windows.md:87`, `docs/reports/morrow-v2-final-software-delivery-evidence-index.md:55`, `docs/install/windows-troubleshooting.md:51`.

### F3 — MEDIUM (test coverage): 107/107 is real but blind to process-level argv

I reran `scripts/ci/test-self-hosted-install-isolation.ps1`: `passed=107 failed=0 total=107`, exit 0, and all 107 declared probe names executed exactly once. That result is valid for what it tests. However:

- `ci-args-dynamic-guid` and `ci-args-no-fixed-guid` inspect the helper's returned array, not the actual child argv.
- No probe asserts the `shortcutName` value at all.
- No probe exercises `Invoke-CapturedProcess` with an argument containing a space, even though the new code introduces exactly such an argument.

The suite therefore gives false confidence for the integration it is meant to protect. Add one forwarding-stub probe for the full argument vector; it would have failed with F1.

### F4 — LOW (docs precision / test robustness)

- `docs/reports/morrow-v2-final-software-delivery-report.md:37` says `manifest` and `run-identity.json` record `runId`, `ciAppId`, `nsisGuid`, `installerSha256`. Actually `run-identity.json` uses `ciNsisGuid` and has no `installerSha256` at write time; `run-manifest.json` uses `nsisGuid` and records `installation.installerSha256` (`scripts/ci/run-self-hosted-ci.ps1:27-30, 291-328`).
- `electron.exe --version` is documented as "exit 3" (`docs/reports/morrow-v2-final-software-delivery-report.md:52`, evidence index line 29). The shell-visible low byte is 3; the raw Windows status is `0x80000003` (`-2147483645`), consistent with the host runtime failure. The observation is correct at the shell layer but imprecise at the process layer.
- `ci-identity-appid-separated` (`scripts/ci/test-self-hosted-install-isolation.ps1:414`) only asserts `AppId -ne 'com.morrow.ai-companion'`; it does not assert the exact CI appId. The helper hardcodes the correct value, so this is low risk.

### F5 — INFO

- The old fixed GUID `3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c` is gone from the runner/helper. It survives only in the probe's negative assertions (`scripts/ci/test-self-hosted-install-isolation.ps1:251,417`) and historical audit reports. No functional fixed identity remains; `package.json:53` still uses the user appId `com.morrow.ai-companion` and there is no `build.nsis.guid`.
- "No artifact upload" is true for the self-hosted workflow. The pre-existing, manual-only hosted `.github/workflows/ci.yml:67-75` still has `actions/upload-artifact@v4`; it is unchanged by this diff and is not a hosted fallback for the self-hosted workflow. The statement in `docs/reports/morrow-v2-final-software-delivery-report.md:88` should be scoped to the self-hosted workflow.

## 3. Commands and real exit codes

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | `f209d5899bbc5b5aa979cb28faf5461527ebb48b`, exit 0 |
| `git rev-parse HEAD^` | `1acd646227f7c7fa63ea041d49c52085ea0eba2f` |
| `git status --porcelain` | empty before this file |
| `git diff --stat 1acd646..HEAD` | 11 files, 485 insertions(+), 54 deletions(-) |
| `git diff --check 1acd646..HEAD` | exit 0 |
| PS 5.1 parser on the 3 changed `scripts/ci/*.ps1` | 3/3 `PARSE_OK`, exit 0 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1` | exit **0**; `passed=107 failed=0 total=107`; 107 distinct names, 0 missing/extra |
| Independent cross-run probe (new Run A/Run B under `.tmp`) | exit **0**; all fields true (details below) |
| `certutil -hashfile release\Morrow-Setup-2.0.0-x64.exe SHA256` | `5aeb40276def2323babe7c9e32ec2946f9ae44e29ef0cc8d13f0e0082b3e5977`; size 111,771,999; mtime `2026-11-06 11:40:59 +08:00` |
| `file release\Morrow-Setup-2.0.0-x64.exe` | `PE32 executable ... Nullsoft Installer self-extracting archive`; MZ/PE/`NullsoftInst` present |
| `certutil -hashfile evals\morrow-v2-rc\installers\2.0.0\Morrow-2.0.0-x64-portable.exe SHA256` | `e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b`; size 100,542,249 |
| `./node_modules/electron/dist/electron.exe --version` | bash exit **3**; raw Windows status `0x80000003` (`-2147483645`); no stdout/stderr |
| Minimal Electron app (`.tmp`, only `app.whenReady()` then `app.exit(0)`, `--no-sandbox --disable-gpu`) | raw Windows status **`0xC0000005` (3221225477)**; bash reports SIGSEGV (139); no stdout/stderr; no process left |
| Provider evidence JSON inspection | 200: `finish_reason=stop`, content `OK`, `usage.total_tokens=67`; 400: `code=10404`, `type=invalid_request_error`, `no category route found`; no key-shaped string |
| `gh api .../actions/runners` | `total_count=0` |
| `gh api .../actions/runs?head_sha=f209d58...` | `total_count=0` |
| `gh api .../actions/artifacts` filtered by `workflow_run.head_sha=f209d58...` | 0 matches (35 historical artifacts overall) |
| `gh api .../pulls/54` | `state=open`, `merged=false`, `head=f209d58...`, `base=release/morrow-v2-final-delivery` |
| PyYAML parse of both workflows | success, exit 0 |
| yargs strict probe with the split argv | `Unknown argument: CI`, exit **1** |
| Secret scan of `git diff` and new docs | no matches; `.tmp/spark.key` is gitignored and untracked (path checked only) |

## 4. Evidence details

### 4.1 Cross-run immutability (independent repeat)

I created a fresh Run A with a `CLEANUP_FAILED` manifest (simulating a failed cleanup) and a hidden file, archived it, and inventoried all 6 files (relative path, SHA256, length, `LastWriteTimeUtc`), including `.hidden-a`. I then created Run B with a different `New-CiInstallerIdentity` GUID, archived it, and removed only its own `installed-app`. Re-inventorying Run A produced identical relative paths, SHA256, lengths, and timestamps; the manifest and `checksums.sha256` hashes were unchanged; Run A's install was retained; Run B's install was removed. This matches the bundled probes `cross-run-a-inventory-immutable`, `cross-run-a-manifest-immutable`, `cross-run-a-checksums-immutable`, `cross-run-a-install-retained`, `cross-run-b-install-removed`, and `cross-run-guid-differs`.

### 4.2 Official installer

`release\Morrow-Setup-2.0.0-x64.exe` is 111,771,999 bytes with SHA256 `5aeb40276def2323babe7c9e32ec2946f9ae44e29ef0cc8d13f0e0082b3e5977`. The file is a real PE32 NSIS self-extracting archive (`MZ`, PE signature at `e_lfanew=216`, `NullsoftInst` present in the header). Its mtime is `2026-11-06T11:40:59.680+08:00`; `release/latest.yml` has `size: 111771999` and `releaseDate: 2026-11-06T03:41:05.743Z`, consistent with the build. It was **not executed**. The portable artifact at `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` is 100,542,249 bytes with SHA256 `e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b`, matching the docs and its `.sha256` file.

The product code in the reviewed diff is unchanged, so the installer built from the parent product code still represents the reviewed product code. The installer was not launched, and the install/launch/uninstall acceptance remains absent.

### 4.3 Electron host block

The host is Windows 11 build 26200 with Intel UHD Graphics and NVIDIA RTX 3060 (both `Status=OK`), matching the docs. `electron.exe --version` returns raw `0x80000003` (shell low byte 3), and a minimal Electron app that does nothing except `app.whenReady()` then `app.exit(0)` crashes with `0xC0000005` before producing output. This independently confirms that the block is in the host Electron/Chromium runtime, not in Morrow product code, and it is not fixable in this repository. No Electron process was left running.

### 4.4 Provider evidence

`.tmp/provider59-ok64.json` contains one choice with `finish_reason=stop`, `message.content=OK`, `usage.total_tokens=67`, and model `spark-x2.6`. `.tmp/provider59-bad.json` contains `error.code=10404`, `error.type=invalid_request_error`, and `message="no category route found"`. Neither file contains `sk-`, bearer, authorization, or API-key-shaped values. I did not read `.tmp/spark.key` and made no Provider network requests, so the files' authenticity as live responses is author-asserted; their integrity and sanitization are verified.

### 4.5 Workflow and repository state

The self-hosted workflow (`.github/workflows/self-hosted-ci.yml`) checks out the exact triggered SHA with `persist-credentials: false`, has `permissions: contents: read`, guards on repository `ve766/morrow-ai-companion-v2`, ref `refs/heads/feat/morrow-v2-final-closure` or a `ci-self-hosted-*` tag, and both `github.actor` and `github.triggering_actor` equal to `ve766`. Both jobs use `runs-on: [self-hosted, Windows, X64, morrow-ci]`; there is no hosted fallback, no `pull_request_target`, and no artifact upload in this workflow. The tag path additionally asserts the tag equals `ci-self-hosted-<GITHUB_SHA>`. PR #54 is open and unmerged; no run or artifact exists on the reviewed SHA; 0 runners are registered.

## 5. Residual risks

1. **No real install/launch/uninstall acceptance.** The official installer exists and its bytes are verified, but it was not executed. The docs' reason (an existing `F:\morrow1` install with the same appId-derived GUID) could not be independently checked without touching the user's installation, which this review was prohibited from doing.
2. **No real self-hosted run.** 0 runners, 0 runs, 0 artifacts. The workflow's guard and isolation logic are statically sound, but not exercised end-to-end.
3. **F1 blocks the first real self-hosted run.** Until the `Morrow CI` argument is quoted and a forwarding-stub probe is added, the CI package step fails deterministically; the failure will not be the documented host block.
4. **Product regression is author-asserted.** `npm run typecheck`, `npm test` (129 files / 1156 tests), `npm run evaluate`, `npm run evaluate:cognition`, `npm run build`, and `npm run package:win` were not rerun here. The reviewed diff has no product-code change, and the official installer artifact is independently verified, but these remain prior evidence rather than independently reproduced results.
5. **Provider authenticity is not re-requested.** The sanitized response files are consistent with the docs; live 200/400 behavior was not independently repeated (no Provider network requests allowed).
6. **Official installer signing/SmartScreen behavior is unverified.** The docs say the installer is unsigned; no code-signing or SmartScreen check was performed.
7. **F1 user-impact risk if the CI path is run unfixed.** With `shortcutName` degraded to `Morrow`, the CI installer's shortcut create/uninstall path can overwrite or delete the user's `Morrow.lnk` on the self-hosted machine. The unique GUID isolates registry/uninstall keys, but not the shortcut file name.

## 6. Conclusion

The overall delivery status remains **PARTIAL**. The official user NSIS installer is real and byte-verified; the per-call identity generator is correct; cross-run archive immutability passes both the bundled 107 probes and an independent repeat; the Electron host block is confirmed; the Provider evidence files are sanitized and consistent; the self-hosted workflow is statically guarded; and the docs correctly avoid claiming a real install/launch/uninstall PASS.

However, this review found a **BLOCKER (F1)** in the newly added self-hosted CI path: the unquoted `Morrow CI` argument is split into `-c.nsis.shortcutName=Morrow` and a stray `CI`, and electron-builder's strict parser exits 1 with `Unknown argument: CI`. The `107/107` probe result is valid but does not cover this integration. The docs' claim that the CI variant uses the `Morrow CI` shortcut name is therefore false, and the "host-only" root-cause narrative is incomplete. The pending self-hosted run will fail until F1 is fixed and the argv is covered by a probe.

This is **not COMPLETE and not CI PASS**.
