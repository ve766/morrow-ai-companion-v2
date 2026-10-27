import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { judgeReply, type JudgeInput, type JudgeVerdict } from './semantic-judgement'

interface RegressionCase {
  id: string
  category: string
  expected: JudgeVerdict
  input: JudgeInput
}

interface RegressionFixture {
  schemaVersion: number
  id: string
  cases: RegressionCase[]
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'evaluation/fixtures/semantic-judgement-regression-v1.json'), 'utf8')
) as RegressionFixture

const actual = fixture.cases.map((testCase) => ({
  ...testCase,
  actual: judgeReply(testCase.input).verdict
}))

function confusionMatrix(): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {}
  for (const item of actual) {
    matrix[item.expected] ??= {}
    matrix[item.expected]![item.actual] = (matrix[item.expected]![item.actual] ?? 0) + 1
  }
  return matrix
}

describe('A1 semantic-judgement regression fixture', () => {
  it('has one expected verdict and no duplicate ids', () => {
    expect(fixture.schemaVersion).toBe(1)
    expect(new Set(fixture.cases.map((item) => item.id)).size).toBe(fixture.cases.length)
    for (const item of fixture.cases) expect(['pass', 'fail', 'uncertain', 'needs_review']).toContain(item.expected)
  })

  it('covers all twelve required categories with positive and negative evidence', () => {
    const categories = new Map<string, Set<string>>()
    for (const item of fixture.cases) {
      const verdicts = categories.get(item.category) ?? new Set<string>()
      verdicts.add(item.expected)
      categories.set(item.category, verdicts)
    }
    expect([...categories.keys()].sort()).toEqual([
      'conflict',
      'correction',
      'denial',
      'explicit_unknown',
      'intra_reply_contradiction',
      'keyword_only',
      'long_conversation',
      'no_fabrication',
      'quotation',
      'remember_question',
      'revision_history',
      'subject_attribution'
    ])
    for (const [category, verdicts] of categories) {
      expect(verdicts.size, `${category} needs both a positive and a negative expectation`).toBeGreaterThanOrEqual(2)
    }
  })

  it('has three distinct expressions for subject, denial and contradiction', () => {
    for (const category of ['subject_attribution', 'denial', 'intra_reply_contradiction']) {
      expect(fixture.cases.filter((item) => item.category === category).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('never lets the three known false passes become uncertain', () => {
    const known = [
      'subject-assistant-code-1',
      'denial-code-1',
      'contradiction-1'
    ]
    for (const id of known) {
      const item = actual.find((entry) => entry.id === id)
      expect(item, id).toBeDefined()
      expect(item!.actual, id).toBe('fail')
    }
  })

  it('matches every declared expected verdict', () => {
    expect(actual.filter((item) => item.actual !== item.expected).map((item) => ({
      id: item.id,
      expected: item.expected,
      actual: item.actual
    }))).toEqual([])
  })

  it('produces a clean confusion matrix', () => {
    const matrix = confusionMatrix()
    expect(matrix).toEqual({
      pass: { pass: 13 },
      fail: { fail: 20 },
      uncertain: { uncertain: 3 }
    })
  })
})
