import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync('scripts/verify/manifest.json', 'utf8'))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

describe('verification manifest', () => {
  it('declares all five tiers with at least one step', () => {
    for (const tier of ['fast', 'full', 'product', 'stages', 'release']) {
      expect(manifest.tiers[tier]?.steps.length, tier).toBeGreaterThan(0)
    }
  })

  it('only references commands that exist in package.json scripts', () => {
    for (const [tierName, tier] of Object.entries(manifest.tiers) as Array<[string, { steps: Array<{ id: string; command: string; kind: string; requiresCredentials?: boolean }> }]>) {
      for (const step of tier.steps) {
        const npmRun = step.command.match(/^npm run ([\w:.-]+)$/)?.[1]
        if (npmRun) expect(pkg.scripts[npmRun], `${tierName}/${step.id}`).toBeTruthy()
        else if (step.command === 'npm test') expect(pkg.scripts.test, `${tierName}/${step.id}`).toBeTruthy()
        else expect(step.command.startsWith('npx vitest run'), `${tierName}/${step.id}: ${step.command}`).toBe(true)
      }
    }
  })

  it('marks live evaluations as requiring credentials so they are skipped, not faked', () => {
    const stageSteps = manifest.tiers.stages.steps as Array<{ id: string; kind: string; requiresCredentials?: boolean }>
    for (const step of stageSteps.filter((entry) => entry.id.includes(':live'))) {
      expect(step.kind).toBe('live')
      expect(step.requiresCredentials).toBe(true)
    }
  })

  it('runner keeps per-step statuses, skips uncredentialed live steps and exits non-zero on failure', () => {
    const runner = readFileSync('scripts/verify/run-tier.mjs', 'utf8')
    expect(runner).toContain("status: 'SKIPPED'")
    expect(runner).toContain("? 'PASS' : 'FAIL'")
    expect(runner).toContain('process.exit(anyFailure ? 1 : 0)')
    expect(runner).toContain('jsonOut')
  })
})
