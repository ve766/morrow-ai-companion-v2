import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../memory-domain'
import { RETRIEVAL_ALGORITHM_V1, RETRIEVAL_ALGORITHM_V2, resolveRetrievalConfig } from './retrieval-config'
import { selectRetrievalStrategy } from './retrieval-registry'
import type { SupersededStatement } from './retrieval-supersession'
import { classifySupersession } from './retrieval-supersession'
import { classifyMemoryStability, isTimeSensitiveQuery } from './retrieval-v2'

const NOW = '2026-10-25T00:00:00.000Z'

function memory(id: string, text: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    originalText: text,
    currentText: text,
    sourceCategory: 'user_explicit_input',
    status: 'active',
    sensitivity: 'personal',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    revision: 1,
    confidence: 85,
    lastConfirmedAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function run(algorithm: typeof RETRIEVAL_ALGORITHM_V1 | typeof RETRIEVAL_ALGORITHM_V2, query: string, records: MemoryRecord[], superseded: SupersededStatement[] = [], config = {}) {
  const resolved = resolveRetrievalConfig({ algorithm, ...config })
  return selectRetrievalStrategy(algorithm).retrieve({
    query,
    records,
    supersededStatements: superseded,
    maximumSensitivity: 'personal',
    now: NOW,
    config: resolved
  })
}

describe('retrieval configuration', () => {
  it('defaults to the audited baseline algorithm and exposes every ranking parameter', () => {
    const config = resolveRetrievalConfig()
    expect(config.algorithm).toBe(RETRIEVAL_ALGORITHM_V1)
    expect(config.configVersion).toBe('2.1.0')
    expect(config.maxMemories).toBe(25)
    expect(config.maxCharacters).toBe(3000)
    expect(Object.keys(config.weights).sort()).toEqual([
      'confidence', 'confirmation', 'diversityPenalty', 'lexical', 'provenance', 'recency', 'timeSensitivity'
    ])
  })

  it('rejects out-of-range values instead of silently clamping them', () => {
    expect(() => resolveRetrievalConfig({ maxMemories: 0 })).toThrowError('INVALID_INPUT')
    expect(() => resolveRetrievalConfig({ maxCharacters: 10 })).toThrowError('INVALID_INPUT')
    expect(() => resolveRetrievalConfig({ weights: { lexical: -1 } })).toThrowError('INVALID_INPUT')
    expect(() => resolveRetrievalConfig({ weights: { recency: Number.NaN } })).toThrowError('INVALID_INPUT')
    expect(() => resolveRetrievalConfig({ decay: { explicitHalfLifeDays: 0 } })).toThrowError('INVALID_INPUT')
    expect(() => resolveRetrievalConfig({ provenanceScores: { user_explicit_input: 2 } })).toThrowError('INVALID_INPUT')
    expect(() => resolveRetrievalConfig({ duplicateOverlapThreshold: 0.1 })).toThrowError('INVALID_INPUT')
    expect(() => resolveRetrievalConfig({ algorithm: 'memory-retrieval-v9' as never })).toThrowError('INVALID_INPUT')
  })

  it('merges partial overrides without losing the other defaults', () => {
    const config = resolveRetrievalConfig({ weights: { lexical: 0.7 }, maxMemories: 5 })
    expect(config.weights.lexical).toBe(0.7)
    expect(config.weights.recency).toBe(0.2)
    expect(config.maxMemories).toBe(5)
    expect(config.maxCharacters).toBe(3000)
  })
})

describe('stability and time-sensitivity cues', () => {
  it('treats a restated preference as stable even when it carries a temporal word', () => {
    expect(classifyMemoryStability('I prefer green tea in the afternoon.')).toBe('stable')
    expect(classifyMemoryStability('我现在喜欢喝红茶')).toBe('stable')
    expect(classifyMemoryStability('我喜欢咖啡')).toBe('stable')
  })

  it('treats a temporary need as ephemeral', () => {
    expect(classifyMemoryStability('I am working late tonight.')).toBe('ephemeral')
    expect(classifyMemoryStability('今天很累')).toBe('ephemeral')
    expect(classifyMemoryStability('The user has a cold this week.')).toBe('ephemeral')
  })

  it('leaves a plain fact unspecified', () => {
    expect(classifyMemoryStability('The user lives in Suzhou.')).toBe('unspecified')
    expect(classifyMemoryStability('用户住在苏州')).toBe('unspecified')
  })

  it('detects a time-sensitive turn', () => {
    expect(isTimeSensitiveQuery('What should I eat today?')).toBe(true)
    expect(isTimeSensitiveQuery('我今晚应该做什么')).toBe(true)
    expect(isTimeSensitiveQuery('What do I usually prefer?')).toBe(false)
  })
})

describe('correction chain classification', () => {
  const superseded: SupersededStatement[] = [{
    memoryId: 'm1',
    revision: 1,
    text: 'I like green tea.',
    supersededAt: '2026-09-01T00:00:00.000Z',
    supersedingConfirmedAt: '2026-09-01T00:00:00.000Z'
  }]

  it('marks a re-created copy of the replaced statement as resurrected', () => {
    const copy = memory('m2', 'I like green tea.', { createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', lastConfirmedAt: '2026-09-10T00:00:00.000Z' })
    expect(classifySupersession(copy, superseded)).toBe('resurrected')
  })

  it('does not treat a merely similar statement as a resurrection', () => {
    const similar = memory('m4', 'I like green tea with jasmine.', { lastConfirmedAt: '2026-10-01T00:00:00.000Z' })
    expect(classifySupersession(similar, superseded)).toBe('none')
  })

  it('never applies a memory to its own revision history', () => {
    const corrected = memory('m1', 'I prefer black tea.', { lastConfirmedAt: '2026-09-01T00:00:00.000Z' })
    expect(classifySupersession(corrected, superseded)).toBe('none')
  })
})

describe('v2 retrieval semantics', () => {
  it('never returns retracted, over-sensitive or unrelated memories', () => {
    const result = run(RETRIEVAL_ALGORITHM_V2, 'coffee', [
      memory('a', 'I like coffee.', { status: 'retracted' }),
      memory('b', 'I like coffee a lot.', { sensitivity: 'sensitive' }),
      memory('c', 'The user lives in Suzhou.'),
      memory('d', 'I drink coffee every morning.')
    ])
    expect(result.context.selected.map((item) => item.id)).toEqual(['d'])
    expect(result.decision.exclusionCounts.retracted).toBe(1)
    expect(result.decision.exclusionCounts.sensitivity).toBe(1)
    expect(result.decision.exclusionCounts.irrelevant).toBe(1)
  })

  it('returns nothing for an empty query instead of padding the budget', () => {
    const result = run(RETRIEVAL_ALGORITHM_V2, '', [memory('a', 'I like coffee.'), memory('b', 'I live in Suzhou.')])
    expect(result.context.selected).toEqual([])
    expect(result.decision.exclusionCounts.irrelevant).toBe(2)
  })

  it('drops a statement the user already replaced instead of letting repetition win', () => {
    const superseded: SupersededStatement[] = [{
      memoryId: 'orig',
      revision: 1,
      text: 'I like green tea.',
      supersededAt: '2026-09-01T00:00:00.000Z',
      supersedingConfirmedAt: '2026-09-01T00:00:00.000Z'
    }]
    const result = run(RETRIEVAL_ALGORITHM_V2, 'green tea', [
      memory('orig', 'I prefer black tea.', { lastConfirmedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }),
      memory('copy', 'I like green tea.', { lastConfirmedAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z' })
    ], superseded)
    expect(result.decision.exclusionCounts.superseded_statement).toBe(1)
    expect(result.context.selected.map((item) => item.id)).not.toContain('copy')
  })

  it('keeps the corrected memory retrievable while the resurrected copy stays out', () => {
    const superseded: SupersededStatement[] = [{
      memoryId: 'orig',
      revision: 1,
      text: 'I like green tea.',
      supersededAt: '2026-09-01T00:00:00.000Z',
      supersedingConfirmedAt: '2026-09-01T00:00:00.000Z'
    }]
    const result = run(RETRIEVAL_ALGORITHM_V2, 'green tea black tea', [
      memory('orig', 'I prefer black tea.', { lastConfirmedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }),
      memory('again', 'I like green tea.', { lastConfirmedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' })
    ], superseded)
    const ids = result.context.selected.map((item) => item.id)
    expect(ids).toContain('orig')
    expect(ids).not.toContain('again')
    expect(result.decision.candidates.find((item) => item.memoryId === 'again')?.exclusionReason).toBe('superseded_statement')
  })

  it('deduplicates identical content and near-identical restatements', () => {
    const result = run(RETRIEVAL_ALGORITHM_V2, 'coffee morning', [
      memory('a', 'I drink coffee every morning.'),
      memory('b', 'I drink coffee every morning.'),
      memory('c', 'I drink coffee every morning before work.')
    ], [], { duplicateOverlapThreshold: 0.7 })
    expect(result.decision.exclusionCounts.duplicate).toBeGreaterThanOrEqual(1)
    expect(result.context.selected.length).toBeLessThanOrEqual(2)
  })

  it('skips an oversized memory without blocking smaller ones', () => {
    const result = run(RETRIEVAL_ALGORITHM_V2, 'coffee', [
      memory('big', `coffee ${'x'.repeat(4000)}`),
      memory('small', 'coffee')
    ], [], { maxCharacters: 400 })
    expect(result.context.selected.map((item) => item.id)).toEqual(['small'])
    expect(result.context.characterCount).toBeLessThanOrEqual(400)
  })

  it('prefers an explicitly stated memory over an accepted model inference when lexical evidence is equal', () => {
    const result = run(RETRIEVAL_ALGORITHM_V2, 'green tea', [
      memory('explicit', 'Green tea is my preference.', { sourceCategory: 'user_explicit_input', confidence: 85 }),
      memory('inferred', 'Green tea is my preference.', { id: 'inferred', sourceCategory: 'model_inferred_confirmed', confidence: 85 })
    ])
    expect(result.context.selected[0]?.id).toBe('explicit')
  })
})

describe('determinism and replay', () => {
  const records = [
    memory('a', 'I drink coffee every morning.', { lastConfirmedAt: '2026-09-01T00:00:00.000Z' }),
    memory('b', 'I drink coffee before work.', { lastConfirmedAt: '2026-09-02T00:00:00.000Z' }),
    memory('c', 'I prefer tea in the afternoon.', { lastConfirmedAt: '2026-09-03T00:00:00.000Z' })
  ]

  it('produces byte-identical output for the same inputs on both algorithms', () => {
    for (const algorithm of [RETRIEVAL_ALGORITHM_V1, RETRIEVAL_ALGORITHM_V2] as const) {
      const first = run(algorithm, 'coffee', records)
      const second = run(algorithm, 'coffee', records)
      expect(second.context.text).toBe(first.context.text)
      expect(second.decision.selectedIds).toEqual(first.decision.selectedIds)
    }
  })

  it('does not depend on input array order for the selected set', () => {
    const forward = run(RETRIEVAL_ALGORITHM_V2, 'coffee', records)
    const reversed = run(RETRIEVAL_ALGORITHM_V2, 'coffee', [...records].reverse())
    expect([...reversed.decision.selectedIds].sort()).toEqual([...forward.decision.selectedIds].sort())
  })

  it('ages memories deterministically as the evaluation instant moves', () => {
    const early = run(RETRIEVAL_ALGORITHM_V2, 'coffee', records)
    const laterConfig = resolveRetrievalConfig({ algorithm: RETRIEVAL_ALGORITHM_V2 })
    const later = selectRetrievalStrategy(RETRIEVAL_ALGORITHM_V2).retrieve({
      query: 'coffee',
      records,
      supersededStatements: [],
      maximumSensitivity: 'personal',
      now: '2027-10-25T00:00:00.000Z',
      config: laterConfig
    })
    const earlyRecency = early.decision.candidates.find((item) => item.memoryId === 'a')?.factors.recency ?? 0
    const laterRecency = later.decision.candidates.find((item) => item.memoryId === 'a')?.factors.recency ?? 0
    expect(laterRecency).toBeLessThan(earlyRecency)
  })
})
