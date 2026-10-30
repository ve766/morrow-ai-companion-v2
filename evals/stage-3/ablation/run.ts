/**
 * Stage 3 ablation: the same 15 scenarios, four arms.
 *
 * The question each arm answers is narrow and falsifiable: *does this module
 * change any observable behaviour?* An arm that produces identical results is
 * evidence that the module is not load-bearing, and the result file says so
 * instead of claiming a contribution.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildStack, head, scenarios, type Options, type ScenarioOutcome } from '../runner/harness'

const ARMS: Array<{ id: string; label: string; options: Options }> = [
  { id: 'full', label: 'full system', options: { growth: true, exploration: true, reflection: true } },
  { id: 'no_growth', label: 'growth off', options: { growth: false, exploration: true, reflection: true } },
  { id: 'no_exploration', label: 'exploration off', options: { growth: true, exploration: false, reflection: true } },
  { id: 'no_reflection', label: 'reflection off', options: { growth: true, exploration: true, reflection: false } }
]


async function runArm(options: Options): Promise<ScenarioOutcome[]> {
  const results: ScenarioOutcome[] = []
  for (const scenario of scenarios) {
    const stack = buildStack(options)
    try {
      results.push(await scenario.run(stack))
    } catch (error) {
      results.push({ id: scenario.id, status: 'FAIL', assertions: [], error: error instanceof Error ? error.message : String(error) })
    } finally {
      stack.close()
    }
  }
  return results
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const sha = head()
  const arms: Array<{ id: string; label: string; counts: Record<string, number>; scenarios: Array<{ id: string; status: string }> }> = []
  for (const arm of ARMS) {
    const results = await runArm(arm.options)
    const counts = results.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.status] = (accumulator[item.status] ?? 0) + 1
      return accumulator
    }, {})
    arms.push({ id: arm.id, label: arm.label, counts, scenarios: results.map(({ id, status }) => ({ id, status })) })
  }

  const baseline = arms[0]!
  const deltas = arms.slice(1).map((arm) => {
    const changed = arm.scenarios.filter((scenario, index) => scenario.status !== baseline.scenarios[index]?.status).map((scenario) => scenario.id)
    return { arm: arm.id, changedScenarios: changed, changedCount: changed.length }
  })

  const payload = {
    datasetVersion: 'stage-3-v1',
    harnessVersion: 'stage-3-ablation-v1',
    codeCommit: sha,
    environment: { platform: process.platform, node: process.version },
    provider: 'scripted-offline (not a model)',
    startedAt,
    finishedAt: new Date().toISOString(),
    arms,
    deltas,
    note: 'An arm with zero changed scenarios is reported as "no observable difference"; that is not evidence the module is useless, only that these 15 scripted scenarios do not exercise it.'
  }
  const outDir = join(resolve(process.cwd()), 'evals', 'stage-3', 'ablation', 'results')
  mkdirSync(outDir, { recursive: true })
  const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const file = join(outDir, `${stamp}-${sha.slice(0, 7)}.json`)
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ file, arms: arms.map((arm) => ({ id: arm.id, counts: arm.counts })), deltas }, null, 2)}\n`)
}

void main()
