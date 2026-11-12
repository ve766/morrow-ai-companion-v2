import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const reportDirectory = resolve(root, 'evaluation', 'reports')
const outputs = [
  { name: 'cognitive-turn-synthetic-example.json', entry: 'src/evaluation/cognitive-evaluation.ts', fixture: 'cognitive-turn-v1.json', run: 'runCognitiveEvaluation' },
  { name: 'feeling-synthetic-example.json', entry: 'src/evaluation/feeling-evaluation.ts', fixture: 'feeling-v1.json', run: 'runFeelingEvaluation' },
  { name: 'cognitive-alpha-adversarial-report.json', entry: 'src/evaluation/cognitive-alpha-evaluation.ts', fixture: 'cognitive-alpha-adversarial-v1.json', run: 'runCognitiveAlphaEvaluation' },
  { name: 'intent-decision-synthetic-example.json', entry: 'src/evaluation/intent-decision-evaluation.ts', fixture: 'intent-decision-v1.json', run: 'runIntentDecisionEvaluation' }
]

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function assertNoSymlink(base, target) {
  const path = relative(base, target)
  if (path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('REPORT_PATH_INVALID')
  let current = base
  for (const part of path.split(/[\\/]/u)) {
    current = resolve(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('REPORT_SYMLINK_NOT_ALLOWED')
  }
}

function atomicWrite(path, value) {
  mkdirSync(reportDirectory, { recursive: true })
  assertNoSymlink(resolve(reportDirectory, '..'), reportDirectory)
  assertNoSymlink(reportDirectory, path)
  const temporary = resolve(reportDirectory, `.morrow-cognitive-${process.pid}-${Date.now()}.tmp`)
  writeFileSync(temporary, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  renameSync(temporary, path)
}

function clearReports() {
  mkdirSync(reportDirectory, { recursive: true })
  assertNoSymlink(resolve(reportDirectory, '..'), reportDirectory)
  for (const output of outputs) {
    const path = resolve(reportDirectory, output.name)
    assertNoSymlink(reportDirectory, path)
    if (existsSync(path)) rmSync(path)
  }
  process.stdout.write(JSON.stringify({ removed: outputs.map((output) => `evaluation/reports/${output.name}`) }) + '\n')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    process.stdout.write('Run deterministic, offline cognitive-turn, feeling, and adversarial Alpha evaluations.\nUsage: npm run evaluate:cognition [-- --clear]\n')
    return
  }
  if (args.length > 0 && !(args.length === 1 && args[0] === '--clear')) throw new Error('INVALID_ARGUMENT')
  if (args[0] === '--clear') {
    clearReports()
    return
  }

  const started = performance.now()
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'morrow-cognitive-evaluation-'))
  try {
    await build({
      entryPoints: outputs.map((output) => resolve(root, output.entry)),
      outdir: temporaryDirectory,
      entryNames: '[name]',
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      packages: 'bundle',
      outExtension: { '.js': '.mjs' },
      logLevel: 'silent'
    })

    const results = []
    for (const output of outputs) {
      const modulePath = resolve(temporaryDirectory, `${output.entry.split('/').at(-1).replace(/\.ts$/u, '')}.mjs`)
      const module = await import(pathToFileURL(modulePath).href)
      const fixture = JSON.parse(readFileSync(resolve(root, 'evaluation', 'fixtures', output.fixture), 'utf8'))
      const report = module[output.run](fixture)
      const reportWithDigest = { ...report, reportSha256: digest(report) }
      atomicWrite(resolve(reportDirectory, output.name), `${JSON.stringify(reportWithDigest, null, 2)}\n`)
      results.push({ output, report })
    }

    const [cognitive, feeling, alpha, intent] = results
    const summary = {
      passed: Boolean(cognitive.report.gate.passed && feeling.report.gate.passed && alpha.report.gate.passed && intent.report.gate.passed),
      durationMs: Number((performance.now() - started).toFixed(2)),
      cognitive: {
        dataset: cognitive.report.dataset.id,
        cases: cognitive.report.dataset.caseCount,
        intentAccuracy: cognitive.report.metrics.intentAccuracy,
        strategyAccuracy: cognitive.report.metrics.strategyAccuracy,
        correctionPrecision: cognitive.report.metrics.correctionPrecision,
        correctionRecall: cognitive.report.metrics.correctionRecall,
        deterministicReplay: cognitive.report.determinism.passed,
        gate: cognitive.report.gate,
        report: `evaluation/reports/${cognitive.output.name}`
      },
      feeling: {
        dataset: feeling.report.dataset.id,
        cases: feeling.report.dataset.caseCount,
        intentAccuracy: feeling.report.metrics.intentAccuracy,
        eventClassificationAccuracy: feeling.report.metrics.eventClassificationAccuracy,
        eventDetectionPrecision: feeling.report.metrics.eventDetectionPrecision,
        eventDetectionRecall: feeling.report.metrics.eventDetectionRecall,
        stateDirectionAccuracy: feeling.report.metrics.stateDirectionAccuracy,
        attentionDirectionAccuracy: feeling.report.metrics.attentionDirectionAccuracy,
        userAffectTransferCount: feeling.report.metrics.userAffectTransferCount,
        attentionBoundViolations: feeling.report.metrics.attentionBoundViolations,
        evidenceTraceabilityFailures: feeling.report.metrics.evidenceTraceabilityFailures,
        deterministicReplay: feeling.report.determinism.passed,
        gate: feeling.report.gate,
        report: `evaluation/reports/${feeling.output.name}`
      },
      cognitiveAlpha: {
        dataset: alpha.report.dataset.id,
        cases: alpha.report.dataset.caseCount,
        safetyCriticalCases: alpha.report.dataset.safetyCriticalCaseCount,
        intentAllowlistAccuracy: alpha.report.metrics.intentAllowlistAccuracy,
        strategyAllowlistAccuracy: alpha.report.metrics.strategyAllowlistAccuracy,
        topicReferenceAccuracy: alpha.report.metrics.topicReferenceAccuracy,
        uncertaintyBucketAgreement: alpha.report.metrics.uncertaintyBucketAgreement,
        eventTypeAccuracy: alpha.report.metrics.eventTypeAccuracy,
        eventDetectionPrecision: alpha.report.metrics.eventDetectionPrecision,
        eventDetectionRecall: alpha.report.metrics.eventDetectionRecall,
        stateChangeAccuracy: alpha.report.metrics.stateChangeAccuracy,
        safetyCriticalPassRate: alpha.report.metrics.safetyCriticalPassRate,
        userAffectTransferViolations: alpha.report.metrics.userAffectTransferViolations,
        rawEventTextLeaks: alpha.report.metrics.rawEventTextLeaks,
        calibration: alpha.report.calibration,
        deterministicReplay: alpha.report.determinism.passed,
        gate: alpha.report.gate,
        report: `evaluation/reports/${alpha.output.name}`
      },
      intentDecision: {
        dataset: intent.report.dataset.id,
        cases: intent.report.dataset.caseCount,
        intentAccuracy: intent.report.metrics.intentAccuracy,
        routingAccuracy: intent.report.metrics.routingAccuracy,
        perClass: intent.report.metrics.perClass,
        deterministicReplay: intent.report.determinism.passed,
        gate: intent.report.gate,
        report: `evaluation/reports/${intent.output.name}`
      },
      offlineExecution: {
        providerCalls: alpha.report.evaluationScope.providerCalls,
        networkCalls: alpha.report.evaluationScope.networkCalls,
        networkGuarded: alpha.report.evaluationScope.networkGuarded,
        toolCalls: alpha.report.evaluationScope.toolCalls
      }
    }
    process.stdout.write(JSON.stringify(summary) + '\n')
    if (!summary.passed) process.exitCode = 2
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

main().catch(() => {
  process.stderr.write('Offline cognitive evaluation failed; no result should be interpreted as a pass.\n')
  process.exitCode = 1
})
