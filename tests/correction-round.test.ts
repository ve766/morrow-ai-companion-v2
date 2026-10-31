/**
 * The 2026-10-31 correction round: reliability core (P0-2, P0-3, P0-4).
 *
 * Every test here is written to fail against the previous implementation:
 *
 *   - P0-3: the old drain marked a row done after running the projector, so a
 *     crash between the side effect and the mark replayed the side effect. The
 *     effect ledger and the idempotency keys are what make the replay safe, and
 *     each test injects the crash at a specific point rather than trusting the
 *     happy path.
 *   - P0-2: the old read took the *oldest* 200 events every run, so a journal
 *     past 200 rows could never surface new experience.
 *   - P0-4: the knowledge gap was written with `tryRecord`, which swallowed the
 *     failure and let the assistant message commit without its cognitive
 *     record. The test makes the write fail and requires the message to roll
 *     back.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../src/persistence/database'
import { EventLogService } from '../src/persistence/event-log'
import { CognitionOutbox, type CognitiveProjector } from '../src/app/cognitive-outbox'
import { CognitiveEffectLedger } from '../src/app/effect-ledger'
import { CompanionGoalService } from '../src/motivation/companion-goal'
import { SqliteReflectionRepository, ReflectionService } from '../src/self-model/reflection-service'
import { MemoryService } from '../src/memory/memory-service'
import { SqliteMemoryRepository } from '../src/persistence/memory-repository'
import { InterestService, SqliteInterestRepository } from '../src/self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../src/self-model/self-model-service'
import { buildTestStack } from './helpers/companion-stack'

let cleanup: Array<() => void> = []

afterEach(() => {
  for (const step of cleanup.reverse()) {
    try { step() } catch { /* already closed */ }
  }
  cleanup = []
})

function openMemory(): SqliteDatabase {
  const database = SqliteDatabase.open(':memory:')
  cleanup.push(() => database.close())
  return database
}

function openFile(): { database: SqliteDatabase; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-reliability-'))
  const path = join(directory, 'morrow.sqlite3')
  cleanup.push(() => rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }))
  const database = SqliteDatabase.open(path)
  cleanup.push(() => database.close())
  return { database, path }
}

const AT = '2026-10-31T00:00:00.000Z'
const clock = (): string => AT

function seedTurn(database: SqliteDatabase, turnId: string): { conversationId: string; messageId: string } {
  const conversationId = randomUUID()
  const messageId = randomUUID()
  database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'test', AT, AT)
  database.connection.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(messageId, conversationId, 'user', '我打算明年三月之前完成 Morrow 的第一阶段。', AT, 1, turnId)
  return { conversationId, messageId }
}

function goalProjector(goals: CompanionGoalService, onAfterWrite?: () => void): CognitiveProjector {
  return {
    module: 'goal',
    version: 1,
    project: (input) => {
      goals.detectFromTurn({
        conversationId: input.conversationId,
        sourceMessageId: input.userMessageId,
        text: input.readUserMessage()
      })
      onAfterWrite?.()
    }
  }
}

describe('P0-3 outbox effect ledger', () => {
  it('does not duplicate a side effect when the process dies after the write and before the mark', () => {
    const database = openMemory()
    const goals = new CompanionGoalService(database, clock)
    const outbox = new CognitionOutbox(database, clock)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(database, turnId)
    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: AT, analysis: null, modules: ['goal'] })

    let crashed = false
    const projector = goalProjector(goals, () => {
      if (!crashed) {
        crashed = true
        // The business write has committed; the process now dies before the
        // outbox row and the ledger are marked.
        throw new Error('simulated crash after the write')
      }
    })

    const first = outbox.drain([projector])
    expect(first.failed).toBe(1)
    expect(goals.list()).toHaveLength(1)

    const second = outbox.drain([projector])
    expect(second.done).toBe(1)
    // The goal is created once, because creation is keyed by the source message
    // and the derived title — not because the projector happened to be called
    // once.
    expect(goals.list()).toHaveLength(1)
    const effects = outbox.effectsForTurn(turnId)
    expect(effects).toHaveLength(1)
    expect(effects[0]!.state).toBe('applied')
  })

  it('skips a projector whose effect the ledger already records as applied', () => {
    const database = openMemory()
    const outbox = new CognitionOutbox(database, clock)
    const ledger = new CognitiveEffectLedger(database, clock)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(database, turnId)
    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: AT, analysis: null, modules: ['interest'] })

    const identity = { turnId, module: 'interest', handlerVersion: 1, effectKey: 'project' }
    expect(ledger.begin(identity)).toBe('run')
    ledger.complete(identity)

    let calls = 0
    const result = outbox.drain([{ module: 'interest', version: 1, project: () => { calls += 1 } }])

    expect(calls).toBe(0)
    expect(result.replayed).toBe(1)
    expect(outbox.stats().pending).toBe(0)
  })

  it('parks a permanently failing effect as terminal instead of retrying forever', () => {
    const database = openMemory()
    const outbox = new CognitionOutbox(database, clock)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(database, turnId)
    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: AT, analysis: null, modules: ['growth'] })

    const projector: CognitiveProjector = { module: 'growth', version: 1, project: () => { throw new Error('always') } }
    let last = ''
    for (let index = 0; index < 5; index += 1) {
      outbox.drain([projector])
      last = outbox.effectsForTurn(turnId)[0]!.state
    }

    expect(last).toBe('terminal_failed')
    expect(outbox.stats().failed).toBe(1)
    // A terminal failure is visible, not silently reported as done.
    expect(outbox.effectStats().terminal_failed).toBe(1)
  })

  it('resumes an interrupted effect after a real process restart', () => {
    const { database, path } = openFile()
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(database, turnId)

    const firstGoals = new CompanionGoalService(database, clock)
    const firstOutbox = new CognitionOutbox(database, clock)
    firstOutbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: AT, analysis: null, modules: ['goal'] })
    // Claim the effect and die: the ledger row stays `running`.
    new CognitiveEffectLedger(database, clock).begin({ turnId, module: 'goal', handlerVersion: 1, effectKey: 'project' })
    const pendingBeforeClose = firstOutbox.stats().pending
    expect(firstGoals.list()).toHaveLength(0)

    database.close()
    const reopened = SqliteDatabase.open(path)
    cleanup.push(() => reopened.close())
    const ledger = new CognitiveEffectLedger(reopened, clock)
    expect(ledger.requeueInterrupted()).toBe(1)

    const goals = new CompanionGoalService(reopened, clock)
    const outbox = new CognitionOutbox(reopened, clock)
    const result = outbox.drain([goalProjector(goals)])
    expect(result.done).toBe(1)
    expect(goals.list()).toHaveLength(1)
    expect(pendingBeforeClose).toBe(1)
  })

  it('creates one goal when the same candidate is accepted twice', () => {
    const database = openMemory()
    const goals = new CompanionGoalService(database, clock)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(database, turnId)
    goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text: '我打算以后多读点书。' })
    const candidate = goals.listCandidates()[0]!

    const first = goals.acceptCandidate(candidate.id)
    const second = goals.acceptCandidate(candidate.id)
    expect(second.id).toBe(first.id)
    expect(goals.list()).toHaveLength(1)
    expect(goals.list({ status: 'active' })).toHaveLength(1)
  })

  it('refuses to accept a candidate whose source message was deleted', () => {
    const database = openMemory()
    const goals = new CompanionGoalService(database, clock)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(database, turnId)
    goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text: '我打算以后多读点书。' })
    const candidate = goals.listCandidates()[0]!

    database.connection.prepare('DELETE FROM messages WHERE id = ?').run(messageId)

    expect(goals.listCandidates()).toHaveLength(0)
    expect(() => goals.acceptCandidate(candidate.id)).toThrow()
    expect(goals.list()).toHaveLength(0)
  })
})

class FlakyReflectionRepository extends SqliteReflectionRepository {
  failRuns = false

  override createRun(summary: Parameters<SqliteReflectionRepository['createRun']>[0]): void {
    if (this.failRuns) throw new Error('disk full')
    super.createRun(summary)
  }
}

function buildReflection(database: SqliteDatabase, repository: SqliteReflectionRepository) {
  const events = new EventLogService(database, clock)
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock, undefined, events)
  const interests = new InterestService(new SqliteInterestRepository(database), events, clock)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events, clock)
  const reflection = new ReflectionService(repository, { memories, interests, selfModel, events }, events, clock)
  return { events, memories, interests, reflection }
}

describe('P0-2 reflection cursor', () => {
  it('keeps consuming new events after the journal passes the batch size', () => {
    const database = openMemory()
    const repository = new FlakyReflectionRepository(database)
    const { events, reflection } = buildReflection(database, repository)

    // 500 neutral events: more than one batch, and more than the old fixed
    // 200-row window that reflection could never move past.
    for (let index = 0; index < 500; index += 1) {
      events.record({
        sourceModule: 'memory',
        eventType: 'memory.note',
        actor: 'user',
        subjectType: 'memory',
        subjectId: null,
        correlationId: null,
        payload: { index }
      })
    }

    const run = reflection.run('manual')
    expect('skipped' in run).toBe(false)
    expect(reflection.backlog().pending).toBe(0)

    // One more event, written after the first batch: it must still be seen.
    events.record({
      sourceModule: 'memory',
      eventType: 'memory.note',
      actor: 'user',
      subjectType: 'memory',
      subjectId: null,
      correlationId: null,
      payload: { index: 500 }
    })
    expect(reflection.backlog().pending).toBe(1)
    const second = reflection.run('manual')
    expect('skipped' in second).toBe(false)
    if ('skipped' in second) return
    expect(second.examinedEvents).toBeGreaterThanOrEqual(1)
    expect(reflection.backlog().pending).toBe(0)
  })

  it('does not advance the cursor when the batch fails', () => {
    const database = openMemory()
    const repository = new FlakyReflectionRepository(database)
    const { events, reflection } = buildReflection(database, repository)
    const memory = new MemoryService(new SqliteMemoryRepository(database), clock, undefined, events)
    const first = memory.create('我住在杭州。', 'personal')
    memory.correct(first.id, '我住在苏州。')
    memory.correct(first.id, '我住在南京。')

    repository.failRuns = true
    expect(() => reflection.run('manual')).toThrow()
    expect(reflection.backlog().lastSeq).toBe(0)

    repository.failRuns = false
    const run = reflection.run('manual')
    expect('skipped' in run).toBe(false)
    // The retry processes the same batch: nothing was lost by the failure.
    expect(reflection.backlog().lastSeq).toBeGreaterThan(0)
  })

  it('does not duplicate findings when the cursor is rewound', () => {
    const database = openMemory()
    const repository = new FlakyReflectionRepository(database)
    const { events, memories, reflection } = buildReflection(database, repository)
    const memory = memories.create('我住在杭州。', 'personal')
    memories.correct(memory.id, '我住在苏州。')
    memories.correct(memory.id, '我住在南京。')

    const first = reflection.run('manual')
    expect('skipped' in first).toBe(false)
    if ('skipped' in first) return
    const findings = reflection.findings(first.id).length
    expect(findings).toBeGreaterThan(0)

    database.connection.prepare('UPDATE reflection_cursors SET last_seq = 0').run()
    const second = reflection.run('manual')
    expect('skipped' in second).toBe(false)
    if ('skipped' in second) return
    expect(reflection.findings(second.id)).toHaveLength(0)
    const completed = events.list({ eventType: 'reflection.completed' })[0]!
    expect(Number(completed.payload.duplicates)).toBeGreaterThan(0)
    expect(Number(completed.payload.stored)).toBe(0)
  })
})

class ExplodingJournal extends EventLogService {
  failGapWrites = false

  override recordDeterministic(
    idempotencyKey: string,
    event: Parameters<EventLogService['recordDeterministic']>[1]
  ): ReturnType<EventLogService['recordDeterministic']> {
    if (this.failGapWrites && event.eventType === 'cognition.knowledge_gap') {
      throw new Error('journal unavailable')
    }
    return super.recordDeterministic(idempotencyKey, event)
  }
}

async function send(stack: ReturnType<typeof buildTestStack>, conversationId: string, content: string): Promise<void> {
  stack.provider.reply = '你住在北京。'
  await stack.companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
}

describe('P0-4 knowledge gap durability', () => {
  it('rolls the assistant message back when the gap cannot be recorded, instead of losing it silently', async () => {
    let journal: ExplodingJournal | undefined
    const stack = buildTestStack({
      eventLog: (database) => {
        journal = new ExplodingJournal(database)
        return journal
      }
    })
    cleanup.push(() => stack.close())
    const conversation = stack.companion.createConversation()
    journal!.failGapWrites = true

    await expect(send(stack, conversation.id, '我在研究蛋白质折叠的分子动力学，你还记得我住在哪吗？')).rejects.toThrow()

    // The reply that could not be paired with its cognitive record is not
    // committed: "the answer exists" and "we know why Morrow could not ground
    // it" are one fact, or neither.
    const assistant = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'assistant'"
    ).get(conversation.id) as { n: number }
    expect(Number(assistant.n)).toBe(0)
    const gaps = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'cognition.knowledge_gap'"
    ).get() as { n: number }
    expect(Number(gaps.n)).toBe(0)

    // With the journal healthy the same turn commits, and the gap has both a
    // durable event and its evidence row.
    journal!.failGapWrites = false
    await send(stack, conversation.id, '我在研究蛋白质折叠的分子动力学，你还记得我住在哪吗？')
    const stored = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'cognition.knowledge_gap'"
    ).get() as { n: number }
    expect(Number(stored.n)).toBeGreaterThanOrEqual(1)
    const evidence = stack.database.connection.prepare(
      'SELECT event_id, conversation_id FROM knowledge_gap_evidence'
    ).all() as Array<{ event_id: string; conversation_id: string }>
    expect(evidence.length).toBeGreaterThanOrEqual(1)
    expect(evidence[0]!.conversation_id).toBe(conversation.id)
    const exists = stack.events.exists(evidence[0]!.event_id)
    expect(exists).toBe(true)
  })

  it('writes one gap per turn, not one per retry', async () => {
    const stack = buildTestStack()
    cleanup.push(() => stack.close())
    const conversation = stack.companion.createConversation()
    const turnId = randomUUID()
    stack.provider.reply = '你住在北京。'
    const request = { conversationId: conversation.id, requestId: turnId, content: '我在研究蛋白质折叠的分子动力学，你还记得我住在哪吗？', includeSensitive: false }
    await stack.companion.sendChat(request, () => undefined)
    // Replaying the committed turn returns the stored reply and never reaches
    // the hooks again; the deterministic id is the second line of defence.
    await stack.companion.sendChat(request, () => undefined)
    const gaps = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'cognition.knowledge_gap'"
    ).get() as { n: number }
    expect(Number(gaps.n)).toBe(1)
  })
})
