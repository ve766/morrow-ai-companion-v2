# 证据 lineage、删除与恢复（Issue #78）

## 数据契约（当前实现）

Reflection evidence ref（JSON in `morrow_self_states.evidence_json`）：

```json
{
  "findingId": "...",
  "runId": "...",
  "kind": "memory_gap|bias_hint|...",
  "createdAt": "...",
  "rootSourceId": "real event/message id",
  "correlationGroupId": "root or explicit cluster",
  "owner": "user|morrow|shared|system",
  "derivationKind": "reflection",
  "parentEvidenceIds": ["..."]
}
```

Thought evidence (`ThoughtEvidence`) additionally has `synthetic`, `origin`, `derivationKind`, `parentEvidenceIds`.

## Ownership rules enforced

- `resolveOwner(id)` queries `event_journal`:
  - `cognition.knowledge_gap` / `inner.thought.*` → morrow;
  - actor user or source memory → user;
  - else system.
- `memories` → user; `self_model_entries` → system; unknown → reject.
- Gate requires every raw ref resolvable and owner=morrow; otherwise rejected `legacy_unverified`/`ownership_or_provenance_rejected`.
- Synthetic thought refs (`synthetic:true`, empty IDs) never count as independent contexts and never feed reward.

## Independence

`N_eff = distinct(correlationGroupId)` over evidence refs; runId/findingId never counts. Same root + 100 findings → 1 root (test). Different roots → 2.

## Deletion

- `InnerCognitionService.deleteConversation` removes thoughts citing the conversation and retracts states citing it (same transaction).
- `AffectLoopService.deleteConversation` deletes emotion events + trait observations, rebuilds emotion projection; reward/mood not rebuilt per source.
- `cognitive_outbox` message-delete trigger cancels queued work.
- Reflection findings/routes are not yet reconstructed on conversation deletion → PARTIAL.
- Mood is a global projection with no per-source contribution ledger; deletion cannot deterministically rebuild it → PARTIAL.

## Recovery

- Thought/state JSON is append-only/revisioned; service restart reads DB.
- Outbox replay idempotent as before.
- Missing/forged root test: rejected, no state.

## 未完成

- 完整递归 DAG/cycle/cross-owner/retracted root 校验；
- root deletion → all dependent findings/thoughts/states/mood/outbox recompute;
- one canonical source-validity query used by Reflection, Thought, Self-State, Mood, Outbox.
