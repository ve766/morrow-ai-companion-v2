/**
 * Layered verification runner (Issue #61 P2).
 *
 * Usage: node scripts/verify/run-tier.mjs <tier> [--json <outPath>]
 *
 * Rules from the issue:
 *  - every step keeps its own exit code; a failure never becomes PASS;
 *  - live steps that need credentials are marked SKIPPED when the credential
 *    environment variable is absent, never counted as PASS or FAIL;
 *  - the process exits non-zero when any step FAILED, so CI and shells see the
 *    real result even while the full summary is still written.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const tierName = process.argv[2]
const jsonIndex = process.argv.indexOf('--json')
const jsonOut = jsonIndex > -1 ? process.argv[jsonIndex + 1] : undefined

if (!tierName) {
  console.error('usage: node scripts/verify/run-tier.mjs <fast|full|product|stages|release> [--json out.json]')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(join(repoRoot, 'scripts/verify/manifest.json'), 'utf8'))
const tier = manifest.tiers[tierName]
if (!tier) {
  console.error(`unknown tier: ${tierName}`)
  process.exit(2)
}

function gitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function stepEnvironment(step) {
  const env = { ...process.env }
  if (!step.env) return env
  for (const [key, value] of Object.entries(step.env)) {
    env[key] = String(value).replace('<repo>', repoRoot)
  }
  return env
}

function credentialPresent(step) {
  if (!step.requiresCredentials) return true
  return Boolean(process.env.MORROW_TEST_API_KEY)
}

const results = []
const startedAt = new Date().toISOString()
let anyFailure = false

for (const step of tier.steps) {
  if (!credentialPresent(step)) {
    results.push({ id: step.id, command: step.command, status: 'SKIPPED', reason: 'credentials not configured', exitCode: null, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() })
    continue
  }
  const stepStart = new Date()
  const run = spawnSync(step.command, {
    cwd: repoRoot,
    env: stepEnvironment(step),
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  const stepEnd = new Date()
  const status = run.status === 0 ? 'PASS' : 'FAIL'
  if (run.status !== 0) anyFailure = true
  results.push({
    id: step.id,
    command: step.command,
    status,
    exitCode: run.status,
    startedAt: stepStart.toISOString(),
    endedAt: stepEnd.toISOString(),
    durationMs: stepEnd.getTime() - stepStart.getTime(),
    stdoutTail: (run.stdout ?? '').split('\n').slice(-12).join('\n').slice(-4000),
    stderrTail: (run.stderr ?? '').split('\n').slice(-12).join('\n').slice(-4000)
  })
  console.log(`[${status}] ${step.id} (exit ${run.status})`)
}

const endedAt = new Date().toISOString()
const summary = {
  version: 1,
  tier: tierName,
  description: tier.description,
  commit: gitSha(),
  startedAt,
  endedAt,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  counts: {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    skipped: results.filter((r) => r.status === 'SKIPPED').length
  },
  overall: anyFailure ? 'FAIL' : 'PASS',
  results
}

if (jsonOut) {
  mkdirSync(join(repoRoot, jsonOut, '..'), { recursive: true })
  writeFileSync(join(repoRoot, jsonOut), JSON.stringify(summary, null, 2), 'utf8')
  console.log(`summary written: ${join(repoRoot, jsonOut)}`)
}

console.log(`tier ${tierName}: ${summary.overall} (${summary.counts.pass} pass / ${summary.counts.fail} fail / ${summary.counts.skipped} skipped)`)
process.exit(anyFailure ? 1 : 0)
