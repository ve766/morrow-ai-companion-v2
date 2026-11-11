# P0 evidence / deletion root cause (Issue #83)

- Base: PR #82 head `dc2743d7a3877a56db4d3d3bb55feb574dc1a8e8`
- Final code SHA: `b229c1ae3005dbee2790e208df258363867a1b8d`
- Branch: `fix/morrow-p0-evidence-deletion-closure-20261110`
- Schema: v59 (no migration was required for this issue)

## P0-A — startup deletion failure was a warning, not a gate

**Root cause.** `src/app/index.ts` wrapped deletion-journal replay,
self-state revalidation and investigation recovery in separate `try/catch`
blocks that only logged. The app then constructed `CompanionService` with the
normal context path. A failure therefore degraded into "stale derived data may
still be sent", and the comment explicitly deferred repair to the next ingest.

**Fix.** `src/app/cognition-reconciliation.ts` is now the single startup and
retry function. `CognitionConsistencyGate` (`src/app/cognition-consistency.ts`)
holds `ready|locked`; a failure locks:

- deletion journal read/replay,
- self-state lineage revalidation,
- investigation deadline recovery.

`ChatService.send` calls `assertReady()` before provider configuration or
context assembly. The renderer shows a banner with the stable reason codes and
a retry button; `cognition.consistency()` / `cognition.reconcile()` are the IPC
entry points. The inner-cognition scheduler skips while locked. No database
reset is needed: the same idempotent function unlocks on success.

## P0-B — malformed parent lists and self-invalidated derived events

**Root cause.** `extractParentIds()` used `filter(isUuid)`, silently dropping a
bad entry from a mixed list. `verifyPersistedSource()` parsed parents and
returned `verifyAll(parents)` before checking the event's own subject, so an
event whose subject was deleted could be rescued by an active parent. Missing
and malformed fields both became "no parents", which is how a damaged derived
record could be treated as an origin.

**Fix.** `parseParentIds()` now returns `absent | empty | valid | malformed`
with distinct malformed reasons (`not_array`, `non_string`, `invalid_uuid`,
`duplicate`, `too_many`). The gate checks the event's own subject before
recursing, rejects synthetic/reflection/thought/summary event families that
lack a complete parent chain, and uses `REFLECTION_GATE_REASONS` for stable
audit codes. Caller root/cluster claims are verified against persisted
lineage. Tests cover mixed lists, null/object/string/duplicate/oversized
fields, empty vs absent, a deleted subject with an active parent, synthetic
lineage, cycles, broken chains, depth, cross-owner and forged keys.

## P0-C — deletion did not reach all current projections

The actual runtime asset list (from migrations/repositories, not module names):

| Surface | Deletion handling |
| --- | --- |
| `evidence_lineage` | recursive descendants marked `deleted` by `json_each(parent_ids_json)` |
| `reflection_findings` / `reflection_finding_routes` | findings whose evidence cites an invalidated event are deleted; routes cascade |
| `cognitive_pending_items` | related rows set `dropped` |
| `pending_personality_candidates` | deleted with the finding |
| `cognitive_outbox` | pending/failed rows for the conversation turns set `cancelled` |
| `cognitive_effect_ledger` | pending/running/retryable rows set `terminal_failed` + `source_invalidated`, claim cleared |
| `knowledge_gap_evidence` | deleted by conversation |
| `cognitive_turn_contexts`, `cognitive_turn_finalizations`, `turn_states`, `turn_trace_events`, `intent_readings` | deleted by conversation |
| `memory_suggestions`, `goal_candidates`, `relationship_threads`, `relationship_thread_evidence` | deleted by conversation |
| `cognitive_turn_observations`, `cognitive_feeling_events` | deleted by conversation; affect service also rebuilds emotion/trait/mood |
| `self_model_entries` | retracted tombstone, not deleted |
| `personalization_signals`, `personality_growth_signals`, `user_interaction_signals`, `exploration_events`, `exploration_budget` | deleted by turn |
| `companion_goals` | active goals sourced from deleted messages set `cancelled` |
| `memories` whose only `memory_evidence` is the conversation | retracted; fact records deleted; lineage marked deleted |
| `interest_evidence` | deleted; `InterestService.list()` reconciles and removes an interest with no support |
| `morrow_mood_contributions` | `MoodService.deleteConversation` removes impulses and replays |
| `morrow_thoughts` / `morrow_self_states` | `InnerCognitionService.deleteConversation`; gate revalidation retracts unsupported states |
| `memory_evidence` | deleted for conversation/memory invalidation |

**Semantics.** Lineage, findings, routes, pending items, outbox/effects,
turn-level projections and memory evidence are physically deleted or marked
cancelled. `memories` and `self_model_entries` keep a retracted,
non-prompt-readable tombstone so the user's history is not silently destroyed;
their derived text no longer reaches `assembleContext`/Provider payload.
Audit events contain counts only.

**Gap.** This runtime has no user-facing single-message delete API; only whole
conversation and memory lifecycle deletes exist. The single-message path is
therefore NOT_RUN, not faked. Backup restore uses the same startup
reconciliation; the existing backup restore suite covers journal merge and the
new startup test covers replay, but a restore-to-lock fault injection is not
separate.

## P0-D — Inner Cognition atomicity

`ConversationRepository.append` opens one `database.transaction()` and calls
`afterPersist` inside it. `ChatService` now calls
`innerCognition.observeTurn` there. `observeTurn` writes the thought through
the repository's savepoint, then reviews it, all inside the same outer
transaction. The assistant message and the thought therefore commit or roll
back together. A fault-injection test throws from `observeTurn` and proves the
assistant row is rolled back.

The existing `CognitionOutbox` already has idempotent keys, effect-ledger
claims, lease expiry, fenced completion and retry/dead-letter; this issue did
not add a second queue. It added source validity at claim time and after the
projector: a deleted source is cancelled, and if deletion wins the projector
race, invalidation is re-run before the row is cancelled.

## Historical records

- Records with no resolvable source remain `legacy_unverified` and are
  rejected; they are not auto-promoted to `morrow`.
- Malformed parent fields are rejected as `malformed_parent_chain`; they are
  not rewritten into origins.
- Origin lineage rows are persisted lazily only for a real source record.
- No table was dropped, cleared or reset for this issue.
