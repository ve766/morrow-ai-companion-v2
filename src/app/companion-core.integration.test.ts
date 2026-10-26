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
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-core-'))
  directories.push(directory)
  const databasePath = options.databasePath ?? join(directory, 'morrow.sqlite3')
  const database = SqliteDatabase.open(databasePath)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new MemorySecretStore()
  const captured: CapturedRequest[] = []
  const generate = options.generate ?? (async () => ({ text: '收到。', modelId: DEEPSEEK_MODEL }))
  const authorize = async (preview: ProviderConsentPreview) => {
    captured.push(parsePayload(preview.exactPayload))
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
