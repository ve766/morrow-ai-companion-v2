/**
 * Phase 2.3 report consistency checks, as a pure function.
 *
 * The CLI wrapper lives in `scripts/verify-phase23-report.ts`; keeping the
 * checks here makes the negative path testable: if only a summary field in a
 * JSON file is edited, the check must fail even though every per-run row is
 * untouched.
 *
 * What this proves: the report text agrees with the stored data, and the stored
 * summaries agree with their own rows. What it does not prove: that the labels
 * or the model behaviour are correct.
 */
import { EVIDENCE_SCENARIOS } from './evidence-scenarios'

export interface RawReport {
  condition: { id: string }
  counts: {
    scenarioRuns: number
    providerRequestsAttempted: number
    providerRequestsSucceeded: number
    providerRequestsFailed: number
    providerRequestsCancelled: number
  }
  requests: Array<{ status: string }>
  runs: Array<{ runId: string; scenarioId: string; callSucceeded: boolean }>
  integrity: { ok: boolean }
  provenance: { codeSha: string; reproducible: boolean }
}

export interface RescoredReport {
  condition: { id: string }
  totals: {
    runs: number
    usedCorrectly: number
    reasonableUnknown: number
    unsupported: number
    conflictPass: number
    contradictions: number
    notScorable: number
    changed: number
  }
  runs: Array<{
    runId: string
    scenarioId: string
    before: string | null
    after: string
    scored: boolean
    reference: { matched: boolean }
    /** The conflict outcome the evaluator reported for this run. */
    conflict?: string | null
  }>
}

export interface ReviewFile {
  summary: { reviewed: number; disagreements: number; byLabel: Record<string, number> }
  samples: Array<{ runId: string; humanLabel: string; agree: boolean }>
}

export interface Phase23Inputs {
  raw: RawReport[]
  rescored: RescoredReport[]
  review: ReviewFile
  markdown: string
}

export interface Phase23Result {
  ok: boolean
  failures: string[]
  summary: Record<string, unknown>
}

function stable(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function checkPhase23Report(input: Phase23Inputs): Phase23Result {
  const failures: string[] = []
  const check = (label: string, actual: unknown, expected: unknown): void => {
    if (stable(actual) !== stable(expected)) failures.push(`${label}: data says ${JSON.stringify(actual)}, report says ${JSON.stringify(expected)}`)
  }

  if (input.raw.length !== 4) failures.push(`expected 4 raw reports, found ${input.raw.length}`)
  if (input.rescored.length !== 4) failures.push(`expected 4 re-scored reports, found ${input.rescored.length}`)

  // Raw reports: the summary must match its own rows and requests.
  const totals = { runs: 0, requests: 0, succeeded: 0, failed: 0, cancelled: 0, integrity: true, reproducible: true }
  for (const report of input.raw) {
    const id = report.condition.id
    check(`raw ${id} scenarioRuns`, report.counts.scenarioRuns, report.runs.length)
    check(`raw ${id} attempted`, report.counts.providerRequestsAttempted, report.requests.length)
    const succeeded = report.requests.filter((request) => request.status === 'succeeded').length
    const failed = report.requests.filter((request) => request.status === 'failed').length
    const cancelled = report.requests.filter((request) => request.status === 'cancelled').length
    check(`raw ${id} succeeded`, report.counts.providerRequestsSucceeded, succeeded)
    check(`raw ${id} failed`, report.counts.providerRequestsFailed, failed)
    check(`raw ${id} cancelled`, report.counts.providerRequestsCancelled, cancelled)
    check(`raw ${id} attempted = sum`, report.counts.providerRequestsAttempted, succeeded + failed + cancelled)
    if (!report.integrity.ok) failures.push(`raw ${id} integrity failed`)
    totals.runs += report.counts.scenarioRuns
    totals.requests += report.counts.providerRequestsAttempted
    totals.succeeded += report.counts.providerRequestsSucceeded
    totals.failed += report.counts.providerRequestsFailed
    totals.cancelled += report.counts.providerRequestsCancelled
    totals.integrity &&= report.integrity.ok
    totals.reproducible &&= report.provenance.reproducible
  }

  // Re-scored reports: recompute every total from the rows.
  const changedRows = input.rescored.flatMap((item) => item.runs.filter((run) => run.before !== run.after))
  for (const item of input.rescored) {
    const id = item.condition.id
    const rows = item.runs
    check(`${id} runs (rows vs summary)`, rows.length, item.totals.runs)
    check(`${id} used (rows vs summary)`, rows.filter((run) => run.after === 'used_correctly').length, item.totals.usedCorrectly)
    check(`${id} unknown (rows vs summary)`, rows.filter((run) => run.after === 'reasonable_unknown').length, item.totals.reasonableUnknown)
    check(`${id} unsupported (rows vs summary)`, rows.filter((run) => run.after === 'unsupported_answer').length, item.totals.unsupported)
    check(`${id} conflictPass (rows vs summary)`, rows.filter((run) => run.conflict === 'pass').length, item.totals.conflictPass)
    check(`${id} contradictions (rows vs summary)`, rows.filter((run) => run.after === 'contradicts_evidence').length, item.totals.contradictions)
    check(`${id} notScorable (rows vs summary)`, rows.filter((run) => run.after === 'not_scorable').length, item.totals.notScorable)
    check(`${id} changed (rows vs summary)`, rows.filter((run) => run.before !== run.after).length, item.totals.changed)
  }

  // Human review: recompute label counts and coverage.
  const labelCounts: Record<string, number> = {}
  for (const sample of input.review.samples) labelCounts[sample.humanLabel] = (labelCounts[sample.humanLabel] ?? 0) + 1
  const nonZero = (counts: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0))
  check('human reviewed', input.review.samples.length, input.review.summary.reviewed)
  check('human labels', labelCounts, nonZero(input.review.summary.byLabel))
  check('human disagreements', input.review.samples.filter((sample) => !sample.agree).length, input.review.summary.disagreements)
  const correctLabels = new Set(['correct_use', 'conflict_handled', 'reasonable_unknown'])
  const humanCorrect = input.review.samples.filter((sample) => correctLabels.has(sample.humanLabel)).length
  check('review coverage', input.review.samples.length, input.raw.reduce((sum, report) => sum + report.runs.length, 0))

  const rawRunIds = new Set(input.raw.flatMap((report) => report.runs.map((run) => `${report.condition.id}:${run.runId}`)))
  const reviewIds = new Set(input.review.samples.map((sample) => `${sample.runId.split('-')[0]}:${sample.runId}`))
  check('runs without review', [...rawRunIds].filter((id) => !reviewIds.has(id)).length, 0)
  check('reviews without run', [...reviewIds].filter((id) => !rawRunIds.has(id)).length, 0)

  // The markdown must state the same numbers.
  const markdown = input.markdown
  if (!markdown) failures.push('report markdown is missing')
  const referenceMatched = input.rescored.reduce((sum, item) => sum + item.runs.filter((run) => run.reference.matched).length, 0)
  const changed = changedRows.length
  const resultsStart = markdown.indexOf('| 条件 | 正确使用 /25 |')
  if (resultsStart < 0) failures.push('results table not found in the report')
  const resultsTable = resultsStart >= 0 ? markdown.slice(resultsStart) : ''

  for (const item of input.rescored) {
    const match = new RegExp(`^\\|\\s*${item.condition.id}\\s*\\|(.+)\\|\\s*$`, 'mu').exec(resultsTable)
    const row = match ? match[1]!.split('|').map((cell) => cell.trim()).filter((cell) => cell.length > 0) : null
    if (!row) {
      failures.push(`report has no row for condition ${item.condition.id}`)
      continue
    }
    check(`${item.condition.id} used (report)`, item.totals.usedCorrectly, Number(row[0]))
    check(`${item.condition.id} unknown (report)`, item.totals.reasonableUnknown, Number(row[1]))
    check(`${item.condition.id} unsupported (report)`, item.totals.unsupported, Number(row[2]))
    check(`${item.condition.id} conflict pass (report)`, item.totals.conflictPass, Number(row[3]))
    check(`${item.condition.id} contradictions (report)`, item.totals.contradictions, Number(row[4]))
    check(`${item.condition.id} notScorable (report)`, item.totals.notScorable, Number(row[5]))
  }

  const arrow = /关键词参考命中[^→]*→\s*\**\s*(\d+)\/100/u.exec(markdown)
  check('reference matched (report)', Number(arrow?.[1] ?? NaN), referenceMatched)
  // The report may bold "23" or "23 条"; only the number is read.
  check('changed rows (report)', Number(/共 \*\*(\d+)[^0-9]{0,4}条/u.exec(markdown)?.[1] ?? NaN), changed)
  // The human-correct count is stated in the final reading; it is derived from
  // the labels, so the report cannot claim a different number.
  const humanRow = /人工判为正确\s*\|\s*(\d+)\/(\d+)/u.exec(markdown)
  check('human correct (report)', Number(humanRow?.[1] ?? NaN), humanCorrect)
  check('human correct denominator (report)', Number(humanRow?.[2] ?? NaN), input.review.samples.length)
  check('provider failures (report)', Number(/99 成功 (\d+) 失败/u.exec(markdown)?.[1] ?? NaN), totals.failed)
  if (!new RegExp(`\\b${totals.succeeded} 成功`, 'u').test(markdown)) failures.push(`report does not state ${totals.succeeded} successful requests`)

  const perScenario = Object.fromEntries(EVIDENCE_SCENARIOS.map((scenario) => [
    scenario.id,
    input.rescored.reduce((sum, item) => sum + item.runs.filter((run) => run.scenarioId === scenario.id).length, 0)
  ]))
  check('runs per scenario', perScenario, Object.fromEntries(EVIDENCE_SCENARIOS.map((scenario) => [scenario.id, 20])))

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      totals,
      referenceMatched,
      changed,
      labelCounts,
      humanCorrect,
      humanCorrectRate: input.review.samples.length === 0 ? null : Number((humanCorrect / input.review.samples.length).toFixed(4)),
      reviewCoverage: Number((input.review.samples.length / Math.max(1, input.raw.reduce((sum, report) => sum + report.runs.length, 0))).toFixed(4)),
      disagreements: input.review.samples.filter((sample) => !sample.agree).length,
      perCondition: input.rescored.map((item) => ({ condition: item.condition.id, ...item.totals })),
      perScenario,
      changedDirections: changedRows.reduce<Record<string, number>>((accumulator, run) => {
        const key = `${run.before ?? 'none'}->${run.after}`
        accumulator[key] = (accumulator[key] ?? 0) + 1
        return accumulator
      }, {}),
      sources: {
        keywordReference: 'computed from rescored run rows (reference.matched)',
        humanCorrectness: 'computed from phase23-human-review.json labels (single reviewer)',
        semanticConsistency: 'computed by the evaluator; not independently re-derived here'
      },
      limits: [
        'single human reviewer: this is not inter-annotator agreement',
        'keyword reference matching is a lexical proxy, not correctness',
        'the verifier checks report-vs-data consistency, not model capability'
      ],
      codeSha: input.raw[0]?.provenance.codeSha ?? 'unknown'
    }
  }
}
