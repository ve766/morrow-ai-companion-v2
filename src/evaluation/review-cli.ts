import { readFileSync } from 'node:fs'
import process from 'node:process'
import { resolve } from 'node:path'
import { resolveReportPath, resolveInsideDirectory } from './report-path'
import { loadHumanReview, reviewDirectory, joinReview } from './human-review'
import type { ContextMemoryRealReport } from './context-memory-real'

/**
 * Prints the automatic verdicts and the human review side by side.
 *
 * Read-only on purpose: it takes a run id, finds that run's report and review,
 * and prints. It never writes either file, so running it cannot change a score.
 *
 * Exit codes: 0 joined (with or without a review), 1 the report could not be
 * read. A disagreement is data, not a failure.
 */

const root = process.env.MORROW_EVALUATION_ROOT ?? process.cwd()
const reportsDirectory = resolve(root, 'evaluation', 'reports')

function main(): void {
  const runId = process.argv[2]
  if (!runId) throw new Error('usage: review-summary <runId>')
  const reportPath = resolveReportPath(reportsDirectory, `context-memory-real-report.${runId}.json`)
  resolveInsideDirectory(reportsDirectory, `context-memory-real-report.${runId}.json`)
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ContextMemoryRealReport
  const review = loadHumanReview(reviewDirectory(root), runId)
  const joined = joinReview(report, review)
  console.log(JSON.stringify({
    runId: joined.runId,
    reviewer: joined.reviewer,
    auto: joined.auto,
    human: joined.human,
    autoPassRejected: joined.autoPassRejected,
    autoFailRejected: joined.autoFailRejected,
    unreviewed: joined.unreviewed,
    rows: joined.rows.map((row) => ({
      case: row.caseId,
      auto: row.auto,
      human: row.human,
      disagrees: row.disagrees,
      note: row.humanNote
    }))
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(JSON.stringify({ failed: true, code: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
}
