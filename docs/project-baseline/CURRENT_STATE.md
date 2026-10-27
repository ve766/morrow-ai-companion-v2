# Morrow AI Companion V2 — Current State

Last verified against GitHub: 2026-10-27  
Repository: https://github.com/ve766/morrow-ai-companion-v2  
Default branch: main  
Verified main SHA at baseline creation: 8b207b7d7b80b91ed4369d02fd6ef7e170b81133

> This is a dated snapshot, not a live dashboard. Re-check branch heads, PRs, and CI before relying on any SHA or status.

## Repository and branch facts

- Repository is private.
- main was observed at the SHA above when this baseline branch was created.
- The following PRs were open and unmerged at verification:
  - [PR #1 — algorithm-v2 Phase A/C work](https://github.com/ve766/morrow-ai-companion-v2/pull/1), head feature/algorithm-v2-phase-a, SHA a6f9e0be683b9a40af028952d625a5643cbf3553.
  - [PR #2 — phase 1 engineering consistency](https://github.com/ve766/morrow-ai-companion-v2/pull/2), head chore/phase-1-engineering-consistency, SHA 12f83e19172d02648ff5007ba14fa9ad9d640525.
  - [PR #3 — companion core](https://github.com/ve766/morrow-ai-companion-v2/pull/3), head feat/phase-2-companion-core, SHA e252d062581bc6aacc5f1197ff52693f8a944358.
  - [PR #4 — memory reliability](https://github.com/ve766/morrow-ai-companion-v2/pull/4), head feat/phase-2.2-memory-reliability, SHA 9fb55f1c1a821e5d83ddbe9456db37031291c530, stacked on PR #3.
- These PRs must be checked again before any review, retargeting, closure, or merge. Their descriptions are contributor-provided evidence, not independent proof of every claim.

## What the latest PR descriptions report

### PR #3 — companion core

Reported implementation:
- Current-turn query passed into memory preparation for ordinary as well as explicit-recall routes.
- Bounded continuity context for up to three zero-overlap records.
- Tests assert intercepted exact payloads, not merely database state.
- Offline companion evaluation set and real Ollama verification command.
- Evidence archive changed to preserve runs under unique IDs instead of overwriting a fixed report.

Reported validation:
- Typecheck passed.
- 42 files / 291 tests passed with the stated worker/cache flags.
- Offline evaluation suites and build passed.
- Local Ollama qwen2.5:0.5b objective request checks passed.

Important behavioral limitation:
- A remembered fact was mentioned in only 2 of 5 reported repeated runs; a separate same-session context turn was not used by the 0.5B model. This is not stable memory behavior and must not be described as reliable companion memory.

Not reported as completed:
- Third-party provider end-to-end test, Windows package creation, long-conversation validation, and product-quality assessment.

### PR #4 — memory reliability / third-party provider

Reported implementation:
- Extends the existing OpenAI-compatible provider rather than replacing the provider architecture.
- Explicit third-party provider selection, endpoint normalization, timeout and error mapping, no automatic retries, catalog verification state, and SecretStore-based credentials.
- Requires explicit third-party acknowledgement and the existing consent path.
- Local baseline evaluation and evaluator fixes; no claimed success for failed behavioral scenarios.

Reported validation:
- Typecheck, 57 test files / 578 tests, five offline evaluations, and build passed in the reported run.
- CI run [40518698732](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40518698732) was reported as 3/3 jobs successful for the then-current head. Re-check live CI before relying on it.

Important blockers:
- Local qwen2.5:0.5b did not achieve 5/5 success in any of 12 scenarios; reported conflict disclosure was 0/5.
- Third-party gemini-3-flash behavior evaluation was BLOCKED by HTTP 403 quota exhaustion. No valid final response evidence was available.
- The two candidate relay endpoints reportedly returned the same model catalog and remaining quota and therefore were not independent failover services. Their official terms, retention, and privacy posture were not verified.
- PR #4 reports schema versions v20/v21 as non-reversible without backup restore; migration and recovery risks need direct code/test review.

## Evidence status (not product claims)

| Area | Current status | What this means |
|---|---|---|
| Engineering checks in reported PRs | PASS (reported) | Re-run on current heads before final acceptance. |
| Companion request/context assembly | PARTIAL | Payload-level evidence exists in PR #3 report; inspect source and tests directly. |
| Stable real-model memory recall | FAIL / NOT RELIABLE | Repeated-run evidence is inconsistent. |
| Conflict disclosure on local 0.5B model | FAIL in reported sample | Reported 0/5; must not claim solved. |
| Third-party real-model behavior | BLOCKED | 403 quota error prevented evaluation. |
| Personality evolution / feedback loop | NOT ESTABLISHED | Do not infer an implemented, validated self-learning loop from versioning or candidate storage alone. |
| Production Agent execution | OUT OF SCOPE | Do not implement in this phase. |
| Full product acceptance | NOT PASSED | Engineering green is not equivalent to acceptable companion behavior. |

## Next work priority

1. Re-fetch current PR heads, status checks, changed files, and latest run artifacts.
2. Independently audit PR #3 and #4 source and tests, including exact request payload, memory conflict/revocation/staleness handling, consent, secret handling, schema migration/recovery, and evidence archive integrity.
3. Fix any real correctness or safety defect with a narrowly scoped regression test.
4. Re-run behavior evaluations with immutable run IDs and report transport, parsing, evaluator validity, and model behavior separately.
5. Do not merge PRs until blockers are resolved and a separate explicit merge decision is given.

## Update protocol

When updating this file:
- Record the verification date, branch names, exact SHAs, CI run IDs, and links.
- Mark whether each item is independently verified or copied from a PR report.
- Preserve old reports and raw run outputs; do not overwrite historical evidence.
- Never include secrets, raw private user conversations, or unredacted provider payloads.
