/**
 * The production startup-reflection composition boundary (Issue #43).
 *
 * `src/app/index.ts` uses these exact functions to create the reflection
 * services and to run the startup pass, so the integration test exercises the
 * same object graph and the same call instead of manually invoking
 * `reflection.run` + `findingRouter.ingestRun`.
 *
 * AUD45-P3-08: the startup pass has an explicit outcome. Producer failure,
 * routing failure, a schema that cannot store decisions and a partial recovery
 * are different states; none of them is reported as `ran`, none of them blocks
 * the main window, and each is logged and (when the audit sink is available)
 * recorded durably.
 */
import type { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { MemoryImportanceService } from '../memory/memory-importance'
import { FactMemoryService } from '../memory/fact-memory'
import { MemoryService } from '../memory/memory-service'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { InterestService, SqliteInterestRepository } from '../self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../self-model/self-model-service'
import { ReflectionService, SqliteReflectionRepository } from '../self-model/reflection-service'
import { PendingCognitionService, PendingSchemaUnavailableError } from '../cognition/pending-items'
import { SqlitePendingItemRepository } from '../persistence/cognitive-context-repository'
import { ReflectionFindingRouter } from '../cognition/reflection-routing'

export interface StartupReflectionLogger {
  debug(category: string, message: string, detail?: Record<string, unknown>): void
  warn(category: string, message: string, detail?: Record<string, unknown>): void
}

export interface StartupReflectionServices {
  memoryImportance: MemoryImportanceService
  factMemory: FactMemoryService
  memories: MemoryService
  interests: InterestService
  selfModel: SelfModelService
  reflection: ReflectionService
  pendingItems: PendingCognitionService
  findingRouter: ReflectionFindingRouter
}

export type StartupReflectionStatus = 'ran' | 'skipped' | 'failed' | 'degraded'

export interface StartupReflectionOutcome {
  status: StartupReflectionStatus
  reason?: string
  /** Findings a recovery sweep routed during this pass. */
  recovered?: number
}

/** Builds the reflection dependency graph on the already-open database. */
export function composeStartupReflectionServices(
  database: SqliteDatabase,
  events: EventLogService,
  options: { clock?: (() => string) | undefined } = {}
): StartupReflectionServices {
  const clock = options.clock
  const memoryImportance = new MemoryImportanceService(database, clock)
  const factMemory = new FactMemoryService({ database, ...(clock ? { clock } : {}) })
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock, undefined, events, {
    importance: memoryImportance,
    factIndex: factMemory
  })
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const reflection = new ReflectionService(
    new SqliteReflectionRepository(database),
    { memories, interests, selfModel, events },
    events
  )
  const pendingItems = new PendingCognitionService(new SqlitePendingItemRepository(database, events), undefined, clock)
  const findingRouter = new ReflectionFindingRouter({ database, pending: pendingItems, events, ...(clock ? { clock } : {}) })
  return { memoryImportance, factMemory, memories, interests, selfModel, reflection, pendingItems, findingRouter }
}

/**
 * Runs the startup reflection and routes its findings through the same durable
 * ingestion path as manual and post-conversation runs.
 *
 * Never throws: the main window must open even when reflection cannot run. The
 * returned status is the honest state of the pass:
 *   - `ran`: the run completed and its findings are routed or archived;
 *   - `skipped`: the service rate-limited the run; any stranded findings were
 *     still recovered;
 *   - `degraded`: the run happened but ingestion was partial or the schema
 *     cannot store decisions; recovery is available and the window opens;
 *   - `failed`: the producer itself failed, or recovery could not complete.
 */
export function runStartupReflection(input: {
  reflection: ReflectionService
  findingRouter: ReflectionFindingRouter
  logger?: StartupReflectionLogger | undefined
}): StartupReflectionOutcome {
  const recover = (): { repaired: number; failed: number } => {
    try {
      return input.findingRouter.recoverUnrouted()
    } catch {
      return { repaired: 0, failed: 1 }
    }
  }
  const record = (eventType: 'reflection.startup_result' | 'reflection.startup_failed', payload: Record<string, unknown>): void => {
    try {
      input.findingRouter.recordLifecycle(eventType, payload)
    } catch {
      // The audit sink is best-effort on the startup path; the logger still has
      // the structured state and startup must continue.
    }
  }

  let run: ReturnType<ReflectionService['run']>
  try {
    run = input.reflection.run('startup')
  } catch (error) {
    const code = error instanceof Error ? error.name : 'unknown'
    input.logger?.warn('self-model', 'startup reflection producer failed', { stage: 'producer', code })
    record('reflection.startup_failed', { stage: 'producer', code })
    return { status: 'failed', reason: 'producer_failed' }
  }

  if ('skipped' in run) {
    const recovered = recover()
    input.logger?.debug('self-model', 'startup reflection skipped', { reason: run.skipped, recovered: recovered.repaired })
    record('reflection.startup_result', { status: 'skipped', reason: run.skipped, recovered: recovered.repaired, failed: recovered.failed })
    return recovered.failed > 0
      ? { status: 'degraded', reason: 'recovery_failed', recovered: recovered.repaired }
      : { status: 'skipped', reason: run.skipped, recovered: recovered.repaired }
  }

  try {
    input.findingRouter.ingestRun(run.id, input.reflection.findings(run.id))
  } catch (error) {
    const recovered = recover()
    const schemaUnavailable = error instanceof PendingSchemaUnavailableError
    const code = error instanceof Error ? error.message.slice(0, 120) : 'unknown'
    input.logger?.warn('self-model', 'startup reflection findings could not be fully routed', {
      stage: 'ingest',
      code,
      recovered: recovered.repaired,
      failed: recovered.failed
    })
    record('reflection.startup_failed', {
      stage: 'ingest',
      code,
      recovered: recovered.repaired,
      failed: recovered.failed,
      schemaUnavailable
    })
    if (schemaUnavailable) return { status: 'degraded', reason: 'schema_upgrade_required', recovered: recovered.repaired }
    return recovered.failed > 0
      ? { status: 'failed', reason: 'ingest_failed', recovered: recovered.repaired }
      : { status: 'degraded', reason: 'ingest_recovered', recovered: recovered.repaired }
  }

  const recovered = recover()
  record('reflection.startup_result', { status: 'ran', recovered: recovered.repaired, failed: recovered.failed })
  return recovered.failed > 0
    ? { status: 'degraded', reason: 'recovery_failed', recovered: recovered.repaired }
    : { status: 'ran', recovered: recovered.repaired }
}
