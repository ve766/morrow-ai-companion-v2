# Companion runtime dataflow

Entry points: `src/app/index.ts` (Electron main), `src/app/companion-service.ts`
(ChatService), `src/renderer/src/*` (renderer), `src/preload/index.ts` (bridge).

## 1. A normal turn

```
renderer form submit
  -> preload window.morrow.chat.send
  -> IPC channel (typed contract in src/shared/contracts.ts)
  -> ChatService.send
     -> ConversationService: append user message (SQLite)
     -> MemoryService.assembleContext (lexical + fact-slot + RRF, filters)
     -> Provider request (remote HTTPS or loopback HTTP)
        -> consent: existing grant or native dialog; sensitive always dialog
     -> stream deltas back to renderer
     -> assistant message + inner observation + affect persist
        in one transaction (afterPersist)
     -> cognitive outbox obligation (projectors)
     -> trace/turn state committed
```

The assistant-message transaction now includes:

- `AffectLoopService.recordCompletedTurnInTransaction`: emotion event, trait
  observations, mood impulse, reward where applicable;
- `InnerCognitionService.observeTurn`: the turn's own thought candidate;
- the conversation row.

A failure inside that block rolls the message back. A process death after the
commit leaves the durable outbox to finish the projectors on the next start.

## 2. Post-turn cognition

`cognitive_outbox` stores projector obligations with an idempotency key. The
drain path runs on startup and after a turn; providers set the pending,
processing and committed states. Projectors write interests, reflection
routing, self-state candidates and G2 adaptation. The reflection state gate is
the only writer of Morrow-owned self-state revisions.

## 3. Startup order

See `docs/architecture/canonical-evidence-and-deletion-lifecycle.md` §4. The
order is deliberate: deletion facts are applied before any projection can feed
a prompt; lineage is revalidated before reflection can revise a state; overdue
investigations are suspended before the scheduler opens new ones; interrupted
turns are settled before the UI is shown.

## 4. Memory retrieval

`MemoryService.assembleContext`:

1. `listActiveForContext(1000)` — active, non-archived, newest-first window;
2. fact-index lookup and bare-value assertion channels;
3. per-record score: slot 1.0, lexical 1.0 (saturated at two terms), value 1.0,
   temporal 0.25, source 0.2;
4. hard filters: retracted/superseded/unauthorised, predicate policy,
   time-incompatible single-valued facts;
5. RRF fusion of lexical and slot channels (`k = 60`);
6. context-utility rerank (freshness/quality/conflict) and character budget.

There is no semantic/ONNX channel in this runtime. F6 measures this exact path.

## 5. Affect, mood, personality

- `emotion_events` is the append-only event ledger; `emotion_states` is a
  rebuildable projection; `emotion_revisions` keeps the before/after fold.
- `morrow_mood_state` is a four-axis continuous state advanced by elapsed time;
  `morrow_mood_contributions` attributes each impulse to its source.
- `morrow_trait_observations` and `morrow_trait_revisions` are the intrinsic
  trait ledger. Only Morrow-owned, evidence-gated observations may revise it.
- G1 `personality_growth_signals` is not written by the user-style projector;
  G2 `user_interaction_signals` is. The user-authored baseline is a third,
  separate field set.

## 6. Reflection and investigation

`ReflectionService.run` reads the event journal cursor, writes findings, and
`ReflectionFindingRouter` routes them to pending items/hints/state gate. The
gate verifies lineage and writes append-only self-state revisions.

`InvestigationService` records the local investigation of a synthesized
thought: discovered → selected → hypothesized → investigating → reviewing →
concluded/inconclusive/rejected/suspended. Steps carry source ids and a
`source_valid` flag. The scheduler feeds real CompanionGoal stalls; the review
closes the record from the same self-state outcome.

## 7. Provider and packaging

`provider_profiles` has a fixed DeepSeek remote row and a user-configured
local OpenAI-compatible row. The local row is classified `local`, so the
loopback egress gate applies. API keys live in Windows safe storage, not the
database or logs.

Packaging: `npm run build` → `out/`; electron-builder → `release/win-unpacked`;
custom NSIS (`makensis`) → installer; 7-Zip → portable zip. The acceptance
paths use an isolated `--user-data-dir` / `MORROW_LOCAL_ACCEPTANCE_USER_DATA`
and never touch `F:\morrow1`.
