import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID, LOCAL_PROVIDER_ID } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { CompanionService, isQuestionTurn } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore } from '../security/secrets'
import type { ProviderConsentPreview, ProviderInput, ProviderOutput, ProviderPort } from '../providers/provider-policy'

const directories: string[] = []

function setup(options: {
  generate?: ProviderPort['generate']
  authorize?: (preview: ProviderConsentPreview) => Promise<{ providerId: string; payloadSha256: string; approvedAt: string; expiresAt: string; includeSensitive: boolean } | undefined>
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-m5-'))
  directories.push(directory)
  const databasePath = join(directory, 'morrow.sqlite3')
  const database = SqliteDatabase.open(databasePath)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new MemorySecretStore()
  const generate = options.generate ?? vi.fn(async () => ({ text: 'A deterministic response.', modelId: DEEPSEEK_MODEL }))
  const provider: ProviderPort = {
    profile: { id: 'deepseek', providerClass: 'remote', configured: true },
    generate
  }
  const authorize = options.authorize ?? (async (preview) => {
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
    secrets,
    authorize,
    providerFactory: () => provider
  })
  const conversation = companion.createConversation()
  return { directory, databasePath, database, memories, conversations, secrets, provider, generate, authorize, companion, conversation }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('DeepSeek companion vertical slice', () => {
  it('keeps chat offline without a configured provider and sends nothing when consent is denied', async () => {
    const missing = setup()
    try {
      await expect(missing.companion.sendChat({
        conversationId: missing.conversation.id,
        requestId: randomUUID(),
        content: 'Hello',
        includeSensitive: false
      }, () => undefined)).rejects.toMatchObject({ code: 'PROVIDER_UNCONFIGURED' })
      expect(missing.generate).not.toHaveBeenCalled()
      expect(missing.conversations.read(missing.conversation.id).messages).toEqual([])
    } finally {
      missing.database.close()
    }

    const denied = setup({ authorize: async () => undefined })
    try {
      denied.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      await expect(denied.companion.sendChat({
        conversationId: denied.conversation.id,
        requestId: randomUUID(),
        content: 'Hello',
        includeSensitive: false
      }, () => undefined)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(denied.generate).not.toHaveBeenCalled()
      expect(denied.conversations.read(denied.conversation.id).messages).toEqual([])
    } finally {
      denied.database.close()
    }
  })

  it('sends only eligible reviewed context after exact consent, streams deltas, and persists both turns', async () => {
    const deltas: string[] = []
    const authorize = vi.fn(async (preview: ProviderConsentPreview) => {
      expect(preview.endpoint).toBe('https://api.deepseek.com/chat/completions')
      expect(preview.exactPayload).toContain('ordinary coffee preference')
      expect(preview.exactPayload).not.toContain('private allergy')
      const now = new Date()
      return {
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        includeSensitive: false
      }
    })
    const generate = vi.fn(async (_input, onDelta) => {
      onDelta?.('A grounded ')
      onDelta?.('reply.')
      return { text: 'A grounded reply.', modelId: 'deepseek-flash' }
    })
    const ctx = setup({ authorize, generate })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      ctx.memories.create('ordinary coffee preference', 'personal')
      ctx.memories.create('private allergy', 'sensitive')
      const request = { conversationId: ctx.conversation.id, requestId: randomUUID(), content: 'coffee', includeSensitive: false }
      const result = await ctx.companion.sendChat(request, (delta) => deltas.push(delta))

      expect(authorize).toHaveBeenCalledTimes(1)
      expect(generate).toHaveBeenCalledTimes(1)
      expect(deltas).toEqual(['A grounded ', 'reply.'])
      expect(result.includedMemoryCount).toBe(1)
      expect(result.userMessage).toMatchObject({ role: 'user', body: 'coffee', sequence: 1 })
      expect(result.assistantMessage).toMatchObject({ role: 'assistant', body: 'A grounded reply.', sequence: 2 })
      const messages = ctx.conversations.read(ctx.conversation.id).messages
      expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(JSON.stringify(ctx.database.connection.prepare('SELECT * FROM provider_profiles').all())).not.toContain('test-only-secret')
    } finally {
      ctx.database.close()
    }
  })

  it('retries an interrupted turn without duplicating its user message or completed answer', async () => {
    let attempts = 0
    const generate = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new ApplicationError('PROVIDER_TIMEOUT')
      return { text: 'Saved once.', modelId: 'deepseek-flash' }
    })
    const ctx = setup({ generate })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      const request = { conversationId: ctx.conversation.id, requestId: randomUUID(), content: 'Retry this turn.', includeSensitive: false }
      await expect(ctx.companion.sendChat(request, () => undefined)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
      expect(ctx.conversations.read(ctx.conversation.id).messages).toHaveLength(1)
      const first = await ctx.companion.sendChat(request, () => undefined)
      const replay = await ctx.companion.sendChat(request, () => undefined)
      const turn = ctx.conversations.read(ctx.conversation.id).messages.filter((message) => message.turnId === request.requestId)
      expect(turn.map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(first.assistantMessage.id).toBe(replay.assistantMessage.id)
      expect(generate).toHaveBeenCalledTimes(2)
    } finally {
      ctx.database.close()
    }
  })

  it('versions user-editable personality and restores history as a new revision', () => {
    const ctx = setup()
    try {
      const initial = ctx.companion.getPersonality()
      const edited = ctx.companion.savePersonality({ warmth: 72, directness: 80, humor: 12, disagreementStyle: 'direct', systemRules: 'State uncertainty plainly.' })
      expect(edited.version).toBe(initial.version + 1)
      const restored = ctx.companion.restorePersonality({ version: initial.version })
      expect(restored).toMatchObject({ version: edited.version + 1, warmth: initial.warmth, disagreementStyle: initial.disagreementStyle })
      expect(ctx.companion.personalityHistory().map((revision) => revision.changeType)).toEqual(['restored', 'user_edit', 'user_edit'])
    } finally {
      ctx.database.close()
    }
  })

  it('keeps generated memory suggestions pending until review and stores the user-approved edit with sensitivity', async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({ candidates: [{ claim: 'Prefers printed books for long-form reading.' }] }),
      modelId: 'deepseek-flash'
    }))
    const ctx = setup({ generate })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      const source = ctx.conversations.appendMessage(ctx.conversation.id, 'user', 'I prefer printed books for long-form reading.', randomUUID()).messages[0]!
      const request = { conversationId: ctx.conversation.id, sourceMessageId: source.id }
      const suggestions = await ctx.companion.proposeMemorySuggestions(request)
      expect(suggestions).toHaveLength(1)
      expect(suggestions[0]).toMatchObject({ status: 'pending', claim: 'Prefers printed books for long-form reading.', sensitivity: 'sensitive', acceptedMemoryId: null })
      expect(ctx.memories.list()).toEqual([])

      const pending = suggestions[0]!
      const reviewed = ctx.companion.reviewMemorySuggestion({ id: pending.id, decision: 'accept', content: 'I prefer large-print books.', sensitivity: 'sensitive' })
      expect(reviewed[0]).toMatchObject({ status: 'accepted', acceptedContent: 'I prefer large-print books.', sensitivity: 'sensitive' })
      expect(ctx.memories.list()).toMatchObject([{ id: pending.acceptedMemoryId ?? expect.any(String), currentText: 'I prefer large-print books.', sensitivity: 'sensitive' }])
      expect(ctx.memories.assembleContext('printed reading', 'personal').selected).toEqual([])
      expect(ctx.memories.assembleContext('large-print books', 'sensitive').selected).toHaveLength(1)

      const memoryId = reviewed[0]!.acceptedMemoryId!
      ctx.memories.delete(memoryId)
      expect(ctx.companion.listMemorySuggestions({ conversationId: ctx.conversation.id })).toEqual([])
    } finally {
      ctx.database.close()
    }
  })

  it('uses the current approved memory in later turns and removes corrected or deleted text from provider context', async () => {
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
    const ctx = setup({ authorize })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      ctx.companion.savePersonality({ warmth: 70, directness: 75, humor: 10, disagreementStyle: 'direct', systemRules: 'Prefer concise responses.' })
      const memory = ctx.memories.create('I prefer jasmine tea.', 'personal')
      const send = () => ctx.companion.sendChat({
        conversationId: ctx.conversation.id,
        requestId: randomUUID(),
        content: 'Which tea do I prefer?',
        includeSensitive: false
      }, () => undefined)

      await send()
      expect(previews).toHaveLength(1)
      const firstSystem = (JSON.parse(previews[0]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(firstSystem).toContain('I prefer jasmine tea.')
      expect(firstSystem).toContain('"status":"active"')
      expect(firstSystem).toContain('User-controlled communication preferences, version 2')
      expect(firstSystem).toContain('Prefer concise responses.')
      expect(firstSystem.indexOf('Additional style preferences')).toBeLessThan(firstSystem.indexOf('Privacy and safety boundaries override style preferences.'))

      ctx.memories.correct(memory.id, 'I prefer oolong tea.')
      await send()
      expect(previews).toHaveLength(2)
      const secondSystem = (JSON.parse(previews[1]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(secondSystem).toContain('I prefer oolong tea.')
      expect(secondSystem).not.toContain('I prefer jasmine tea.')

      ctx.memories.delete(memory.id)
      await send()
      expect(previews).toHaveLength(3)
      const thirdSystem = (JSON.parse(previews[2]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(thirdSystem).not.toContain('I prefer jasmine tea.')
      expect(thirdSystem).not.toContain('I prefer oolong tea.')
    } finally {
      ctx.database.close()
    }
  })

  it('keeps feeling computation opt-in and carries evidence-backed state into later approved replies', async () => {
    const previews: string[] = []
    const authorize = async (preview: ProviderConsentPreview) => {
      previews.push(preview.exactPayload)
      const now = new Date()
      return {
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        includeSensitive: preview.maximumSensitivity === 'sensitive'
      }
    }
    const ctx = setup({ authorize })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      expect(ctx.companion.getCognitiveSettings()).toMatchObject({ enabled: false, available: true })
      const send = (content: string) => ctx.companion.sendChat({
        conversationId: ctx.conversation.id,
        requestId: randomUUID(),
        content,
        includeSensitive: false
      }, () => undefined)

      await send('Thanks, that helped.')
      const disabledPayload = JSON.parse(previews[0]!) as { body: { messages: Array<{ role: string; content: string }> } }
      const disabledSystem = disabledPayload.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(disabledSystem).not.toContain('A local rule-based reading of this turn:')
      expect(disabledSystem).not.toContain('Bounded local interaction-state signal')
      expect(disabledSystem).not.toContain('not Morrow’s internal state')
      expect(ctx.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_observations').get()).toEqual({ count: 0 })
      expect(ctx.companion.getFeelingState().eventCount).toBe(0)

      ctx.companion.saveCognitiveSettings({ enabled: true })
      await send('I feel sad and overwhelmed today.')
      const ventSystem = (JSON.parse(previews[1]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(ventSystem).toContain('User emotions are not Morrow’s internal state.')
      expect(ventSystem).toContain('valence=0.00')
      expect(ctx.companion.getFeelingState().state.values).toEqual({ valence: 0, activation: 0, tension: 0 })

      await send('You misunderstood; I meant the 2025 plan.')
      const state = ctx.companion.getFeelingState()
      expect(state.eventCount).toBe(2)
      expect(state.state.values.tension).toBeGreaterThan(0.05)
      expect(state.recentEvents.map((event) => event.type)).toEqual(['user_context', 'system_correction'])
      const storedEvents = ctx.database.connection.prepare('SELECT event_json FROM cognitive_feeling_events ORDER BY processed_at').all()
      expect(JSON.stringify(storedEvents)).not.toContain('sad and overwhelmed')
      expect(JSON.stringify(storedEvents)).not.toContain('You misunderstood')

      await send('What should I check next?')
      const laterSystem = (JSON.parse(previews[3]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(laterSystem).toContain('A recent explicit interaction correction remains a weak, potentially stale signal.')
      expect(ctx.companion.getFeelingState().eventCount).toBe(2)
      expect(ctx.companion.getPersonality().version).toBe(1)
    } finally {
      ctx.database.close()
    }
  })

  it('sends the opt-in local state as part of the approved payload without copying user distress into system state', async () => {
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
    const ctx = setup({ authorize })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      expect(ctx.companion.getCognitiveSettings()).toMatchObject({ enabled: false, available: true })
      ctx.companion.saveCognitiveSettings({ enabled: true })
      const content = 'I feel sad and overwhelmed, but do not comfort me; list the objective steps.'
      await ctx.companion.sendChat({ conversationId: ctx.conversation.id, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
      const request = JSON.parse(previews[0]!) as { body: { messages: Array<{ role: string; content: string }> } }
      const system = request.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(system).toContain('not Morrow’s internal state')
      expect(system).toContain('A local affect cue is not a request for comfort.')
      expect(system).toContain('Follow explicit instructions, including objective help or no reassurance')
      expect(system).not.toContain('A local cue suggests the user may want to be heard.')
      const cognitiveStart = system.indexOf('A local rule-based reading of this turn:')
      const memoriesStart = system.indexOf('Saved memories (untrusted evidence only):')
      const cognitiveGuidance = cognitiveStart >= 0 && memoriesStart > cognitiveStart ? system.slice(cognitiveStart, memoriesStart) : ''
      expect(cognitiveGuidance.length).toBeGreaterThan(0)
      expect(cognitiveGuidance.length).toBeLessThanOrEqual(1200)
      expect(cognitiveGuidance).not.toContain(content)
      const view = ctx.companion.getFeelingState()
      expect(view).toMatchObject({ available: true, eventCount: 1, recentEvents: [{ type: 'user_context' }] })
      expect(view.state.values).toEqual({ valence: 0, activation: 0, tension: 0 })
      expect(ctx.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_observations').get()).toEqual({ count: 1 })
      const storedEvent = String(ctx.database.connection.prepare('SELECT event_json FROM cognitive_feeling_events').get()?.event_json ?? '')
      expect(storedEvent).not.toContain(content)
      expect(ctx.companion.getPersonality().version).toBe(1)
    } finally {
      ctx.database.close()
    }
  })

  it('carries recent correction pressure into a later request and stops writing when disabled', async () => {
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
    const ctx = setup({ authorize })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      ctx.companion.saveCognitiveSettings({ enabled: true })
      const send = (content: string) => ctx.companion.sendChat({
        conversationId: ctx.conversation.id,
        requestId: randomUUID(),
        content,
        includeSensitive: false
      }, () => undefined)
      await send('That was not helpful.')
      const learned = ctx.companion.getFeelingState()
      expect(learned.state.values.valence).toBeLessThan(0)
      expect(learned.state.values.tension).toBeGreaterThan(0)
      await send('What is 2 + 2?')
      const nextSystem = (JSON.parse(previews[1]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(nextSystem).toContain('recent explicit interaction correction remains a weak, potentially stale signal')

      ctx.companion.saveCognitiveSettings({ enabled: false })
      await send('What is 3 + 3?')
      const disabledSystem = (JSON.parse(previews[2]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(disabledSystem).not.toContain('A local rule-based reading of this turn:')
      expect(disabledSystem).not.toContain('Bounded local interaction-state signal')
      expect(disabledSystem).not.toContain('Separate cognitive attention/motivation signal')
      expect(ctx.companion.getFeelingState().eventCount).toBe(1)
      expect(ctx.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_observations').get()).toEqual({ count: 2 })
    } finally {
      ctx.database.close()
    }
  })

  it('uses recent exploration attention only for a later explicit exploration request', async () => {
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
    const ctx = setup({ authorize })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      ctx.companion.saveCognitiveSettings({ enabled: true })
      const send = (conversationId: string, content: string) => ctx.companion.sendChat({
        conversationId,
        requestId: randomUUID(),
        content,
        includeSensitive: false
      }, () => undefined)

      await send(ctx.conversation.id, 'Let’s brainstorm three possible titles.')
      const firstSystem = (JSON.parse(previews[0]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(firstSystem).toContain('The user explicitly invited exploration.')
      expect(firstSystem).not.toContain('A recent, separate exploration request is a weak continuity signal.')
      expect(ctx.companion.getFeelingState().state.attention.explorationPriority).toBeGreaterThanOrEqual(0.04)

      const nextConversation = ctx.companion.createConversation()
      await send(nextConversation.id, 'Let’s explore two related names.')
      const secondSystem = (JSON.parse(previews[1]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(secondSystem).toContain('A recent, separate exploration request is a weak continuity signal.')
      expect(secondSystem).toContain('at most one optional, closely related angle')
      const secondState = ctx.companion.getFeelingState().state
      expect(secondState.values.valence).toBe(0)
      expect(secondState.values.activation).toBeGreaterThan(0)
      expect(secondState.values.tension).toBe(0)

      await send(nextConversation.id, 'What is 2 + 2?')
      const directSystem = (JSON.parse(previews[2]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(directSystem).not.toContain('A recent, separate exploration request is a weak continuity signal.')
      expect(ctx.companion.getFeelingState().eventCount).toBe(2)
    } finally {
      ctx.database.close()
    }
  })

  it('uses prior exploration attention only for a later explicit exploration request', async () => {
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
    const ctx = setup({ authorize })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      ctx.companion.saveCognitiveSettings({ enabled: true })
      const send = (content: string, conversationId = ctx.conversation.id) => ctx.companion.sendChat({
        conversationId,
        requestId: randomUUID(),
        content,
        includeSensitive: false
      }, () => undefined)

      await send('Let’s brainstorm three possible titles.')
      const firstSystem = (JSON.parse(previews[0]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(firstSystem).toContain('Offer one relevant angle')
      expect(firstSystem).not.toContain('A recent, separate exploration request is a weak continuity signal.')

      const followUpConversation = ctx.companion.createConversation()
      await send('Let’s explore two related names.', followUpConversation.id)
      const secondSystem = (JSON.parse(previews[1]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(secondSystem).toContain('A recent, separate exploration request is a weak continuity signal.')
      expect(secondSystem).toContain('at most one optional, closely related angle')
      const secondState = ctx.companion.getFeelingState().state
      expect(secondState.values.valence).toBe(0)
      expect(secondState.values.activation).toBeGreaterThan(0)
      expect(secondState.values.tension).toBe(0)
      expect(secondState.attention.explorationPriority).toBeGreaterThan(0.04)

      await send('What is 2 + 2?', followUpConversation.id)
      const factualSystem = (JSON.parse(previews[2]!) as { body: { messages: Array<{ role: string; content: string }> } }).body.messages[0]!.content
      expect(factualSystem).not.toContain('A recent, separate exploration request is a weak continuity signal.')
      expect(ctx.companion.getFeelingState().eventCount).toBe(2)
    } finally {
      ctx.database.close()
    }
  })

  it('cancels a partial provider stream without persisting a fabricated assistant message', async () => {
    let signalStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const generate = vi.fn(async (input: ProviderInput, onDelta?: (delta: string) => void): Promise<ProviderOutput> => {
      onDelta?.('partial text')
      signalStarted()
      return new Promise<ProviderOutput>((_resolve, reject) => {
        const cancel = () => reject(new ApplicationError('PROVIDER_CANCELLED'))
        if (input.signal?.aborted) cancel()
        else input.signal?.addEventListener('abort', cancel, { once: true })
      })
    })
    const ctx = setup({ generate })
    try {
      ctx.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
      const deltas: string[] = []
      const request = { conversationId: ctx.conversation.id, requestId: randomUUID(), content: 'Cancel this response.', includeSensitive: false }
      const pending = ctx.companion.sendChat(request, (delta) => deltas.push(delta))
      await started
      expect(ctx.companion.cancelChat({ conversationId: ctx.conversation.id })).toBe(true)
      await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' })
      expect(ctx.companion.cancelChat({ conversationId: ctx.conversation.id })).toBe(false)
      expect(deltas).toEqual(['partial text'])
      expect(ctx.conversations.read(ctx.conversation.id).messages).toMatchObject([{ role: 'user', body: 'Cancel this response.' }])
      expect(ctx.conversations.read(ctx.conversation.id).messages.some((message) => message.role === 'assistant')).toBe(false)
    } finally {
      ctx.database.close()
    }
  })
})

describe('question detection', () => {
  it('recognises a trailing question mark and an interrogative opener', () => {
    expect(isQuestionTurn('抑郁症一般怎么治疗？')).toBe(true)
    expect(isQuestionTurn('什么咖啡豆比较好')).toBe(true)
    expect(isQuestionTurn('怎么选咖啡豆')).toBe(true)
    expect(isQuestionTurn('我最近抑郁得厉害。')).toBe(false)
    expect(isQuestionTurn('我住在杭州。')).toBe(false)
  })
})
