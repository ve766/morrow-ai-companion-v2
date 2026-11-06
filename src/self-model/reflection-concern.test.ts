import { describe, expect, it } from 'vitest'
import {
  CONCERN_IDENTITY_VERSION,
  concernDigestOf,
  concernKeyOf,
  isConcernKind,
  legacyConcernDigestOf,
  normalizeConcern,
  reflectionPendingKeys
} from './reflection-concern'

describe('reflection concern identity', () => {
  it('is stable across compatibility forms, whitespace, full-width punctuation and zero-width characters', () => {
    const a = '我对「量子计算」还没有可靠的理解；这是我自己尚未解决的问题。'
    const b = '  我对「量子计算」还没有可靠的理解;  这是我自己尚未解决的问题。\u200B '
    expect(normalizeConcern(a)).toBe(normalizeConcern(b))
    expect(concernKeyOf('open_question', a)).toBe(concernKeyOf('open_question', b))
  })

  it('never merges statements that differ in negation, number, time, entity or kind', () => {
    const base = '存在 2 次纠正'
    expect(concernKeyOf('memory_gap', base)).not.toBe(concernKeyOf('memory_gap', '不存在 2 次纠正'))
    expect(concernKeyOf('memory_gap', base)).not.toBe(concernKeyOf('memory_gap', '存在 3 次纠正'))
    expect(concernKeyOf('memory_gap', base)).not.toBe(concernKeyOf('memory_gap', '存在 2 次纠正，明天再说'))
    expect(concernKeyOf('memory_gap', base)).not.toBe(concernKeyOf('memory_gap', '存在 2 次纠正，小林'))
    expect(concernKeyOf('memory_gap', base)).not.toBe(concernKeyOf('open_question', base))
  })

  it('distinguishes concern kinds from evidence-consuming kinds', () => {
    expect(isConcernKind('open_question')).toBe(true)
    expect(isConcernKind('intent_correction')).toBe(true)
    expect(isConcernKind('memory_gap')).toBe(true)
    expect(isConcernKind('consistency_note')).toBe(true)
    expect(isConcernKind('interest_candidate')).toBe(false)
    expect(isConcernKind('morrow_interest_candidate')).toBe(false)
  })

  it('versions the identity and keeps the pending lookup keys readable', () => {
    expect(CONCERN_IDENTITY_VERSION).toBe(1)
    expect(concernKeyOf('open_question', '问题')).toMatch(/^[0-9a-f]{64}$/u)
    const keys = reflectionPendingKeys('open_question', '问题')
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBe(`reflection:open_question:${concernDigestOf('问题')}`)
    // A raw statement whose normalisation changes exposes both keys.
    const awkward = '问题；'
    const both = reflectionPendingKeys('open_question', awkward)
    expect(both).toContain(`reflection:open_question:${concernDigestOf(awkward)}`)
    expect(both).toContain(`reflection:open_question:${legacyConcernDigestOf(awkward)}`)
  })
})
