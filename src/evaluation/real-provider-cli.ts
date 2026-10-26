import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { runRealProviderConversation } from './real-provider-conversation'

/**
 * CLI for the real-provider verification. Exit codes:
 *   0  every objective check passed
 *   2  a check failed
 *   3  blocked (no reachable provider): nothing is claimed either way
 */

const root = process.env.MORROW_EVALUATION_ROOT ?? process.cwd()
const outputName = process.env.MORROW_REAL_PROVIDER_OUTPUT ?? 'evaluation/reports/real-provider-conversation-report.json'

async function main(): Promise<void> {
  const evidence = await runRealProviderConversation()
  const outputPath = resolve(root, outputName)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    status: evidence.status,
    blockedReason: evidence.blockedReason,
    provider: evidence.provider,
    summary: evidence.summary,
    checks: evidence.checks.map((check) => ({ id: check.id, passed: check.passed, detail: check.detail })),
    observations: evidence.observations,
    quality: evidence.quality,
    report: outputName
  }, null, 2))

  if (evidence.status === 'blocked') process.exitCode = 3
  else if (evidence.status !== 'verified') process.exitCode = 2
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ failed: true, message: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
})
