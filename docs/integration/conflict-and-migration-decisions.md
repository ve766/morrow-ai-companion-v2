# Conflict and migration decisions (Stage 1)

## 1. Baseline and integration

- Actual main at execution: `8b207b7d7b80b91ed4369d02fd6ef7e170b81133`.
- The proposed execution branch existed remotely at the same SHA.
- The product line `fix/morrow-p0-evidence-deletion-closure-20261110` has main
  as an ancestor (`0` commits in main not in that branch; `375` ahead). The
  integration branch was therefore fast-forwarded to `4bf63ef`, not merged
  with a conflict resolution commit.
- This is a commit-graph integration, not a claim that every historical branch
  asset is runtime-complete. File-level checks and the unique divergent lines
  are tracked separately.

## 2. Why the P0 branch was not treated as final

PR #84 / Issue #83 was PARTIAL. Stage 1 accepted its product line as the
integration base but did not treat it as a safe final main baseline. Four
residual P0 defects were fixed on top:

| Defect | Decision |
| --- | --- |
| C1 locked state did not cover background outbox drain | `drainCognition` and the scheduler return while locked |
| C2 cleanup swallowed all SQL errors | only “no such table” is optional; other DB failures rethrow |
| C3 gate checked parents but not current actor/owner/correlation | derived actor/owner and correlation must agree with the parent chain |
| C4 memory lineage invalidated only the root | recursive descendant invalidation |

C5–C7 remain stage 4 verification items (full projection sweep, all crash
points, backup restore resurrection).

## 3. Divergent branches

No 50-way merge. Decisions:

- `feature/algorithm-v2-phase-a`: **PORT_AND_ADAPT** in Stage 2. The branch has
  19 unique commits and a real optional encoder/hybrid retriever. It is not a
  drop-in merge because current `MemoryService`/`MemoryContextAssembler` have
  changed; semantic signals must be a candidate channel feeding the current
  governance filters, not a replacement.
- `feat/phase-2.2-memory-reliability` and the 2.2.9/2.2.10 hardening branches:
  **PORT_AND_ADAPT** in Stage 2. Compare correction binding, provenance,
  migration fixtures and paraphrase admission against current code before
  porting; no second memory stack.
- `feat/ai-life-core-upgrade-20261107`: **REPLACED_WITH_PROOF** pending Stage 3
  equivalence. Current line has `self_model_states` and persistent consent
  grants; the unique branch adds a parallel service, which would create two
  state stores if copied blindly.
- `feat/stage-2-continuous-companion-cognition`: **PORT_AND_ADAPT** in Stage 3.
  Current line has turn-context schema 2 but a simpler shape; reconcile the
  fields without overwriting the newer repository.
- Audit/research/docs branches: **RESEARCH_ONLY**. PR #48 is merged only into
  the PR #40 feature branch; PR #49 is not a merge approval. Their findings
  remain evidence, not runtime.
- `infra/shared-real-model-test-contract`: **TEST_ONLY**; useful when a secret
  is available, no product behavior.

## 4. Migration rules

- No new migration was added in Stage 1.
- C1–C4 use existing schema v59 tables.
- No database was cleared, dropped or reset.
- Historical evidence with no proven source stays untrusted; the gate rejects
  it rather than upgrading it to Morrow.
- The final main PR will be blocked if a later stage changes runtime code
  without rebuilding tests/packages at the final SHA.

## 5. Conflicts to resolve in later stages

1. Semantic candidate channel vs current RRF/context utility ranking; must
   preserve correction, retraction, sensitivity, conflict and budget filters.
2. Memory reliability unique fixes vs current `MemoryService`; choose the
   stronger behavior per path, not the newer branch wholesale.
3. Self-model state service duplication (`self_model_entries`,
   `self_model_states`, `morrow_self_states`); define one read model.
4. Turn-context schema 2 field semantics.
5. Windows package rebuild after each runtime change; current b229 package is
   not valid for `def61ea`.
