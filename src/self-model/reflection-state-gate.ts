/**
 * Reflection finding -> evidence-gated Morrow self-state (Issue #74 round 2).
 *
 * A finding is a hypothesis the system derived about itself, not a fact. This
 * bridge is deliberately separate from the route table: a finding may be a
 * useful prompt hint and still be too weak to revise a state. Only findings
 * with Morrow-owned provenance enter the gate; user-originated interests and
 * assistant self-descriptions are excluded. The gate writes append-only
 * revisions and records its decision in the event journal.
 */
import type { SqliteDatabase } from '../persistence/database'
import type { EventLogService } from '../persistence/event-log'

export const REFLECTION_STATE_GATE_VERSION = 'reflection-state-gate-v1'

export type ReflectionStateDecision = 'promoted' | 'weakened' | 'candidate' | 'rejected' | 'deferred'

export interface ReflectionStateFinding {
  findingId: string
  runId: string
  kind: string
  statement: string
  confidence: number
  createdAt: string
  rootSourceId?: string
  correlationGroupId?: string
  owner?: 'user' | 'morrow' | 'shared' | 'system'
  parentEvidenceIds?: string[]
}

interface LineageRef {
  findingId: string
  runId: string
  kind: string
  createdAt: string
  rootSourceId: string
  correlationGroupId: string
  owner: 'user' | 'morrow' | 'shared' | 'system'
  derivationKind: 'reflection'
  parentEvidenceIds: string[]
}

interface StateRow {
  id: string
  proposition: string
  evidence_json: string
  counter_evidence_json: string
  independent_contexts: number
  score: number
  status: string
  revision: number
  created_at: string
  updated_at: string
}

const ELIGIBLE = new Set(['memory_gap', 'bias_hint', 'consistency_note', 'open_question'])
const COUNTER_KINDS = new Set(['bias_hint'])

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

function refsOf(row: StateRow): LineageRef[] {
  try {
    const parsed = JSON.parse(row.evidence_json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export class ReflectionStateGate {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID(),
    private readonly events?: EventLogService
  ) {}

  /** Must be called inside the router's transaction. */
  ingestInTransaction(finding: ReflectionStateFinding): ReflectionStateDecision {
    if (!ELIGIBLE.has(finding.kind) || finding.confidence < 40) {
      this.recordDecision(finding, 'rejected', 'ineligible_kind_or_low_confidence', 0, 0)
      return 'rejected'
    }
    const existingDecision = this.decisionFor(finding.findingId)
    if (existingDecision) return existingDecision
    const rows = this.database.connection.prepare(
      "SELECT * FROM morrow_self_states WHERE actor = 'morrow' AND status NOT IN ('superseded', 'retracted') ORDER BY updated_at DESC LIMIT 40"
    ).all() as unknown as StateRow[]
    const prior = rows.find((row) => overlap(row.proposition, finding.statement) >= 0.6) ?? null
    const priorRefs = prior ? refsOf(prior) : []
    // The lineage root is the original event/message, not the random reflection
    // run id. A hundred reruns over the same original source therefore collapse
    // to one root/cluster.
    let rawRefs: Array<{ id?: unknown }> = []
    try {
      const row = this.database.connection.prepare('SELECT evidence_json FROM reflection_findings WHERE id = ?').get(finding.findingId) as { evidence_json: string } | undefined
      const parsed = row ? JSON.parse(row.evidence_json) : []
      rawRefs = Array.isArray(parsed) ? parsed.filter((item): item is { id?: unknown } => Boolean(item) && typeof item === 'object') : []
    } catch {
      rawRefs = []
    }
    const rawIds = rawRefs.map((ref) => typeof ref.id === 'string' ? ref.id : null).filter((id): id is string => Boolean(id))
    const rootSourceId = finding.rootSourceId ?? rawIds[0] ?? finding.findingId
    const correlationGroupId = finding.correlationGroupId ?? rootSourceId
    const owner = finding.owner ?? 'morrow'
    const newRef: LineageRef = {
      findingId: finding.findingId,
      runId: finding.runId,
      kind: finding.kind,
      createdAt: finding.createdAt,
      rootSourceId,
      correlationGroupId,
      owner,
      derivationKind: 'reflection',
      parentEvidenceIds: finding.parentEvidenceIds ?? (rawIds.length > 0 ? rawIds : [rootSourceId])
    }
    const evidenceRefs = [...priorRefs, newRef]
      .filter((ref, index, all) => all.findIndex((candidate) => candidate.findingId === ref.findingId) === index)
    const independent = new Set(evidenceRefs.map((ref) => ref.correlationGroupId)).size
    const counter = COUNTER_KINDS.has(finding.kind) && prior?.status === 'active'
    const score = Math.max(0, Math.min(100, Math.round(0.50 * finding.confidence + 30 * Math.min(1, independent / 2) + (counter ? -20 : 5))))
    const status = counter
      ? 'weakened'
      : independent >= 2 && score >= 55
        ? 'active'
        : 'candidate'
    const decision: ReflectionStateDecision = status === 'active' ? 'promoted' : status === 'weakened' ? 'weakened' : 'candidate'
    const at = this.clock()
    const revision = prior ? prior.revision + 1 : 1
    const stateId = this.makeId().toLowerCase()
    const counterRefs = counter
      ? [...(prior?.counter_evidence_json ? JSON.parse(prior.counter_evidence_json) : []), {
          findingId: finding.findingId, runId: finding.runId, kind: finding.kind, createdAt: finding.createdAt
        }]
      : (prior?.counter_evidence_json ? JSON.parse(prior.counter_evidence_json) : [])
    this.database.connection.prepare(`
      INSERT INTO morrow_self_states(
        id, actor, domain, proposition, stance, evidence_json, counter_evidence_json,
        independent_contexts, score, status, revision, supersedes, rationale, algorithm_version, created_at, updated_at
      ) VALUES (?, 'morrow', ?, ?, 'uncertain', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stateId,
      finding.kind === 'memory_gap' || finding.kind === 'open_question' ? 'question' : 'pattern',
      finding.statement.slice(0, 1000),
      JSON.stringify(evidenceRefs.slice(-40)),
      JSON.stringify(counterRefs.slice(-20)),
      independent,
      score,
      status,
      revision,
      prior?.id ?? null,
      `reflection:${finding.kind} runs=${independent} score=${score} decision=${decision}`.slice(0, 1000),
      REFLECTION_STATE_GATE_VERSION,
      at,
      at
    )
    if (prior) {
      this.database.connection.prepare(
        "UPDATE morrow_self_states SET status = 'superseded', updated_at = ? WHERE id = ? AND status != 'superseded'"
      ).run(at, prior.id)
    }
    this.recordDecision(finding, decision, `state_gate score=${score} independent=${independent}`, score, independent)
    return decision
  }

  private decisionFor(findingId: string): ReflectionStateDecision | null {
    try {
      const row = this.database.connection.prepare(
        "SELECT payload_json FROM event_journal WHERE event_type = 'reflection.state_decision' AND json_extract(payload_json, '$.findingId') = ? LIMIT 1"
      ).get(findingId) as { payload_json: string } | undefined
      if (!row) return null
      const payload = JSON.parse(row.payload_json) as { decision?: string }
      return payload.decision === 'promoted' || payload.decision === 'weakened' || payload.decision === 'candidate' || payload.decision === 'rejected' || payload.decision === 'deferred'
        ? payload.decision
        : null
    } catch {
      return null
    }
  }

  private recordDecision(finding: ReflectionStateFinding, decision: ReflectionStateDecision, reason: string, score: number, independent: number): void {
    try {
      this.events?.recordDeterministic(`reflection-state:${finding.findingId}`, {
        sourceModule: 'self-model',
        eventType: 'reflection.state_decision',
        actor: 'system',
        subjectType: 'reflection_finding',
        subjectId: finding.findingId,
        correlationId: finding.runId,
        payload: { findingId: finding.findingId, runId: finding.runId, kind: finding.kind, decision, reason, score, independent }
      })
    } catch {
      // A missing audit must not leave an untracked state revision: the caller
      // transaction will roll back because this method is called inside it.
      throw new Error('REFLECTION_STATE_AUDIT_UNAVAILABLE')
    }
  }
}
