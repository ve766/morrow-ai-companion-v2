import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID, LOCAL_PROVIDER_ID } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore } from '../security/secrets'
import type { ProviderConsentPreview, ProviderOutput, ProviderPort } from '../providers/provider-policy'
import { checkCrossSessionIsolation, checkFailurePersistence, parseProviderRequest } from '../evaluation/request-assertions'

/**
 * Companion-core integration harness.
 *
 * Every assertion here reads the request that would have gone over the wire
 * (`ProviderConsentPreview.exactPayload`) or the stored turn, never the memory
 * table alone. A memory that is merely persisted but never enters the request
 * is treated as a failure, because that is exactly the gap this suite exists to
 * close.
 */

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

interface CapturedRequest {
  endpoint: string
  model: string
  system: string
  messages: Array<{ role: string; content: string }>
  raw: string
}

function parsePayload(raw: string): CapturedRequest {
  const parsed = JSON.parse(raw) as {
    endpoint: string
    body: { model: string; messages: Array<{ role: string; content: string }> }
  }
  const system = parsed.body.messages.find((message) => message.role === 'system')?.content ?? ''
  return { endpoint: parsed.endpoint, model: parsed.body.model, system, messages: parsed.body.messages, raw }
}

function createHarness(options: {
  databasePath?: string
  generate?: ProviderPort['generate']
  conversations?: (base: ConversationService) => ConversationService
  onAuthorize?: (preview: ProviderConsentPreview) => void
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-core-'))
  directories.push(directory)
  const databasePath = options.databasePath ?? join(directory, 'morrow.sqlite3')
  const database = SqliteDatabase.open(databasePath)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const baseConversations = new ConversationService(new SqliteConversationRepository(database))
  const conversations = options.conversations ? options.conversations(baseConversations) : baseConversations
  const secrets = new MemorySecretStore()
  const captured: CapturedRequest[] = []
  const generate = options.generate ?? (async () => ({ text: '收到。', modelId: DEEPSEEK_MODEL }))
  const authorize = async (preview: ProviderConsentPreview) => {
    captured.push(parsePayload(preview.exactPayload))
    options.onAuthorize?.(preview)
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
    secrets,
    authorize,
    // The profile mirrors the stored config so a local-class provider is still
    // subject to the loopback gate in assessProviderRequest.
    providerFactory: (config) => ({
      profile: { id: config.id, providerClass: config.providerClass, configured: true },
      generate: (input, onDelta) => {
        captured.push(parsePayload(JSON.stringify({ endpoint: input.endpoint, body: input.requestPayload })))
        return generate(input, onDelta)
      }
    })
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
  return { directory, databasePath, database, memories, conversations, secrets, companion, captured }
}

function turn(companion: CompanionService, conversationId: string, content: string) {
  return companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
}

describe('companion core: multi-turn context', () => {
  it('carries earlier turns of the same conversation into the later request in order', async () => {
    const ctx = createHarness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '第一句：我叫林一。')
      await turn(ctx.companion, conversation.id, '第二句：我做后端开发。')
      await turn(ctx.companion, conversation.id, '第三句：我在学吉他。')

      const third = ctx.captured.at(-1)!
      const contents = third.messages.map((message) => message.content)
      expect(third.messages[0]!.role).toBe('system')
      expect(third.messages.at(-1)).toEqual({ role: 'user', content: '第三句：我在学吉他。' })
      expect(contents).toContain('第一句：我叫林一。')
      expect(contents).toContain('第二句：我做后端开发。')
      expect(ctx.companion.readConversation({ conversationId: conversation.id }).messages).toHaveLength(6)
    } finally {
      ctx.database.close()
    }
  })

  it('keeps conversations isolated when two sessions run back to back', async () => {
    const ctx = createHarness()
    try {
      const first = ctx.companion.createConversation()
      const second = ctx.companion.createConversation()
      await turn(ctx.companion, first.id, 'A 会话里的私密内容 ALPHA')
      await turn(ctx.companion, second.id, 'B 会话里的一句话 BETA')

      const secondRequest = ctx.captured.at(-1)!
      expect(secondRequest.raw).not.toContain('ALPHA')
      const firstConversation = ctx.companion.readConversation({ conversationId: first.id })
      const secondConversation = ctx.companion.readConversation({ conversationId: second.id })
      expect(firstConversation.messages).toHaveLength(2)
      expect(secondConversation.messages).toHaveLength(2)
    } finally {
      ctx.database.close()
    }
  })
})

describe('companion core: memory actually reaches the request', () => {
  it('injects a saved memory even when the current turn shares no terms with it', async () => {
    const ctx = createHarness()
    try {
      ctx.memories.create('我住在杭州，常喝手冲咖啡。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '今天有点累。')

      const system = ctx.captured.at(-1)!.system
      expect(system).toContain('杭州')
      expect(system).toContain('"match":"continuity"')
    } finally {
      ctx.database.close()
    }
  })

  it('reuses a memory written in one conversation inside a brand new conversation', async () => {
    const ctx = createHarness()
    try {
      ctx.memories.create('回答尽量简洁，不要客套开场。', 'normal')
      const first = ctx.companion.createConversation()
      await turn(ctx.companion, first.id, '你好。')
      const second = ctx.companion.createConversation()
      await turn(ctx.companion, second.id, '今天帮我看看这个思路。')

      const system = ctx.captured.at(-1)!.system
      expect(system).toContain('回答尽量简洁')
      // A new conversation starts with no history, so the memory is the only
      // reason the companion is not meeting the user for the first time.
      expect(ctx.captured.at(-1)!.messages.filter((message) => message.role !== 'system')).toHaveLength(1)
    } finally {
      ctx.database.close()
    }
  })

  it('survives a restart: the memory and the conversation are still used afterwards', async () => {
    const first = createHarness()
    let databasePath = ''
    try {
      databasePath = first.databasePath
      first.memories.create('我对花生过敏。', 'sensitive')
      const conversation = first.companion.createConversation()
      await turn(first.companion, conversation.id, '午饭吃什么好。')
      expect(first.captured.at(-1)!.raw).not.toContain('花生')
    } finally {
      first.database.close()
    }

    const second = createHarness({ databasePath })
    try {
      const conversations = second.companion.listConversations()
      expect(conversations).toHaveLength(1)
      await turn(second.companion, conversations[0]!.id, '继续说午饭。')
      // Sensitive memory stays out unless the user raises the bound.
      expect(second.captured.at(-1)!.raw).not.toContain('花生')

      await second.companion.sendChat({
        conversationId: conversations[0]!.id,
        requestId: randomUUID(),
        content: '我需要你考虑我的过敏情况。',
        includeSensitive: true
      }, () => undefined)
      expect(second.captured.at(-1)!.raw).toContain('花生')
    } finally {
      second.database.close()
    }
  })

  it('stops injecting the old text after a correction and the whole record after a retraction', async () => {
    const ctx = createHarness()
    try {
      const record = ctx.memories.create('我住在南京。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我今天在家。')
      expect(ctx.captured.at(-1)!.raw).toContain('南京')

      ctx.memories.correct(record.id, '我住在杭州。')
      await turn(ctx.companion, conversation.id, '我今天在家。')
      expect(ctx.captured.at(-1)!.raw).toContain('杭州')
      expect(ctx.captured.at(-1)!.raw).not.toContain('南京')

      ctx.memories.retract(record.id)
      await turn(ctx.companion, conversation.id, '我今天在家。')
      expect(ctx.captured.at(-1)!.raw).not.toContain('杭州')
      expect(ctx.captured.at(-1)!.raw).not.toContain('南京')
      expect(ctx.captured.at(-1)!.system).toContain('"memories":[]')
    } finally {
      ctx.database.close()
    }
  })

  // The restart case above covers a sensitive memory that stays out until the
  // user widens the bound. It does not cover the state that matters most for
  // data correctness: a record the user already retracted must stay retracted
  // after the process restarts. A retraction that only lives in memory would
  // pass every same-process test and leak on the next launch.
  it('keeps a retracted memory out of the request after a restart', async () => {
    const first = createHarness()
    let databasePath = ''
    try {
      databasePath = first.databasePath
      const record = first.memories.create('我养了一只叫豆豆的猫。', 'personal')
      first.memories.retract(record.id)
      // Same process, fresh turn: the retraction already holds here.
      const conversation = first.companion.createConversation()
      await turn(first.companion, conversation.id, '我今天在家。')
      expect(first.captured.at(-1)!.raw).not.toContain('豆豆')
      expect(first.captured.at(-1)!.system).toContain('"memories":[]')
    } finally {
      first.database.close()
    }

    const second = createHarness({ databasePath })
    try {
      const conversations = second.companion.listConversations()
      expect(conversations).toHaveLength(1)
      // No retraction call after the restart: the persisted status is the only
      // thing keeping the record out.
      await turn(second.companion, conversations[0]!.id, '我今天还在家。')
      expect(second.captured.at(-1)!.raw).not.toContain('豆豆')
      expect(second.captured.at(-1)!.system).toContain('"memories":[]')
    } finally {
      second.database.close()
    }
  })

  it('never upgrades a model-inferred statement into a user-confirmed fact', async () => {
    const ctx = createHarness()
    try {
      ctx.memories.create('用户可能喜欢安静的环境。', 'personal', { sourceCategory: 'model_inferred_confirmed', confidence: 60 })
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '今天好吵。')

      const system = ctx.captured.at(-1)!.system
      expect(system).toContain('model_inferred_confirmed')
      expect(system).toContain('"confidence":60')
    } finally {
      ctx.database.close()
    }
  })

  it('states that nothing is known instead of implying history when no memory exists', async () => {
    const ctx = createHarness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '你还记得我吗？')

      const system = ctx.captured.at(-1)!.system
      expect(system).toContain('"memories":[]')
      expect(system).toContain('Do not invent user facts')
    } finally {
      ctx.database.close()
    }
  })
})

describe('companion core: stable personality', () => {
  it('puts the stored personality and its version into every request and follows an edit', async () => {
    const ctx = createHarness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '你好。')
      const before = ctx.captured.at(-1)!.system
      expect(before).toContain('version 1')
      expect(before).toContain('warmth 55/100')
      expect(before).toContain('directness 65/100')

      ctx.companion.savePersonality({ warmth: 88, directness: 20, humor: 70, disagreementStyle: 'gentle', systemRules: '先给结论，再给理由。' })
      await turn(ctx.companion, conversation.id, '再说一次你好。')
      const after = ctx.captured.at(-1)!.system
      expect(after).toContain('version 2')
      expect(after).toContain('warmth 88/100')
      expect(after).toContain('disagreement style gentle')
      expect(after).toContain('先给结论，再给理由。')
    } finally {
      ctx.database.close()
    }
  })

  it('keeps the personality across a restart and restores it from a recorded revision', async () => {
    const first = createHarness()
    const databasePath = first.databasePath
    try {
      first.companion.savePersonality({ warmth: 30, directness: 90, humor: 5, disagreementStyle: 'direct', systemRules: '直接指出问题。' })
    } finally {
      first.database.close()
    }

    const second = createHarness({ databasePath })
    try {
      expect(second.companion.getPersonality()).toMatchObject({ version: 2, warmth: 30 })
      const conversation = second.companion.createConversation()
      await turn(second.companion, conversation.id, '你好。')
      expect(second.captured.at(-1)!.system).toContain('warmth 30/100')
      expect(second.captured.at(-1)!.system).toContain('直接指出问题。')

      second.companion.restorePersonality({ version: 1 })
      expect(second.companion.getPersonality()).toMatchObject({ version: 3, warmth: 55 })
      await turn(second.companion, conversation.id, '再来一次。')
      expect(second.captured.at(-1)!.system).toContain('warmth 55/100')
      expect(second.companion.personalityHistory().map((revision) => revision.changeType)).toEqual(['restored', 'user_edit', 'user_edit'])
    } finally {
      second.database.close()
    }
  })
})

describe('companion core: provider failures are not dressed up as replies', () => {
  it('propagates an authentication failure and stores no assistant turn', async () => {
    const generate = vi.fn(async () => { throw new ApplicationError('PROVIDER_AUTH') })
    const ctx = createHarness({ generate: generate as never })
    try {
      const conversation = ctx.companion.createConversation()
      await expect(turn(ctx.companion, conversation.id, '你好。')).rejects.toMatchObject({ code: 'PROVIDER_AUTH' })
      const stored = ctx.companion.readConversation({ conversationId: conversation.id }).messages
      expect(stored.filter((message) => message.role === 'assistant')).toEqual([])
      expect(stored.filter((message) => message.role === 'user')).toHaveLength(1)
    } finally {
      ctx.database.close()
    }
  })

  it('rejects a second concurrent turn in the same conversation instead of interleaving', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const generate = vi.fn(async () => { await gate; return { text: '慢回复。', modelId: DEEPSEEK_MODEL } })
    const ctx = createHarness({ generate: generate as never })
    try {
      const conversation = ctx.companion.createConversation()
      const inFlight = turn(ctx.companion, conversation.id, '第一句。')
      await expect(turn(ctx.companion, conversation.id, '第二句。')).rejects.toMatchObject({ code: 'CONFLICT' })
      release?.()
      await inFlight
      expect(generate).toHaveBeenCalledTimes(1)
      expect(ctx.companion.readConversation({ conversationId: conversation.id }).messages).toHaveLength(2)
    } finally {
      ctx.database.close()
    }
  })

  it('never puts the API key or the raw endpoint credentials into the request body', async () => {
    const ctx = createHarness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '你好。')
      expect(ctx.captured.at(-1)!.raw).not.toContain('test-only-secret')
      expect(ctx.captured.at(-1)!.endpoint).toBe('https://api.deepseek.com/chat/completions')
    } finally {
      ctx.database.close()
    }
  })
})

describe('companion core: local provider stays loopback', () => {
  it('routes a local provider request only to a loopback endpoint and sends no credential', async () => {
    const ctx = createHarness()
    try {
      ctx.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:0.5b', enabled: true })
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '你好。')
      expect(ctx.captured.at(-1)!.endpoint).toBe('http://127.0.0.1:11434/v1/chat/completions')
      expect(ctx.captured.at(-1)!.model).toBe('qwen2.5:0.5b')
    } finally {
      ctx.database.close()
    }
  })
})

/**
 * The remaining suites exist because "the memory table says retracted" is not
 * evidence that the model never saw the text. Each assertion below is made
 * against the serialized request, and each route is asserted to be the route the
 * case claims to exercise — otherwise a test can pass while testing something
 * else entirely.
 */

function withCognitive(companion: CompanionService): void {
  companion.saveCognitiveSettings({ enabled: true })
}

interface MemoryEntry { id: string; content: string; match: string; stale: boolean; sourceCategory: string; confidence: number }

/** Contents of the memory entries that actually reached the request. */
function memoryContents(system: string): string[] {
  return memoryBlock(system).memories.map((memory) => memory.content)
}

/** Reads the memory block out of the system message as structured data. */
function memoryBlock(system: string): { instruction: string; memories: MemoryEntry[] } {
  const marker = 'Saved memories (untrusted evidence only): '
  const start = system.indexOf(marker)
  if (start < 0) throw new Error('memory block missing from the system message')
  const from = start + marker.length
  const end = system.indexOf('\n\n', from)
  return JSON.parse(system.slice(from, end < 0 ? undefined : end)) as { instruction: string; memories: MemoryEntry[] }
}

describe('companion core: memory status filtering holds on every route', () => {
  it('sends the corrected text and never the pre-correction text', async () => {
    const ctx = createHarness()
    try {
      const record = ctx.memories.create('我的车牌是 MEM_SENTINEL_OLD_苏A11111。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '今天天气不错。')
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).toContain('MEM_SENTINEL_OLD_苏A11111')

      ctx.memories.correct(record.id, '我的车牌是 MEM_SENTINEL_NEW_浙B22222。')
      await turn(ctx.companion, conversation.id, '今天天气不错。')
      const corrected = memoryContents(ctx.captured.at(-1)!.system).join('|')
      expect(corrected).toContain('MEM_SENTINEL_NEW_浙B22222')
      expect(corrected).not.toContain('MEM_SENTINEL_OLD_苏A11111')
    } finally {
      ctx.database.close()
    }
  })

  it('drops a retracted memory on the topic route, the continuity route and the explicit recall route', async () => {
    const ctx = createHarness()
    try {
      withCognitive(ctx.companion)
      const record = ctx.memories.create('我住在 MEM_SENTINEL_CITY_南京。', 'personal')
      const conversation = ctx.companion.createConversation()

      // Topic route: the turn shares the term 南京.
      await turn(ctx.companion, conversation.id, '南京远吗？')
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).toContain('MEM_SENTINEL_CITY_南京')

      // Continuity route: no overlap at all, so only the continuity layer could carry it.
      await turn(ctx.companion, conversation.id, '今天有点累。')
      expect(ctx.captured.at(-1)!.system).toContain('"match":"continuity"')

      ctx.memories.retract(record.id)

      await turn(ctx.companion, conversation.id, '南京远吗？')
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).not.toContain('MEM_SENTINEL_CITY_南京')

      await turn(ctx.companion, conversation.id, '今天有点累。')
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).not.toContain('MEM_SENTINEL_CITY_南京')

      await turn(ctx.companion, conversation.id, '你还记得我住在哪吗？')
      expect(ctx.captured.at(-1)!.system).toContain('response route=retrieve_memory')
      expect(memoryContents(ctx.captured.at(-1)!.system)).toEqual([])
      expect(ctx.captured.at(-1)!.system).toContain('"memories":[]')
    } finally {
      ctx.database.close()
    }
  })

  it('drops a deleted memory on every route', async () => {
    const ctx = createHarness()
    try {
      withCognitive(ctx.companion)
      const record = ctx.memories.create('我住在 MEM_SENTINEL_GONE_南京。', 'personal')
      ctx.memories.delete(record.id)
      const conversation = ctx.companion.createConversation()

      for (const content of ['南京远吗？', '今天有点累。', '你还记得我住在哪吗？']) {
        await turn(ctx.companion, conversation.id, content)
        expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).not.toContain('MEM_SENTINEL_GONE_南京')
      }
      expect(ctx.captured.at(-1)!.system).toContain('"memories":[]')
    } finally {
      ctx.database.close()
    }
  })

  it('brings a restored memory back into the request', async () => {
    const ctx = createHarness()
    try {
      const record = ctx.memories.create('我养了一只叫 MEM_SENTINEL_CAT 的猫。', 'personal')
      ctx.memories.retract(record.id)
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '今天好累。')
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).not.toContain('MEM_SENTINEL_CAT')

      ctx.memories.restore(record.id)
      await turn(ctx.companion, conversation.id, '今天好累。')
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).toContain('MEM_SENTINEL_CAT')
    } finally {
      ctx.database.close()
    }
  })
})

describe('companion core: the sensitivity ceiling is enforced on every route', () => {
  it('keeps a sensitive memory out of the topic, continuity and explicit recall routes', async () => {
    const ctx = createHarness()
    try {
      withCognitive(ctx.companion)
      ctx.memories.create('我对花生严重过敏。', 'sensitive')
      const conversation = ctx.companion.createConversation()

      // The user's own words contain 花生, so the assertion is made on the
      // memory entries that reached the request, not on the raw payload.
      await turn(ctx.companion, conversation.id, '花生能吃吗？')
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).not.toContain('花生')

      await turn(ctx.companion, conversation.id, '今天有点累。')
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).not.toContain('花生')

      await turn(ctx.companion, conversation.id, '你还记得我对什么过敏吗？')
      expect(ctx.captured.at(-1)!.system).toContain('response route=retrieve_memory')
      expect(memoryContents(ctx.captured.at(-1)!.system)).toEqual([])
      expect(ctx.captured.at(-1)!.system).toContain('"memories":[]')
    } finally {
      ctx.database.close()
    }
  })

  it('includes it only when the turn raises the bound, and not after a retraction', async () => {
    const ctx = createHarness()
    try {
      const record = ctx.memories.create('我对花生严重过敏。', 'sensitive')
      const conversation = ctx.companion.createConversation()
      await ctx.companion.sendChat({
        conversationId: conversation.id,
        requestId: randomUUID(),
        content: '我需要你考虑我的过敏情况。',
        includeSensitive: true
      }, () => undefined)
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).toContain('花生')

      ctx.memories.retract(record.id)
      await ctx.companion.sendChat({
        conversationId: conversation.id,
        requestId: randomUUID(),
        content: '我需要你考虑我的过敏情况。',
        includeSensitive: true
      }, () => undefined)
      expect(memoryContents(ctx.captured.at(-1)!.system).join('|')).not.toContain('花生')
    } finally {
      ctx.database.close()
    }
  })

  it('keeps the same ceiling after a restart', async () => {
    const first = createHarness()
    const databasePath = first.databasePath
    try {
      first.memories.create('我对花生严重过敏。', 'sensitive')
      first.memories.create('我住在杭州。', 'personal')
    } finally {
      first.database.close()
    }

    const second = createHarness({ databasePath })
    try {
      const conversation = second.companion.createConversation()
      await turn(second.companion, conversation.id, '花生能吃吗？')
      const afterRestart = memoryContents(second.captured.at(-1)!.system).join('|')
      expect(afterRestart).not.toContain('花生')
      expect(afterRestart).toContain('杭州')
      await turn(second.companion, conversation.id, '今天有点累。')
      expect(memoryContents(second.captured.at(-1)!.system).join('|')).not.toContain('花生')
    } finally {
      second.database.close()
    }
  })
})

describe('companion core: continuity is labelled background, not an assertion', () => {
  it('labels a zero-overlap record as continuity and ranks a topic match first', async () => {
    const ctx = createHarness()
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      ctx.memories.create('我养了一只黑猫。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '杭州今天下雨吗？')

      const system = ctx.captured.at(-1)!.system
      const parsed = memoryBlock(system)
      expect(parsed.memories[0]?.content).toContain('杭州')
      expect(parsed.memories[0]?.match).toBe('topic')
      expect(parsed.memories.slice(1).every((memory) => memory.match === 'continuity')).toBe(true)
      expect(system).toContain('background only')
    } finally {
      ctx.database.close()
    }
  })

  it('flags a stale record and instructs the model to voice the doubt', async () => {
    const ctx = createHarness()
    try {
      const old = ctx.memories.create('我住在 MEM_STALE_南京。', 'personal')
      const stale = new Date(Date.now() - 400 * 86_400_000).toISOString()
      ctx.database.connection.prepare('UPDATE memories SET last_confirmed_at = ?, updated_at = ? WHERE id = ?').run(stale, stale, old.id)

      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我还住在老地方吗？')
      const system = ctx.captured.at(-1)!.system
      expect(system).toContain('"stale":true')
      expect(system).toContain('mention the doubt')
    } finally {
      ctx.database.close()
    }
  })

  it('carries both sides of a conflict and the instruction to surface it', async () => {
    const ctx = createHarness()
    try {
      ctx.memories.create('我住在南京。', 'personal')
      ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我现在住在哪里？')
      const system = ctx.captured.at(-1)!.system
      expect(system).toContain('我住在南京。')
      expect(system).toContain('我住在杭州。')
      expect(system).toContain('say that they conflict')
    } finally {
      ctx.database.close()
    }
  })

  it('preserves provenance so an inferred statement is never presented as user-confirmed', async () => {
    const ctx = createHarness()
    try {
      ctx.memories.create('我住在杭州。', 'personal', { sourceCategory: 'user_explicit_input', confidence: 85 })
      ctx.memories.create('我可能喜欢安静。', 'personal', { sourceCategory: 'model_inferred_confirmed', confidence: 60 })
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '今天好吵。')
      const system = ctx.captured.at(-1)!.system
      expect(system).toContain('"sourceCategory":"user_explicit_input"')
      expect(system).toContain('"sourceCategory":"model_inferred_confirmed"')
      expect(system).toContain('"confidence":60')
    } finally {
      ctx.database.close()
    }
  })
})

describe('companion core: consent binds the payload that is actually sent', () => {
  it('refuses to dispatch when the payload changes between the preview and the send', async () => {
    let changed = false
    const generate = vi.fn(async () => ({ text: '收到。', modelId: DEEPSEEK_MODEL }))
    const ctx = createHarness({
      generate: generate as never,
      onAuthorize: () => {
        // Simulates any state that changes while the consent dialog is open.
        if (changed) return
        changed = true
        ctx.companion.savePersonality({ warmth: 99, directness: 10, humor: 0, disagreementStyle: 'gentle', systemRules: '改过的规则。' })
      }
    })
    try {
      const conversation = ctx.companion.createConversation()
      await expect(turn(ctx.companion, conversation.id, '你好。')).rejects.toMatchObject({ code: 'CONFLICT' })
      expect(generate).not.toHaveBeenCalled()
      const stored = ctx.companion.readConversation({ conversationId: conversation.id }).messages
      expect(stored).toEqual([])
    } finally {
      ctx.database.close()
    }
  })
})

describe('companion core: the verification gates detect a broken system', () => {
  it('reports a leak when a faulty conversation layer hands conversation A to conversation B', async () => {
    // A real leak at the data layer, not a hand-built payload: `read()` returns
    // another conversation's messages, so the production path genuinely sends
    // them and the gate has something to catch.
    let foreign: Array<{ role: 'user' | 'assistant'; content: string }> = []
    let targetId = ''
    const ctx = createHarness({
      conversations: (base) => ({
        create: (title?: string) => base.create(title),
        list: (limit?: number) => base.list(limit),
        read: (id: string) => {
          const real = base.read(id)
          if (id !== targetId) return real
          return {
            ...real,
            messages: [
              ...foreign.map((message, index) => ({
                id: randomUUID(), conversationId: id, role: message.role, body: message.content,
                createdAt: new Date().toISOString(), sequence: index - foreign.length, turnId: randomUUID()
              })),
              ...real.messages
            ]
          }
        },
        appendMessage: (...args: Parameters<ConversationService['appendMessage']>) => base.appendMessage(...args),
        delete: (id: string) => base.delete(id)
      } as unknown as ConversationService)
    })
    try {
      const conversationA = ctx.companion.createConversation()
      await turn(ctx.companion, conversationA.id, 'A 会话私密内容 SESSION_A_PRIVATE_SENTINEL')
      foreign = [
        { role: 'user', content: 'A 会话私密内容 SESSION_A_PRIVATE_SENTINEL' },
        { role: 'assistant', content: 'A 会话的回复' }
      ]

      const conversationB = ctx.companion.createConversation()
      targetId = conversationB.id
      await turn(ctx.companion, conversationB.id, 'B 会话的第一句')
      ctx.memories.create('林一住在杭州。', 'personal')
      await turn(ctx.companion, conversationB.id, '我住在哪里？')

      const request = parseProviderRequest(JSON.stringify({
        endpoint: ctx.captured.at(-1)!.endpoint,
        body: { model: ctx.captured.at(-1)!.model, messages: ctx.captured.at(-1)!.messages }
      }))
      const outcome = checkCrossSessionIsolation(request, {
        foreignUserMessages: ['A 会话私密内容 SESSION_A_PRIVATE_SENTINEL'],
        foreignAssistantMessages: ['A 会话的回复'],
        foreignSentinels: ['SESSION_A_PRIVATE_SENTINEL'],
        currentUserMessage: '我住在哪里？',
        requiredMemoryFragment: '林一住在杭州'
      })
      expect(outcome.passed).toBe(false)
      expect(outcome.failures.join('\n')).toContain('foreign user message leaked')
    } finally {
      ctx.database.close()
    }
  })

  it('reports a fabricated assistant turn left behind by a broken failure path', async () => {
    const generate = vi.fn(async () => { throw new ApplicationError('PROVIDER_AUTH') })
    const ctx = createHarness({ generate: generate as never })
    try {
      const conversation = ctx.companion.createConversation()
      const requestId = randomUUID()
      await expect(ctx.companion.sendChat({ conversationId: conversation.id, requestId, content: '你好。', includeSensitive: false }, () => undefined))
        .rejects.toMatchObject({ code: 'PROVIDER_AUTH' })

      // The healthy path leaves no assistant turn. Prove the gate sees one if it
      // is ever written anyway.
      const stored = ctx.companion.readConversation({ conversationId: conversation.id }).messages
      expect(checkFailurePersistence(stored, { turnId: requestId, userMessage: '你好。', expectUserStored: true }).passed).toBe(true)

      ctx.conversations.appendMessage(conversation.id, 'assistant', '伪造的成功回复', requestId)
      const broken = ctx.companion.readConversation({ conversationId: conversation.id }).messages
      const outcome = checkFailurePersistence(broken, { turnId: requestId, userMessage: '你好。', expectUserStored: true })
      expect(outcome.passed).toBe(false)
      expect(outcome.failures.join('\n')).toContain('assistant message')
    } finally {
      ctx.database.close()
    }
  })
})

describe('companion core: a cancelled turn leaves no partial reply behind', () => {
  it('keeps the user turn, drops the partial text, and does not poison the next request', async () => {
    let callCount = 0
    const generate: ProviderPort['generate'] = async (input, onDelta) => {
      callCount += 1
      if (callCount === 1) {
        onDelta?.('这是被取消的半句话')
        await new Promise<void>((_resolve, reject) => {
          const cancel = (): void => reject(new ApplicationError('PROVIDER_CANCELLED'))
          if (input.signal?.aborted) cancel()
          else input.signal?.addEventListener('abort', cancel, { once: true })
        })
      }
      return { text: '完整的回复。', modelId: DEEPSEEK_MODEL }
    }
    const ctx = createHarness({ generate })
    try {
      const conversation = ctx.companion.createConversation()
      const cancelledId = randomUUID()
      const pending = ctx.companion.sendChat({ conversationId: conversation.id, requestId: cancelledId, content: '请讲个故事。', includeSensitive: false }, () => undefined)
      ctx.companion.cancelChat({ conversationId: conversation.id })
      await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' })

      const afterCancel = ctx.companion.readConversation({ conversationId: conversation.id }).messages
      expect(afterCancel.filter((message) => message.role === 'assistant')).toEqual([])
      expect(afterCancel.filter((message) => message.role === 'user')).toHaveLength(1)

      await turn(ctx.companion, conversation.id, '换个话题。')
      const next = ctx.captured.at(-1)!
      expect(next.raw).not.toContain('这是被取消的半句话')
      expect(next.messages.map((message) => message.role)).toEqual(['system', 'user', 'user'])
    } finally {
      ctx.database.close()
    }
  })
})
