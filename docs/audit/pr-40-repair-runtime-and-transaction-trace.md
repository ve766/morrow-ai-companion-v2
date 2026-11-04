# PR #48 repair — runtime, state machine and transaction trace (independent)

- Reviewed SHA: `e4aad40a6f08300704a07a7d74303bfb2b7c2dd0`
- Code SHA: `dd9f59b10c7c812c3af36684a32d15193bda7d50`
- Base: `052bcaa9c0320ef5e726c7bf66df85a49055628d`
- Reviewer reproduction: `.tmp/review/repro.ts` (own script, production modules, real SQLite files), bundled with esbuild and run with Node 22.23.2. The script and logs are under gitignored `.tmp/`; key outputs are quoted here.

## 1. Call graph (actual code)

### 1.1 Startup

```
SqliteDatabase.open(path)
  -> applyMigrations (v47 -> v48)
  -> if migration fails: keep >= v9, cognitivePersistenceAvailable=false
EventLogService
composeStartupReflectionServices(database, events)
  -> SqlitePendingItemRepository(database, events)   # audit sink required
  -> PendingCognitionService(repository)
  -> ReflectionFindingRouter({database, pending, events})
runStartupReflection({reflection, findingRouter, logger})
  -> reflection.run('startup')                 # one transaction: run/findings/effects/cursor
  -> findingRouter.ingestRun(run.id, findings) # one transaction per finding
  -> findingRouter.recoverUnrouted()           # best-effort recovery sweep
  -> findingRouter.recordLifecycle(...)        # durable audit, best-effort
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

The second correction succeeds in my probe because the concern key dedupes the finding at write time;
`findingsForRun(run2)` is empty and `ingestRun` has no finding to fail. The producer still reports
`findingsCount=1` for the second run while the stored row belongs to the first run; this is a
pre-existing dedupe-reporting quirk, not a decision-path failure.

### 1.3 Post-conversation outbox

`src/app/companion-service.ts:994-1043`:

```
CognitiveOutbox.drain
  -> reflection projector
     -> reflection.run('post_conversation')
     -> skipped: recoverUnrouted(); return
     -> success: ingestRun(...)
        -> PendingSchemaUnavailableError: recoverUnrouted(); record schema event; return
        -> other error: throw -> outbox retry / failed
```

**Defect (P1-01):** `recoverUnrouted()` never throws for a per-finding routing failure; it returns
`{repaired, failed}` (`src/cognition/reflection-routing.ts:186-219`). The projector ignores that result,
so when recovery fails (even transiently), the projector returns and `CognitiveOutbox.drain` performs
`ledger.complete()` then `mark(done)` (`src/app/cognitive-outbox.ts:264-284`). The finding keeps its
durable `reflection.finding_ingest_failed` event and can be repaired by a later startup, but the
outbox obligation is already `done`, and no outbox retry occurs.

### 1.4 Pending decision

`src/app/ipc.ts:281` -> `src/app/index.ts:440` -> `PendingCognitionService.decide` ->
`SqlitePendingItemRepository.decide`:

```
transaction:
  item = get(id)                     # not_found if absent
  if item.status != open:            # unchanged | conflict
  if item.finding_id != null:
      route must exist and be mutable -> linked
  UPDATE item WHERE status='open'
  if finding_id != null:
      UPDATE one route            -> routesUpdated=1
  else:
      resolveLegacyRoutes(item)   # current+legacy digest, same kind
  audit pending.decision (same transaction)
```

## 2. Identity and state machines

### 2.1 Concern identity

```
normalizeConcern(s):
  NFKC
  remove U+200B-200D, U+2060, U+FEFF
  collapse whitespace + trim
  map a fixed full-width punctuation set to ASCII
  remove whitespace adjacent to punctuation
  ASCII lowercase

concernKey = SHA-256("concern:v1|" + kind + "|" + normalizeConcern(statement))
```

`CONCERN_IDENTITY_VERSION = 1`. `dedupeKeyOf` uses this key for
`memory_gap/open_question/intent_correction/consistency_note`; other kinds keep
`kind + normalized statement + sorted evidence refs`. `concernDigestOf` is the first 16 hex of
`SHA-256(normalizeConcern(statement))`; `legacyConcernDigestOf` is the first 16 hex of the raw
statement. Pending lookup checks the current key then the legacy key.

### 2.2 Finding / route / item states

```
finding row: stored once per dedupe key (unique index on reflection_findings.dedupe_key)
route: routed -> injected -> used_observed | not_observed
       routed/injected/... -> consumed | rejected | dismissed
item:  open -> done (accepted) | dropped (rejected/dismissed)
       done/dropped + same decision -> unchanged
       done/dropped + opposite      -> conflict
```

Second observation of a concern with a historical duplicate finding (F2 different id, same statement):

```
ingestFinding(F2):
  existing route for F2? no
  pending_user? item = findReflectionConcern(kind, statement)
  item.findingId != null and != F2
    -> durable reflection.finding_reobserved {F2, existing=F1, item}
    -> return (F2 has no route; archived)
  else insert route and absorb/adopt
```

`recoverUnrouted` selects findings with no route and excludes findings that have a
`reflection.finding_reobserved` event; this is what makes re-observation archival idempotent.

### 2.3 Legacy adoption edge (P2-03 residual)

```
v47: item P (finding_id NULL, key reflection:open_question:<raw-digest>) + route F1 (routed)
upgrade -> v48; P.finding_id NULL
new gap -> F2
router:
  item P found by legacy key; P.findingId == NULL -> not the re-observation branch
  insert route F2
  absorbReflection -> P exists -> adopt P.finding_id = F2
user decides -> decide sees P.findingId = F2 -> consumes F2 only
result: P done; F2 consumed; F1 still routed; audit routeResolution=linked, routesUpdated=1
```

The original route F1 is provable from P's stored raw digest (the same match `resolveLegacyRoutes`
uses when `finding_id` is NULL), but the adopted item no longer takes that branch. The state is
"item terminal + route routed without an explaining audit".

## 3. Transaction boundaries

| Path | Transaction | Failure result |
|---|---|---|
| `ReflectionService.run` | one `BEGIN IMMEDIATE`: run, findings, effects, cursor | rollback; cursor not advanced |
| `ingestRun` per finding | one transaction: route + pending + required audit | rollback that finding; `finding_ingest_failed` written outside; later findings continue |
| `ingestFinding` re-observation | one transaction: `finding_reobserved` audit; no route | rollback on audit failure |
| `recoverUnrouted` | each finding goes through `ingestRun` | per-finding failure counted, loop continues |
| `decide` | one transaction: item + route(s) + audit | rollback item/route/audit |
| goal candidate | one transaction: candidate + goal + creation key + audit | rollback |
| `SqliteDatabase.transaction` | top-level `BEGIN IMMEDIATE`; nested `SAVEPOINT` | rollback / rollback-to-savepoint |

My probes use `%TEMP%`-based real files (no mocks) and `PRAGMA integrity_check` /
`PRAGMA foreign_key_check` after the v47 upgrade.

## 4. Cursor / outbox recovery

- `reflection.run` commits its cursor in the same transaction as the run/findings/effects. It never
  rolls back just because a later router transaction fails.
- The independence mechanism is `recoverUnrouted` plus the durable failure record. It is idempotent:
  an existing route is left alone; a re-observed finding is skipped via `json_extract` on the
  deterministic audit payload.
- Startup: `runStartupReflection` calls `recoverUnrouted` after a successful run, on a rate-limited
  skip, and on an ingest failure (before returning `degraded`/`failed`).
- Manual: `ingestRun` only; no recovery sweep. A stranded finding is repaired at the next startup or
  rate-limited outbox pass.
- Outbox: the rate-limited branch calls recovery, but ignores `failed`; see §1.3. The outbox row
  completion is the defect.

## 5. Schema downgrade (< v48)

- `SqliteDatabase.open` applies migrations; if they fail it keeps the current version if >= v9 and sets
  `cognitivePersistenceAvailable=false`. `schemaVersion` stays at 47 in the degraded case.
- `SqlitePendingItemRepository.assertStage4Writable` throws `PendingSchemaUnavailableError`
  (`SCHEMA_UPGRADE_REQUIRED`) before any SQL that references `finding_id`/`decision`.
- IPC `toFailure` maps that error to `SCHEMA_UPGRADE_REQUIRED` with a user-readable upgrade message.
- `ChatService.applyFinalization` skips pending drafts below v48, records `cognition.degraded`
  (`pending_item_schema`), and keeps the turn context/message. The chat path continues.
- Startup returns `degraded/schema_upgrade_required`; outbox records
  `cognition.pending_schema_unavailable`; findings stay for later recovery.
- Residual: manual reflection wraps the schema error in `ApplicationError('STORAGE_ERROR')`, so that
  channel does not expose the upgrade-required code.

## 6. Migration (v47 -> v48) and rollback

`applyMigrations(connection, 47)` -> insert run/finding/route/open+done items -> `applyMigrations(connection)`:

- `CURRENT_SCHEMA_VERSION = 48`;
- `finding_id` and `decision` are added by `ALTER TABLE`, with `NULL` for all existing rows;
- `cognitive_pending_items_finding_idx` is created;
- a validated `VACUUM INTO` backup is taken before the migration when the file already exists;
- migration runs in a transaction and rolls back on failure; my probe G forced the index creation to
  fail and observed `schemaVersion=47`, `cognitivePersistenceAvailable=false`, safe reads, and a
  fail-closed write.

No new schema version was introduced by this repair.

## 7. Independent reproduction results

Script: `.tmp/review/repro.ts`; bundle `.tmp/review/repro.cjs`; log `.tmp/review/logs/repro.log`;
exit code 0; `SUMMARY failures=0`. Probes:

| Probe | What it exercises | Result |
|---|---|---|
| A1 | Real startup composition, same label gap twice (same conversation) | `first/second = ran`, findings=1, routes=1, items=1, stranded=0 |
| A2 | Real producer -> router -> SQLite, two correction events through the same `runBounded` wrapper the IPC uses | both `completed`, items=1, routes=1, findings=1, stranded=0, no `STORAGE_ERROR` |
| B | Finding row stored without a route -> `recoverUnrouted` | repaired=1, route `routed`, second sweep repaired=0 |
| C | Real v47 file with open+done pending rows and run/finding/route -> `SqliteDatabase.open` -> production decide | schema 48, columns present, rows preserved, `integrity_check=ok`, `foreign_key_check=[]`, item done, F1 route consumed, audit `resolved_by_concern` |
| D | Legacy matching route and unprovable legacy item | matched: route consumed + `routeStatus=consumed`; unmatched: route stays `routed`, `routeStatus=null`, `unresolved`, `routesUpdated=0` |
| E1/E2/E3 | Real close/reopen with candidate accept, goal, creation key, pending, route, audit; decide after reopen; second reopen | candidate list empty, goal active/user, creation key resolves, pending open before decision; decision done, replay unchanged, opposite conflict, route consumed, one `pending.decision`; second reopen keeps terminal state |
| X | v47 legacy item + F1 route, upgrade, new gap F2, then decide | item done, F2 consumed, **F1 still routed**, audit `linked/routesUpdated=1` — defect |
| S | Audit privacy with a unique marker in the finding statement | no event payload and no pending summary/detail contains the marker |
| G | Forced v48 migration failure with a reserved index name | schema 47, `cognitivePersistenceAvailable=false`, upsert throws `PendingSchemaUnavailableError:SCHEMA_UPGRADE_REQUIRED`, reads safe, startup degraded |
| O | Rate-limited reflection projector, stranded finding, transient pending-insert failure | outbox `done`, attempts 0, finding route null; later manual `recoverUnrouted()` repaired it — defect |
| H | `IntentReadingRepository.save` with `responseMode=stop_previous` on a legacy `source='open_question'` item | item `done`, `decision=null`, route `routed`, zero `pending.decision` audit; later decide returns `conflict/current=null` — defect |

Raw outputs for A1/A2/B/C/D/E/X/S/G/O/H are in `.tmp/review/logs/repro.log` (gitignored; this review
branch does not commit temporary logs).
