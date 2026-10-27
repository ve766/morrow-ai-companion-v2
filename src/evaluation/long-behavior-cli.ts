import process from 'node:process'
import { runLongBehavior } from './long-behavior'

const root = process.env.MORROW_EVALUATION_ROOT ?? process.cwd()
const endpoint = process.env.MORROW_LONG_BEHAVIOR_ENDPOINT ?? 'http://127.0.0.1:11434/v1'
const model = process.env.MORROW_LONG_BEHAVIOR_MODEL ?? 'qwen2.5:0.5b'
const runs = Number(process.env.MORROW_LONG_BEHAVIOR_RUNS ?? '5')

async function main(): Promise<void> {
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10) throw new Error('INVALID_RUNS')
  const results = await runLongBehavior({ root, endpoint, model, runs })
  console.log(JSON.stringify({
    runs: results.length,
    provider: { endpoint, model },
    verdicts: results.map(({ report }) => ({
      runId: report.reproduction.runId,
      codeCommit: report.reproduction.codeCommit,
      codeState: report.reproduction.codeState,
      verdict: report.run.verdict,
      safetyViolation: report.run.safetyViolation,
      roleConfusion: report.run.roleConfusion,
      blockingViolation: report.run.blockingViolation,
      turn25: report.run.turn25.findings,
      turn26: report.run.turn26.findings
    })),
    paths: results.map(({ path }) => path)
  }))
}

main().catch((error: unknown) => {
  const code = error instanceof Error && error.message === 'PROVIDER_UNREACHABLE' ? 'PROVIDER_UNREACHABLE' : 'LONG_BEHAVIOR_FAILED'
  console.error(JSON.stringify({ failed: true, code }))
  process.exitCode = code === 'PROVIDER_UNREACHABLE' ? 3 : 1
})
