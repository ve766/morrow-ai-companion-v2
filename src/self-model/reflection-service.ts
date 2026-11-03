import type { EventLogService, MorrowEvent } from '../persistence/event-log'
import type { MemoryService } from '../memory/memory-service'
import type { InterestService } from './interest-service'
import type { SelfModelService } from './self-model-service'
import { deriveInterestLabel } from './interest-service'
import type {
  PendingPersonalityCandidate,
  ReflectionFinding,
  ReflectionFindingKind,
  ReflectionRunSummary,
  ReflectionTrigger
} from './self-model-domain'
import { dedupeKeyOf, mapReflectionFinding, type EvidenceCheck, type ReflectionEffect } from './reflection-mapping'
import { CognitiveEffectLedger } from '../app/effect-ledger'

export interface ReflectionRepositoryPort {
  runsSince(trigger: ReflectionTrigger | undefined, sinceMs: number): Array<{ id: string; finished_at: string }>
  createRun(summary: ReflectionRunSummary): void
  /** Returns false when the finding already exists (same dedupe key). */
  createFinding(finding: ReflectionFinding): boolean
  /** The stored finding for a dedupe key, or null. Used to resume a skipped effect. */
  findByDedupeKey(dedupeKey: string): ReflectionFinding | null
  createPendingPersonalityCandidate(candidate: PendingPersonalityCandidate): void
  listPendingPersonalityCandidates(): PendingPersonalityCandidate[]
  findingsForRun(runId: string): ReflectionFinding[]
  listRuns(limit: number): ReflectionRunSummary[]
  /** Last journal position this consumer has processed. Null when it never ran. */
  cursor(consumer: string): { lastSeq: number; cursorVersion: number } | null
  setCursor(consumer: string, lastSeq: number, cursorVersion: number, at: string): void
  transaction<T>(operation: () => T): T
  /** The connection effect bookkeeping must share. */
  connection(): import('../persistence/database').SqliteDatabase
  /** Independent gap evidence behind a topic, across batches. */
  gapEvidence(label: string): Array<{ eventId: string; conversationId: string; occurredAt: string }>
  /** Consumes a label's uncited gaps for one finding. */
  markGapEvidenceCited(label: string, findingId: string): void
}

interface RunRow {
  id: string
  trigger_kind: string
  started_at: string
  finished_at: string
  examined_turns: number
  examined_events: number
  findings_count: number
  status: string
}

interface FindingRow {
  id: string
  run_id: string
  kind: string
  statement: string
  confidence: number
  evidence_json: string
  created_at: string
  dedupe_key: string | null
}

function mapFindingRow(row: FindingRow): ReflectionFinding {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind as ReflectionFindingKind,
    statement: row.statement,
    confidence: row.confidence,
    evidence: JSON.parse(row.evidence_json) as ReflectionFinding['evidence'],
    createdAt: row.created_at,
    ...(row.dedupe_key ? { dedupeKey: row.dedupe_key } : {})
  }
}

export class SqliteReflectionRepository implements ReflectionRepositoryPort {
  constructor(private readonly database: import('../persistence/database').SqliteDatabase) {}

  runsSince(trigger: ReflectionTrigger | undefined, sinceMs: number): Array<{ id: string; finished_at: string }> {
    const rows = (trigger
      ? this.database.connection.prepare('SELECT id, finished_at FROM reflection_runs WHERE trigger_kind = ? AND finished_at >= ? ORDER BY finished_at DESC')
      : this.database.connection.prepare('SELECT id, finished_at FROM reflection_runs WHERE finished_at >= ? ORDER BY finished_at DESC'))
    const parameters: Array<string | number> = trigger ? [trigger, new Date(sinceMs).toISOString()] : [new Date(sinceMs).toISOString()]
    return rows.all(...parameters) as unknown as Array<{ id: string; finished_at: string }>
  }

  createRun(summary: ReflectionRunSummary): void {
    this.database.connection.prepare(`
      INSERT INTO reflection_runs(id, trigger_kind, started_at, finished_at, examined_turns, examined_events, findings_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(summary.id, summary.trigger, summary.startedAt, summary.finishedAt, summary.examinedTurns, summary.examinedEvents, summary.findingsCount, summary.status)
  }

  createFinding(finding: ReflectionFinding): boolean {
    const result = this.database.connection.prepare(`
      INSERT OR IGNORE INTO reflection_findings(id, run_id, kind, statement, confidence, evidence_json, created_at, dedupe_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(finding.id, finding.runId, finding.kind, finding.statement, finding.confidence, JSON.stringify(finding.evidence), finding.createdAt, finding.dedupeKey ?? null)
    return Number(result.changes) > 0
  }

  findByDedupeKey(dedupeKey: string): ReflectionFinding | null {
    const row = this.database.connection.prepare(
      'SELECT * FROM reflection_findings WHERE dedupe_key = ?'
    ).get(dedupeKey) as FindingRow | undefined
    return row ? mapFindingRow(row) : null
  }

  cursor(consumer: string): { lastSeq: number; cursorVersion: number } | null {
    const row = this.database.connection.prepare(
      'SELECT last_seq, cursor_version FROM reflection_cursors WHERE consumer = ?'
    ).get(consumer) as { last_seq: number; cursor_version: number } | undefined
    return row ? { lastSeq: Number(row.last_seq), cursorVersion: Number(row.cursor_version) } : null
  }

  setCursor(consumer: string, lastSeq: number, cursorVersion: number, at: string): void {
    this.database.connection.prepare(`
      INSERT INTO reflection_cursors(consumer, last_seq, cursor_version, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(consumer) DO UPDATE SET
        last_seq = excluded.last_seq,
        cursor_version = excluded.cursor_version,
        updated_at = excluded.updated_at
    `).run(consumer, Math.max(0, Math.floor(lastSeq)), cursorVersion, at)
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)
  }

  connection(): import('../persistence/database').SqliteDatabase {
    return this.database
  }

  /**
   * Every knowledge gap recorded for one label, oldest first.
   *
   * The batch decides *when* reflection looks; this ledger decides *whether*
   * the evidence is enough. A gap in batch 1 and a gap in batch 2 are still two
   * independent conversations, and reading only the batch would have made the
   * threshold depend on paging.
   */
  gapEvidence(label: string): Array<{ eventId: string; conversationId: string; occurredAt: string }> {
    const rows = this.database.connection.prepare(`
      SELECT event_id, conversation_id, occurred_at FROM knowledge_gap_evidence
      WHERE label = ? AND retracted_at IS NULL
      ORDER BY occurred_at, event_id
    `).all(label) as Array<{ event_id: string; conversation_id: string; occurred_at: string }>
    return rows.map((row) => ({ eventId: row.event_id, conversationId: row.conversation_id, occurredAt: row.occurred_at }))
  }

  /** Marks a label's uncited gaps as consumed by one finding. Idempotent. */
  markGapEvidenceCited(label: string, findingId: string): void {
    this.database.connection.prepare(
      'UPDATE knowledge_gap_evidence SET cited_by_finding_id = ? WHERE label = ? AND cited_by_finding_id IS NULL AND retracted_at IS NULL'
    ).run(findingId, label)
  }

  createPendingPersonalityCandidate(candidate: PendingPersonalityCandidate): void {
    this.database.connection.prepare(`
      INSERT INTO pending_personality_candidates(id, finding_id, dimension, direction, confidence, evidence_json, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      candidate.id, candidate.findingId, candidate.dimension, candidate.direction,
      candidate.confidence, JSON.stringify(candidate.evidence), candidate.status,
      candidate.createdAt, candidate.expiresAt
    )
  }

  listPendingPersonalityCandidates(): PendingPersonalityCandidate[] {
    const rows = this.database.connection.prepare(
      'SELECT * FROM pending_personality_candidates ORDER BY created_at, id'
    ).all() as unknown as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      findingId: String(row.finding_id),
      dimension: row.dimension as PendingPersonalityCandidate['dimension'],
      direction: row.direction as PendingPersonalityCandidate['direction'],
      confidence: Number(row.confidence),
      evidence: JSON.parse(String(row.evidence_json)) as Array<{ kind: string; id: string }>,
      status: row.status as PendingPersonalityCandidate['status'],
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at)
    }))
  }

  findingsForRun(runId: string): ReflectionFinding[] {
    const rows = this.database.connection.prepare('SELECT * FROM reflection_findings WHERE run_id = ? ORDER BY created_at, id').all(runId) as unknown as FindingRow[]
    return rows.map(mapFindingRow)
  }

  listRuns(limit: number): ReflectionRunSummary[] {
    const rows = this.database.connection.prepare('SELECT * FROM reflection_runs ORDER BY started_at DESC LIMIT ?').all(limit) as unknown as RunRow[]
    return rows.map((row) => ({
      id: row.id,
      trigger: row.trigger_kind as ReflectionTrigger,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      examinedTurns: row.examined_turns,
      examinedEvents: row.examined_events,
      findingsCount: row.findings_count,
      status: row.status as 'completed' | 'failed'
    }))
  }
}

// Hard anti-recursion budget: one reflection run may create at most one
// candidate interest, and runs are rate-limited per hour. A reflection run
// never triggers another reflection run — the only entry point is an
// explicit call from the app shell or a user request.
export const MAX_FINDINGS_PER_RUN = 8
export const MAX_CANDIDATE_INTERESTS_PER_RUN = 1
export const MAX_RUNS_PER_HOUR = 6
/** Journal events examined per batch. Bounded so one run cannot scan the world. */
export const REFLECTION_BATCH_SIZE = 200
/** Batches per run. Five batches drain 1000 backlogged events in one run. */
export const REFLECTION_MAX_BATCHES_PER_RUN = 5
/**
 * Consumer name for the journal cursor.
 *
 * Separate from the trigger kind on purpose: if two triggers shared a cursor,
 * whichever ran first would advance past events the other never saw. Today there
 * is one consumer; the key exists so a second one cannot silently starve it.
 */
export const REFLECTION_CONSUMER = 'reflection'
/** Bumped when the cursor's meaning changes; old rows are re-read from zero. */
export const REFLECTION_CURSOR_VERSION = 1
/** Bumped when effect semantics change; old ledger rows keep their own version. */
export const REFLECTION_HANDLER_VERSION = 1

export interface ReflectionDependencies {
  memories: MemoryService
  interests: InterestService
  selfModel: SelfModelService
  events: EventLogService
}

export interface ReflectionBacklog {
  lastSeq: number
  latestSeq: number
  pending: number
  cursorVersion: number
}

export class ReflectionService {
  private readonly ledger: CognitiveEffectLedger

  constructor(
    private readonly repository: ReflectionRepositoryPort,
    private readonly dependencies: ReflectionDependencies,
    private readonly events: EventLogService | undefined = dependencies.events,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID(),
    ledger?: CognitiveEffectLedger
  ) {
    this.ledger = ledger ?? new CognitiveEffectLedger(repository.connection(), clock)
  }

  listRuns(limit = 20): ReflectionRunSummary[] {
    return this.repository.listRuns(limit)
  }

  findings(runId: string): ReflectionFinding[] {
    return this.repository.findingsForRun(runId)
  }

  /**
   * Personality proposals parked by reflection. They are never applied here:
   * the list exists so a user-facing surface can ask for confirmation, and so a
   * test can prove the baseline was not touched.
   */
  pendingPersonalityCandidates(): PendingPersonalityCandidate[] {
    return this.repository.listPendingPersonalityCandidates()
  }

  canRun(now: string = this.clock()): boolean {
    return this.repository.runsSince(undefined, Date.parse(now) - 3_600_000).length < MAX_RUNS_PER_HOUR
  }

  run(trigger: ReflectionTrigger): ReflectionRunSummary | { skipped: 'rate_limited' } {
    const startedAt = this.clock()
    if (!this.canRun(startedAt)) return { skipped: 'rate_limited' }
    const runId = this.makeId().toLowerCase()
    // Incremental consumption. The old read was `list({ ascending: true })`,
    // which the repository answered with the *oldest* 200 rows every single
    // time: once an install passed 200 events, nothing new could ever be
    // reflected on. The cursor is a journal position, so each batch starts
    // where the last confirmed one ended.
    const cursor = this.repository.cursor(REFLECTION_CONSUMER)
    const startSeq = cursor?.cursorVersion === REFLECTION_CURSOR_VERSION ? cursor.lastSeq : 0
    const batches: MorrowEvent[][] = []
    let endSeq = startSeq
    for (let index = 0; index < REFLECTION_MAX_BATCHES_PER_RUN; index += 1) {
      const batch = this.dependencies.events.listAfter(endSeq, REFLECTION_BATCH_SIZE)
      if (batch.length === 0) break
      batches.push(batch)
      endSeq = batch[batch.length - 1]!.seq ?? endSeq
      if (batch.length < REFLECTION_BATCH_SIZE) break
    }
    const examinedEvents = batches.flat()
    const eventIndex = new Map(examinedEvents.map((event) => [event.id, event]))
    const memoryEvents = examinedEvents.filter((event) => event.sourceModule === 'memory')
    const findings: Array<Omit<ReflectionFinding, 'id' | 'runId' | 'createdAt'>> = []

    // 1. Memory gaps: user corrections and retractions show where stored
    //    knowledge was wrong or unwanted; a correction cluster is a hint the
    //    model should be more careful in that area.
    const corrections = memoryEvents.filter((event) => event.eventType === 'memory.corrected')
    if (corrections.length >= 2) {
      findings.push({
        kind: 'memory_gap',
        statement: `最近的记录中有 ${corrections.length} 次用户纠正；在相关话题上应降低断言置信度并先与用户核对。`,
        confidence: 55,
        evidence: corrections.slice(-3).map((event) => ({ kind: 'event', id: event.id }))
      })
    }
    // 1b. Intent correction: the user said the assistant read them wrong. This is
    //     about *understanding*, not about a stored claim, so it is its own kind —
    //     the next turn should re-state its reading before asserting anything.
    if (corrections.length >= 1) {
      findings.push({
        kind: 'intent_correction',
        statement: '用户纠正过助手对上一轮的理解；下一轮应先复述自己的理解再回答，而不是沿用旧判断。',
        confidence: 60,
        evidence: corrections.slice(-2).map((event) => ({ kind: 'event', id: event.id }))
      })
    }
    const retractions = memoryEvents.filter((event) => event.eventType === 'memory.retracted')
    if (retractions.length >= 1) {
      findings.push({
        kind: 'memory_gap',
        statement: `存在 ${retractions.length} 条被撤销的记忆；不要把它们当作当前事实引用。`,
        confidence: 65,
        evidence: retractions.slice(-2).map((event) => ({ kind: 'event', id: event.id }))
      })
    }

    // 2. Bias hints: repeated negative feedback or corrections on the
    //    interaction itself, from the feeling engine's event history.
    const feedbackEvents = examinedEvents.filter((event) => event.eventType === 'feeling.event_applied')
    const negative = feedbackEvents.filter((event) => event.payload.lastEventType === 'negative_feedback' || event.payload.lastEventType === 'system_correction')
    if (negative.length >= 2) {
      // A repeated *content* correction points at how deep the answers go; that is
      // the only dimension this evidence can name. It is a heuristic mapping, and
      // it only ever produces a *pending* proposal — never a baseline change.
      const aboutDepth = negative.some((event) => event.payload.lastEventType === 'system_correction')
      findings.push({
        kind: 'bias_hint',
        statement: '多次交互被用户纠正；近期回答应更直接地承认不确定性，并减少重复已纠正的说法。',
        confidence: 50,
        evidence: [
          ...negative.slice(-3).map((event) => ({ kind: 'event', id: event.id })),
          ...(aboutDepth ? [{ kind: 'dimension', id: 'depth' }] : [])
        ]
      })
    }

    // 3. Consistency notes from the self model: inference entries that were
    //    never confirmed stay explicitly marked as unverified. The finding
    //    references the entry instead of quoting it: the quoted text is user
    //    content and a finding is read by the shell and may reach a log.
    const unverified = this.dependencies.selfModel.list({ status: 'active' }).filter((entry) => entry.kind === 'inference')
    // 3b. Next-turn suggestion: a bounded action, derived from the same unverified
    //     entries but phrased as something to *do* rather than something to note.
    //     Suggestions never become instructions on their own: they are read by the
    //     shell and by the self-model block, and they carry the entry they came from.
    if (unverified.length > 0) {
      findings.push({
        kind: 'next_turn_suggestion',
        statement: '存在未经确认的自我推断；下一轮在用到相关内容前，先用一句话向用户确认。',
        confidence: 45,
        evidence: unverified.slice(0, 2).map((entry) => ({ kind: 'self_model_entry', id: entry.id }))
      })
    }
    for (const entry of unverified.slice(0, 2)) {
      findings.push({
        kind: 'consistency_note',
        statement: `有一条关于自己的判断仍是未经确认的推断，等待用户澄清（条目 ${entry.id}）。`,
        confidence: entry.confidence,
        evidence: [{ kind: 'self_model_entry', id: entry.id }]
      })
    }

    // 4. Interest candidate: at most one per run, only as a 'candidate' —
    //    promotion still requires independent multi-conversation evidence.
    //    Where each candidate came from is kept here so the effect layer can
    //    record evidence with the right conversation and timestamp.
    const candidateOrigins = new Map<string, { conversationId: string; occurredAt: string }>()
    let candidateCreated = 0
    for (const event of memoryEvents.filter((item) => item.eventType === 'memory.created').slice(-5)) {
      if (findings.length >= MAX_FINDINGS_PER_RUN || candidateCreated >= MAX_CANDIDATE_INTERESTS_PER_RUN) break
      const subjectId = typeof event.subjectId === 'string' ? event.subjectId : null
      const memory = subjectId ? this.dependencies.memories.list().find((record) => record.id === subjectId) : undefined
      const label = memory ? deriveInterestLabel(memory.currentText) : null
      const alreadyKnown = this.dependencies.interests.list().some((record) => record.label.toLocaleLowerCase() === label?.toLocaleLowerCase())
      if (label && !alreadyKnown) {
        findings.push({
          kind: 'interest_candidate',
          // The label is derived from a saved memory, so it is user content.
          // The finding names the memory instead of repeating the topic.
          statement: `记忆内容指向一个此前未出现的话题（记忆 ${memory!.id}），已作为候选兴趣记录，等待更多独立证据。`,
          confidence: 40,
          evidence: [{ kind: 'memory', id: memory!.id }]
        })
        // The effect is applied *after* the finding is stored and deduped: a
        // re-run over the same memory must not add a second evidence row.
        candidateOrigins.set(memory!.id, {
          conversationId: event.correlationId ?? '00000000-0000-4000-8000-000000000000',
          occurredAt: event.occurredAt
        })
        candidateCreated += 1
      }
    }

    // 5. Morrow's own questions. A gap she failed to ground in two separate
    //    conversations is a topic she has reason to want to understand — and
    //    the evidence is her own failure, not how often the user mentions it.
    //
    //    The candidate is gated on a label appearing in *this* batch (so a run
    //    only reacts to new experience) but its support is read from the gap
    //    ledger, so two gaps split across two batches still count as two. The
    //    finding cites every gap event; the effect then writes one evidence row
    //    per event, which is what makes independent support countable at all.
    const labelsInBatch = new Set<string>()
    for (const event of examinedEvents) {
      if (event.eventType !== 'cognition.knowledge_gap') continue
      const label = typeof event.payload.label === 'string' ? event.payload.label.trim() : ''
      if (label) labelsInBatch.add(label)
    }
    let morrowQuestionLabel: string | null = null
    if (findings.length < MAX_FINDINGS_PER_RUN) {
      const candidate = this.pickMorrowGapCandidate(labelsInBatch)
      if (candidate) {
        morrowQuestionLabel = candidate.label
        findings.push({
          kind: 'morrow_interest_candidate',
          statement: `我对「${candidate.label}」一直没有可靠的理解；这是我自己想弄明白的问题，不是用户反复提到的偏好。`,
          confidence: 45,
          evidence: [
            { kind: 'topic', id: candidate.label },
            ...candidate.events.slice(0, 8).map((item) => ({ kind: 'event', id: item.eventId }))
          ]
        })
      }
    }
    // 5b. An open question: the same grounding-failure evidence in a single
    //     conversation is enough to ask the user whether the topic matters,
    //     but not enough to claim it as an interest (that still needs two
    //     conversations). The producer only reads Morrow's own gap events —
    //     ordinary statements, questions and user preferences never create it.
    if (findings.length < MAX_FINDINGS_PER_RUN) {
      const openQuestion = this.pickOpenQuestionCandidate(labelsInBatch, morrowQuestionLabel)
      if (openQuestion) {
        findings.push({
          kind: 'open_question',
          statement: `我对「${openQuestion.label}」还没有可靠的理解；这是我自己尚未解决的问题，想确认它是否值得继续弄清楚。`,
          confidence: 40,
          evidence: [
            { kind: 'topic', id: openQuestion.label },
            ...openQuestion.events.slice(0, 4).map((item) => ({ kind: 'event', id: item.eventId }))
          ]
        })
      }
    }

    const finishedAt = this.clock()
    const summary: ReflectionRunSummary = {
      id: runId,
      trigger,
      startedAt,
      finishedAt,
      examinedTurns: feedbackEvents.length,
      examinedEvents: examinedEvents.length,
      findingsCount: findings.length,
      status: 'completed'
    }

    // Evidence validity is decided once, from records that exist right now: a
    // finding whose source was retracted or deleted in the meantime must not
    // produce an effect, and must not be silently stored as if it had.
    const memoryIds = new Set(this.dependencies.memories.list().map((record) => record.id))
    const entryIds = new Set(this.dependencies.selfModel.list({ status: 'active' }).map((entry) => entry.id))
    const check: EvidenceCheck = {
      isValid: (ref) => {
        // Events are checked against the journal, not against this batch: a
        // finding from an earlier run is still valid evidence, and rejecting it
        // would also make its unfinished effect unreachable forever.
        if (ref.kind === 'event') return this.dependencies.events.exists(ref.id)
        if (ref.kind === 'memory') return memoryIds.has(ref.id)
        if (ref.kind === 'self_model_entry') return entryIds.has(ref.id)
        return false
      }
    }

    let stored = 0
    let duplicates = 0
    const rejected: Array<{ kind: ReflectionFindingKind; reason: string }> = []
    const effects: string[] = []

    /**
     * Runs one finding's effect exactly once, across process restarts.
     *
     * The ledger — not the finding row — decides whether the effect already
     * happened. The old code used "did `createFinding` insert a row" as that
     * signal, so a crash between the insert and the effect left the finding
     * present and the effect permanently skipped.
     */
    const applyWithLedger = (finding: ReflectionFinding, effect: ReflectionEffect): void => {
      const identity = {
        turnId: runId,
        module: 'reflection',
        handlerVersion: REFLECTION_HANDLER_VERSION,
        effectKey: `finding:${finding.id}`
      }
      const claim = this.ledger.begin(identity)
      if (claim.status === 'applied') return
      // Another worker owns this effect. The owner will apply it; this run must
      // not duplicate the side effect.
      if (claim.status === 'busy') return
      try {
        this.applyEffect(finding, effect, candidateOrigins, finishedAt)
        if (!this.ledger.complete(identity, claim.generation)) {
          // The lease was stolen while this worker ran. Rolling the effect back
          // is correct: the new owner will apply it exactly once.
          throw new Error('LOST_LEASE')
        }
      } catch (error) {
        this.ledger.fail(identity, 'reflection_effect_failed', claim.generation)
        throw error
      }
    }

    // Everything that makes this run durable commits together: the run row,
    // its findings, their effects and the cursor. A failure anywhere rolls the
    // batch back, so the cursor can never advance past work that did not
    // commit — the difference between "resume" and "silently skip".
    return this.repository.transaction(() => {
      this.repository.createRun(summary)

      for (const draft of findings) {
        const finding: ReflectionFinding = {
          ...draft,
          id: this.makeId().toLowerCase(),
          runId,
          createdAt: finishedAt,
          dedupeKey: dedupeKeyOf(draft)
        }
        const effect = mapReflectionFinding(finding, check)
        if (effect.effect === 'rejected') {
          rejected.push({ kind: finding.kind, reason: effect.reason })
          this.events?.tryRecord({
            sourceModule: 'self-model',
            eventType: 'reflection.finding_rejected',
            actor: 'system',
            subjectType: 'reflection_run',
            subjectId: runId,
            correlationId: null,
            payload: { kind: finding.kind, reason: effect.reason }
          })
          continue
        }
        // The dedupe key is the finding's identity. When it already exists the
        // effect is still routed through the ledger: an applied effect is
        // skipped, an unfinished one is retried.
        const existing = finding.dedupeKey ? this.repository.findByDedupeKey(finding.dedupeKey) : null
        if (existing) {
          duplicates += 1
          applyWithLedger(existing, effect)
          continue
        }
        if (!this.repository.createFinding(finding)) {
          duplicates += 1
          const raced = finding.dedupeKey ? this.repository.findByDedupeKey(finding.dedupeKey) : null
          if (raced) applyWithLedger(raced, effect)
          continue
        }
        stored += 1
        effects.push(effect.effect)
        applyWithLedger(finding, effect)
      }

      this.events?.recordDeterministic(`reflection-run:${runId}`, {
        sourceModule: 'self-model',
        eventType: 'reflection.completed',
        actor: 'system',
        subjectType: 'reflection_run',
        subjectId: runId,
        correlationId: null,
        payload: {
          trigger,
          findings: findings.length,
          stored,
          duplicates,
          rejected: rejected.length,
          effects,
          examinedEvents: examinedEvents.length,
          examinedMemoryEvents: memoryEvents.length,
          cursorFrom: startSeq,
          cursorTo: endSeq
        }
      })

      // Last statement in the transaction, on purpose: it is the commit point
      // for "this batch was fully processed".
      //
      // The high-water mark is read *inside* the transaction. This connection
      // holds the write lock, so no other writer can append between the read and
      // the commit: advancing past our own audit events is safe, and it is what
      // keeps `backlog()` from reporting a permanent one-event backlog that is
      // only reflection's own bookkeeping.
      if (endSeq > startSeq) {
        const committedSeq = Math.max(endSeq, this.dependencies.events.latestSeq())
        this.repository.setCursor(REFLECTION_CONSUMER, committedSeq, REFLECTION_CURSOR_VERSION, finishedAt)
      }
      return summary
    })
  }

  /** Journal position, backlog and cursor version — the audit view of P0-2. */
  backlog(): ReflectionBacklog {
    const cursor = this.repository.cursor(REFLECTION_CONSUMER)
    const lastSeq = cursor?.cursorVersion === REFLECTION_CURSOR_VERSION ? cursor.lastSeq : 0
    return {
      lastSeq,
      latestSeq: this.dependencies.events.latestSeq(),
      pending: this.dependencies.events.backlogAfter(lastSeq),
      cursorVersion: cursor?.cursorVersion ?? REFLECTION_CURSOR_VERSION
    }
  }

  /**
   * The label, if the gap ledger already holds two independent conversations
   * for it.
   *
   * The batch decides *when* to look (a run must react to new experience); the
   * ledger decides *whether* the evidence is enough (two gaps split across two
   * batches are still two). Reading only the batch made the threshold depend on
   * how the events happened to be paged.
   */
  /**
   * A gap label seen in exactly one conversation is an open question, not yet
   * an interest. The label may only come from Morrow's own knowledge-gap
   * events; the same artefact filter as the interest candidate applies.
   */
  private pickOpenQuestionCandidate(
    labels: ReadonlySet<string>,
    excludeLabel: string | null
  ): { label: string; events: Array<{ eventId: string; conversationId: string; occurredAt: string }> } | null {
    for (const label of labels) {
      if (excludeLabel !== null && label === excludeLabel) continue
      if (label.length < 2) continue
      if (/(?:哪里|哪儿|什么|哪个|怎么|多少|来着|到哪|上次说|记不记得)/u.test(label)) continue
      const events = this.repository.gapEvidence(label)
      if (events.length === 0) continue
      const conversations = new Set(events.map((item) => item.conversationId))
      if (conversations.size !== 1) continue
      return { label, events }
    }
    return null
  }

  private pickMorrowGapCandidate(
    labels: ReadonlySet<string>
  ): { label: string; events: Array<{ eventId: string; conversationId: string; occurredAt: string }> } | null {
    for (const label of labels) {
      // A question artefact ("哪里", "到哪") is not a topic. Without this filter
      // the producer would turn every unanswerable question into a nonsense
      // interest, which is worse than staying silent.
      if (label.length < 2) continue
      if (/(?:哪里|哪儿|什么|哪个|怎么|多少|来着|到哪|上次说|记不记得)/u.test(label)) continue
      const events = this.repository.gapEvidence(label)
      if (events.length === 0) continue
      const conversations = new Set(events.map((item) => item.conversationId))
      if (conversations.size < 2) continue
      return { label, events }
    }
    return null
  }

  /**
   * Applies exactly one typed effect for a finding that was just stored.
   *
   * Nothing here writes the personality baseline, and nothing executes an
   * action: `pending_personality` parks a proposal, `bounded_suggestion` and
   * `intent_correction_candidate` are recorded for the shell to read. Only
   * `interest_evidence` writes state, and that state is still judged by the
   * promotion gate.
   */
  private applyEffect(
    finding: ReflectionFinding,
    effect: ReflectionEffect,
    candidateOrigins: Map<string, { conversationId: string; occurredAt: string }>,
    at: string
  ): void {
    switch (effect.effect) {
      case 'descriptive':
        return
      case 'interest_evidence': {
        const memory = this.dependencies.memories.list().find((record) => record.id === effect.memoryId)
        if (!memory) return
        const origin = candidateOrigins.get(effect.memoryId)
        this.dependencies.interests.observe({
          conversationId: origin?.conversationId ?? '00000000-0000-4000-8000-000000000000',
          // The memory is the evidence here, not a message: a shared placeholder
          // id made every memory look like the same observation.
          messageId: memory.id,
          evidenceKind: 'memory',
          // The revision is what lets a later correction age this row out.
          evidenceRevision: memory.revision,
          occurredAt: origin?.occurredAt ?? at,
          topicText: memory.currentText
        })
        return
      }
      case 'morrow_interest': {
        // Morrow's own question, cited by the finding that raised it. Every gap
        // event becomes its own evidence row, so the independence count is
        // real: two separate conversations, not one aggregate observation.
        const cited = this.repository.gapEvidence(effect.topic)
          .filter((item) => effect.evidenceEventIds.length === 0 || effect.evidenceEventIds.includes(item.eventId))
        if (cited.length > 0) {
          this.dependencies.interests.observeMorrowEvidence({
            findingId: finding.id,
            topicText: effect.topic,
            evidence: cited
          })
        } else {
          // Every cited event is gone. Record the finding reference alone rather
          // than inventing support that no longer exists; the promotion gate
          // will keep it as a candidate.
          this.dependencies.interests.observeMorrow({
            conversationId: effect.conversationId || '00000000-0000-4000-8000-000000000000',
            findingId: finding.id,
            occurredAt: at,
            topicText: effect.topic
          })
        }
        this.repository.markGapEvidenceCited(effect.topic, finding.id)
        return
      }
      case 'intent_correction_candidate':
      case 'bounded_suggestion':
        // Recorded for the shell; deliberately no state change. An intent
        // correction must never overwrite what the user just said, and a
        // suggestion must never execute anything.
        this.events?.tryRecord({
          sourceModule: 'self-model',
          eventType: effect.effect === 'intent_correction_candidate'
            ? 'reflection.intent_correction_candidate'
            : 'reflection.bounded_suggestion',
          actor: 'system',
          subjectType: 'reflection_finding',
          subjectId: finding.id,
          correlationId: null,
          payload: { kind: finding.kind, confidence: finding.confidence }
        })
        return
      case 'pending_personality': {
        const expiresAt = new Date(Date.parse(at) + 14 * 24 * 3_600_000).toISOString()
        this.repository.createPendingPersonalityCandidate({
          id: this.makeId().toLowerCase(),
          findingId: finding.id,
          dimension: effect.dimension,
          direction: effect.direction,
          confidence: finding.confidence,
          evidence: finding.evidence,
          status: 'pending',
          createdAt: at,
          expiresAt
        })
        this.events?.tryRecord({
          sourceModule: 'self-model',
          eventType: 'reflection.personality_candidate_pending',
          actor: 'system',
          subjectType: 'reflection_finding',
          subjectId: finding.id,
          correlationId: null,
          payload: { dimension: effect.dimension, direction: effect.direction, expiresAt }
        })
        return
      }
      default:
        return
    }
  }
}
