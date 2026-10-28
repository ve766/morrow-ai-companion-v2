import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore } from '../security/secrets'
import { ApplicationError } from '../shared/errors'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'

const clock = (): string => '2026-10-28T00:00:00.000Z'
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function harness() {
  const database = SqliteDatabase.open(':memory:')
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock)
  const conversations = new ConversationService(new SqliteConversationRepository(database), clock)
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async (preview) => ({
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: clock(),
      expiresAt: new Date(Date.parse(clock()) + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }),
    clock,
    providerFactory: (config) => ({
      profile: { id: config.id, providerClass: config.providerClass, configured: true },
      generate: async () => ({ text: '知道了。', modelId: DEEPSEEK_MODEL })
    })
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test' })
  return { database, memories, companion }
}

async function turn(companion: CompanionService, conversationId: string, content: string) {
  const result = await companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: true }, () => undefined)
  await tick()
  return result
}

/** The refusal detail, or 'rejected' when the error carried no detail. */
function rejectionDetail(run: () => unknown): string | null {
  try {
    run()
  } catch (error) {
    if (error instanceof ApplicationError) return error.detail ?? 'rejected'
    throw error
  }
  return null
}

describe('P1-A correction target is re-validated at acceptance', () => {
  it('refuses an edited candidate whose content no longer matches the target attribute', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我现在住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我不再住大阪了，现在搬到京都了。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      expect(candidate.correctionTargetId).toBe(old.id)
      expect(candidate.correctionTargetRevision).toBe(1)

      // The user rewrites the candidate into a preference statement. It must
      // not be applied to the residence record.
      const detail = rejectionDetail(() => ctx.companion.reviewMemorySuggestion({
        id: candidate.id,
        decision: 'accept',
        content: '我喜欢独自研究。'
      }))
      expect(detail).toBe('correction_rejected:attribute_mismatch')

      const untouched = ctx.memories.get(old.id)!
      expect(untouched.currentText).toBe('我现在住在大阪。')
      expect(untouched.revision).toBe(1)
      // No fallback memory was created either.
      expect(ctx.memories.countActive()).toBe(1)
      // The candidate stays pending so the user can review it again.
      expect(ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!.status).toBe('pending')
    } finally {
      ctx.database.close()
    }
  })

  it('refuses a correction whose target was retracted while the user was reviewing', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我现在住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我不再住大阪了，现在搬到京都了。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!

      ctx.memories.retract(old.id)
      const detail = rejectionDetail(() => ctx.companion.reviewMemorySuggestion({
        id: candidate.id,
        decision: 'accept',
        content: '我住在京都。'
      }))
      expect(detail).toBe('correction_rejected:target_inactive')
      expect(ctx.memories.countActive()).toBe(0)
      expect(ctx.memories.get(old.id)!.status).toBe('retracted')
    } finally {
      ctx.database.close()
    }
  })

  it('refuses a correction whose target moved on to a newer revision', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我现在住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我不再住大阪了，现在搬到京都了。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!

      ctx.memories.correct(old.id, '我现在住在奈良。')
      const detail = rejectionDetail(() => ctx.companion.reviewMemorySuggestion({
        id: candidate.id,
        decision: 'accept',
        content: '我住在京都。'
      }))
      expect(detail).toBe('correction_rejected:target_changed')
      expect(ctx.memories.get(old.id)!.currentText).toBe('我现在住在奈良。')
      expect(ctx.memories.get(old.id)!.revision).toBe(2)
    } finally {
      ctx.database.close()
    }
  })

  it('applies a valid correction exactly once even when acceptance is submitted twice', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我现在住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我不再住大阪了，现在搬到京都了。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!

      ctx.companion.reviewMemorySuggestion({ id: candidate.id, decision: 'accept', content: '我住在京都。' })
      const second = rejectionDetail(() => ctx.companion.reviewMemorySuggestion({
        id: candidate.id,
        decision: 'accept',
        content: '我住在京都。'
      }))
      // A second acceptance is a conflict on the candidate state, not a second
      // revision on the memory.
      expect(second).toBe('rejected')
      const record = ctx.memories.get(old.id)!
      expect(record.currentText).toBe('我住在京都。')
      expect(record.revision).toBe(2)
      expect(ctx.memories.history(old.id)).toHaveLength(2)
      expect(ctx.memories.countActive()).toBe(1)
    } finally {
      ctx.database.close()
    }
  })
})

describe('P1-C reviewed sensitivity reaches the persisted record', () => {
  it('keeps a raised sensitivity on the correction path and on its revision', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我现在住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我不再住大阪了，现在搬到京都了。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!

      ctx.companion.reviewMemorySuggestion({
        id: candidate.id,
        decision: 'accept',
        content: '我住在京都。',
        sensitivity: 'sensitive'
      })

      const record = ctx.memories.get(old.id)!
      expect(record.sensitivity).toBe('sensitive')
      expect(record.currentText).toBe('我住在京都。')
      expect(ctx.memories.history(old.id).map((revision) => revision.sensitivity)).toEqual(['personal', 'sensitive'])
      // The sensitivity ceiling is applied at retrieval, not only on create.
      expect(ctx.memories.assembleContext('京都', 'personal').selected).toEqual([])
      expect(ctx.memories.assembleContext('京都', 'sensitive').selected).toHaveLength(1)
    } finally {
      ctx.database.close()
    }
  })

  it('refuses a client that lowers sensitivity below the server classification', async () => {
    const ctx = harness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我对花生严重过敏。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      expect(candidate.sensitivity).toBe('sensitive')

      const detail = rejectionDetail(() => ctx.companion.reviewMemorySuggestion({
        id: candidate.id,
        decision: 'accept',
        content: candidate.claim,
        sensitivity: 'normal'
      }))
      expect(detail).toBe('sensitivity_below_floor')
      expect(ctx.memories.countActive()).toBe(0)
    } finally {
      ctx.database.close()
    }
  })

  it('never lets a correction downgrade a sensitive target', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我对花生严重过敏。', 'sensitive')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我不再对花生过敏了，现在改成坚果过敏。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      // The statement is a correction candidate against the health record.
      expect(candidate.correctionTargetId).toBe(old.id)

      const detail = rejectionDetail(() => ctx.companion.reviewMemorySuggestion({
        id: candidate.id,
        decision: 'accept',
        content: '我现在对坚果过敏。',
        sensitivity: 'personal'
      }))
      expect(detail).toBe('sensitivity_below_floor')
      expect(ctx.memories.get(old.id)!.sensitivity).toBe('sensitive')
      expect(ctx.memories.get(old.id)!.revision).toBe(1)
    } finally {
      ctx.database.close()
    }
  })

  it('raises sensitivity when an edit adds health information and no choice was made', async () => {
    const ctx = harness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我一直住在杭州。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      expect(candidate.sensitivity).toBe('personal')

      // The user rewrites the claim into a health statement without touching the
      // selector. The server escalates instead of storing it as `personal`.
      ctx.companion.reviewMemorySuggestion({
        id: candidate.id,
        decision: 'accept',
        content: '我对花生严重过敏。'
      })
      expect(ctx.memories.list()[0]!.sensitivity).toBe('sensitive')
    } finally {
      ctx.database.close()
    }
  })
})
