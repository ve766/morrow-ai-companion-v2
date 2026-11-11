# P0 evidence/deletion acceptance matrix (Issue #83)

- Code SHA: `b229c1ae3005dbee2790e208df258363867a1b8d`
- Base: `dc2743d7a3877a56db4d3d3bb55feb574dc1a8e8`
- Environment: Windows 10.0.26200 x64, Node 22.23.2
- Logs: `docs/reports/results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/`

Status is per scenario. `PASS` = executed with a real database/service and the
stated assertion; `PARTIAL` = the named scenario ran but a sub-scenario is
missing; `NOT_RUN` = no current product surface.

## A. Evidence lineage

| # | Scenario | Evidence | Status |
| ---: | --- | --- | --- |
| 1 | origin → one reflection → multi-level thought/derived event reaches the same root | `reflection-state-gate.test.ts` “follows a multi-level event parent chain” | PASS |
| 2 | one valid UUID + one illegal string is rejected as a whole | “rejects a parent list that mixes…” | PASS |
| 3 | missing, null, object, string, empty array, duplicate, oversized: no damaged record becomes origin | “treats null, object, string, duplicate…” and “rejects a thought event with an empty or absent parent list” | PASS |
| 4 | cycle, broken parent, depth > 8 | “rejects a cyclic chain”, “broken chain”, “deeper than the maximum depth” | PASS |
| 5 | child/parent owner mismatch | “rejects a chain that mixes a Morrow root with a non-Morrow source” | PASS |
| 6 | child subject deleted/retracted while parent is active | “checks the event's own invalid subject before following an active parent”, “event whose memory subject was deleted” | PASS |
| 7 | forged root/correlation | “rejects caller-supplied correlation or root values” | PASS |
| 8 | same root through 100 runs = one independent source | “collapses many findings from the same root source into one independent root” | PASS |
| 9 | two distinct valid roots meet the independence gate; invalid support does not | “creates a candidate … promotes after two independent roots”; revalidation test | PASS |
| 10 | synthetic never counts as an independent origin | “rejects a synthetic lineage node even when its parents are valid” | PASS |

## B. Delete / retract / rebuild

| # | Scenario | Evidence | Status |
| ---: | --- | --- | --- |
| 1 | real conversation through Mood/Reflection/Thought/Interest projections, then delete | mood-service delete/replay tests + `inner-cognition.deleteConversation` tests are separate; the P0-C integration builds conversation/message/outbox/ledger/self-model, not all four projections in one turn | PARTIAL |
| 2 | delete one message and whole conversation separately | no user-facing single-message delete exists in this runtime; whole conversation path is tested | NOT_RUN for single message |
| 3 | inspect all derived tables, lineage, outbox, ledger, pending, cache/retrieval | `p0-evidence-deletion.integration.test.ts` “invalidates lineage, findings, routes, outbox, ledger and self-model rows” | PASS |
| 4 | deleted content absent from next ContextAssembler/Provider payload | “removes a memory sourced only by the deleted conversation from the next Provider payload” (positive and negative payload assertion) | PASS |
| 5 | remaining valid source rebuild; only its contribution remains | mood single-source replay test; memory “other valid evidence” scenario not separately built | PARTIAL |
| 6 | all sources gone → content zero or non-readable tombstone | memory retracted + payload exclusion; self-state retraction tests | PASS |
| 7 | repeat, restart, startup replay, backup restore identical | repeat invalidation idempotent; startup pending replay test; existing backup suite; combined restore+fault injection not separate | PARTIAL |
| 8 | delete vs worker race cannot revive/commit | pending cancellation test; `stage5-final-audit-repair.multiprocess` delete-during-claim test; outbox post-check | PASS |

## C. Startup fail-closed

| # | Scenario | Evidence | Status |
| ---: | --- | --- | --- |
| 1 | empty journal → ready | P0-A test first retry/second reconciliation | PASS |
| 2 | pending deletion → replay before ready | “replays a pending conversation deletion before reporting ready” | PASS |
| 3 | journal/revalidation/investigation fault → locked, no Provider request | P0-A two tests; `ChatService.send` rejects `COGNITION_LOCKED`, provider calls 0 | PASS |
| 4 | repair + retry → ready, no message/memory loss | same P0-A test sends after retry; conversation history remains | PASS |
| 5 | backup restore uses the same gate | existing `backup-service.test.ts` restore/journal merge suite + same startup function; no combined restore-lock injection | PARTIAL |
| 6 | UI/IPC shows reason and retry | `MorrowBridge.cognition.consistency/reconcile`, IPC handlers, `#cognition-consistency` banner/text and retry button; `ui-control-contract`/typecheck | PASS (UI smoke pending) |

## D. Inner Cognition crash/retry

| # | Scenario | Evidence | Status |
| ---: | --- | --- | --- |
| 1 | crash before/inside/after assistant commit, before/inside projection, before ledger/done | assistant `afterPersist` rollback test; multiprocess claim/lease/delete tests cover process death at claim and projection boundaries; not every individual instruction point is injected | PARTIAL |
| 2 | restart recovers without loss or duplicate thought/evidence | multiprocess takeover test; same-message drain replay | PASS |
| 3 | same message drained 10× → one logical effect | P0-D “drains the same message ten times” | PASS |
| 4 | deleted source cancels pending/processing obligation or rejects before commit | P0-C pending cancel + post-projector source check + multiprocess delete-during-claim | PASS |
| 5 | expired lease can be taken over; old worker cannot mark done | P0-D lease test and multiprocess “old worker whose lease was stolen” | PASS |

## E. Full regression

| Check | Result | Evidence |
| --- | --- | --- |
| typecheck | PASS | `docs/reports/results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/typecheck.txt` |
| targeted tests | PASS | gate 21, P0 11, affected existing suites |
| full Vitest | PASS, two consecutive runs | 151 files / 1295 tests each; logs in results directory |
| build | PASS | `build.txt`, main/preload/renderer emitted |
| chat smoke | PASS (built, installed, portable); consistency IPC reports ready | `chat-smoke-*.json` |
| Windows package | PASS: install exit 0, app started, chat PASS, uninstall exit 0 | `windows-install-uninstall.txt` |
