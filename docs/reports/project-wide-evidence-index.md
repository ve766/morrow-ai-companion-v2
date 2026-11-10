# Project-wide evidence index (Issue #81)

- Repository: https://github.com/ve766/morrow-ai-companion-v2
- Branch: `fix/morrow-project-wide-final-convergence-20261110`
- Final code SHA: `60ae6fe11e751bd7e5b80df942d231eade98b8eb`
- Base: PR #80 head `094ca2cf35b84e5a342becf0508db2ec6287079e`
- Draft PR: https://github.com/ve766/morrow-ai-companion-v2/pull/82

## Commits (code, oldest first)

| Commit | Purpose |
| --- | --- |
| `a7d7b60` | F4 G2-only growth projector; F3 inner observation inside the assistant transaction |
| `9e2ed28` | F1 `evidence_lineage` v57 + recursive gate + 8 new tests |
| `60ef3b8` | F2 mood contribution ledger v58 + deletion replay + self-state revalidation |
| `d424409` | F5 investigation lifecycle v59 + scheduler wiring |
| `fceb567` | F6 fixed-dataset benchmark script |
| `60ae6fe` | Emotion fixture timeline isolation (test-only) |
| `a83c36c` | Final report, matrices, algorithm/architecture notes and run logs |

## Source changes

- [reflection-state-gate.ts](../../src/self-model/reflection-state-gate.ts)
- [migrations.ts](../../src/persistence/migrations.ts) — v57, v58, v59
- [mood-service.ts](../../src/affective-state/mood-service.ts)
- [affect-loop.ts](../../src/affective-state/affect-loop.ts)
- [investigation.ts](../../src/self-model/investigation.ts)
- [inner-cognition.ts](../../src/self-model/inner-cognition.ts)
- [companion-service.ts](../../src/app/companion-service.ts)
- [index.ts](../../src/app/index.ts)
- [startup-composition.ts](../../src/app/startup-composition.ts)

## Tests and logs

- [reflection-state-gate.test.ts](../../src/self-model/reflection-state-gate.test.ts) — 14 tests
- [investigation.test.ts](../../src/self-model/investigation.test.ts) — 6 tests
- [mood-service.test.ts](../../src/affective-state/mood-service.test.ts) — 7 tests
- [stage3-remediation.integration.test.ts](../../src/app/stage3-remediation.integration.test.ts) — 6 integration tests
- [run-2 summary](results/project-wide/run-20261110T0630Z-60ae6fe/vitest-run-2.txt)
- [run-3 summary](results/project-wide/run-20261110T0630Z-60ae6fe/vitest-run-3.txt)
- [typecheck log](results/project-wide/run-20261110T0630Z-60ae6fe/typecheck.txt)
- [build log](results/project-wide/run-20261110T0630Z-60ae6fe/build.txt)
- [installed chat smoke](results/project-wide/run-20261110T0630Z-60ae6fe/chat-ui-smoke-installed.json)
- [portable chat smoke](results/project-wide/run-20261110T0630Z-60ae6fe/chat-ui-smoke-portable.json)
- [built chat smoke](results/project-wide/run-20261110T0630Z-60ae6fe/chat-ui-smoke-built.json)
- [Windows install/uninstall log](results/project-wide/run-20261110T0630Z-60ae6fe/windows-install-uninstall.txt)

## Fixed deliverables

- [History and branch lineage](audit/project-wide-history-and-branch-lineage.md)
- [Root cause and fix matrix](audit/project-wide-root-cause-and-fix-matrix.md)
- [Canonical evidence and deletion lifecycle](architecture/canonical-evidence-and-deletion-lifecycle.md)
- [Companion runtime dataflow](architecture/companion-runtime-dataflow.md)
- [Personality adaptation separation](algorithms/personality-adaptation-separation.md)
- [Autonomous investigation lifecycle](algorithms/autonomous-investigation-lifecycle.md)
- [Memory retrieval benchmark](algorithms/memory-retrieval-benchmark.md)
- [Acceptance matrix](testing/project-wide-acceptance-matrix.md)
- [Final delivery report](reports/project-wide-final-delivery.md)

## Machine results

- [Project-wide machine results](../../evals/project-wide/results/2026-11-10T06-40-00Z-60ae6fe11e751bd7e5b80df942d231eade98b8eb.json)
- [Memory benchmark raw JSON](../../evals/memory-retrieval/benchmark/2026-11-10T06-31-17-730Z-60ae6fe11e751bd7e5b80df942d231eade98b8eb.json)

## Windows artifacts (build machine, not committed)

| Artifact | Path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Installer | `C:\morrow-out\Morrow-2.0.0-x64-custom-setup.exe` | 158,332,209 | `80c15fb5aac6e54bd1aab92226b31c345ea9d490da6f33f751b5e570c202f7a9` |
| Portable | `release\Morrow-2.0.0-x64-portable-final.zip` | 162,762,914 | `276cc9aba550fdc62d0cbd266fe970797e257013229fc463723309c4fe48148c` |

Install path during verification: `C:\morrow81test` (removed by uninstall).
Portable extraction: `C:\morrow81portable`.

## Provider evidence

- Cloud: `BLOCKED_NO_SECRET` — no `MORROW_TEST_API_KEY` or `DEEPSEEK_API_KEY`
  present. No cloud result is claimed.
- Loopback: built, installed and portable chat smokes each recorded 1 request
  and a persisted user+assistant pair.
- Native consent: `PENDING_HUMAN` — the packaged run recorded `auto:false`,
  `grant:false`, then a remembered grant; no human click was independently
  observed.
