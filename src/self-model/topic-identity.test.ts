import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildTopicProfile,
  detectNegation,
  matchTopicTexts,
  mergeTopicProfiles,
  parseTopicProfile,
  scoreTopicProfiles,
  TOPIC_SAME_THRESHOLD
} from './topic-identity'

interface DevPair {
  id: string
  kind: string
  left: string
  right: string
  label: 'same' | 'different'
}

const devSet = JSON.parse(
  readFileSync(resolve(process.cwd(), 'evals/stage-2/topic-identity-devset.json'), 'utf8')
) as { pairs: DevPair[] }

describe('topic identity matcher', () => {
  it('is deterministic and ignores punctuation, spacing and case', () => {
    const left = buildTopicProfile('Coffee, Latte Art!')
    const right = buildTopicProfile('coffee latte   art')
    expect(scoreTopicProfiles(left, right).score).toBe(1)
    expect(scoreTopicProfiles(left, right).decision).toBe('same')
    // Same inputs must always produce the same number; nothing here is random.
    expect(matchTopicTexts('我最近在学咖啡拉花', '还在练咖啡拉花').score)
      .toBe(matchTopicTexts('我最近在学咖啡拉花', '还在练咖啡拉花').score)
  })

  it('merges phrasing variants of one topic across sessions', () => {
    const match = matchTopicTexts('我最近在学咖啡拉花', '还在练咖啡拉花')
    expect(match.decision).toBe('same')
    expect(match.reason).toBe('same_topic')
    expect(match.score).toBeGreaterThanOrEqual(TOPIC_SAME_THRESHOLD)
  })

  it('refuses a hypernym as evidence for a specific topic', () => {
    const broad = matchTopicTexts('咖啡', '咖啡拉花')
    expect(broad.decision).toBe('different')
    expect(broad.reason).toBe('hypernym_or_too_short')
  })

  it('flags a substituted subject instead of merging it', () => {
    for (const [left, right] of [['我喜欢猫', '我喜欢狗'], ['I am learning guitar', 'I am learning piano']]) {
      const match = matchTopicTexts(left!, right!)
      expect(match.decision).toBe('ambiguous')
      expect(match.reason).toBe('object_substitution_suspected')
    }
  })

  it('treats a reversal as opposite polarity, not as corroboration', () => {
    const match = matchTopicTexts('我喜欢咖啡拉花', '我不喜欢咖啡拉花了')
    expect(match.decision).toBe('different')
    expect(match.reason).toBe('polarity_conflict')
    expect(match.signals.polarityConflict).toBe(true)
  })

  it('does not read a negation character inside an ordinary word as a reversal', () => {
    // "特别" contains 别; treating it as negation would discard a genuine
    // interest observation, which is how the first version of this module
    // silently dropped "我对天文学特别着迷".
    expect(detectNegation('我对天文学特别着迷')).toBe(false)
    expect(detectNegation('不错，我很喜欢')).toBe(false)
    expect(detectNegation('我不喜欢咖啡拉花了')).toBe(true)
    expect(detectNegation('I do not like latte art')).toBe(true)
  })

  it('keeps the profile merge idempotent for the same text', () => {
    const profile = buildTopicProfile('我最近在学咖啡拉花')
    const merged = mergeTopicProfiles(profile, profile)
    expect(merged.preferred).toEqual(profile.preferred)
    expect(merged.bigrams).toEqual(profile.bigrams)
  })

  it('rejects a malformed stored profile instead of trusting it', () => {
    expect(parseTopicProfile(null)).toBeNull()
    expect(parseTopicProfile({ unigrams: [], bigrams: [] })).toBeNull()
    expect(parseTopicProfile({ unigrams: [1], bigrams: [], preferred: [] })).toBeNull()
    expect(parseTopicProfile({ unigrams: ['a'], bigrams: ['ab'], preferred: ['ab'], negated: 'yes' }))
      .toEqual({ unigrams: ['a'], bigrams: ['ab'], preferred: ['ab'], negated: false })
  })
})

describe('topic identity development set', () => {
  it('keeps zero false merges and recall at or above 0.85', () => {
    let truePositive = 0
    let falsePositive = 0
    let falseNegative = 0
    const misses: string[] = []
    for (const pair of devSet.pairs) {
      const predicted = matchTopicTexts(pair.left, pair.right).decision === 'same' ? 'same' : 'different'
      if (predicted === 'same' && pair.label === 'same') truePositive += 1
      else if (predicted === 'same') falsePositive += 1
      else if (pair.label === 'same') {
        falseNegative += 1
        misses.push(pair.id)
      }
    }
    const recall = truePositive / (truePositive + falseNegative)
    // A false merge is the dangerous error: it lets one topic's evidence feed
    // another. Recall loss only delays a promotion, so the bar is asymmetric.
    expect(falsePositive).toBe(0)
    expect(recall).toBeGreaterThanOrEqual(0.85)
    // The known gap is documented rather than hidden: a short follow-up whose
    // only shared content is a two-character head word is kept separate.
    expect(misses).toEqual(['p03'])
  })

  it('does not merge the B5 negative pair', () => {
    const match = matchTopicTexts('都喜欢咖啡', '在学咖啡拉花')
    expect(match.decision).not.toBe('same')
  })
})
