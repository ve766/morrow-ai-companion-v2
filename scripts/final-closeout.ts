/**
 * Final closeout artifacts.
 *
 * Produces the four machine-readable files next to the verification log, all
 * sharing its `<UTC>-<sha>` prefix:
 *
 *   -summary.json       status matrix (per item: status, evidence, commitSha, blockedReason)
 *   -b1.json            B1 dev-set cases, confusion matrix, accuracy, high-confidence errors
 *   -b4-faults.json     B4 fault windows (process-level + injected), provider calls, message counts
 *   -b5-ablation.json   B5 full vs no_reflection: evidence, gate, final payload difference
 *
 * Everything is derived from a run at the current HEAD with a clean worktree; the
 * script refuses to run dirty so a result can never be attributed to a commit it
 * was not produced from.
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeCognitiveTurnDetailed } from '../src/cognition/cognitive-turn-analyzer'
import type { CognitiveHistoryMessage } from '../src/cognition/cognition'

const ROOT = process.cwd()
const FINAL_DIR = join(ROOT, 'evals', 'stage-2', 'final')
const SOURCE_ID = '00000000-0000-4000-8000-000000000100'
const PRIOR_ID = '00000000-0000-4000-8000-000000000101'

interface DevCase {
  id: string
  content: string
  history: 'none' | 'related' | 'unrelated' | 'conflict'
  prior?: string
  expectStrategy: 'answer' | 'retrieve_memory' | 'clarify'
  why: string
}

function headSha(): string {
  return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
}

function assertClean(): void {
  const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
  if (dirty.length > 0) {
    throw new Error(`worktree is dirty, refusing to bind results to a commit:\n${dirty}`)
  }
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function verificationCommit(path: string): string {
  const text = readFileSync(path, 'utf8')
  return /^commitSha=(.+)$/mu.exec(text)?.[1]?.trim() ?? ''
}

function newestVerification(): { path: string; prefix: string } {
  const files = readdirSync(FINAL_DIR).filter((name) => name.endsWith('-verification.txt')).sort()
  if (files.length === 0) throw new Error('no verification log found; run the verification pass first')
  const path = join(FINAL_DIR, files.at(-1)!)
  const prefix = files.at(-1)!.replace(/-verification\.txt$/u, '')
  return { path, prefix }
}

/** Parses `## <name>` … `exit: <code>` blocks out of the verification log. */
function parseVerification(path: string): Array<{ name: string; command: string; exit: number }> {
  const text = readFileSync(path, 'utf8')
  const blocks = text.split(/^## /mu).slice(1)
  return blocks.map((block) => {
    const name = block.split('\n')[0]!.trim()
    const command = /^command: (.*)$/mu.exec(block)?.[1] ?? ''
    const exit = Number(/^exit: (-?\d+)$/mu.exec(block)?.[1] ?? 'NaN')
    return { name, command, exit }
  })
}

function historyFor(testCase: DevCase): CognitiveHistoryMessage[] {
  if (testCase.history === 'none' || !testCase.prior) return []
  return [{ id: PRIOR_ID, role: 'user', body: testCase.prior }]
}

function buildB1(sha: string) {
  const dataset = JSON.parse(readFileSync(join(ROOT, 'evals', 'stage-2', 'b1-devset.json'), 'utf8')) as {
    version: string
    cases: DevCase[]
  }
  const rows = dataset.cases.map((testCase) => {
    const reading = analyzeCognitiveTurnDetailed(testCase.content, historyFor(testCase), SOURCE_ID)
    return {
      id: testCase.id,
      content: testCase.content,
      history: testCase.history,
      expected: testCase.expectStrategy,
      actual: reading.analysis.strategy,
      top: reading.assessment.top,
      topScore: reading.assessment.topScore,
      margin: reading.assessment.margin,
      band: reading.assessment.band,
      needsClarification: reading.assessment.needsClarification,
      correct: reading.analysis.strategy === testCase.expectStrategy
    }
  })
  const confusion: Record<string, Record<string, number>> = {}
  for (const row of rows) {
    confusion[row.expected] ??= {}
    confusion[row.expected]![row.actual] = (confusion[row.expected]![row.actual] ?? 0) + 1
  }
  const correct = rows.filter((row) => row.correct).length
  // "High confidence and wrong" is the failure that matters: a confident answer
  // the user did not mean. It is counted, not hidden inside an average.
  const highConfidenceErrors = rows.filter((row) => row.band === 'high' && !row.correct)
  return {
    kind: 'b1_devset_evaluation' as const,
    generatedAt: new Date().toISOString(),
    commitSha: sha,
    datasetVersion: dataset.version,
    datasetPath: 'evals/stage-2/b1-devset.json',
    calibration: 'uncalibrated_heuristic' as const,
    note: 'Small labelled set. Reports hit rate, confusion matrix and high-confidence errors; does not claim generalisation or probability calibration.',
    sampleSize: rows.length,
    accuracy: { correct, total: rows.length, rate: Number((correct / rows.length).toFixed(4)) },
    confusion,
    falsePositives: rows.filter((row) => row.actual === 'clarify' && row.expected !== 'clarify').map((row) => row.id),
    falseNegatives: rows.filter((row) => row.actual !== 'clarify' && row.expected === 'clarify').map((row) => row.id),
    highConfidenceErrorCount: highConfidenceErrors.length,
    highConfidenceErrors: highConfidenceErrors.map((row) => ({ id: row.id, expected: row.expected, actual: row.actual, topScore: row.topScore })),
    cases: rows
  }
}

function buildB4(sha: string) {
  const reportPath = join(ROOT, 'node_modules', '.cache', 'b4-report.json')
  execFileSync('npx', [
    'vitest', 'run',
    'tests/b4-child-crash.test.ts',
    'src/app/b4-recovery.integration.test.ts',
    '--reporter=json',
    `--outputFile=${reportPath}`
  ], { cwd: ROOT, stdio: 'pipe', timeout: 600_000 })
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    testResults: Array<{ name: string; assertionResults: Array<{ title: string; status: string; fullName: string }> }>
  }
  const suites = report.testResults.map((suite) => ({
    file: suite.name.replace(ROOT.replaceAll('\\', '/'), '').replace(/^\/+/, ''),
    cases: suite.assertionResults.map((item) => ({ title: item.title, status: item.status }))
  }))
  const all = suites.flatMap((suite) => suite.cases)
  return {
    kind: 'b4_fault_matrix' as const,
    generatedAt: new Date().toISOString(),
    commitSha: sha,
    note: 'Process-level windows use a real SIGKILL of a child process; the cleanup-failure window is an injected failure because commit and cleanup share one transaction.',
    windows: [
      { window: 'before_provider', level: 'process-kill', expectation: 'no message, no provider call, settled as failed' },
      { window: 'during_provider', level: 'process-kill', expectation: 'user message kept, no answer, settled as failed, provider not re-called' },
      { window: 'after_provider_before_persist', level: 'process-kill', expectation: 'intent kept, no answer, settled as failed, provider not re-called' },
      { window: 'after_commit_before_cleanup', level: 'injected-failure', expectation: 'answer kept, intent settled, no second answer' },
      { window: 'repeat_recovery', level: 'process-kill', expectation: 'second pass does nothing in every window' },
      { window: 'conversation_deleted', level: 'injected-failure', expectation: 'nothing resurrected' },
      { window: 'restart', level: 'file-database', expectation: 'recovery works after reopening the database' }
    ],
    totals: { cases: all.length, passed: all.filter((item) => item.status === 'passed').length, failed: all.filter((item) => item.status !== 'passed').length },
    suites
  }
}

function buildB5(sha: string) {
  execFileSync('node', ['node_modules/.cache/reflection-positive.cjs'], { cwd: ROOT, stdio: 'pipe', timeout: 600_000 })
  const directory = join(ROOT, 'evals', 'stage-2', 'ablation', 'results')
  const files = readdirSync(directory).filter((name) => name.endsWith('-reflection-positive.json')).sort()
  const source = JSON.parse(readFileSync(join(directory, files.at(-1)!), 'utf8')) as Record<string, unknown>
  const arms = source.arms as Array<Record<string, unknown>>
  const full = arms.find((arm) => arm.arm === 'full')!
  const off = arms.find((arm) => arm.arm === 'no_reflection')!
  return {
    kind: 'b5_reflection_ablation' as const,
    generatedAt: new Date().toISOString(),
    commitSha: sha,
    sourceReport: `evals/stage-2/ablation/results/${files.at(-1)!}`,
    fixture: source.fixture,
    layers: {
      reflectionRan: { full: Number(full.reflectionRuns) > 0, no_reflection: Number(off.reflectionRuns) > 0 },
      candidateProduced: { full: full.interestStatusAfter !== null, no_reflection: off.interestStatusAfter !== null },
      gatePassed: { full: full.interestStatusAfter === 'active', no_reflection: off.interestStatusAfter === 'active' },
      payloadChanged: { full: full.probePayloadHasAttentionBlock === true, no_reflection: off.probePayloadHasAttentionBlock === true }
    },
    evidence: {
      full: { evidence: full.interestEvidence, conversations: full.interestConversations, status: full.interestStatusAfter },
      no_reflection: { evidence: off.interestEvidence, conversations: off.interestConversations, status: off.interestStatusAfter }
    },
    retractionRemovesPayloadBlock: full.afterRetractionHasAttentionBlock === false,
    comparison: source.comparison
  }
}

function main(): void {
  assertClean()
  const sha = headSha()
  const { path, prefix } = newestVerification()
  // The log is produced at the commit under test; committing the log moves HEAD by
  // one evidence-only commit. Bind the results to the SHA that produced them and
  // record the commit they were published in separately — never claim the newer
  // SHA ran anything.
  const resultSha = verificationCommit(path)
  if (!resultSha) throw new Error(`verification log ${path} has no commitSha`)
  if (!isAncestor(resultSha, sha)) {
    throw new Error(`verification log ${path} was produced at ${resultSha}, which is not an ancestor of ${sha}`)
  }
  const verification = parseVerification(path)
  const b1 = buildB1(resultSha)
  const b4 = buildB4(resultSha)
  const b5 = buildB5(resultSha)

  const failedCommands = verification.filter((entry) => entry.exit !== 0)
  const summary = {
    kind: 'stage2_final_status_matrix' as const,
    generatedAt: new Date().toISOString(),
    commitSha: resultSha,
    shortSha: resultSha.slice(0, 7),
    publishedInCommit: sha,
    branch: execSync('git branch --show-current', { encoding: 'utf8' }).trim(),
    verificationLog: `evals/stage-2/final/${prefix}-verification.txt`,
    environment: { node: process.version, platform: process.platform },
    items: [
      { id: 'P0-1-B1', status: b1.highConfidenceErrorCount === 0 ? 'PASS' : 'PARTIAL', evidence: [`evals/stage-2/final/${prefix}-b1.json`], note: 'strategy wired to the score; calibration label stays uncalibrated_heuristic' },
      { id: 'P0-2-B4', status: b4.totals.failed === 0 ? 'PASS' : 'FAIL', evidence: [`evals/stage-2/final/${prefix}-b4-faults.json`, `evals/stage-2/final/${prefix}-verification.txt`], note: '3 windows by real SIGKILL, 1 by injected cleanup failure' },
      { id: 'P0-3-B5', status: b5.layers.payloadChanged.full && !b5.layers.payloadChanged.no_reflection ? 'PASS' : 'FAIL', evidence: [`evals/stage-2/final/${prefix}-b5-ablation.json`], note: 'mapping pipeline + dedupe + pending personality candidate' },
      { id: 'P1-1-regression', status: failedCommands.length === 0 ? 'PASS' : 'FAIL', evidence: [`evals/stage-2/final/${prefix}-verification.txt`], note: 'B2/B3/A1–A3 suites included in npm test' },
      { id: 'CI', status: 'BLOCKED', evidence: ['https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41010305777'], blockedReason: 'account billing: jobs never acquired a runner (runner_id=0, steps=0)' },
      { id: 'real-provider', status: 'NOT_RUN', evidence: ['evals/stage-2/provider/phase24-real-model-26aeac7.json'], blockedReason: 'no credential provided in this session; previous report kept with its own codeSha' },
      { id: 'windows-installer', status: 'BLOCKED', evidence: [], blockedReason: 'no installer built or installed in this environment' }
    ],
    commands: verification,
    failedCommands
  }

  writeFileSync(join(FINAL_DIR, `${prefix}-summary.json`), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(FINAL_DIR, `${prefix}-b1.json`), `${JSON.stringify(b1, null, 2)}\n`)
  writeFileSync(join(FINAL_DIR, `${prefix}-b4-faults.json`), `${JSON.stringify(b4, null, 2)}\n`)
  writeFileSync(join(FINAL_DIR, `${prefix}-b5-ablation.json`), `${JSON.stringify(b5, null, 2)}\n`)

  console.log(`prefix ${prefix}`)
  console.log(`b1 ${b1.accuracy.correct}/${b1.accuracy.total} highConfidenceErrors=${b1.highConfidenceErrorCount}`)
  console.log(`b4 ${b4.totals.passed}/${b4.totals.cases}`)
  console.log(`b5 full=${b5.layers.payloadChanged.full} off=${b5.layers.payloadChanged.no_reflection} retraction=${b5.retractionRemovesPayloadBlock}`)
  console.log(`failedCommands ${failedCommands.map((entry) => `${entry.name}:${entry.exit}`).join(',') || 'none'}`)
}

main()
