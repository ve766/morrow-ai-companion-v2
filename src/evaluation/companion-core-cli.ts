import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  CompanionCoreEvaluationError,
  parseCompanionCoreDataset,
  runCompanionCoreEvaluation
} from './companion-core-evaluation'

const root = process.env.MORROW_EVALUATION_ROOT
if (!root) throw new CompanionCoreEvaluationError('MISSING_EVALUATION_ROOT')

const fixturesDirectory = resolve(root, 'evaluation', 'fixtures')
const reportsDirectory = resolve(root, 'evaluation', 'reports')
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

function pathInside(directory: string, filename: string): string {
  if (!filename || isAbsolute(filename)) throw new CompanionCoreEvaluationError('PATH_OUTSIDE_EVALUATION')
  const base = resolve(directory)
  const path = resolve(base, filename)
  const rel = relative(base, path)
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new CompanionCoreEvaluationError('PATH_OUTSIDE_EVALUATION')
  }
  return path
}

function assertNoSymlink(base: string, path: string): void {
  const rel = relative(base, path)
  let current = base
  for (const part of rel.split(/[\\/]/u)) {
    current = resolve(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new CompanionCoreEvaluationError('SYMLINK_PATH_NOT_ALLOWED')
    }
  }
}

function readJson(path: string): unknown {
  assertNoSymlink(resolve(path, '..'), path)
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

function atomicWrite(path: string, value: string): void {
  mkdirSync(reportsDirectory, { recursive: true })
  assertNoSymlink(resolve(reportsDirectory, '..'), reportsDirectory)
  assertNoSymlink(reportsDirectory, path)
  const temporary = resolve(reportsDirectory, `.morrow-companion-${process.pid}-${Date.now()}.tmp`)
  writeFileSync(temporary, value, { encoding: 'utf8', flag: 'wx' })
  renameSync(temporary, path)
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const datasetName = typeof options['--dataset'] === 'string' ? options['--dataset'] : defaultDatasetName
  const outputName = typeof options['--output'] === 'string' ? options['--output'] : defaultReportName
  if (!outputName.endsWith('.json') || outputName.includes('/') || outputName.includes('\\')) {
    throw new CompanionCoreEvaluationError('INVALID_REPORT_NAME')
  }

  const dataset = parseCompanionCoreDataset(readJson(pathInside(fixturesDirectory, datasetName)))
  const report = await runCompanionCoreEvaluation(dataset)
  const reportDigest = createHash('sha256').update(canonicalJson(report)).digest('hex')
  atomicWrite(pathInside(reportsDirectory, outputName), `${JSON.stringify({ ...report, reportSha256: reportDigest }, null, 2)}\n`)

  console.log(JSON.stringify({
    passed: report.gate.passed,
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
  const code = error instanceof CompanionCoreEvaluationError ? error.code : 'COMPANION_CORE_EVALUATION_FAILED'
  console.error(JSON.stringify({ failed: true, code }))
  process.exitCode = 1
})
