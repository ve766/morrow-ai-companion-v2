import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import {
  CompanionCoreEvaluationError,
  parseCompanionCoreDataset,
  runCompanionCoreEvaluation
} from './companion-core-evaluation'
import { ReportPathError, assertNoSymlink, atomicWriteReport, resolveInsideDirectory, resolveReportPath } from './report-path'

/**
 * Exit codes:
 *   0  the gate passed
 *   1  the evaluation could not run (bad argument, unreadable fixture, bad path)
 *   2  the gate failed
 */

const defaultDatasetName = 'companion-core-v1.json'
const defaultReportName = 'companion-core-report.json'

function usage(): string {
  return [
    'Morrow Companion Core offline evaluation',
    'npm run evaluate:companion [-- --dataset <fixture.json> --output <report.json>]',
    'Runs deterministic companion-core cases against the production chat path and',
    'asserts on the serialized provider request. No network, no model calls.'
  ].join('\n')
}

function parseArguments(args: string[]): Record<string, string | true> {
  const options: Record<string, string | true> = {}
  const valueOptions = new Set(['--dataset', '--output'])
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    if (typeof option !== 'string') throw new CompanionCoreEvaluationError('INVALID_ARGUMENT')
    if (option === '--help') {
      options.help = true
      continue
    }
    if (!valueOptions.has(option)) throw new CompanionCoreEvaluationError('INVALID_ARGUMENT')
    const value = args[index + 1]
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--') || options[option]) {
      throw new CompanionCoreEvaluationError('INVALID_ARGUMENT')
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
    throw new CompanionCoreEvaluationError('INVALID_JSON_INPUT')
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
  if (!root) throw new CompanionCoreEvaluationError('MISSING_EVALUATION_ROOT')

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
  const dataset = parseCompanionCoreDataset(readJson(fixturesDirectory, datasetPath))
  const report = await runCompanionCoreEvaluation(dataset)
  const reportDigest = createHash('sha256').update(canonicalJson(report)).digest('hex')
  atomicWriteReport(reportsDirectory, outputName, `${JSON.stringify({ ...report, reportSha256: reportDigest }, null, 2)}\n`)

  console.log(JSON.stringify({
    passed: report.gate.passed,
    evidenceClass: report.evidenceClass,
    dataset: report.dataset.id,
    cases: report.metrics.cases,
    passedCases: report.metrics.passed,
    failedCases: report.metrics.failed,
    failedChecks: report.gate.failedChecks,
    dimensions: report.metrics.dimensionCoverage,
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
    : error instanceof CompanionCoreEvaluationError ? error.code : 'COMPANION_CORE_EVALUATION_FAILED'
  console.error(JSON.stringify({ failed: true, code }))
  process.exitCode = 1
})
