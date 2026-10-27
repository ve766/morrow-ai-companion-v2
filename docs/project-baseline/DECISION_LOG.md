# Morrow AI Companion V2 — Decision Log

This file records durable product and engineering decisions. Add dated entries when a decision changes; do not silently rewrite history.

## 2026-10-27 — Companion before Agent

**Decision:** Prioritize the basic companion cognition loop before Agent execution.

**Reason:** The product has not yet demonstrated reliable multi-turn memory use or stable conflict disclosure. Autonomous actions would amplify unresolved reliability and safety problems.

**Consequences:** No autonomous tools, browser/terminal control, or external task execution in this phase.

## 2026-10-27 — Evidence levels must remain separate

**Decision:** Report implementation, request/context delivery, evaluator validity, real-model behavior, and product acceptance separately.

**Reason:** CI and request-payload tests can pass while a small model ignores the supplied context. A single successful answer is not proof of repeatable behavior.

**Consequences:** Behavioral claims require repeated runs, explicit denominators, preserved raw evidence, and honest failure/blocker labels.

## 2026-10-27 — Preserve existing architecture

**Decision:** Extend existing provider, memory, persistence, and consent services where feasible; avoid broad rewrites.

**Reason:** The repository already contains working infrastructure, and stacked PRs carry migration and integration risk.

**Consequences:** Establish root cause and regression evidence before introducing a new subsystem or dependency.

## 2026-10-27 — PRs remain unmerged until explicit approval

**Decision:** Keep implementation changes reviewable and isolated; no merge/release without explicit user authorization.

**Reason:** PR #3 and #4 are stacked and have unresolved real-model behavior blockers in their reports. Mainline stability and migration safety matter.

**Consequences:** Reviews may recommend changes or report readiness, but do not merge or publish autonomously.

## 2026-10-27 — Third-party provider privacy gate

**Decision:** Use synthetic data for relay/provider tests until ownership, terms, retention, and privacy posture are verified.

**Reason:** Endpoint TLS and a successful models-list request do not establish trustworthy data handling or usable chat quota.

**Consequences:** No real private memories or sensitive user content sent to unverified relays. A 403 quota error is a blocker, not a retry invitation.

## 2026-10-27 — Personality stability before adaptation

**Decision:** Keep stable personality separate from short-lived interaction state; personality changes require evidence, candidate review, evaluation, version history, and rollback.

**Reason:** One-off emotion, praise, random variation, or generated self-description is insufficient evidence of durable change.

**Consequences:** Do not claim a validated autonomous personality-learning loop until production trigger paths and offline behavioral tests demonstrate it.
