# Later Extraction & Integration Plan

**Version:** 0.1.0-draft  
**Status:** no runtime integration authorized in this phase

## 1. Separation rule

This pack is being developed separately so the product can continue toward completion without adopting an unfinished operator framework. No code in this folder should be imported by the running application during this phase.

## 2. What may be extracted later?

Only components that have:
- a clear single responsibility;
- a stable, typed input/output contract;
- standalone tests and integration tests;
- documented limitations and failure behavior;
- comparative evidence of value;
- no dependency on this research folder's internal layout;
- a safe fallback and a migration plan if persistent data is affected.

## 3. Extraction steps

1. Identify the target production module and its current behavior.
2. Capture current behavior in regression fixtures.
3. Choose one proven operator or algorithm component.
4. Implement an adapter around existing production interfaces rather than rewriting unrelated modules.
5. Run the old and new implementations against the same fixture set.
6. Inspect exact provider payloads and persistence effects where applicable.
7. Keep the old path available behind a configuration switch until acceptance.
8. Merge only the smallest independently reviewable change.
9. Verify backup/restore, migration, privacy, and rollback requirements if storage is touched.
10. Update the product's algorithm index and change log after integration is accepted.

## 4. What must not be extracted blindly?

- Research-only interfaces that do not match production domain types.
- Model-dependent heuristics without deterministic fallback or explicit uncertainty handling.
- Any component whose only evidence is synthetic examples written by its author.
- Experimental internal-state updates without stability and rollback tests.
- Code that duplicates production memory persistence or bypasses consent/provider policy.

## 5. Integration milestone

Integration should wait until the product owner explicitly declares the relevant product milestone ready. Until then, this pack may be expanded and evaluated independently. A successful research-pack test does not automatically authorize production integration.
