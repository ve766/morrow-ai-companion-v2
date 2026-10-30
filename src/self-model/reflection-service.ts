import type { EventLogService } from '../persistence/event-log'
import type { MemoryService } from '../memory/memory-service'
import type { InterestService } from './interest-service'
import type { SelfModelService } from './self-model-service'
import { deriveInterestLabel } from './interest-service'
import type { ReflectionFinding, ReflectionFindingKind, ReflectionRunSummary, ReflectionTrigger } from './self-model-domain'

export interface ReflectionRepositoryPort {
  runsSince(trigger: ReflectionTrigger | undefined, sinceMs: number): Array<{ id: string; finished_at: string }>
  createRun(summary: ReflectionRunSummary): void
  createFinding(finding: ReflectionFinding): void
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

  createFinding(finding: ReflectionFinding): void {
    this.database.connection.prepare(`
      INSERT INTO reflection_findings(id, run_id, kind, statement, confidence, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(finding.id, finding.runId, finding.kind, finding.statement, finding.confidence, JSON.stringify(finding.evidence), finding.createdAt)
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
      findings.push({
        kind: 'bias_hint',
        statement: '多次交互被用户纠正；近期回答应更直接地承认不确定性，并减少重复已纠正的说法。',
        confidence: 50,
        evidence: negative.slice(-3).map((event) => ({ kind: 'event', id: event.id }))
      })
    }

    // 3. Consistency notes from the self model: inference entries that were
    //    never confirmed stay explicitly marked as unverified. The finding
    //    references the entry instead of quoting it: the quoted text is user
    //    content and a finding is read by the shell and may reach a log.
    const unverified = this.dependencies.selfModel.list({ status: 'active' }).filter((entry) => entry.kind === 'inference')
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
        this.dependencies.interests.observe({
          conversationId: event.correlationId ?? '00000000-0000-4000-8000-000000000000',
          // The memory is the evidence here, not a message: using a shared
          // placeholder id made every memory look like the same observation and
          // silently dropped all but the first.
          messageId: memory!.id,
          evidenceKind: 'memory',
          // The revision is what makes a later correction able to age out this
          // observation; without it the row cannot be told apart from evidence
          // recorded against the new wording.
          evidenceRevision: memory!.revision,
          occurredAt: event.occurredAt,
          topicText: memory!.currentText
        })
        candidateCreated += 1
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
    for (const finding of findings) {
      this.repository.createFinding({ ...finding, id: this.makeId().toLowerCase(), runId, createdAt: finishedAt })
    }
    this.events?.tryRecord({
      sourceModule: 'self-model',
      eventType: 'reflection.completed',
      actor: 'system',
      subjectType: 'reflection_run',
      subjectId: runId,
      correlationId: null,
      payload: { trigger, findings: findings.length, examinedEvents: examinedEvents.length }
    })
    return summary
  }
}
