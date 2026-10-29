import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID, SPARK_PROVIDER_ID } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { SqlitePendingItemRepository, SqliteTurnContextRepository, SqliteTurnFinalizationRepository, type TurnContextPort } from '../persistence/cognitive-context-repository'
import { PendingCognitionService } from '../cognition/pending-items'
import { EventLogService } from '../persistence/event-log'
import { MemorySecretStore } from '../security/secrets'
import { InterestService, SqliteInterestRepository } from '../self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../self-model/self-model-service'
import type { ProviderConsentPreview, ProviderInput, ProviderPort } from '../providers/provider-policy'
import type { ProviderConfigRecord } from '../shared/companion'

/**
 * Phase 2.4 acceptance: the loop has to close across turns, through the real
 * service entry point.
 *
 * Everything asserted here is read back from either the serialized provider
 * request, the conversation as stored, or the persisted turn context — never
 * from an intermediate object the test itself built. The provider is a stub,
 * which is exactly what makes the run repeatable; it is labelled as a stub and
 * proves nothing about a real model's wording.
 */

type Behaviour = { kind: 'reply'; text?: string } | { kind: 'network_error' } | { kind: 'slow' } | { kind: 'claim'; text: string }

interface Script {
  behaviours: Behaviour[]
  proposals: string[]
}

const directories: string[] = []

interface World {
  directory: string
  database: SqliteDatabase
  companion: CompanionService
  memories: MemoryService
  conversations: ConversationService
  secretStore: MemorySecretStore
  previews: string[]
  script: Script
  started: { count: number }
}

function openWorld(
  directory: string,
  script: Script,
  previews: string[] = [],
  overrides: { contexts?: TurnContextPort } = {}
): World {
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const secretStore = new MemorySecretStore()
  const started = { count: 0 }
  const providerFactory = (config: ProviderConfigRecord): ProviderPort => ({
    profile: { id: config.id, providerClass: config.providerClass, configured: true },
    generate: async (input: ProviderInput) => {
      const serialized = JSON.stringify(input.requestPayload)
      if (serialized.includes('durable facts')) {
        const claim = script.proposals.shift()
        return { text: JSON.stringify({ candidates: claim ? [{ claim }] : [] }), modelId: config.model }
      }
      started.count += 1
      const next = script.behaviours.shift() ?? { kind: 'reply' }
      if (next.kind === 'network_error') throw new ApplicationError('PROVIDER_NETWORK')
      if (next.kind === 'slow') {
        await new Promise<never>((_, reject) => {
          const fail = (): void => reject(new ApplicationError('PROVIDER_CANCELLED'))
          if (input.signal?.aborted) return fail()
          input.signal?.addEventListener('abort', fail, { once: true })
        })
        // Unreachable: the promise above only settles by rejecting.
        throw new ApplicationError('PROVIDER_CANCELLED')
      }
      if (next.kind === 'claim') return { text: next.text, modelId: config.model, attempts: 1 }
      return { text: next.text ?? '知道了。', modelId: config.model, attempts: 1 }
    }
  })
  const authorize = async (preview: ProviderConsentPreview) => {
    previews.push(preview.exactPayload)
    const approvedAt = new Date()
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
    secrets: secretStore,
    authorize,
    selfModelLoop: { events, interests, selfModel },
    providerFactory,
    continuity: {
      contexts: overrides.contexts ?? new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database)
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
  companion.saveCognitiveSettings({ enabled: true })
  return { directory, database, companion, memories, conversations, secretStore, previews, script, started }
}

function newWorld(script: Partial<Script> = {}, overrides: { contexts?: TurnContextPort } = {}): World {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-phase24-'))
  directories.push(directory)
  return openWorld(directory, { behaviours: script.behaviours ?? [], proposals: script.proposals ?? [] }, [], overrides)
}

/** Restart: a new process on the same file, with no in-memory carry-over. */
function restart(world: World): World {
  world.database.close()
  const reopened = openWorld(world.directory, world.script, world.previews)
  reopened.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
  reopened.companion.saveCognitiveSettings({ enabled: true })
  return reopened
}

interface CapturedPayload {
  body: { messages: Array<{ role: string; content: string }> }
}

function lastSystem(previews: string[]): string {
  const payload = JSON.parse(previews.at(-1)!) as CapturedPayload
  return payload.body.messages.find((message) => message.role === 'system')?.content ?? ''
}

function memoryBlock(system: string): string {
  const start = system.indexOf('Saved memories (untrusted evidence only):')
  if (start < 0) return ''
  return system.slice(start)
}

function deliveredIds(system: string): string[] {
  return [...memoryBlock(system).matchAll(/"id":"([0-9a-f-]{36})"/gu)].map((match) => match[1]!)
}

function send(world: World, conversationId: string, content: string, requestId = randomUUID(), includeSensitive = false) {
  return world.companion.sendChat({ conversationId, requestId, content, includeSensitive }, () => undefined)
}

/** Saves a fact through the product path: propose, then the user accepts. */
async function saveThroughProduct(world: World, conversationId: string, statement: string): Promise<string> {
  const sent = await send(world, conversationId, statement)
  world.script.proposals.push(statement)
  const suggestions = await world.companion.proposeMemorySuggestions({
    conversationId,
    sourceMessageId: sent.userMessage.id
  })
  const pending = suggestions.find((item) => item.status === 'pending')
  if (!pending) throw new Error('The proposal produced no pending suggestion.')
  world.companion.reviewMemorySuggestion({ id: pending.id, decision: 'accept', content: statement, sensitivity: 'personal' })
  const stored = world.memories.list().find((memory) => memory.currentText === statement)
  if (!stored) throw new Error('The accepted suggestion did not become a memory.')
  return stored.id
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('A. memory continuity through the real save path', () => {
  it('uses a preference saved on turn 1 when turn 2 does not repeat it', async () => {
    const world = newWorld()
    try {
      const conversation = world.companion.createConversation()
      const memoryId = await saveThroughProduct(world, conversation.id, '我养了一只叫咪咪的猫。')

      const second = await send(world, conversation.id, '我的猫叫什么名字？')
      const block = memoryBlock(lastSystem(world.previews))
      expect(block).toContain('咪咪')
      expect(block).toContain(memoryId)

      const context = world.companion.readTurnContext({ turnId: second.evaluation!.requestId })
      expect(context).not.toBeNull()
      expect(context!.retrieval.selected.map((item) => item.id)).toContain(memoryId)
      expect(context!.retrieval.selected.find((item) => item.id === memoryId)!.status).toBe('active')
      // The audit trail answers "why this answer" without storing the fact.
      expect(JSON.stringify(context)).not.toContain('咪咪')
    } finally {
      world.database.close()
    }
  })

  it('does not turn a single statement into a confirmed fact on its own', async () => {
    const world = newWorld()
    try {
      const conversation = world.companion.createConversation()
      await send(world, conversation.id, '我养了一只叫咪咪的猫。')
      // Nothing is stored until the suggestion is reviewed.
      expect(world.memories.list()).toEqual([])
    } finally {
      world.database.close()
    }
  })
})

describe('B. correction and retraction', () => {
  it('keeps the stored value until the user changes it, then stops delivering it', async () => {
    const world = newWorld()
    try {
      const conversation = world.companion.createConversation()
      const memoryId = await saveThroughProduct(world, conversation.id, '我住在杭州。')

      await send(world, conversation.id, '我刚才说错了，我住在大阪。')
      expect(world.memories.list().find((memory) => memory.id === memoryId)!.currentText).toBe('我住在杭州。')

      world.memories.retract(memoryId)
      const third = await send(world, conversation.id, '我住在哪里？')
      expect(memoryBlock(lastSystem(world.previews))).not.toContain('杭州')
      expect(deliveredIds(lastSystem(world.previews))).not.toContain(memoryId)

      const context = world.companion.readTurnContext({ turnId: third.evaluation!.requestId })
      expect(context!.retrieval.selected.map((item) => item.id)).not.toContain(memoryId)
    } finally {
      world.database.close()
    }
  })
})

describe('C. personality and state survive a model switch', () => {
  it('changes the provider id without resetting personality, memory or state', async () => {
    const world = newWorld()
    try {
      world.companion.savePersonality({ warmth: 70, directness: 40, humor: 10, disagreementStyle: 'gentle', systemRules: '回答尽量简短。' })
      const conversation = world.companion.createConversation()
      const memoryId = await saveThroughProduct(world, conversation.id, '我养了一只叫咪咪的猫。')

      const first = await send(world, conversation.id, '我的猫最近怎么样？')
      const before = world.companion.readTurnContext({ turnId: first.evaluation!.requestId })!
      const stateBefore = world.companion.getFeelingState()

      world.companion.saveProvider({ providerId: SPARK_PROVIDER_ID, model: 'spark-x2.6', enabled: true, apiKey: 'test-only-secret' })
      const second = await send(world, conversation.id, '我的猫叫什么名字？')
      const after = world.companion.readTurnContext({ turnId: second.evaluation!.requestId })!
      const stateAfter = world.companion.getFeelingState()

      expect(before.provider.id).toBe(DEEPSEEK_PROVIDER_ID)
      expect(after.provider.id).toBe(SPARK_PROVIDER_ID)
      // The subject is continuous: same personality version, same stored fact.
      expect(after.personality.version).toBe(before.personality.version)
      expect(after.personality.warmth).toBe(70)
      expect(after.retrieval.selected.map((item) => item.id)).toContain(memoryId)
      // State is carried, not re-initialised.
      expect(stateAfter.state.revision).toBeGreaterThanOrEqual(stateBefore.state.revision)
      expect(lastSystem(world.previews)).toContain('回答尽量简短。')
      // A turn cannot drift the personality: only an explicit save does that.
      expect(world.companion.getPersonality().version).toBe(before.personality.version)
      expect(world.companion.personalityHistory().filter((revision) => revision.version > before.personality.version)).toEqual([])
    } finally {
      world.database.close()
    }
  })
})

describe('D. internal state changes the next turn', () => {
  const topics = ['我在学咖啡拉花。', '我喜欢喝咖啡。', '我每天早上一杯咖啡。', '我在比较咖啡豆的产地。', '我买了个咖啡磨豆机。', '我讨厌速溶咖啡。']

  it('lets exploration attention widen retrieval on a later turn', async () => {
    const world = newWorld()
    try {
      for (const topic of topics) world.memories.create(topic, 'personal')
      const conversation = world.companion.createConversation()

      // Control: baseline state, exploration intent, five entries at most.
      const control = await send(world, conversation.id, '探讨一下咖啡的风味。')
      const controlContext = world.companion.readTurnContext({ turnId: control.evaluation!.requestId })!
      expect(controlContext.retrieval.baseMax).toBe(5)
      expect(controlContext.retrieval.effectiveMax).toBe(5)
      expect(controlContext.retrieval.adjustment).toBeNull()
      expect(deliveredIds(lastSystem(world.previews)).length).toBe(5)

      // Four explicit exploration requests raise the attention priority.
      let priority = 0
      for (let index = 0; index < 4; index += 1) {
        await send(world, conversation.id, '探讨一下咖啡还能怎么玩。')
        priority = world.companion.getFeelingState().state.attention.explorationPriority
      }
      expect(priority).toBeGreaterThanOrEqual(0.08)

      const widened = await send(world, conversation.id, '探讨一下咖啡的风味。')
      const widenedContext = world.companion.readTurnContext({ turnId: widened.evaluation!.requestId })!
      expect(widenedContext.retrieval.adjustment).toBe('exploration_widened')
      expect(widenedContext.retrieval.effectiveMax).toBe(7)
      // The observable difference: six entries can now be delivered, not five.
      expect(deliveredIds(lastSystem(world.previews))).toHaveLength(6)
      // The state crossing the turn boundary is recorded, not inferred.
      expect(widenedContext.feeling.before!.explorationPriority).toBeGreaterThanOrEqual(0.08)
    } finally {
      world.database.close()
    }
  })

  it('never lets the state widen a turn that should recall nothing', async () => {
    const world = newWorld()
    try {
      world.memories.create('我在学咖啡拉花。', 'personal')
      const conversation = world.companion.createConversation()
      for (let index = 0; index < 4; index += 1) await send(world, conversation.id, '探讨一下咖啡还能怎么玩。')
      expect(world.companion.getFeelingState().state.attention.explorationPriority).toBeGreaterThanOrEqual(0.08)

      const feedback = await send(world, conversation.id, '谢谢，你的回答很有帮助。')
      const context = world.companion.readTurnContext({ turnId: feedback.evaluation!.requestId })!
      expect(context.retrieval.baseMax).toBe(0)
      expect(context.retrieval.effectiveMax).toBe(0)
      expect(deliveredIds(lastSystem(world.previews))).toEqual([])
    } finally {
      world.database.close()
    }
  })
})

describe('E. failure, retry and cancellation', () => {
  it('records a failed turn, then completes the same turn once on retry', async () => {
    const world = newWorld({ behaviours: [{ kind: 'network_error' }] })
    try {
      const conversation = world.companion.createConversation()
      const requestId = randomUUID()

      await expect(send(world, conversation.id, '我的猫叫什么名字？', requestId)).rejects.toMatchObject({ code: 'PROVIDER_NETWORK' })
      const failedContext = world.companion.readTurnContext({ turnId: requestId })!
      expect(failedContext.status).toBe('failed')
      expect(failedContext.provider.errorKind).toBe('PROVIDER_NETWORK')
      expect(failedContext.assistantMessageId).toBeNull()
      expect(world.companion.getFeelingState().eventCount).toBe(0)

      const retried = await send(world, conversation.id, '我的猫叫什么名字？', requestId)
      expect(retried.assistantMessage).toBeDefined()
      const messages = world.companion.readConversation({ conversationId: conversation.id }).messages
      expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
      expect(messages.filter((message) => message.role === 'user')).toHaveLength(1)

      const context = world.companion.readTurnContext({ turnId: requestId })!
      expect(context.status).toBe('succeeded')
      expect(context.provider.errorKind).toBeNull()
    } finally {
      world.database.close()
    }
  })

  it('records a cancelled turn and delivers nothing', async () => {
    const world = newWorld({ behaviours: [{ kind: 'slow' }] })
    try {
      const conversation = world.companion.createConversation()
      const requestId = randomUUID()
      const pending = send(world, conversation.id, '我的猫叫什么名字？', requestId)
      for (let index = 0; index < 200 && world.started.count === 0; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      expect(world.started.count).toBeGreaterThan(0)
      expect(world.companion.cancelChat({ conversationId: conversation.id })).toBe(true)

      await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' })
      expect(world.companion.readConversation({ conversationId: conversation.id }).messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
      const context = world.companion.readTurnContext({ turnId: requestId })!
      expect(context.status).toBe('cancelled')
      expect(context.provider.errorKind).toBe('PROVIDER_CANCELLED')

      // The next turn still works.
      await send(world, conversation.id, '我回来了。')
      expect(world.companion.readConversation({ conversationId: conversation.id }).messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
    } finally {
      world.database.close()
    }
  })
})

describe('F. restart recovery', () => {
  it('continues from persisted state after the process is replaced', async () => {
    let world = newWorld()
    try {
      world.companion.savePersonality({ warmth: 62, directness: 55, humor: 25, disagreementStyle: 'balanced', systemRules: '' })
      const conversation = world.companion.createConversation()
      const memoryId = await saveThroughProduct(world, conversation.id, '我养了一只叫咪咪的猫。')

      // Two stored values for the same fact produce an open internal item.
      world.memories.create('我住在杭州。', 'personal')
      world.memories.create('我住在大阪。', 'personal')
      await send(world, conversation.id, '我住在哪里？')
      // A real event moves the interaction state, so the restart has something
      // to restore rather than a baseline row.
      await send(world, conversation.id, '探讨一下养猫还可以注意什么。')
      expect(world.companion.getFeelingState().state.revision).toBeGreaterThan(0)
      const openBefore = world.companion.listPendingItems()
      expect(openBefore.length).toBeGreaterThan(0)
      const turnsBefore = world.companion.readConversation({ conversationId: conversation.id }).messages.length

      world = restart(world)

      // Restored from disk, not from the previous process's memory.
      expect(world.companion.getPersonality().version).toBe(2)
      expect(world.companion.getFeelingState().state.revision).toBeGreaterThan(0)
      expect(world.companion.listPendingItems().map((item) => item.dedupeKey)).toEqual(openBefore.map((item) => item.dedupeKey))
      expect(world.companion.readConversation({ conversationId: conversation.id }).messages).toHaveLength(turnsBefore)

      const next = await send(world, conversation.id, '我的猫叫什么名字？')
      expect(memoryBlock(lastSystem(world.previews))).toContain('咪咪')
      const context = world.companion.readTurnContext({ turnId: next.evaluation!.requestId })
      expect(context!.retrieval.selected.map((item) => item.id)).toContain(memoryId)
      expect(context!.personality.version).toBe(2)

      // The same concern is not duplicated by the new process.
      const openAfter = world.companion.listPendingItems()
      expect(openAfter).toHaveLength(openBefore.length)
    } finally {
      world.database.close()
    }
  })
})

describe('G. unknown facts and conflict isolation', () => {
  it('rewrites an unsupported personal fact and records the gap without the value', async () => {
    const world = newWorld({ behaviours: [{ kind: 'claim', text: '你的车牌号是京A12345。' }] })
    try {
      const conversation = world.companion.createConversation()
      const result = await send(world, conversation.id, '我的车牌号是多少？')
      expect(result.assistantMessage.body).not.toContain('京A12345')

      const context = world.companion.readTurnContext({ turnId: result.evaluation!.requestId })!
      expect(context.guard!.verdict).toBe('rewrite')

      const gaps = world.companion.listPendingItems().filter((item) => item.source === 'evidence_gap')
      expect(gaps).toHaveLength(1)
      expect(gaps[0]!.dedupeKey).toBe('evidence_gap:vehicle_plate')
      // The missing value itself is never persisted.
      expect(JSON.stringify(gaps[0])).not.toContain('京A12345')
    } finally {
      world.database.close()
    }
  })

  it('discloses only the conflict that the question is about', async () => {
    const world = newWorld()
    try {
      world.memories.create('我住在杭州。', 'personal')
      world.memories.create('我住在大阪。', 'personal')
      world.memories.create('我对花生过敏。', 'personal')
      world.memories.create('我对花生并不过敏。', 'personal')
      const conversation = world.companion.createConversation()

      const result = await send(world, conversation.id, '我住在哪里？')
      const block = memoryBlock(lastSystem(world.previews))
      expect(block).toContain('杭州')
      expect(block).toContain('大阪')

      const context = world.companion.readTurnContext({ turnId: result.evaluation!.requestId })!
      expect(context.retrieval.conflicts.map((conflict) => conflict.predicate)).toEqual(['residence'])
      // The unrelated conflict never enters this turn.
      expect(JSON.stringify(context.retrieval.conflicts)).not.toContain('花生')
    } finally {
      world.database.close()
    }
  })
})

describe('H. crash recovery between the message commit and the turn record', () => {
  /** A context store that can be told to fail exactly once. */
  class FlakyContexts implements TurnContextPort {
    private inner: TurnContextPort | undefined
    failNextUpsert = false

    bind(inner: TurnContextPort): void {
      this.inner = inner
    }

    upsert(context: Parameters<TurnContextPort['upsert']>[0]): void {
      if (this.failNextUpsert) {
        this.failNextUpsert = false
        throw new Error('injected context write failure')
      }
      this.inner!.upsert(context)
    }

    get(turnId: string) {
      return this.inner!.get(turnId)
    }

    listByConversation(conversationId: string, limit: number) {
      return this.inner!.listByConversation(conversationId, limit)
    }
  }

  it('delivers the answer, then completes the turn from its persisted intent', async () => {
    const flaky = new FlakyContexts()
    const world = newWorld({}, { contexts: flaky })
    flaky.bind(new SqliteTurnContextRepository(world.database))
    try {
      const conversation = world.companion.createConversation()
      world.memories.create('我住在杭州。', 'personal')
      world.memories.create('我住在大阪。', 'personal')

      flaky.failNextUpsert = true
      const result = await send(world, conversation.id, '我住在哪里？')

      // The answer still reaches the user: derived data failing must not cost
      // the delivery.
      expect(result.assistantMessage.body.length).toBeGreaterThan(0)
      expect(world.companion.readConversation({ conversationId: conversation.id }).messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
      // The record is missing, and the intent that can rebuild it is on disk.
      expect(world.companion.readTurnContext({ turnId: result.evaluation!.requestId })).toBeNull()
      const finalizations = new SqliteTurnFinalizationRepository(world.database)
      expect(finalizations.get(result.evaluation!.requestId)).not.toBeNull()
      const itemsBefore = world.companion.listPendingItems()

      const recovered = world.companion.recoverInterruptedTurns()
      expect(recovered).toEqual({ completed: 1, interrupted: 0, dropped: 0 })

      const context = world.companion.readTurnContext({ turnId: result.evaluation!.requestId })
      expect(context).not.toBeNull()
      expect(context!.status).toBe('succeeded')
      expect(context!.assistantMessageId).toBe(result.assistantMessage.id)
      expect(context!.updates.pendingItemIds).toHaveLength(1)
      expect(finalizations.get(result.evaluation!.requestId)).toBeNull()
      // Recovery must not duplicate what the turn already recorded.
      expect(world.companion.listPendingItems().map((item) => item.id)).toEqual(itemsBefore.map((item) => item.id))

      // And it is idempotent.
      expect(world.companion.recoverInterruptedTurns()).toEqual({ completed: 0, interrupted: 0, dropped: 0 })
      expect(world.companion.listPendingItems()).toHaveLength(itemsBefore.length)
    } finally {
      world.database.close()
    }
  })

  it('records an interrupted turn as failed when no answer was committed', async () => {
    const world = newWorld()
    try {
      const conversation = world.companion.createConversation()
      const first = await send(world, conversation.id, '你好。')
      const template = world.companion.readTurnContext({ turnId: first.evaluation!.requestId })!
      const finalizations = new SqliteTurnFinalizationRepository(world.database)
      const abandonedTurnId = randomUUID()
      finalizations.put({
        turnId: abandonedTurnId,
        conversationId: conversation.id,
        userMessageId: first.userMessage.id,
        // This message was never committed.
        assistantMessageId: randomUUID(),
        feelingEventId: null,
        contextTemplate: { ...template, turnId: abandonedTurnId },
        pendingDrafts: [],
        createdAt: new Date().toISOString()
      })

      const recovered = world.companion.recoverInterruptedTurns()
      expect(recovered).toEqual({ completed: 0, interrupted: 1, dropped: 0 })

      const context = world.companion.readTurnContext({ turnId: abandonedTurnId })
      expect(context).not.toBeNull()
      expect(context!.status).toBe('failed')
      expect(context!.provider.errorKind).toBe('INTERRUPTED')
      expect(context!.assistantMessageId).toBeNull()
      expect(context!.updates.pendingItemIds).toEqual([])
      expect(finalizations.get(abandonedTurnId)).toBeNull()
    } finally {
      world.database.close()
    }
  })

  it('keeps the original turn record intact when an interrupted turn is settled', async () => {
    const world = newWorld()
    try {
      const conversation = world.companion.createConversation()
      const first = await send(world, conversation.id, '你好。')
      const original = world.companion.readTurnContext({ turnId: first.evaluation!.requestId })!
      const finalizations = new SqliteTurnFinalizationRepository(world.database)
      const abandonedTurnId = randomUUID()
      finalizations.put({
        turnId: abandonedTurnId,
        conversationId: conversation.id,
        userMessageId: first.userMessage.id,
        assistantMessageId: randomUUID(),
        feelingEventId: null,
        // A template that still carries the *original* turn id: recovery must
        // key by the intent, or it would overwrite the earlier record.
        contextTemplate: original,
        pendingDrafts: [],
        createdAt: new Date().toISOString()
      })

      world.companion.recoverInterruptedTurns()

      expect(world.companion.readTurnContext({ turnId: first.evaluation!.requestId })).toEqual(original)
      expect(world.companion.readTurnContext({ turnId: abandonedTurnId })?.status).toBe('failed')
    } finally {
      world.database.close()
    }
  })
})
