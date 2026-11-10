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

type EvidenceOwner = 'user' | 'morrow' | 'shared' | 'system'

interface VerifiedRoot {
  rootSourceId: string
  correlationGroupId: string
  owner: EvidenceOwner
}

interface LineageRow {
  node_id: string
  owner: EvidenceOwner
  root_source_id: string
  correlation_group_id: string
  derivation_kind: 'origin' | 'reflection' | 'thought' | 'summary' | 'synthetic'
  source_table: 'event_journal' | 'memories' | 'self_model_entries' | 'evidence_lineage'
  state: 'active' | 'retracted' | 'deleted'
  parent_ids_json: string
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
  rationale: string
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Stable rejection reasons. Never put user text in this field. */
export const REFLECTION_GATE_REASONS = {
  ineligible: 'ineligible_kind_or_low_confidence',
  legacyUnverified: 'legacy_unverified',
  lineageUnverified: 'evidence_lineage_unverified',
  malformedParentChain: 'malformed_parent_chain',
  malformedEvidenceRefs: 'malformed_evidence_refs',
  missingParentChain: 'missing_parent_chain',
  derivedOriginForbidden: 'derived_origin_forbidden',
  selfInvalidated: 'self_invalidated',
  sourceMissing: 'source_missing',
  parentCycle: 'parent_cycle',
  parentDepth: 'parent_depth_exceeded',
  crossOwner: 'cross_owner_evidence',
  unprovenKey: 'unproven_lineage_key',
  callerRoot: 'caller_root_mismatch',
  callerCluster: 'caller_correlation_mismatch',
  unsupportedSource: 'unsupported_source_type'
} as const

export type ReflectionGateReason = typeof REFLECTION_GATE_REASONS[keyof typeof REFLECTION_GATE_REASONS]

export type ParentParse =
  | { status: 'absent' }
  | { status: 'empty' }
  | { status: 'valid'; ids: string[] }
  | { status: 'malformed'; reason: 'not_array' | 'non_string' | 'invalid_uuid' | 'duplicate' | 'too_many' }

const MAX_PARENT_IDS = 16

/**
 * Strict parent parsing. A malformed field is never treated as "no parents":
 * that conversion is exactly how a damaged derived record becomes an origin.
 */
export function parseParentIds(value: unknown): ParentParse {
  if (value === undefined) return { status: 'absent' }
  if (!Array.isArray(value)) return { status: 'malformed', reason: 'not_array' }
  if (value.length > MAX_PARENT_IDS) return { status: 'malformed', reason: 'too_many' }
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return { status: 'malformed', reason: 'non_string' }
    if (!isUuid(entry)) return { status: 'malformed', reason: 'invalid_uuid' }
    if (ids.includes(entry)) return { status: 'malformed', reason: 'duplicate' }
    ids.push(entry)
  }
  return ids.length === 0 ? { status: 'empty' } : { status: 'valid', ids }
}

type Verification = { ok: true; roots: VerifiedRoot[] } | { ok: false; reason: ReflectionGateReason }

function verified(roots: VerifiedRoot[]): Verification {
  return roots.length > 0 ? { ok: true, roots } : { ok: false, reason: REFLECTION_GATE_REASONS.lineageUnverified }
}

function dedupeRoots(roots: VerifiedRoot[]): VerifiedRoot[] {
  const unique = new Map<string, VerifiedRoot>()
  for (const root of roots) unique.set(`${root.correlationGroupId}:${root.rootSourceId}`, root)
  return [...unique.values()]
}

/** Event families that are derived by definition and may never be an origin. */
function requiresParents(eventType: string): boolean {
  return eventType.startsWith('inner.thought.') ||
    eventType.startsWith('reflection.') ||
    eventType.startsWith('summary.') ||
    eventType.startsWith('synthetic.')
}

export class ReflectionStateGate {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID(),
    private readonly events?: EventLogService
  ) {}

  /**
   * Startup/backup-restore reconciliation: re-verify the support of every
   * live state, drop invalid refs, downgrade a state that lost independence
   * and retract one whose support is gone. Idempotent and safe to re-run.
   */
  revalidate(): { examined: number; updated: number; retracted: number } {
    const rows = this.database.connection.prepare(
      "SELECT * FROM morrow_self_states WHERE actor = 'morrow' AND status IN ('active', 'candidate', 'weakened') ORDER BY updated_at DESC"
    ).all() as unknown as StateRow[]
    let updated = 0
    let retracted = 0
    const at = this.clock()
    for (const row of rows) {
      const refs = refsOf(row)
      const valid = refs.filter((ref) => {
        if (!isUuid(ref.rootSourceId) || !isUuid(ref.correlationGroupId)) return false
        const roots = this.verifyNode(ref.rootSourceId, new Set(), 0)
        return roots.ok && roots.roots.some((root) =>
          root.rootSourceId === ref.rootSourceId && root.correlationGroupId === ref.correlationGroupId && root.owner === 'morrow')
      })
      const independent = new Set(valid.map((ref) => ref.correlationGroupId)).size
      if (valid.length === refs.length && independent === row.independent_contexts && valid.length > 0) continue
      const status = valid.length === 0 ? 'retracted' : row.status === 'active' && independent < 2 ? 'candidate' : row.status
      this.database.connection.prepare(
        'UPDATE morrow_self_states SET evidence_json = ?, independent_contexts = ?, status = ?, updated_at = ?, rationale = ? WHERE id = ?'
      ).run(
        JSON.stringify(valid.slice(-40)),
        independent,
        status,
        at,
        `${row.rationale} | revalidated: removed ${refs.length - valid.length} invalid refs`.slice(0, 1000),
        row.id
      )
      if (status === 'retracted') retracted += 1
      updated += 1
      try {
        this.events?.recordDeterministic(`reflection-revalidate:${row.id}:${row.revision}`, {
          sourceModule: 'self-model',
          eventType: 'reflection.state_revalidated',
          actor: 'system',
          subjectType: 'morrow_self_state',
          subjectId: row.id,
          correlationId: null,
          payload: { stateId: row.id, from: row.status, status, independent, removed: refs.length - valid.length }
        })
      } catch {
        throw new Error('REFLECTION_STATE_AUDIT_UNAVAILABLE')
      }
    }
    return { examined: rows.length, updated, retracted }
  }

  private lineageRow(id: string): LineageRow | null {
    try {
      const row = this.database.connection.prepare('SELECT * FROM evidence_lineage WHERE node_id = ?').get(id) as LineageRow | undefined
      return row ?? null
    } catch {
      return null
    }
  }

  /**
   * Walk one evidence node to its verified origin roots. Returns null when the
   * chain is missing, cyclic, broken, retracted/deleted, or cross-owner. A
   * derived node contributes the roots of its parents, not a fresh identity.
   */
  private verifyNode(id: string, visited: Set<string>, depth: number): Verification {
    if (depth > 8) return { ok: false, reason: REFLECTION_GATE_REASONS.parentDepth }
    if (visited.has(id)) return { ok: false, reason: REFLECTION_GATE_REASONS.parentCycle }
    const path = new Set(visited)
    path.add(id)
    const lineage = this.lineageRow(id)
    if (lineage) return this.verifyLineage(lineage, path, depth)
    return this.verifyPersistedSource(id, path, depth)
  }

  private verifyAll(ids: string[], visited: Set<string>, depth: number): Verification {
    const roots: VerifiedRoot[] = []
    for (const id of ids) {
      const result = this.verifyNode(id, visited, depth + 1)
      if (!result.ok) return result
      roots.push(...result.roots)
    }
    return verified(dedupeRoots(roots))
  }

  private verifyLineage(row: LineageRow, visited: Set<string>, depth: number): Verification {
    if (row.state !== 'active') return { ok: false, reason: REFLECTION_GATE_REASONS.lineageUnverified }
    let parsedParents: unknown
    try {
      parsedParents = JSON.parse(row.parent_ids_json)
    } catch {
      return { ok: false, reason: REFLECTION_GATE_REASONS.malformedParentChain }
    }
    const parents = parseParentIds(parsedParents)
    if (parents.status === 'malformed') return { ok: false, reason: REFLECTION_GATE_REASONS.malformedParentChain }
    if (row.derivation_kind === 'synthetic') return { ok: false, reason: REFLECTION_GATE_REASONS.derivedOriginForbidden }
    if (row.derivation_kind === 'origin') {
      if (parents.status !== 'empty' && parents.status !== 'absent') return { ok: false, reason: REFLECTION_GATE_REASONS.malformedParentChain }
      if (row.root_source_id !== row.node_id) return { ok: false, reason: REFLECTION_GATE_REASONS.lineageUnverified }
      return { ok: true, roots: [{ rootSourceId: row.root_source_id, correlationGroupId: row.correlation_group_id, owner: row.owner }] }
    }
    if (parents.status !== 'valid') {
      return { ok: false, reason: REFLECTION_GATE_REASONS.missingParentChain }
    }
    const roots = this.verifyAll(parents.ids, visited, depth)
    if (!roots.ok) return roots
    // A derived node cannot launder a cross-owner ancestor, and its recorded
    // root/cluster must be one the chain actually proves.
    if (roots.roots.some((root) => root.owner !== row.owner)) return { ok: false, reason: REFLECTION_GATE_REASONS.crossOwner }
    if (!roots.roots.some((root) => root.rootSourceId === row.root_source_id)) return { ok: false, reason: REFLECTION_GATE_REASONS.unprovenKey }
    if (!roots.roots.some((root) => root.correlationGroupId === row.correlation_group_id)) return { ok: false, reason: REFLECTION_GATE_REASONS.unprovenKey }
    return roots
  }

  private verifyPersistedSource(id: string, visited: Set<string>, depth: number): Verification {
    try {
      const event = this.database.connection.prepare(
        'SELECT event_type, actor, source_module, subject_type, subject_id, correlation_id, payload_json FROM event_journal WHERE id = ?'
      ).get(id) as {
        event_type: string; actor: string; source_module: string
        subject_type: string; subject_id: string | null; correlation_id: string | null; payload_json: string
      } | undefined
      if (event) {
        // The node's own lifecycle comes first. A valid parent chain cannot
        // resurrect an event whose own subject is deleted or retracted.
        if (this.subjectInvalidated(event.subject_type, event.subject_id)) {
          return { ok: false, reason: REFLECTION_GATE_REASONS.selfInvalidated }
        }
        let payload: unknown = null
        try {
          payload = JSON.parse(event.payload_json)
        } catch {
          return { ok: false, reason: REFLECTION_GATE_REASONS.malformedParentChain }
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return { ok: false, reason: REFLECTION_GATE_REASONS.malformedParentChain }
        }
        const parents = parseParentIds((payload as { parentEvidenceIds?: unknown }).parentEvidenceIds)
        if (parents.status === 'malformed') return { ok: false, reason: REFLECTION_GATE_REASONS.malformedParentChain }
        if (parents.status === 'valid') {
          // A known origin event cannot acquire parents later; and a user/memory
          // actor cannot launder a Morrow-owned parent chain. System/provider
          // events are processors and inherit the parents' owner.
          if (event.event_type === 'cognition.knowledge_gap') {
            return { ok: false, reason: REFLECTION_GATE_REASONS.malformedParentChain }
          }
          const roots = this.verifyAll(parents.ids, visited, depth)
          if (!roots.ok) return roots
          if (event.actor === 'user' || event.source_module === 'memory') {
            if (roots.roots.some((root) => root.owner !== 'user')) return { ok: false, reason: REFLECTION_GATE_REASONS.crossOwner }
          }
          if (event.actor === 'provider') return { ok: false, reason: REFLECTION_GATE_REASONS.crossOwner }
          // A non-null correlation id is a claim about the cluster; it must be
          // one the verified parent chain actually proves.
          if (isUuid(event.correlation_id)) {
            const claimed = event.correlation_id
            if (!roots.roots.some((root) => root.correlationGroupId === claimed || root.rootSourceId === claimed)) {
              return { ok: false, reason: REFLECTION_GATE_REASONS.unprovenKey }
            }
          }
          return roots
        }
        if (requiresParents(event.event_type)) {
          return { ok: false, reason: REFLECTION_GATE_REASONS.derivedOriginForbidden }
        }
        // An empty parent list is an explicit origin claim; absence is a legacy
        // origin record. Both are accepted only for a real persisted event.
        const morrowOwned = event.event_type === 'cognition.knowledge_gap'
        const owner: EvidenceOwner = morrowOwned ? 'morrow' : event.actor === 'user' || event.source_module === 'memory' ? 'user' : 'system'
        const cluster = isUuid(event.correlation_id) ? event.correlation_id : id
        this.persistOrigin(id, owner, id, cluster, 'event_journal')
        return { ok: true, roots: [{ rootSourceId: id, correlationGroupId: cluster, owner }] }
      }
      const memory = this.database.connection.prepare('SELECT status FROM memories WHERE id = ?').get(id) as { status: string } | undefined
      if (memory) {
        if (memory.status !== 'active' || this.deletionInvalidates('memory', id)) {
          return { ok: false, reason: REFLECTION_GATE_REASONS.selfInvalidated }
        }
        this.persistOrigin(id, 'user', id, id, 'memories')
        return { ok: true, roots: [{ rootSourceId: id, correlationGroupId: id, owner: 'user' }] }
      }
      const entry = this.database.connection.prepare('SELECT status FROM self_model_entries WHERE id = ?').get(id) as { status: string } | undefined
      if (entry) {
        if (entry.status !== 'active') return { ok: false, reason: REFLECTION_GATE_REASONS.selfInvalidated }
        this.persistOrigin(id, 'system', id, id, 'self_model_entries')
        return { ok: true, roots: [{ rootSourceId: id, correlationGroupId: id, owner: 'system' }] }
      }
      return { ok: false, reason: REFLECTION_GATE_REASONS.sourceMissing }
    } catch {
      return { ok: false, reason: REFLECTION_GATE_REASONS.lineageUnverified }
    }
  }

  private deletionInvalidates(entity: 'memory' | 'conversation', id: string): boolean {
    const row = this.database.connection.prepare('SELECT state FROM deletion_journal WHERE entity = ? AND entity_id = ?').get(entity, id) as { state: string } | undefined
    return row !== undefined && row.state !== 'unretracted'
  }

  private subjectInvalidated(subjectType: string, subjectId: string | null): boolean {
    if (!subjectId) return false
    try {
      if (subjectType === 'memory') return this.deletionInvalidates('memory', subjectId)
      if (subjectType === 'conversation') {
        if (this.deletionInvalidates('conversation', subjectId)) return true
        return !this.database.connection.prepare('SELECT 1 AS present FROM conversations WHERE id = ?').get(subjectId)
      }
      if (subjectType === 'message') {
        return !this.database.connection.prepare('SELECT 1 AS present FROM messages WHERE id = ?').get(subjectId)
      }
      if (subjectType === 'reflection_finding') {
        return !this.database.connection.prepare('SELECT 1 AS present FROM reflection_findings WHERE id = ?').get(subjectId)
      }
      if (subjectType === 'morrow_thought') {
        const row = this.database.connection.prepare('SELECT status FROM morrow_thoughts WHERE id = ?').get(subjectId) as { status: string } | undefined
        return !row || row.status === 'rejected'
      }
      return false
    } catch {
      return true
    }
  }

  private persistOrigin(id: string, owner: EvidenceOwner, rootSourceId: string, cluster: string, table: 'event_journal' | 'memories' | 'self_model_entries'): void {
    const at = this.clock()
    this.database.connection.prepare(`
      INSERT OR IGNORE INTO evidence_lineage(
        node_id, owner, root_source_id, correlation_group_id, derivation_kind,
        source_table, state, parent_ids_json, verified_at, created_at
      ) VALUES (?, ?, ?, ?, 'origin', ?, 'active', '[]', ?, ?)
    `).run(id, owner, rootSourceId, cluster, table, at, at)
  }

  private persistDerivation(id: string, roots: VerifiedRoot[], parentIds: string[]): void {
    const ordered = [...roots].sort((left, right) =>
      `${left.correlationGroupId}:${left.rootSourceId}`.localeCompare(`${right.correlationGroupId}:${right.rootSourceId}`))
    const first = ordered[0]!
    const at = this.clock()
    this.database.connection.prepare(`
      INSERT OR IGNORE INTO evidence_lineage(
        node_id, owner, root_source_id, correlation_group_id, derivation_kind,
        source_table, state, parent_ids_json, verified_at, created_at
      ) VALUES (?, 'morrow', ?, ?, 'reflection', 'event_journal', 'active', ?, ?, ?)
    `).run(id, first.rootSourceId, first.correlationGroupId, JSON.stringify([...parentIds]), at, at)
  }

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
    const priorRefs = (prior ? refsOf(prior) : []).filter((ref) =>
      typeof ref.findingId === 'string' && isUuid(ref.rootSourceId) && isUuid(ref.correlationGroupId))
    // The lineage root is the original event/message, not the random reflection
    // run id. A hundred reruns over the same original source therefore collapse
    // to one root/cluster, and a derived node only contributes its ancestors.
    let rawRefs: Array<{ id: string }> = []
    let evidenceMalformed = false
    try {
      const row = this.database.connection.prepare('SELECT evidence_json FROM reflection_findings WHERE id = ?').get(finding.findingId) as { evidence_json: string } | undefined
      const parsed = row ? JSON.parse(row.evidence_json) : null
      if (!Array.isArray(parsed)) {
        evidenceMalformed = true
      } else {
        for (const item of parsed) {
          if (!item || typeof item !== 'object' || Array.isArray(item) || !isUuid((item as { id?: unknown }).id)) {
            evidenceMalformed = true
            break
          }
          rawRefs.push({ id: (item as { id: string }).id })
        }
      }
    } catch {
      evidenceMalformed = true
    }
    if (evidenceMalformed) {
      this.recordDecision(finding, 'rejected', REFLECTION_GATE_REASONS.malformedEvidenceRefs, 0, 0)
      return 'rejected'
    }
    const rawIds = [...new Set(rawRefs.map((ref) => ref.id))]
    if (rawIds.length === 0) {
      this.recordDecision(finding, 'rejected', REFLECTION_GATE_REASONS.legacyUnverified, 0, 0)
      return 'rejected'
    }
    // Fail closed: every evidence node must walk to active, Morrow-owned origin
    // roots. Missing, unknown, cyclic, broken, deleted/retracted and cross-owner
    // chains are all rejected here, not at the caller's discretion.
    const verified: VerifiedRoot[] = []
    let reason: ReflectionGateReason | null = null
    for (const id of rawIds) {
      const result = this.verifyNode(id, new Set(), 0)
      if (!result.ok) {
        reason = result.reason
        break
      }
      verified.push(...result.roots)
    }
    const trustedRoots = dedupeRoots(verified)
    if (!reason && (trustedRoots.length === 0 || trustedRoots.some((root) => root.owner !== 'morrow'))) {
      reason = REFLECTION_GATE_REASONS.crossOwner
    }
    if (!reason && finding.owner !== undefined && finding.owner !== 'morrow') reason = REFLECTION_GATE_REASONS.crossOwner
    // Caller-supplied root/cluster values are claims to verify, not inputs to
    // trust. A value the persisted chain does not prove rejects the finding.
    if (!reason && finding.rootSourceId !== undefined && !trustedRoots.some((root) => root.rootSourceId === finding.rootSourceId)) {
      reason = REFLECTION_GATE_REASONS.callerRoot
    }
    if (!reason && finding.correlationGroupId !== undefined && !trustedRoots.some((root) => root.correlationGroupId === finding.correlationGroupId)) {
      reason = REFLECTION_GATE_REASONS.callerCluster
    }
    if (reason) {
      this.recordDecision(finding, 'rejected', reason, 0, 0)
      return 'rejected'
    }
    // Prior support is revalidated on every ingest: a source deleted or
    // retracted since the last revision can no longer carry the state.
    const validPriorRefs = priorRefs.filter((ref) => {
      const roots = this.verifyNode(ref.rootSourceId, new Set(), 0)
      return roots.ok && roots.roots.some((root) =>
        root.rootSourceId === ref.rootSourceId && root.correlationGroupId === ref.correlationGroupId && root.owner === 'morrow')
    })
    const newRefs: LineageRef[] = trustedRoots.map((root) => ({
      findingId: finding.findingId,
      runId: finding.runId,
      kind: finding.kind,
      createdAt: finding.createdAt,
      rootSourceId: root.rootSourceId,
      correlationGroupId: root.correlationGroupId,
      owner: 'morrow',
      derivationKind: 'reflection',
      parentEvidenceIds: [...rawIds]
    }))
    const refKey = (ref: LineageRef): string => `${ref.findingId}:${ref.rootSourceId}:${ref.correlationGroupId}`
    const evidenceRefs = [...validPriorRefs, ...newRefs]
      .filter((ref, index, all) => all.findIndex((candidate) => refKey(candidate) === refKey(ref)) === index)
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
    this.recordDecision(finding, decision, `state_gate score=${score} independent=${independent}`, score, independent, {
      roots: trustedRoots,
      parentIds: rawIds
    })
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

  private recordDecision(
    finding: ReflectionStateFinding,
    decision: ReflectionStateDecision,
    reason: string,
    score: number,
    independent: number,
    lineage?: { roots: VerifiedRoot[]; parentIds: string[] }
  ): void {
    try {
      const recorded = this.events?.recordDeterministic(`reflection-state:${finding.findingId}`, {
        sourceModule: 'self-model',
        eventType: 'reflection.state_decision',
        actor: 'system',
        subjectType: 'reflection_finding',
        subjectId: finding.findingId,
        correlationId: finding.runId,
        payload: { findingId: finding.findingId, runId: finding.runId, kind: finding.kind, decision, reason, score, independent }
      })
      // The decision is itself a derived node. Persisting its parents makes a
      // later finding that cites the decision resolvable back to real origins.
      if (lineage && recorded?.inserted) this.persistDerivation(recorded.event.id, lineage.roots, lineage.parentIds)
    } catch {
      // A missing audit must not leave an untracked state revision: the caller
      // transaction will roll back because this method is called inside it.
      throw new Error('REFLECTION_STATE_AUDIT_UNAVAILABLE')
    }
  }
}
