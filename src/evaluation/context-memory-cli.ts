import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import {
  ContextMemoryEvaluationError,
  parseContextMemoryDataset,
  runContextMemoryEvaluation
} from './context-memory-evaluation'
import { ReportPathError, assertNoSymlink, atomicWriteReport, resolveInsideDirectory, resolveReportPath } from './report-path'

/**
 * Offline context/memory evaluation CLI.
 *
 * Exit codes:
 *   0  the gate passed
 *   1  the evaluation could not run (bad argument, unreadable fixture, bad path)
 *   2  the gate failed
 *
 * This produces delivery evidence only. The report says so in its own fields
 * (`evidenceClass`, `measures`, `modelUnderstanding`) so a downstream reader
 * cannot quote a green gate as a statement about model quality.
 */

const defaultDatasetName = 'context-memory-v1.json'
const defaultReportName = 'context-memory-report.json'

function usage(): string {
  return [
    'Morrow context/memory offline evaluation',
    'npm run evaluate:context [-- --dataset <fixture.json> --output <report.json>]',
    'Runs deterministic multi-turn cases against the production chat path and asserts,',
    'turn by turn, on the serialized provider request. No network, no model calls.'
  ].join('\n')
}

function parseArguments(args: string[]): Record<string, string | true> {
  const options: Record<string, string | true> = {}
  const valueOptions = new Set(['--dataset', '--output'])
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    if (typeof option !== 'string') throw new ContextMemoryEvaluationError('INVALID_ARGUMENT')
    if (option === '--help') {
      options.help = true
      continue
    }
    if (!valueOptions.has(option)) throw new ContextMemoryEvaluationError('INVALID_ARGUMENT')
    const value = args[index + 1]
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--') || options[option]) {
      throw new ContextMemoryEvaluationError('INVALID_ARGUMENT')
    }
    options[option] = value
    index += 1
  }
  return options
}

function readJson(base: string, path: string): unknown {
  assertNoSymlink(base, path)
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    throw new ContextMemoryEvaluationError('INVALID_JSON_INPUT')
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function main(): Promise<void> {
  const root = process.env.MORROW_EVALUATION_ROOT
  if (!root) throw new ContextMemoryEvaluationError('MISSING_EVALUATION_ROOT')

  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const fixturesDirectory = resolve(root, 'evaluation', 'fixtures')
  const reportsDirectory = resolve(root, 'evaluation', 'reports')
  const datasetName = typeof options['--dataset'] === 'string' ? options['--dataset'] : defaultDatasetName
  const outputName = typeof options['--output'] === 'string' ? options['--output'] : defaultReportName

  const datasetPath = resolveInsideDirectory(fixturesDirectory, datasetName)
  // Fail fast on a hostile or mistyped destination, before the multi-second run.
  resolveReportPath(reportsDirectory, outputName)

  const dataset = parseContextMemoryDataset(readJson(fixturesDirectory, datasetPath))
  const report = await runContextMemoryEvaluation(dataset)
  const reportDigest = createHash('sha256').update(canonicalJson(report)).digest('hex')
  atomicWriteReport(reportsDirectory, outputName, `${JSON.stringify({ ...report, reportSha256: reportDigest }, null, 2)}\n`)

  const byCapability = Object.fromEntries(
    Object.entries(report.metrics.byCapability).map(([key, value]) => [key, `${value.passed}/${value.cases}`])
  )
  console.log(JSON.stringify({
    passed: report.gate.passed,
    evidenceClass: report.evidenceClass,
    measures: report.measures,
    modelUnderstanding: report.modelUnderstanding,
    dataset: report.dataset.id,
    cases: report.metrics.cases,
    passedCases: report.metrics.passed,
    failedCases: report.metrics.failed,
    assertionsExecuted: report.metrics.assertionsExecuted,
    failedChecks: report.gate.failedChecks,
    byCapability,
    deterministicHash: report.determinism.resultHash,
    replayStable: report.determinism.replayStable,
    offlineExecution: report.offlineExecution,
    report: `evaluation/reports/${outputName}`
  }))
  if (!report.gate.passed) process.exitCode = 2
}

main().catch((error: unknown) => {
  const code = error instanceof ReportPathError
    ? error.code
    : error instanceof ContextMemoryEvaluationError ? error.code : 'CONTEXT_MEMORY_EVALUATION_FAILED'
  console.error(JSON.stringify({ failed: true, code }))
  process.exitCode = 1
})
