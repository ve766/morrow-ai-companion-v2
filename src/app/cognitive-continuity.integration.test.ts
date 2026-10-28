import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EventLogService } from '../persistence/event-log'
import { MemorySecretStore } from '../security/secrets'
import { InterestService, SqliteInterestRepository } from '../self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../self-model/self-model-service'
import type { ProviderConsentPreview } from '../providers/provider-policy'

/**
 * Slice 1 acceptance: what actually reaches the provider.
 *
 * Every assertion here reads the exact serialized request that the service
 * hands to the provider, not an intermediate object. The point of the slice is
 * that a normal conversation keeps its continuity, so a memory that the user
 * explicitly saved must be able to appear in an ordinary turn - not only in an
 * explicit "do you remember" turn.
 */

const directories: string[] = []

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-cognitive-slice1-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const previews: string[] = []
  const authorize = vi.fn(async (preview: ProviderConsentPreview) => {
    previews.push(preview.exactPayload)
    const approvedAt = new Date()
    return {
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: approvedAt.toISOString(),
      expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }
  })
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize,
    selfModelLoop: { events, interests, selfModel },
    providerFactory: () => ({
      profile: { id: DEEPSEEK_PROVIDER_ID, providerClass: 'remote', configured: true },
      generate: async () => ({ text: '知道了。', modelId: DEEPSEEK_MODEL })
    })
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
  companion.saveCognitiveSettings({ enabled: true })
  return { database, memories, conversations, companion, previews, events, interests, selfModel }
}

interface CapturedPayload {
  body: { messages: Array<{ role: string; content: string }> }
}

function lastSystem(previews: string[]): string {
  const payload = JSON.parse(previews.at(-1)!) as CapturedPayload
  return payload.body.messages.find((message) => message.role === 'system')?.content ?? ''
}

/** The `Saved memories` block only, so assertions cannot pass on prompt text. */
function memoryBlock(system: string): string {
  const start = system.indexOf('Saved memories (untrusted evidence only):')
  if (start < 0) return ''
  return system.slice(start)
}

function send(companion: CompanionService, conversationId: string, content: string, requestId = randomUUID(), includeSensitive = false) {
  return companion.sendChat({ conversationId, requestId, content, includeSensitive }, () => undefined)
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('slice 1: an ordinary turn keeps continuity', () => {
  it('retrieves a saved fact when the current question shares its topic, without an explicit recall request', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我的猫叫什么名字？')

      expect(lastSystem(ctx.previews)).toContain('intent=information_query')
      expect(memoryBlock(lastSystem(ctx.previews))).toContain('咪咪')
    } finally {
      ctx.database.close()
    }
  })

  it('does not inject an unrelated private memory into a topic switch', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '帮我写一段排序算法。')
      expect(memoryBlock(lastSystem(ctx.previews))).not.toContain('咪咪')
    } finally {
      ctx.database.close()
    }
  })

  it('resolves a short follow-up against the message it actually refers to', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我下周要去杭州出差。')
      await send(ctx.companion, conversation.id, '那后天呢？')

      expect(lastSystem(ctx.previews)).toContain('response route=answer')
      expect(memoryBlock(lastSystem(ctx.previews))).toContain('杭州')
    } finally {
      ctx.database.close()
    }
  })

  it('reaches a saved fact from a brand-new conversation', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      const first = ctx.companion.createConversation()
      await send(ctx.companion, first.id, '今天天气不错。')

      const second = ctx.companion.createConversation()
      await send(ctx.companion, second.id, '我住的这个城市最近怎么样？')
      expect(memoryBlock(lastSystem(ctx.previews))).toContain('杭州')
      const payload = JSON.parse(ctx.previews.at(-1)!) as CapturedPayload
      expect(payload.body.messages.filter((message) => message.role !== 'system')).toHaveLength(1)
    } finally {
      ctx.database.close()
    }
  })

  it('retrieves the fact when the user rewords it instead of repeating the stored sentence', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我的猫最近掉毛有点多。')
      expect(memoryBlock(lastSystem(ctx.previews))).toContain('咪咪')
    } finally {
      ctx.database.close()
    }
  })
})

describe('slice 1: corrections, conflicts and boundaries', () => {
  it('lets the current turn carry a correction without silently rewriting the stored fact', async () => {
    const ctx = setup()
    try {
      const stored = ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我刚才说错了，我住在大阪。')

      const system = lastSystem(ctx.previews)
      expect(memoryBlock(system)).toContain('杭州')
      expect(system).toContain('Do not silently edit stored memory')
      expect(ctx.memories.list().find((memory) => memory.id === stored.id)?.currentText).toBe('我住在杭州。')
    } finally {
      ctx.database.close()
    }
  })

  it('delivers both sides of a contradiction and tells the model not to pick one silently', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      ctx.memories.create('我住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我住在哪里？')

      const block = memoryBlock(lastSystem(ctx.previews))
      expect(block).toContain('杭州')
      expect(block).toContain('大阪')
      expect(block).toContain('never silently pick one')
    } finally {
      ctx.database.close()
    }
  })

  it('never delivers a retracted fact through the ordinary retrieval path', async () => {
    const ctx = setup()
    try {
      const stored = ctx.memories.create('我养了一只叫咪咪的猫。', 'personal')
      ctx.memories.retract(stored.id)
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我的猫叫什么名字？')
      expect(memoryBlock(lastSystem(ctx.previews))).not.toContain('咪咪')
    } finally {
      ctx.database.close()
    }
  })

  it('keeps a sensitive fact out unless the turn raises the ceiling', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我对花生严重过敏。', 'sensitive')
      const conversation = ctx.companion.createConversation()
      // The question is lexically related, so only the ceiling can keep it out.
      await send(ctx.companion, conversation.id, '我对花生过敏，中午吃什么好？')
      expect(memoryBlock(lastSystem(ctx.previews))).not.toContain('花生')

      await send(ctx.companion, conversation.id, '我对花生过敏，中午吃什么好？', randomUUID(), true)
      expect(memoryBlock(lastSystem(ctx.previews))).toContain('花生')
    } finally {
      ctx.database.close()
    }
  })
})

describe('slice 1: cognitive hints stay hints', () => {
  it('does not turn quoted or third-person statements into user facts', async () => {
    const ctx = setup()
    try {
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我朋友说他喜欢喝茶，我只是在转述。')
      await send(ctx.companion, conversation.id, '他说我住在杭州。')

      expect(ctx.selfModel.list({ status: 'active' })).toEqual([])
      expect(ctx.memories.list()).toEqual([])
    } finally {
      ctx.database.close()
    }
  })

  it('carries personality, self-model context and local state into the same request', async () => {
    const ctx = setup()
    try {
      ctx.companion.savePersonality({ warmth: 70, directness: 40, humor: 10, disagreementStyle: 'gentle', systemRules: '回答尽量简短。' })
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我今天有点累。')

      const system = lastSystem(ctx.previews)
      expect(system).toContain('version 2')
      expect(system).toContain('warmth 70/100')
      expect(system).toContain('回答尽量简短。')
      expect(system).toContain('not Morrow')
    } finally {
      ctx.database.close()
    }
  })

  it('does not duplicate messages or accumulate the same turn twice on a retry', async () => {
    const ctx = setup()
    try {
      const conversation = ctx.companion.createConversation()
      const requestId = randomUUID()
      await send(ctx.companion, conversation.id, '我今天有点累。', requestId)
      const count = (): number => Number(ctx.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_observations').get()?.count ?? 0)
      const afterFirst = {
        messages: ctx.companion.readConversation({ conversationId: conversation.id }).messages.length,
        observations: count(),
        feelingEvents: ctx.companion.getFeelingState().eventCount
      }

      await send(ctx.companion, conversation.id, '我今天有点累。', requestId)
      expect(ctx.companion.readConversation({ conversationId: conversation.id }).messages.length).toBe(afterFirst.messages)
      expect(count()).toBe(afterFirst.observations)
      expect(ctx.companion.getFeelingState().eventCount).toBe(afterFirst.feelingEvents)
    } finally {
      ctx.database.close()
    }
  })

})

describe('slice 1: lexical overlap alone must not inject a private memory', () => {
  // Each pair below shares a grammatical frame ("我不喜欢…", "我最近在学…",
  // "明天…") but describes a different fact. Word overlap is not relevance.
  const negatives: ReadonlyArray<{ query: string; memory: string; why: string }> = [
    { query: '我不喜欢这个方案，换个思路。', memory: '我不喜欢吃香菜。', why: 'shared dislike frame, different object' },
    { query: '我最近在学吉他。', memory: '我最近在学做饭。', why: 'shared study frame, different topic' },
    { query: '明天要交报告。', memory: '我明天要去医院复查。', why: 'shared time word, different event' }
  ]

  for (const item of negatives) {
    it(`keeps "${item.memory}" out of "${item.query}" (${item.why})`, async () => {
      const ctx = setup()
      try {
        const stored = ctx.memories.create(item.memory, 'personal')
        const conversation = ctx.companion.createConversation()
        await send(ctx.companion, conversation.id, item.query)

        const block = memoryBlock(lastSystem(ctx.previews))
        expect(block).not.toContain(item.memory)
        // The unique record id must not leak either: content assertions alone
        // could pass if the block were reshaped later.
        expect(block).not.toContain(stored.id)
      } finally {
        ctx.database.close()
      }
    })
  }

  it('still retrieves the memory when the overlap is a real object, not just a frame', async () => {
    const ctx = setup()
    try {
      // Positive control for the two negatives above: same frame, same object.
      ctx.memories.create('我不喜欢吃香菜。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我不喜欢香菜的味道，点菜时要注意什么？')
      expect(memoryBlock(lastSystem(ctx.previews))).toContain('香菜')
    } finally {
      ctx.database.close()
    }
  })

  it('still resolves a short follow-up after the precision change', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我下周要去杭州出差。')
      await send(ctx.companion, conversation.id, '那后天呢？')
      expect(memoryBlock(lastSystem(ctx.previews))).toContain('杭州')
    } finally {
      ctx.database.close()
    }
  })

})

describe('slice 2: time facts, conflicts and no-evidence at the payload', () => {
  it('retrieves a dated fact when the question is about that event', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我明天要去医院复查。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我明天去医院要带什么？')
      expect(memoryBlock(lastSystem(ctx.previews))).toContain('医院复查')
    } finally {
      ctx.database.close()
    }
  })

  it('does not admit a record that shares only a time word', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我明天要去医院复查。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '明天要交报告。')
      expect(memoryBlock(lastSystem(ctx.previews))).not.toContain('医院复查')
    } finally {
      ctx.database.close()
    }
  })

  it('marks two values of the same fact as unresolved instead of choosing one', async () => {
    const ctx = setup()
    try {
      const hangzhou = ctx.memories.create('我住在杭州。', 'personal')
      const osaka = ctx.memories.create('我住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我住在哪里？')

      const block = memoryBlock(lastSystem(ctx.previews))
      expect(block).toContain('杭州')
      expect(block).toContain('大阪')
      expect(block).toContain('"status":"unresolved"')
      expect(block).toContain(hangzhou.id)
      expect(block).toContain(osaka.id)
      expect(block).toContain('never silently pick one')
    } finally {
      ctx.database.close()
    }
  })

  it('does not treat a rewording of the same value as a conflict', async () => {
    const ctx = setup()
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      ctx.memories.create('我现居杭州市。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我住在哪里？')
      expect(memoryBlock(lastSystem(ctx.previews))).not.toContain('unresolved')
    } finally {
      ctx.database.close()
    }
  })

  it('sends no memory block entry when there is no evidence at all', async () => {
    const ctx = setup()
    try {
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我的车牌号是多少？')
      expect(memoryBlock(lastSystem(ctx.previews))).not.toContain('"id"')
    } finally {
      ctx.database.close()
    }
  })
})
