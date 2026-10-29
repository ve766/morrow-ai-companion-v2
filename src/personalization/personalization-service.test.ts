import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { MemoryService } from '../memory/memory-service'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { ConversationService } from '../conversation/conversation-service'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { MemorySecretStore } from '../security/secrets'
import { InterestService, SqliteInterestRepository } from '../self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../self-model/self-model-service'
import { CompanionService } from '../app/companion-service'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import { boundedUpdate, PersonalizationService, PERSONALIZATION_ETA } from './personalization-service'
import type { ProviderInput, ProviderOutput, ProviderPort } from '../providers/provider-policy'

let directory = ''
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

function openDatabase(): SqliteDatabase {
  directory = mkdtempSync(join(tmpdir(), 'morrow-personalization-'))
  return SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
}

describe('bounded personalization update', () => {
  it('moves by eta * weight * signal and clamps to the bounds', () => {
    expect(boundedUpdate(0.5, 1, 1)).toBeCloseTo(0.5 + PERSONALIZATION_ETA, 4)
    expect(boundedUpdate(0.98, 1, 1)).toBe(1)
    expect(boundedUpdate(0.02, -1, 1)).toBe(0)
    // Weight is clamped, not trusted: an out-of-range weight cannot amplify.
    expect(boundedUpdate(0.5, 1, 5)).toBeCloseTo(0.5 + PERSONALIZATION_ETA, 4)
  })

  it('never lets one turn move a dimension by more than eta', () => {
    let value = 0.5
    value = boundedUpdate(value, 1, 1)
    expect(Math.abs(value - 0.5)).toBeLessThanOrEqual(PERSONALIZATION_ETA + 1e-9)
  })
})

describe('personalization persistence', () => {
  it('is idempotent per turn and exposes the evidence count', () => {
    const database = openDatabase()
    try {
      const service = new PersonalizationService(database)
      const turnId = randomUUID()
      const first = service.apply({ dimension: 'exploration', signal: 0.5, weight: 0.6, turnId, at: '2026-10-29T00:00:00.000Z' })
      const again = service.apply({ dimension: 'exploration', signal: 0.5, weight: 0.6, turnId, at: '2026-10-29T00:00:00.000Z' })
      expect(again.value).toBe(first.value)
      expect(again.evidenceCount).toBe(1)
      expect(first.value).toBeCloseTo(0.5 + PERSONALIZATION_ETA * 0.6 * 0.5, 4)
    } finally {
      database.close()
    }
  })

  it('recomputes the value when the turn that produced it is withdrawn', () => {
    const database = openDatabase()
    try {
      const service = new PersonalizationService(database)
      const turnId = randomUUID()
      service.apply({ dimension: 'pace', signal: -0.5, weight: 0.8, turnId, at: '2026-10-29T00:00:00.000Z' })
      expect(service.get('pace').value).toBeLessThan(0.5)

      service.forgetTurn(turnId)

      const after = service.get('pace')
      expect(after.evidenceCount).toBe(0)
      // Back to the neutral default, not "slightly less than 0.5".
      expect(after.value).toBe(0.5)
    } finally {
      database.close()
    }
  })

  it('rejects an unparsable turn id instead of writing an untraceable row', () => {
    const database = openDatabase()
    try {
      const service = new PersonalizationService(database)
      expect(() => service.apply({ dimension: 'depth', signal: 0.5, weight: 0.5, turnId: 'not-a-uuid', at: '2026-10-29T00:00:00.000Z' }))
        .toThrow(TypeError)
    } finally {
      database.close()
    }
  })
})

class ScriptedProvider implements ProviderPort {
  readonly profile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock' as const, configured: true }
  lastPayload = ''
  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.lastPayload = JSON.stringify(input.requestPayload)
    return { text: '好的。', modelId: 'scripted-offline', attempts: 1 }
  }
}

describe('personalization reaches the next request', () => {
  it('writes on one turn and is serialized into the next turn payload', async () => {
    const database = openDatabase()
    const provider = new ScriptedProvider()
    const eventLog = { tryRecord: () => undefined } as never
    const memories = new MemoryService(new SqliteMemoryRepository(database))
    const conversations = new ConversationService(new SqliteConversationRepository(database))
    const personalization = new PersonalizationService(database)
    const companion = new CompanionService({
      database,
      memories,
      conversations,
      secrets: new MemorySecretStore(),
      authorize: async (preview) => ({
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        includeSensitive: preview.maximumSensitivity === 'sensitive'
      }),
      providerFactory: () => provider,
      selfModelLoop: {
        events: eventLog,
        interests: new InterestService(new SqliteInterestRepository(database), eventLog),
        selfModel: new SelfModelService(new SqliteSelfModelRepository(database), eventLog),
        personalization
      }
    })
    try {
      companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-placeholder-key' })
      companion.saveCognitiveSettings({ enabled: true })
      const conversation = companion.createConversation()

      await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我想规划一下下个月的学习计划。', includeSensitive: false }, () => undefined)
      // The first payload cannot contain the block: nothing had been learned yet.
      expect(provider.lastPayload).not.toContain('Bounded interaction preference state')
      expect(personalization.get('exploration').evidenceCount).toBeGreaterThan(0)

      await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '继续。', includeSensitive: false }, () => undefined)
      expect(provider.lastPayload).toContain('Bounded interaction preference state')
      expect(provider.lastPayload).toContain('exploration=')
    } finally {
      database.close()
    }
  })
})
