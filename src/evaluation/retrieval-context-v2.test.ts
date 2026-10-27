import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRetrievalDataset, runRetrievalBenchmark } from './retrieval-benchmark'

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'evaluation/fixtures/retrieval-context-v2.json'), 'utf8')
) as unknown

function report() {
  return runRetrievalBenchmark(parseRetrievalDataset(fixture))
}

function candidate(id: string): string[] {
  return report().cases.find((item) => item.id === id)!.candidate.retrieved
}

describe('A3 Chinese false-recall and relevance gate', () => {
  it('rejects a CJK bigram collision that the legacy rule retrieves', () => {
    const result = report().cases.find((item) => item.id === 'unrelated-chinese-bigram-trap')!
    expect(result.baseline.retrieved).toContain('hangzhou')
    expect(result.candidate.retrieved).toEqual([])
  })

  it('recalls residence, preference and learning paraphrases', () => {
    expect(candidate('residence-paraphrase')).toContain('hangzhou')
    expect(candidate('preference-paraphrase')).toContain('preference')
    expect(candidate('learning-paraphrase')).toContain('blender')
  })

  it('uses recent context for an elliptical turn', () => {
    expect(candidate('elliptical-context')).toEqual(['blender'])
  })

  it('keeps both conflicting values rather than silently choosing one', () => {
    expect(candidate('conflict-both-relevant').sort()).toEqual(['hangzhou', 'osaka'])
  })

  it('keeps retracted and unauthorised records out', () => {
    const result = report()
    const retracted = result.cases.find((item) => item.id === 'retracted-excluded')!
    expect(retracted.candidate.retrieved).toContain('blue')
    expect(retracted.candidate.leaks).toEqual([])
    const sensitive = result.cases.find((item) => item.id === 'sensitive-denied')!
    expect(sensitive.candidate.retrieved).toEqual([])
    expect(sensitive.candidate.leaks).toEqual([])
  })

  it('has no false topic recall and no leaked records on this fixture', () => {
    const result = report()
    expect(result.candidate.falseRecall).toBe(0)
    expect(result.candidate.leakCount).toBe(0)
    expect(result.determinism.replayStable).toBe(true)
  })
})
