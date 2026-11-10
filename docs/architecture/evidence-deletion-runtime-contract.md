# Evidence and deletion runtime contract (Issue #83)

Code SHA: `b229c1ae3005dbee2790e208df258363867a1b8d`. Schema v59.

## 1. Canonical evidence contract

| Field | Contract |
| --- | --- |
| `evidenceId` | A real persisted id (event, memory, self-model entry, or lineage node). Never a random placeholder. |
| `owner` | `user`, `morrow`, `shared` or `system`, derived from the persisted source/actor, never defaulted. |
| `originType` | Event type / memory / self-model entry. |
| `rootSourceId` | The verified origin node. For an origin row it equals `node_id`. |
| `parentEvidenceIds` | Complete list; malformed/duplicate/oversized is rejected. Absent and empty are distinct parse results. |
| `correlationGroupId` | Verified cluster; one root through 100 runs remains one cluster. |
| `derivationKind` | `origin`, `reflection`, `thought`, `summary`, `synthetic`. |
| `state` | `active`, `retracted`, `deleted`. |
| `createdAt` | Persisted write time; processor version is the owning service's constant. |

## 2. Verification

```
verifyNode(id, path, depth):
  depth > 8                 -> reject parent_depth_exceeded
  id in path                -> reject parent_cycle
  lineage row:
    state != active         -> reject evidence_lineage_unverified
    malformed parent JSON   -> reject malformed_parent_chain
    synthetic               -> reject derived_origin_forbidden
    origin                  -> require no parents and root == node
    derived                 -> require complete valid parents; verify all;
                               owner consistent; recorded root/cluster in result
  else persisted event:
    own subject invalid     -> reject self_invalidated
    malformed payload/parents -> reject malformed_parent_chain
    has valid parents       -> verify all (derived)
    derived event family with no parents -> reject derived_origin_forbidden
    otherwise origin: real event row required, owner/root/cluster derived
  memory / self-model entry: require active status and no deletion boundary
```

`ReflectionStateGate.ingestInTransaction` rejects on the first failure and
records a stable `reason` in `event_journal`. It never logs user text.

## 3. Deletion propagation

`SourceValidityService.invalidateConversation(id)` runs in one transaction:

1. collect turn ids from messages/outbox, message ids and correlated event ids;
2. recursively mark lineage nodes deleted, including descendants found through
   `parent_ids_json`;
3. delete invalid reflection findings/routes and drop related pending items;
4. delete conversation/turn-scoped projections;
5. cancel outbox rows, terminal-fail ledger rows, clear claims;
6. retract memories whose only evidence was this conversation and delete their
   facts;
7. retract self-model entries; cancel goals sourced from deleted messages;
8. invoke the reflection-gate revalidation hook;
9. append a count-only `source.invalidated` audit event.

`invalidateMemory(id, state)` marks lineage `retracted|deleted`, deletes
memory evidence/fact/interest evidence and revalidates. `restoreMemory(id)`
revives only the explicit origin row; derived rows stay invalid until a new
derivation, which is the safe direction.

## 4. Outbox / effect ledger

- Enqueue and the assistant message share a transaction.
- A pending row whose message or conversation no longer exists is cancelled;
  its effect ledger row becomes `terminal_failed` with
  `source_invalidated` and its claim is cleared.
- Before a projector runs and after it returns, source validity is checked.
  If deletion won the race, invalidation is re-run and the row is cancelled.
- Completion requires the held `lease_generation`; an old worker cannot mark
  the new owner's effect applied. Existing lease/backoff/multiprocess tests
  remain authoritative.

## 5. Startup fail-closed order

```
schema migrations
  -> relationship orphan reconcile
  -> reconcileCognitionConsistency:
       deletion journal replay
       -> source invalidation + affect/inner conversation cleanup
       -> self-state revalidation
       -> investigation deadline recovery
  -> lock on any reason, ready only if all succeeded
  -> interrupted turn recovery
  -> outbox drain
  -> chat available
```

While locked: `ChatService.send` throws `COGNITION_LOCKED` before provider
configuration; the inner scheduler returns; the renderer shows the reason and
the retry button. The retry runs the same function and unlocks on success.
Other read-only diagnostics and backup export remain available.

## 6. Data lifecycle policy

- Physically deleted: derived rows that contain only derived text (lineage
  edges, findings, routes, pending items, outbox/effects, turn context,
  relationship evidence, interest evidence, fact records, personalization
  signals).
- Retracted tombstone: memories and self-model entries that may hold
  user-authored content; they are not readable by context assembly while
  retracted, and the user can inspect/restore through the normal UI.
- Audit: `source.invalidated` stores counts and ids, never statements, prompts
  or message bodies.
- Backups: the deletion journal merge rule is unchanged; restore relaunches
  into the same startup gate.
