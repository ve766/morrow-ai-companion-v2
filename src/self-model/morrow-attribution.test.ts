/**
 * P0-1: Morrow's own interest must be provable, not merely stored.
 *
 * The defect this replaces: a finding that aggregated N knowledge gaps called
 * `observeMorrow` once with the first conversation id, so Morrow could never
 * accumulate the independent support her own promotion gate requires. The only
 * way she could become "interested" in something was through user evidence
 * leaking into the same aggregate — which is exactly the confusion L5 exists to
 * catch.
 *
 * Each test below therefore checks the *ledger*, not the aggregate: which rows,
 * with which origin, from which conversation, cited by which finding.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { MemoryService } from '../memory/memory-service'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { InterestService, SqliteInterestRepository } from './interest-service'
import { SelfModelService, SqliteSelfModelRepository } from './self-model-service'
import { ReflectionService, SqliteReflectionRepository } from './reflection-service'
import { KnowledgeGapService } from './knowledge-gap-service'

let databases: SqliteDatabase[] = []
afterEach(() => {
  for (const database of databases) {
    try { database.close() } catch { /* already closed */ }
  }
  databases = []
})

const AT = '2026-10-31T09:00:00.000Z'
const clock = (): string => AT

function open(): SqliteDatabase {
  const database = SqliteDatabase.open(':memory:')
  databases.push(database)
  return database
}

function createServices(database: SqliteDatabase) {
  const events = new EventLogService(database, clock)
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock, undefined, events)
  const interests = new InterestService(new SqliteInterestRepository(database), events, clock)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events, clock)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events }, events, clock)
  const gaps = new KnowledgeGapService(database)
  return { events, memories, interests, selfModel, reflection, gaps }
}

function createConversation(database: SqliteDatabase): string {
  const conversationId = randomUUID()
  database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'test', AT, AT)
  return conversationId
}

/** One committed turn that produced a knowledge gap, written the production way. */
function seedGap(
  context: ReturnType<typeof createServices>,
  database: SqliteDatabase,
  input: { conversationId: string; label: string; text?: string }
): { turnId: string; messageId: string; eventId: string } {
  const turnId = randomUUID()
  const messageId = randomUUID()
  const sequence = Number((database.connection.prepare(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM messages WHERE conversation_id = ?'
  ).get(input.conversationId) as { next: number }).next)
  database.connection.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(messageId, input.conversationId, 'assistant', input.text ?? '我不知道。', AT, sequence, turnId)
  const recorded = context.events.recordDeterministic(`knowledge-gap:${turnId}:${input.label}`, {
    sourceModule: 'cognition',
    eventType: 'cognition.knowledge_gap',
    actor: 'system',
    subjectType: 'interest',
    subjectId: input.label,
    correlationId: input.conversationId,
    payload: { label: input.label, owner: 'morrow', turnId }
  })
  context.gaps.record({
    eventId: recorded.event.id,
    conversationId: input.conversationId,
    turnId,
    label: input.label,
    occurredAt: recorded.event.occurredAt
  })
  return { turnId, messageId, eventId: recorded.event.id }
}

function runReflection(context: ReturnType<typeof createServices>) {
  const run = context.reflection.run('manual')
  if ('skipped' in run) throw new Error(`reflection skipped: ${run.skipped}`)
  return run
}

describe('P0-1 Morrow interest attribution', () => {
  it('promotes a Morrow-only topic from independent gap evidence in two conversations', () => {
    const database = open()
    const context = createServices(database)
    const first = createConversation(database)
    const second = createConversation(database)

    // Three gaps across two conversations: enough independent support, and not
    // a single user interest anywhere.
    seedGap(context, database, { conversationId: first, label: '蛋白质折叠' })
    seedGap(context, database, { conversationId: first, label: '蛋白质折叠' })
    seedGap(context, database, { conversationId: second, label: '蛋白质折叠' })

    runReflection(context)

    const record = context.interests.list().find((item) => item.label.includes('蛋白质折叠'))
    expect(record).toBeDefined()
    expect(record!.origin).toBe('morrow')
    expect(record!.status).toBe('active')

    const ledger = context.interests.evidenceLedger(record!.id)
    expect(ledger).toHaveLength(3)
    // One row per gap event, each attributed to Morrow, each carrying the event
    // it came from. Not one row for the whole finding.
    expect(ledger.every((row) => row.origin === 'morrow')).toBe(true)
    expect(ledger.every((row) => row.kind === 'reflection')).toBe(true)
    expect(new Set(ledger.map((row) => row.eventRef)).size).toBe(3)
    expect(new Set(ledger.map((row) => row.conversationId)).size).toBe(2)
    expect(new Set(ledger.map((row) => row.sourceFindingId)).size).toBe(1)
    expect(record!.evidenceCount).toBe(3)
    expect(record!.conversationCount).toBe(2)
  })

  it('never promotes a Morrow topic from a single conversation, however many gaps it produced', () => {
    const database = open()
    const context = createServices(database)
    const only = createConversation(database)
    for (let index = 0; index < 6; index += 1) {
      seedGap(context, database, { conversationId: only, label: '量子纠缠' })
    }

    runReflection(context)

    // Six gaps in one conversation are one context. The candidate is not even
    // formed: `pickMorrowGapCandidate` requires two distinct conversations, and
    // no amount of repetition inside one conversation is independence.
    const record = context.interests.list().find((item) => item.label.includes('量子纠缠'))
    expect(record).toBeUndefined()
    const findings = context.reflection.listRuns(1)
    expect(findings).toHaveLength(1)
  })

  it('keeps a user-only topic on the user side even when Morrow also failed on it', () => {
    const database = open()
    const context = createServices(database)
    const conversation = createConversation(database)
    const other = createConversation(database)

    // Three user mentions across two conversations.
    for (const [conversationId, messageId] of [
      [conversation, randomUUID()],
      [conversation, randomUUID()],
      [other, randomUUID()]
    ] as const) {
      context.interests.observe({
        conversationId,
        messageId,
        occurredAt: AT,
        topicText: '我最近一直在研究分布式系统的共识算法。'
      })
    }
    const userTopic = context.interests.list().find((item) => item.label.includes('分布式'))
    expect(userTopic?.origin).toBe('user')
    expect(userTopic?.status).toBe('active')

    // Morrow fails on the same topic later. That makes it shared, and a shared
    // claim needs both sides — it must not silently become hers.
    seedGap(context, database, { conversationId: other, label: userTopic!.label })
    seedGap(context, database, { conversationId: conversation, label: userTopic!.label })
    runReflection(context)

    const after = context.interests.list().find((item) => item.id === userTopic!.id)
    expect(after?.origin).toBe('shared')
    const ledger = context.interests.evidenceLedger(userTopic!.id)
    expect(ledger.filter((row) => row.origin === 'user').length).toBe(3)
    expect(ledger.filter((row) => row.origin === 'morrow').length).toBeGreaterThanOrEqual(2)
  })

  it('does not let user evidence promote a Morrow-origin topic on its own', () => {
    const database = open()
    const context = createServices(database)
    const first = createConversation(database)
    const second = createConversation(database)

    // Two gaps in two conversations clear the independence bar but not the
    // evidence bar, so the topic is a Morrow candidate with two supports.
    seedGap(context, database, { conversationId: first, label: '暗物质' })
    seedGap(context, database, { conversationId: second, label: '暗物质' })
    runReflection(context)
    const morrow = context.interests.list().find((item) => item.label.includes('暗物质'))!
    expect(morrow.origin).toBe('morrow')
    expect(morrow.status).toBe('candidate')
    expect(morrow.evidenceCount).toBe(2)

    // Then the user talks about it a lot. The aggregate becomes `shared` and the
    // total count is large, but the *Morrow* side still has two observations, so
    // the promotion gate must not fire on the user's count.
    for (const conversationId of [first, second]) {
      for (let index = 0; index < 3; index += 1) {
        context.interests.observe({
          conversationId,
          messageId: randomUUID(),
          occurredAt: AT,
          topicText: `我最近一直在想暗物质的问题，第 ${index} 次。`
        })
      }
    }
    const shared = context.interests.list().find((item) => item.id === morrow.id)!
    expect(shared.origin).toBe('shared')
    expect(shared.status).toBe('candidate')
    const ledger = context.interests.evidenceLedger(shared.id)
    expect(ledger.filter((row) => row.origin === 'morrow')).toHaveLength(2)
    expect(ledger.filter((row) => row.origin === 'user').length).toBeGreaterThan(0)
  })

  it('retracts Morrow evidence when the source turn is deleted', () => {
    const database = open()
    const context = createServices(database)
    const first = createConversation(database)
    const second = createConversation(database)
    const gapA = seedGap(context, database, { conversationId: first, label: '深海生物' })
    seedGap(context, database, { conversationId: first, label: '深海生物' })
    seedGap(context, database, { conversationId: second, label: '深海生物' })

    runReflection(context)
    const record = context.interests.list().find((item) => item.label.includes('深海生物'))!
    expect(record.status).toBe('active')

    database.connection.prepare('DELETE FROM messages WHERE turn_id = ?').run(gapA.turnId)

    const gaps = context.gaps.all().filter((row) => row.label.includes('深海生物'))
    expect(gaps.length).toBe(2)
    const after = context.interests.list().find((item) => item.id === record.id)
    expect(after).toBeDefined()
    // Two observations left in two conversations is still above the gate, so
    // the aggregate survives — and cannot cite the deleted event any more.
    expect(context.interests.evidenceLedger(record.id).some((row) => row.eventRef === gapA.eventId)).toBe(false)
    expect(after!.evidenceCount).toBe(2)
  })

  it('records the counter-evidence polarity so a reversal lowers the aggregate', () => {
    const database = open()
    const context = createServices(database)
    const first = createConversation(database)
    const second = createConversation(database)
    let record = null as ReturnType<InterestService['observe']> | null
    for (const conversationId of [first, first, second]) {
      record = context.interests.observe({
        conversationId,
        messageId: randomUUID(),
        occurredAt: AT,
        topicText: '我最近在读神经科学，特别是记忆形成。'
      }) ?? record
    }
    expect(record).not.toBeNull()
    const promoted = context.interests.list().find((item) => item.id === record!.id)!
    expect(promoted.status).toBe('active')
    const strengthBefore = promoted.strength

    context.interests.observe({
      conversationId: second,
      messageId: randomUUID(),
      occurredAt: AT,
      topicText: '我不想再读神经科学了。'
    })
    const after = context.interests.list().find((item) => item.id === promoted.id)!
    expect(after.strength).toBeLessThanOrEqual(strengthBefore)
    expect(context.interests.evidenceLedger(promoted.id).some((row) => row.polarity === 'counter')).toBe(true)
  })
})
