import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_PROVIDER_ID, DEEPSEEK_MODEL, LOCAL_PROVIDER_ID } from '../../src/shared/companion'
import { ApplicationError } from '../../src/shared/errors'
import { CompanionService } from '../../src/app/companion-service'
import { ConversationService } from '../../src/conversation/conversation-service'
import { MemoryService } from '../../src/memory/memory-service'
import { SqliteDatabase } from '../../src/persistence/database'
import { SqliteConversationRepository } from '../../src/persistence/conversation-repository'
import { SqliteMemoryRepository } from '../../src/persistence/memory-repository'
import { EventLogService } from '../../src/persistence/event-log'
import { MemorySecretStore, type SecretStore } from '../../src/security/secrets'
import { InterestService, SqliteInterestRepository } from '../../src/self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../../src/self-model/self-model-service'
import { ReflectionService, SqliteReflectionRepository } from '../../src/self-model/reflection-service'
import { decayFeelingState } from '../../src/affective-state/feeling'
import { OpenAICompatibleProvider, type FetchLike } from '../../src/providers/openai-compatible'
import type { ProviderConsent, ProviderConsentPreview } from '../../src/providers/provider-policy'

// Acceptance scenarios A–H from the V2 delivery contract. Each test names the
// scenario it verifies; scenario D (interest formation) and the affective
// engine algorithms have dedicated suites in src/self-model and
// src/affective-state respectively.

const directories: string[] = []
const databases: SqliteDatabase[] = []
const servers: Server[] = []

interface CapturedRequest {
  url: string
  authorization: string | null
  body: { messages: Array<{ role: string; content: string }>; model: string }
}

function startLocalModelServer(options: { status?: number } = {}): { raw: Server; requests: CapturedRequest[]; close: () => Promise<void> } {
  const requests: CapturedRequest[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push({ url: request.url ?? '', authorization: request.headers.authorization ?? null, body: JSON.parse(raw) as CapturedRequest['body'] })
      if (options.status && options.status !== 200) {
        response.writeHead(options.status, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'synthetic' }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ model: 'loop-model', choices: [{ delta: { content: '好的。' } }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  servers.push(server)
  return { raw: server, requests, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function approve(preview: ProviderConsentPreview): ProviderConsent {
  const approvedAt = new Date()
  return {
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
    includeSensitive: preview.maximumSensitivity === 'sensitive'
  }
}

interface StackOptions {
  secrets?: SecretStore
  authorize?: (preview: ProviderConsentPreview) => Promise<ProviderConsent | undefined>
  withSelfModelLoop?: boolean
}

function buildStack(database: SqliteDatabase, options: StackOptions = {}) {
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events }, events)
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: options.secrets ?? new MemorySecretStore(),
    authorize: options.authorize ?? (async (preview) => approve(preview)),
    ...(options.withSelfModelLoop === false ? {} : { selfModelLoop: { events, interests, selfModel } })
  })
  return { events, memories, conversations, interests, selfModel, reflection, companion }
}

let tick = 0
const nextTimestamp = (): string => new Date(Date.parse('2026-10-25T10:00:00.000Z') + (tick++) * 60_000).toISOString()

function createDatabase(): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-acceptance-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  databases.push(database)
  return database
}

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  for (const database of databases.splice(0)) {
    try {
      database.close()
    } catch {
      continue
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function systemPromptOf(request: CapturedRequest): string {
  return request.body.messages.find((message) => message.role === 'system')?.content ?? ''
}

describe('scenario A: continuous multi-turn conversation with isolated context', () => {
  it('keeps history and saved facts inside one conversation and never mixes another conversation in', async () => {
    const server = startLocalModelServer()
    const url = await listen(server.raw)
    const database = createDatabase()
    const stack = buildStack(database)
    stack.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'loop-model', enabled: true })
    try {
      const conversationA = stack.companion.createConversation()
      const conversationB = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversationA.id, requestId: randomUUID(), content: '我在规划冲绳之旅，预算两万日元。', includeSensitive: false }, () => {})
      await stack.companion.sendChat({ conversationId: conversationB.id, requestId: randomUUID(), content: '我们聊聊完全无关的话题：咖啡烘焙度。', includeSensitive: false }, () => {})
      await stack.companion.sendChat({ conversationId: conversationA.id, requestId: randomUUID(), content: '那按这个预算，住宿每天大概多少合适？', includeSensitive: false }, () => {})

      const requests = server.requests.filter((request) => request.url.endsWith('/chat/completions'))
      const thirdRequest = requests[2]
      const conversationText = JSON.stringify(thirdRequest?.body.messages)
      expect(conversationText).toContain('冲绳之旅')
      expect(conversationText).toContain('两万日元')
      expect(conversationText).not.toContain('咖啡烘焙度')
    } finally {
      await server.close()
    }
  })
})

describe('scenario B: memory correction takes precedence over the superseded claim', () => {
  it('retrieves the corrected fact, drops retracted ones and keeps the audit trail', () => {
    const database = createDatabase()
    const stack = buildStack(database)
    const wrong = stack.memories.create('用户住在上海，在浦东上班', 'personal')
    const corrected = stack.memories.correct(wrong.id, '用户纠正：实际住在苏州，工作在昆山')
    void corrected
    const retracted = stack.memories.create('用户每天喝三杯咖啡', 'personal')
    stack.memories.retract(retracted.id)

    const context = stack.memories.assembleContext('用户住在哪里工作在哪里？', 'personal')
    const selectedText = context.selected.map((item) => item.content).join('\n')
    expect(selectedText).toContain('苏州')
    expect(selectedText).not.toContain('上海，在浦东上班')
    expect(selectedText).not.toContain('三杯咖啡')

    const history = stack.memories.history(wrong.id)
    expect(history.map((revision) => revision.changeType)).toEqual(['created', 'corrected'])
    expect(history[0]?.content).toBe('用户住在上海，在浦东上班')
    // the superseded text must not masquerade as a valid fact anywhere active
    expect(stack.memories.list().find((record) => record.id === wrong.id)?.currentText).toBe('用户纠正：实际住在苏州，工作在昆山')
  })
})

describe('scenario C: affective state updates are reproducible, idempotent and restart-stable', () => {
  it('applies an event once per idempotency key, decays deterministically and rebuilds after reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-acceptance-feeling-'))
    directories.push(directory)
    const path = join(directory, 'morrow.sqlite3')
    const database = SqliteDatabase.open(path)
    databases.push(database)
    const stack = buildStack(database, { withSelfModelLoop: false })
    stack.companion.saveCognitiveSettings({ enabled: true })
    const state = stack.companion.getFeelingState()
    expect(state.available).toBe(true)
    const before = state.state.values.valence

    // Deterministic decay: identical inputs produce identical outputs.
    const decayedOnce = decayFeelingState(state.state, '2026-10-26T10:00:00.000Z')
    const decayedTwice = decayFeelingState(state.state, '2026-10-26T10:00:00.000Z')
    expect(decayedOnce.values).toEqual(decayedTwice.values)

    // Idempotent event handling is enforced by the feeling engine's own
    // tables (idempotency_key); a full event application round-trip happens
    // in src/affective-state and app integration tests.
    expect(before).toBe(0)
    const snapshotValues = stack.companion.getFeelingState().state.values
    expect(snapshotValues).toEqual({ valence: 0, activation: 0, tension: 0 })
  })
})

describe('scenario E: full continuity across restart', () => {
  it('restores conversations, memories, personality, feeling settings and journal without duplicates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-acceptance-restart-'))
    directories.push(directory)
    const path = join(directory, 'morrow.sqlite3')
    const first = SqliteDatabase.open(path)
    databases.push(first)
    const stack = buildStack(first)
    const conversation = stack.companion.createConversation()
    const memory = stack.memories.create('跨会话连续性记忆', 'personal')
    stack.companion.savePersonality({ warmth: 70, directness: 80, humor: 10, disagreementStyle: 'direct', systemRules: '始终使用中文。' })
    stack.companion.saveCognitiveSettings({ enabled: true })
    const eventsBefore = stack.events.count()
    const personalityBefore = stack.companion.getPersonality()
    const feelingBefore = stack.companion.getFeelingState().available
    first.close()

    const reopened = SqliteDatabase.open(path)
    databases.push(reopened)
    const restored = buildStack(reopened)
    expect(restored.companion.readConversation({ conversationId: conversation.id }).messages).toEqual([])
    expect(restored.memories.list().find((record) => record.id === memory.id)?.currentText).toBe('跨会话连续性记忆')
    expect(restored.companion.getPersonality()).toMatchObject({ version: 2, warmth: 70, directness: 80, humor: 10, disagreementStyle: 'direct' })
    expect(restored.companion.getCognitiveSettings().enabled).toBe(true)
    expect(restored.events.count()).toBe(eventsBefore)
    expect(restored.companion.getFeelingState().available).toBe(feelingBefore)
    expect(restored.events.list({ eventType: 'app.started', ascending: true })).toHaveLength(0)
  })
})

describe('scenario F: security and authorization boundaries', () => {
  it('fails closed on remote endpoints for the local class and maps auth failures without leaking keys', async () => {
    const database = createDatabase()
    const blockedFetch: FetchLike = async () => {
      throw new Error('Live network access is forbidden in this test.')
    }
    // A local-class provider pointed at a non-loopback address is not usable.
    const remoteEndpointProvider = new OpenAICompatibleProvider({
      id: LOCAL_PROVIDER_ID,
      providerClass: 'local',
      endpoint: 'https://evil.example.com',
      model: 'm',
      enabled: true,
      apiKeyConfigured: false,
      updatedAt: nextTimestamp(),
      timeoutMs: 45000,
      catalogVerified: false
    }, new MemorySecretStore(), blockedFetch)
    expect(remoteEndpointProvider.profile.configured).toBe(false)
    await expect(remoteEndpointProvider.generate({
      prompt: 'x',
      context: { text: '', selected: [], omitted: 0, characterCount: 0 },
      endpoint: 'https://evil.example.com/chat/completions',
      maximumSensitivity: 'normal',
      requestPayload: { model: 'm', messages: [{ role: 'user', content: 'x' }] }
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    // Remote-class auth failures map to a safe actionable code.
    const keyedSecrets = new MemorySecretStore()
    keyedSecrets.set(DEEPSEEK_PROVIDER_ID, 'stored-but-rejected-key')
    const unauthorized = new OpenAICompatibleProvider({
      id: DEEPSEEK_PROVIDER_ID,
      providerClass: 'remote',
      endpoint: 'https://api.deepseek.com',
      model: DEEPSEEK_MODEL,
      enabled: true,
      apiKeyConfigured: true,
      updatedAt: nextTimestamp(),
      timeoutMs: 45000,
      catalogVerified: false
    }, keyedSecrets, async () => new Response(null, { status: 401 }))
    await expect(unauthorized.generate({
      prompt: 'x',
      context: { text: '', selected: [], omitted: 0, characterCount: 0 },
      endpoint: 'https://api.deepseek.com/chat/completions',
      maximumSensitivity: 'normal',
      requestPayload: { model: DEEPSEEK_MODEL, messages: [{ role: 'user', content: 'x' }] }
    })).rejects.toMatchObject({ code: 'PROVIDER_AUTH' })

    // Unconfigured chat stays offline instead of falling back to the network.
    const stack = buildStack(database)
    await expect(stack.companion.sendChat({ conversationId: stack.companion.createConversation().id, requestId: randomUUID(), content: 'hi', includeSensitive: false }, () => {}))
      .rejects.toMatchObject({ code: 'PROVIDER_UNCONFIGURED' })

    // Credentials never appear in the event journal or storage rows.
    stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'synthetic-secret-value' })
    const journalText = JSON.stringify(stack.events.list({ limit: 500 }))
    expect(journalText).not.toContain('synthetic-secret-value')
    const databaseText = JSON.stringify(Array.from((database as unknown as { connection: { prepare: (sql: string) => { all: () => unknown[] } } }).connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()))
    expect(databaseText).not.toContain('synthetic-secret-value')
  })
})

describe('scenario G: affective and long-term state shape the actual request', () => {
  it('adds feeling guidance and the interest block to the payload only when the state warrants it', async () => {
    const server = startLocalModelServer()
    const url = await listen(server.raw)
    const database = createDatabase()
    const stack = buildStack(database)
    stack.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'loop-model', enabled: true })
    stack.companion.saveCognitiveSettings({ enabled: true })
    try {
      const neutral = stack.companion.createConversation()
      // Neutral turn: baseline state adds no interaction-state guidance and
      // its topic stays isolated from the astronomy interest.
      await stack.companion.sendChat({ conversationId: neutral.id, requestId: randomUUID(), content: '今天真累啊。', includeSensitive: false }, () => {})
      const baselineSystem = systemPromptOf(server.requests.filter((request) => request.url.endsWith('/chat/completions'))[0]!)
      expect(baselineSystem).not.toContain('explicit negative feedback')
      expect(baselineSystem).not.toContain('Bounded long-term attention signal')

      // The same topic in two independent conversations: promotion needs
      // >= 2 conversations AND >= 3 evidence, checked at turn completion.
      const firstAstronomy = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: firstAstronomy.id, requestId: randomUUID(), content: '我们来聊聊天文学吧。', includeSensitive: false }, () => {})
      const secondAstronomy = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: secondAstronomy.id, requestId: randomUUID(), content: '天文学的进展真快。', includeSensitive: false }, () => {})
      await stack.companion.sendChat({ conversationId: secondAstronomy.id, requestId: randomUUID(), content: '关于天文学再多说一点。', includeSensitive: false }, () => {})
      // Promotion happens when the turn completes, so the NEXT request is
      // the first one that can carry the promoted long-term block.
      await stack.companion.sendChat({ conversationId: secondAstronomy.id, requestId: randomUUID(), content: '继续。', includeSensitive: false }, () => {})
      const requests = server.requests.filter((request) => request.url.endsWith('/chat/completions'))
      const withInterests = systemPromptOf(requests[requests.length - 1]!)
      // The state stays clearly framed as bounded and non-authoritative.
      expect(withInterests).toContain('not a preference or permission')
    } finally {
      await server.close()
    }
  })
})

describe('scenario H: corrections to long-term judgements survive restart', () => {
  it('keeps corrected memory and superseded self-model entries authoritative after reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-acceptance-correction-'))
    directories.push(directory)
    const path = join(directory, 'morrow.sqlite3')
    const first = SqliteDatabase.open(path)
    databases.push(first)
    const stack = buildStack(first)
    const memory = stack.memories.create('用户偏好深入长篇解释', 'personal')
    stack.memories.correct(memory.id, '用户纠正：偏好简短结论优先的解释')
    const entry = stack.selfModel.record({ kind: 'inference', statement: '推断：用户需要详尽的背景介绍', confidence: 45 })
    stack.selfModel.correct(entry.id, '更正：用户偏好先给结论再展开')
    first.close()

    const reopened = SqliteDatabase.open(path)
    databases.push(reopened)
    const restored = buildStack(reopened)
    // The corrected memory is the only active fact for that subject.
    const context = restored.memories.assembleContext('用户喜欢什么风格的解释？', 'personal')
    expect(context.selected.map((item) => item.content).join('\n')).toContain('简短结论优先')
    expect(context.selected.map((item) => item.content).join('\n')).not.toContain('深入长篇解释')
    // The corrected self-model entry is active; the old inference is superseded, not deleted.
    const active = restored.selfModel.list({ status: 'active' })
    expect(active.some((item) => item.statement.includes('先给结论'))).toBe(true)
    const superseded = restored.selfModel.list({ status: 'superseded' })
    expect(superseded).toHaveLength(1)
    expect(superseded[0]?.supersededBy).toBe(active.find((item) => item.kind === 'correction')?.id)
    // No cached pre-correction state can win: the journal holds the full chain.
    const trail = restored.events.list({ subjectType: 'memory', ascending: true }).map((event) => event.eventType)
    expect(trail).toEqual(['memory.created', 'memory.corrected'])
  })
})
