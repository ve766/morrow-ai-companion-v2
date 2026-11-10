# Mainline asset convergence evidence index (Stage 1)

- Repository: https://github.com/ve766/morrow-ai-companion-v2
- Branch: `integration/morrow-mainline-asset-convergence-20261110`
- Initial main: `8b207b7d7b80b91ed4369d02fd6ef7e170b81133`
- Product tip integrated: `4bf63efaa78649588f5c5ae2ee4ed5795bb11e18`
- Stage 1 code SHA: `def61eab532e88bfaf8e0a3096176d66d65cc84f`
- Schema: v59

## Inventory and decisions

- [Mainline asset inventory](../integration/mainline-asset-inventory.md)
- [Branch inheritance matrix CSV](../integration/branch-inheritance-matrix.csv)
- [Architecture map](../integration/mainline-architecture-map.md)
- [Conflict and migration decisions](../integration/conflict-and-migration-decisions.md)
- [Integration acceptance](../testing/mainline-integration-acceptance.md)
- [Delivery report](mainline-asset-convergence-delivery.md)

## Source changes

- [companion-service.ts](../../src/app/companion-service.ts) — drain lock, delete propagation, inner observation transaction
- [source-validity.ts](../../src/persistence/source-validity.ts) — recursive invalidation, DB-error propagation
- [reflection-state-gate.ts](../../src/self-model/reflection-state-gate.ts) — strict parent/owner/correlation checks
- [p0-evidence-deletion.integration.test.ts](../../src/app/p0-evidence-deletion.integration.test.ts) — C2/C4 fault tests
- [reflection-state-gate.test.ts](../../src/self-model/reflection-state-gate.test.ts) — C3 tests

## Logs

- [run directory](results/mainline-asset-convergence/run-20261110T1704Z-def61ea/)
- [full Vitest](results/mainline-asset-convergence/run-20261110T1704Z-def61ea/vitest.txt)
- [typecheck](results/mainline-asset-convergence/run-20261110T1704Z-def61ea/typecheck.txt)
- [build](results/mainline-asset-convergence/run-20261110T1704Z-def61ea/build.txt)
- [chat smoke](results/mainline-asset-convergence/run-20261110T1704Z-def61ea/chat-smoke-built.json)
- [raw branch inventory](results/mainline-asset-convergence/run-20261110T1704Z-def61ea/branch-inventory.csv)
- [raw PR metadata](results/mainline-asset-convergence/run-20261110T1704Z-def61ea/prs.json)

## Machine results

- [Stage 1 JSON](../../evals/mainline-asset-convergence/results/2026-11-10T17-10-00Z-def61eab532e88bfaf8e0a3096176d66d65cc84f.json)

## Explicit non-claims

- main was not modified; no merge to main was performed.
- No Windows package at `def61ea`; the b229 package is stale.
- Semantic retrieval and early memory reliability are not ported in Stage 1.
- CI is manual-only and was not triggered.
