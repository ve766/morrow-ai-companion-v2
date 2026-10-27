import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextMemoryRealReport } from './context-memory-real'
import {
  HumanReviewError,
  joinReview,
  loadHumanReview,
  parseHumanReview,
  reviewFileName,
  writeHumanReview,
  type HumanReviewFile
} from './human-review'
import type { RealVerdict } from './verdict'

function report(cases: Array<{ id: string; verdict: RealVerdict }>): ContextMemoryRealReport {
  return {
    schemaVersion: 2,
    evidenceClass: 'real_provider_behaviour',
    measures: 'model_behaviour',
    dataset: 'context-memory-v1',
    generatedAt: '2026-10-27T02:30:05.000Z',
    reproduction: {
      runId: '20261027T023005Z-4e15af',
      codeCommit: 'af4f0b1'.padEnd(40, '0'),
      codeState: 'clean',
      sampling: 'provider-default'
    },
    status: 'checked',
    blockedReason: null,
    provider: { providerClass: 'local', endpoint: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:0.5b', reachable: true, modelInCatalog: null },
    environment: { node: 'v22', platform: 'win32-x64', durationMs: 1 },
    summary: {
      casesInDataset: 22,
      casesSelected: cases.length,
      casesChecked: cases.length,
      casesPassed: cases.filter((item) => item.verdict === 'pass').length,
      casesFailed: cases.filter((item) => item.verdict === 'fail').length,
      casesNotChecked: 0,
      casesUncertain: cases.filter((item) => item.verdict === 'uncertain').length,
      casesNeedsReview: cases.filter((item) => item.verdict === 'needs_review').length,
      turnsExecuted: cases.length
    },
    attribution: { notDelivered: 0, deliveredButNotUsed: 0, ruleNotSatisfied: 0 },
    cases: cases.map((item) => ({
      id: item.id,
      capability: `cap-${item.id}`,
      title: item.id,
      status: 'checked',
      verdict: item.verdict,
      verdictRationale: `rationale for ${item.id}`,
      verdictCaveat: null,
      rule: 'substring',
      turns: [],
      checks: [],
      attribution: null,
      failureReason: null,
      diagnostics: {
        expectedInRequest: [],
        deliveredInRequest: [],
        retractedLeaked: [],
        requestContradictory: false,
        stages: [],
        failureClass: 'INSUFFICIENT_EVIDENCE' as const
      }
    })),
    quality: { assessed: false, note: 'test' },
    limitations: []
  }
}

function review(overrides: Partial<HumanReviewFile> = {}): HumanReviewFile {
  return {
    schemaVersion: 1,
    kind: 'human_review',
    runId: '20261027T023005Z-4e15af',
    reviewedAt: '2026-10-27T03:00:00.000Z',
    reviewer: { kind: 'human', name: 'reviewer-a' },
    cases: [],
    ...overrides
  }
}

describe('joinReview', () => {
  it('keeps the automatic verdict when a reviewer disagrees and counts the disagreement', () => {
    const joined = joinReview(
      report([{ id: 'b8', verdict: 'uncertain' }, { id: 'b7', verdict: 'fail' }]),
      review({ cases: [{ caseId: 'b8', verdict: 'pass', note: '天气报告也回答了问题' }] })
    )
    // The report is not edited: the reviewer's opinion lives beside it.
    expect(joined.rows.find((row) => row.caseId === 'b8')?.auto).toBe('uncertain')
    expect(joined.rows.find((row) => row.caseId === 'b8')?.human).toBe('pass')
    expect(joined.rows.find((row) => row.caseId === 'b8')?.disagrees).toBe(true)
    expect(joined.auto.uncertain).toBe(1)
    expect(joined.human.pass).toBe(1)
  })

  it('counts a reviewer rejecting an automatic pass separately from rejecting a fail', () => {
    const joined = joinReview(
      report([{ id: 'b2', verdict: 'pass' }, { id: 'a6', verdict: 'fail' }, { id: 'b9', verdict: 'pass' }]),
      review({
        cases: [
          { caseId: 'b2', verdict: 'fail', note: '第三人称转述，不是回答' },
          { caseId: 'a6', verdict: 'pass', note: '正确澄清' }
        ]
      })
    )
    expect(joined.autoPassRejected).toBe(1)
    expect(joined.autoFailRejected).toBe(1)
  })

  it('leaves an unreviewed case unreviewed instead of assuming agreement', () => {
    const joined = joinReview(report([{ id: 'b7', verdict: 'fail' }]), null)
    expect(joined.rows[0]?.human).toBeNull()
    expect(joined.unreviewed).toBe(1)
    expect(joined.reviewer).toBeNull()
  })

  it('refuses a review that belongs to a different run', () => {
    expect(() => joinReview(report([{ id: 'b7', verdict: 'fail' }]), review({ runId: '20261026T155509Z-4aee35' })))
      .toThrow(HumanReviewError)
  })
})

describe('parseHumanReview', () => {
  it('rejects a duplicate case entry, which would make the count ambiguous', () => {
    expect(() => parseHumanReview(review({
      cases: [
        { caseId: 'b7', verdict: 'fail', note: 'a' },
        { caseId: 'b7', verdict: 'pass', note: 'b' }
      ]
    }) as unknown)).toThrow(HumanReviewError)
  })

  it('rejects a verdict outside the allowed set and a missing note', () => {
    expect(() => parseHumanReview(review({ cases: [{ caseId: 'b7', verdict: 'maybe' as unknown as RealVerdict, note: 'x' }] }) as unknown)).toThrow(HumanReviewError)
    expect(() => parseHumanReview(review({ cases: [{ caseId: 'b7', verdict: 'pass', note: '' }] }) as unknown)).toThrow(HumanReviewError)
  })
})

describe('writeHumanReview', () => {
  it('names the review so that it can never collide with the report', () => {
    expect(reviewFileName('20261027T023005Z-4e15af')).toBe('20261027T023005Z-4e15af.review.json')
    // A run id is not a filename: dots and separators are refused rather than
    // sanitised, so a hostile id cannot escape the reviews directory.
    expect(() => reviewFileName('../../etc/passwd')).toThrow(HumanReviewError)
  })

  it('refuses a second review of the same run instead of replacing the first', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-review-'))
    try {
      writeHumanReview(directory, review({ cases: [{ caseId: 'b7', verdict: 'fail', note: 'first' }] }))
      expect(() => writeHumanReview(directory, review({ cases: [{ caseId: 'b7', verdict: 'pass', note: 'second' }] })))
        .toThrow()
      const stored = JSON.parse(readFileSync(join(directory, reviewFileName('20261027T023005Z-4e15af')), 'utf8')) as HumanReviewFile
      expect(stored.cases[0]?.note).toBe('first')
      expect(readdirSync(directory)).toEqual([reviewFileName('20261027T023005Z-4e15af')])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('round-trips through load and reports null when no review exists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-review-'))
    try {
      expect(loadHumanReview(directory, '20261027T023005Z-4e15af')).toBeNull()
      writeHumanReview(directory, review({ cases: [{ caseId: 'b7', verdict: 'fail', note: '只答上海' }] }))
      expect(loadHumanReview(directory, '20261027T023005Z-4e15af')?.cases[0]?.note).toBe('只答上海')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
