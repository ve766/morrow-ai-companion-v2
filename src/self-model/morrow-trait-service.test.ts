import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { deriveGrowthSignals } from '../personalization/personality-growth'
import {
  MorrowTraitService,
  TRAIT_DEFINITIONS,
  foldTraitObservations,
  traitObservationFromEmotion,
  type TraitObservationInput
} from './morrow-trait-service'
import { emotionProfile } from '../affective-state/emotion-model'

const directories: string[] = []
const start = '2026-11-01T00:00:00.000Z'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-traits-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  let currentTime = start
  const traits = new MorrowTraitService(database, () => currentTime)
  return {
    directory,
    database,
    traits,
    path: join(directory, 'morrow.sqlite3'),
    setTime(value: string) { currentTime = value },
    at(hours: number): string { return new Date(Date.parse(start) + hours * 3_600_000).toISOString() }
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function observation(input: Partial<TraitObservationInput> & { at: string; turnId: string; conversationId: string; contextTag: string }, signal = 0.8): TraitObservationInput {
  return {
    traitKey: 'curiosity',
    turnId: input.turnId,
    conversationId: input.conversationId,
    sourceMessageId: null,
    sourceEventId: randomUUID(),
    sourceKind: 'morrow_self_appraisal',
    signal,
    weight: 0.9,
    quality: 0.9,
    contextTag: input.contextTag,
    at: input.at
  }
}

describe('Morrow trait evidence gate', () => {
  it('keeps a single observation as a candidate and never promotes it', () => {
    const context = setup()
    try {
      const revision = context.traits.observe(observation({ at: start, turnId: randomUUID(), conversationId: randomUUID(), contextTag: '数据库' }))!
      expect(revision.status).toBe('candidate')
      expect(revision.strength).toBeLessThan(0.5)
      expect(revision.evidenceCount).toBe(1)
    } finally {
      context.database.close()
    }
  })

  it('promotes only after independent conversations, two contexts and a 24h window', () => {
    const context = setup()
    try {
      const conversations = [randomUUID(), randomUUID(), randomUUID()]
      const contexts = ['数据库', '分布式系统']
      let revision = context.traits.observe(observation({ at: context.at(0), turnId: randomUUID(), conversationId: conversations[0]!, contextTag: contexts[0]! }))!
      expect(revision.status).toBe('candidate')
      revision = context.traits.observe(observation({ at: context.at(1), turnId: randomUUID(), conversationId: conversations[1]!, contextTag: contexts[1]! }))!
      expect(revision.status).toBe('candidate')
      for (const [index, hours] of [2, 3, 25, 26, 27].entries()) {
        revision = context.traits.observe(observation({ at: context.at(hours), turnId: randomUUID(), conversationId: conversations[index % conversations.length]!, contextTag: index % 2 === 0 ? contexts[0]! : contexts[1]! }))!
      }
      expect(revision.independentContexts).toBe(3)
      expect(revision.distinctContexts).toBe(2)
      expect(revision.status).toBe('active')
      expect(revision.strength).toBeGreaterThanOrEqual(0.5)
      const active = context.traits.active()
      expect(active.some((entry) => entry.traitKey === 'curiosity' && entry.status === 'active')).toBe(true)
    } finally {
      context.database.close()
    }
  })

  it('does not double count a repeated observation from the same turn and context', () => {
    const context = setup()
    try {
      const turnId = randomUUID()
      const conversationId = randomUUID()
      const first = context.traits.observe(observation({ at: context.at(0), turnId, conversationId, contextTag: '数据库' }))!
      const second = context.traits.observe(observation({ at: context.at(12), turnId, conversationId, contextTag: '数据库' }))!
      expect(second.evidenceCount).toBe(first.evidenceCount)
      expect(second.independentContexts).toBe(1)
    } finally {
      context.database.close()
    }
  })

  it('restores the same active trait after a database reopen', () => {
    const context = setup()
    try {
      const conversations = [randomUUID(), randomUUID(), randomUUID()]
      for (const [index, at] of [0, 1, 2, 3, 25, 26, 27].entries()) {
        context.traits.observe(observation({ at: context.at(at), turnId: randomUUID(), conversationId: conversations[index % conversations.length]!, contextTag: index % 2 === 1 ? '分布式系统' : '数据库' }))
      }
      const before = context.traits.current('curiosity')!
      expect(before.status).toBe('active')
      context.database.close()
      const reopenedDatabase = SqliteDatabase.open(context.path)
      try {
        const reopened = new MorrowTraitService(reopenedDatabase, () => context.at(28))
        const after = reopened.current('curiosity')!
        expect(after.status).toBe(before.status)
        expect(after.score).toBe(before.score)
        expect(after.evidenceCount).toBe(before.evidenceCount)
      } finally {
        reopenedDatabase.close()
      }
    } finally {
      try { context.database.close() } catch { /* already closed */ }
    }
  })

  it('weakens an active trait when counter-evidence arrives', () => {
    const context = setup()
    try {
      const conversations = [randomUUID(), randomUUID(), randomUUID()]
      for (const [index, at] of [0, 1, 2, 3, 25, 26, 27].entries()) {
        context.traits.observe(observation({ at: context.at(at), turnId: randomUUID(), conversationId: conversations[index % conversations.length]!, contextTag: index % 2 === 1 ? '分布式系统' : '数据库' }))
      }
      expect(context.traits.current('curiosity')?.status).toBe('active')
      for (let index = 0; index < 3; index += 1) {
        context.traits.addCounterEvidence(observation({ at: context.at(26 + index), turnId: randomUUID(), conversationId: randomUUID(), contextTag: '数据库' }, -0.9))
      }
      const weakened = context.traits.current('curiosity')!
      expect(['weakened', 'conflict_pending']).toContain(weakened.status)
      expect(weakened.counterEvidenceRefs.length).toBeGreaterThan(0)
    } finally {
      context.database.close()
    }
  })

  it('does not turn an explicit user style request into a Morrow trait', () => {
    const context = setup()
    try {
      const signals = deriveGrowthSignals({
        analysis: { intent: 'feedback', confidenceScore: 80, uncertainty: 'low', signals: { correction: false, negation: false, changedMind: false, explicitGoal: false, explicitConstraint: false, explicitMemoryRequest: false, explicitMemorySaveRequest: false, explicitSelfFact: false, topicSwitch: false } },
        content: '请你以后说话温柔一点。'
      })
      expect(signals.length).toBeGreaterThan(0)
      expect(context.traits.active()).toEqual([])
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM morrow_trait_observations').get()?.count).toBe(0)
    } finally {
      context.database.close()
    }
  })

  it('maps only Morrow-owned emotion candidates into observations', () => {
    const profile = emotionProfile('curiosity')
    const base = {
      family: 'curiosity' as const,
      intensity: 0.6,
      valence: 0.4,
      arousal: 0.5,
      appraisal: { goalRelevance: 0.7, goalCongruence: 0.3, novelty: 0.7, agency: 0.8, certainty: 0.7, responsibility: 0.4, relationshipRelevance: 0.3, expectationGap: 0.2 },
      confidence: 0.75,
      uncertainty: 'low' as const,
      topicTags: ['数据库'],
      evidenceRefs: [{ kind: 'conversation_message' as const, id: randomUUID(), role: 'user' as const }],
      decayProfile: { halfLifeHours: profile.decayHalfLifeHours },
      rationale: 'test',
      traitEligible: true
    }
    const refs = { turnId: randomUUID(), conversationId: randomUUID(), sourceMessageId: randomUUID(), sourceEventId: randomUUID(), at: start }
    expect(traitObservationFromEmotion({ ...base, sourceKind: 'shared_interaction' }, refs)).toBeNull()
    expect(traitObservationFromEmotion({ ...base, sourceKind: 'morrow_self_appraisal' }, refs)?.traitKey).toBe('curiosity')
    expect(traitObservationFromEmotion({ ...base, sourceKind: 'morrow_self_appraisal', traitEligible: false }, refs)).toBeNull()
  })

  it('filters the prompt block by topic and clears all evidence', () => {
    const context = setup()
    try {
      const conversations = [randomUUID(), randomUUID(), randomUUID()]
      for (const [index, at] of [0, 1, 2, 3, 25, 26, 27].entries()) {
        context.traits.observe(observation({ at: context.at(at), turnId: randomUUID(), conversationId: conversations[index % conversations.length]!, contextTag: index % 2 === 1 ? '分布式系统' : '数据库' }))
      }
      expect(context.traits.contextBlock('数据库查询优化')).toContain('curiosity')
      expect(context.traits.contextBlock('烘焙面包的温度')).toBe('')
      expect(context.traits.clearAll()).toBeGreaterThan(0)
      expect(context.traits.active()).toEqual([])
    } finally {
      context.database.close()
    }
  })

  it('exposes a versioned, bounded fold for audit', () => {
    const rows = [0, 1, 25].map((hours, index) => ({
      id: randomUUID(),
      traitKey: 'carefulness' as const,
      turnId: randomUUID(),
      conversationId: randomUUID(),
      sourceMessageId: null,
      sourceEventId: randomUUID(),
      sourceKind: 'morrow_self_appraisal' as const,
      signal: 0.8,
      weight: 0.9,
      quality: 0.9,
      contextTag: index === 1 ? '部署' : '数据库',
      at: new Date(Date.parse(start) + hours * 3_600_000).toISOString()
    }))
    const fold = foldTraitObservations(rows, new Date(Date.parse(start) + 26 * 3_600_000).toISOString(), TRAIT_DEFINITIONS.carefulness)
    expect(fold.score).toBeGreaterThan(0.5)
    expect(fold.strength).toBeLessThanOrEqual(1)
    expect(fold.applied).toBe(true)
    expect(fold.counterPenalty).toBe(0)
  })
})
