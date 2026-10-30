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
import { personalizationFit } from './personalization-service'

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

describe('P1 fixes: normalization, atomicity, deletion consistency', () => {
  it('stores the normalized signal and weight so the CHECK constraints agree with the arithmetic', () => {
    const database = openDatabase()
    try {
      const service = new PersonalizationService(database)
      const turnId = randomUUID()
      const entry = service.apply({ dimension: 'exploration', signal: 5, weight: 5, turnId, at: '2026-10-29T00:00:00.000Z' })
      const stored = database.connection.prepare(
        'SELECT signal, weight FROM personalization_signals WHERE dimension = ? AND turn_id = ?'
      ).get('exploration', turnId) as { signal: number; weight: number }
      expect(stored).toEqual({ signal: 1, weight: 1 })
      expect(entry.value).toBeCloseTo(0.5 + PERSONALIZATION_ETA, 4)
    } finally {
      database.close()
    }
  })

  it('rejects a non-finite signal or an invalid timestamp instead of writing a row', () => {
    const database = openDatabase()
    try {
      const service = new PersonalizationService(database)
      const turnId = randomUUID()
      expect(() => service.apply({ dimension: 'depth', signal: Number.NaN, weight: 0.5, turnId, at: '2026-10-29T00:00:00.000Z' })).toThrow(TypeError)
      expect(() => service.apply({ dimension: 'depth', signal: 0.5, weight: Number.POSITIVE_INFINITY, turnId, at: '2026-10-29T00:00:00.000Z' })).toThrow(TypeError)
      expect(() => service.apply({ dimension: 'depth', signal: 0.5, weight: 0.5, turnId, at: 'not-a-date' })).toThrow(TypeError)
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM personalization_signals').get()).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('recomputes from evidence when the source message is deleted, so no stale value survives', () => {
    const database = openDatabase()
    try {
      const service = new PersonalizationService(database)
      const turnId = randomUUID()
      const conversationId = randomUUID()
      database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(conversationId, 'p1a', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z')
      database.connection.prepare(
        'INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), conversationId, 'user', '我想规划一下。', '2026-10-29T00:00:00.000Z', 1, turnId)

      service.apply({ dimension: 'exploration', signal: 0.5, weight: 0.6, turnId, at: '2026-10-29T00:00:00.000Z' })
      expect(service.get('exploration').value).toBeGreaterThan(0.5)

      // The trigger removes the signals; the cached row is not touched by SQL.
      database.connection.prepare('DELETE FROM messages WHERE turn_id = ?').run(turnId)
      const after = service.get('exploration')
      expect(after.evidenceCount).toBe(0)
      expect(after.value).toBe(0.5)
      // The cached row is repaired too, not just hidden from the reader.
      const cached = database.connection.prepare('SELECT value, evidence_count, last_turn_id FROM personalization_state WHERE dimension = ?').get('exploration') as { value: number; evidence_count: number; last_turn_id: string | null }
      expect(cached).toEqual({ value: 0.5, evidence_count: 0, last_turn_id: null })
    } finally {
      database.close()
    }
  })

  it('converges after a crash that left a signal without a state row', () => {
    const database = openDatabase()
    try {
      const service = new PersonalizationService(database)
      const turnId = randomUUID()
      // Simulate the interrupted write: evidence on disk, state never updated.
      database.connection.prepare(
        'INSERT INTO personalization_signals(dimension, turn_id, signal, weight, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('pace', turnId, -0.5, 0.8, '2026-10-29T00:00:00.000Z')

      const recovered = service.apply({ dimension: 'pace', signal: -0.5, weight: 0.8, turnId, at: '2026-10-29T00:00:00.000Z' })

      expect(recovered.evidenceCount).toBe(1)
      expect(recovered.value).toBeCloseTo(0.5 - PERSONALIZATION_ETA * 0.8 * 0.5, 4)
      const cached = database.connection.prepare('SELECT value, evidence_count FROM personalization_state WHERE dimension = ?').get('pace') as { value: number; evidence_count: number }
      expect(cached.evidence_count).toBe(1)
      expect(cached.value).toBeCloseTo(recovered.value, 4)
    } finally {
      database.close()
    }
  })

  it('keeps the cached row identical to a fold over evidence', () => {
    const database = openDatabase()
    try {
      const service = new PersonalizationService(database)
      for (let index = 0; index < 3; index += 1) {
        service.apply({ dimension: 'depth', signal: 0.5, weight: 0.6, turnId: randomUUID(), at: `2026-10-29T00:00:0${index}.000Z` })
      }
      const before = service.get('depth')
      const rebuilt = service.recomputeAll().find((entry) => entry.dimension === 'depth')!
      expect(rebuilt.value).toBe(before.value)
      expect(rebuilt.evidenceCount).toBe(before.evidenceCount)
    } finally {
      database.close()
    }
  })
})

describe('B3 preference fit', () => {
  const entry = (dimension: 'depth' | 'pace' | 'exploration', value: number, evidenceCount: number) => ({
    dimension, value, evidenceCount, updatedAt: '2026-10-29T00:00:00.000Z', sourceEventId: null, revision: 1
  }) as never

  it('scores a memory about a personalised dimension and nothing else', () => {
    expect(personalizationFit('回答要简短一点。', [entry('depth', 0.2, 3)])).toBeCloseTo(0.6, 5)
    // No dimension term in the memory.
    expect(personalizationFit('我住在杭州。', [entry('depth', 0.2, 3)])).toBe(0)
    // A dimension with no evidence is not a preference, whatever its value.
    expect(personalizationFit('回答要简短一点。', [entry('depth', 0.2, 0)])).toBe(0)
    // Neutral 0.5 carries no direction, so it cannot boost anything.
    expect(personalizationFit('回答要简短一点。', [entry('depth', 0.5, 4)])).toBe(0)
  })

  it('takes the strongest matching dimension', () => {
    const text = '回答要简短一点，一步一步来。'
    expect(personalizationFit(text, [entry('depth', 0.4, 2), entry('pace', 0.9, 2)])).toBeCloseTo(0.8, 5)
  })
})
