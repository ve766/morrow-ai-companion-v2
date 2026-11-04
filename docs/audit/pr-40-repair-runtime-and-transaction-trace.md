# PR #48 repair — runtime, state machine and transaction trace, round 2 (independent)

- Reviewed SHA: `e1219dc07d52c4458d27c9ec2b9adabb6ff2e173`
- Code SHA: `1f736c6b788527bbffad186267679b1df63ff0a1`
- Base: `052bcaa9c0320ef5e726c7bf66df85a49055628d`
- Reviewer reproduction: `.tmp/review2/repro.ts` (own script, production modules, real SQLite files), bundled with esbuild and run with Node 22.23.2. The script and logs are under gitignored `.tmp/`; key outputs are quoted here.

## 1. Call graph (actual code at `e1219dc`)

### 1.1 Startup

```
SqliteDatabase.open(path)
  -> applyMigrations (v47 -> v48); on failure keep >= v9 and mark cognitive unavailable
EventLogService
composeStartupReflectionServices(database, events)
  -> SqlitePendingItemRepository(database, events)      # audit sink required
  -> PendingCognitionService(repository)
  -> ReflectionFindingRouter({database, pending, events})
runStartupReflection({reflection, findingRouter, logger})
  -> reflection.run('startup')                  # one transaction: run/findings/effects/cursor
  -> findingRouter.ingestRun(run.id, findings)  # one transaction per finding
  -> findingRouter.recoverUnrouted()            # recovery sweep
  -> findingRouter.recordLifecycle(...)         # best-effort durable audit
  -> returns ran | skipped | failed | degraded
```

### 1.2 Manual reflection

`src/app/index.ts:457-467`:

```
runBounded(() => {
  summary = reflection.run('manual')
  if (!skipped) findingRouter.ingestRun(summary.id, reflection.findings(summary.id))
  return summary
})
-> completed: summary
-> skipped: { skipped: 'budget_exhausted' }
-> failed: throw ApplicationError('STORAGE_ERROR')
```

`runBounded` now preserves the caught error (`BoundedRunResult.error`), but `index.ts` does not
inspect it. A `PendingSchemaUnavailableError` from the repository is therefore still reported to the
renderer as `STORAGE_ERROR`, not `SCHEMA_UPGRADE_REQUIRED` (round-2 claim not implemented).

### 1.3 Post-conversation outbox

`src/app/companion-service.ts:994-1048`:

```
CognitiveOutbox.drain
  -> reflection projector
     -> reflection.run('post_conversation')
     -> skipped:
          recovered = recoverUnrouted()
          if recovered.failed > 0 -> throw REFLECTION_RECOVERY_INCOMPLETE
          return
     -> success:
          ingestRun(...)
          -> PendingSchemaUnavailableError: record cognition.pending_schema_unavailable; throw
          -> other error: throw
          (no recoverUnrouted call on success)
```

The rate-limited branch now keeps the outbox row retryable when recovery failed, and the schema case
rethrows after recording. My probe O confirms: first drain `failed=1`, row `pending, attempts=1`,
route null; second drain `done`, route `routed` after recovery.

**Remaining defect (P1-01):** the success branch does not call `recoverUnrouted`. If the first
ingest attempt failed transiently and the retry is not rate-limited, the retry's reflection run has
no new findings because the cursor advanced; `ingestRun([])` succeeds and the outbox marks the row
`done` while the failed finding still has no route. My probe O2 reproduces this with the real outbox,
real reflection service and real router. The finding has a durable `reflection.finding_ingest_failed`
record and a later startup/rate-limited recovery can repair it, but the outbox obligation is done and
no outbox retry occurs.

### 1.4 Pending decision

`src/app/ipc.ts:281` -> `src/app/index.ts:440` -> `PendingCognitionService.decide` ->
`SqlitePendingItemRepository.decide`:

```
transaction:
  item = get(id)                     # not_found if absent
  if item.status != open:            # unchanged | conflict
  if item.finding_id != null:
      exact route must exist and be mutable -> routeResolution='linked'
  UPDATE item WHERE status='open'
  if finding_id != null:
      UPDATE exact route          -> routesUpdated=1
  siblings = resolveLegacyRoutes(item)   # same kind + current/legacy statement digest
  if siblings.matched > 0:
      all matched mutable routes -> terminal
      routesUpdated += n
      routeResolution = finding_id ? 'linked_with_siblings' : 'resolved_by_concern'
  audit pending.decision (same transaction)
```

### 1.5 System closure (intent withdrawal)

`IntentReadingRepository.closeOpenItems` now opens a `SqlitePendingItemRepository` and calls
`resolveSystem` for every open `source='open_question'` item in the conversation:

```
resolveSystem(id, reason, at):
  transaction (nested SAVEPOINT when called from intent save):
    item must exist and be open
    if finding_id != null: exact route must exist and be mutable
    UPDATE item SET status='dropped', decision='dismissed', completed_at=...
    UPDATE exact route -> dismissed
    siblings = resolveLegacyRoutes(item)
    audit pending.system_dismissed (actor=system, decision=dismissed, routeStatus, routeResolution)
```

On schema < v48, `resolveSystem` throws `PendingSchemaUnavailableError`; `closeOpenItems` catches it,
records `pending.schema_unavailable`, and leaves the item open. My probe H2 confirms schema 47,
item open, one capability event. A non-schema closure error (missing/terminal route) still aborts the
intent-reading save; this is a fail-closed change without a dedicated test.

## 2. Identity and state machines

### 2.1 Concern identity (unchanged from round 1)

```
normalizeConcern(s): NFKC, remove U+200B-200D/U+2060/U+FEFF, collapse whitespace+trim,
                    controlled full-width punctuation -> ASCII, whitespace around punctuation,
                    ASCII lowercase
concernKey = SHA-256("concern:v1|" + kind + "|" + normalizeConcern(statement))
CONCERN_IDENTITY_VERSION = 1
```

Concern kinds: `memory_gap`, `open_question`, `intent_correction`, `consistency_note`.
`dedupeKeyOf` uses the concern key for these and `kind + normalized statement + sorted evidence refs`
for evidence-consuming kinds. Pending keys check the normalized digest then the raw-statement legacy
digest.

### 2.2 Finding / route / item states

```
finding: stored once per dedupe key (unique index)
route: routed -> injected -> used_observed | not_observed
       routed/injected/... -> consumed | rejected | dismissed
item:  open -> done (accepted) | dropped (rejected, dismissed, system dismissed)
       terminal + same decision -> unchanged
       terminal + opposite      -> conflict
```

Re-observation (F2 same concern, item already points to F1): `reflection.finding_reobserved` audit,
no route for F2; `recoverUnrouted` excludes archived findings via `json_extract`.

### 2.3 Legacy adoption (fixed in round 2)

```
v47 item P (finding_id NULL) + F1 route (routed)
upgrade; new observation F2; router adopts P.finding_id = F2
decide(P):
  exact route F2 -> consumed (routesUpdated=1, linked)
  resolveLegacyRoutes(P) matches F1 by statement digest -> consumed (routesUpdated=2)
  audit: routeResolution=linked_with_siblings, routeStatus=consumed, routesUpdated=2
```

Probe X confirms both routes consumed and the audit total. `resolveSystem` applies the same sibling
convergence with `dismissed`.

## 3. Transaction boundaries

| Path | Transaction | Failure result |
|---|---|---|
| `ReflectionService.run` | one `BEGIN IMMEDIATE`: run, findings, effects, cursor | rollback; cursor not advanced |
| `ingestRun` per finding | one transaction: route + pending + required audit | rollback that finding; `finding_ingest_failed` outside; later findings continue |
| `ingestFinding` re-observation | one transaction: `finding_reobserved` audit; no route | rollback on audit failure |
| `recoverUnrouted` | each finding via `ingestRun` | per-finding failure counted; schema error rethrown |
| `decide` | one transaction: item + exact route + sibling routes + audit | rollback item/routes/audit |
| `resolveSystem` | one transaction (nested SAVEPOINT when inside intent save): item + routes + audit | rollback |
| `IntentReadingRepository.save` | one transaction: reading + closeOpenItems -> resolveSystem savepoints | rollback the reading if a non-schema closure error occurs |
| goal candidate | one transaction: candidate + goal + key + audit | rollback |
| `SqliteDatabase.transaction` | top-level `BEGIN IMMEDIATE`; nested `SAVEPOINT` | rollback / rollback-to-savepoint |

## 4. Cursor / outbox recovery

- `reflection.run` commits its cursor with the run/findings/effects. A later router failure does not
  roll it back.
- Startup calls `recoverUnrouted` after a normal run, a rate-limited skip, and an ingest failure.
- Manual reflection does not call recovery; a stranded finding waits for startup or a rate-limited
  outbox pass.
- Outbox: rate-limited skip calls recovery and now throws if `failed>0`; schema errors record and
  throw; other ingest errors throw immediately so the module retries.
- **Residual:** a successful outbox retry does not call recovery. The failed finding has a durable
  failure record, but the row is marked done while the finding has no route (probe O2). This is the
  remaining P1 path.

## 5. Schema downgrade (< v48)

- `SqliteDatabase.open` falls back to >= v9 with `cognitivePersistenceAvailable=false` when v48
  fails; `schemaVersion` stays 47.
- `assertStage4Writable` throws `PendingSchemaUnavailableError` (`SCHEMA_UPGRADE_REQUIRED`) before SQL
  against `finding_id`/`decision`.
- IPC `toFailure` maps it to `SCHEMA_UPGRADE_REQUIRED`; `ChatService.applyFinalization` skips pending
  drafts and records `cognition.degraded`; startup returns `degraded/schema_upgrade_required`; outbox
  records `cognition.pending_schema_unavailable`; `resolveSystem` leaves the item open and records
  `pending.schema_unavailable` (probe H2).
- **Residual (P3-11):** manual reflection's `runBounded` failed path still throws
  `ApplicationError('STORAGE_ERROR')`; the preserved `outcome.error` is not inspected. The repair
  report/acceptance matrix claim this mapping.

## 6. Migration (v47 -> v48) and rollback

- `CURRENT_SCHEMA_VERSION = 48`; v48 adds `finding_id`, `decision` and `cognitive_pending_items_finding_idx`.
- `applyMigrations(connection, 47)` -> insert run/finding/route/open+done items -> `applyMigrations(connection)`:
  rows preserved, new columns NULL, index created, `integrity_check=ok`, `foreign_key_check=[]` (probe C).
- A validated `VACUUM INTO` backup is taken before migration; migration runs in a transaction and
  rolls back on failure (probe G forced v48 failure; schema 47, cognitive unavailable, safe reads,
  fail-closed writes).
- No new schema version was introduced by this repair.

## 7. Independent reproduction results (round 2)

Script: `.tmp/review2/repro.ts`; bundle `.tmp/review2/repro.cjs`; log `.tmp/review2/logs/repro.log`;
exit code 0; `SUMMARY failures=0` (probe O2 intentionally asserts the reproduced defect).

| Probe | What it exercises | Result |
|---|---|---|
| A1 | Real startup composition, same label gap twice | PASS: `ran`, `ran`; 1 finding, 1 route, 1 item, 0 stranded |
| A2 | Real producer -> router -> SQLite, two corrections through the same bounded wrapper | PASS: both completed; 1 item, 1 route, 1 finding, 0 stranded |
| B | Finding stored without a route -> `recoverUnrouted` | PASS: repaired=1 then 0; route `routed` |
| C | Real v47 file + open/done rows -> v48 -> production decide | PASS: schema 48; rows preserved; `integrity_check=ok`; `foreign_key_check=[]`; route consumed; audit `resolved_by_concern` |
| D | Legacy matching and unprovable items | PASS: matched route consumed; unmatched stays `routed` with `routeStatus=null/unresolved/routesUpdated=0` |
| E1-E3 | Real close/reopen, candidate/goal/key/pending/route/audit, decide after reopen, reopen again | PASS: all state survives; replay unchanged; opposite conflict; one decision audit |
| X | v47 legacy item + F1 route + post-upgrade F2 + decide | PASS (fixed): item done; F1 and F2 both consumed; audit `linked_with_siblings`, `routesUpdated:2` |
| S | Audit privacy with a unique statement marker | PASS: no event/pending payload contains the marker |
| G | Forced v48 failure with a reserved index name | PASS: schema 47, cognitive unavailable, fail-closed writes, startup degraded |
| O | Rate-limited outbox + recovery failure | PASS (fixed): first drain `failed=1`, row `pending/attempts=1`, route null; second drain `done`, route routed |
| H | Intent withdrawal via `IntentReadingRepository.save` (v48) | PASS (fixed): item `dropped/dismissed`, route `dismissed`, `pending.system_dismissed` actor system, zero `pending.decision` |
| O2 | Real outbox retry after a transient route/pending failure, not rate-limited | **DEFECT REPRODUCED**: first drain `failed=1`, row `pending/attempts=1`, route null; second drain `done`, route still null |
| H2 | Intent withdrawal on a degraded v47 schema | PASS: item stays open; one `pending.schema_unavailable` event; intent reading still saves |

Raw outputs are in `.tmp/review2/logs/repro.log` (gitignored; not committed).
