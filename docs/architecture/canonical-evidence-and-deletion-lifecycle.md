# Canonical evidence and deletion lifecycle

This document describes the implementation landed in Issue #81, not an ideal
future design. Schema versions: v57 (`evidence_lineage`), v58
(`morrow_mood_contributions`), v59 (investigations).

## 1. Evidence node

An evidence node is one of:

| Source table | Owner | Origin rule |
| --- | --- | --- |
| `event_journal` | `morrow` for `cognition.knowledge_gap` and `inner.thought.*`; `user` when actor is user or module is memory; otherwise `system` | A node with `payload.parentEvidenceIds` is derived and contributes its parents, not its own identity. |
| `memories` | `user` | Must be `status='active'` and not deleted/retracted in `deletion_journal`. |
| `self_model_entries` | `system` | Must be `status='active'`. |
| `evidence_lineage` | recorded owner | `origin` has no parents and `root_source_id = node_id`; derived nodes must resolve every parent. |

`cognition.knowledge_gap` events are the root of Morrow's own epistemic
failure. A reflection decision event is **not** an origin: it is derived and
needs persisted lineage, otherwise the chain is broken.

## 2. The lineage table

`evidence_lineage` (v57) is the queryable/indexed structure:

```
node_id, owner, root_source_id, correlation_group_id, derivation_kind,
source_table, state, parent_ids_json, verified_at, created_at
```

Indexes: root, cluster, `(owner, state)`. JSON remains available in the state
rows as a payload, but the graph edges live here.

When the gate first verifies an origin it writes an `origin` row lazily. When
it accepts a finding it writes the decision event as a `reflection` node whose
parents are the finding's raw evidence ids.

## 3. Recursive validation

`ReflectionStateGate.verifyNode(id, visited, depth)`:

1. Reject `depth > 8` and any id already on the current path (cycle).
2. If a lineage row exists:
   - reject `state != active` (retracted/deleted);
   - reject `synthetic`;
   - for `origin`, require no parents and `root_source_id = node_id`;
   - for derived nodes require at least one parent, every parent resolves, no
     parent root has another owner, and the recorded root/cluster is one the
     chain actually proves.
3. Otherwise resolve from the persisted source table (`event_journal`,
   `memories`, `self_model_entries`), check lifecycle state, then persist an
   origin row.
4. Any missing/unknown id returns `null`; the caller rejects the finding with a
   stable reason (`evidence_lineage_unverified`, `cross_owner_evidence`,
   `caller_root_mismatch`, `caller_correlation_mismatch`).

Independence is `distinct correlationGroupId` over verified roots. One root
cited by 100 reflection runs is one cluster; two conversations are two.

## 4. Deletion and retraction

Live conversation delete (`CompanionService.deleteConversation`):

```
conversation row delete
  -> emotions.deleteConversation       (rebuild from remaining events)
  -> traits.deleteConversation         (recompute observations)
  -> mood.deleteConversation           (delete that source's impulses, replay)
  -> innerCognition.deleteConversation (delete thoughts + retract states)
  -> trace cleanup
```

Startup, before the chat service is available:

```
schema migration
  -> relationship orphan reconcile
  -> deletion_journal replay into affect + inner cognition
  -> self-state lineage revalidation
  -> investigation deadline recovery
  -> interrupted turn recovery
  -> cognitive outbox drain
  -> chat available
```

The journal merge rule is unchanged: for each `(entity, id)` the newer
`recorded_at` wins; an equal timestamp keeps the live row. The replay is
idempotent.

## 5. Mood as a replayed projection

Every applied impulse is a row with the conversation id, the emotion event id,
the applied time and the four deltas. Pause, resume and clear are markers. A
checkpoint captures the pre-v58 state or an explicit reset. Replaying from the
last checkpoint applies impulses, freezes during pause markers, does not
catch up paused time, and advances to `now` at the end. Deleting a source
removes only that source's impulses and replays the rest.

This is a deterministic attribution ledger, not a claim that mood is a
subjective state. There is no statistical/probabilistic interpretation.

## 6. Known limits (do not read as complete)

- `reflection_findings` and `reflection_finding_routes` are not physically
  deleted with a conversation; they are prevented from promoting through a
  deleted subject, but row purge is still missing.
- The event journal is append-only by design. Events whose subject memory or
  conversation is deleted are rejected at validation; the event text itself
  remains in the journal (it contains no raw chat body).
- Outbox tasks that were already pending when a source is deleted are
  re-checked by the source-validity call inside the gate, but there is no
  global "cancel every outbox row for this source" sweep.
- Backup restore merges the journal and replays at startup; it does not rebuild
  every historical projection in one transaction.
