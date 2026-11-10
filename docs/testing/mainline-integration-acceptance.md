# Mainline integration acceptance (Issue #85, Stage 1)

Code under test: `def61eab532e88bfaf8e0a3096176d66d65cc84f`
Base main: `8b207b7d7b80b91ed4369d02fd6ef7e170b81133`
Stage: **1 of 6** — inventory, baseline freeze, product-line integration,
C1–C4 remediation.

## Stage status

| Stage | Status | Evidence |
| --- | --- | --- |
| 1 Asset ledger / baseline / product integration | PARTIAL-DONE | 51 refs inventoried; main ancestor checked; product line fast-forwarded; C1–C4 fixed; inventory/matrix/conflict docs committed |
| 2 Semantic retrieval + early memory reliability | NOT_RUN | divergent branches identified and marked PORT_AND_ADAPT; no code port yet |
| 3 Companion/Cognitive Loop, Stage 3–6, PR #64 reconciliation | NOT_RUN | lineage-free audit pending |
| 4 P0 C5–C7 + unified lifecycle | PARTIAL | C1–C4 done; C5–C7 validation pending |
| 5 Provider + Windows final product | NOT_RUN at final main SHA | previous b229 package is not valid for def61ea |
| 6 Independent audit + final main PR | NOT_RUN | stage 1 PR only |

## A. Inventory coverage

- 51 refs fetched and recorded (50 non-main + main).
- Matrix: `docs/integration/branch-inheritance-matrix.csv`.
- Every branch has tip, merge base, ahead/behind main, unique-vs-product count,
  PR mapping and disposition.
- All ancestor branches are `INHERITED_IN_LINEAGE` by commit graph. This is not
  a runtime proof; Stage 3 owes the file/call-site map for Stage 3–6 and PR #64.
- 10 divergent branches are not merged: one semantic line, four memory
  reliability/trust lines, one companion-core line, two audit lines, one
  turn-context line, and research/test-only branches.

## B. Integration action

| Action | Result |
| --- | --- |
| `git merge --ff-only fix/morrow-p0...` into integration branch | success; main is an ancestor, no conflict |
| New runtime fixes C1–C4 | committed `def61ea` |
| Divergent code branches merged wholesale | none |
| Main directly modified | no |

## C. P0 residual checks

| Item | Status | Evidence |
| --- | --- | --- |
| C1 lock covers background outbox | PASS | `ChatService.drainCognition` early return; scheduler early return |
| C2 DB errors not swallowed | PASS | only `no such table` ignored; closed-DB test throws |
| C3 current node actor/owner/correlation | PASS | user/memory parent-owner test, unproven-correlation test |
| C4 recursive memory lineage | PASS | derived child marked retracted with parent |
| C5 full projection sweep | PARTIAL | source-validity covers current tables; stage 4 re-audit |
| C6 every crash point injected | PARTIAL | rollback + 10× replay + lease/delete multiprocess; not every point |
| C7 backup/restart/retry no resurrection | PARTIAL | startup replay + memory tombstone; combined restore fault injection pending |

## D. Real vertical acceptance

| Scenario | Status |
| --- | --- |
| 1 installed UI → IPC → Provider → SQLite → next prompt | PASS at b229 package; needs rebuild at final main SHA |
| 2 multi-turn / cross-session / paraphrase / correction / retraction | PARTIAL; current line has tests, semantic paraphrase not yet ported |
| 3 deletion DB/lineage/outbox/mood/reflection/thought/payload | PARTIAL; P0 tests cover current surfaces |
| 4 personality/adaptation separation, emotion rebuild | PARTIAL; G1 intrinsic writer still absent |
| 5 investigation lifecycle | PARTIAL; durable state machine, no external collector |
| 6 Provider switch identity continuity | PARTIAL; loopback/contracts, real cloud BLOCKED_NO_SECRET |
| 7 crash/restart/concurrent delete/retry/lease/restore | PARTIAL; C1–C4 tests plus multiprocess |
| 8 Windows isolated install/start/chat/upgrade/uninstall | PASS at b229; NOT_RUN at def61ea |

## E. Regression

| Command | Status |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| targeted gate + P0 tests | 23 gate + 14 P0 tests PASS |
| full `npx vitest run` | PASS: 151 files / 1299 tests |
| build | PASS, exit 0 |
| chat smoke | PASS at def61ea, including consistency IPC |
| Windows package | NOT_RUN at def61ea; previous b229 package is not valid |

## F. What must happen before a main PR can be called complete

1. Port or reject semantic retrieval and memory reliability with real
   benchmarks.
2. Reconcile Stage 3–6 and PR #64 at file/call-site level.
3. Complete C5–C7 and the full vertical acceptance.
4. Rebuild/test/package at the final code SHA.
5. Only then open a non-draft main PR after the user's review; this stage does
   not auto-merge.
