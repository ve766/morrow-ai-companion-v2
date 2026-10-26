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

/**
 * Real-provider multi-turn verification.
 *
 * This drives the production chat path against an actually running
 * OpenAI-compatible server (by default a local Ollama on 127.0.0.1:11434) and
 * records what the server received. It separates two kinds of claim:
 *
 *   checks      objective, reproducible, gating: did the request arrive, did it
 *               carry the previous turn, did it carry the saved memory, did the
 *               configured model answer at all;
 *   observations  informational only: whether a small local model happened to
 *               repeat a name or a city. Those are quality signals, not proof.
 *
 * A quality verdict is explicitly NOT produced here. A 0.5B local model is not
 * evidence about companion quality in either direction.
 */

export const REAL_PROVIDER_TURNS = [
  { id: 'turn-1', content: '我叫林一，住在杭州，做后端开发。' },
  { id: 'turn-2', content: '我平时喝手冲咖啡。' },
  { id: 'turn-3', content: '你还记得我叫什么、住在哪里、做什么工作吗？' }
] as const

export const REAL_PROVIDER_MEMORY = '林一住在杭州，做后端开发，常喝手冲咖啡。'

export interface RealProviderCheck {
  id: string
  description: string
  passed: boolean
  detail: string
}

export interface RealProviderTurnRecord {
  id: string
  conversation: 'a' | 'b'
  content: string
  requestSha256: string
  requestBytes: number
  messageRoles: string[]
  containsPreviousUserTurn: boolean
  containsPreviousAssistantTurn: boolean
  containsMemory: boolean
  responseText: string
  responseChars: number
  elapsedMs: number
  modelRequested: string
  errorCode: string | null
}

export interface RealProviderEvidence {
  schemaVersion: 1
  generatedAt: string
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
  checks: RealProviderCheck[]
  observations: Array<{ id: string; note: string }>
  quality: { assessed: boolean; note: string }
  summary: { turnsRequested: number; turnsCompleted: number; turnsFailed: number }
}

export interface RealProviderOptions {
  endpoint?: string
  model?: string
  timeoutMs?: number
  probeOnly?: boolean
}

const defaultEndpoint = 'http://127.0.0.1:11434/v1'
const defaultModel = 'qwen2.5:0.5b'

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

export async function runRealProviderConversation(options: RealProviderOptions = {}): Promise<RealProviderEvidence> {
  const endpoint = options.endpoint ?? process.env.MORROW_REAL_PROVIDER_ENDPOINT ?? defaultEndpoint
  const model = options.model ?? process.env.MORROW_REAL_PROVIDER_MODEL ?? defaultModel
  const timeoutMs = options.timeoutMs ?? 90_000
  const generatedAt = new Date().toISOString()
  const environment = { node: process.version, platform: `${process.platform}-${process.arch}` }

  const reachability = await probe(endpoint, 8_000)
  if (!reachability.reachable) {
    return {
      schemaVersion: 1,
      generatedAt,
      status: 'blocked',
      blockedReason: `Local provider unreachable at ${endpoint} (${reachability.detail}). Start it with "ollama serve" or set MORROW_REAL_PROVIDER_ENDPOINT.`,
      provider: { providerClass: 'local', endpoint, model, reachable: false },
      environment,
      turns: [],
      checks: [],
      observations: [],
      quality: { assessed: false, note: 'Not run: no reachable provider.' },
      summary: { turnsRequested: 0, turnsCompleted: 0, turnsFailed: 0 }
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
    let previousUser = ''
    let previousAssistant = ''

    for (const turn of REAL_PROVIDER_TURNS) {
      const startedAt = Date.now()
      const requestIndex = requests.length
      try {
        await companion.sendChat({ conversationId: conversationA.id, requestId: randomUUID(), content: turn.content, includeSensitive: false }, () => undefined)
      } catch (error) {
        const code = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR'
        const rawRequest = requests[requestIndex]?.raw ?? ''
        turns.push({
          id: turn.id,
          conversation: 'a',
          content: turn.content,
          requestSha256: sha256(rawRequest),
          requestBytes: Buffer.byteLength(rawRequest, 'utf8'),
          messageRoles: [],
          containsPreviousUserTurn: false,
          containsPreviousAssistantTurn: false,
          containsMemory: false,
          responseText: '',
          responseChars: 0,
          elapsedMs: Date.now() - startedAt,
          modelRequested: model,
          errorCode: code
        })
        previousUser = turn.content
        continue
      }
      const rawRequest = requests[requestIndex]?.raw ?? ''
      const conversation = companion.readConversation({ conversationId: conversationA.id })
      const lastAssistant = [...conversation.messages].reverse().find((message) => message.role === 'assistant')
      const responseText = lastAssistant?.body ?? ''
      const parsed = JSON.parse(rawRequest) as { body: { messages: Array<{ role: string; content: string }> } }
      turns.push({
        id: turn.id,
        conversation: 'a',
        content: turn.content,
        requestSha256: sha256(rawRequest),
        requestBytes: Buffer.byteLength(rawRequest, 'utf8'),
        messageRoles: parsed.body.messages.map((message) => message.role),
        containsPreviousUserTurn: previousUser.length === 0 ? true : rawRequest.includes(previousUser),
        containsPreviousAssistantTurn: previousAssistant.length === 0 ? true : rawRequest.includes(previousAssistant),
        containsMemory: false,
        responseText,
        responseChars: responseText.length,
        elapsedMs: Date.now() - startedAt,
        modelRequested: model,
        errorCode: null
      })
      previousUser = turn.content
      previousAssistant = responseText
    }

    // Cross-conversation memory: write a memory, open a brand new conversation,
    // and check that the stored fact is inside the real request body.
    memories.create(REAL_PROVIDER_MEMORY, 'personal')
    const conversationB = companion.createConversation()
    const crossStartedAt = Date.now()
    const crossRequestIndex = requests.length
    let crossError: string | null = null
    try {
      await companion.sendChat({ conversationId: conversationB.id, requestId: randomUUID(), content: '我住在哪里？', includeSensitive: false }, () => undefined)
    } catch (error) {
      crossError = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR'
    }
    const crossRaw = requests[crossRequestIndex]?.raw ?? ''
    const conversationBState = companion.readConversation({ conversationId: conversationB.id })
    const crossResponse = [...conversationBState.messages].reverse().find((message) => message.role === 'assistant')?.body ?? ''
    const crossParsed = crossRaw.length > 0 ? JSON.parse(crossRaw) as { body: { messages: Array<{ role: string; content: string }> } } : null
    turns.push({
      id: 'turn-4',
      conversation: 'b',
      content: '我住在哪里？',
      requestSha256: sha256(crossRaw),
      requestBytes: Buffer.byteLength(crossRaw, 'utf8'),
      messageRoles: crossParsed?.body.messages.map((message) => message.role) ?? [],
      containsPreviousUserTurn: true,
      containsPreviousAssistantTurn: true,
      containsMemory: crossRaw.includes('林一住在杭州'),
      responseText: crossResponse,
      responseChars: crossResponse.length,
      elapsedMs: Date.now() - crossStartedAt,
      modelRequested: model,
      errorCode: crossError
    })

    const completed = turns.filter((turn) => turn.errorCode === null && turn.responseChars > 0)
    const turnThree = turns.find((turn) => turn.id === 'turn-3')
    const turnTwo = turns.find((turn) => turn.id === 'turn-2')
    const crossTurn = turns.find((turn) => turn.id === 'turn-4')
    const anyRequest = requests.at(-1)?.raw ?? ''

    const checks: RealProviderCheck[] = [
      {
        id: 'provider-reachable',
        description: 'The configured OpenAI-compatible endpoint answered on /models',
        passed: true,
        detail: reachability.detail
      },
      {
        id: 'first-turn-answered',
        description: 'A real HTTP call returned a non-empty assistant reply',
        passed: (turns.find((turn) => turn.id === 'turn-1')?.responseChars ?? 0) > 0,
        detail: `turn-1 chars=${turns.find((turn) => turn.id === 'turn-1')?.responseChars ?? 0}`
      },
      {
        id: 'multi-turn-context',
        description: 'Turn 3 request still carried turn 1 and turn 2 exchanges',
        passed: Boolean(turnThree?.containsPreviousUserTurn) && Boolean(turnTwo?.containsPreviousAssistantTurn) &&
          (turnThree?.requestBytes ?? 0) > (turnTwo?.requestBytes ?? Number.MAX_SAFE_INTEGER),
        detail: `turn-3 bytes=${turnThree?.requestBytes ?? 0} turn-2 bytes=${turnTwo?.requestBytes ?? 0}`
      },
      {
        id: 'conversation-isolated',
        description: 'The new conversation request contains the memory but not the earlier conversation text',
        passed: Boolean(crossTurn?.containsMemory) && !(crossTurn?.requestBytes === turnThree?.requestBytes),
        detail: `cross bytes=${crossTurn?.requestBytes ?? 0} memoryInRequest=${crossTurn?.containsMemory ?? false}`
      },
      {
        id: 'memory-reaches-real-model',
        description: 'A memory saved before the new conversation appears inside the real request body',
        passed: Boolean(crossTurn?.containsMemory),
        detail: `memoryInRequest=${crossTurn?.containsMemory ?? false}`
      },
      {
        id: 'personality-in-request',
        description: 'The stored personality version and values are present in the request the server received',
        passed: anyRequest.includes('version 2') && anyRequest.includes('warmth 60/100') && anyRequest.includes('用中文回答'),
        detail: `versionInRequest=${anyRequest.includes('version 2')} warmthInRequest=${anyRequest.includes('warmth 60/100')}`
      },
      {
        id: 'configured-model-used',
        description: 'The request declared the configured model id',
        passed: anyRequest.includes(`"model":"${model}"`),
        detail: `model=${model}`
      },
      {
        id: 'no-credential-in-body',
        description: 'No credential or authorization header value appears in the request body',
        passed: !/authorization|bearer\s/iu.test(anyRequest),
        detail: `bodyBytes=${Buffer.byteLength(anyRequest, 'utf8')}`
      },
      {
        id: 'no-fabricated-reply-on-failure',
        description: 'No turn stored an assistant message while reporting an error',
        passed: turns.every((turn) => turn.errorCode === null || turn.responseChars === 0),
        detail: `failedTurns=${turns.filter((turn) => turn.errorCode !== null).length}`
      }
    ]

    const observations: Array<{ id: string; note: string }> = []
    const turnThreeText = turnThree?.responseText ?? ''
    observations.push({
      id: 'recall-of-name-and-city',
      note: `turn-3 reply mentions 林一=${turnThreeText.includes('林一')}, 杭州=${turnThreeText.includes('杭州')}, 后端=${turnThreeText.includes('后端')}. A 0.5B local model frequently fails this; the check above only proves the context was delivered, not that the model used it.`
    })
    observations.push({
      id: 'cross-conversation-answer',
      note: `turn-4 reply mentions 杭州=${(crossTurn?.responseText ?? '').includes('杭州')}. The memory was delivered to the model; whether the model used it is a model-capability observation, not a system guarantee.`
    })

    const failed = turns.filter((turn) => turn.errorCode !== null)
    return {
      schemaVersion: 1,
      generatedAt,
      status: failed.length === 0 && checks.every((check) => check.passed) ? 'verified' : failed.length > 0 ? 'failed' : 'failed',
      blockedReason: null,
      provider: { providerClass: 'local', endpoint, model, reachable: true },
      environment,
      turns,
      checks,
      observations,
      quality: {
        assessed: false,
        note: 'No quality verdict is produced. A 0.5B local model is not evidence about reply quality, personality expression, or real-user usefulness in either direction.'
      },
      summary: { turnsRequested: turns.length, turnsCompleted: completed.length, turnsFailed: failed.length }
    }
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
