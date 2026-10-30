/**
 * Stage 3 runner entry point. The shared harness lives in `harness.ts` so the
 * ablation and longitudinal runners can import it without executing this file.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DATASET_VERSION, HARNESS_VERSION, buildStack, head, scenarios } from './harness'

export async function main(): Promise<void> {
  const root = resolve(process.cwd())
  const startedAt = new Date().toISOString()
  const sha = head()
  const results: ScenarioOutcome[] = []
  for (const scenario of scenarios) {
    const stack = buildStack()
    try {
      results.push(await scenario.run(stack))
    } catch (error) {
      results.push({ id: scenario.id, status: 'FAIL', assertions: [], error: error instanceof Error ? error.message : String(error) })
    } finally {
      stack.close()
    }
  }
  const finishedAt = new Date().toISOString()
  const counts = results.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.status] = (accumulator[item.status] ?? 0) + 1
    return accumulator
  }, {})
  const payload = {
    datasetVersion: DATASET_VERSION,
    harnessVersion: HARNESS_VERSION,
    codeCommit: sha,
    environment: { platform: process.platform, node: process.version },
    provider: 'scripted-offline (not a model)',
    startedAt,
    finishedAt,
    denominator: scenarios.length,
    counts,
    scenarios: results
  }
  const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const outDir = join(root, 'evals', 'stage-3', 'results')
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `${stamp}-${sha.slice(0, 7)}.json`)
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  const summaryFile = join(outDir, `${stamp}-${sha.slice(0, 7)}-summary.json`)
  writeFileSync(summaryFile, `${JSON.stringify({ ...payload, scenarios: results.map(({ id, status }) => ({ id, status })) }, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ file, summaryFile, counts, denominator: scenarios.length }, null, 2)}\n`)
  if ((counts.FAIL ?? 0) > 0) process.exitCode = 1
}

if (require.main === module) void main()
