# Project-wide history and branch lineage (Issue #81)

Generated: 2026-11-10. Repository: `ve766/morrow-ai-companion-v2`.

## 1. The line this task builds on

The remote state was verified before starting:

| PR | Head branch | Head SHA | Base branch | State |
| --- | --- | --- | --- | --- |
| #77 | `fix/core-subjectivity-final-closure-20261109` | `1b7ba085fba4c46086028b611be615dc871d6c66` | `fix/whole-product-subject-closure-20261108` | OPEN, Draft |
| #80 | `fix/audit-driven-companion-remediation-20261109` | `094ca2cf35b84e5a342becf0508db2ec6287079e` | `fix/core-subjectivity-final-closure-20261109` | OPEN, Draft |

Issue #81 starts from PR #80's head `094ca2cf35b84e5a342becf0508db2ec6287079e` on
`fix/morrow-project-wide-final-convergence-20261110`. Neither #77 nor #80 is
merged, closed, rewritten or force-pushed by this work. The new branch is a
normal descendant; the PR base is PR #80's head branch, so the stack remains
readable.

## 2. Earlier capability inheritance

| Historical line | What it contained | Decision for this line |
| --- | --- | --- |
| PR #1 (`retrieval/onnx-semantic-encoder.ts`, `retrieval-semantic.ts`, `retrieval-v2.ts`, `retrieval-registry.ts`) | A real ONNX embedding channel with model lifecycle and registry. | **Not ported in this task.** The current runtime has no ONNX model file, no `onnxruntime` dependency and no call site. Porting the encoder alone would be a dead file. The safe alternative is the production lexical + fact-slot + RRF path measured in F6. The blocker and the measured baseline are recorded in `docs/algorithms/memory-retrieval-benchmark.md`. |
| PR #3/#4/#6/#8/#15 | Early memory/cognition loop experiments. | Kept only where they already survived into the current `MemoryService`, fact index and context assembler. No historical file was copied without a call site. |
| PR #64 | Persistent self-model and authorisation assets. | Current `self_model_entries`, consent grants and evidence gates are the descendants; this task adds lineage validation on top rather than a second model. |
| PR #62/#65/#66/#68 | Product line, migrations, cognitive workspace, companion UI. | This is the runtime line the Windows package is built from. |
| PR #74/#76/#77/#78/#80 | Affect, reflection gate, inner cognition, deletion, mood. | Preserved; this task fixes four of their explicitly admitted gaps and records the remaining ones honestly. |

## 3. Why the older semantic code is not silently ignored

The requirement is "recover, or prove a blocker and give a safe alternative".
The code evidence for the blocker is:

- `package.json` has no `onnxruntime-node`/`onnxruntime-web` dependency.
- `src/memory/` has no `onnx` or `semantic` production module in this line.
- The context assembler's channels are lexical, fact-slot, value/time and
  conflict/retraction filters (`src/memory/memory-context-assembler.ts`);
  there is no model loader to call.
- An untrained or missing model would make "semantic recall" a fixture that
  cannot run on a user's installed app, which the task explicitly forbids.

The safe alternative is the measured lexical path. It never uses similarity to
override correction, retraction, sensitivity or conflict rules; F6 shows the
retraction and sensitivity leak counts are zero and separately exposes the
lexical near-miss rate (the `行星`/`系外行星` confusion) instead of hiding it.

## 4. Branch and commit chain

```
094ca2c  PR #80 head (base of this task)
└─ a7d7b60  F4 G2-only growth + F3 inner observation in the message transaction
   └─ 9e2ed28  F1 evidence lineage graph (schema v57)
      └─ 60ef3b8  F2 mood ledger + deletion replay + self-state revalidation (v58)
         └─ d424409  F5 investigation lifecycle (v59)
            └─ fceb567  F6 memory retrieval benchmark
               └─ 60ae6fe  test isolation for the emotion fixture
                  └─ docs commits (this report set)
```

`60ae6fe11e751bd7e5b80df942d231eade98b8eb` is the **final code SHA** used for
the Windows package and the machine results. Later documentation commits change
the branch head but not the runtime code; the delivery report states both SHAs.

## 5. Unchanged constraints

- `main` is untouched.
- PR #54 is untouched.
- No Issue is closed; no Release is published.
- No force-push and no history rewrite.
- PR #77/#80 remain open, draft, and at their original heads.
