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
import { PersonalizationService } from '../personalization/personalization-service'
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
    // Replaying the same turn must not add evidence at all: the message id is
    // the idempotency key, so a retry of one turn cannot inflate a count.
    for (let index = 0; index < 10; index += 1) {
      interests.observe({ conversationId: '11111111-1111-4111-8111-111111111111', messageId: '22222222-2222-4111-8111-111111111111', occurredAt: '2026-10-25T10:0' + String(index) + ':00.000Z', topicText: '我对天文学着迷。' })
    }
    expect(interests.list()).toHaveLength(1)
    expect(interests.list()[0]?.evidenceCount).toBe(1)
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
    // Distinct turns carry distinct message ids; the replay case is covered
    // separately below.
    interests.observe({ conversationId: firstConversation, messageId: '22222222-2222-4111-8111-222222222222', occurredAt: '2026-10-21T10:00:00.000Z', topicText: '最近又研究了下天文学' })
    interests.observe({ conversationId: secondConversation, messageId: '22222222-2222-4111-8111-333333333333', occurredAt: '2026-10-24T10:00:00.000Z', topicText: '天文学的进展真快' })
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
    interests.observe({ conversationId: '33333333-3333-4111-8111-111111111111', messageId: '22222222-2222-4111-8111-444444444444', occurredAt: '2026-10-25T11:00:00.000Z', topicText: '我又想聊天文学了' })
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
    // The label is the most specific contiguous content phrase, not the first
    // bigram: "天文学" rather than "天文" or a filler word like "最近".
    expect(deriveInterestLabel('我对天文学着迷')).toBe('天文学')
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
    // The structured schema distinguishes *why* the assistant was wrong: a
    // corrected fact (`memory_gap`) is not the same as a corrected reading
    // (`intent_correction`), and an unverified inference yields an action for the
    // next turn (`next_turn_suggestion`) rather than only a note.
    expect(findings.some((finding) => finding.kind === 'intent_correction')).toBe(true)
    expect(findings.some((finding) => finding.kind === 'next_turn_suggestion')).toBe(true)
    // Every kind the algorithm can emit must be one the schema accepts.
    const allowed = new Set<string>(['memory_gap', 'open_question', 'bias_hint', 'interest_candidate', 'consistency_note', 'intent_correction', 'next_turn_suggestion'])
    for (const finding of findings) expect(allowed.has(finding.kind)).toBe(true)
    for (const finding of findings) {
      expect(finding.evidence.length).toBeGreaterThan(0)
      expect(finding.confidence).toBeGreaterThanOrEqual(1)
      expect(finding.confidence).toBeLessThanOrEqual(100)
    }
    // A finding references the entry or memory it is about instead of quoting
    // it: the quoted text is user content and findings are read by the shell.
    const serializedFindings = JSON.stringify(findings)
    expect(serializedFindings).not.toContain('用户可能偏好简洁回答')
    expect(serializedFindings).not.toContain('jasmin tea')
    expect(serializedFindings).not.toContain('花生')
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

describe('B5 reflection pipeline: mapping, evidence, idempotency', () => {
  it('does not add a second finding or a second evidence row when re-run on the same evidence', () => {
    const database = openDatabase()
    let tick = 0
    const clock = () => new Date(Date.parse('2026-10-25T10:00:00.000Z') + (tick++) * 60_000).toISOString()
    const { events, memories, interests, reflection } = createServices(database, clock)
    const first = memories.create('用户喜欢 jasmin tea', 'personal')
    memories.correct(first.id, '用户纠正：更喜欢龙井茶', '44444444-4444-4111-8111-111111111111')
    memories.correct(first.id, '用户再次纠正：其实喜欢白茶', '44444444-4444-4111-8111-111111111112')

    const run1 = reflection.run('manual')
    expect('skipped' in run1).toBe(false)
    if ('skipped' in run1) return
    const findings1 = reflection.findings(run1.id).length
    const evidence1 = interests.evidenceLedger(interests.list()[0]?.id ?? 'none').length

    // Same evidence, second run: nothing new is stored and nothing is re-applied.
    const run2 = reflection.run('manual')
    expect('skipped' in run2).toBe(false)
    if ('skipped' in run2) return
    expect(findings1).toBeGreaterThan(0)
    expect(reflection.findings(run2.id)).toHaveLength(0)
    expect(interests.evidenceLedger(interests.list()[0]?.id ?? 'none').length).toBe(evidence1)
    // `events.list` returns newest first.
    const second = events.list({ eventType: 'reflection.completed' })[0]!
    expect(Number(second.payload.duplicates)).toBeGreaterThan(0)
    expect(Number(second.payload.stored)).toBe(0)
  })

  it('does not re-create interest evidence after the source memory is retracted', () => {
    const database = openDatabase()
    let tick = 0
    const clock = () => new Date(Date.parse('2026-10-25T10:00:00.000Z') + (tick++) * 60_000).toISOString()
    const { memories, interests, reflection } = createServices(database, clock)
    const memory = memories.create('我在学咖啡拉花', 'personal')

    const first = reflection.run('manual')
    expect('skipped' in first).toBe(false)
    if ('skipped' in first) return
    const interestId = interests.list()[0]!.id
    expect(interests.evidenceLedger(interestId).some((row) => row.ref === memory.id)).toBe(true)

    // Retracting the memory removes the evidence through the ledger trigger…
    memories.retract(memory.id)
    expect(interests.evidenceLedger(interestId).some((row) => row.ref === memory.id)).toBe(false)

    // …and a later run must not put it back: the memory is no longer a live source,
    // so no new candidate finding is produced from it.
    const second = reflection.run('manual')
    expect('skipped' in second).toBe(false)
    if ('skipped' in second) return
    expect(reflection.findings(second.id).some((item) => item.kind === 'interest_candidate')).toBe(false)
    expect(interests.evidenceLedger(interestId).some((row) => row.ref === memory.id)).toBe(false)
  })

  it('parks a personality proposal and leaves the baseline untouched', () => {
    const database = openDatabase()
    let tick = 0
    const clock = () => new Date(Date.parse('2026-10-25T10:00:00.000Z') + (tick++) * 60_000).toISOString()
    const { events, reflection } = createServices(database, clock)
    for (let index = 0; index < 2; index += 1) {
      events.tryRecord({
        sourceModule: 'affective-state',
        eventType: 'feeling.event_applied',
        actor: 'system',
        subjectType: 'turn',
        subjectId: `turn-${index}`,
        correlationId: null,
        payload: { lastEventType: 'system_correction' }
      })
    }
    const before = new PersonalizationService(database).list().map((entry) => `${entry.dimension}:${entry.value}`)

    const run = reflection.run('manual')
    expect('skipped' in run).toBe(false)
    if ('skipped' in run) return

    const pending = reflection.pendingPersonalityCandidates()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ dimension: 'depth', direction: 'increase', status: 'pending' })
    expect(pending[0]!.expiresAt > pending[0]!.createdAt).toBe(true)
    // The baseline is unchanged: a proposal is not an edit.
    const after = new PersonalizationService(database).list().map((entry) => `${entry.dimension}:${entry.value}`)
    expect(after).toEqual(before)
    expect(events.list({ eventType: 'reflection.personality_candidate_pending' })).toHaveLength(1)
  })
})
