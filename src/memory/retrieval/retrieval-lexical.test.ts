import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../memory-domain'
import { MemoryContextAssembler } from '../memory-context-assembler'
import { RETRIEVAL_ALGORITHM_V2, RETRIEVAL_ALGORITHM_V3_HYBRID, resolveRetrievalConfig } from './retrieval-config'
import { buildLexicalIndex, lexicalScore, lexicalScoreWithIndex, retrievalTerms } from './retrieval-lexical'
import { selectRetrievalStrategy } from './retrieval-registry'

// Regression suite for the substring-matching defect.
//
// Every "does not match" case below returned a positive score under the old
// `content.includes(term)` implementation. The `substring` mode is asserted
// alongside so the tests prove they discriminate between the two behaviours
// rather than merely describing the new one.

const NOW = '2026-10-25T00:00:00.000Z'

function score(content: string, query: string, matching: 'token' | 'substring' = 'token'): number {
  const terms = retrievalTerms(query)
  const phrase = query.normalize('NFKC').trim().toLocaleLowerCase()
  return lexicalScore(content, terms, phrase, matching)
}

/** True when the query matches the content at all, which is what the defect was about. */
function matches(content: string, query: string, matching: 'token' | 'substring' = 'token'): boolean {
  return score(content, query, matching) > 0
}

function memory(id: string, text: string): MemoryRecord {
  return {
    id,
    originalText: text,
    currentText: text,
    sourceCategory: 'user_explicit_input',
    status: 'active',
    sensitivity: 'personal',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    revision: 1,
    confidence: 85,
    lastConfirmedAt: '2026-09-01T00:00:00.000Z'
  }
}

describe('short Latin terms do not match inside longer words', () => {
  it('does not match "an" inside "analyst"', () => {
    const content = 'I work as a data analyst.'
    expect(score(content, 'an')).toBe(0)
    // The pre-fix behaviour, kept reproducible for the frozen benchmark.
    expect(score(content, 'an', 'substring')).toBeGreaterThan(0)
  })

  it('does not match "is" inside "analysis" or "this"', () => {
    expect(matches('This belongs elsewhere.', 'is')).toBe(false)
    expect(matches('The analysis is complete.', 'is')).toBe(true)
    expect(matches('analysis', 'is', 'substring')).toBe(true)
  })

  it('does not match "tea" inside "steam" or "instead"', () => {
    expect(score('The steam rose.', 'tea')).toBe(0)
    expect(score('I chose instead.', 'tea')).toBe(0)
    expect(matches('I drink tea.', 'tea')).toBe(true)
  })

  it('does not match "ai" inside "said" or "daily"', () => {
    expect(score('She said it daily.', 'ai')).toBe(0)
    expect(matches('I use AI every day.', 'ai')).toBe(true)
  })

  it('does not match a number inside a longer number', () => {
    expect(score('The plan for 2026 is set.', '26')).toBe(0)
    expect(matches('The plan for 2026 is set.', '2026')).toBe(true)
  })
})

describe('token boundaries respect punctuation, case and Unicode form', () => {
  it('matches across punctuation', () => {
    expect(matches('I like tea, coffee and juice.', 'tea')).toBe(true)
    expect(matches('Tea.', 'tea')).toBe(true)
  })

  it('normalizes case and full-width forms before matching', () => {
    expect(matches('I prefer TEA.', 'tea')).toBe(true)
    expect(matches('I prefer tea.', 'ＴＥＡ')).toBe(true)
    expect(matches('Ｉ　ｐｒｅｆｅｒ　ｔｅａ．', 'tea')).toBe(true)
  })

  it('keeps hyphenated and underscored tokens matchable as separate tokens', () => {
    expect(matches('The state-of-the-art result.', 'art')).toBe(true)
    expect(matches('Set the build_flag now.', 'build')).toBe(true)
    expect(matches('Set the build_flag now.', 'flag')).toBe(true)
  })
})

describe('Chinese text still matches without word delimiters', () => {
  it('matches a two-character term inside a longer run', () => {
    // Phrase bonus (4) plus one term hit: the whole query occurs verbatim.
    expect(score('我更喜欢素食。', '素食')).toBe(5)
  })

  it('matches a multi-character term when all its bigrams are present', () => {
    expect(matches('我更喜欢素食。', '喜欢素食')).toBe(true)
  })

  it('does not match a bigram that is absent', () => {
    expect(score('我更喜欢素食。', '食主')).toBe(0)
    expect(score('我更喜欢素食。', '食主', 'substring')).toBe(0)
  })

  it('does not match unrelated Chinese characters', () => {
    expect(score('我更喜欢素食。', '跑步')).toBe(0)
  })

  it('matches a mixed Chinese and Latin sentence on both parts', () => {
    const content = '我早上喝咖啡，然后喝 coffee。'
    expect(matches(content, '咖啡')).toBe(true)
    expect(matches(content, 'coffee')).toBe(true)
    // Each script run is checked with its own rule, so the mixed phrase matches
    // as a whole: phrase bonus 4 + two term hits.
    expect(score(content, '咖啡 coffee')).toBe(6)
    // Only the Chinese term hits here; the Latin run is absent, so no phrase bonus.
    expect(score(content, '咖啡 tea')).toBe(1)
  })
})

describe('phrase matching uses the same boundaries', () => {
  it('awards the phrase bonus for a contiguous run', () => {
    const terms = retrievalTerms('green tea')
    const index = buildLexicalIndex('I like green tea.')
    expect(lexicalScoreWithIndex(index, terms, 'green tea')).toBe(6)
  })

  it('does not award a phrase bonus for a substring hit', () => {
    expect(score('I work as a data analyst.', 'an')).toBe(0)
    expect(score('The steam rose.', 'tea')).toBe(0)
  })

  it('awards a Chinese phrase bonus through bigrams', () => {
    expect(score('我更喜欢素食。', '素食')).toBe(5)
  })
})

describe('both retrieval paths reject the false positive', () => {
  const records = [memory('analyst', 'I work as a data analyst.'), memory('osaka', 'I visited Osaka last spring.')]

  it('v1 assembler returns nothing for a question about swallows', () => {
    const assembler = new MemoryContextAssembler()
    const context = assembler.assemble('What is the airspeed of an unladen swallow?', records, 'personal', 25, 3000, NOW)
    expect(context.selected).toEqual([])
  })

  it('v2 multi-signal returns nothing for the same question', () => {
    const config = resolveRetrievalConfig({ algorithm: RETRIEVAL_ALGORITHM_V2 })
    const result = selectRetrievalStrategy(RETRIEVAL_ALGORITHM_V2).retrieve({
      query: 'What is the airspeed of an unladen swallow?',
      records,
      supersededStatements: [],
      supersededTruncated: false,
      maximumSensitivity: 'personal',
      now: NOW,
      config
    })
    expect(result.context.selected).toEqual([])
    expect(result.decision.exclusionCounts.irrelevant).toBe(2)
  })

  it('v3 hybrid without signals behaves the same way', () => {
    const config = resolveRetrievalConfig({ algorithm: RETRIEVAL_ALGORITHM_V3_HYBRID })
    const result = selectRetrievalStrategy(RETRIEVAL_ALGORITHM_V3_HYBRID).retrieve({
      query: 'What is the airspeed of an unladen swallow?',
      records,
      supersededStatements: [],
      supersededTruncated: false,
      maximumSensitivity: 'personal',
      now: NOW,
      config
    })
    expect(result.context.selected).toEqual([])
  })

  it('still retrieves a genuine whole-token match on both paths', () => {
    const assembler = new MemoryContextAssembler()
    expect(assembler.assemble('data analyst', records, 'personal', 25, 3000, NOW).selected.map((item) => item.id))
      .toEqual(['analyst'])

    const config = resolveRetrievalConfig({ algorithm: RETRIEVAL_ALGORITHM_V2 })
    const result = selectRetrievalStrategy(RETRIEVAL_ALGORITHM_V2).retrieve({
      query: 'data analyst',
      records,
      supersededStatements: [],
      supersededTruncated: false,
      maximumSensitivity: 'personal',
      now: NOW,
      config
    })
    expect(result.context.selected.map((item) => item.id)).toEqual(['analyst'])
  })

  it('keeps Chinese recall on both paths', () => {
    const chinese = [memory('veg', '我更喜欢素食。'), memory('run', '我每周跑步三次。')]
    const assembler = new MemoryContextAssembler()
    expect(assembler.assemble('晚饭吃什么素食好', chinese, 'personal', 25, 3000, NOW).selected.map((item) => item.id))
      .toEqual(['veg'])

    const config = resolveRetrievalConfig({ algorithm: RETRIEVAL_ALGORITHM_V2 })
    const result = selectRetrievalStrategy(RETRIEVAL_ALGORITHM_V2).retrieve({
      query: '晚饭吃什么素食好',
      records: chinese,
      supersededStatements: [],
      supersededTruncated: false,
      maximumSensitivity: 'personal',
      now: NOW,
      config
    })
    expect(result.context.selected.map((item) => item.id)).toEqual(['veg'])
  })
})

describe('matching mode is explicit and validated', () => {
  it('defaults to token matching', () => {
    expect(resolveRetrievalConfig().lexicalMatching).toBe('token')
  })

  it('still allows the frozen substring mode for reproduction', () => {
    expect(resolveRetrievalConfig({ lexicalMatching: 'substring' }).lexicalMatching).toBe('substring')
  })

  it('rejects an unknown mode instead of silently defaulting', () => {
    expect(() => resolveRetrievalConfig({ lexicalMatching: 'fuzzy' as never })).toThrowError('INVALID_INPUT')
  })
})
