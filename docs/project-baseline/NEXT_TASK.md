# Next Task — Independent Audit of Companion Core and Memory Reliability

Status: READY FOR EXECUTION  
Scope: read-only audit first; implement fixes only after a concrete defect and regression test are identified.  
Target repository: ve766/morrow-ai-companion-v2

## Step 0 — Re-establish the live baseline

- Fetch current main, PR #1–#4 states, current head SHAs, merge bases, changed files, and latest CI checks.
- Do not rely on the SHAs in this file without re-verification.
- Identify the actual dependency chain among PR #1–#4; do not assume every PR should merge.
- Do not merge, close, retarget, or publish anything.

## Step 1 — Inspect implementation, not only reports

Review at minimum:
- Memory query construction and retrieval ranking.
- Exact final serialized provider payload and bounded history/memory assembly.
- Conflict, stale memory, correction, revocation, and deletion precedence.
- Third-party consent payload binding, expiry, sensitive-content limits, redirects, endpoint validation, timeouts, and error handling.
- SecretStore usage and any accidental credential leakage to config/logs/reports.
- Schema v20/v21 migration, interruption, backup, restore, and old-data compatibility.
- Evaluation harness validity, negative cases, raw-run immutability, and report hash determinism.

For each claim record source path, function/test names, observed behavior, and evidence link or line range.

## Step 2 — Re-run checks on current code

- Typecheck, unit/integration tests, build, and CI checks as applicable.
- Re-run offline evaluation and verify that fixture/hash locks actually protect the evaluated input.
- If using real models, use synthetic scenarios only; one attempt per quota-limited endpoint, no automatic retry loops.
- If request delivery fails, stop and mark behavior evaluation BLOCKED.
- Preserve each run under a unique immutable run ID; do not overwrite earlier output.
- Report objective request/context checks, parse success, evaluator validity, and model behavior separately.

## Step 3 — Fix only proven defects

For every fix:
- State root cause and why existing tests missed it.
- Add a regression test that fails before the fix and passes after.
- Check negative and adversarial cases.
- Confirm migration and fallback behavior.
- Avoid unrelated refactors and dependencies.

## Required report format

For each area use exactly one status: PASS / FAIL / BLOCKED / NEEDS_REVIEW / NOT_RUN.

Include:
1. Live baseline branch and SHA.
2. PR dependency map and current status.
3. Files/functions inspected.
4. Commands run and raw outcomes.
5. Findings ranked by severity, with reproducible evidence.
6. Real-model run IDs and sample sizes, if any.
7. Known gaps and items not tested.
8. Recommendation per PR: merge-ready, changes required, or blocked.
9. Explicit statement that no PR was merged and no release was published.

## Stop conditions

Stop and report BLOCKED if:
- Current GitHub state cannot be established.
- A test requires credentials not explicitly available through the approved secure path.
- Provider quota returns 403/insufficient quota.
- A migration cannot be tested without risking real user data.
- A proposed change requires broad architecture replacement or changes outside this task.
