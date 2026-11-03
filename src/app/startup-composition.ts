/**
 * The production startup-reflection composition boundary (Issue #43).
 *
 * `src/app/index.ts` uses these exact functions to create the reflection
 * services and to run the startup pass, so the integration test exercises the
 * same object graph and the same call instead of manually invoking
 * `reflection.run` + `findingRouter.ingestRun`.
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
import { PendingCognitionService } from '../cognition/pending-items'
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
 * ingestion path as manual and post-conversation runs. Routing failure is a
 * fail-safe: it is logged, the finding stays audit-only, and startup continues
 * with no partial route/pending rows.
 */
export function runStartupReflection(input: {
  reflection: ReflectionService
  findingRouter: ReflectionFindingRouter
  logger?: StartupReflectionLogger | undefined
}): { status: 'ran' | 'skipped' | 'failed'; reason?: string } {
  const run = input.reflection.run('startup')
  if ('skipped' in run) {
    input.logger?.debug('self-model', 'startup reflection skipped', { reason: run.skipped })
    return { status: 'skipped', reason: run.skipped }
  }
  try {
    input.findingRouter.ingestRun(run.id, input.reflection.findings(run.id))
    return { status: 'ran' }
  } catch {
    input.logger?.warn('self-model', 'startup reflection findings could not be routed')
    return { status: 'failed' }
  }
}
