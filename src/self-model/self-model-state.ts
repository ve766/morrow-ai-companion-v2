/**
 * Structured, append-only self-model state (Issue #63 A/B).
 *
 * This is deliberately not a second personality prompt. A state is a claim
 * with an origin, evidence references, scope and revision. User-stated
 * preferences stay labelled `user_explicit`; model guesses stay
 * `model_inference` / `model_proposed_candidate` until a user confirms them.
 */
import type { EventLogService } from '../persistence/event-log'

export const SELF_MODEL_STATE_TYPES = ['claim', 'preference', 'value', 'boundary', 'capability', 'uncertainty', 'focus', 'experience'] as const
export type SelfModelStateType = typeof SELF_MODEL_STATE_TYPES[number]
export const SELF_MODEL_ORIGINS = ['user_explicit', 'retrieved_memory', 'model_inference', 'system_constraint', 'model_proposed_candidate', 'unknown'] as const
export type SelfModelOrigin = typeof SELF_MODEL_ORIGINS[number]
export const SELF_MODEL_STANCES = ['support', 'oppose', 'neutral', 'uncertain'] as const
export type SelfModelStance = typeof SELF_MODEL_STANCES[number]
export const SELF_MODEL_STATE_STATUSES = ['candidate', 'active', 'weakened', 'conflict_pending', 'rejected', 'superseded', 'retracted'] as const
export type SelfModelStateStatus = typeof SELF_MODEL_STATE_STATUSES[number]

export interface SelfModelEvidenceRef {
  kind: 'message' | 'memory' | 'reflection' | 'system'
  id: string
}

export interface SelfModelState {
  id: string
  type: SelfModelStateType
  proposition: string
  stance: SelfModelStance
  confidence: number
  evidenceRefs: SelfModelEvidenceRef[]
  origin: SelfModelOrigin
  scope: string
  revision: number
  supersedes: string | null
  status: SelfModelStateStatus
  rationale: string
  sourceMessageId: string | null
  conversationId: string | null
  createdAt: string
  updatedAt: string
}

export interface SelfModelStateRepositoryPort {
  all(): SelfModelState[]
  create(record: SelfModelState): void
  supersede(id: string, byId: string, updatedAt: string): void
  updateStatus(id: string, status: SelfModelStateStatus, updatedAt: string): void
  transaction?<T>(operation: () => T): T
}

interface StateRow {
  id: string
  type: string
  proposition: string
  stance: string
  confidence: number
  evidence_json: string
  origin: string
  scope: string
  revision: number
  supersedes: string | null
  status: string
  rationale: string
  source_message_id: string | null
  conversation_id: string | null
  created_at: string
  updated_at: string
}

function mapRow(row: StateRow): SelfModelState {
  return {
    id: row.id,
    type: row.type as SelfModelStateType,
    proposition: row.proposition,
    stance: row.stance as SelfModelStance,
    confidence: row.confidence,
    evidenceRefs: JSON.parse(row.evidence_json) as SelfModelEvidenceRef[],
    origin: row.origin as SelfModelOrigin,
    scope: row.scope,
    revision: row.revision,
    supersedes: row.supersedes,
    status: row.status as SelfModelStateStatus,
    rationale: row.rationale,
    sourceMessageId: row.source_message_id,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class SqliteSelfModelStateRepository implements SelfModelStateRepositoryPort {
  constructor(private readonly database: import('../persistence/database').SqliteDatabase) {}

  all(): SelfModelState[] {
    const rows = this.database.connection.prepare('SELECT * FROM self_model_states ORDER BY updated_at DESC, id').all() as unknown as StateRow[]
    return rows.map(mapRow)
  }

  create(record: SelfModelState): void {
    this.database.connection.prepare(`
      INSERT INTO self_model_states(id, type, proposition, stance, confidence, evidence_json, origin, scope, revision, supersedes, status, rationale, source_message_id, conversation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.type, record.proposition, record.stance, record.confidence, JSON.stringify(record.evidenceRefs), record.origin, record.scope, record.revision, record.supersedes, record.status, record.rationale, record.sourceMessageId, record.conversationId, record.createdAt, record.updatedAt)
  }

  supersede(id: string, byId: string, updatedAt: string): void {
    this.database.connection.prepare(
      'UPDATE self_model_states SET status = ?, supersedes = ?, updated_at = ? WHERE id = ?'
    ).run('superseded', byId, updatedAt, id)
  }

  updateStatus(id: string, status: SelfModelStateStatus, updatedAt: string): void {
    this.database.connection.prepare('UPDATE self_model_states SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id)
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)
  }
}

const SOURCE_RELIABILITY: Record<SelfModelOrigin, number> = {
  user_explicit: 1,
  system_constraint: 0.95,
  retrieved_memory: 0.72,
  model_proposed_candidate: 0.55,
  model_inference: 0.5,
  unknown: 0.2
}

// Fixed before evaluation; changing them requires a new algorithm version and
// a fresh ablation run. They are ordering heuristics, not probabilities.
export const SELF_MODEL_WEIGHTS = Object.freeze({ evidence: 0.35, repetition: 0.2, source: 0.2, consistency: 0.15, conflict: 0.1 })
export const SELF_MODEL_THRESHOLDS = Object.freeze({ active: 0.55, candidate: 0.4, revise: 0.62, reviseEvidence: 0.8 })

export interface SelfModelCandidate {
  type: SelfModelStateType
  proposition: string
  stance: SelfModelStance
  origin: SelfModelOrigin
  scope: string
  evidenceRefs: SelfModelEvidenceRef[]
  sourceMessageId?: string | null
  conversationId?: string | null
  rationale?: string
}

export interface SelfModelScore {
  score: number
  confidence: number
  components: { evidence: number; repetition: number; source: number; consistency: number; conflict: number }
  decision: 'reinforce' | 'weaken' | 'revise' | 'conflict_pending' | 'activate' | 'candidate' | 'reject'
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function tokens(value: string): Set<string> {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  const output = new Set<string>()
  for (const token of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) if (token.length > 1) output.add(token)
  return output
}

const STANCE_WORDS = /我|更|最|比较|很|非常|特别|喜欢|爱|偏好|讨厌|不喜欢|厌恶|重视|看重|在意|不|想|要|会|能|擅长/gu

function propositionCore(value: string): string {
  return normalize(value).replace(STANCE_WORDS, '')
}

function propositionSimilarity(left: string, right: string): number {
  const a = tokens(left)
  const b = tokens(right)
  if (a.size > 0 && b.size > 0) {
    let shared = 0
    for (const token of a) if (b.has(token)) shared += 1
    if (shared / Math.max(a.size, b.size) >= 0.6) return shared / Math.max(a.size, b.size)
  }
  // Chinese statements often arrive as one long token. Compare the object
  // after removing the stance frame (更喜欢/讨厌/不擅长...), so "我更喜欢安静"
  // and "我讨厌安静" are recognized as the same proposition with opposite stance.
  const coreLeft = propositionCore(left)
  const coreRight = propositionCore(right)
  if (coreLeft === coreRight && coreLeft.length > 0) return 1
  const bigrams = (value: string): Set<string> => {
    const characters = Array.from(value)
    const output = new Set<string>()
    for (let index = 0; index < characters.length - 1; index += 1) output.add(characters[index]! + characters[index + 1]!)
    return output
  }
  const ba = bigrams(coreLeft)
  const bb = bigrams(coreRight)
  if (ba.size === 0 || bb.size === 0) return 0
  let shared = 0
  for (const token of ba) if (bb.has(token)) shared += 1
  return shared / Math.max(ba.size, bb.size)
}

export function scoreSelfModelCandidate(candidate: SelfModelCandidate, prior: SelfModelState | null): SelfModelScore {
  const source = SOURCE_RELIABILITY[candidate.origin]
  const evidence = Math.min(1, 0.5 + 0.1 * candidate.evidenceRefs.length)
  const repetition = 1 - Math.exp(-candidate.evidenceRefs.length / 2)
  const priorSame = prior !== null && propositionSimilarity(prior.proposition, candidate.proposition) >= 0.6
  const consistency = priorSame && prior.stance === candidate.stance ? 1 : priorSame ? 0 : 0.5
  const conflict = priorSame && prior.stance !== candidate.stance ? 0.7 : 0
  const raw = SELF_MODEL_WEIGHTS.evidence * evidence + SELF_MODEL_WEIGHTS.repetition * repetition + SELF_MODEL_WEIGHTS.source * source + SELF_MODEL_WEIGHTS.consistency * consistency - SELF_MODEL_WEIGHTS.conflict * conflict
  const score = Math.max(0, Math.min(1, raw))
  const confidence = Math.max(1, Math.min(100, Math.round(score * 100)))
  const decision = priorSame
    ? prior.stance === candidate.stance
      ? score >= 0.5 ? 'reinforce' : 'weaken'
      : score >= SELF_MODEL_THRESHOLDS.revise && evidence >= SELF_MODEL_THRESHOLDS.reviseEvidence
        ? 'revise'
        : 'conflict_pending'
    : score >= SELF_MODEL_THRESHOLDS.active
      ? (candidate.origin === 'user_explicit' || candidate.origin === 'system_constraint' ? 'activate' : 'candidate')
      : score >= SELF_MODEL_THRESHOLDS.candidate ? 'candidate' : 'reject'
  return { score, confidence, components: { evidence, repetition, source, consistency, conflict }, decision }
}

/**
 * Deterministic extraction for explicit user statements only. The extractor
 * deliberately does not infer a preference from behaviour; a model-proposed
 * candidate must arrive through `propose` with its own origin and evidence.
 */
export function deriveSelfModelCandidates(text: string, evidenceRefs: SelfModelEvidenceRef[]): SelfModelCandidate[] {
  const candidates: SelfModelCandidate[] = []
  const sentences = text
    .split(/[。！？!?；;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && sentence.length <= 4000)
  const push = (type: SelfModelStateType, stance: SelfModelStance, sentence: string): void => {
    const proposition = sentence.slice(0, 4000)
    const key = `${type}:${stance}:${normalize(proposition)}`
    if (candidates.some((candidate) => `${candidate.type}:${candidate.stance}:${normalize(candidate.proposition)}` === key)) return
    candidates.push({ type, proposition, stance, origin: 'user_explicit', scope: 'user', evidenceRefs: [...evidenceRefs] })
  }
  for (const sentence of sentences) {
    if (/我(?:更|最|比较|很|非常|特别)?(?:不喜欢|讨厌|厌恶)/u.test(sentence)) push('preference', 'oppose', sentence)
    else if (/我(?:更|最|比较|很|非常|特别)?(?:喜欢|爱|偏好|重视|看重|在意)/u.test(sentence)) push('preference', 'support', sentence)
    else if (/我(?:不想|不要|不接受|不允许|不能接受)/u.test(sentence)) push('boundary', 'oppose', sentence)
    else if (/我(?:不)?(?:会|能|擅长|不擅长)/u.test(sentence)) push('capability', /不(?:会|能|擅长)/u.test(sentence) ? 'oppose' : 'support', sentence)
    else if (/我(?:认为|觉得|相信|意识到)/u.test(sentence)) push('claim', 'neutral', sentence)
  }
  return candidates
}

export class SelfModelStateService {
  constructor(
    private readonly repository: SelfModelStateRepositoryPort,
    private readonly events: EventLogService | undefined,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID()
  ) {}

  listActive(limit = 8): SelfModelState[] {
    return this.repository.all()
      .filter((state) => state.status === 'active' || state.status === 'weakened')
      .sort((left, right) => right.confidence - left.confidence || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(1, limit))
  }

  history(type?: SelfModelStateType, scope?: string): SelfModelState[] {
    return this.repository.all()
      .filter((state) => (type ? state.type === type : true))
      .filter((state) => (scope ? state.scope === scope : true))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.revision - left.revision)
  }

  propose(candidate: SelfModelCandidate): { state: SelfModelState; score: SelfModelScore; prior: SelfModelState | null } {
    if (candidate.proposition.trim().length === 0 || candidate.proposition.length > 4000 || candidate.proposition.includes('\u0000')) throw new TypeError('Self-model proposition is invalid.')
    if (candidate.evidenceRefs.length === 0) throw new TypeError('Self-model candidate needs at least one evidence reference.')
    const at = this.safeTimestamp(this.clock())
    // Outbox replay after a partial failure must not create a second revision
    // for the same source message.
    const duplicate = candidate.sourceMessageId
      ? this.repository.all().find((state) => state.sourceMessageId === candidate.sourceMessageId && state.type === candidate.type && state.scope === candidate.scope && propositionSimilarity(state.proposition, candidate.proposition) >= 0.6)
      : undefined
    if (duplicate) return { state: duplicate, score: scoreSelfModelCandidate(candidate, duplicate), prior: null }
    const prior = this.repository.all()
      .filter((state) => state.scope === candidate.scope && state.type === candidate.type)
      .filter((state) => state.status === 'active' || state.status === 'weakened' || state.status === 'conflict_pending')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .find((state) => propositionSimilarity(state.proposition, candidate.proposition) >= 0.6) ?? null
    const score = scoreSelfModelCandidate(candidate, prior)
    const status: SelfModelStateStatus = score.decision === 'reject'
      ? 'rejected'
      : score.decision === 'conflict_pending'
        ? 'conflict_pending'
        : score.decision === 'weaken'
          ? 'weakened'
          : score.decision === 'candidate'
            ? 'candidate'
            : 'active'
    const revision = prior ? prior.revision + 1 : 1
    const state: SelfModelState = {
      id: this.makeId().toLowerCase(),
      type: candidate.type,
      proposition: candidate.proposition.trim(),
      stance: candidate.stance,
      confidence: score.confidence,
      evidenceRefs: candidate.evidenceRefs,
      origin: candidate.origin,
      scope: candidate.scope,
      revision,
      supersedes: prior && score.decision !== 'conflict_pending' ? prior.id : null,
      status,
      rationale: candidate.rationale ?? `${score.decision}; score=${score.score.toFixed(3)}`,
      sourceMessageId: candidate.sourceMessageId ?? null,
      conversationId: candidate.conversationId ?? null,
      createdAt: at,
      updatedAt: at
    }
    const write = (): void => {
      this.repository.create(state)
      if (prior && score.decision !== 'conflict_pending') this.repository.supersede(prior.id, state.id, at)
    }
    if (this.repository.transaction) this.repository.transaction(write)
    else write()
    this.events?.tryRecord({
      sourceModule: 'self-model',
      eventType: 'selfmodel.state.revised',
      actor: 'system',
      subjectType: 'self_model_state',
      subjectId: state.id,
      correlationId: candidate.sourceMessageId ?? null,
      payload: { type: state.type, origin: state.origin, stance: state.stance, confidence: state.confidence, revised: revision, decision: score.decision, prior: prior?.id ?? null }
    })
    return { state, score, prior }
  }

  retract(id: string): boolean {
    const state = this.repository.all().find((entry) => entry.id === id && entry.status !== 'retracted')
    if (!state) return false
    this.repository.updateStatus(id, 'retracted', this.safeTimestamp(this.clock()))
    return true
  }

  private safeTimestamp(value: string): string {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) throw new TypeError('Self-model timestamp is invalid.')
    return new Date(parsed).toISOString()
  }
}
