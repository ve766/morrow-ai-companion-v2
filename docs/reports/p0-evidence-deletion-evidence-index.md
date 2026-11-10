# P0 evidence/deletion evidence index (Issue #83)

- Repository: https://github.com/ve766/morrow-ai-companion-v2
- Branch: `fix/morrow-p0-evidence-deletion-closure-20261110`
- Base: `dc2743d7a3877a56db4d3d3bb55feb574dc1a8e8` (PR #82 head)
- Final code SHA: `b229c1ae3005dbee2790e208df258363867a1b8d`
- Schema: v59

## Code

- [cognition-consistency.ts](../../src/app/cognition-consistency.ts) — ready/locked gate and `COGNITION_LOCKED`
- [cognition-reconciliation.ts](../../src/app/cognition-reconciliation.ts) — startup replay/revalidate/recovery gate
- [source-validity.ts](../../src/persistence/source-validity.ts) — recursive lineage invalidation and domain cleanup
- [reflection-state-gate.ts](../../src/self-model/reflection-state-gate.ts) — strict parent parsing and stable reasons
- [cognitive-outbox.ts](../../src/app/cognitive-outbox.ts) — source-validity checks, cancellation
- [companion-service.ts](../../src/app/companion-service.ts) — send gate, delete propagation, inner observation in transaction
- [index.ts](../../src/app/index.ts) — startup gate, scheduler pause, IPC actions
- [companion-ui.ts](../../src/renderer/src/companion-ui.ts) — lock banner, reason, retry
- [preload/index.ts](../../src/preload/index.ts) — `cognition.consistency/reconcile`
- [contracts.ts](../../src/shared/contracts.ts) — IPC channels and status type

## Tests

- [reflection-state-gate.test.ts](../../src/self-model/reflection-state-gate.test.ts) — 21 tests
- [p0-evidence-deletion.integration.test.ts](../../src/app/p0-evidence-deletion.integration.test.ts) — 12 tests
- [stage5-final-audit-repair.multiprocess.test.ts](../../src/app/stage5-final-audit-repair.multiprocess.test.ts) — lease/claim/delete race
- [stage5-final-closeout.integration.test.ts](../../src/app/stage5-final-closeout.integration.test.ts) — deleted-source obligation cancelled
- [mood-service.test.ts](../../src/affective-state/mood-service.test.ts) — source deletion and replay
- [backup-service.test.ts](../../src/persistence/backup-service.test.ts) — journal merge/restore

## Logs

- [run directory](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/)
- [vitest run 1](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/vitest-run-1.txt)
- [vitest run 2](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/vitest-run-2.txt)
- [typecheck](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/typecheck.txt)
- [build](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/build.txt)
- [package](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/package.txt)
- [installed chat smoke](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/chat-smoke-installed.json)
- [portable chat smoke](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/chat-smoke-portable.json)
- [built chat smoke](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/chat-smoke-built.json)
- [Windows install/uninstall](results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/windows-install-uninstall.txt)

## Fixed documents

- [Root cause](audit/p0-evidence-deletion-root-cause.md)
- [Runtime contract](architecture/evidence-deletion-runtime-contract.md)
- [Acceptance matrix](testing/p0-evidence-deletion-acceptance.md)
- [Delivery report](reports/p0-evidence-deletion-delivery.md)

## Machine results

- [P0 machine JSON](../../evals/p0-evidence-deletion/results/2026-11-10T16-20-00Z-b229c1ae3005dbee2790e208df258363867a1b8d.json)

## Windows artifacts

| Artifact | Path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Installer | `C:\morrow-out\Morrow-2.0.0-x64-custom-setup.exe` | 158,336,891 | `ea8855e5f81e611a073889610deb5c2e5dcf048af30473498cb35d4cee645d6c` |
| Portable | `release\Morrow-2.0.0-x64-portable-p0.zip` | 162,767,754 | `6bc7a13e7b8645eb36fea4014709a09b00687824a0a94cbbd887d82ebd0ee635` |

Installed at `C:\morrow83test` (removed by uninstall); portable at
`C:\morrow83portable`. Neither directory existed before this run.
