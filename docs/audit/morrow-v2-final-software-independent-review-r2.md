# Morrow V2 Final Software Delivery — Independent Review R2 (Issue #59)

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. The only repository write is this file. Throwaway probes were created only under `.tmp/` (gitignored) and removed. Nothing was staged, committed, tagged, pushed, or published. No `npm ci`, `npm install`, full test suite, `npm run build`, `npm run package:win`, NSIS installer, or user-facing installer was executed. Read-only `gh api` GETs were used. No API key, token, or secret is reproduced here; `.tmp/spark.key` was not read.

Review date: 2026-11-06.

Prior review: `docs/audit/morrow-v2-final-software-independent-review.md`, which reviewed `f209d5899bbc5b5aa979cb28faf5461527ebb48b` and found F1 **BLOCKER** (unquoted `Morrow CI` split into `Morrow` + `CI`) and F2 **HIGH** (docs implied the shortcut-name change addressed the host block; no successful CI variant build). That file is kept as history and was not modified.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (private) |
| Branch | `feat/morrow-v2-final-closure` |
| **Reviewed HEAD (exact)** | **`463dd99805a2454caf0826ffe977bc567a5de751`** |
| Parent / prior reviewed SHA | `f209d5899bbc5b5aa979cb28faf5461527ebb48b` |
| Commit subject / time | `fix(ci): use a space-free CI shortcut name` / `2026-11-06T14:35:16+08:00` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, `merged=false`, head `463dd99805a2454caf0826ffe977bc567a5de751` |
| Diff `f209d58..HEAD` | 8 files, +178 / -7: 1 `scripts/ci` helper, 6 docs, plus the prior review file added as history |
| Product runtime / schema / test changes | **none** — no `src/`, `tests/`, `package.json`, lockfile, schema, or workflow change |
| Worktree before this file | clean (`git status --porcelain` empty) |
| Registered self-hosted runners | `0` (`actions/runners` `total_count=0`) |
| Workflow runs on reviewed SHA | `0` (`actions/runs?head_sha=463dd99...` `total_count=0`) |
| Artifacts on reviewed SHA | `0` (none matched `463dd99...`) |
| Real NSIS install / launch / uninstall | **not performed** |
| Real self-hosted run | **none** |

## 1. Verdict

| Scope | Verdict |
| --- | --- |
| **Overall** | **PARTIAL — F1 and F2 are fixed; no remaining code BLOCKER; real install/launch/uninstall, real CI variant adoption, and a real self-hosted run remain absent** |
| **F1 — unquoted `Morrow CI` argument split** | **FIXED** — helper now passes `-c.nsis.shortcutName=MorrowCI`; my forwarding-stub probe shows the child receives it as one token; strict yargs parses it with `shortcutName=MorrowCI` and no positional args |
| **F2 — docs claimed the shortcut change addressed the host block** | **FIXED** — docs now state the no-space CI build still fails with exit code null and real dynamic-GUID adoption is `PENDING_USER_ACTION`; no remaining claim that the shortcut-name change made the build succeed |
| Dynamic identity generation | **PASS** — `New-CiInstallerIdentity` still generates a fresh valid GUID per call; 50/50 unique/valid in the probe suite; CI appId separate |
| Dynamic identity compiled into a real installer | **PENDING_USER_ACTION** — no CI variant installer exists; the host blocks the intermediate installer |
| Cross-run archive immutability | **PASS** — included in the 107/107 probe suite |
| Official user NSIS installer | **PASS (artifact only; not executed)** — 111,771,999 bytes, SHA256 `5aeb4027...`, real NSIS archive |
| CI NSIS variant build | **FAIL (host/environment)** — post-fix attempt `ci15` reached NSIS and failed with `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`, exit code null; no final CI installer |
| Install / launch / uninstall acceptance | **PENDING_USER_ACTION** |
| Electron host block | **CONFIRMED** — minimal Electron app exits `0xC0000005`; `electron.exe --version` raw status `0x80000003` (shell exit 3) |
| Product regression | **AUTHOR-ASSERTED, NOT RERUN** — prohibited by review constraints; no product code changed |
| Provider evidence | **PASS (evidence integrity)** — sanitized 200/67-token and 400/10404 files; authenticity not re-requested |
| Docs honesty | **PASS** — F2 corrected; overall status remains PARTIAL; prior LOW wording issues remain (F4) |
| Self-hosted workflow run | **PENDING_USER_ACTION** — 0 runners; no run or artifact on the reviewed SHA |
| Workflow / security (static) | **PASS** — guard, self-hosted labels, no hosted fallback, no artifact upload in the self-hosted workflow, no `pull_request_target` |
| Secret scan | **PASS** — no credential-shaped value in `f209d58..HEAD` or the retested evidence |

**No code BLOCKER remains.** The delivery still cannot be COMPLETE or CI PASS because no real install/launch/uninstall acceptance, no real CI variant installer adoption, and no self-hosted workflow run exist.

## 2. F1 status — FIXED

Current code:

- `scripts/ci/self-hosted-ci-helpers.ps1:353` — `'-c.nsis.shortcutName=MorrowCI'` (no space)
- `scripts/ci/run-self-hosted-ci.ps1:153` — passes `Get-CiInstallerArguments` to the CI package step
- No `Morrow CI` argument remains in `scripts/`; the only occurrences of that spaced string are historical explanations in docs (`docs/reports/morrow-v2-final-software-delivery-report.md:31`) and the prior audit file.

Independent process-level proof (no electron-builder or NSIS executed):

- I dot-sourced the reviewed helper, called `Get-CiInstallerArguments`, and passed the exact array through `Invoke-CapturedProcess` to a `.cmd` stub that forwards `%*` to a Node script. The stub exited 0, the argument count was 12, and the child printed exactly:
  - `NODEARG=[-c.nsis.shortcutName=MorrowCI]`
  - no `NODEARG=[CI]` and no `NODEARG=[Morrow]`
- I then loaded the reviewed electron-builder `configureBuildCommand` and `.strict()` parser with the same arguments (excluding the `electron-builder` command token). It printed `PARSED_OK`, `shortcutName=MorrowCI`, `underscore=[]`, exit 0.

The previous failure mode is gone: the argument is a single token, the strict parser accepts it, and the shortcut name is no longer `Morrow`. The no-space workaround changes the user-visible shortcut name to `MorrowCI` rather than `Morrow CI`; that is documented and avoids the user `Morrow.lnk` collision.

## 3. F2 status — FIXED

The docs now state the host block remains and real adoption is pending:

- `docs/reports/morrow-v2-final-software-delivery-report.md:32` — after changing to `MorrowCI`, the local CI variant build still fails at the electron-builder intermediate installer with exit code null; the host block is not gone; real NSIS adoption of the dynamic GUID remains `PENDING_USER_ACTION`.
- `docs/reports/morrow-v2-final-software-delivery-evidence-index.md:55` — the no-space CI build still exits 1 with the intermediate installer exit code null; the host block persists.
- `docs/testing/morrow-v2-final-software-acceptance-matrix.md:23` — row 9 is `PENDING_USER_ACTION`; evidence says the argument injection and no-space `shortcutName=MorrowCI` are verified, but the local CI variant build is still blocked by the host.
- `docs/reports/morrow-v2-final-software-delivery-report.md:9` — final status PARTIAL; install/launch/uninstall and self-hosted run remain `PENDING_USER_ACTION`.
- `docs/reports/morrow-v2-final-software-delivery-report.md:91` — self-hosted run is `PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED`, not GitHub CI PASS.

I found no remaining claim that the `shortcutName` change made the CI variant build succeed. Outside the prior audit file, the only remaining spaced `Morrow CI` text in the current docs is the historical note at `docs/reports/morrow-v2-final-software-delivery-report.md:31` explaining the first review's finding, which is accurate history.

A post-fix build attempt is recorded at `.tmp/ci15.log` (14:33) with output under `release-ci/`: it reached NSIS packaging, then failed with `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` and intermediate installer exit code null. `release-ci/Morrow-CI-Setup-2.0.0-x64.exe` is only a 189,807-byte intermediate artifact, not a final installer. The log does not print the CLI argv; the exact no-space argument is independently proven by the argv/yargs probes above. The docs' statement that the host block remains is consistent with this evidence.

## 4. Prior findings carried forward

### F3 — OPEN / MEDIUM (test coverage, reduced practical risk)

The 107-probe suite still does not exercise process-level argv or assert `shortcutName`. It checks the helper's returned array and runner text. I independently proved the current no-space argument, but a future space-containing argument would not be caught by the suite. Recommended: add a forwarding-stub probe for the full argument vector and one assertion for `shortcutName=MorrowCI`.

### F4 — OPEN / LOW (docs precision)

- `docs/reports/morrow-v2-final-software-delivery-report.md:37` still says `manifest`/`run-identity.json` record `runId`, `ciAppId`, `nsisGuid`, `installerSha256`. `run-identity.json` uses `ciNsisGuid` and has no `installerSha256` at write time; the manifest records `installation.installerSha256`.
- `electron.exe --version` is still described as "exit 3"; the shell-visible low byte is 3, the raw Windows status is `0x80000003`. Not material.

### F5 — INFO (unchanged)

- The old fixed GUID `3f2b8c1e-...` remains only in the probe's negative assertions (`scripts/ci/test-self-hosted-install-isolation.ps1:251,417`) and historical docs; no runner/helper uses it.
- "No artifact upload" is true for the self-hosted workflow; the pre-existing manual-only hosted `.github/workflows/ci.yml:67-75` still has `actions/upload-artifact@v4`, unchanged and not a hosted fallback.

## 5. Commands and real exit codes

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | `463dd99805a2454caf0826ffe977bc567a5de751`, exit 0 |
| `git rev-parse HEAD^` | `f209d5899bbc5b5aa979cb28faf5461527ebb48b` |
| `git status --porcelain` | empty before this file |
| `git diff --stat f209d58..HEAD` | 8 files, +178 / -7 |
| `git diff --check f209d58..HEAD` | exit 0 |
| PS 5.1 parser on the 3 `scripts/ci/*.ps1` | 3/3 `PARSE_OK`, exit 0 |
| `grep shortcutName` in `scripts/ci` | only `-c.nsis.shortcutName=MorrowCI`; no spaced argument |
| Forwarding-stub argv probe | `ARGV_COUNT=12`, `NODEARG=[-c.nsis.shortcutName=MorrowCI]`, no `CI` token, stub exit 0 |
| yargs strict parse probe | `PARSED_OK`, `shortcutName=MorrowCI`, `underscore=[]`, exit **0** |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1` | exit **0**; `passed=107 failed=0 total=107`; 107 distinct names, 0 missing/extra |
| `certutil -hashfile release\Morrow-Setup-2.0.0-x64.exe SHA256` | `5aeb40276def2323babe7c9e32ec2946f9ae44e29ef0cc8d13f0e0082b3e5977`; size 111,771,999; mtime 2026-11-06 11:40 |
| `certutil -hashfile ...Morrow-2.0.0-x64-portable.exe SHA256` | `e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b`; size 100,542,249 |
| `electron.exe --version` | raw Windows `0x80000003` (`-2147483645`); shell low byte 3 |
| Minimal Electron app (`.tmp`, only `app.whenReady()` then `app.exit(0)`) | raw Windows **`0xC0000005` (3221225477)**; bash SIGSEGV (139); no process left |
| Post-fix CI build log `.tmp/ci15.log` | reached NSIS; `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`; intermediate installer exit code null; no final installer |
| `gh api .../actions/runners` | `total_count=0` |
| `gh api .../actions/runs?head_sha=463dd99...` | `total_count=0` |
| `gh api .../pulls/54` | `state=open`, `merged=false`, head `463dd99...` |
| Secret scan of `git diff f209d58..HEAD` | no credential-shaped matches; `.tmp/spark.key` gitignored and untracked (path checked only) |

## 6. Residual risks

1. **No real install/launch/uninstall acceptance.** The official installer exists and its bytes are verified, but it was not executed. The docs' `F:\morrow1` reason was not independently checked, per the no-touch constraint.
2. **No real CI variant installer.** The host still blocks electron-builder's intermediate installer (post-fix `ci15` exit code null). Dynamic GUID adoption in a real installer and the CI variant install/uninstall remain `PENDING_USER_ACTION`.
3. **No real self-hosted run.** 0 runners, 0 runs, 0 artifacts on the reviewed SHA.
4. **Product regression is author-asserted.** `npm run typecheck`, `npm test` (129 files / 1156 tests), `npm run evaluate`, `npm run evaluate:cognition`, `npm run build`, and `npm run package:win` were not rerun here. No product code changed in this diff, and the official installer artifact is independently verified.
5. **Provider authenticity not re-requested.** The sanitized response files are consistent with the docs; live 200/400 behavior was not independently repeated (no Provider network requests).
6. **F3 test gap remains.** The 107-probe suite does not cover process-level argv; my independent stub is the only proof of the current argument.
7. **F4 docs precision remains.** Field naming for `ciNsisGuid`/`installerSha256` and the shell-vs-raw `electron --version` status are imprecise but non-material.

## 7. Conclusion

The first review's **F1 BLOCKER is fixed** and **F2 is fixed**. The helper now sends `-c.nsis.shortcutName=MorrowCI` as one argument; a strict yargs parse succeeds with `shortcutName=MorrowCI` and no positional leftovers; the 107-probe suite still passes 107/107; the official installer bytes and Electron `0xC0000005` are independently reconfirmed; the host NSIS block is confirmed from the post-fix `ci15` log and `release-ci` artifacts (no new builder run). The docs now honestly state that the no-space CI build still fails on this host and that real dynamic-GUID adoption is `PENDING_USER_ACTION`.

The overall delivery remains **PARTIAL**. There is no remaining code BLOCKER from F1/F2, but the acceptance blockers are real: no real install/launch/uninstall, no real CI variant installer, and no self-hosted run. This is **not COMPLETE and not CI PASS**.
