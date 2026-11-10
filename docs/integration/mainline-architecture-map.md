# Mainline architecture map (Stage 1)

Integrated code SHA: `def61eab532e88bfaf8e0a3096176d66d65cc84f`.
Database schema: v59.

## Module boundaries

| Boundary | Owner | Contract |
| --- | --- | --- |
| Conversation and streaming UI | `src/conversation/*`, `src/app/companion-service.ts`, `src/renderer/*` | One turn = user message + assistant message; `afterPersist` runs inside the assistant transaction. |
| Memory | `src/memory/*` | `MemoryService.assembleContext` is the only prompt memory builder; lexical/fact-slot/RRF/utility filters stay in `MemoryContextAssembler`. |
| Evidence and self-state | `src/self-model/*`, `src/persistence/evidence_lineage` | `ReflectionStateGate` is the only writer of Morrow self-state revisions; lineage is the only trust graph. |
| Affect / mood | `src/affective-state/*` | Emotion events and revisions are a fold; mood is a replayed contribution ledger; traits are a separate evidence-gated intrinsic ledger. |
| Reflection / investigation | `src/self-model/reflection-*`, `investigation.ts` | Findings are hypotheses; investigation steps are durable; neither writes personality directly. |
| Outbox / effects | `src/app/cognitive-outbox.ts`, `effect-ledger.ts` | One queue; stable keys; lease fencing; source validity checked before and after a projector. |
| Provider | `src/providers/*` | Provider adapters are outside identity/personality; consent and credentials are separate. |
| Persistence | `src/persistence/migrations.ts` | Forward-only migrations; v59 current; no reset/clear path for acceptance. |

## Turn dataflow

```
renderer form -> preload -> IPC -> ChatService.send
  -> cognition consistency assertReady()
  -> user message append
  -> memory/context assembly (source-valid records only)
  -> provider request (consent preview + decision)
  -> stream deltas to renderer
  -> assistant append transaction:
       innerCognition.observeTurn (savepoint)
       affect.recordCompletedTurnInTransaction
       outbox.enqueue(refs only)
  -> outbox drain: source-valid check, projector, effect ledger, done
  -> next turn sees only committed projections
```

## Deletion dataflow

```
source delete/retract
  -> deletion_journal (transactional with source row)
  -> SourceValidityService:
       recursive lineage invalidation
       findings/routes/pending removal
       outbox cancel + effect ledger terminal_failed
       turn/relationship/context projection removal
       memory/self-model retraction and fact/interest cleanup
       reflection-gate revalidation
  -> next context assembly and Provider payload exclude the content
```

Startup runs deletion replay, lineage revalidation and investigation recovery
before chat is available. Failures lock cognition; the renderer displays the
reason and a retry; the scheduler and outbox drain are suspended while locked.

## P0 residual fixes in this line

- C1: `ChatService.drainCognition` returns without projecting while locked; the
  index scheduler also returns.
- C2: source-validity cleanup ignores only “no such table” (optional schema),
  and rethrows busy/I/O/closed-database failures.
- C3: a derived event's actor/owner and non-null correlation must agree with
  the verified parent chain; user/memory actors cannot inherit a Morrow chain.
- C4: memory deletion/retraction recurses through lineage descendants, not
  only the root id.

## Not yet in the map

- The PR #1 semantic/hybrid retrieval candidate channel and its benchmark.
- Early memory-reliability fixes that are unique to the diverged branches.
- Stage 3–6 file-level reconciliation (only commit-lineage inheritance is
  proven in Stage 1).
- A real cloud Provider run (`BLOCKED_NO_SECRET`).
