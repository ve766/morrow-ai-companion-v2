import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { ReflectionStateGate } from './reflection-state-gate'
import { InnerCognitionService, SqliteInnerCognitionRepository } from './inner-cognition'

const directories: string[] = []
const at = '2026-11-08T12:00:00.000Z'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-reflection-state-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  const gate = new ReflectionStateGate(database, () => at, () => randomUUID(), events)
  return { directory, database, events, gate }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function finding(kind = 'memory_gap', confidence = 60, statement = '多次用户纠正提示：在相关话题上应降低断言置信度。') {
  return { findingId: randomUUID(), runId: randomUUID(), kind, statement, confidence, createdAt: at }
}

describe('reflection finding -> self-state evidence gate', () => {
  it('creates a candidate from one run and promotes after two independent runs', () => {
    const context = setup()
    try {
      const first = finding()
      expect(context.gate.ingestInTransaction(first)).toBe('candidate')
      const second = finding()
      expect(context.gate.ingestInTransaction(second)).toBe('promoted')
      const row = context.database.connection.prepare(
        "SELECT * FROM morrow_self_states WHERE actor = 'morrow' AND status = 'active' ORDER BY revision DESC LIMIT 1"
      ).get() as Record<string, unknown>
      expect(row.independent_contexts).toBe(2)
      expect(row.revision).toBe(2)
      const refs = JSON.parse(String(row.evidence_json)) as Array<{ runId: string }>
      expect(new Set(refs.map((ref) => ref.runId)).size).toBe(2)
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
      const root = randomUUID()
      for (let index = 0; index < 100; index += 1) {
        context.gate.ingestInTransaction({ ...finding(), rootSourceId: root, correlationGroupId: root })
      }
      const row = context.database.connection.prepare(
        "SELECT * FROM morrow_self_states ORDER BY revision DESC LIMIT 1"
      ).get() as Record<string, unknown>
      expect(row.independent_contexts).toBe(1)
      expect(row.status).toBe('candidate')
    } finally {
      context.database.close()
    }
  })

  it('is idempotent per finding and records one decision event', () => {
    const context = setup()
    try {
      const item = finding()
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
      expect(context.gate.ingestInTransaction(finding('memory_gap', 65, statement))).toBe('candidate')
      expect(context.gate.ingestInTransaction(finding('memory_gap', 65, statement))).toBe('promoted')
      expect(context.gate.ingestInTransaction(finding('bias_hint', 65, statement))).toBe('weakened')
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
      expect(context.gate.ingestInTransaction(finding('next_turn_suggestion', 80))).toBe('rejected')
      expect(context.gate.ingestInTransaction(finding('memory_gap', 20))).toBe('rejected')
      const count = context.database.connection.prepare('SELECT COUNT(*) AS count FROM morrow_self_states').get() as { count: number }
      expect(count.count).toBe(0)
    } finally {
      context.database.close()
    }
  })
})
