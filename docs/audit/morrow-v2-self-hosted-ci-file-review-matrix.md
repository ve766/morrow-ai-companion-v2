# Morrow V2 Self-Hosted CI File Review Matrix — Issue #56, PR #54, HEAD `ee24aa5`

Independent reviewer: separate context; did not write this implementation. No product code, test, workflow, script, existing doc, or evidence was modified. Only this file and `docs/audit/morrow-v2-self-hosted-ci-independent-review.md` were written. Throwaway probes were written only under `.tmp/`. Nothing was staged or committed.

## 0. Scope and method

- Frozen HEAD: `ee24aa5b00db6eac91509a56ce2fde2c259e54c7`.
- Parent SHA: `70e89f1d92975d506e803fff511b83191c9148d0`.
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`.
- PR #54: OPEN, not draft, `MERGEABLE`, `mergeStateStatus=CLEAN`, head `ee24aa5`, `statusCheckRollup=[]`.
- Diff: 9 files, 551 insertions, 3 deletions; only `.github/workflows/`, `scripts/ci/`, and `docs/`.
- Evidence: GitHub API PR/check-run/run/runner/workflow queries; `python yaml.safe_load`; Windows PowerShell Parser; wrong-SHA guard execution; setup-script execution under PowerShell 5.1; `$LASTEXITCODE` and redaction probes; `npx tsc --noEmit`.
- No product/test/schema/provider/cognition file changed.

## 1. Changed files (9)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 1 | `.github/workflows/ci.yml` | `push`/`pull_request` trigger replaced by `workflow_dispatch`; two comment lines added | **PASS per Issue #56** — jobs parsed identical to parent; no command/job deletion, no `continue-on-error`, no fake PASS. Only the feature branch is manual-only; `main`/`release` still have the old automatic trigger (F10). |
| 2 | `.github/workflows/self-hosted-ci.yml` | New manual Windows self-hosted workflow | **Security gates PASS; operational BLOCKED** — guard/checkout/permissions/no-fallback/no-artifact all correct, but the file is not on the default branch, so `workflow_dispatch` is unavailable; `shell: pwsh` requires PowerShell 7, which is not documented (F1/F2). |
| 3 | `docs/ci/ci-no-billing-operations.md` | Zero-billing operations manual | **PARTIAL** — honest `PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED`, hosted compute/storage warnings, rollback and archive handling. Repeats the unavailable “Self-hosted Windows CI → Run workflow” action; line 41 implies an install smoke that the script does not implement. |
| 4 | `docs/ci/self-hosted-runner-setup-windows.md` | Runner registration/start/stop/update/uninstall guide | **PARTIAL** — token handling (interactive only), labels, rollback, and data isolation are good. The documented `powershell ... -File scripts/ci/setup-self-hosted-runner.ps1` fails under PowerShell 5.1; PowerShell 7/`pwsh` is never mentioned; the default-branch prerequisite for dispatch is missing. |
| 5 | `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md` | Delivery report | **PARTIAL** — root-cause evidence is accurate (0-step runs, billing annotation, parent PASS not accepted) and the status is honestly PARTIAL/PENDING, not CI PASS. Missing the final `ee24aa5`/parent pair; “Node 22 检查” and “static acceptance complete” overstate what was tested; line 60 implies install smoke. |
| 6 | `docs/reports/morrow-v2-self-hosted-ci-evidence-index.md` | Evidence index | **PARTIAL** — honest PENDING/BLOCKED status and static commands; existing hosted evidence correctly labeled historical. No final 40-character SHA (“see PR head”); line 53's “static verification PASS” is too broad; the Actions dispatch instruction is unavailable. |
| 7 | `docs/testing/morrow-v2-self-hosted-ci-acceptance-matrix.md` | Acceptance matrix | **PARTIAL** — PENDING rows are honest and “not CI PASS” is explicit. Row 10 lists the B.5 command set but omits the B.7 installed-app smoke; row 19 is host-pending although no install step exists; row 20's “hosted workflow manual” applies only to the feature branch. |
| 8 | `scripts/ci/run-self-hosted-ci.ps1` | Full local verification/archive script | **PARTIAL** — exact SHA guard, `$LASTEXITCODE` propagation, failure stop, `finally` archive, manifest/logs/results/installers/screenshots/checksums/README, archive outside repo, and fixed commands are good. Missing installed-app NSIS smoke (F3); console/JSON redaction gaps (F4); stale evidence provenance (F5); tool-missing edge cases (F6); Node 22 only logged (F7). |
| 9 | `scripts/ci/setup-self-hosted-runner.ps1` | Preflight and official interactive instructions | **FAIL / PARTIAL** — no token argument, no automatic registration, no token persistence/fetch, no admin requirement; official instructions are correct. It fails under the documented Windows PowerShell 5.1 because `$IsWindows` is `$null` (F2); allows ARM64 while the workflow requires `X64`; creates `work` while the official work folder is `_work` (minor). |

## 2. Review artifacts (not part of the implementation diff)

| File | Purpose |
| --- | --- |
| `docs/audit/morrow-v2-self-hosted-ci-independent-review.md` | Independent review with security gates, CI state, script/docs review, commands/exit codes, findings, and residual risks. |
| `docs/audit/morrow-v2-self-hosted-ci-file-review-matrix.md` | This per-file matrix. |

Neither file was staged or committed.

## 3. Summary

| Category | Files | Verdict |
| --- | --- | --- |
| Workflow security | 2 | **PASS** for guard, SHA checkout, permissions, no hosted fallback, no artifact upload, no `continue-on-error`; **BLOCKED** for default-branch dispatchability and PowerShell 7 availability |
| Scripts | 2 | **PARTIAL** — run script sound in normal failure/archive paths but missing installed-app smoke and redaction/provenance hardening; setup script fails on documented PowerShell 5.1 |
| Docs | 5 | **PARTIAL** — PENDING/PARTIAL honesty passes; several instructions are not executable as written and the final SHA/command evidence is incomplete |
| Product/test changes | 0 | **PASS** — no product runtime, schema, test, provider, cognition, memory, or personality change |
| Overall Issue #56 | 9 | **BLOCKED** (operational); code/static **PARTIAL**; security gates **PASS**; real workflow_dispatch **PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED** |

## 4. Key evidence

| Evidence | Result |
| --- | --- |
| HEAD `ee24aa5` check-runs | `total_count=0`; no statuses; `gh pr checks 54` returns “no checks reported” |
| Parent `70e89f1` run `42027056929` | 4/4 failure, `steps_count=0`, `runner_name=""`; billing/spending-limit annotation |
| Prior run `42025990645` | 4/4 failure, `steps_count=0` |
| Green parent-code run `41995422882` | 4/4 success, head `6f5fe47`; **not** this HEAD |
| Registered runners | `total_count=0` |
| Registered workflows | only `CI`; `self-hosted-ci.yml` 404 on `main` and `release/morrow-v2-final-delivery`; `gh workflow view self-hosted-ci.yml` 404 “not found on the default branch” |
| YAML parse | both workflows parse, exit 0 |
| PowerShell Parser | both scripts parse, exit 0 |
| Wrong-SHA guard | exit 1, SHA mismatch, no commands, no archive |
| Setup script under PowerShell 5.1 | exit 1, `$IsWindows` null, “This guide targets Windows x64” |
| `$LASTEXITCODE` probe | `CODE=7` after native command piped to `Tee-Object` |
| Redaction probe | `Authorization: Bearer`, `sk-…`, `api_key=` redacted; JSON-quoted `"apiKey"`/`"api_key"` not redacted |
| `npx tsc --noEmit` | exit 0 |
| `git diff --check` | exit 0 |

## 5. Final verdict

- **Security gates: PASS.** No bypass, hosted fallback, token leak, required-check deletion, or product change.
- **Code/static: PARTIAL.** The workflow guard and run-script failure/archive mechanics are sound; the installed-app smoke is missing, the setup script fails on the documented PowerShell version, and redaction/provenance need hardening.
- **Overall Issue #56: BLOCKED.** The workflow is not on the default branch, so the user cannot dispatch it; the documented setup path fails; and the installed-app acceptance is not implemented. Real workflow_dispatch remains pending/blocked and no CI PASS is claimed.
- Do not merge PR #54 or publish a Release on this CI path until the workflow is reachable on `main`, PowerShell 7 is documented/installed (or the setup script is fixed), the installed-app smoke is added, and one real self-hosted run on `ee24aa5` (or a later frozen SHA) completes with archived evidence.
