/**
 * Local investigation lifecycle (Issue #81 F5).
 *
 * A thought says "I am uncertain about X". An investigation records what
 * Morrow actually did about it: which hypothesis was selected, which
 * alternatives stayed open, which sources were consulted, what contradicted
 * them, why it stopped, and what it concluded. It is a bounded local process
 * (no browser, no file operations); the value is that every step is durable,
 * versioned and re-verifiable instead of living only in a prompt.
 */
import type { SqliteDatabase } from '../persistence/database'
import type { EventLogService } from '../persistence/event-log'
import { ApplicationError } from '../shared/errors'

export const INVESTIGATION_ALGORITHM_VERSION = 'investigation-v1'

export const INVESTIGATION_STATES = [
  'discovered', 'selected', 'hypothesized', 'investigating', 'reviewing',
  'concluded', 'inconclusive', 'rejected', 'suspended'
] as const

export type InvestigationState = typeof INVESTIGATION_STATES[number]

const TRANSITIONS: Readonly<Record<InvestigationState, readonly InvestigationState[]>> = {
  discovered: ['selected', 'rejected', 'suspended'],
  selected: ['hypothesized', 'rejected', 'suspended'],
  hypothesized: ['investigating', 'rejected', 'suspended'],
  investigating: ['reviewing', 'inconclusive', 'rejected', 'suspended'],
  reviewing: ['concluded', 'inconclusive', 'rejected', 'suspended'],
  suspended: ['selected', 'investigating', 'rejected'],
  concluded: [],
  inconclusive: [],
  rejected: []
}

export interface InvestigationPriorityComponents {
  /** I: normalised information gap. */
  informationGap: number
  /** G: normalised stalled-goal pressure. */
  goalStall: number
  /** U: Morrow-owned interest relevance. */
  interestRelevance: number
  /** N: reflection novelty. */
  reflectionNovelty: number
  /** R: executability / local resource availability. */
  resourceAvailability: number
  /** C: repetition and cost penalty. */
  cost: number
}

export interface InvestigationBudget {
  maxSteps: number
  deadlineAt: string
}

export interface Investigation {
  id: string
  thoughtId: string | null
  trigger: string
  question: string
  state: InvestigationState
  stateVersion: number
  priority: number
  components: InvestigationPriorityComponents
  primaryHypothesis: string
  alternatives: string[]
  evidence: InvestigationEvidence[]
  contradictions: InvestigationEvidence[]
  confidence: number
  stopReason: string | null
  failureReason: string | null
  budget: InvestigationBudget
  createdAt: string
  updatedAt: string
  concludedAt: string | null
}

export interface InvestigationEvidence {
  sourceId: string
  kind: 'event' | 'memory' | 'self_model_entry' | 'synthetic'
  synthetic: boolean
  at: string
}

export interface InvestigationStep {
  seq: number
  investigationId: string
  from: InvestigationState | null
  to: InvestigationState
  stateVersion: number
  at: string
  sources: string[]
  result: Record<string, unknown>
  sourceValid: boolean
  failureReason: string | null
}

interface InvestigationRow {
  id: string
  thought_id: string | null
  trigger: string
  question: string
  state: InvestigationState
  state_version: number
  priority: number
  components_json: string
  primary_hypothesis: string
  alternatives_json: string
  evidence_json: string
  contradiction_json: string
  confidence: number
  stop_reason: string | null
  failure_reason: string | null
  budget_json: string
  created_at: string
  updated_at: string
  concluded_at: string | null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * P = clamp(0.20I + 0.20G + 0.20U + 0.15N + 0.15R - 0.10C, 0, 1)
 * Every input is normalised to [0,1]; the components are persisted with the
 * score so a later review can see why a topic was selected.
 */
export function investigationPriority(components: InvestigationPriorityComponents): number {
  const value =
    0.20 * clamp01(components.informationGap) +
    0.20 * clamp01(components.goalStall) +
    0.20 * clamp01(components.interestRelevance) +
    0.15 * clamp01(components.reflectionNovelty) +
    0.15 * clamp01(components.resourceAvailability) -
    0.10 * clamp01(components.cost)
  return Math.round(clamp01(value) * 1000) / 1000
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function mapRow(row: InvestigationRow): Investigation {
  return {
    id: row.id,
    thoughtId: row.thought_id,
    trigger: row.trigger,
    question: row.question,
    state: row.state,
    stateVersion: Number(row.state_version),
    priority: Number(row.priority),
    components: parseJson<InvestigationPriorityComponents>(row.components_json, {
      informationGap: 0, goalStall: 0, interestRelevance: 0, reflectionNovelty: 0, resourceAvailability: 0, cost: 1
    }),
    primaryHypothesis: row.primary_hypothesis,
    alternatives: parseJson<string[]>(row.alternatives_json, []),
    evidence: parseJson<InvestigationEvidence[]>(row.evidence_json, []),
    contradictions: parseJson<InvestigationEvidence[]>(row.contradiction_json, []),
    confidence: Number(row.confidence),
    stopReason: row.stop_reason,
    failureReason: row.failure_reason,
    budget: parseJson<InvestigationBudget>(row.budget_json, { maxSteps: 0, deadlineAt: row.created_at }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    concludedAt: row.concluded_at
  }
}

export class InvestigationService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly events?: EventLogService,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID()
  ) {}

  get available(): boolean {
    if (this.database.schemaVersion < 59 || !this.database.cognitivePersistenceAvailable) return false
    try {
      return Number(this.database.connection.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('morrow_investigations', 'morrow_investigation_steps')"
      ).get()?.count ?? 0) === 2
    } catch {
      return false
    }
  }

  /**
   * Open (and advance to `hypothesized`) one investigation for a synthesized
   * thought. User/shared-origin evidence is refused: curiosity about the user
   * is not Morrow's own investigation.
   */
  begin(input: {
    thought: {
      id: string
      trigger: string
      question: string
      hypothesis: string
      evidenceRefs: ReadonlyArray<{ origin?: string; synthetic?: boolean }>
    }
    components: InvestigationPriorityComponents
    alternatives?: string[]
    at?: string
    budget?: Partial<InvestigationBudget>
  }): Investigation {
    if (!this.available) throw new ApplicationError('STORAGE_ERROR')
    if (!input.thought.evidenceRefs.every((ref) => ref.origin === 'morrow')) {
      throw new ApplicationError('INVALID_INPUT')
    }
    const existing = this.database.connection.prepare(
      'SELECT * FROM morrow_investigations WHERE thought_id = ?'
    ).get(input.thought.id) as InvestigationRow | undefined
    if (existing) return mapRow(existing)
    const at = input.at ?? this.clock()
    const components = {
      informationGap: clamp01(input.components.informationGap),
      goalStall: clamp01(input.components.goalStall),
      interestRelevance: clamp01(input.components.interestRelevance),
      reflectionNovelty: clamp01(input.components.reflectionNovelty),
      resourceAvailability: clamp01(input.components.resourceAvailability),
      cost: clamp01(input.components.cost)
    }
    const priority = investigationPriority(components)
    const budget: InvestigationBudget = {
      maxSteps: Math.max(1, Math.min(20, input.budget?.maxSteps ?? 6)),
      deadlineAt: input.budget?.deadlineAt ?? new Date(Date.parse(at) + 24 * 3_600_000).toISOString()
    }
    const alternatives = (input.alternatives && input.alternatives.length > 0
      ? input.alternatives
      : [
          '这可能只是同一来源的重复，而不是一个独立模式。',
          '这可能是用户表达适配的问题，而不是 Morrow 自身的问题。'
        ]).map((entry) => entry.slice(0, 1000)).slice(0, 4)
    const id = this.makeId().toLowerCase()
    return this.database.transaction(() => {
      this.database.connection.prepare(`
        INSERT INTO morrow_investigations(
          id, thought_id, trigger, question, state, state_version, priority, components_json,
          primary_hypothesis, alternatives_json, evidence_json, contradiction_json, confidence,
          stop_reason, failure_reason, budget_json, created_at, updated_at, concluded_at
        ) VALUES (?, ?, ?, ?, 'discovered', 1, ?, ?, ?, ?, '[]', '[]', 0, NULL, NULL, ?, ?, ?, NULL)
      `).run(
        id,
        input.thought.id,
        input.thought.trigger.slice(0, 64),
        input.thought.question.slice(0, 1000),
        priority,
        JSON.stringify(components),
        input.thought.hypothesis.slice(0, 1000),
        JSON.stringify(alternatives),
        JSON.stringify(budget),
        at,
        at
      )
      this.transitionInTransaction(id, 'selected', { at, sources: [], reason: 'synthesis_selected' })
      this.transitionInTransaction(id, 'hypothesized', { at, sources: [], reason: 'hypotheses_recorded' })
      return this.read(id)!
    })
  }

  transition(id: string, to: InvestigationState, input: {
    at?: string
    sources?: string[]
    reason?: string
    confidence?: number
    failureReason?: string
  } = {}): Investigation {
    if (!this.available) throw new ApplicationError('STORAGE_ERROR')
    return this.database.transaction(() => {
      this.transitionInTransaction(id, to, input)
      return this.read(id)!
    })
  }

  private transitionInTransaction(id: string, to: InvestigationState, input: {
    at?: string
    sources?: string[]
    reason?: string
    confidence?: number
    failureReason?: string
  }): void {
    const current = this.read(id)
    if (!current) throw new ApplicationError('NOT_FOUND')
    if (!TRANSITIONS[current.state].includes(to)) {
      throw new ApplicationError('INVALID_INPUT')
    }
    const at = input.at ?? this.clock()
    const steps = Number(this.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM morrow_investigation_steps WHERE investigation_id = ?'
    ).get(id)?.count ?? 0)
    const terminal = to === 'concluded' || to === 'inconclusive' || to === 'rejected'
    const confidence = input.confidence === undefined ? current.confidence : clamp01(input.confidence)
    const nextVersion = current.stateVersion + 1
    const sources = [...new Set((input.sources ?? []).filter((source) => typeof source === 'string'))]
    const sourceValid = sources.every((source) => this.sourceExists(source))
    const result = { reason: input.reason ?? null, confidence, priority: current.priority }
    const changes = this.database.connection.prepare(`
      UPDATE morrow_investigations
      SET state = ?, state_version = ?, confidence = ?, stop_reason = ?, failure_reason = ?, updated_at = ?, concluded_at = ?
      WHERE id = ? AND state_version = ?
    `).run(
      to,
      nextVersion,
      confidence,
      terminal || to === 'suspended' ? input.reason ?? null : current.stopReason,
      input.failureReason ?? (sourceValid ? null : 'source_invalid'),
      at,
      terminal ? at : current.concludedAt,
      id,
      current.stateVersion
    )
    if (Number(changes.changes) !== 1) throw new ApplicationError('STORAGE_ERROR')
    this.database.connection.prepare(`
      INSERT INTO morrow_investigation_steps(
        investigation_id, from_state, to_state, state_version, at, sources_json, result_json, source_valid, failure_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      current.state,
      to,
      nextVersion,
      at,
      JSON.stringify(sources),
      JSON.stringify(result),
      sourceValid ? 1 : 0,
      input.failureReason ?? (sourceValid ? null : 'source_invalid')
    )
    this.events?.tryRecord({
      sourceModule: 'cognition',
      eventType: 'inner.investigation.transitioned',
      actor: 'system',
      subjectType: 'morrow_investigation',
      subjectId: id,
      correlationId: null,
      payload: {
        from: current.state,
        to,
        version: nextVersion,
        reason: (input.reason ?? '').slice(0, 128),
        sourceValid,
        step: steps + 1
      }
    })
  }

  /** Add verified evidence/contradiction. Missing sources are recorded as invalid, never trusted. */
  recordEvidence(id: string, input: {
    at?: string
    evidence?: Array<{ sourceId: string; kind: InvestigationEvidence['kind']; synthetic?: boolean }>
    contradictions?: Array<{ sourceId: string; kind: InvestigationEvidence['kind']; synthetic?: boolean }>
  }): { accepted: number; rejected: number } {
    if (!this.available) throw new ApplicationError('STORAGE_ERROR')
    const current = this.read(id)
    if (!current) throw new ApplicationError('NOT_FOUND')
    if (current.state !== 'investigating' && current.state !== 'hypothesized') {
      throw new ApplicationError('INVALID_INPUT')
    }
    const at = input.at ?? this.clock()
    const acceptedEvidence: InvestigationEvidence[] = []
    const acceptedContradictions: InvestigationEvidence[] = []
    let rejected = 0
    const classify = (entries: Array<{ sourceId: string; kind: InvestigationEvidence['kind']; synthetic?: boolean }> | undefined, target: InvestigationEvidence[]): void => {
      for (const entry of entries ?? []) {
        const synthetic = entry.synthetic === true || entry.kind === 'synthetic'
        if (!synthetic && !this.sourceExists(entry.sourceId)) {
          rejected += 1
          continue
        }
        target.push({ sourceId: entry.sourceId, kind: entry.kind, synthetic, at })
      }
    }
    classify(input.evidence, acceptedEvidence)
    classify(input.contradictions, acceptedContradictions)
    const evidence = [...current.evidence, ...acceptedEvidence].slice(-40)
    const contradictions = [...current.contradictions, ...acceptedContradictions].slice(-40)
    const confidence = clamp01(0.5 + 0.1 * Math.min(2, evidence.filter((entry) => !entry.synthetic).length) - 0.15 * contradictions.length)
    this.database.connection.prepare(`
      UPDATE morrow_investigations SET evidence_json = ?, contradiction_json = ?, confidence = ?, updated_at = ?, state_version = state_version + 1
      WHERE id = ?
    `).run(JSON.stringify(evidence), JSON.stringify(contradictions), confidence, at, id)
    this.database.connection.prepare(`
      INSERT INTO morrow_investigation_steps(
        investigation_id, from_state, to_state, state_version, at, sources_json, result_json, source_valid, failure_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      current.state,
      current.state,
      current.stateVersion + 1,
      at,
      JSON.stringify([...acceptedEvidence, ...acceptedContradictions].map((entry) => entry.sourceId)),
      JSON.stringify({ accepted: acceptedEvidence.length + acceptedContradictions.length, rejected, confidence }),
      rejected === 0 ? 1 : 0,
      rejected === 0 ? null : 'source_invalid'
    )
    this.events?.tryRecord({
      sourceModule: 'cognition',
      eventType: 'inner.investigation.evidence',
      actor: 'system',
      subjectType: 'morrow_investigation',
      subjectId: id,
      correlationId: null,
      payload: {
        accepted: acceptedEvidence.length + acceptedContradictions.length,
        rejected,
        synthetic: acceptedEvidence.filter((entry) => entry.synthetic).length,
        confidence
      }
    })
    return { accepted: acceptedEvidence.length + acceptedContradictions.length, rejected }
  }

  /** Close an investigation from a reviewed thought state. */
  reviewFromState(state: { proposition: string; status: string; score: number; independentContexts: number }, at = this.clock()): Investigation | null {
    if (!this.available) return null
    const open = this.database.connection.prepare(
      "SELECT * FROM morrow_investigations WHERE state IN ('discovered', 'selected', 'hypothesized', 'investigating', 'reviewing')"
    ).all() as unknown as InvestigationRow[]
    const match = open.find((row) => overlap(row.question, state.proposition) >= 0.6)
    if (!match) return null
    let current = mapRow(match)
    if (current.state === 'discovered') current = this.transition(current.id, 'selected', { at, reason: 'review' })
    if (current.state === 'selected') current = this.transition(current.id, 'hypothesized', { at, reason: 'review' })
    if (current.state === 'hypothesized') current = this.transition(current.id, 'investigating', { at, reason: 'review', sources: current.evidence.map((entry) => entry.sourceId) })
    if (current.state === 'investigating') current = this.transition(current.id, 'reviewing', { at, reason: 'thought_review' })
    const outcome: InvestigationState = state.status === 'active'
      ? 'concluded'
      : state.status === 'candidate'
        ? 'inconclusive'
        : state.status === 'weakened' || state.status === 'conflict_pending'
          ? 'rejected'
          : 'inconclusive'
    return this.transition(current.id, outcome, {
      at,
      confidence: Math.min(1, Math.max(0, state.score / 100)),
      reason: `thought:${state.status}`,
      sources: current.evidence.map((entry) => entry.sourceId)
    })
  }

  /** Suspend work that exceeded its deadline. Idempotent. */
  recover(at = this.clock()): number {
    if (!this.available) return 0
    const rows = this.database.connection.prepare(
      "SELECT * FROM morrow_investigations WHERE state IN ('discovered', 'selected', 'hypothesized', 'investigating', 'reviewing') ORDER BY updated_at"
    ).all() as unknown as InvestigationRow[]
    let suspended = 0
    for (const row of rows) {
      const investigation = mapRow(row)
      if (investigation.budget.deadlineAt >= at) continue
      this.transition(investigation.id, 'suspended', {
        at,
        reason: 'budget_exhausted',
        failureReason: 'deadline_exceeded',
        sources: investigation.evidence.map((entry) => entry.sourceId)
      })
      suspended += 1
    }
    return suspended
  }

  openCount(): number {
    if (!this.available) return 0
    return Number(this.database.connection.prepare(
      "SELECT COUNT(*) AS count FROM morrow_investigations WHERE state NOT IN ('concluded', 'inconclusive', 'rejected')"
    ).get()?.count ?? 0)
  }

  read(id: string): Investigation | null {
    if (!this.available) return null
    const row = this.database.connection.prepare('SELECT * FROM morrow_investigations WHERE id = ?').get(id) as InvestigationRow | undefined
    return row ? mapRow(row) : null
  }

  list(state?: InvestigationState, limit = 50): Investigation[] {
    if (!this.available) return []
    const rows = (state
      ? this.database.connection.prepare('SELECT * FROM morrow_investigations WHERE state = ? ORDER BY updated_at DESC LIMIT ?').all(state, limit)
      : this.database.connection.prepare('SELECT * FROM morrow_investigations ORDER BY updated_at DESC LIMIT ?').all(limit)) as unknown as InvestigationRow[]
    return rows.map(mapRow)
  }

  steps(id: string): InvestigationStep[] {
    if (!this.available) return []
    const rows = this.database.connection.prepare(
      'SELECT * FROM morrow_investigation_steps WHERE investigation_id = ? ORDER BY seq'
    ).all(id) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      seq: Number(row.seq),
      investigationId: String(row.investigation_id),
      from: row.from_state === null ? null : String(row.from_state) as InvestigationState,
      to: String(row.to_state) as InvestigationState,
      stateVersion: Number(row.state_version),
      at: String(row.at),
      sources: parseJson<string[]>(String(row.sources_json), []),
      result: parseJson<Record<string, unknown>>(String(row.result_json), {}),
      sourceValid: Number(row.source_valid) === 1,
      failureReason: row.failure_reason === null ? null : String(row.failure_reason)
    }))
  }

  private sourceExists(sourceId: string): boolean {
    if (!sourceId) return false
    try {
      if (this.database.connection.prepare('SELECT 1 AS present FROM event_journal WHERE id = ?').get(sourceId)) return true
      if (this.database.connection.prepare('SELECT 1 AS present FROM memories WHERE id = ?').get(sourceId)) return true
      if (this.database.connection.prepare('SELECT 1 AS present FROM self_model_entries WHERE id = ?').get(sourceId)) return true
      return false
    } catch {
      return false
    }
  }
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u200b\u200c\u200d]+/gu, '')
}

function overlap(left: string, right: string): number {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  let hits = 0
  const size = Math.min(a.length, b.length)
  for (let index = 0; index + 2 <= size; index += 1) {
    if (a.includes(b.slice(index, index + 2))) hits += 1
  }
  return hits / Math.max(1, size - 1)
}
