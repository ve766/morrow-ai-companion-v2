import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { ContextMemoryEvaluationError, parseContextMemoryDataset } from './context-memory-evaluation'
import { runContextMemoryReal } from './context-memory-real'
import { ReportPathError, assertNoSymlink, atomicWriteReport, resolveInsideDirectory, resolveReportPath } from './report-path'

/**
 * CLI for the real-model behaviour evaluation. Exit codes mirror the
 * real-provider verifier so CI scripting treats both the same way:
 *   0  every mechanically checked case passed
 *   1  the run itself could not start (bad fixture, bad path, crash)
 *   2  at least one checked case failed
 *   3  blocked: no reachable provider, nothing claimed
 *
 * A blocked run writes no report. Overwriting the last real run with a file
 * that contains no observations would destroy the only record of it.
 */

const root = process.env.MORROW_EVALUATION_ROOT ?? process.cwd()
const fixturesDirectory = resolve(root, 'evaluation', 'fixtures')
const reportsDirectory = resolve(root, 'evaluation', 'reports')
const datasetName = process.env.MORROW_CONTEXT_REAL_DATASET ?? 'context-memory-v1.json'
const outputName = process.env.MORROW_CONTEXT_REAL_OUTPUT ?? 'context-memory-real-report.json'
const only = process.env.MORROW_CONTEXT_REAL_CASES

async function main(): Promise<void> {
  resolveReportPath(reportsDirectory, outputName)
  const datasetPath = resolveInsideDirectory(fixturesDirectory, datasetName)
  assertNoSymlink(fixturesDirectory, datasetPath)
  let dataset: unknown
  try {
    dataset = JSON.parse(readFileSync(datasetPath, 'utf8')) as unknown
  } catch {
    throw new ContextMemoryEvaluationError('INVALID_JSON_INPUT')
  }
  const parsed = parseContextMemoryDataset(dataset)

  const report = await runContextMemoryReal(parsed, {
    ...(process.env.MORROW_CONTEXT_REAL_ENDPOINT ? { endpoint: process.env.MORROW_CONTEXT_REAL_ENDPOINT } : {}),
    ...(process.env.MORROW_CONTEXT_REAL_MODEL ? { model: process.env.MORROW_CONTEXT_REAL_MODEL } : {}),
    ...(only ? { caseIds: only.split(',').map((value) => value.trim()).filter(Boolean) } : {})
  })

  if (report.status === 'blocked') {
    console.log(JSON.stringify({
      status: report.status,
      evidenceClass: report.evidenceClass,
      blockedReason: report.blockedReason,
      provider: report.provider,
      reportWritten: false
    }))
    process.exitCode = 3
    return
  }

  const outputPath = atomicWriteReport(reportsDirectory, outputName, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    status: report.status,
    evidenceClass: report.evidenceClass,
    measures: report.measures,
    provider: report.provider,
    environment: report.environment,
    summary: report.summary,
    attribution: report.attribution,
    quality: report.quality,
    failures: report.cases
      .filter((item) => item.failureReason !== null)
      .map((item) => ({ id: item.id, attribution: item.attribution, reason: item.failureReason })),
    report: outputPath.replace(`${root}/`, '').replace(/\\/gu, '/')
  }))
  if (report.summary.casesFailed > 0) process.exitCode = 2
}

main().catch((error: unknown) => {
  const code = error instanceof ReportPathError
    ? error.code
    : error instanceof ContextMemoryEvaluationError ? error.code : 'CONTEXT_MEMORY_REAL_FAILED'
  // Never log the error object: a fetch failure can carry the request.
  console.error(JSON.stringify({ failed: true, code }))
  process.exitCode = 1
})
