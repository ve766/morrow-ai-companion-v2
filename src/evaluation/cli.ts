import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { runM2SafetyFixtures } from './m2-safety'
import { OfflineEvaluationError, runOfflineEvaluation } from './offline-evaluation'
import { ReminderEvaluationError, runReminderPolicyEvaluation } from './reminder-policy-evaluation'

const root = process.env.MORROW_EVALUATION_ROOT
if (!root) throw new OfflineEvaluationError('MISSING_EVALUATION_ROOT')

const fixturesDirectory = resolve(root, 'evaluation', 'fixtures')
const baselinesDirectory = resolve(root, 'evaluation', 'baselines')
const candidatesDirectory = resolve(root, 'evaluation', 'candidates')
const reportsDirectory = resolve(root, 'evaluation', 'reports')
const defaultReportName = 'm3-synthetic-retrieval-report.json'
const reminderDatasetName = 'reminder-policy-v1.json'
const reminderReportName = 'm4-synthetic-reminder-report.json'

function usage(): string {
  return [
    'Morrow offline M3/M4 policy evaluation',
    'npm run evaluate [-- --dataset <fixture.json> --baseline <spec.json> --candidate <spec.json> --output <report.json>]',
    'npm run evaluate -- --clear [--output <report.json>]',
    'Runs M3 retrieval and M4 reminder-policy checks on synthetic fixtures. All files remain under evaluation/.'
  ].join('\n')
}

function parseArguments(args: string[]): Record<string, string | true> {
  const options: Record<string, string | true> = {}
  const valueOptions = new Set(['--dataset', '--baseline', '--candidate', '--output'])
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    if (typeof option !== 'string') throw new OfflineEvaluationError('INVALID_ARGUMENT')
    if (option === '--help') {
      options.help = true
      continue
    }
    if (option === '--clear') {
      options.clear = true
      continue
    }
    if (!valueOptions.has(option)) throw new OfflineEvaluationError('INVALID_ARGUMENT')
    const value = args[index + 1]
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--') || options[option]) throw new OfflineEvaluationError('INVALID_ARGUMENT')
    options[option] = value
    index += 1
  }
  return options
}

function pathInside(directory: string, filename: string): string {
  if (!filename || isAbsolute(filename)) throw new OfflineEvaluationError('PATH_OUTSIDE_EVALUATION')
  const base = resolve(directory)
  const path = resolve(base, filename)
  const rel = relative(base, path)
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new OfflineEvaluationError('PATH_OUTSIDE_EVALUATION')
  }
  return path
}

function assertNoSymlink(base: string, path: string): void {
  const rel = relative(base, path)
  let current = base
  for (const part of rel.split(/[\\/]/u)) {
    current = resolve(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new OfflineEvaluationError('SYMLINK_PATH_NOT_ALLOWED')
    }
  }
}

function readJson(path: string): unknown {
  assertNoSymlink(resolve(path, '..'), path)
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    throw new OfflineEvaluationError('INVALID_JSON_INPUT')
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
  const temporary = resolve(reportsDirectory, `.morrow-evaluation-${process.pid}-${Date.now()}.tmp`)
  writeFileSync(temporary, value, { encoding: 'utf8', flag: 'wx' })
  renameSync(temporary, path)
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const outputName = typeof options['--output'] === 'string' ? options['--output'] : defaultReportName
  if (!outputName.endsWith('.json') || outputName.includes('/') || outputName.includes('\\')) {
    throw new OfflineEvaluationError('INVALID_REPORT_NAME')
  }
  const outputPath = pathInside(reportsDirectory, outputName)

  if (options.clear) {
    if (Object.keys(options).some((key) => !['clear', '--output'].includes(key))) throw new OfflineEvaluationError('INVALID_ARGUMENT')
    const names = typeof options['--output'] === 'string' ? [outputName] : [outputName, reminderReportName]
    const removed = names.map((name) => {
      const path = pathInside(reportsDirectory, name)
      if (!existsSync(path)) return { report: `evaluation/reports/${name}`, removed: false }
      assertNoSymlink(reportsDirectory, path)
      rmSync(path)
      return { report: `evaluation/reports/${name}`, removed: true }
    })
    console.log(JSON.stringify({ removed }))
    return
  }

  const datasetName = typeof options['--dataset'] === 'string' ? options['--dataset'] : 'retrieval-v1.json'
  const baselineName = typeof options['--baseline'] === 'string' ? options['--baseline'] : 'm1-substring-v1.json'
  const candidateName = typeof options['--candidate'] === 'string' ? options['--candidate'] : 'scope-aware-token-v1.json'
  const datasetPath = pathInside(fixturesDirectory, datasetName)
  const baselinePath = pathInside(baselinesDirectory, baselineName)
  const candidatePath = pathInside(candidatesDirectory, candidateName)
  const dataset = readJson(datasetPath)
  const baseline = readJson(baselinePath)
  const candidate = readJson(candidatePath)
  const reminderDatasetPath = pathInside(fixturesDirectory, reminderDatasetName)
  const reminderDataset = readJson(reminderDatasetPath)
  const safety = await runM2SafetyFixtures()
  const report = runOfflineEvaluation(dataset, baseline, candidate, safety)
  const reminderReport = runReminderPolicyEvaluation(reminderDataset)
  const reportDigest = createHash('sha256').update(canonicalJson(report)).digest('hex')
  const reminderReportDigest = createHash('sha256').update(canonicalJson(reminderReport)).digest('hex')
  const output = `${JSON.stringify({ ...report, reportSha256: reportDigest }, null, 2)}\n`
  const reminderOutputPath = pathInside(reportsDirectory, reminderReportName)
  const reminderOutput = `${JSON.stringify({ ...reminderReport, reportSha256: reminderReportDigest }, null, 2)}\n`
  atomicWrite(outputPath, output)
  atomicWrite(reminderOutputPath, reminderOutput)
  console.log(JSON.stringify({
    passed: report.gate.passed && reminderReport.gate.passed,
    dataset: report.dataset.id,
    cases: report.dataset.caseCount,
    baseline: report.algorithms.baseline.id,
    baselinePrecision: report.baselineMetrics.precision,
    baselineRecall: report.baselineMetrics.recall,
    candidate: report.algorithms.candidate.id,
    candidatePrecision: report.candidateMetrics.precision,
    candidateRecall: report.candidateMetrics.recall,
    candidateSourceLeaks: report.candidateMetrics.sourceLeakCount,
    candidateScopeLeaks: report.candidateMetrics.scopeLeakCount,
    candidateRestrictedLeaks: report.candidateMetrics.restrictedLeakCount,
    candidateUnknownLeaks: report.candidateMetrics.unknownCaseLeakCount,
    m2Safety: report.m2Safety.passed,
    deterministicHash: report.determinism.resultHash,
    reportSha256: reportDigest,
    report: `evaluation/reports/${outputName}`,
    m4Reminders: {
      passed: reminderReport.gate.passed,
      cases: reminderReport.dataset.caseCount,
      precision: reminderReport.metrics.precision,
      recall: reminderReport.metrics.recall,
      falsePositives: reminderReport.metrics.falsePositiveCount,
      safetyLeaks: Object.values(reminderReport.metrics.safetyLeakCounts).reduce((total, count) => total + count, 0),
      deterministicHash: reminderReport.determinism.resultHash,
      reportSha256: reminderReportDigest,
      report: `evaluation/reports/${reminderReportName}`
    }
  }))
  if (!report.gate.passed || !reminderReport.gate.passed) process.exitCode = 2
}

main().catch((error: unknown) => {
  const code = error instanceof OfflineEvaluationError || error instanceof ReminderEvaluationError
    ? error.code
    : 'OFFLINE_EVALUATION_FAILED'
  console.error(JSON.stringify({ failed: true, code }))
  process.exitCode = 1
})
