/**
 * Bounded, persistent internal cognition workspace (Issue #67 §5).
 *
 * This is not a background "consciousness". It is a small thought ledger:
 * unresolved questions produced by Morrow's own failed grounding become
 * thought items; a low-frequency local review turns them into Morrow-owned
 * candidates/states only when independent evidence agrees. Nothing here calls
 * a cloud provider, executes tools, or changes permissions.
 */
import type { EventLogService } from '../persistence/event-log'

export const INNER_COGNITION_VERSION = 'inner-cognition-v1'
export const THOUGHT_TRIGGER = 'assistant_uncertainty' as const

export interface ThoughtEvidence {
  turnId: string
  conversationId: string
  messageId: string
  occurredAt: string
  kind: 'turn' | 'reflection'
  ref: string
}

export interface MorrowThought {
  id: string
  actor: 'morrow'
  trigger: string
  question: string
  hypothesis: string
  evidenceRefs: ThoughtEvidence[]
  counterEvidenceRefs: ThoughtEvidence[]
  uncertainty: number
  priority: number
  status: 'open' | 'reviewed' | 'candidate' | 'promoted' | 'dormant' | 'closed'
  createdAt: string
  updatedAt: string
  nextReviewAt: string | null
  algorithmVersion: string
}

export interface MorrowSelfState {
  id: string
  actor: 'morrow' | 'user' | 'shared' | 'system'
  domain: 'interest' | 'stance' | 'value' | 'preference' | 'question' | 'pattern'
  proposition: string
  stance: 'support' | 'oppose' | 'uncertain'
  evidenceRefs: ThoughtEvidence[]
  counterEvidenceRefs: ThoughtEvidence[]
  independentContexts: number
  score: number
  status: 'candidate' | 'active' | 'weakened' | 'conflict_pending' | 'rejected' | 'superseded' | 'retracted'
  revision: number
  supersedes: string | null
  rationale: string
  algorithmVersion: string
  createdAt: string
  updatedAt: string
}

export interface InnerCognitionRepositoryPort {
  allThoughts(): MorrowThought[]
  createThought(thought: MorrowThought): void
  updateThought(id: string, status: MorrowThought['status'], nextReviewAt: string | null, priority: number, updatedAt: string): void
  updateThoughtEvidence?(id: string, evidenceJson: string, counterJson: string, updatedAt: string): void
  allStates(): MorrowSelfState[]
  createState(state: MorrowSelfState): void
  supersedeState(id: string, byId: string, updatedAt: string): void
  transaction?<T>(operation: () => T): T
}

interface ThoughtRow {
  id: string; actor: string; trigger: string; question: string; hypothesis: string; evidence_json: string; counter_evidence_json: string; uncertainty: number; priority: number; status: string; created_at: string; updated_at: string; next_review_at: string | null; algorithm_version: string
}
interface StateRow {
  id: string; actor: string; domain: string; proposition: string; stance: string; evidence_json: string; counter_evidence_json: string; independent_contexts: number; score: number; status: string; revision: number; supersedes: string | null; rationale: string; algorithm_version: string; created_at: string; updated_at: string
}

function thoughtRow(row: ThoughtRow): MorrowThought {
  return { id: row.id, actor: 'morrow', trigger: row.trigger, question: row.question, hypothesis: row.hypothesis, evidenceRefs: JSON.parse(row.evidence_json), counterEvidenceRefs: JSON.parse(row.counter_evidence_json), uncertainty: row.uncertainty, priority: row.priority, status: row.status as MorrowThought['status'], createdAt: row.created_at, updatedAt: row.updated_at, nextReviewAt: row.next_review_at, algorithmVersion: row.algorithm_version }
}
function stateRow(row: StateRow): MorrowSelfState {
  return { id: row.id, actor: row.actor as MorrowSelfState['actor'], domain: row.domain as MorrowSelfState['domain'], proposition: row.proposition, stance: row.stance as MorrowSelfState['stance'], evidenceRefs: JSON.parse(row.evidence_json), counterEvidenceRefs: JSON.parse(row.counter_evidence_json), independentContexts: row.independent_contexts, score: row.score, status: row.status as MorrowSelfState['status'], revision: row.revision, supersedes: row.supersedes, rationale: row.rationale, algorithmVersion: row.algorithm_version, createdAt: row.created_at, updatedAt: row.updated_at }
}

export class SqliteInnerCognitionRepository implements InnerCognitionRepositoryPort {
  constructor(private readonly database: import('../persistence/database').SqliteDatabase) {}
  allThoughts(): MorrowThought[] {
    return (this.database.connection.prepare('SELECT * FROM morrow_thoughts ORDER BY priority DESC, created_at DESC').all() as unknown as ThoughtRow[]).map(thoughtRow)
  }
  createThought(thought: MorrowThought): void {
    this.database.connection.prepare(`INSERT INTO morrow_thoughts(id, actor, trigger, question, hypothesis, evidence_json, counter_evidence_json, uncertainty, priority, status, created_at, updated_at, next_review_at, algorithm_version) VALUES (?, 'morrow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(thought.id, thought.trigger, thought.question, thought.hypothesis, JSON.stringify(thought.evidenceRefs), JSON.stringify(thought.counterEvidenceRefs), thought.uncertainty, thought.priority, thought.status, thought.createdAt, thought.updatedAt, thought.nextReviewAt, thought.algorithmVersion)
  }
  updateThought(id: string, status: MorrowThought['status'], nextReviewAt: string | null, priority: number, updatedAt: string): void {
    this.database.connection.prepare('UPDATE morrow_thoughts SET status = ?, next_review_at = ?, priority = ?, updated_at = ? WHERE id = ?').run(status, nextReviewAt, priority, updatedAt, id)
  }
  updateThoughtEvidence(id: string, evidenceJson: string, counterJson: string, updatedAt: string): void {
    this.database.connection.prepare('UPDATE morrow_thoughts SET evidence_json = ?, counter_evidence_json = ?, updated_at = ? WHERE id = ?').run(evidenceJson, counterJson, updatedAt, id)
  }
  allStates(): MorrowSelfState[] {
    return (this.database.connection.prepare('SELECT * FROM morrow_self_states ORDER BY updated_at DESC').all() as unknown as StateRow[]).map(stateRow)
  }
  createState(state: MorrowSelfState): void {
    this.database.connection.prepare(`INSERT INTO morrow_self_states(id, actor, domain, proposition, stance, evidence_json, counter_evidence_json, independent_contexts, score, status, revision, supersedes, rationale, algorithm_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(state.id, state.actor, state.domain, state.proposition, state.stance, JSON.stringify(state.evidenceRefs), JSON.stringify(state.counterEvidenceRefs), state.independentContexts, state.score, state.status, state.revision, state.supersedes, state.rationale, state.algorithmVersion, state.createdAt, state.updatedAt)
  }
  supersedeState(id: string, byId: string, updatedAt: string): void {
    this.database.connection.prepare('UPDATE morrow_self_states SET status = ?, supersedes = ?, updated_at = ? WHERE id = ?').run('superseded', byId, updatedAt, id)
  }
  transaction<T>(operation: () => T): T { return this.database.transaction(operation) }
}

const UNCERTAINTY_MARKERS = /(?:不知道|不确定|无法确认|不清楚|不能确定|没有.{0,16}(?:记录|信息|线索|证据)|not sure|don't know|no (?:record|information|evidence))/iu

function independentContexts(refs: ThoughtEvidence[]): number {
  return new Set(refs.map((ref) => ref.conversationId)).size
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function overlap(left: string, right: string): number {
  const a = new Set(normalized(left).match(/[\p{L}\p{N}]+/gu) ?? [])
  const b = new Set(normalized(right).match(/[\p{L}\p{N}]+/gu) ?? [])
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / Math.max(a.size, b.size)
}

export interface InnerCognitionTurn {
  turnId: string
  conversationId: string
  userMessageId: string
  occurredAt: string
  content: string
  reply: string
  analysisIntent?: string
  predictionError?: boolean
  conflict?: boolean
}

export class InnerCognitionService {
  constructor(
    private readonly repository: InnerCognitionRepositoryPort,
    private readonly events: EventLogService | undefined,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID()
  ) {}

  /** Only unresolved/uncertain replies become thoughts; ordinary turns do not. */
  observeTurn(input: InnerCognitionTurn): MorrowThought | null {
    const at = this.safeTimestamp(input.occurredAt)
    const replyUncertain = UNCERTAINTY_MARKERS.test(input.reply)
    const correction = input.analysisIntent === 'correction' || input.conflict === true
    const predictionError = input.predictionError === true
    if (!replyUncertain && !correction && !predictionError) return null
    const question = this.deriveQuestion(input)
    const similar = this.repository.allThoughts().filter((thought) => overlap(thought.question, question) >= 0.6 || thought.evidenceRefs.some((ref) => ref.turnId === input.turnId))
    const recurrence = Math.min(1, similar.length / 3)
    const novelty = 1 - recurrence
    const uncertainty = replyUncertain ? 0.8 : predictionError ? 0.65 : 0.5
    const relevance = input.analysisIntent ? 0.75 : 0.5
    const importance = 0.6
    const risk = 0
    const priority = Math.max(0, Math.min(1, 0.3 * uncertainty + 0.25 * novelty + 0.2 * recurrence + 0.15 * relevance + 0.1 * importance - 0.2 * risk))
    const evidence: ThoughtEvidence = { turnId: input.turnId, conversationId: input.conversationId, messageId: input.userMessageId, occurredAt: at, kind: 'turn', ref: input.turnId }
    // A repeated question across independent conversations inherits the earlier
    // evidence refs; a repeat in the same conversation is deduplicated, so it
    // cannot pretend to be independent support.
    const inherited = similar.flatMap((entry) => entry.evidenceRefs)
    const evidenceRefs = [...inherited, evidence].filter((ref, index, all) => all.findIndex((candidate) => candidate.turnId === ref.turnId && candidate.messageId === ref.messageId) === index)
    const thought: MorrowThought = {
      id: this.makeId().toLowerCase(), actor: 'morrow', trigger: predictionError ? 'prediction_error' : correction ? 'user_correction' : THOUGHT_TRIGGER,
      question: question.slice(0, 1000), hypothesis: `我还不确定：${question.slice(0, 900)}`, evidenceRefs, counterEvidenceRefs: [],
      uncertainty: Math.round(uncertainty * 100), priority: Math.round(priority * 1000) / 1000, status: 'open', createdAt: at, updatedAt: at,
      nextReviewAt: new Date(Date.parse(at) + 60_000).toISOString(), algorithmVersion: INNER_COGNITION_VERSION
    }
    const write = (): void => { this.repository.createThought(thought); }
    if (this.repository.transaction) this.repository.transaction(write); else write()
    this.events?.tryRecord({ sourceModule: 'cognition', eventType: 'inner.thought.created', actor: 'system', subjectType: 'morrow_thought', subjectId: thought.id, correlationId: input.turnId, payload: { trigger: thought.trigger, priority: thought.priority, uncertainty: thought.uncertainty } })
    this.reviewThought(thought.id, at)
    return thought
  }

  /** Low-frequency local maintenance. No provider call, no external side effect. */
  reviewDue(now = this.clock(), limit = 3): MorrowSelfState[] {
    const at = this.safeTimestamp(now)
    const due = this.repository.allThoughts()
      .filter((thought) => (thought.status === 'open' || thought.status === 'reviewed') && (thought.nextReviewAt === null || thought.nextReviewAt <= at))
      .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt))
      .slice(0, Math.max(1, limit))
    return due.flatMap((thought) => {
      const reviewed = this.reviewThought(thought.id, at)
      return reviewed ? [reviewed] : []
    })
  }

  private reviewThought(id: string, at: string): MorrowSelfState | null {
    const thought = this.repository.allThoughts().find((entry) => entry.id === id)
    if (!thought) return null
    const independent = independentContexts(thought.evidenceRefs)
    const uniqueRefs = [...new Map(thought.evidenceRefs.map((ref) => [`${ref.turnId}:${ref.messageId}`, ref])).values()]
    const evidenceQuality = Math.min(1, 0.45 + 0.15 * Math.min(2, independent) + 0.1 * Math.min(1, uniqueRefs.length / 4))
    const recency = 0.8
    // Uncertainty belongs to exploration priority, not belief confidence. A
    // single source cannot be promoted just because Morrow is unsure.
    const score = Math.max(0, Math.min(100, Math.round(100 * (0.50 * evidenceQuality + 0.25 * Math.min(1, independent / 2) + 0.15 * recency - 0.20 * (thought.counterEvidenceRefs.length > 0 ? 1 : 0)))))
    const prior = this.repository.allStates().find((state) => state.actor === 'morrow' && state.status !== 'superseded' && state.status !== 'retracted' && overlap(state.proposition, thought.question) >= 0.6) ?? null
    const status: MorrowSelfState['status'] = thought.counterEvidenceRefs.length > 0
      ? prior && prior.status === 'active' ? 'weakened' : 'conflict_pending'
      : independent >= 2 && score >= 55
        ? 'active'
        : 'candidate'
    const state: MorrowSelfState = {
      id: this.makeId().toLowerCase(), actor: 'morrow', domain: status === 'active' && thought.priority >= 0.6 ? 'interest' : 'question', proposition: thought.question.slice(0, 1000), stance: 'uncertain',
      evidenceRefs: thought.evidenceRefs, counterEvidenceRefs: thought.counterEvidenceRefs, independentContexts: independent, score,
      status, revision: prior ? prior.revision + 1 : 1, supersedes: prior ? prior.id : null,
      rationale: `thought_review independent=${independent} score=${score} status=${status}`, algorithmVersion: INNER_COGNITION_VERSION,
      createdAt: at, updatedAt: at
    }
    const write = (): void => {
      this.repository.createState(state)
      if (prior) this.repository.supersedeState(prior.id, state.id, at)
      this.repository.updateThought(thought.id, status === 'active' ? 'promoted' : status === 'conflict_pending' ? 'reviewed' : 'candidate', status === 'active' ? null : new Date(Date.parse(at) + 6 * 60 * 60 * 1000).toISOString(), thought.priority, at)
    }
    if (this.repository.transaction) this.repository.transaction(write); else write()
    this.events?.tryRecord({ sourceModule: 'cognition', eventType: 'inner.thought.reviewed', actor: 'system', subjectType: 'morrow_thought', subjectId: thought.id, correlationId: null, payload: { stateId: state.id, status, independent, score } })
    return state
  }

  /** Bounded context for the next real turn. User preferences are never read as Morrow's. */
  contextBlock(query: string, limit = 3): string {
    const queryTerms = new Set(normalized(query).match(/[\p{L}\p{N}]+/gu) ?? [])
    const states = this.repository.allStates()
      .filter((state) => state.actor === 'morrow' && (state.status === 'active' || state.status === 'candidate' || state.status === 'conflict_pending'))
      .filter((state) => queryTerms.size === 0 || overlap(state.proposition, query) > 0.08)
      .sort((left, right) => (right.status === 'active' ? 1 : 0) - (left.status === 'active' ? 1 : 0) || right.score - left.score)
      .slice(0, limit)
    if (states.length === 0) return ''
    const described = states.map((state) => `[${state.status}/${state.domain}] 「${state.proposition.slice(0, 160)}」（Morrow-owned，score ${state.score}/100，独立情境 ${state.independentContexts}，revision ${state.revision}）`)
    return `Morrow's own unresolved thoughts and evidence-gated states (not the user's preferences; use only as your own bounded attention, never as user facts or permission): ${described.join('; ')}.`
  }

  /**
   * Explicit counter-evidence. It can weaken an active state but cannot silently
   * delete history; the new revision is persisted with rationale.
   */
  addCounterEvidence(thoughtId: string, evidence: ThoughtEvidence, rationale = 'counter_evidence'): MorrowSelfState | null {
    const thought = this.repository.allThoughts().find((entry) => entry.id === thoughtId)
    if (!thought) return null
    const at = this.safeTimestamp(this.clock())
    const counter = [...thought.counterEvidenceRefs, evidence].filter((ref, index, all) => all.findIndex((candidate) => candidate.turnId === ref.turnId && candidate.messageId === ref.messageId) === index)
    this.repository.updateThoughtEvidence?.(thoughtId, JSON.stringify(thought.evidenceRefs), JSON.stringify(counter), at)
    return this.reviewThought(thoughtId, at)
  }

  listThoughts(limit = 20): MorrowThought[] { return this.repository.allThoughts().slice(0, limit) }
  listStates(limit = 20): MorrowSelfState[] { return this.repository.allStates().slice(0, limit) }

  private deriveQuestion(input: InnerCognitionTurn): string {
    const content = input.content.replace(/\s+/gu, ' ').trim().slice(0, 500)
    return `关于「${content.slice(0, 300)}」，我还不确定该如何可靠回答。`
  }

  private safeTimestamp(value: string): string {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) throw new TypeError('Inner cognition timestamp is invalid.')
    return new Date(parsed).toISOString()
  }
}
