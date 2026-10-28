import { describe, expect, it } from 'vitest'
import { checkPhase23Report, type Phase23Inputs, type RawReport, type RescoredReport, type ReviewFile } from './phase23-report-check'

/**
 * Phase 2.3 review item 3: the verifier must fail when only a stored summary is
 * edited, because that is exactly how a stale or hand-tweaked number would get
 * past a report check.
 */

const CONDITIONS = ['A', 'B', 'C', 'D'] as const

function rawReport(id: string, failed = 0): RawReport {
  const succeeded = 25 - failed
  const requests = [
    ...Array.from({ length: succeeded }, () => ({ status: 'succeeded' })),
    ...Array.from({ length: failed }, () => ({ status: 'failed' }))
  ]
  return {
    condition: { id },
    counts: {
      scenarioRuns: 25,
      providerRequestsAttempted: 25,
      providerRequestsSucceeded: succeeded,
      providerRequestsFailed: failed,
      providerRequestsCancelled: 0
    },
    requests,
    runs: Array.from({ length: 25 }, (_, index) => ({ runId: `${id}-s${index}#0`, scenarioId: 'fact', callSucceeded: true })),
    integrity: { ok: true },
    provenance: { codeSha: 'a'.repeat(40), reproducible: true }
  }
}

interface Plan { used: number; unknown: number; unsupported: number; notScorable: number; unmatched: number }

function rescoredReport(id: string, plan: Plan): RescoredReport {
  const scenarios = ['fact', 'negation', 'time_state', 'conflict', 'no_evidence'] as const
  const outcomes: string[] = [
    ...Array.from({ length: plan.used }, () => 'used_correctly'),
    ...Array.from({ length: plan.unknown }, () => 'reasonable_unknown'),
    ...Array.from({ length: plan.unsupported }, () => 'unsupported_answer'),
    ...Array.from({ length: plan.notScorable }, () => 'not_scorable')
  ]
  const runs = outcomes.map((after, index) => ({
    runId: `${id}-${scenarios[index % scenarios.length]}#${index}`,
    scenarioId: scenarios[index % scenarios.length]!,
    // The rows that changed outcome were the ones that used to be unscorable.
    before: after === 'used_correctly' ? 'used_correctly' : 'not_scorable',
    after,
    scored: after !== 'not_scorable',
    reference: { matched: index < 25 - plan.unmatched }
  }))
  return {
    condition: { id },
    totals: {
      runs: runs.length,
      usedCorrectly: plan.used,
      reasonableUnknown: plan.unknown,
      unsupported: plan.unsupported,
      conflictPass: 0,
      contradictions: 0,
      notScorable: plan.notScorable,
      changed: runs.filter((run) => run.before !== run.after).length
    },
    runs
  }
}

function reviewFile(): ReviewFile {
  const samples = CONDITIONS.flatMap((id) => Array.from({ length: 25 }, (_, index) => ({
    runId: `${id}-s${index}#0`,
    humanLabel: 'correct_use',
    agree: true
  })))
  return { summary: { reviewed: 100, disagreements: 0, byLabel: { correct_use: 100 } }, samples }
}

function markdown(): string {
  return [
    '| 条件 | 正确使用 /25 | 合理未知 /5 | 无依据断言 | 冲突正确处理 /5 | 矛盾 | 不可评分 |',
    '|---|---|---|---|---|---|---|',
    '| A | 20 | 5 | 0 | 0 | 0 | 0 |',
    '| B | 20 | 5 | 0 | 0 | 0 | 0 |',
    '| C | 20 | 5 | 0 | 0 | 0 | 0 |',
    '| D | 19 | 4 | 1 | 0 | 0 | 1 |',
    '',
    '关键词参考命中 42/100 → **97/100**；99 成功 1 失败；共 **20** 条改判。'
  ].join('\n')
}

function inputs(): Phase23Inputs {
  return {
    raw: CONDITIONS.map((id) => rawReport(id, id === 'D' ? 1 : 0)),
    rescored: [
      rescoredReport('A', { used: 20, unknown: 5, unsupported: 0, notScorable: 0, unmatched: 0 }),
      rescoredReport('B', { used: 20, unknown: 5, unsupported: 0, notScorable: 0, unmatched: 0 }),
      rescoredReport('C', { used: 20, unknown: 5, unsupported: 0, notScorable: 0, unmatched: 0 }),
      rescoredReport('D', { used: 19, unknown: 4, unsupported: 1, notScorable: 1, unmatched: 3 })
    ],
    review: reviewFile(),
    markdown: markdown()
  }
}

describe('phase 2.3 review: report verification', () => {
  it('accepts a consistent report', () => {
    const result = checkPhase23Report(inputs())
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.summary).toMatchObject({ referenceMatched: 97, changed: 20 })
  })

  it('fails when only a raw summary count is edited', () => {
    const tampered = inputs()
    tampered.raw[0]!.counts.providerRequestsSucceeded = 24
    const result = checkPhase23Report(tampered)
    expect(result.ok).toBe(false)
    expect(result.failures.join(' ')).toMatch(/raw A succeeded: data says 24, report says 25/)
  })

  it('fails when only a re-scored summary total is edited', () => {
    const tampered = inputs()
    tampered.rescored[0]!.totals.usedCorrectly = 21
    const result = checkPhase23Report(tampered)
    expect(result.ok).toBe(false)
    expect(result.failures.join(' ')).toMatch(/A used \(rows vs summary\)/)
  })

  it('fails when the human review summary is edited', () => {
    const tampered = inputs()
    tampered.review.summary.disagreements = 3
    const result = checkPhase23Report(tampered)
    expect(result.failures.join(' ')).toMatch(/human disagreements/)
  })

  it('fails when the markdown disagrees with the data', () => {
    const tampered = inputs()
    tampered.markdown = tampered.markdown.replace('| A | 20 |', '| A | 19 |')
    const result = checkPhase23Report(tampered)
    expect(result.ok).toBe(false)
    expect(result.failures.join(' ')).toMatch(/A used \(report\)/)
  })

  it('fails when a run has no review entry', () => {
    const tampered = inputs()
    tampered.review.samples.pop()
    tampered.review.summary.reviewed = 99
    const result = checkPhase23Report(tampered)
    expect(result.failures.join(' ')).toMatch(/runs without review/)
  })
})
