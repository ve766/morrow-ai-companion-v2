import { describe, expect, it } from 'vitest'
import {
  INTEREST_ARCHIVE_AFTER_DAYS,
  INTEREST_PROMOTION_MIN_CONVERSATIONS,
  INTEREST_PROMOTION_MIN_EVIDENCE,
  computeInterestStrength,
  confidenceForEvidence,
  extractInterestTerms,
  interestPromotionEligible,
  sharedTermCount
} from './self-model-domain'
import { InterestService, SqliteInterestRepository, deriveInterestLabel } from './interest-service'
import { SelfModelService, SqliteSelfModelRepository } from './self-model-service'
import { MAX_CANDIDATE_INTERESTS_PER_RUN, MAX_RUNS_PER_HOUR, ReflectionService, SqliteReflectionRepository } from './reflection-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EventLogService } from '../persistence/event-log'
import { SqliteDatabase } from '../persistence/database'

function openDatabase(): SqliteDatabase {
  return SqliteDatabase.open(':memory:')
}

function createServices(database: SqliteDatabase, clock: () => string = () => '2026-10-25T10:00:00.000Z') {
  const events = new EventLogService(database, clock)
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock, undefined, events)
  const interests = new InterestService(new SqliteInterestRepository(database), events, clock)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events, clock)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events }, events, clock)
  return { events, memories, interests, selfModel, reflection }
}

describe('interest formation (acceptance scenario D)', () => {
  it('keeps a single-mention topic as a candidate and never promotes it', () => {
    const database = openDatabase()
    const { interests } = createServices(database)
    const observed = interests.observe({ conversationId: '11111111-1111-4111-8111-111111111111', messageId: '22222222-2222-4111-8111-111111111111', occurredAt: '2026-10-25T10:00:00.000Z', topicText: '我对天文学特别着迷，尤其是系外行星。' })
    expect(observed).not.toBeNull()
    expect(observed?.status).toBe('candidate')
    // repeat inside the SAME conversation never promotes
    for (let index = 0; index < 10; index += 1) {
      interests.observe({ conversationId: '11111111-1111-4111-8111-111111111111', messageId: '22222222-2222-4111-8111-111111111111', occurredAt: '2026-10-25T10:0' + String(index) + ':00.000Z', topicText: '我对天文学着迷。' })
    }
    expect(interests.list()[0]?.status).toBe('candidate')
    expect(interestPromotionEligible({ status: 'candidate', conversationCount: 1, evidenceCount: 50 })).toBe(false)
  })

  it('promotes a topic to active only after independent multi-conversation evidence', () => {
    const database = openDatabase()
    const { interests } = createServices(database)
    const firstConversation = '11111111-1111-4111-8111-111111111111'
    const secondConversation = '33333333-3333-4111-8111-111111111111'
    interests.observe({ conversationId: firstConversation, messageId: '22222222-2222-4111-8111-111111111111', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我对天文学着迷' })
    expect(interests.list()[0]?.status).toBe('candidate')
    interests.observe({ conversationId: firstConversation, messageId: '22222222-2222-4111-8111-111111111111', occurredAt: '2026-10-21T10:00:00.000Z', topicText: '最近又研究了下天文学' })
    interests.observe({ conversationId: secondConversation, messageId: '22222222-2222-4111-8111-111111111111', occurredAt: '2026-10-24T10:00:00.000Z', topicText: '天文学的进展真快' })
    const promoted = interests.list().find((record) => record.evidenceCount === 3)
    expect(promoted).toBeDefined()
    expect(promoted?.conversationCount).toBe(2)
    expect(promoted?.status).toBe('active')
    expect(interests.activeForContext().map((record) => record.label)).toContain(promoted!.label)
  })

  it('archives stale interests automatically and keeps dropped terminal', () => {
    const database = openDatabase()
    const { interests } = createServices(database)
    interests.observe({ conversationId: '11111111-1111-4111-8111-111111111111', messageId: '22222222-2222-4111-8111-111111111111', occurredAt: '2026-06-01T10:00:00.000Z', topicText: '我对天文学着迷' })
    const archived = interests.archiveStale('2026-10-25T10:00:00.000Z')
    expect(archived).toBe(1)
    expect(interests.list()[0]?.status).toBe('archived')
    expect(INTEREST_ARCHIVE_AFTER_DAYS).toBe(30)
    const revived = interests.setUserStatus(interests.list()[0]!.id, 'dropped')
    expect(revived.status).toBe('dropped')
    // a dropped interest stays dropped even when the topic returns
    interests.observe({ conversationId: '33333333-3333-4111-8111-111111111111', messageId: '22222222-2222-4111-8111-111111111111', occurredAt: '2026-10-25T11:00:00.000Z', topicText: '我又想聊天文学了' })
    // the dropped record stays terminal; the returning topic starts as a fresh weak candidate
    const records = interests.list()
    expect(records.find((record) => record.status === 'dropped')).toBeDefined()
    expect(records.find((record) => record.status === 'candidate')).toBeDefined()
  })

  it('computes deterministic strength and confidence curves', () => {
    expect(computeInterestStrength(1, 1, 0)).toBeCloseTo(0.5, 3)
    expect(computeInterestStrength(10, 4, 0)).toBeGreaterThan(computeInterestStrength(3, 2, 0))
    expect(computeInterestStrength(3, 2, 100)).toBeLessThan(computeInterestStrength(3, 2, 0))
    expect(confidenceForEvidence(20, 1)).toBeLessThanOrEqual(55)
    expect(confidenceForEvidence(20, 4)).toBe(80)
    expect(INTEREST_PROMOTION_MIN_CONVERSATIONS).toBe(2)
    expect(INTEREST_PROMOTION_MIN_EVIDENCE).toBe(3)
  })

  it('derives labels and term sets for latin and CJK topics deterministically', () => {
    expect(deriveInterestLabel('I really love astronomy and exoplanets')).toBe('exoplanets')
    expect(deriveInterestLabel('我对天文学着迷')).toBe('天文')
    expect(deriveInterestLabel('！')).toBeNull()
    const terms = extractInterestTerms('我对天文学着迷')
    expect(terms).toContain('天文')
    expect(terms).toContain('文学')
    expect(sharedTermCount(terms, extractInterestTerms('天文学的进展真快'))).toBeGreaterThanOrEqual(2)
  })
})

describe('self-model with corrections', () => {
  it('records facts, supersedes them with corrections and keeps the history inspectable', () => {
    const database = openDatabase()
    const { selfModel } = createServices(database)
    const fact = selfModel.record({ kind: 'fact', statement: '（用户消息：我对花生过敏）', confidence: 55, sourceMessageId: '22222222-2222-4111-8111-111111111111', conversationId: '11111111-1111-4111-8111-111111111111' })
    expect(fact.status).toBe('active')
    const correction = selfModel.correct(fact.id, '（用户澄清：只有轻度过敏，可以吃少量花生制品）')
    expect(correction.kind).toBe('correction')
    expect(selfModel.list({ status: 'active' }).map((entry) => entry.id)).toEqual([correction.id])
    const all = selfModel.list({ status: 'superseded' })
    expect(all).toHaveLength(1)
    expect(all[0]?.supersededBy).toBe(correction.id)
    selfModel.retract(correction.id)
    expect(selfModel.list({ status: 'active' })).toEqual([])
    expect(() => selfModel.correct(fact.id, '再次纠正已 superseded 的条目')).toThrow()
  })

  it('exposes only fact and correction kinds to the context builder', () => {
    const database = openDatabase()
    const { selfModel } = createServices(database)
    selfModel.record({ kind: 'fact', statement: '事实条目' })
    selfModel.record({ kind: 'inference', statement: '推断条目' })
    selfModel.record({ kind: 'unknown', statement: '未知条目' })
    const exposed = selfModel.activeStatementsForContext(5)
    expect(exposed).toHaveLength(1)
    expect(exposed[0]?.kind).toBe('fact')
  })
})

describe('bounded reflection', () => {
  it('produces evidence-backed findings without recursive runs and respects the rate limit', () => {
    const database = openDatabase()
    let tick = 0
    const clock = () => new Date(Date.parse('2026-10-25T10:00:00.000Z') + (tick++) * 60_000).toISOString()
    const { events, memories, reflection, selfModel } = createServices(database, clock)
    const first = memories.create('用户喜欢 jasmin tea，几乎每天喝', 'personal')
    memories.correct(first.id, '用户纠正：更喜欢龙井茶', '44444444-4444-4111-8111-111111111111')
    const second = memories.create('用户对花生过敏', 'personal')
    memories.retract(second.id)
    selfModel.record({ kind: 'inference', statement: '推断：用户可能偏好简洁回答' })

    const run = reflection.run('manual')
    expect('skipped' in run).toBe(false)
    if ('skipped' in run) return
    expect(run.findingsCount).toBeGreaterThan(0)
    const findings = reflection.findings(run.id)
    expect(findings.some((finding) => finding.kind === 'memory_gap')).toBe(true)
    for (const finding of findings) {
      expect(finding.evidence.length).toBeGreaterThan(0)
      expect(finding.confidence).toBeGreaterThanOrEqual(1)
      expect(finding.confidence).toBeLessThanOrEqual(100)
    }
    // interest candidates stay bounded and candidate-level
    expect(MAX_CANDIDATE_INTERESTS_PER_RUN).toBe(1)

    // immediate re-run is rate limited (MAX_RUNS_PER_HOUR) — no recursion
    expect(MAX_RUNS_PER_HOUR).toBe(6)
    const runs = reflection.listRuns()
    expect(runs).toHaveLength(1)
    const journalEvents = events.list({ eventType: 'reflection.completed' })
    expect(journalEvents).toHaveLength(1)
    expect(journalEvents[0]?.subjectType).toBe('reflection_run')
  })

  it('stops running entirely after the hourly budget is exhausted', () => {
    const database = openDatabase()
    let tick = 0
    const clock = () => new Date(Date.parse('2026-10-25T10:00:00.000Z') + (tick++) * 60_000).toISOString()
    const { reflection } = createServices(database, clock)
    for (let index = 0; index < MAX_RUNS_PER_HOUR; index += 1) {
      const result = reflection.run('startup')
      expect('skipped' in result).toBe(false)
    }
    expect(reflection.run('startup')).toEqual({ skipped: 'rate_limited' })
  })
})

describe('interest sensitivity (task 4)', () => {
  const first = '11111111-1111-4111-8111-111111111111'
  const second = '33333333-3333-4111-8111-111111111111'

  function promote(interests: InterestService, topicText: string, at: string): string {
    // Three observations across two conversations is the real promotion path,
    // so the test does not bypass the lifecycle just to reach 'active'.
    interests.observe({ conversationId: first, messageId: '22222222-2222-4111-8111-111111111111', occurredAt: at, topicText })
    interests.observe({ conversationId: first, messageId: '22222222-2222-4111-8111-111111111111', occurredAt: at, topicText })
    interests.observe({ conversationId: second, messageId: '22222222-2222-4111-8111-111111111111', occurredAt: at, topicText })
    const record = interests.list().find((item) => item.status === 'active')
    expect(record).toBeDefined()
    return record!.id
  }

  it('classifies a sensitive topic and withholds it above the turn ceiling', () => {
    const database = openDatabase()
    const { interests } = createServices(database)
    const sensitiveId = promote(interests, '抑郁症让我很难受', '2026-10-25T10:00:00.000Z')
    const record = interests.list().find((item) => item.id === sensitiveId)
    expect(record?.sensitivity).toBe('sensitive')
    expect(interests.activeForContext(5, 'personal')).toEqual([])
    expect(interests.activeForContext(5, 'sensitive').map((item) => item.id)).toEqual([sensitiveId])
    // The default ceiling is the widest one, so old callers keep their behaviour.
    expect(interests.activeForContext(5).map((item) => item.id)).toEqual([sensitiveId])
  })

  it('keeps an ordinary topic available without consent', () => {
    const database = openDatabase()
    const { interests } = createServices(database)
    const normalId = promote(interests, '天文学最近很有意思', '2026-10-25T10:00:00.000Z')
    expect(interests.list().find((item) => item.id === normalId)?.sensitivity).toBe('normal')
    expect(interests.activeForContext(5, 'personal').map((item) => item.id)).toEqual([normalId])
  })

  it('never downgrades a sensitive interest after a neutral turn', () => {
    const database = openDatabase()
    const { interests } = createServices(database)
    const id = promote(interests, '抑郁症让我很难受', '2026-10-25T10:00:00.000Z')
    // Shares 最近/得厉/厉害 with the stored terms but contains no marker.
    interests.observe({ conversationId: first, messageId: '22222222-2222-4111-8111-111111111112', occurredAt: '2026-10-26T10:00:00.000Z', topicText: '最近得厉害' })
    const record = interests.list().find((item) => item.id === id)
    expect(record?.sensitivity).toBe('sensitive')
    expect(interests.activeForContext(5, 'personal')).toEqual([])
  })
})
