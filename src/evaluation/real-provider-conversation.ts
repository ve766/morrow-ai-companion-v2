import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { LOCAL_PROVIDER_ID } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { CompanionService } from '../app/companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { OpenAICompatibleProvider } from '../providers/openai-compatible'
import type { ProviderConsentPreview } from '../providers/provider-policy'
import { EvaluationSecretStore } from './evaluation-secret-store'
import { buildReproduction, type RealRunReproduction } from './run-identity'
import {
  RequestShapeError,
  checkCrossSessionIsolation,
  checkFailurePersistence,
  checkHistoryCompleteness,
  parseProviderRequest,
  selectRetainedHistory,
  type CheckOutcome,
  type ProviderMessage
} from './request-assertions'

/**
 * Real-provider multi-turn verification.
 *
 * This drives the production chat path against an actually running
 * OpenAI-compatible server (by default a local Ollama on 127.0.0.1:11434) and
 * records what the server received. It separates two kinds of claim:
 *
 *   checks      objective, reproducible, gating: did the request arrive, did it
 *               carry exactly the history the bound retains in the right order,
 *               did the new conversation carry the saved memory and nothing
 *               from the earlier one, did a failed dispatch leave a fabricated
 *               assistant turn in the store;
 *   observations  informational only: whether a small local model happened to
 *               repeat a name or a city. Those are quality signals, not proof.
 *
 * A quality verdict is explicitly NOT produced here. A 0.5B local model is not
 * evidence about companion quality in either direction.
 *
 * Every gating assertion is built from the parsed request (messages, roles,
 * contents, order) or from rows re-read out of SQLite after the fact. Nothing
 * gates on payload byte counts, and nothing gates on a field this file wrote
 * itself in a catch block.
 */

// Each user turn carries a token that exists nowhere else, so a leak across
// conversations is detectable as a unique string rather than inferred from a
// payload length difference.
export const REAL_PROVIDER_SENTINELS = {
  turn1: 'SENTINEL-A7F3',
  turn2: 'SENTINEL-B8E1'
} as const

export const REAL_PROVIDER_TURNS = [
  { id: 'turn-1', content: `我叫林一，住在杭州，做后端开发。（记录编号 ${REAL_PROVIDER_SENTINELS.turn1}）` },
  { id: 'turn-2', content: `我平时喝手冲咖啡。（记录编号 ${REAL_PROVIDER_SENTINELS.turn2}）` },
  { id: 'turn-3', content: '你还记得我叫什么、住在哪里、做什么工作吗？' }
] as const

export const REAL_PROVIDER_MEMORY = '林一住在杭州，做后端开发，常喝手冲咖啡。'
export const REAL_PROVIDER_MEMORY_FRAGMENT = '林一住在杭州'
export const REAL_PROVIDER_CROSS_QUESTION = '我住在哪里？'

export interface RealProviderCheck {
  id: string
  description: string
  passed: boolean
  detail: string
  failures: string[]
}

export interface CheckSummary {
  passed: boolean
  failures: string[]
  detail: string
}

export interface RealProviderTurnRecord {
  id: string
  conversation: 'a' | 'b'
  content: string
  requestSha256: string
  /** Diagnostics only. No check compares this value; see request-assertions.ts. */
  requestBytes: number
  messageRoles: string[]
  /** Truncated per-message contents, so the report shows the shape that was asserted on. */
  messageContents: string[]
  historyCheck: CheckSummary | null
  isolationCheck: CheckSummary | null
  responseText: string
  /** Read back from SQLite after the turn, never assigned in a catch block. */
  storedUserMessages: number
  storedAssistantMessages: number
  elapsedMs: number
  modelRequested: string
  errorCode: string | null
}

export interface FailureScenarioRecord {
  id: string
  description: string
  /** `real_socket` means the failure came from a real HTTP exchange. */
  executedAgainst: 'real_socket' | 'not_exercised'
  attempted: boolean
  userMessage: string
  turnId: string
  errorCode: string | null
  storedUserMessages: number
  storedAssistantMessages: number
  passed: boolean
  failures: string[]
  detail: string
  note: string
}

export interface RealProviderEvidence {
  schemaVersion: 3
  evidenceClass: 'real_provider'
  generatedAt: string
  /** Run id, code provenance and sampling. A document cites the run id, not a path. */
  reproduction: RealRunReproduction
  status: 'verified' | 'blocked' | 'failed'
  blockedReason: string | null
  provider: {
    providerClass: 'local'
    endpoint: string
    model: string
    reachable: boolean
  }
  environment: { node: string; platform: string }
  turns: RealProviderTurnRecord[]
  failureScenarios: FailureScenarioRecord[]
  checks: RealProviderCheck[]
  observations: Array<{ id: string; note: string }>
  quality: { assessed: boolean; note: string }
  summary: { turnsRequested: number; turnsCompleted: number; turnsFailed: number; failureScenariosExecuted: number }
}

export interface RealProviderOptions {
  endpoint?: string
  model?: string
  timeoutMs?: number
}

const defaultEndpoint = 'http://127.0.0.1:11434/v1'
const defaultModel = 'qwen2.5:0.5b'
const historyContentLimit = 160

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function probe(endpoint: string, timeoutMs: number): Promise<{ reachable: boolean; detail: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${endpoint}/models`, { signal: controller.signal })
    if (!response.ok) return { reachable: false, detail: `HTTP ${response.status}` }
    const body = await response.json() as { data?: Array<{ id?: unknown }> }
    const models = (body.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string')
    return { reachable: true, detail: models.slice(0, 8).join(', ') }
  } catch (error) {
    return { reachable: false, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

function summarize(outcome: CheckOutcome): CheckSummary {
  return { passed: outcome.passed, failures: outcome.failures, detail: outcome.detail }
}

function safeParse(raw: string): { parsed: ReturnType<typeof parseProviderRequest> | null; shapeError: string | null } {
  try {
    return { parsed: parseProviderRequest(raw), shapeError: null }
  } catch (error) {
    return { parsed: null, shapeError: error instanceof RequestShapeError ? error.reason : 'UNKNOWN_SHAPE_ERROR' }
  }
}

function truncate(value: string, limit = historyContentLimit): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

export async function runRealProviderConversation(options: RealProviderOptions = {}): Promise<RealProviderEvidence> {
  const endpoint = options.endpoint ?? process.env.MORROW_REAL_PROVIDER_ENDPOINT ?? defaultEndpoint
  const model = options.model ?? process.env.MORROW_REAL_PROVIDER_MODEL ?? defaultModel
  const timeoutMs = options.timeoutMs ?? 90_000
  const generatedAt = new Date().toISOString()
  const environment = { node: process.version, platform: `${process.platform}-${process.arch}` }

  const reachability = await probe(endpoint, 8_000)
  if (!reachability.reachable) {
    return {
      schemaVersion: 3,
      evidenceClass: 'real_provider',
      generatedAt,
      reproduction: buildReproduction(generatedAt, `blocked|${endpoint}|${model}`),
      status: 'blocked',
      blockedReason: `Local provider unreachable at ${endpoint} (${reachability.detail}). Start it with "ollama serve" or set MORROW_REAL_PROVIDER_ENDPOINT.`,
      provider: { providerClass: 'local', endpoint, model, reachable: false },
      environment,
      turns: [],
      failureScenarios: [],
      checks: [],
      observations: [],
      quality: { assessed: false, note: 'Not run: no reachable provider.' },
      summary: { turnsRequested: 0, turnsCompleted: 0, turnsFailed: 0, failureScenariosExecuted: 0 }
    }
  }

  const directory = mkdtempSync(join(tmpdir(), 'morrow-real-provider-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const secrets = new EvaluationSecretStore()
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const requests: Array<{ raw: string; preview: ProviderConsentPreview }> = []

  try {
    const companion = new CompanionService({
      database,
      memories,
      conversations,
      secrets,
      authorize: async (preview) => {
        requests.push({ raw: preview.exactPayload, preview })
        const approvedAt = new Date()
        return {
          providerId: preview.providerId,
          payloadSha256: preview.payloadSha256,
          approvedAt: approvedAt.toISOString(),
          expiresAt: new Date(approvedAt.getTime() + 120_000).toISOString(),
          includeSensitive: preview.maximumSensitivity === 'sensitive'
        }
      },
      providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, undefined, timeoutMs)
    })

    companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint, model, enabled: true })
    companion.savePersonality({ warmth: 60, directness: 70, humor: 15, disagreementStyle: 'balanced', systemRules: '用中文回答，尽量简短。' })

    const conversationA = companion.createConversation()
    const turns: RealProviderTurnRecord[] = []
    const conversationAReplies: string[] = []

    for (const turn of REAL_PROVIDER_TURNS) {
      // The expected history is derived from what SQLite actually holds, then
      // reduced by the production bound. It is not reconstructed from the
      // script's own turn list, so a message that failed to persist cannot be
      // mistaken for one that was correctly dropped.
      const before = companion.readConversation({ conversationId: conversationA.id }).messages
      const historyMessages: ProviderMessage[] = before.map((message) => ({ role: message.role, content: message.body }))
      const { retained, dropped } = selectRetainedHistory(historyMessages)

      const startedAt = Date.now()
      const requestIndex = requests.length
      const requestId = randomUUID()
      let errorCode: string | null = null
      try {
        await companion.sendChat({ conversationId: conversationA.id, requestId, content: turn.content, includeSensitive: false }, () => undefined)
      } catch (error) {
        errorCode = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR'
      }

      const rawRequest = requests[requestIndex]?.raw ?? ''
      const { parsed, shapeError } = safeParse(rawRequest)
      let historyCheck: CheckSummary | null = null
      let isolationCheck: CheckSummary | null = null
      if (parsed) {
        const outcome = checkHistoryCompleteness(parsed, { retained, dropped, currentUserMessage: turn.content })
        historyCheck = summarize(outcome)
      } else {
        historyCheck = { passed: false, failures: [`request could not be parsed: ${shapeError}`], detail: `shapeError=${shapeError}` }
        isolationCheck = historyCheck
      }

      // Re-read the store after the turn. A failed dispatch must leave the
      // user turn behind and must not leave an assistant turn behind.
      const after = companion.readConversation({ conversationId: conversationA.id }).messages
      const reply = [...after].reverse().find((message) => message.role === 'assistant' && message.turnId === requestId)?.body ?? ''
      if (reply.length > 0) conversationAReplies.push(reply)

      turns.push({
        id: turn.id,
        conversation: 'a',
        content: turn.content,
        requestSha256: sha256(rawRequest),
        requestBytes: Buffer.byteLength(rawRequest, 'utf8'),
        messageRoles: parsed?.messages.map((message) => message.role) ?? [],
        messageContents: parsed?.messages.map((message) => `${message.role}: ${truncate(message.content)}`) ?? [],
        historyCheck,
        isolationCheck,
        responseText: reply,
        storedUserMessages: after.filter((message) => message.role === 'user').length,
        storedAssistantMessages: after.filter((message) => message.role === 'assistant').length,
        elapsedMs: Date.now() - startedAt,
        modelRequested: model,
        errorCode
      })
    }

    // Cross-conversation memory: write a memory, open a brand new conversation,
    // and check that the stored fact is inside the real request body while
    // nothing from conversation A is.
    memories.create(REAL_PROVIDER_MEMORY, 'personal')
    const conversationB = companion.createConversation()
    const crossStartedAt = Date.now()
    const crossRequestIndex = requests.length
    const crossRequestId = randomUUID()
    let crossError: string | null = null
    try {
      await companion.sendChat({ conversationId: conversationB.id, requestId: crossRequestId, content: REAL_PROVIDER_CROSS_QUESTION, includeSensitive: false }, () => undefined)
    } catch (error) {
      crossError = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR'
    }

    const crossRaw = requests[crossRequestIndex]?.raw ?? ''
    const cross = safeParse(crossRaw)
    const crossState = companion.readConversation({ conversationId: conversationB.id })
    const crossReply = [...crossState.messages].reverse().find((message) => message.role === 'assistant' && message.turnId === crossRequestId)?.body ?? ''

    // Every conversational turn of conversation A is foreign to conversation B,
    // including the assistant replies, plus the two unique sentinels.
    const foreignUserMessages = REAL_PROVIDER_TURNS.map((turn) => turn.content)
    const foreignSentinels = [REAL_PROVIDER_SENTINELS.turn1, REAL_PROVIDER_SENTINELS.turn2]
    let crossIsolation: CheckSummary
    if (cross.parsed) {
      crossIsolation = summarize(checkCrossSessionIsolation(cross.parsed, {
        foreignUserMessages,
        foreignAssistantMessages: conversationAReplies,
        foreignSentinels,
        currentUserMessage: REAL_PROVIDER_CROSS_QUESTION,
        requiredMemoryFragment: REAL_PROVIDER_MEMORY_FRAGMENT
      }))
    } else {
      crossIsolation = { passed: false, failures: [`request could not be parsed: ${cross.shapeError}`], detail: `shapeError=${cross.shapeError}` }
    }

    turns.push({
      id: 'turn-4',
      conversation: 'b',
      content: REAL_PROVIDER_CROSS_QUESTION,
      requestSha256: sha256(crossRaw),
      requestBytes: Buffer.byteLength(crossRaw, 'utf8'),
      messageRoles: cross.parsed?.messages.map((message) => message.role) ?? [],
      messageContents: cross.parsed?.messages.map((message) => `${message.role}: ${truncate(message.content)}`) ?? [],
      historyCheck: null,
      isolationCheck: crossIsolation,
      responseText: crossReply,
      storedUserMessages: crossState.messages.filter((message) => message.role === 'user').length,
      storedAssistantMessages: crossState.messages.filter((message) => message.role === 'assistant').length,
      elapsedMs: Date.now() - crossStartedAt,
      modelRequested: model,
      errorCode: crossError
    })

    const failureScenarios = await runFailureScenarios(companion, endpoint, model)

    const completed = turns.filter((turn) => turn.errorCode === null && turn.storedAssistantMessages > 0)
    const historyFailures: string[] = []
    for (const turn of turns.filter((item) => item.conversation === 'a')) {
      if (!turn.historyCheck) historyFailures.push(`${turn.id}: no history check ran`)
      else if (!turn.historyCheck.passed) for (const failure of turn.historyCheck.failures) historyFailures.push(`${turn.id}: ${failure}`)
    }
    const crossTurn = turns.find((turn) => turn.id === 'turn-4')
    // Restricted to the main phase: the failure scenarios deliberately change
    // the model and the endpoint, so reading the last captured request would
    // assert against a request that was designed to fail.
    const mainPhase = requests.slice(0, crossRequestIndex + 1).map((request) => safeParse(request.raw).parsed)
    const mainPhaseParsed = mainPhase.filter((item): item is NonNullable<typeof item> => item !== null)
    const systemTexts = mainPhaseParsed.map((item) => item.messages.find((message) => message.role === 'system')?.content ?? '')
    const personalityEverywhere = systemTexts.length > 0 && systemTexts.every((text) =>
      text.includes('version 2') && text.includes('warmth 60/100') && text.includes('用中文回答'))
    const modelEverywhere = mainPhaseParsed.length > 0 && mainPhaseParsed.every((item) => item.model === model)
    const memoryInTurnFourSystem = cross.parsed?.messages.find((message) => message.role === 'system')?.content.includes(REAL_PROVIDER_MEMORY_FRAGMENT) ?? false

    const executedScenarios = failureScenarios.filter((scenario) => scenario.attempted)
    const failedScenarios = executedScenarios.filter((scenario) => !scenario.passed)

    const checks: RealProviderCheck[] = [
      {
        id: 'provider-reachable',
        description: 'The configured OpenAI-compatible endpoint answered on /models',
        passed: true,
        detail: reachability.detail,
        failures: []
      },
      {
        id: 'first-turn-answered',
        description: 'A real HTTP call returned a non-empty assistant reply, read back from the store',
        passed: (turns.find((turn) => turn.id === 'turn-1')?.storedAssistantMessages ?? 0) === 1,
        detail: `turn-1 storedAssistant=${turns.find((turn) => turn.id === 'turn-1')?.storedAssistantMessages ?? 0}`,
        failures: []
      },
      {
        id: 'multi-turn-history-complete',
        description: 'Every turn carried exactly the history the bound retains, in order, with correct roles and contents',
        passed: historyFailures.length === 0,
        detail: turns.filter((turn) => turn.conversation === 'a').map((turn) => `${turn.id}:${turn.messageRoles.join('|')}`).join(' '),
        failures: historyFailures
      },
      {
        id: 'conversation-isolated',
        description: 'The new conversation request carries the memory and no message from the earlier conversation',
        passed: Boolean(crossTurn?.isolationCheck?.passed),
        detail: crossTurn?.isolationCheck?.detail ?? 'no isolation check ran',
        failures: crossTurn?.isolationCheck?.failures ?? ['no isolation check ran']
      },
      {
        id: 'memory-reaches-real-model',
        description: 'A memory saved before the new conversation appears inside the system message the server received',
        passed: memoryInTurnFourSystem,
        detail: `memoryInSystemPrompt=${memoryInTurnFourSystem}`,
        failures: memoryInTurnFourSystem ? [] : ['memory fragment absent from the system message']
      },
      {
        id: 'personality-in-request',
        description: 'The stored personality version and values are present in every request of the main phase',
        passed: personalityEverywhere,
        detail: `requestsChecked=${systemTexts.length} allCarryPersonality=${personalityEverywhere}`,
        failures: personalityEverywhere ? [] : ['at least one main-phase request lacked the personality block']
      },
      {
        id: 'configured-model-used',
        description: 'Every main-phase request body declared the configured model id',
        passed: modelEverywhere,
        detail: `requestsChecked=${mainPhaseParsed.length} declared=${[...new Set(mainPhaseParsed.map((item) => item.model))].join(',') || 'none'} configured=${model}`,
        failures: modelEverywhere ? [] : ['at least one request declared a different model id']
      },
      {
        id: 'no-credential-in-body',
        description: 'No credential or authorization header value appears in any request body',
        passed: requests.every((request) => !/authorization|bearer\s/iu.test(request.raw)),
        detail: `requests=${requests.length}`,
        failures: []
      },
      {
        id: 'no-fabricated-reply-on-failure',
        description: 'For every failure that was actually provoked against a real socket, SQLite holds the user turn and no assistant turn',
        passed: executedScenarios.length >= 2 && failedScenarios.length === 0,
        detail: `executed=${executedScenarios.length} failed=${failedScenarios.length} modes=${executedScenarios.map((scenario) => scenario.id).join(',')}`,
        failures: [
          ...(executedScenarios.length < 2 ? [`only ${executedScenarios.length} failure mode(s) were provoked against a real socket`] : []),
          ...failedScenarios.map((scenario) => `${scenario.id}: ${scenario.failures.join('; ')}`)
        ]
      }
    ]

    const observations: Array<{ id: string; note: string }> = []
    const turnThreeText = turns.find((turn) => turn.id === 'turn-3')?.responseText ?? ''
    observations.push({
      id: 'recall-of-name-and-city',
      note: `turn-3 reply mentions 林一=${turnThreeText.includes('林一')}, 杭州=${turnThreeText.includes('杭州')}, 后端=${turnThreeText.includes('后端')}. A 0.5B local model frequently fails this. The gating check above only proves the context was delivered, not that the model used it.`
    })
    observations.push({
      id: 'cross-conversation-answer',
      note: `turn-4 reply mentions 杭州=${(crossTurn?.responseText ?? '').includes('杭州')}. The memory was delivered to the model; whether the model used it is a model-capability observation, not a system guarantee.`
    })

    const failed = turns.filter((turn) => turn.errorCode !== null)
    const verified = failed.length === 0 && checks.every((check) => check.passed)
    // The digest covers the replies, so two runs of the same code cannot share
    // an id even if they start inside the same second.
    const seed = turns.map((turn) => `${turn.id}:${turn.responseText}`).join('\n')
    return {
      schemaVersion: 3,
      evidenceClass: 'real_provider',
      generatedAt,
      reproduction: buildReproduction(generatedAt, seed),
      status: verified ? 'verified' : 'failed',
      blockedReason: null,
      provider: { providerClass: 'local', endpoint, model, reachable: true },
      environment,
      turns,
      failureScenarios,
      checks,
      observations,
      quality: {
        assessed: false,
        note: 'No quality verdict is produced. A 0.5B local model is not evidence about reply quality, personality expression, or real-user usefulness in either direction. The observations above are model-capability notes, never gated.'
      },
      summary: {
        turnsRequested: turns.length,
        turnsCompleted: completed.length,
        turnsFailed: failed.length,
        failureScenariosExecuted: executedScenarios.length
      }
    }
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * Provokes provider failures that a real server can actually produce, and reads
 * the store afterwards.
 *
 * Cancel and a bad model id are genuine failures of a real HTTP exchange. Auth
 * (401) and timeout cannot be produced by a local Ollama that is working, so
 * they are recorded as not exercised here and are covered by the offline
 * evaluation instead (`fail-auth`, `fail-timeout` in companion-core-v1). Saying
 * so is the point: a failure mode that was never run must not appear as a pass.
 */
async function runFailureScenarios(
  companion: CompanionService,
  endpoint: string,
  model: string
): Promise<FailureScenarioRecord[]> {
  const scenarios: FailureScenarioRecord[] = []

  // 1. Cancel while the request is in flight. The cancel is triggered from the
  // first streamed delta, so it provably lands after the server started
  // answering rather than before the request was even dispatched.
  const cancelConversation = companion.createConversation()
  const cancelTurnId = randomUUID()
  const cancelMessage = '请讲一个很长的故事。'
  let cancelError: string | null = null
  let streamedBeforeCancel = false
  try {
    const pending = companion.sendChat({ conversationId: cancelConversation.id, requestId: cancelTurnId, content: cancelMessage, includeSensitive: false }, () => {
      if (streamedBeforeCancel) return
      streamedBeforeCancel = true
      companion.cancelChat({ conversationId: cancelConversation.id })
    })
    await pending
  } catch (error) {
    cancelError = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR'
  }
  scenarios.push(failureRecord({
    id: 'cancel',
    description: 'The user cancels after the server started streaming a reply',
    errorCode: cancelError,
    expectedCode: 'PROVIDER_CANCELLED',
    conversation: companion.readConversation({ conversationId: cancelConversation.id }).messages,
    turnId: cancelTurnId,
    userMessage: cancelMessage,
    note: streamedBeforeCancel
      ? 'Real socket: the first delta arrived, the caller aborted mid-stream, and the partial text was not persisted as a reply.'
      : 'Real socket: the request was aborted before any delta arrived. The cancel path is covered, the mid-stream path is not.'
  }))

  // 2. The server rejects the model: a real 404 from the real endpoint.
  const unknownModel = 'morrow-verification-model-does-not-exist:0b'
  companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint, model: unknownModel, enabled: true })
  const modelConversation = companion.createConversation()
  const modelTurnId = randomUUID()
  const modelMessage = '你好。'
  let modelError: string | null = null
  try {
    await companion.sendChat({ conversationId: modelConversation.id, requestId: modelTurnId, content: modelMessage, includeSensitive: false }, () => undefined)
  } catch (error) {
    modelError = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR'
  }
  scenarios.push(failureRecord({
    id: 'server-rejected-model',
    description: 'The endpoint answers with a real error status for an unknown model id',
    errorCode: modelError,
    expectedCode: 'PROVIDER_MODEL',
    conversation: companion.readConversation({ conversationId: modelConversation.id }).messages,
    turnId: modelTurnId,
    userMessage: modelMessage,
    note: 'Real socket: the local server returned a non-2xx response and the client mapped it.'
  }))

  // 3. Nothing is listening on the port: a real connection failure.
  companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: 'http://127.0.0.1:9/v1', model, enabled: true })
  const unreachableConversation = companion.createConversation()
  const unreachableTurnId = randomUUID()
  const unreachableMessage = '你好。'
  let unreachableError: string | null = null
  try {
    await companion.sendChat({ conversationId: unreachableConversation.id, requestId: unreachableTurnId, content: unreachableMessage, includeSensitive: false }, () => undefined)
  } catch (error) {
    unreachableError = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR'
  }
  scenarios.push(failureRecord({
    id: 'endpoint-unreachable',
    description: 'No listener answers on the configured loopback port',
    errorCode: unreachableError,
    expectedCode: 'PROVIDER_NETWORK',
    conversation: companion.readConversation({ conversationId: unreachableConversation.id }).messages,
    turnId: unreachableTurnId,
    userMessage: unreachableMessage,
    note: 'Real socket: the connection failed outright (refused, or a gateway error when a local proxy intercepts it) and no reply was invented.'
  }))

  // Restore the working provider so nothing after this point is affected.
  companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint, model, enabled: true })

  scenarios.push({
    id: 'auth-rejected',
    description: 'A 401/403 from the provider',
    executedAgainst: 'not_exercised',
    attempted: false,
    userMessage: '',
    turnId: '',
    errorCode: null,
    storedUserMessages: 0,
    storedAssistantMessages: 0,
    passed: false,
    failures: [],
    detail: 'not exercised against a real socket',
    note: 'Cannot be provoked with a working local Ollama. Covered offline by the fail-auth case in companion-core-v1.'
  })
  scenarios.push({
    id: 'timeout',
    description: 'The provider exceeds the client timeout',
    executedAgainst: 'not_exercised',
    attempted: false,
    userMessage: '',
    turnId: '',
    errorCode: null,
    storedUserMessages: 0,
    storedAssistantMessages: 0,
    passed: false,
    failures: [],
    detail: 'not exercised against a real socket',
    note: 'Cannot be provoked with a working local Ollama. Covered offline by the fail-timeout case in companion-core-v1.'
  })

  return scenarios
}

function failureRecord(input: {
  id: string
  description: string
  errorCode: string | null
  expectedCode: string
  conversation: Array<{ role: string; body: string; turnId: string }>
  turnId: string
  userMessage: string
  note: string
}): FailureScenarioRecord {
  // The production transaction design stores the user turn before dispatch and
  // stores the assistant turn only after a complete response.
  const outcome = checkFailurePersistence(input.conversation, {
    turnId: input.turnId,
    userMessage: input.userMessage,
    expectUserStored: true
  })
  const failures = [...outcome.failures]
  if (input.errorCode !== input.expectedCode) {
    failures.push(`expected error ${input.expectedCode}, got ${input.errorCode ?? 'none'}`)
  }
  return {
    id: input.id,
    description: input.description,
    executedAgainst: 'real_socket',
    attempted: true,
    userMessage: input.userMessage,
    turnId: input.turnId,
    errorCode: input.errorCode,
    storedUserMessages: input.conversation.filter((message) => message.role === 'user').length,
    storedAssistantMessages: input.conversation.filter((message) => message.role === 'assistant').length,
    passed: failures.length === 0,
    failures,
    detail: outcome.detail,
    note: input.note
  }
}
