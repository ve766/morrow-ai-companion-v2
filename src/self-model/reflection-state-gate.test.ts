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
      expect(rejectionReason(context.database, finding.findingId)).toBe('evidence_lineage_unverified')
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
      expect(rejectionReason(context.database, finding.findingId)).toBe('evidence_lineage_unverified')
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
      expect(rejectionReason(context.database, finding.findingId)).toBe('evidence_lineage_unverified')
    } finally {
      context.database.close()
    }
  })
})
