import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { InvestigationService, investigationPriority, type InvestigationPriorityComponents } from './investigation'

const directories: string[] = []
const at = '2026-11-10T12:00:00.000Z'
const question = '关于「蛋白质折叠」，我还没有弄清的关键问题是什么？'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-investigation-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  const service = new InvestigationService(database, events, () => at)
  const seedSource = (): string => events.recordDeterministic(`test-gap:${randomUUID()}`, {
    sourceModule: 'cognition',
    eventType: 'cognition.knowledge_gap',
    actor: 'system',
    subjectType: 'interest',
    subjectId: 'protein',
    correlationId: null,
    payload: { label: 'protein' }
  }).event.id
  const thought = (overrides: { origin?: string; id?: string } = {}): { id: string; trigger: string; question: string; hypothesis: string; evidenceRefs: Array<{ origin?: string; synthetic?: boolean }> } => {
    const id = overrides.id ?? randomUUID()
    database.connection.prepare(`
      INSERT INTO morrow_thoughts(
        id, actor, trigger, question, hypothesis, evidence_json, counter_evidence_json,
        uncertainty, priority, status, created_at, updated_at, next_review_at, algorithm_version
      ) VALUES (?, 'morrow', 'morrow_interest', ?, ?, ?, '[]', 60, 0.6, 'open', ?, ?, NULL, 'inner-cognition-v1')
    `).run(id, question, '先核对前提。', JSON.stringify([{ turnId: '', conversationId: '', messageId: '', occurredAt: at, kind: 'reflection', ref: 'protein', synthetic: true, origin: overrides.origin ?? 'morrow' }]), at, at)
    return {
      id,
      trigger: 'morrow_interest',
      question,
      hypothesis: '先核对前提。',
      evidenceRefs: [{ origin: overrides.origin ?? 'morrow', synthetic: true }]
    }
  }
  return { directory, database, events, service, seedSource, thought }
}

const components: InvestigationPriorityComponents = {
  informationGap: 0.7,
  goalStall: 0.4,
  interestRelevance: 0.8,
  reflectionNovelty: 0.2,
  resourceAvailability: 0.9,
  cost: 0.3
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('investigation lifecycle', () => {
  it('scores with the agreed formula and records each component', () => {
    expect(investigationPriority({ informationGap: 1, goalStall: 1, interestRelevance: 1, reflectionNovelty: 1, resourceAvailability: 1, cost: 0 })).toBe(0.9)
    expect(investigationPriority({ informationGap: 1, goalStall: 1, interestRelevance: 1, reflectionNovelty: 1, resourceAvailability: 1, cost: 1 })).toBe(0.8)
    expect(investigationPriority({ informationGap: -1, goalStall: 2, interestRelevance: 0, reflectionNovelty: 0, resourceAvailability: 0, cost: 1 })).toBe(0.1)
  })

  it('opens through discovered, selected and hypothesized with a primary and alternative hypotheses', () => {
    const context = setup()
    try {
      const thought = context.thought()
      const investigation = context.service.begin({ thought, components, at })
      expect(investigation.state).toBe('hypothesized')
      expect(investigation.stateVersion).toBe(3)
      expect(investigation.primaryHypothesis).toBe('先核对前提。')
      expect(investigation.alternatives.length).toBeGreaterThanOrEqual(1)
      expect(investigation.components).toEqual(components)
      expect(investigation.priority).toBe(investigationPriority(components))
      const steps = context.service.steps(investigation.id)
      expect(steps.map((step) => step.to)).toEqual(['selected', 'hypothesized'])
      expect(steps.every((step) => step.sourceValid)).toBe(true)
    } finally {
      context.database.close()
    }
  })

  it('rejects illegal transitions and refuses non-Morrow evidence at open', () => {
    const context = setup()
    try {
      const investigation = context.service.begin({ thought: context.thought(), components, at })
      expect(() => context.service.transition(investigation.id, 'concluded', { at })).toThrow()
      expect(() => context.service.begin({ thought: context.thought({ origin: 'user' }), components, at })).toThrow()
    } finally {
      context.database.close()
    }
  })

  it('accepts verified evidence, rejects missing sources, and never counts synthetic discovery as independent', () => {
    const context = setup()
    try {
      const investigation = context.service.begin({ thought: context.thought(), components, at })
      context.service.transition(investigation.id, 'investigating', { at, sources: [] })
      const source = context.seedSource()
      const result = context.service.recordEvidence(investigation.id, {
        at,
        evidence: [
          { sourceId: source, kind: 'event' },
          { sourceId: randomUUID(), kind: 'event' },
          { sourceId: 'synthetic-discovery', kind: 'synthetic', synthetic: true }
        ],
        contradictions: [{ sourceId: randomUUID(), kind: 'event' }]
      })
      expect(result.accepted).toBe(2)
      expect(result.rejected).toBe(2)
      const updated = context.service.read(investigation.id)!
      expect(updated.evidence).toHaveLength(2)
      expect(updated.contradictions).toHaveLength(0)
      const last = context.service.steps(investigation.id).at(-1)!
      expect(last.sourceValid).toBe(false)
      expect(last.failureReason).toBe('source_invalid')
    } finally {
      context.database.close()
    }
  })

  it('closes from a reviewed state with the matching outcome', () => {
    const context = setup()
    try {
      const investigation = context.service.begin({ thought: context.thought(), components, at })
      const concluded = context.service.reviewFromState({ proposition: question, status: 'active', score: 72, independentContexts: 2 }, at)!
      expect(concluded.id).toBe(investigation.id)
      expect(concluded.state).toBe('concluded')
      expect(concluded.confidence).toBeCloseTo(0.72)
      expect(context.service.steps(investigation.id).map((step) => step.to)).toEqual([
        'selected', 'hypothesized', 'investigating', 'reviewing', 'concluded'
      ])
      const second = context.service.begin({ thought: context.thought({ id: randomUUID() }), components, at })
      const inconclusive = context.service.reviewFromState({ proposition: question, status: 'candidate', score: 40, independentContexts: 1 }, at)!
      expect(inconclusive.id).toBe(second.id)
      expect(inconclusive.state).toBe('inconclusive')
    } finally {
      context.database.close()
    }
  })

  it('suspends an overdue investigation, can resume it, and survives a database reopen', () => {
    const context = setup()
    try {
      const investigation = context.service.begin({
        thought: context.thought(),
        components,
        at,
        budget: { deadlineAt: '2026-11-10T12:05:00.000Z' }
      })
      expect(context.service.recover('2026-11-10T13:00:00.000Z')).toBe(1)
      const suspended = context.service.read(investigation.id)!
      expect(suspended.state).toBe('suspended')
      expect(suspended.failureReason).toBe('deadline_exceeded')
      const resumed = context.service.transition(investigation.id, 'selected', { at: '2026-11-10T13:10:00.000Z', reason: 'user_resumed' })
      expect(resumed.state).toBe('selected')

      context.database.close()
      const reopened = SqliteDatabase.open(join(context.directory, 'morrow.sqlite3'))
      try {
        const service = new InvestigationService(reopened, new EventLogService(reopened), () => at)
        const reread = service.read(investigation.id)!
        expect(reread.state).toBe('selected')
        expect(service.steps(investigation.id)).toHaveLength(4)
      } finally {
        reopened.close()
      }
    } finally {
      try { context.database.close() } catch { /* already closed */ }
    }
  })
})
