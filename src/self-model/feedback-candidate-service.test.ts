import { describe, expect, it } from 'vitest'
import { CompanionService, PersonalityService } from '../app/companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteDatabase } from '../persistence/database'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore } from '../security/secrets'
import { FeedbackCandidateService } from './feedback-candidate-service'

const conversationA = '11111111-1111-4111-8111-111111111111'
const conversationB = '33333333-3333-4111-8111-111111111111'
const clock = (): string => '2026-10-27T10:00:00.000Z'

function setup() {
  const database = SqliteDatabase.open(':memory:')
  const feedback = new FeedbackCandidateService(database, clock)
  const personality = new PersonalityService(database, clock)
  return { database, feedback, personality }
}

function record(feedback: FeedbackCandidateService, conversationId: string, claim = '你说话太长了，请简短一点。') {
  return feedback.record({
    kind: 'tone',
    source: 'user_explicit',
    conversationId,
    messageId: null,
    claim,
    confidence: 70,
    sensitivity: 'normal'
  })
}

describe('feedback candidates never change the personality on their own', () => {
  it('records a candidate without touching the personality version', () => {
    const { feedback, personality } = setup()
    const before = personality.get().version
    record(feedback, conversationA)
    expect(feedback.list()).toHaveLength(1)
    expect(personality.get().version).toBe(before)
  })

  it('does not drift on a single piece of praise', () => {
    const { feedback, personality } = setup()
    const before = personality.get().version
    feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationA, claim: '你今天回答得很好。', confidence: 60, sensitivity: 'normal' })
    expect(personality.get().version).toBe(before)
  })

  it('keeps an unapproved candidate from ever becoming applied', () => {
    const { feedback, personality } = setup()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()
    expect(candidate?.status).toBe('supported')
    expect(candidate?.appliedPersonalityVersion).toBeNull()
    expect(personality.get().version).toBe(1)
  })
})

describe('evidence is counted once per independent conversation', () => {
  it('does not double count the same sentence imported twice', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    const second = record(feedback, conversationA)
    expect(second.created).toBe(false)
    expect(feedback.list()).toHaveLength(1)
    expect(feedback.list()[0]?.distinctConversations).toBe(1)
  })

  it('does not treat repeats inside one conversation as independent evidence', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    record(feedback, conversationA)
    record(feedback, conversationA)
    expect(feedback.list()[0]?.status).toBe('pending')
    expect(feedback.list()[0]?.distinctConversations).toBe(1)
  })

  it('promotes to supported only after a second independent conversation', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    expect(feedback.list()[0]?.status).toBe('pending')
    record(feedback, conversationB)
    expect(feedback.list()[0]?.status).toBe('supported')
    expect(feedback.list()[0]?.distinctConversations).toBe(2)
  })

  it('lets an explicit behaviour request form a candidate', () => {
    const { feedback } = setup()
    const result = feedback.record({
      kind: 'interaction_preference',
      source: 'user_explicit',
      conversationId: conversationA,
      claim: '以后回答请先给结论，再解释。',
      confidence: 80,
      sensitivity: 'normal'
    })
    expect(result.created).toBe(true)
    expect(result.candidate.kind).toBe('interaction_preference')
  })
})

describe('authorisation and data governance', () => {
  it('refuses to apply sensitive feedback without explicit consent', () => {
    const { feedback, personality } = setup()
    feedback.record({ kind: 'boundary', source: 'user_explicit', conversationId: conversationA, claim: '不要提我的病情。', confidence: 90, sensitivity: 'sensitive' })
    const [candidate] = feedback.list()
    const before = personality.get().version
    expect(() => feedback.apply(candidate!.id, { includeSensitive: false, baseVersion: 1, apply: () => 2 })).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' })
    )
    expect(personality.get().version).toBe(before)
  })

  it('withdraws candidates when their source conversation is removed', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    const withdrawn = feedback.withdrawForConversation(conversationA, 'conversation_deleted')
    expect(withdrawn).toBe(1)
    expect(feedback.list()[0]?.status).toBe('withdrawn')
    expect(feedback.list()[0]?.evidenceExcerpt).toBe('[withdrawn]')
  })

  it('withdraws candidates through the real conversation delete path', () => {
    const database = SqliteDatabase.open(':memory:')
    const memories = new MemoryService(new SqliteMemoryRepository(database), clock)
    const conversations = new ConversationService(new SqliteConversationRepository(database))
    const feedback = new FeedbackCandidateService(database, clock)
    const companion = new CompanionService({
      database,
      memories,
      conversations,
      secrets: new MemorySecretStore(),
      authorize: async () => undefined,
      clock,
      feedback
    })
    const conversation = companion.createConversation()
    record(feedback, conversation.id)
    companion.deleteConversation({ conversationId: conversation.id })
    expect(feedback.list()[0]?.status).toBe('withdrawn')
    expect(feedback.list()[0]?.evidenceExcerpt).toBe('[withdrawn]')
  })

  it('cannot apply a rejected candidate', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    const [candidate] = feedback.list()
    feedback.reject(candidate!.id, 'not a stable preference')
    expect(() => feedback.apply(candidate!.id, { includeSensitive: true, baseVersion: 1, apply: () => 2 })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' })
    )
  })
})

describe('apply and rollback stay auditable', () => {
  it('records the applied personality version and supports rollback', () => {
    const { feedback, personality } = setup()
    const before = personality.get()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()

    const applied = feedback.apply(candidate!.id, {
      includeSensitive: true,
      baseVersion: personality.get().version,
      apply: () => personality.save({ ...before, warmth: Math.min(100, before.warmth + 5), systemRules: 'Be brief.' }).version
    })
    expect(applied.status).toBe('applied')
    expect(applied.appliedPersonalityVersion).toBe(personality.get().version)
    expect(applied.decisionReason).toContain('approved')

    const restored = personality.restore(1)
    expect(restored.warmth).toBe(before.warmth)
    expect(personality.get().version).toBeGreaterThan(applied.appliedPersonalityVersion!)
  })

  it('records a reason when a candidate is withdrawn', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    const [candidate] = feedback.list()
    const withdrawn = feedback.withdraw(candidate!.id, 'user changed their mind')
    expect(withdrawn.status).toBe('withdrawn')
    expect(withdrawn.decisionReason).toBe('user changed their mind')
  })
})

describe('candidate identity is not evidence identity', () => {
  it('keeps the same sentence separate for different kinds', () => {
    const { feedback } = setup()
    const tone = feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationA, claim: '请简短一点。', confidence: 70, sensitivity: 'normal' })
    const boundary = feedback.record({ kind: 'boundary', source: 'user_explicit', conversationId: conversationA, claim: '请简短一点。', confidence: 70, sensitivity: 'normal' })
    expect(tone.candidate.id).not.toBe(boundary.candidate.id)
    expect(feedback.list()).toHaveLength(2)
  })

  it('escalates sensitivity and never downgrades it', () => {
    const { feedback } = setup()
    feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationA, claim: '别用那种语气。', confidence: 60, sensitivity: 'normal' })
    const [first] = feedback.list()
    const raised = feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationA, claim: '别用那种语气。', confidence: 60, sensitivity: 'sensitive' })
    expect(raised.candidate.id).toBe(first!.id)
    expect(raised.candidate.sensitivity).toBe('sensitive')
    const lowered = feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationA, claim: '别用那种语气。', confidence: 60, sensitivity: 'normal' })
    expect(lowered.candidate.sensitivity).toBe('sensitive')
  })

  it('escalates the candidate source but keeps each evidence row attributed', () => {
    const { feedback } = setup()
    feedback.record({ kind: 'tone', source: 'model_inferred', conversationId: conversationA, claim: '可能希望更简短。', confidence: 50, sensitivity: 'normal' })
    const [first] = feedback.list()
    const raised = feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationB, claim: '可能希望更简短。', confidence: 80, sensitivity: 'normal' })
    expect(raised.candidate.source).toBe('user_explicit')
    expect(feedback.listEvidence(first!.id).map((item) => item.source).sort()).toEqual(['model_inferred', 'user_explicit'])
  })
})

describe('evidence lifecycle governs support', () => {
  it('recomputes support when one conversation is deleted', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    record(feedback, conversationB)
    expect(feedback.list()[0]?.status).toBe('supported')
    feedback.withdrawForConversation(conversationB, 'conversation_deleted')
    const candidate = feedback.list()[0]!
    expect(candidate.distinctConversations).toBe(1)
    expect(candidate.status).toBe('pending')
  })

  it('withdraws the candidate when its last evidence is withdrawn', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    feedback.withdrawForConversation(conversationA, 'conversation_deleted')
    expect(feedback.list()[0]?.status).toBe('withdrawn')
    expect(feedback.list()[0]?.evidenceExcerpt).toBe('[withdrawn]')
    expect(feedback.listEvidence(feedback.list()[0]!.id).every((item) => item.status === 'withdrawn')).toBe(true)
  })

  it('withdraws a single message without touching the other conversation', () => {
    const { feedback } = setup()
    const first = feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationA, messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', claim: '请简短一点。', confidence: 70, sensitivity: 'normal' })
    feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationB, claim: '请简短一点。', confidence: 70, sensitivity: 'normal' })
    expect(feedback.get(first.candidate.id)?.status).toBe('supported')
    feedback.withdrawEvidenceForMessage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'message_deleted')
    expect(feedback.get(first.candidate.id)?.status).toBe('pending')
    expect(feedback.get(first.candidate.id)?.distinctConversations).toBe(1)
  })
})

describe('application is at most once and recoverable', () => {
  it('refuses a second application of the same candidate', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()
    feedback.apply(candidate!.id, { includeSensitive: true, baseVersion: 1, apply: () => 2 })
    expect(() => feedback.apply(candidate!.id, { includeSensitive: true, baseVersion: 2, apply: () => 3 })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' })
    )
  })

  it('records a failed application and leaves the candidate supported', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()
    expect(() => feedback.apply(candidate!.id, {
      includeSensitive: true,
      baseVersion: 1,
      apply: () => { throw new Error('save failed') }
    })).toThrow('save failed')
    expect(feedback.get(candidate!.id)?.status).toBe('supported')
    expect(feedback.applicationFor(candidate!.id)?.status).toBe('failed')
  })

  it('blocks retry on an interrupted applying row and marks it for review', () => {
    const { feedback, database } = setup()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()
    database.connection.prepare(`
      INSERT INTO persona_feedback_applications(id, candidate_id, status, base_personality_version, applied_personality_version, created_at, updated_at)
      VALUES (?, ?, 'applying', 1, NULL, ?, ?)
    `).run('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', candidate!.id, clock(), clock())

    expect(() => feedback.apply(candidate!.id, { includeSensitive: true, baseVersion: 1, apply: () => 2 })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' })
    )
    expect(feedback.recoverInterruptedApplications()).toBe(1)
    expect(feedback.applicationFor(candidate!.id)?.status).toBe('needs_review')
  })
})
