/**
 * CLI wrapper for the Phase 2.3 report checks.
 *
 *   npm run verify:phase23
 *
 * Exits non-zero when the report text, the stored summaries and the per-run rows
 * disagree. The checks themselves live in `src/evaluation/phase23-report-check.ts`
 * so the negative path can be unit-tested.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkPhase23Report, type RawReport, type RescoredReport, type ReviewFile } from '../src/evaluation/phase23-report-check'

const reportsDir = join(process.cwd(), 'evaluation', 'reports')
const reportPath = process.env.MORROW_PHASE23_REPORT ?? join(process.cwd(), 'docs', 'reports', 'cognitive-loop-v1-phase2-3.md')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function pick(prefix: string, suffix: string): string[] {
  return readdirSync(reportsDir).filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
}

const rawFiles = pick('phase23-spark-', '.json').filter((name) => /^phase23-spark-[ABCD]-/u.test(name)).sort()
const rescoredFiles = pick('phase23-rescored-', '.json').sort()
const reviewPath = join(reportsDir, 'phase23-human-review.json')
const missing: string[] = []
if (rawFiles.length !== 4) missing.push(`expected 4 raw reports, found ${rawFiles.length}`)
if (rescoredFiles.length !== 4) missing.push(`expected 4 re-scored reports, found ${rescoredFiles.length}`)
if (!existsSync(reviewPath)) missing.push('human review file is missing')
if (!existsSync(reportPath)) missing.push('report markdown is missing')

if (missing.length > 0) {
  console.error(JSON.stringify({ ok: false, failures: missing }, null, 2))
  process.exit(1)
}

const result = checkPhase23Report({
  raw: rawFiles.map((name) => readJson<RawReport>(join(reportsDir, name))),
  rescored: rescoredFiles.map((name) => readJson<RescoredReport>(join(reportsDir, name))),
  review: readJson<ReviewFile>(reviewPath),
  markdown: readFileSync(reportPath, 'utf8')
})

writeFileSync(join(reportsDir, 'phase23-verification.json'), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), ...result.summary, ok: result.ok, failures: result.failures }, null, 2)}\n`, 'utf8')

if (!result.ok) {
  console.error(JSON.stringify({ ok: false, failures: result.failures }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ ok: true, ...result.summary }))
}
