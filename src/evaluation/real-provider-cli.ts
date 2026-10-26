import process from 'node:process'
import { relative, resolve } from 'node:path'
import { runRealProviderConversation } from './real-provider-conversation'
import { ReportPathError, atomicWriteReport, resolveReportPath } from './report-path'

/**
 * CLI for the real-provider verification. Exit codes:
 *   0  every objective check passed
 *   1  the verification itself could not run (bad output path, crashed)
 *   2  at least one check failed
 *   3  blocked (no reachable provider): nothing is claimed either way
 *
 * The output path is confined to `<root>/evaluation/reports` by the shared
 * report-path guard, so a mistyped or hostile value cannot write evidence
 * outside the repository or over an unrelated file.
 */

const root = process.env.MORROW_EVALUATION_ROOT ?? process.cwd()
const reportsDirectory = resolve(root, 'evaluation', 'reports')
const outputName = process.env.MORROW_REAL_PROVIDER_OUTPUT ?? 'real-provider-conversation-report.json'

async function main(): Promise<void> {
  // Validate the destination before the run, so a bad path fails in a second
  // instead of after a multi-minute verification.
  resolveReportPath(reportsDirectory, outputName)
  const evidence = await runRealProviderConversation()

  // A blocked run produced no evidence, so it writes no report. Overwriting a
  // previous verified report with a "blocked" one would destroy the only record
  // of the last real verification, and writing nothing is more honest than
  // writing a file that looks like a result.
  const blocked = evidence.status === 'blocked'
  const outputPath = blocked
    ? null
    : atomicWriteReport(reportsDirectory, outputName, `${JSON.stringify(evidence, null, 2)}\n`)

  const passedChecks = evidence.checks.filter((check) => check.passed).length
  console.log(JSON.stringify({
    status: evidence.status,
    evidenceClass: evidence.evidenceClass,
    blockedReason: evidence.blockedReason,
    provider: evidence.provider,
    generatedAt: evidence.generatedAt,
    environment: evidence.environment,
    summary: evidence.summary,
    checkTotals: { total: evidence.checks.length, passed: passedChecks, failed: evidence.checks.length - passedChecks },
    checks: evidence.checks.map((check) => ({
      id: check.id,
      passed: check.passed,
      detail: check.detail,
      ...(check.failures.length > 0 ? { failures: check.failures } : {})
    })),
    failureScenarios: evidence.failureScenarios.map((scenario) => ({
      id: scenario.id,
      executedAgainst: scenario.executedAgainst,
      errorCode: scenario.errorCode,
      // null means "not exercised", which is neither a pass nor a failure.
      passed: scenario.executedAgainst === 'not_exercised' ? null : scenario.passed,
      storedUserMessages: scenario.storedUserMessages,
      storedAssistantMessages: scenario.storedAssistantMessages,
      ...(scenario.failures.length > 0 ? { failures: scenario.failures } : {})
    })),
    observations: evidence.observations,
    quality: evidence.quality,
    reportWritten: outputPath !== null,
    report: outputPath === null ? null : relative(root, outputPath).split('\\').join('/')
  }, null, 2))

  if (blocked) process.exitCode = 3
  else if (evidence.status !== 'verified') process.exitCode = 2
}

main().catch((error: unknown) => {
  // Never echo the error object itself: a fetch failure can carry the request
  // in its message on some runtimes, and the request contains user text.
  const code = error instanceof ReportPathError ? error.code : 'REAL_PROVIDER_VERIFICATION_FAILED'
  console.error(JSON.stringify({ failed: true, code }))
  process.exitCode = 1
})
