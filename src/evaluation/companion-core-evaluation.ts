import { createHash } from 'node:crypto'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID, type PersonalityInput } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { CompanionService } from '../app/companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EvaluationSecretStore } from './evaluation-secret-store'
import type { ProviderConsentPreview, ProviderPort } from '../providers/provider-policy'

/**
 * Companion Core offline evaluation.
 *
 * Every case drives the production ChatService/MemoryService path and asserts
 * on the request that would have been sent (`exactPayload`) or on what was
 * stored. A case that only proves a row exists in SQLite is deliberately not
 * accepted as evidence that the memory reaches the model.
 */

export const COMPANION_CORE_DIMENSIONS = [
  'multi_turn_context',
  'cross_session_memory',
  'correction_update',
  'retraction_invalidation',
  'stale_conflict',
  'personality_consistency',
  'intent_clarify',
  'uncertainty_no_evidence',
  'provider_failure',
  'payload_integrity'
] as const

export type CompanionCoreDimension = typeof COMPANION_CORE_DIMENSIONS[number]

export interface CompanionCoreMemorySpec {
  content: string
  sensitivity?: 'normal' | 'personal' | 'sensitive'
  sourceCategory?: 'user_explicit_input' | 'model_inferred_confirmed' | 'turn_derived_confirmed'
  confidence?: number
  /** Age in days applied to the record timestamp at creation time. */
  ageDays?: number
  confirmed?: boolean
}

export interface CompanionCoreExpectation {
  systemContains?: string[]
  systemExcludes?: string[]
  rawContains?: string[]
  rawExcludes?: string[]
  roles?: string[]
  maxMessageCount?: number
  errorCode?: string
  storedAssistantCount?: number
  storedUserCount?: number
  providerCalls?: number
  cognitive?: { intent: string; strategy: string }
}

export interface CompanionCoreStep {
  type: 'newConversation' | 'send' | 'sendAndCancel' | 'correct' | 'retract' | 'delete' | 'setPersonality' | 'restorePersonality'
  content?: string
  memoryIndex?: number
  version?: number
  personality?: PersonalityInput
}

export interface CompanionCoreCase {
  id: string
  dimension: CompanionCoreDimension
  providerMode?: 'ok' | 'auth' | 'timeout' | 'hang'
  cognitive?: boolean
  memories?: CompanionCoreMemorySpec[]
  personality?: PersonalityInput
  steps: CompanionCoreStep[]
  expect: CompanionCoreExpectation
}

export interface CompanionCoreDataset {
  schemaVersion: number
  id: string
  cases: CompanionCoreCase[]
}

export interface CompanionCoreCaseResult {
  id: string
  dimension: string
  passed: boolean
  failures: string[]
  evidence: {
    providerCalls: number
    messageRoles: string[]
    payloadBytes: number
    memoryCount: number
    storedUserMessages: number
    storedAssistantMessages: number
    errorCode: string | null
  }
}

export interface CompanionCoreReport {
  dataset: { id: string; caseCount: number }
  gate: { passed: boolean; failedChecks: string[] }
  metrics: { cases: number; passed: number; failed: number; dimensionCoverage: Record<string, number> }
  determinism: { resultHash: string; replayStable: boolean }
  // The provider here is a deterministic stub, so "dispatches" counts how many
  // times the production chat path reached the provider port. It is not a count
  // of model calls, and network calls stay at zero by construction.
  offlineExecution: { stubDispatches: number; networkCalls: number; networkGuarded: boolean; providerClass: 'deterministic_stub' }
  cases: CompanionCoreCaseResult[]
}

export class CompanionCoreEvaluationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'CompanionCoreEvaluationError'
  }
}

const fixedNow = '2026-10-26T00:00:00.000Z'
const dayMs = 86_400_000

interface Harness {
  database: SqliteDatabase
  companion: CompanionService
  memories: MemoryService
  requests: string[]
  memoryIds: string[]
  providerCalls: () => number
  close: () => void
}

function deterministicIdFactory(): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
  }
}

function createHarness(testCase: CompanionCoreCase): Harness {
  const database = SqliteDatabase.open(':memory:')
  const makeId = deterministicIdFactory()
  let clockNow = fixedNow
  const clock = (): string => clockNow
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock, makeId)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new EvaluationSecretStore()
  const requests: string[] = []
  let calls = 0
  const mode = testCase.providerMode ?? 'ok'

  const generate: ProviderPort['generate'] = async (input, onDelta) => {
    calls += 1
    if (mode === 'auth') throw new ApplicationError('PROVIDER_AUTH')
    if (mode === 'timeout') throw new ApplicationError('PROVIDER_TIMEOUT')
    if (mode === 'hang') {
      await new Promise<void>((_resolve, reject) => {
        const cancel = (): void => reject(new ApplicationError('PROVIDER_CANCELLED'))
        if (input.signal?.aborted) cancel()
        else input.signal?.addEventListener('abort', cancel, { once: true })
      })
      throw new ApplicationError('PROVIDER_CANCELLED')
    }
    onDelta?.('ok')
    return { text: `确定性回复 ${calls}`, modelId: DEEPSEEK_MODEL }
  }

  const authorize = async (preview: ProviderConsentPreview) => {
    requests.push(preview.exactPayload)
    const approvedAt = new Date(fixedNow)
    return {
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: approvedAt.toISOString(),
      expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }
  }

  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    authorize,
    clock,
    id: makeId,
    providerFactory: (config) => ({
      profile: { id: config.id, providerClass: config.providerClass, configured: true },
      generate: (input, onDelta) => {
        requests.push(JSON.stringify({ endpoint: input.endpoint, body: input.requestPayload }))
        return generate(input, onDelta)
      }
    })
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'evaluation-only-secret' })
  if (testCase.cognitive === true) companion.saveCognitiveSettings({ enabled: true })
  if (testCase.personality) companion.savePersonality(testCase.personality)

  const memoryIds: string[] = []
  for (const spec of testCase.memories ?? []) {
    const ageDays = spec.ageDays ?? 0
    clockNow = new Date(Date.parse(fixedNow) - ageDays * dayMs).toISOString()
    const created = memories.create(spec.content, spec.sensitivity ?? 'personal', {
      ...(spec.sourceCategory ? { sourceCategory: spec.sourceCategory } : {}),
      ...(spec.confidence === undefined ? {} : { confidence: spec.confidence }),
      allowDuplicate: true
    })
    if (spec.confirmed !== false && ageDays === 0) memories.confirm(created.id)
    memoryIds.push(created.id)
    clockNow = fixedNow
  }

  return {
    database,
    companion,
    memories,
    requests,
    memoryIds,
    providerCalls: () => calls,
    close: () => database.close()
  }
}

function parseRequest(raw: string): {
  endpoint: string
  model: string
  messages: Array<{ role: string; content: string }>
  system: string
  bytes: number
} {
  const parsed = JSON.parse(raw) as { endpoint: string; body: { model: string; messages: Array<{ role: string; content: string }> } }
  const messages = parsed.body.messages
  return {
    endpoint: parsed.endpoint,
    model: parsed.body.model,
    messages,
    system: messages.find((message) => message.role === 'system')?.content ?? '',
    bytes: Buffer.byteLength(raw, 'utf8')
  }
}

function memoryCountIn(system: string): number {
  // The assembler tags every entry with a match reason; the instruction line
  // spells it without a colon, so this counts entries only.
  return (system.match(/"match":"(?:topic|continuity)"/gu) ?? []).length
}

async function runCase(testCase: CompanionCoreCase): Promise<CompanionCoreCaseResult> {
  const harness = createHarness(testCase)
  const failures: string[] = []
  let lastError: string | null = null
  let conversation = harness.companion.createConversation()

  try {
    for (const [stepIndex, step] of testCase.steps.entries()) {
      try {
        if (step.type === 'newConversation') {
          conversation = harness.companion.createConversation()
        } else if (step.type === 'send') {
          await harness.companion.sendChat({
            conversationId: conversation.id,
            requestId: `00000000-0000-4000-9000-${(stepIndex + 1).toString(16).padStart(12, '0')}`,
            content: step.content ?? '',
            includeSensitive: false
          }, () => undefined)
        } else if (step.type === 'sendAndCancel') {
          const pending = harness.companion.sendChat({
            conversationId: conversation.id,
            requestId: `00000000-0000-4000-9000-${(stepIndex + 1).toString(16).padStart(12, '0')}`,
            content: step.content ?? '',
            includeSensitive: false
          }, () => undefined)
          harness.companion.cancelChat({ conversationId: conversation.id })
          await pending
        } else if (step.type === 'correct') {
          const id = harness.memoryIds[step.memoryIndex ?? 0]
          if (!id) throw new CompanionCoreEvaluationError('MISSING_MEMORY_INDEX')
          harness.memories.correct(id, step.content ?? '')
        } else if (step.type === 'retract') {
          const id = harness.memoryIds[step.memoryIndex ?? 0]
          if (!id) throw new CompanionCoreEvaluationError('MISSING_MEMORY_INDEX')
          harness.memories.retract(id)
        } else if (step.type === 'delete') {
          const id = harness.memoryIds[step.memoryIndex ?? 0]
          if (!id) throw new CompanionCoreEvaluationError('MISSING_MEMORY_INDEX')
          harness.memories.delete(id)
        } else if (step.type === 'setPersonality') {
          if (!step.personality) throw new CompanionCoreEvaluationError('MISSING_PERSONALITY')
          harness.companion.savePersonality(step.personality)
        } else if (step.type === 'restorePersonality') {
          harness.companion.restorePersonality({ version: step.version ?? 1 })
        }
      } catch (error) {
        lastError = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR'
        if (testCase.expect.errorCode === undefined) failures.push(`step "${step.type}" threw ${lastError}`)
      }
    }

    const stored = harness.companion.readConversation({ conversationId: conversation.id }).messages
    const storedUser = stored.filter((message) => message.role === 'user')
    const storedAssistant = stored.filter((message) => message.role === 'assistant')
    const raw = harness.requests.at(-1) ?? ''
    const request = raw.length > 0 ? parseRequest(raw) : null
    const expect = testCase.expect

    const checkContains = (values: string[] | undefined, haystack: string, label: string): void => {
      for (const value of values ?? []) if (!haystack.includes(value)) failures.push(`${label} missing: ${value}`)
    }
    const checkExcludes = (values: string[] | undefined, haystack: string, label: string): void => {
      for (const value of values ?? []) if (haystack.includes(value)) failures.push(`${label} leaked: ${value}`)
    }

    if (request) {
      checkContains(expect.systemContains, request.system, 'system')
      checkExcludes(expect.systemExcludes, request.system, 'system')
      checkContains(expect.rawContains, raw, 'payload')
      checkExcludes(expect.rawExcludes, raw, 'payload')
      if (expect.roles) {
        const actual = request.messages.map((message) => message.role)
        if (JSON.stringify(actual) !== JSON.stringify(expect.roles)) {
          failures.push(`roles mismatch: expected ${expect.roles.join(',')} got ${actual.join(',')}`)
        }
      }
      if (expect.maxMessageCount !== undefined && request.messages.length > expect.maxMessageCount) {
        failures.push(`message count ${request.messages.length} exceeds ${expect.maxMessageCount}`)
      }
    } else if (expect.systemContains || expect.rawContains || expect.roles) {
      failures.push('no request was captured')
    }

    if (expect.errorCode !== undefined && lastError !== expect.errorCode) {
      failures.push(`error code expected ${expect.errorCode} got ${lastError ?? 'none'}`)
    }
    if (expect.storedAssistantCount !== undefined && storedAssistant.length !== expect.storedAssistantCount) {
      failures.push(`stored assistant messages ${storedAssistant.length} != ${expect.storedAssistantCount}`)
    }
    if (expect.storedUserCount !== undefined && storedUser.length !== expect.storedUserCount) {
      failures.push(`stored user messages ${storedUser.length} != ${expect.storedUserCount}`)
    }
    if (expect.providerCalls !== undefined && harness.providerCalls() !== expect.providerCalls) {
      failures.push(`provider calls ${harness.providerCalls()} != ${expect.providerCalls}`)
    }
    if (expect.cognitive) {
      const observation = storedUser.at(-1)?.cognitiveObservations?.at(-1)
      if (!observation) failures.push('no cognitive observation recorded')
      else {
        if (observation.analysis.intent !== expect.cognitive.intent) failures.push(`intent ${observation.analysis.intent} != ${expect.cognitive.intent}`)
        if (observation.analysis.strategy !== expect.cognitive.strategy) failures.push(`strategy ${observation.analysis.strategy} != ${expect.cognitive.strategy}`)
      }
    }

    return {
      id: testCase.id,
      dimension: testCase.dimension,
      passed: failures.length === 0,
      failures,
      evidence: {
        providerCalls: harness.providerCalls(),
        messageRoles: request?.messages.map((message) => message.role) ?? [],
        payloadBytes: request?.bytes ?? 0,
        memoryCount: request ? memoryCountIn(request.system) : 0,
        storedUserMessages: storedUser.length,
        storedAssistantMessages: storedAssistant.length,
        errorCode: lastError
      }
    }
  } finally {
    harness.close()
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizeDimension(value: unknown, caseId: string): CompanionCoreDimension {
  if (typeof value !== 'string' || !COMPANION_CORE_DIMENSIONS.includes(value as CompanionCoreDimension)) {
    throw new CompanionCoreEvaluationError(`UNKNOWN_DIMENSION:${caseId}`)
  }
  return value as CompanionCoreDimension
}

export function parseCompanionCoreDataset(value: unknown): CompanionCoreDataset {
  if (value === null || typeof value !== 'object') throw new CompanionCoreEvaluationError('INVALID_DATASET')
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) throw new CompanionCoreEvaluationError('UNSUPPORTED_SCHEMA')
  if (typeof record.id !== 'string' || !Array.isArray(record.cases) || record.cases.length === 0) {
    throw new CompanionCoreEvaluationError('INVALID_DATASET')
  }
  const seen = new Set<string>()
  const cases = record.cases.map((entry, index) => {
    if (entry === null || typeof entry !== 'object') throw new CompanionCoreEvaluationError('INVALID_CASE')
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) throw new CompanionCoreEvaluationError('INVALID_CASE_ID')
    if (seen.has(candidate.id)) throw new CompanionCoreEvaluationError(`DUPLICATE_CASE_ID:${candidate.id}`)
    seen.add(candidate.id)
    if (!Array.isArray(candidate.steps) || candidate.steps.length === 0) throw new CompanionCoreEvaluationError(`MISSING_STEPS:${candidate.id}`)
    return {
      ...(candidate as unknown as CompanionCoreCase),
      dimension: normalizeDimension(candidate.dimension, candidate.id)
    } satisfies CompanionCoreCase
  })
  return { schemaVersion: 1, id: record.id, cases }
}

export async function runCompanionCoreEvaluation(dataset: CompanionCoreDataset): Promise<CompanionCoreReport> {
  const first = []
  for (const testCase of dataset.cases) first.push(await runCase(testCase))
  const replay = []
  for (const testCase of dataset.cases) replay.push(await runCase(testCase))

  const resultHash = createHash('sha256').update(canonicalJson(first)).digest('hex')
  const replayHash = createHash('sha256').update(canonicalJson(replay)).digest('hex')
  const replayStable = resultHash === replayHash

  const dimensionCoverage: Record<string, number> = {}
  for (const dimension of COMPANION_CORE_DIMENSIONS) {
    dimensionCoverage[dimension] = first.filter((item) => item.dimension === dimension).length
  }

  const failedChecks: string[] = []
  for (const item of first) if (!item.passed) failedChecks.push(item.id)
  const missingDimensions = Object.entries(dimensionCoverage).filter(([, count]) => count === 0).map(([dimension]) => dimension)
  if (missingDimensions.length > 0) failedChecks.push(`missing_dimensions:${missingDimensions.join(',')}`)
  if (!replayStable) failedChecks.push('deterministic_replay')

  const providerCalls = first.reduce((total, item) => total + item.evidence.providerCalls, 0)

  return {
    dataset: { id: dataset.id, caseCount: dataset.cases.length },
    gate: { passed: failedChecks.length === 0, failedChecks },
    metrics: {
      cases: first.length,
      passed: first.filter((item) => item.passed).length,
      failed: first.filter((item) => !item.passed).length,
      dimensionCoverage
    },
    determinism: { resultHash, replayStable },
    offlineExecution: { stubDispatches: providerCalls, networkCalls: 0, networkGuarded: true, providerClass: 'deterministic_stub' },
    cases: first
  }
}
