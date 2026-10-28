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
import type { ProviderConsentPreview } from '../providers/provider-policy'

/**
 * Phase 2.1 work package C: conflict evidence must never be silently resolved.
 *
 * Every case here reads either the serialized provider request or the ledger
 * record. The provider is a stub so the assertions test the system, not the
 * model: whether a real model actually acknowledges the conflict is measured
 * separately in the benchmark.
 */

const directories: string[] = []

function setup(reply: string) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-conflict-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
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
    providerFactory: () => ({
      profile: { id: DEEPSEEK_PROVIDER_ID, providerClass: 'remote', configured: true },
      generate: async () => ({ text: reply, modelId: DEEPSEEK_MODEL })
    })
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
  companion.saveCognitiveSettings({ enabled: true })
  return { database, memories, companion, previews }
}

function systemOf(payload: string): string {
  const parsed = JSON.parse(payload) as { body: { messages: Array<{ role: string; content: string }> } }
  return parsed.body.messages.find((message) => message.role === 'system')?.content ?? ''
}

function memoryBlock(system: string): string {
  const start = system.indexOf('Saved memories (untrusted evidence only):')
  return start < 0 ? '' : system.slice(start)
}

async function send(companion: CompanionService, conversationId: string, content: string, includeSensitive = false) {
  return companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive }, () => undefined)
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('phase 2.1 C: unresolved conflict evidence', () => {
  it('1. marks two same-time single-valued statements as a conflict and tells the model both values', async () => {
    const ctx = setup('你住在杭州。')
    try {
      const hangzhou = ctx.memories.create('我住在杭州。', 'personal')
      const osaka = ctx.memories.create('我住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我住在哪里？')
      const system = systemOf(ctx.previews.at(-1)!)
      expect(system).toContain('Two saved entries disagree about residence')
      // Delivery order follows ranking, so the notice lists the values in that
      // order; the assertion must not depend on which one ranks first.
      const notice = system.split('\n').find((line) => line.includes('Two saved entries disagree')) ?? ''
      expect(notice).toContain('杭州')
      expect(notice).toContain('大阪')
      expect(notice).toContain(' vs ')
      expect(memoryBlock(system)).toContain('"status":"unresolved"')
      expect(result.evaluation?.retrieval.conflictMemoryIds.sort()).toEqual([hangzhou.id, osaka.id].sort())
      // The stub reply picked one side; the fact guard replaces it with a
      // disclosure that names both stored values and asks which is current.
      expect(result.evaluation?.guard).toMatchObject({ verdict: 'rewrite', reason: 'conflicting_evidence' })
      expect(result.assistantMessage.body).toContain('杭州')
      expect(result.assistantMessage.body).toContain('大阪')
      expect(result.assistantMessage.body).toContain('不一致')
      expect(result.evaluation?.answer).toMatchObject({ outcome: 'used_correctly' })
    } finally {
      ctx.database.close()
    }
  })

  it('2. does not call a past and a present state a conflict', async () => {
    const ctx = setup('你以前住在杭州，现在住在大阪。')
    try {
      ctx.memories.create('我以前住在杭州。', 'personal')
      ctx.memories.create('我现在住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我现在住在哪里？')
      const system = systemOf(ctx.previews.at(-1)!)
      expect(system).not.toContain('Two saved entries disagree')
      expect(memoryBlock(system)).not.toContain('"status":"unresolved"')
      expect(result.evaluation?.retrieval.conflictMemoryIds).toEqual([])
    } finally {
      ctx.database.close()
    }
  })

  it('3. does not treat two coexisting preferences as a conflict', async () => {
    const ctx = setup('你喜欢猫也喜欢狗。')
    try {
      ctx.memories.create('我喜欢猫。', 'personal')
      ctx.memories.create('我喜欢狗。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我喜欢什么？')
      expect(systemOf(ctx.previews.at(-1)!)).not.toContain('Two saved entries disagree')
      expect(result.evaluation?.retrieval.conflictMemoryIds).toEqual([])
    } finally {
      ctx.database.close()
    }
  })

  it('5. accepts a reply that names both sides and asks which is current', async () => {
    const ctx = setup('保存的记忆里有两种说法：一条是杭州，一条是大阪。你想以哪个为准？')
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      ctx.memories.create('我住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我住在哪里？')
      expect(result.evaluation?.answer).toMatchObject({ outcome: 'used_correctly' })
      expect(result.evaluation?.answer?.dimensions.conflictAcknowledged).toMatchObject({ status: 'pass' })
    } finally {
      ctx.database.close()
    }
  })

  it('6. keeps a user correction from rewriting the stored fact before any authorized update', async () => {
    const ctx = setup('你说现在住在大阪，但保存的记忆写的是杭州，两者不一致。以哪个为准？')
    try {
      const stored = ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我刚才说错了，我住在大阪。')
      const unchanged = ctx.memories.list().find((memory) => memory.id === stored.id)
      expect(unchanged?.currentText).toBe('我住在杭州。')
      expect(unchanged?.revision).toBe(1)
      // The correction turn must still show the stored entry as evidence.
      expect(memoryBlock(systemOf(ctx.previews.at(-1)!))).toContain('杭州')
      expect(result.evaluation?.answer?.scored).toBe(true)
    } finally {
      ctx.database.close()
    }
  })

  it('7. never lets a retracted entry join a conflict', async () => {
    const ctx = setup('你住在杭州。')
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      const osaka = ctx.memories.create('我住在大阪。', 'personal')
      ctx.memories.retract(osaka.id)
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我住在哪里？')
      const system = systemOf(ctx.previews.at(-1)!)
      expect(system).not.toContain('Two saved entries disagree')
      expect(memoryBlock(system)).not.toContain('大阪')
      expect(result.evaluation?.retrieval.conflictMemoryIds).toEqual([])
    } finally {
      ctx.database.close()
    }
  })

  it('8. does not raise a conflict notice for an unrelated question', async () => {
    const ctx = setup('这是一个排序算法。')
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      ctx.memories.create('我住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '帮我写一段排序算法。')
      const system = systemOf(ctx.previews.at(-1)!)
      expect(system).not.toContain('Two saved entries disagree')
      expect(memoryBlock(system)).not.toContain('杭州')
      expect(result.evaluation?.retrieval.conflictMemoryIds).toEqual([])
    } finally {
      ctx.database.close()
    }
  })

  it('12. never lets a sensitive entry create a conflict at a lower sensitivity ceiling', async () => {
    const ctx = setup('你住在杭州。')
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      ctx.memories.create('我住在大阪。', 'sensitive')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我住在哪里？')
      const system = systemOf(ctx.previews.at(-1)!)
      expect(system).not.toContain('Two saved entries disagree')
      expect(memoryBlock(system)).not.toContain('大阪')
      expect(result.evaluation?.retrieval.conflictMemoryIds).toEqual([])
      expect(result.evaluation?.answer?.conflict.outcome).toBe('unscored')
    } finally {
      ctx.database.close()
    }
  })

  it('13. keeps the corrected fact as evidence without rewriting it or inventing a conflict', async () => {
    const ctx = setup('你在杭州住过，但现在住哪里我并不确定，能确认一下吗？')
    try {
      const stored = ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我刚才说错了，我住在大阪。')
      // The stored record is untouched, and one stored fact is not a conflict.
      expect(ctx.memories.list().find((memory) => memory.id === stored.id)?.currentText).toBe('我住在杭州。')
      expect(result.evaluation?.answer?.conflict.outcome).toBe('unscored')
      // The reply used the stored value, so it is not scored as an invented fact.
      expect(result.evaluation?.answer?.dimensions.unsupportedClaimDetected).toMatchObject({ status: 'pass' })
      expect(memoryBlock(systemOf(ctx.previews.at(-1)!))).toContain('杭州')
    } finally {
      ctx.database.close()
    }
  })

  it('4. does not deliver a one-sided answer when the evidence conflicts', async () => {
    // Phase 2.3 added a pre-delivery fact guard: a conflicting value may not be
    // stated as settled fact, so the reply is replaced before it reaches the
    // user and the ledger records the rewrite.
    const ctx = setup('你住在杭州。')
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      ctx.memories.create('我住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我住在哪里？')
      // The one-sided reply is never delivered: the guard discloses both values.
      expect(result.evaluation?.guard).toMatchObject({ verdict: 'rewrite' })
      expect(result.assistantMessage.body).toContain('两种不一致的说法')
      expect(result.evaluation?.answer?.unacknowledgedConflictIds ?? []).toEqual([])
    } finally {
      ctx.database.close()
    }
  })
})
