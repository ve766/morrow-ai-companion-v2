/**
 * Machine verification for the Phase 2.3 report (work item C).
 *
 * Recomputes every headline number from the raw JSON reports, the re-scored
 * reports and the human review, then compares them with what the markdown
 * actually claims. Any mismatch, missing file or unparsable line exits non-zero,
 * so the report cannot drift away from its data.
 *
 *   node /tmp/verify-phase23.cjs
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { EVIDENCE_SCENARIOS } from '../src/evaluation/evidence-scenarios'

const reportsDir = join(process.cwd(), 'evaluation', 'reports')
// Overridable so the negative path (a tampered report) can be exercised.
const reportPath = process.env.MORROW_PHASE23_REPORT ?? join(process.cwd(), 'docs', 'reports', 'cognitive-loop-v1-phase2-3.md')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function pick(prefix: string, suffix: string): string[] {
  return readdirSync(reportsDir).filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
}

const failures: string[] = []
function stable(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function check(label: string, actual: unknown, expected: unknown): void {
  if (stable(actual) !== stable(expected)) {
    failures.push(`${label}: data says ${JSON.stringify(actual)}, report says ${JSON.stringify(expected)}`)
  }
}

interface RawReport {
  condition: { id: string }
  counts: Record<string, number>
  runs: Array<{ runId: string; scenarioId: string; callSucceeded: boolean; auto: { outcome: string | null } }>
  integrity: { ok: boolean }
  provenance: { codeSha: string; reproducible: boolean }
}

const rawFiles = pick('phase23-spark-', '.json').filter((name) => /^phase23-spark-[ABCD]-/u.test(name)).sort()
if (rawFiles.length !== 4) failures.push(`expected 4 raw reports, found ${rawFiles.length}`)
const raw = rawFiles.map((name) => readJson<RawReport>(join(reportsDir, name)))

const totals = raw.reduce((accumulator, item) => ({
  runs: accumulator.runs + item.counts.scenarioRuns,
  requests: accumulator.requests + item.counts.providerRequestsAttempted,
  succeeded: accumulator.succeeded + item.counts.providerRequestsSucceeded,
  failed: accumulator.failed + item.counts.providerRequestsFailed,
  integrity: accumulator.integrity && item.integrity.ok,
  reproducible: accumulator.reproducible && item.provenance.reproducible
}), { runs: 0, requests: 0, succeeded: 0, failed: 0, integrity: true, reproducible: true })
check('total runs', totals.runs, 100)
check('total requests', totals.requests, 100)
check('provider integrity', totals.integrity, true)
check('reproducible', totals.reproducible, true)

interface RescoredReport {
  condition: { id: string }
  totals: { runs: number; usedCorrectly: number; reasonableUnknown: number; unsupported: number; conflictPass: number; contradictions: number; notScorable: number; changed: number }
  runs: Array<{ runId: string; scenarioId: string; before: string | null; after: string; scored: boolean; reference: { matched: boolean } }>
}

const rescoredFiles = pick('phase23-rescored-', '.json').sort()
if (rescoredFiles.length !== 4) failures.push(`expected 4 re-scored reports, found ${rescoredFiles.length}`)
const rescored = rescoredFiles.map((name) => readJson<RescoredReport>(join(reportsDir, name)))

interface ReviewFile {
  summary: { reviewed: number; disagreements: number; byLabel: Record<string, number> }
  samples: Array<{ runId: string; humanLabel: string; agree: boolean }>
}
const reviewPath = join(reportsDir, 'phase23-human-review.json')
if (!existsSync(reviewPath)) failures.push('human review file is missing')
const review = readJson<ReviewFile>(reviewPath)

// Recompute the label counts from the samples instead of trusting the summary.
const labelCounts: Record<string, number> = {}
for (const sample of review.samples) labelCounts[sample.humanLabel] = (labelCounts[sample.humanLabel] ?? 0) + 1
const disagreements = review.samples.filter((sample) => !sample.agree).length
check('human reviewed', review.samples.length, 100)
// The stored summary lists zero-count labels; compare on non-zero counts.
const nonZero = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0))
check('human labels', labelCounts, nonZero(review.summary.byLabel))
check('human disagreements', disagreements, review.summary.disagreements)

// Every stored run must have a review entry, and vice versa.
const rawRunIds = new Set(raw.flatMap((item) => item.runs.map((run) => `${item.condition.id}:${run.runId}`)))
const reviewIds = new Set(review.samples.map((sample) => `${sample.runId.split('-')[0]}:${sample.runId}`))
check('runs without review', [...rawRunIds].filter((id) => !reviewIds.has(id)).length, 0)
check('reviews without run', [...reviewIds].filter((id) => !rawRunIds.has(id)).length, 0)

// Everything below is recomputed from the per-run rows, not from the stored
// summaries: a stale summary must not be able to turn into a passing report.
const referenceMatched = rescored.reduce((sum, item) => sum + item.runs.filter((run) => run.reference.matched).length, 0)
const changedRows = rescored.flatMap((item) => item.runs.filter((run) => run.before !== run.after))
const changed = changedRows.length
for (const item of rescored) {
  const rows = item.runs
  check(`${item.condition.id} runs (rows vs summary)`, rows.length, item.totals.runs)
  check(`${item.condition.id} used (rows vs summary)`, rows.filter((run) => run.after === 'used_correctly').length, item.totals.usedCorrectly)
  check(`${item.condition.id} unknown (rows vs summary)`, rows.filter((run) => run.after === 'reasonable_unknown').length, item.totals.reasonableUnknown)
  check(`${item.condition.id} unsupported (rows vs summary)`, rows.filter((run) => run.after === 'unsupported_answer').length, item.totals.unsupported)
  check(`${item.condition.id} changed (rows vs summary)`, rows.filter((run) => run.before !== run.after).length, item.totals.changed)
}

// The markdown must state the same numbers.
const markdown = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : ''
if (!markdown) failures.push('report markdown is missing')

// Only the results table counts: it is the one introduced by this header.
const resultsStart = markdown.indexOf('| 条件 | 正确使用 /25 |')
const resultsTable = resultsStart >= 0 ? markdown.slice(resultsStart) : ''
if (resultsStart < 0) failures.push('results table not found in the report')

function claimRow(conditionId: string): string[] | null {
  const match = new RegExp(`^\\|\\s*${conditionId}\\s*\\|(.+)\\|\\s*$`, 'mu').exec(resultsTable)
  return match ? match[1]!.split('|').map((cell) => cell.trim()).filter((cell) => cell.length > 0) : null
}

for (const item of rescored) {
  const row = claimRow(item.condition.id)
  if (!row) {
    failures.push(`report has no row for condition ${item.condition.id}`)
    continue
  }
  // Row layout: usedCorrectly | reasonableUnknown | unsupported | conflictPass | contradictions | notScorable
  check(`${item.condition.id} used`, item.totals.usedCorrectly, Number(row[0]))
  check(`${item.condition.id} unknown`, item.totals.reasonableUnknown, Number(row[1]))
  check(`${item.condition.id} unsupported`, item.totals.unsupported, Number(row[2]))
  check(`${item.condition.id} conflict pass`, item.totals.conflictPass, Number(row[3]))
  check(`${item.condition.id} contradictions`, item.totals.contradictions, Number(row[4]))
  check(`${item.condition.id} notScorable`, item.totals.notScorable, Number(row[5]))
}

// The comparison line reads "参考命中 42/100 → 98/100"; the arrow value is ours.
const arrow = /关键词参考命中[^→]*→\s*\**\s*(\d+)\/100/u.exec(markdown)
check('reference matched (report)', Number(arrow?.[1] ?? NaN), referenceMatched)
check('changed rows (report)', Number(/共 \*\*(\d+) 条\*\*/u.exec(markdown)?.[1] ?? NaN), changed)
check('provider failures (report)', Number(/99 成功 (\d+) 失败/u.exec(markdown)?.[1] ?? NaN), totals.failed)
if (!new RegExp(`\\b${totals.succeeded} 成功`, 'u').test(markdown)) failures.push(`report does not state ${totals.succeeded} successful requests`)

const scenarioTotals = Object.fromEntries(EVIDENCE_SCENARIOS.map((scenario) => [scenario.id, rescored.reduce((sum, item) => sum + item.runs.filter((run) => run.scenarioId === scenario.id).length, 0)]))
check('runs per scenario', scenarioTotals, { fact: 20, negation: 20, time_state: 20, conflict: 20, no_evidence: 20 })

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  totals,
  referenceMatched,
  changed,
  labelCounts,
  disagreements,
  perCondition: rescored.map((item) => ({ condition: item.condition.id, ...item.totals })),
  perScenario: scenarioTotals,
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
  codeSha: raw[0]?.provenance.codeSha ?? 'unknown',
  ok: failures.length === 0,
  failures
}
writeFileSync(join(reportsDir, 'phase23-verification.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

if (!summary.ok) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ ok: true, totals, referenceMatched, changed, disagreements, perScenario: scenarioTotals }))
}
