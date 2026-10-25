import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { CognitiveEvaluationError, runCognitiveEvaluation } from './cognitive-evaluation'
import { FeelingEvaluationError, runFeelingEvaluation } from './feeling-evaluation'

const root = process.env.MORROW_EVALUATION_ROOT
if (!root) throw new CognitiveEvaluationError('MISSING_EVALUATION_ROOT')

const fixturesDirectory = resolve(root, 'evaluation', 'fixtures')
const reportsDirectory = resolve(root, 'evaluation', 'reports')
const reportNames = ['cognitive-turn-synthetic-report.json', 'feeling-synthetic-report.json'] as const

function usage(): string {
  return [
    'Morrow synthetic cognitive-core evaluation',
    'npm run evaluate:cognition [-- --clear]',
    'Uses fixed synthetic fixtures; makes no provider, network, or tool calls.'
  ].join('\n')
}

function pathInside(directory: string, filename: string): string {
  if (!filename || isAbsolute(filename)) throw new CognitiveEvaluationError('PATH_OUTSIDE_EVALUATION')
  const base = resolve(directory)
  const path = resolve(base, filename)
  const rel = relative(base, path)
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new CognitiveEvaluationError('PATH_OUTSIDE_EVALUATION')
  }
  return path
}

function assertNoSymlink(base: string, path: string): void {
  const rel = relative(base, path)
  let current = base
  for (const part of rel.split(/[\\/]/u)) {
    current = resolve(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new CognitiveEvaluationError('SYMLINK_PATH_NOT_ALLOWED')
  }
}

function readFixture(name: string): unknown {
  const path = pathInside(fixturesDirectory, name)
  assertNoSymlink(fixturesDirectory, path)
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    throw new CognitiveEvaluationError('INVALID_JSON_INPUT')
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
  const temporary = resolve(reportsDirectory, `.morrow-cognitive-evaluation-${process.pid}-${Date.now()}.tmp`)
  writeFileSync(temporary, value, { encoding: 'utf8', flag: 'wx' })
  renameSync(temporary, path)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage())
    return
  }
  if (args.some((argument) => argument !== '--clear') || args.filter((argument) => argument === '--clear').length > 1) {
    throw new CognitiveEvaluationError('INVALID_ARGUMENT')
  }
  const paths = reportNames.map((name) => pathInside(reportsDirectory, name))
  if (args.includes('--clear')) {
    const removed = paths.map((path, index) => {
      if (!existsSync(path)) return { report: `evaluation/reports/${reportNames[index]}`, removed: false }
      assertNoSymlink(reportsDirectory, path)
      rmSync(path)
      return { report: `evaluation/reports/${reportNames[index]}`, removed: true }
    })
    console.log(JSON.stringify({ removed }))
    return
  }

  const cognitive = runCognitiveEvaluation(readFixture('cognitive-turn-v1.json'))
  const feeling = runFeelingEvaluation(readFixture('feeling-v1.json'))
  const cognitiveDigest = createHash('sha256').update(canonicalJson(cognitive)).digest('hex')
  const feelingDigest = createHash('sha256').update(canonicalJson(feeling)).digest('hex')
  atomicWrite(paths[0]!, `${JSON.stringify({ ...cognitive, reportSha256: cognitiveDigest }, null, 2)}\n`)
  atomicWrite(paths[1]!, `${JSON.stringify({ ...feeling, reportSha256: feelingDigest }, null, 2)}\n`)
  console.log(JSON.stringify({
    passed: cognitive.gate.passed && feeling.gate.passed,
    cognitiveTurn: {
      cases: cognitive.dataset.caseCount,
      intentAccuracy: cognitive.metrics.intentAccuracy,
      strategyAccuracy: cognitive.metrics.strategyAccuracy,
      topicReferenceAccuracy: cognitive.metrics.topicReferenceAccuracy,
      deterministic: cognitive.determinism.passed,
      report: `evaluation/reports/${reportNames[0]}`,
      reportSha256: cognitiveDigest
    },
    feeling: {
      cases: feeling.dataset.caseCount,
      intentAccuracy: feeling.metrics.intentAccuracy,
      eventClassificationAccuracy: feeling.metrics.eventClassificationAccuracy,
      stateDirectionAccuracy: feeling.metrics.stateDirectionAccuracy,
      eventDetectionPrecision: feeling.metrics.eventDetectionPrecision,
      eventDetectionRecall: feeling.metrics.eventDetectionRecall,
      userAffectTransferCount: feeling.metrics.userAffectTransferCount,
      evidenceTraceabilityFailures: feeling.metrics.evidenceTraceabilityFailures,
      behaviorGuidanceFailures: feeling.metrics.behaviorGuidanceFailures,
      deterministic: feeling.determinism.passed,
      report: `evaluation/reports/${reportNames[1]}`,
      reportSha256: feelingDigest
    },
    gates: { cognitiveTurn: cognitive.gate, feeling: feeling.gate }
  }))
  if (!cognitive.gate.passed || !feeling.gate.passed) process.exitCode = 2
}

main().catch((error: unknown) => {
  const code = error instanceof CognitiveEvaluationError || error instanceof FeelingEvaluationError
    ? error.code
    : 'COGNITIVE_EVALUATION_FAILED'
  console.error(JSON.stringify({ failed: true, code }))
  process.exitCode = 1
})
