import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { ReflectionStateGate, type ReflectionStateFinding } from './reflection-state-gate'
import { InnerCognitionService, SqliteInnerCognitionRepository } from './inner-cognition'

const directories: string[] = []
const at = '2026-11-08T12:00:00.000Z'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-reflection-state-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  const gate = new ReflectionStateGate(database, () => at, () => randomUUID(), events)
  const seedRoot = (label = 'test-gap'): string => events.recordDeterministic(`test-gap:${label}:${randomUUID()}`, {
    sourceModule: 'cognition',
    eventType: 'cognition.knowledge_gap',
    actor: 'system',
    subjectType: 'interest',
    subjectId: label.slice(0, 64),
    correlationId: null,
    payload: { label: label.slice(0, 64), owner: 'morrow' }
  }).event.id
  const finding = (kind = 'memory_gap', confidence = 60, statement = '多次用户纠正提示：在相关话题上应降低断言置信度。', rootId?: string): ReflectionStateFinding => {
    const root = rootId ?? seedRoot()
    const runId = randomUUID()
    const findingId = randomUUID()
    database.connection.prepare(`
      INSERT INTO reflection_runs(id, trigger_kind, started_at, finished_at, examined_turns, examined_events, findings_count, status)
      VALUES (?, 'manual', ?, ?, 0, 1, 1, 'completed')
    `).run(runId, at, at)
    database.connection.prepare(`
      INSERT INTO reflection_findings(id, run_id, kind, statement, confidence, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(findingId, runId, kind, statement, confidence, JSON.stringify([{ kind: 'event', id: root }]), at)
    return { findingId, runId, kind, statement, confidence, createdAt: at }
  }
  const findingWithEvidence = (
    evidenceIds: string[],
    kind = 'memory_gap',
    confidence = 60,
    statement = '多次用户纠正提示：在相关话题上应降低断言置信度。'
  ): ReflectionStateFinding => {
    const runId = randomUUID()
    const findingId = randomUUID()
    database.connection.prepare(`
      INSERT INTO reflection_runs(id, trigger_kind, started_at, finished_at, examined_turns, examined_events, findings_count, status)
      VALUES (?, 'manual', ?, ?, 0, 1, 1, 'completed')
    `).run(runId, at, at)
    database.connection.prepare(`
      INSERT INTO reflection_findings(id, run_id, kind, statement, confidence, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(findingId, runId, kind, statement, confidence, JSON.stringify(evidenceIds.map((id) => ({ kind: 'event', id }))), at)
    return { findingId, runId, kind, statement, confidence, createdAt: at }
  }
  return { directory, database, events, gate, finding, findingWithEvidence, seedRoot }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('reflection finding -> self-state evidence gate', () => {
  it('creates a candidate from one root and promotes after two independent roots', () => {
    const context = setup()
    try {
      const first = context.finding()
      expect(context.gate.ingestInTransaction(first)).toBe('candidate')
      const second = context.finding()
      expect(context.gate.ingestInTransaction(second)).toBe('promoted')
      const row = context.database.connection.prepare(
        "SELECT * FROM morrow_self_states WHERE actor = 'morrow' AND status = 'active' ORDER BY revision DESC LIMIT 1"
      ).get() as Record<string, unknown>
      expect(row.independent_contexts).toBe(2)
      expect(row.revision).toBe(2)
      const refs = JSON.parse(String(row.evidence_json)) as Array<{ rootSourceId: string }>
      expect(new Set(refs.map((ref) => ref.rootSourceId)).size).toBe(2)
      const inner = new InnerCognitionService(new SqliteInnerCognitionRepository(context.database), context.events, () => at)
      expect(inner.contextBlock('用户纠正')).toContain('多次用户纠正')
      expect(inner.contextBlock('烘焙面包的温度')).toBe('')
    } finally {
      context.database.close()
    }
  })

  it('collapses many findings from the same root source into one independent root', () => {
    const context = setup()
    try {
      const root = context.seedRoot('same-root')
      for (let index = 0; index < 100; index += 1) {
        expect(context.gate.ingestInTransaction(context.finding('memory_gap', 60, undefined, root))).toBe('candidate')
      }
      const row = context.database.connection.prepare(
        'SELECT * FROM morrow_self_states ORDER BY revision DESC LIMIT 1'
      ).get() as Record<string, unknown>
      expect(row.independent_contexts).toBe(1)
      expect(row.status).toBe('candidate')
    } finally {
      context.database.close()
    }
  })

  it('rejects findings whose root cannot be resolved in the source journal', () => {
    const context = setup()
    try {
      const forged: ReflectionStateFinding = {
        findingId: randomUUID(), runId: randomUUID(), kind: 'memory_gap', confidence: 90,
        statement: '伪造来源', createdAt: at, rootSourceId: randomUUID()
      }
      expect(context.gate.ingestInTransaction(forged)).toBe('rejected')
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM morrow_self_states').get()?.count).toBe(0)
    } finally {
      context.database.close()
    }
  })

  it('is idempotent per finding and records one decision event', () => {
    const context = setup()
    try {
      const item = context.finding()
      expect(context.gate.ingestInTransaction(item)).toBe('candidate')
      expect(context.gate.ingestInTransaction(item)).toBe('candidate')
      const count = context.database.connection.prepare(
        "SELECT COUNT(*) AS count FROM event_journal WHERE event_type = 'reflection.state_decision' AND json_extract(payload_json, '$.findingId') = ?"
      ).get(item.findingId) as { count: number }
      expect(count.count).toBe(1)
      const states = context.database.connection.prepare('SELECT COUNT(*) AS count FROM morrow_self_states').get() as { count: number }
      expect(states.count).toBe(1)
    } finally {
      context.database.close()
    }
  })

  it('weakens an active state from a repeated bias finding instead of promoting it again', () => {
    const context = setup()
    try {
      const statement = '多次交互被用户纠正；近期回答应更直接地承认不确定性。'
      expect(context.gate.ingestInTransaction(context.finding('memory_gap', 65, statement))).toBe('candidate')
      expect(context.gate.ingestInTransaction(context.finding('memory_gap', 65, statement))).toBe('promoted')
      expect(context.gate.ingestInTransaction(context.finding('bias_hint', 65, statement))).toBe('weakened')
      const row = context.database.connection.prepare(
        "SELECT * FROM morrow_self_states WHERE status = 'weakened' ORDER BY revision DESC LIMIT 1"
      ).get() as Record<string, unknown>
      expect(JSON.parse(String(row.counter_evidence_json))).toHaveLength(1)
    } finally {
      context.database.close()
    }
  })

  it('rejects low-confidence and ineligible findings without creating a state', () => {
    const context = setup()
    try {
      expect(context.gate.ingestInTransaction(context.finding('next_turn_suggestion', 80))).toBe('rejected')
      expect(context.gate.ingestInTransaction(context.finding('memory_gap', 20))).toBe('rejected')
      const count = context.database.connection.prepare('SELECT COUNT(*) AS count FROM morrow_self_states').get() as { count: number }
      expect(count.count).toBe(0)
    } finally {
      context.database.close()
    }
  })
})

describe('recursive evidence lineage', () => {
  function lineage(
    database: SqliteDatabase,
    nodeId: string,
    parentIds: string[],
    overrides: Partial<{
      owner: string; rootSourceId: string; cluster: string
      kind: string; state: string; table: string
    }> = {}
  ): void {
    database.connection.prepare(`
      INSERT INTO evidence_lineage(
        node_id, owner, root_source_id, correlation_group_id, derivation_kind,
        source_table, state, parent_ids_json, verified_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nodeId,
      overrides.owner ?? 'morrow',
      overrides.rootSourceId ?? nodeId,
      overrides.cluster ?? nodeId,
      overrides.kind ?? 'reflection',
      overrides.table ?? 'evidence_lineage',
      overrides.state ?? 'active',
      JSON.stringify(parentIds),
      at,
      at
    )
  }

  function rejectionReason(database: SqliteDatabase, findingId: string): string {
    const row = database.connection.prepare(
      "SELECT payload_json FROM event_journal WHERE event_type = 'reflection.state_decision' AND json_extract(payload_json, '$.findingId') = ?"
    ).get(findingId) as { payload_json: string }
    return (JSON.parse(row.payload_json) as { reason: string }).reason
  }

  it('walks a derived decision event back to its origin and counts the root once', () => {
    const context = setup()
    try {
      const first = context.finding()
      expect(context.gate.ingestInTransaction(first)).toBe('candidate')
      const decision = context.database.connection.prepare(
        "SELECT id FROM event_journal WHERE event_type = 'reflection.state_decision' AND json_extract(payload_json, '$.findingId') = ?"
      ).get(first.findingId) as { id: string }
      const derivation = context.database.connection.prepare(
        'SELECT * FROM evidence_lineage WHERE node_id = ?'
      ).get(decision.id) as Record<string, unknown>
      expect(derivation.derivation_kind).toBe('reflection')
      expect(JSON.parse(String(derivation.parent_ids_json))).toHaveLength(1)

      const second = context.findingWithEvidence([decision.id, context.seedRoot('second-root')])
      expect(context.gate.ingestInTransaction(second)).toBe('promoted')
      const row = context.database.connection.prepare(
        "SELECT * FROM morrow_self_states WHERE status = 'active' ORDER BY revision DESC LIMIT 1"
      ).get() as Record<string, unknown>
      expect(row.independent_contexts).toBe(2)
    } finally {
      context.database.close()
    }
  })

  it('rejects a cyclic chain', () => {
    const context = setup()
    try {
      const a = randomUUID()
      const b = randomUUID()
      lineage(context.database, a, [b])
      lineage(context.database, b, [a])
      const finding = context.findingWithEvidence([a])
      expect(context.gate.ingestInTransaction(finding)).toBe('rejected')
      expect(rejectionReason(context.database, finding.findingId)).toBe('parent_cycle')
    } finally {
      context.database.close()
    }
  })

  it('rejects a broken chain whose parent does not exist', () => {
    const context = setup()
    try {
      const a = randomUUID()
      lineage(context.database, a, [randomUUID()])
      const finding = context.findingWithEvidence([a])
      expect(context.gate.ingestInTransaction(finding)).toBe('rejected')
      expect(rejectionReason(context.database, finding.findingId)).toBe('source_missing')
    } finally {
      context.database.close()
    }
  })

  it('rejects a retracted or deleted origin even when the event row still exists', () => {
    const context = setup()
    try {
      const root = context.seedRoot('retracted-root')
      lineage(context.database, root, [], { kind: 'origin', state: 'retracted', table: 'event_journal' })
      const retracted = context.findingWithEvidence([root])
      expect(context.gate.ingestInTransaction(retracted)).toBe('rejected')
      expect(rejectionReason(context.database, retracted.findingId)).toBe('evidence_lineage_unverified')
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM morrow_self_states').get()?.count).toBe(0)
    } finally {
      context.database.close()
    }
  })

  it('rejects a chain that mixes a Morrow root with a non-Morrow source', () => {
    const context = setup()
    try {
      const entryId = randomUUID()
      context.database.connection.prepare(`
        INSERT INTO self_model_entries(id, kind, statement, status, confidence, source_message_id, conversation_id, superseded_by, created_at, updated_at)
        VALUES (?, 'fact', '用户偏爱简洁回答', 'active', 80, NULL, NULL, NULL, ?, ?)
      `).run(entryId, at, at)
      const finding = context.findingWithEvidence([context.seedRoot('owner-root'), entryId])
      expect(context.gate.ingestInTransaction(finding)).toBe('rejected')
      expect(rejectionReason(context.database, finding.findingId)).toBe('cross_owner_evidence')
    } finally {
      context.database.close()
    }
  })

  it('rejects caller-supplied correlation or root values the chain does not prove', () => {
    const context = setup()
    try {
      const root = context.seedRoot('caller-claim')
      const forgedCluster = context.findingWithEvidence([root])
      expect(context.gate.ingestInTransaction({ ...forgedCluster, correlationGroupId: randomUUID() })).toBe('rejected')
      expect(rejectionReason(context.database, forgedCluster.findingId)).toBe('caller_correlation_mismatch')

      const forgedRoot = context.findingWithEvidence([root])
      expect(context.gate.ingestInTransaction({ ...forgedRoot, rootSourceId: randomUUID() })).toBe('rejected')
      expect(rejectionReason(context.database, forgedRoot.findingId)).toBe('caller_root_mismatch')
    } finally {
      context.database.close()
    }
  })

  it('revalidates live states: downgrades on lost independence and retracts with no support', () => {
    const context = setup()
    try {
      expect(context.gate.ingestInTransaction(context.finding())).toBe('candidate')
      expect(context.gate.ingestInTransaction(context.finding())).toBe('promoted')
      const state = context.database.connection.prepare(
        "SELECT * FROM morrow_self_states WHERE status = 'active' ORDER BY revision DESC LIMIT 1"
      ).get() as Record<string, unknown>
      const roots = (JSON.parse(String(state.evidence_json)) as Array<{ rootSourceId: string }>).map((ref) => ref.rootSourceId)
      const stateId = String(state.id)
      expect(roots).toHaveLength(2)

      context.database.connection.prepare("UPDATE evidence_lineage SET state = 'retracted' WHERE node_id = ?").run(roots[0]!)
      const first = context.gate.revalidate()
      expect(first.updated).toBe(1)
      const downgraded = context.database.connection.prepare('SELECT status, independent_contexts FROM morrow_self_states WHERE id = ?').get(stateId) as { status: string; independent_contexts: number }
      expect(downgraded.status).toBe('candidate')
      expect(downgraded.independent_contexts).toBe(1)

      context.database.connection.prepare("UPDATE evidence_lineage SET state = 'retracted' WHERE node_id = ?").run(roots[1]!)
      const second = context.gate.revalidate()
      expect(second.retracted).toBe(1)
      const retracted = context.database.connection.prepare('SELECT status, evidence_json FROM morrow_self_states WHERE id = ?').get(stateId) as { status: string; evidence_json: string }
      expect(retracted.status).toBe('retracted')
      expect(JSON.parse(retracted.evidence_json)).toHaveLength(0)
    } finally {
      context.database.close()
    }
  })


  it('rejects a parent list that mixes a valid UUID with any malformed entry', () => {
    const context = setup()
    try {
      const root = context.seedRoot('mixed-parent')
      const malformed = context.events.recordDeterministic(`malformed:${randomUUID()}`, {
        sourceModule: 'cognition', eventType: 'inner.thought.created', actor: 'system',
        subjectType: 'interest', subjectId: 'x', correlationId: null,
        payload: { parentEvidenceIds: [root, 'not-a-uuid'] }
      }).event.id
      const finding = context.findingWithEvidence([malformed])
      expect(context.gate.ingestInTransaction(finding)).toBe('rejected')
      expect(rejectionReason(context.database, finding.findingId)).toBe('malformed_parent_chain')
    } finally {
      context.database.close()
    }
  })

  it('treats null, object, string, duplicate and oversized parent fields as malformed', () => {
    const context = setup()
    try {
      const root = context.seedRoot('bad-shape')
      const payloads: unknown[] = [null, { id: root }, root, [root, root], Array.from({ length: 17 }, () => randomUUID())]
      for (const value of payloads) {
        const event = context.events.recordDeterministic(`bad-shape:${randomUUID()}`, {
          sourceModule: 'cognition', eventType: 'inner.thought.created', actor: 'system',
          subjectType: 'interest', subjectId: 'x', correlationId: null,
          payload: { parentEvidenceIds: value as never }
        }).event.id
        const finding = context.findingWithEvidence([event])
        expect(context.gate.ingestInTransaction(finding)).toBe('rejected')
        expect(rejectionReason(context.database, finding.findingId)).toBe('malformed_parent_chain')
      }
    } finally {
      context.database.close()
    }
  })

  it('rejects a thought event with an empty or absent parent list instead of treating it as origin', () => {
    const context = setup()
    try {
      const empty = context.events.recordDeterministic(`thought-empty:${randomUUID()}`, {
        sourceModule: 'cognition', eventType: 'inner.thought.created', actor: 'system',
        subjectType: 'interest', subjectId: 'x', correlationId: null,
        payload: { parentEvidenceIds: [] }
      }).event.id
      const emptyFinding = context.findingWithEvidence([empty])
      expect(context.gate.ingestInTransaction(emptyFinding)).toBe('rejected')
      expect(rejectionReason(context.database, emptyFinding.findingId)).toBe('derived_origin_forbidden')

      const absent = context.events.recordDeterministic(`thought-absent:${randomUUID()}`, {
        sourceModule: 'cognition', eventType: 'inner.thought.created', actor: 'system',
        subjectType: 'interest', subjectId: 'x', correlationId: null,
        payload: { label: 'x' }
      }).event.id
      const absentFinding = context.findingWithEvidence([absent])
      expect(context.gate.ingestInTransaction(absentFinding)).toBe('rejected')
      expect(rejectionReason(context.database, absentFinding.findingId)).toBe('derived_origin_forbidden')
    } finally {
      context.database.close()
    }
  })

  it("checks the event's own invalid subject before following an active parent", () => {
    const context = setup()
    try {
      const parent = context.seedRoot('active-parent')
      const memoryId = randomUUID()
      context.database.connection.prepare(`
        INSERT INTO memories(id, original_text, current_text, source_category, status, created_at, updated_at, revision)
        VALUES (?, '将被删除的记忆', '将被删除的记忆', 'user_explicit_input', 'active', ?, ?, 1)
      `).run(memoryId, at, at)
      context.database.connection.prepare("INSERT INTO deletion_journal(entity, entity_id, state, recorded_at) VALUES ('memory', ?, 'deleted', ?)").run(memoryId, at)
      const event = context.events.recordDeterministic(`self-invalid:${randomUUID()}`, {
        sourceModule: 'memory', eventType: 'memory.created', actor: 'user',
        subjectType: 'memory', subjectId: memoryId, correlationId: null,
        payload: { parentEvidenceIds: [parent] }
      }).event.id
      const finding = context.findingWithEvidence([event])
      expect(context.gate.ingestInTransaction(finding)).toBe('rejected')
      expect(rejectionReason(context.database, finding.findingId)).toBe('self_invalidated')
    } finally {
      context.database.close()
    }
  })

  it('follows a multi-level event parent chain to the same origin root', () => {
    const context = setup()
    try {
      const root = context.seedRoot('multi-level')
      const first = context.events.recordDeterministic(`level-1:${randomUUID()}`, {
        sourceModule: 'cognition', eventType: 'cognition.derived', actor: 'system',
        subjectType: 'interest', subjectId: 'x', correlationId: null,
        payload: { parentEvidenceIds: [root] }
      }).event.id
      const second = context.events.recordDeterministic(`level-2:${randomUUID()}`, {
        sourceModule: 'cognition', eventType: 'cognition.derived', actor: 'system',
        subjectType: 'interest', subjectId: 'x', correlationId: null,
        payload: { parentEvidenceIds: [first] }
      }).event.id
      const finding = context.findingWithEvidence([second])
      expect(context.gate.ingestInTransaction(finding)).toBe('candidate')
      const row = context.database.connection.prepare(
        'SELECT evidence_json, independent_contexts FROM morrow_self_states ORDER BY revision DESC LIMIT 1'
      ).get() as { evidence_json: string; independent_contexts: number }
      const refs = JSON.parse(row.evidence_json) as Array<{ rootSourceId: string }>
      expect(refs.map((ref) => ref.rootSourceId)).toEqual([root])
      expect(row.independent_contexts).toBe(1)
    } finally {
      context.database.close()
    }
  })


  it('rejects a synthetic lineage node even when its parents are valid', () => {
    const context = setup()
    try {
      const root = context.seedRoot('synthetic-parent')
      const synthetic = randomUUID()
      lineage(context.database, synthetic, [root], { kind: 'synthetic', rootSourceId: root, cluster: root })
      const finding = context.findingWithEvidence([synthetic])
      expect(context.gate.ingestInTransaction(finding)).toBe('rejected')
      expect(rejectionReason(context.database, finding.findingId)).toBe('derived_origin_forbidden')
    } finally {
      context.database.close()
    }
  })

  it('rejects a chain deeper than the maximum depth', () => {
    const context = setup()
    try {
      const ids = Array.from({ length: 12 }, () => randomUUID())
      lineage(context.database, ids[0]!, [], { kind: 'origin', table: 'event_journal' })
      for (let index = 1; index < ids.length; index += 1) {
        lineage(context.database, ids[index]!, [ids[index - 1]!], { rootSourceId: ids[0]!, cluster: ids[0]! })
      }
      const finding = context.findingWithEvidence([ids.at(-1)!])
      expect(context.gate.ingestInTransaction(finding)).toBe('rejected')
      expect(rejectionReason(context.database, finding.findingId)).toBe('parent_depth_exceeded')
    } finally {
      context.database.close()
    }
  })

  it('rejects an event whose memory subject was deleted', () => {
    const context = setup()
    try {
      const memoryId = randomUUID()
      context.database.connection.prepare(`
        INSERT INTO memories(id, original_text, current_text, source_category, status, created_at, updated_at, revision)
        VALUES (?, '用户喜欢深色模式', '用户喜欢深色模式', 'user_explicit_input', 'active', ?, ?, 1)
      `).run(memoryId, at, at)
      context.database.connection.prepare(
        "INSERT INTO deletion_journal(entity, entity_id, state, recorded_at) VALUES ('memory', ?, 'deleted', ?)"
      ).run(memoryId, at)
      const event = context.events.recordDeterministic(`memory-created:${memoryId}`, {
        sourceModule: 'memory',
        eventType: 'memory.created',
        actor: 'user',
        subjectType: 'memory',
        subjectId: memoryId,
        correlationId: null,
        payload: { memoryId }
      }).event.id
      const finding = context.findingWithEvidence([event])
      expect(context.gate.ingestInTransaction(finding)).toBe('rejected')
      expect(rejectionReason(context.database, finding.findingId)).toBe('self_invalidated')
    } finally {
      context.database.close()
    }
  })
})
