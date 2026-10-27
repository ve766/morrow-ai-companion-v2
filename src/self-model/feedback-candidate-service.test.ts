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
    expect(() => feedback.apply(candidate!.id, { includeSensitive: false, baseVersion: 1, currentVersion: 1, apply: () => 2 })).toThrowError(
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
    feedback.record({
      kind: 'tone',
      source: 'user_explicit',
      conversationId: conversation.id,
      messageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      claim: '请简短一点。',
      confidence: 70,
      sensitivity: 'normal'
    })
    companion.deleteConversation({ conversationId: conversation.id })

    // Query the database directly: an API result alone is not evidence that the
    // rows actually changed.
    const evidence = database.connection.prepare(
      'SELECT status, withdrawn_at FROM persona_feedback_evidence WHERE conversation_id = ?'
    ).all(conversation.id) as Array<{ status: string; withdrawn_at: string | null }>
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.status).toBe('withdrawn')
    expect(evidence[0]?.withdrawn_at).not.toBeNull()

    const candidate = database.connection.prepare(
      'SELECT status, evidence_excerpt FROM persona_feedback_candidates'
    ).get() as { status: string; evidence_excerpt: string }
    expect(candidate.status).toBe('withdrawn')
    expect(candidate.evidence_excerpt).toBe('[withdrawn]')

    // A repeated withdrawal is a no-op, not a second mutation.
    expect(feedback.withdrawForConversation(conversation.id, 'conversation_deleted')).toBe(0)
  })

  it('cannot apply a rejected candidate', () => {
    const { feedback } = setup()
    record(feedback, conversationA)
    const [candidate] = feedback.list()
    feedback.reject(candidate!.id, 'not a stable preference')
    expect(() => feedback.apply(candidate!.id, { includeSensitive: true, baseVersion: 1, currentVersion: 1, apply: () => 2 })).toThrowError(
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
      baseVersion: personality.get().version, currentVersion: personality.get().version,
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
    feedback.apply(candidate!.id, { includeSensitive: true, baseVersion: 1, currentVersion: 1, apply: () => 2 })
    expect(() => feedback.apply(candidate!.id, { includeSensitive: true, baseVersion: 2, currentVersion: 2, apply: () => 3 })).toThrowError(
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
      currentVersion: 1,
      apply: () => { throw new Error('save failed') }
    })).toThrow('save failed')
    expect(feedback.get(candidate!.id)?.status).toBe('supported')
    expect(feedback.applicationFor(candidate!.id)?.status).toBe('failed')
  })

  it('refuses to write on top of a stale personality version', () => {
    const { feedback, personality } = setup()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()
    const before = personality.get().version
    expect(() => feedback.apply(candidate!.id, {
      includeSensitive: true,
      baseVersion: before,
      currentVersion: before + 1,
      apply: () => before + 2
    })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
    expect(feedback.get(candidate!.id)?.status).toBe('supported')
    expect(feedback.applicationFor(candidate!.id)).toBeNull()
    expect(personality.get().version).toBe(before)
  })

  it('keeps the application record after a rollback', () => {
    const { feedback, personality } = setup()
    const before = personality.get()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()
    const applied = feedback.apply(candidate!.id, {
      includeSensitive: true,
      baseVersion: personality.get().version,
      currentVersion: personality.get().version,
      apply: () => personality.save({ ...before, warmth: Math.min(100, before.warmth + 5) }).version
    })
    const appliedVersion = applied.appliedPersonalityVersion!
    personality.restore(1)
    const recordAfter = feedback.applicationFor(candidate!.id)
    expect(recordAfter?.status).toBe('applied')
    expect(recordAfter?.appliedPersonalityVersion).toBe(appliedVersion)
    // The applied version is still visible in the personality history.
    expect(personality.history().some((revision) => revision.version === appliedVersion)).toBe(true)
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

    expect(() => feedback.apply(candidate!.id, { includeSensitive: true, baseVersion: 1, currentVersion: 1, apply: () => 2 })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' })
    )
    expect(feedback.recoverInterruptedApplications()).toBe(1)
    expect(feedback.applicationFor(candidate!.id)?.status).toBe('needs_review')
  })
})

describe('deletion is transactional across evidence, memory and the conversation row', () => {
  function setupCompanion(feedback?: FeedbackCandidateService) {
    const database = SqliteDatabase.open(':memory:')
    const memories = new MemoryService(new SqliteMemoryRepository(database), clock)
    const conversations = new ConversationService(new SqliteConversationRepository(database))
    const companion = new CompanionService({
      database,
      memories,
      conversations,
      secrets: new MemorySecretStore(),
      authorize: async () => undefined,
      clock,
      feedback: feedback ?? new FeedbackCandidateService(database, clock)
    })
    return { database, memories, conversations, companion }
  }

  it('does not delete the conversation when evidence withdrawal fails', () => {
    const failing = {
      withdrawForConversation: () => { throw new Error('withdrawal failed') }
    } as unknown as FeedbackCandidateService
    const { companion } = setupCompanion(failing)
    const conversation = companion.createConversation()
    expect(() => companion.deleteConversation({ conversationId: conversation.id })).toThrow('withdrawal failed')
    // The user's delete must not be reported as done while evidence stays active.
    expect(companion.listConversations().some((record) => record.id === conversation.id)).toBe(true)
  })

  it('deleting a message withdraws only that message evidence and recomputes support', () => {
    const { database, conversations, companion } = setupCompanion()
    const feedback = new FeedbackCandidateService(database, clock)
    const conversation = companion.createConversation()
    const firstMessage = conversations.appendMessage(conversation.id, 'user', '请简短一点。', 'cccccccc-cccc-4ccc-8ccc-cccccccccc01').messages[0]!.id
    const secondMessage = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
    for (const [conversationId, messageId] of [[conversation.id, firstMessage], [conversationB, secondMessage]] as const) {
      feedback.record({
        kind: 'tone',
        source: 'user_explicit',
        conversationId,
        messageId,
        claim: '请简短一点。',
        confidence: 70,
        sensitivity: 'normal'
      })
    }
    const [candidate] = feedback.list()
    expect(candidate?.status).toBe('supported')

    companion.deleteMessage({ conversationId: conversation.id, messageId: firstMessage })

    const evidence = database.connection.prepare(
      'SELECT message_id, status FROM persona_feedback_evidence WHERE candidate_id = ? ORDER BY message_id'
    ).all(candidate!.id) as Array<{ message_id: string; status: string }>
    expect(evidence.find((row) => row.message_id === firstMessage)?.status).toBe('withdrawn')
    expect(evidence.find((row) => row.message_id === secondMessage)?.status).toBe('active')
    // One remaining independent conversation is no longer enough to be supported.
    expect(feedback.get(candidate!.id)?.status).toBe('pending')
    expect(feedback.get(candidate!.id)?.distinctConversations).toBe(1)
    // The message row itself is gone.
    const remaining = database.connection.prepare('SELECT COUNT(*) AS count FROM messages WHERE id = ?').get(firstMessage)
    expect(Number(remaining?.count)).toBe(0)
  })

  it('retracts a memory accepted from a deleted message so it leaves the context', () => {
    const { database, memories, conversations, companion } = setupCompanion()
    const conversation = companion.createConversation()
    const message = conversations.appendMessage(conversation.id, 'user', '我对花生过敏。', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1').messages[0]!
    const memory = memories.create('用户对花生过敏。', 'sensitive')
    database.connection.prepare(`
      INSERT INTO memory_suggestions(id, conversation_id, source_message_id, claim, sensitivity, status, provider_model, evidence_hash, created_at, reviewed_at, accepted_memory_id, accepted_content)
      VALUES (?, ?, ?, ?, 'sensitive', 'accepted', 'test', ?, ?, ?, ?, ?)
    `).run('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', conversation.id, message.id, '用户对花生过敏。', 'a'.repeat(64), clock(), clock(), memory.id, '用户对花生过敏。')

    expect(memories.assembleContext("花生", "sensitive").text).toContain('花生')
    companion.deleteMessage({ conversationId: conversation.id, messageId: message.id })

    const row = database.connection.prepare('SELECT status FROM memories WHERE id = ?').get(memory.id)
    expect(row?.status).toBe('retracted')
    expect(memories.assembleContext("花生", "sensitive").text).not.toContain('花生')
  })
})

describe('persona application commits as one unit', () => {
  it('rolls the personality back when the save succeeds but the request then fails', () => {
    const { feedback, personality } = setup()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()
    const before = personality.get()
    expect(() => feedback.apply(candidate!.id, {
      includeSensitive: true,
      baseVersion: before.version,
      currentVersion: before.version,
      apply: () => {
        personality.save({ ...before, warmth: Math.min(100, before.warmth + 10) })
        throw new Error('crash after save')
      }
    })).toThrow('crash after save')
    // The save happened inside the transaction, so it must be gone.
    expect(personality.get().version).toBe(before.version)
    expect(personality.get().warmth).toBe(before.warmth)
    expect(feedback.get(candidate!.id)?.status).toBe('supported')
    expect(feedback.applicationFor(candidate!.id)?.status).toBe('failed')
  })

  it('rejects a write that did not land on the declared base version', () => {
    const { feedback, personality } = setup()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()
    const before = personality.get()
    expect(() => feedback.apply(candidate!.id, {
      includeSensitive: true,
      baseVersion: before.version,
      currentVersion: before.version,
      apply: () => {
        personality.save({ ...before, warmth: 50 })
        return personality.save({ ...personality.get(), warmth: 55 }).version
      }
    })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
    expect(personality.get().version).toBe(before.version)
    expect(feedback.get(candidate!.id)?.status).toBe('supported')
  })

  it('keeps the applied version, the candidate and the record mutually consistent', () => {
    const { feedback, personality } = setup()
    record(feedback, conversationA)
    record(feedback, conversationB)
    const [candidate] = feedback.list()
    const before = personality.get()
    const applied = feedback.apply(candidate!.id, {
      includeSensitive: true,
      baseVersion: before.version,
      currentVersion: before.version,
      apply: () => personality.save({ ...before, warmth: Math.min(100, before.warmth + 5) }).version
    })
    const recordAfter = feedback.applicationFor(candidate!.id)
    expect(applied.status).toBe('applied')
    expect(applied.appliedPersonalityVersion).toBe(personality.get().version)
    expect(recordAfter?.status).toBe('applied')
    expect(recordAfter?.appliedPersonalityVersion).toBe(personality.get().version)
    expect(personality.history().some((revision) => revision.version === applied.appliedPersonalityVersion)).toBe(true)
  })
})
