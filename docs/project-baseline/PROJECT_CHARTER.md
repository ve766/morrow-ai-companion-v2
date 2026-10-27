# Morrow AI Companion V2 — Project Charter

Last reviewed: 2026-10-27  
Repository: https://github.com/ve766/morrow-ai-companion-v2

## Product goal

Build Morrow first as a reliable AI companion with coherent conversational presence, evidence-grounded memory, context and intent understanding, and a carefully governed personality/self-model. Do not advance to Agent execution until the companion core has been demonstrated to work reliably.

“Basic life-form” is a product and engineering metaphor. Software behavior must not be presented as proof of subjective consciousness.

## Product priorities

1. Reliable conversation continuity across turns and sessions.
2. Memory retrieval that is relevant, traceable, correctable, revocable, and safe under conflicts or stale information.
3. Intent and context understanding, including references, topic changes, ambiguity, correction, and uncertainty.
4. A stable personality layer separated from transient interaction state.
5. Evidence-based learning candidates, offline evaluation, approval boundaries, version history, and rollback.
6. A minimal, distinctive desktop companion experience that serves the core rather than distracting from it.

## Non-negotiable boundaries

- No Agent execution, autonomous tool use, browser control, terminal control, or autonomous external actions in this phase.
- Never commit, print, or report credentials, tokens, or API keys. Secrets must stay in the approved local secret store or equivalent secure runtime configuration.
- Never treat model guesses as user facts without evidence and appropriate confirmation.
- Never inject the entire conversation history or all memories indiscriminately into every model request.
- Never treat one compliment, one emotional utterance, random variation, or one successful answer as proof of a stable personality change or reliable capability.
- Do not automatically apply experimental memory/personality changes to production conversation behavior without evaluation and governance.
- Do not equate passing CI, passing fixture tests, or successful request dispatch with good real-model behavior.
- Preserve user data, migration safety, explicit consent, least privilege, and a safe fallback path.
- Do not merge PRs, publish releases, modify repository permissions, or change main without explicit user authorization.

## Evidence discipline

Every capability claim must distinguish:
- Implementation evidence — code path and tests exist.
- Transport/context evidence — the expected request and context were actually dispatched.
- Evaluator evidence — the evaluator is validated against positive and negative cases.
- Behavior evidence — observed model outputs meet behavioral criteria across repeated runs.
- Product acceptance — end-to-end behavior, recovery, UX, and safety are acceptable.

A pass at one level does not imply a pass at the levels above it.

## Working method

- Inspect the current repository and actual branch/commit before acting; do not rely on stale report SHAs.
- Prefer incremental, reviewable changes on isolated branches.
- Reuse existing architecture and modules unless a demonstrated root cause justifies change.
- Every task should include scope, affected modules, negative cases, compatibility, tests, acceptance criteria, evidence, known gaps, and rollback.
- Use statuses PASS / FAIL / BLOCKED / NEEDS_REVIEW / NOT_RUN and state the evidence for each.
- Preserve raw experiment outputs by immutable run ID; never overwrite prior evidence under a fixed filename.
- Use synthetic data for third-party provider testing until service ownership, retention, terms, and privacy posture are understood.
