import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildCognitiveTurnContext,
  COGNITIVE_TURN_CONTEXT_SCHEMA_VERSION,
  isCognitiveTurnContext,
  normalizeTurnContext,
  snapshotState,
  type BuildTurnContextInput,
  type CognitiveTurnContext
} from './turn-context'
import { SqliteTurnContextRepository } from '../persistence/cognitive-context-repository'
import { SqliteDatabase } from '../persistence/database'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const turnId = '44444444-4444-4444-8444-444444444444'
const conversationId = '55555555-5555-4555-8555-555555555555'
const userMessageId = '66666666-6666-4666-8666-666666666666'
const assistantMessageId = '77777777-7777-4777-8777-777777777777'
const memoryId = '88888888-8888-4888-8888-888888888888'

function input(overrides: Partial<BuildTurnContextInput> = {}): BuildTurnContextInput {
  return {
    turnId,
    conversationId,
    userMessageId,
    assistantMessageId,
    recordedAt: '2026-01-01T00:00:00.000Z',
    status: 'succeeded',
    intent: { label: 'information_query', confidence: 80, confidenceLevel: 'high', strategy: 'retrieve_memory', reasons: ['question_marker'] },
    retrieval: {
      policyIntent: 'information_query',
      baseMax: 25,
      effectiveMax: 25,
      adjustment: null,
      selected: [{
        id: memoryId,
        status: 'active',
        sourceCategory: 'user_explicit_input',
        sensitivity: 'personal',
        revision: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        score: 0.5
      }],
      conflicts: [],
      omitted: 0,
      maximumSensitivity: 'personal'
    },
    personality: { version: 1, warmth: 55, directness: 65, humor: 20, disagreementStyle: 'balanced' },
    feeling: { before: null, after: null, eventType: null, applied: false },
    provider: { id: 'deepseek', model: 'deepseek-flash', outcome: 'succeeded', attempts: 1, errorKind: null },
    ...overrides
  }
}

describe('turn context shape', () => {
  it('builds a record that passes its own validator', () => {
    const context = buildCognitiveTurnContext(input())
    expect(isCognitiveTurnContext(context)).toBe(true)
    expect(context.turnId).toBe(turnId)
    expect(context.retrieval.selected[0]!.id).toBe(memoryId)
  })

  it('rejects an id that is not a uuid', () => {
    expect(() => buildCognitiveTurnContext(input({ conversationId: 'not-a-uuid' }))).toThrow(TypeError)
  })

  it('bounds the delivered memory list', () => {
    const many = Array.from({ length: 40 }, () => ({
      id: randomUUID(), status: 'active' as const, sourceCategory: 'user_explicit_input',
      sensitivity: 'personal' as const, revision: 1, updatedAt: '2026-01-01T00:00:00.000Z', score: 0.1
    }))
    const context = buildCognitiveTurnContext(input({ retrieval: { ...input().retrieval, selected: many } }))
    expect(context.retrieval.selected.length).toBe(25)
  })

  it('rejects a tampered record on the read path', () => {
    const context = buildCognitiveTurnContext(input())
    // A schema this build does not know is unreadable; a known legacy schema is
    // readable through `normalizeTurnContext` (see the compatibility block).
    expect(isCognitiveTurnContext({ ...context, schemaVersion: 3 })).toBe(false)
    expect(isCognitiveTurnContext({ ...context, status: 'unknown' })).toBe(false)
    expect(isCognitiveTurnContext({ ...context, retrieval: { ...context.retrieval, selected: [{ id: 'x' }] } })).toBe(false)
    expect(isCognitiveTurnContext({ ...context, provider: { ...context.provider, outcome: 'ok' } })).toBe(false)
  })

  it('carries no memory text and no reply text', () => {
    const context = buildCognitiveTurnContext(input())
    const serialized = JSON.stringify(context)
    // The record only ever holds the id, the category and the verdict.
    expect(serialized).toContain(memoryId)
    expect(serialized).not.toMatch(/我住在|车牌|过敏|咪咪/u)
  })

  it('snapshots only the bounded state numbers', () => {
    const snapshot = snapshotState({
      revision: 3,
      values: { valence: 0.123456, activation: 0, tension: -0 },
      attention: { explorationPriority: 0.5 },
      uncertainty: 'low'
    })
    expect(snapshot).toEqual({ revision: 3, valence: 0.1235, activation: 0, tension: 0, explorationPriority: 0.5, uncertainty: 'low' })
  })
})

describe('turn context store', () => {
  function openDatabase(): SqliteDatabase {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-turn-context-'))
    directories.push(directory)
    return SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  }

  it('round-trips a record', () => {
    const database = openDatabase()
    try {
      const repository = new SqliteTurnContextRepository(database)
      const context = buildCognitiveTurnContext(input())
      repository.upsert(context)
      expect(repository.get(turnId)).toEqual(context)
      expect(repository.listByConversation(conversationId, 10)).toHaveLength(1)
    } finally {
      database.close()
    }
  })

  it('replaces a failed record with a successful one for the same turn', () => {
    const database = openDatabase()
    try {
      const repository = new SqliteTurnContextRepository(database)
      const failed: CognitiveTurnContext = buildCognitiveTurnContext(input({
        status: 'failed',
        assistantMessageId: null,
        provider: { ...input().provider, outcome: 'failed', errorKind: 'PROVIDER_TIMEOUT' }
      }))
      repository.upsert(failed)
      const succeeded = buildCognitiveTurnContext(input())
      repository.upsert(succeeded)
      expect(repository.get(turnId)?.status).toBe('succeeded')
    } finally {
      database.close()
    }
  })

  it('never downgrades a successful record', () => {
    const database = openDatabase()
    try {
      const repository = new SqliteTurnContextRepository(database)
      repository.upsert(buildCognitiveTurnContext(input()))
      repository.upsert(buildCognitiveTurnContext(input({
        status: 'failed',
        assistantMessageId: null,
        provider: { ...input().provider, outcome: 'failed', errorKind: 'PROVIDER_NETWORK' }
      })))
      expect(repository.get(turnId)?.status).toBe('succeeded')
    } finally {
      database.close()
    }
  })

  it('treats an unreadable payload as absent rather than partially trusted', () => {
    const database = openDatabase()
    try {
      const repository = new SqliteTurnContextRepository(database)
      repository.upsert(buildCognitiveTurnContext(input()))
      database.connection.prepare('UPDATE cognitive_turn_contexts SET payload_json = ? WHERE turn_id = ?').run('{"schemaVersion":1}', turnId)
      expect(repository.get(turnId)).toBeNull()
    } finally {
      database.close()
    }
  })
})

describe('schema compatibility and stage 2 fields', () => {
  it('writes the current schema version and keeps stage 2 fields when supplied', () => {
    const context = buildCognitiveTurnContext(input({
      uncertainty: { level: 'medium', needsClarification: false },
      speechActs: ['correction', 'explicit_self_fact'],
      responsePlan: { strategy: 'answer', memoryWriteAllowed: false },
      activeInterestIds: [memoryId],
      selfModelEntryIds: [memoryId],
      algorithmVersions: { analyzer: 'cognitive-analyzer-v1', intent: 'intent-rules-v1' }
    }))
    expect(context.schemaVersion).toBe(COGNITIVE_TURN_CONTEXT_SCHEMA_VERSION)
    expect(context.speechActs).toEqual(['correction', 'explicit_self_fact'])
    expect(context.uncertainty).toEqual({ level: 'medium', needsClarification: false })
    expect(context.responsePlan).toEqual({ strategy: 'answer', memoryWriteAllowed: false })
    expect(context.algorithmVersions).toEqual({ analyzer: 'cognitive-analyzer-v1', intent: 'intent-rules-v1' })
    expect(isCognitiveTurnContext(JSON.parse(JSON.stringify(context)))).toBe(true)
  })

  it('omits stage 2 fields when the caller has no analysis instead of inventing values', () => {
    const context = buildCognitiveTurnContext(input())
    expect(context.uncertainty).toBeUndefined()
    expect(context.speechActs).toBeUndefined()
    expect(context.responsePlan).toBeUndefined()
  })

  it('reads a schema 1 record instead of treating it as absent', () => {
    const current = buildCognitiveTurnContext(input({
      uncertainty: { level: 'low', needsClarification: false },
      speechActs: ['negation']
    }))
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>
    legacy.schemaVersion = 1
    delete legacy.uncertainty
    delete legacy.speechActs
    delete legacy.responsePlan
    delete legacy.algorithmVersions
    delete legacy.activeInterestIds
    delete legacy.selfModelEntryIds

    expect(isCognitiveTurnContext(legacy)).toBe(true)
    const normalized = normalizeTurnContext(legacy)
    expect(normalized).not.toBeNull()
    expect(normalized!.schemaVersion).toBe(COGNITIVE_TURN_CONTEXT_SCHEMA_VERSION)
    // Upgraded, not invented: a field the legacy turn never wrote stays absent.
    expect(normalized!.speechActs).toBeUndefined()
    expect(normalized!.turnId).toBe(current.turnId)
  })

  it('rejects malformed stage 2 fields rather than trusting them', () => {
    const context = buildCognitiveTurnContext(input())
    expect(isCognitiveTurnContext({ ...context, speechActs: ['not_an_act'] })).toBe(false)
    expect(isCognitiveTurnContext({ ...context, uncertainty: { level: 1, needsClarification: false } })).toBe(false)
    expect(isCognitiveTurnContext({ ...context, responsePlan: { strategy: 'answer' } })).toBe(false)
    expect(isCognitiveTurnContext({ ...context, activeInterestIds: ['not-a-uuid'] })).toBe(false)
    expect(isCognitiveTurnContext({ ...context, algorithmVersions: { analyzer: 'x' } })).toBe(false)
  })

  it('drops unknown schema versions and unparsable payloads on read', () => {
    expect(normalizeTurnContext(null)).toBeNull()
    expect(normalizeTurnContext('nope')).toBeNull()
    const context = buildCognitiveTurnContext(input())
    expect(normalizeTurnContext({ ...context, schemaVersion: 99 })).toBeNull()
  })
})
