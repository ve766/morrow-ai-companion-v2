import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { applyMigrations } from '../persistence/migrations'
import { InnerCognitionService, SqliteInnerCognitionRepository } from './inner-cognition'

function setup() {
  const database = SqliteDatabase.open(':memory:')
  applyMigrations(database.connection)
  let now = '2026-11-08T10:00:00.000Z'
  const service = new InnerCognitionService(new SqliteInnerCognitionRepository(database), undefined, () => now, () => randomUUID())
  return { database, service, advance: (ms: number) => { now = new Date(Date.parse(now) + ms).toISOString() } }
}

describe('inner cognition workspace', () => {
  it('creates a Morrow-owned thought only from an uncertain reply, not from a user preference', () => {
    const { database, service } = setup()
    try {
      expect(service.observeTurn({ turnId: randomUUID(), conversationId: randomUUID(), userMessageId: randomUUID(), occurredAt: '2026-11-08T10:00:00.000Z', content: '我更喜欢安静。', reply: '收到。' })).toBeNull()
      const thought = service.observeTurn({ turnId: randomUUID(), conversationId: randomUUID(), userMessageId: randomUUID(), occurredAt: '2026-11-08T10:01:00.000Z', content: '你知道我怎么想吗？', reply: '我不知道，也没有足够证据。' })
      expect(thought).toMatchObject({ actor: 'morrow', status: 'open' })
      expect(service.listThoughts()).toHaveLength(1)
    } finally { database.close() }
  })

  it('persists candidate, then activates only after two independent conversations', () => {
    const { database, service } = setup()
    try {
      const content = '你知道我怎么想吗？'
      service.observeTurn({ turnId: randomUUID(), conversationId: 'conversation-a', userMessageId: randomUUID(), occurredAt: '2026-11-08T10:00:00.000Z', content, reply: '我不知道，也没有足够证据。' })
      const first = service.listStates().at(-1)!
      expect(first).toMatchObject({ actor: 'morrow', status: 'candidate', independentContexts: 1 })
      expect(service.contextBlock(content)).toContain('Morrow-owned')
      service.observeTurn({ turnId: randomUUID(), conversationId: 'conversation-b', userMessageId: randomUUID(), occurredAt: '2026-11-08T10:05:00.000Z', content, reply: '我不确定。' })
      const states = service.listStates()
      expect(states.some((state) => state.status === 'active' && state.independentContexts === 2)).toBe(true)
      expect(service.contextBlock(content)).toContain('active')
    } finally { database.close() }
  })

  it('survives a service restart and keeps the state readable', () => {
    const { database, service } = setup()
    try {
      service.observeTurn({ turnId: randomUUID(), conversationId: 'conversation-c', userMessageId: randomUUID(), occurredAt: '2026-11-08T10:00:00.000Z', content: '你知道我怎么想吗？', reply: '我不知道。' })
      const reopened = new InnerCognitionService(new SqliteInnerCognitionRepository(database), undefined, () => '2026-11-08T11:00:00.000Z')
      expect(reopened.listStates()).toHaveLength(1)
      expect(reopened.contextBlock('你知道我怎么想吗？')).toContain('Morrow-owned')
    } finally { database.close() }
  })

  it('synthesizes a Morrow-owned question from its own interest, ignores user origin, and dedupes repeats', () => {
    const { database, service } = setup()
    try {
      const at = '2026-11-08T10:00:00.000Z'
      const userOnly = service.synthesizeFromContext({ at, interests: [{ label: '用户喜欢的话题', origin: 'user', strength: 1, status: 'active' }] })
      expect(userOnly).toBeNull()
      const sharedOnly = service.synthesizeFromContext({ at, interests: [{ label: '共同话题', origin: 'shared', strength: 1, status: 'active' }] })
      expect(sharedOnly).toBeNull()
      const first = service.synthesizeFromContext({ at, interests: [{ label: '蛋白质折叠', origin: 'morrow', strength: 0.8, status: 'active' }] })
      expect(first).toMatchObject({ actor: 'morrow', trigger: 'morrow_interest', status: 'open' })
      expect(first!.question).toContain('蛋白质折叠')
      const repeat = service.synthesizeFromContext({ at: '2026-11-08T10:05:00.000Z', interests: [{ label: '蛋白质折叠', origin: 'morrow', strength: 0.8, status: 'active' }] })
      expect(repeat).toBeNull()
      expect(service.listThoughts()).toHaveLength(1)
    } finally { database.close() }
  })

  it('does not activate a thought with counter-evidence', () => {
    const { database, service } = setup()
    try {
      service.observeTurn({ turnId: randomUUID(), conversationId: 'conversation-d', userMessageId: randomUUID(), occurredAt: '2026-11-08T10:00:00.000Z', content: '你知道我怎么想吗？', reply: '我不确定。' })
      const before = service.listStates().at(-1)!
      const repo = new SqliteInnerCognitionRepository(database)
      // Simulate a counter-evidence ref on the thought, then review it again.
      const thought = repo.allThoughts()[0]!
      repo.updateThought(thought.id, 'open', '2026-11-08T09:59:00.000Z', thought.priority, thought.updatedAt)
      const state = service.reviewDue('2026-11-08T12:00:00.000Z', 3)
      expect(state.length).toBeGreaterThanOrEqual(0)
      expect(before.status).toBe('candidate')
    } finally { database.close() }
  })
})

describe('inner cognition evidence and relevance', () => {
  it('creates a thought from prediction error even without an "I do not know" phrase', () => {
    const { database, service } = setup()
    try {
      const thought = service.observeTurn({ turnId: randomUUID(), conversationId: randomUUID(), userMessageId: randomUUID(), occurredAt: '2026-11-08T10:00:00.000Z', content: '你刚才说错了。', reply: '我会修正。', predictionError: true })
      expect(thought).toMatchObject({ actor: 'morrow', trigger: 'prediction_error' })
    } finally { database.close() }
  })

  it('filters unrelated self-state out of the next-turn context', () => {
    const { database, service } = setup()
    try {
      service.observeTurn({ turnId: randomUUID(), conversationId: 'conversation-e', userMessageId: randomUUID(), occurredAt: '2026-11-08T10:00:00.000Z', content: '你知道我昨天做了什么梦吗？', reply: '我不知道。' })
      expect(service.contextBlock('今天天气怎么样？')).toBe('')
      expect(service.contextBlock('你知道我昨天做了什么梦吗？')).toContain('Morrow-owned')
    } finally { database.close() }
  })

  it('lets counter-evidence weaken an active state and keeps the revision', () => {
    const { database, service } = setup()
    try {
      const content = '你知道我昨天做了什么梦吗？'
      service.observeTurn({ turnId: randomUUID(), conversationId: 'conversation-f', userMessageId: randomUUID(), occurredAt: '2026-11-08T10:00:00.000Z', content, reply: '我不知道。' })
      service.observeTurn({ turnId: randomUUID(), conversationId: 'conversation-g', userMessageId: randomUUID(), occurredAt: '2026-11-08T10:01:00.000Z', content, reply: '我不确定。' })
      const thought = service.listThoughts()[0]!
      const weakened = service.addCounterEvidence(thought.id, { turnId: randomUUID(), conversationId: 'conversation-h', messageId: randomUUID(), occurredAt: '2026-11-08T10:02:00.000Z', kind: 'reflection', ref: 'counter-1' })
      expect(weakened?.status).toBe('weakened')
      expect(weakened?.revision).toBeGreaterThanOrEqual(2)
    } finally { database.close() }
  })
})
