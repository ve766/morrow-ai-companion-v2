import type { EventLogService } from '../persistence/event-log'
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

export interface ReflectionRepositoryPort {
  runsSince(trigger: ReflectionTrigger | undefined, sinceMs: number): Array<{ id: string; finished_at: string }>
  createRun(summary: ReflectionRunSummary): void
  /** Returns false when the finding already exists (same dedupe key). */
  createFinding(finding: ReflectionFinding): boolean
  createPendingPersonalityCandidate(candidate: PendingPersonalityCandidate): void
  listPendingPersonalityCandidates(): PendingPersonalityCandidate[]
  findingsForRun(runId: string): ReflectionFinding[]
  listRuns(limit: number): ReflectionRunSummary[]
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
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      kind: row.kind as ReflectionFindingKind,
      statement: row.statement,
      confidence: row.confidence,
      evidence: JSON.parse(row.evidence_json) as ReflectionFinding['evidence'],
      createdAt: row.created_at
    }))
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
const MAX_MEMORY_EVENTS_EXAMINED = 200

export interface ReflectionDependencies {
  memories: MemoryService
  interests: InterestService
  selfModel: SelfModelService
  events: EventLogService
}

export class ReflectionService {
  constructor(
    private readonly repository: ReflectionRepositoryPort,
    private readonly dependencies: ReflectionDependencies,
    private readonly events: EventLogService | undefined = dependencies.events,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID()
  ) {}

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
    const examinedEvents = this.dependencies.events.list({ limit: MAX_MEMORY_EVENTS_EXAMINED, ascending: true })
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
    //    At most one per run, and only from independent conversations.
    if (findings.length < MAX_FINDINGS_PER_RUN) {
      const gaps = examinedEvents.filter((event) => event.eventType === 'cognition.knowledge_gap')
      const byLabel = new Map<string, { label: string; conversations: Set<string>; eventIds: string[] }>()
      for (const event of gaps) {
        const label = typeof event.payload.label === 'string' ? event.payload.label.trim() : ''
        const conversationId = event.correlationId
        if (!label || !conversationId) continue
        const key = label.toLocaleLowerCase()
        const entry = byLabel.get(key) ?? { label, conversations: new Set<string>(), eventIds: [] }
        entry.conversations.add(conversationId)
        entry.eventIds.push(event.id)
        byLabel.set(key, entry)
      }
      // A question artefact ("哪里", "到哪") is not a topic. Without this filter
      // the producer would turn every unanswerable question into a nonsense
      // interest, which is worse than staying silent.
      const recurring = [...byLabel.values()].filter((entry) =>
        entry.conversations.size >= 2 &&
        entry.label.length >= 2 &&
        !/(?:哪里|哪儿|什么|哪个|怎么|多少|来着|到哪|上次说|记不记得)/u.test(entry.label)
      )
      const chosen = recurring[0]
      if (chosen) {
        findings.push({
          kind: 'morrow_interest_candidate',
          statement: `我对「${chosen.label}」一直没有可靠的理解；这是我自己想弄明白的问题，不是用户反复提到的偏好。`,
          confidence: 45,
          evidence: [
            { kind: 'topic', id: chosen.label },
            { kind: 'conversation', id: [...chosen.conversations][0]! },
            ...chosen.eventIds.slice(-3).map((id) => ({ kind: 'event', id }))
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
    this.repository.createRun(summary)

    // Evidence validity is decided once, from records that exist right now: a
    // finding whose source was retracted or deleted in the meantime must not
    // produce an effect, and must not be silently stored as if it had.
    const eventIds = new Set(examinedEvents.map((event) => event.id))
    const memoryIds = new Set(this.dependencies.memories.list().map((record) => record.id))
    const entryIds = new Set(this.dependencies.selfModel.list({ status: 'active' }).map((entry) => entry.id))
    const check: EvidenceCheck = {
      isValid: (ref) => {
        if (ref.kind === 'event') return eventIds.has(ref.id)
        if (ref.kind === 'memory') return memoryIds.has(ref.id)
        if (ref.kind === 'self_model_entry') return entryIds.has(ref.id)
        return false
      }
    }

    let stored = 0
    let duplicates = 0
    const rejected: Array<{ kind: ReflectionFindingKind; reason: string }> = []
    const effects: string[] = []
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
      // INSERT OR IGNORE on the dedupe key: the row is the idempotency boundary,
      // and the effect only runs when the row is new.
      if (!this.repository.createFinding(finding)) {
        duplicates += 1
        continue
      }
      stored += 1
      effects.push(effect.effect)
      this.applyEffect(finding, effect, candidateOrigins, finishedAt)
    }

    this.events?.tryRecord({
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
        examinedEvents: examinedEvents.length
      }
    })
    return summary
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
        // Morrow's own question, cited by the finding that raised it. The
        // conversation comes from the finding's evidence so the independence
        // count is real: two separate conversations, not two rows in one.
        this.dependencies.interests.observeMorrow({
          conversationId: effect.conversationId,
          findingId: finding.id,
          occurredAt: at,
          topicText: effect.topic
        })
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
