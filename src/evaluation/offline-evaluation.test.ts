import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildSync } from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'
import { runM2SafetyFixtures } from './m2-safety'
import {
  OfflineEvaluationError,
  runOfflineEvaluation,
  validateCandidateSpec,
  validateEvaluationDataset
} from './offline-evaluation'
import type { M2SafetyReport } from './m2-safety'

const root = process.cwd()
const cliTemp = mkdtempSync(join(tmpdir(), 'morrow-m3-cli-test-'))
const cliRoot = join(cliTemp, 'workspace')
const bundlePath = join(cliTemp, 'm3-cli.mjs')
mkdirSync(cliRoot, { recursive: true })
for (const folder of ['fixtures', 'baselines', 'candidates']) {
  cpSync(resolve(root, 'evaluation', folder), resolve(cliRoot, 'evaluation', folder), { recursive: true })
}
mkdirSync(resolve(cliRoot, 'evaluation/reports'), { recursive: true })
cpSync(
  resolve(root, 'evaluation/reports/m3-synthetic-example.json'),
  resolve(cliRoot, 'evaluation/reports/m3-synthetic-example.json')
)
buildSync({
  entryPoints: [resolve(root, 'src/evaluation/cli.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'bundle',
  logLevel: 'silent'
})

afterAll(() => rmSync(cliTemp, { recursive: true, force: true }))

function runCli(args: string[]) {
  return spawnSync(process.execPath, [bundlePath, ...args], {
    cwd: root,
    env: { ...process.env, MORROW_EVALUATION_ROOT: cliRoot },
    encoding: 'utf8',
    timeout: 30_000
  })
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as unknown
const dataset = readJson('evaluation/fixtures/retrieval-v1.json')
const baseline = readJson('evaluation/baselines/m1-substring-v1.json')
const candidate = readJson('evaluation/candidates/scope-aware-token-v1.json')

async function evaluate(safety: M2SafetyReport) {
  return runOfflineEvaluation(dataset, baseline, candidate, safety)
}

describe('M3 offline replay and shadow evaluation', () => {
  it('accepts only bounded, versioned synthetic fixtures', () => {
    const validated = validateEvaluationDataset(dataset)
    expect(validated.source).toBe('synthetic')
    expect(validated.seed).toBe(1729)
    expect(validated.cases).toHaveLength(11)
    expect(validated.cases.flatMap((sample) => sample.memories).every((memory) => memory.sourceRef.startsWith('fixture:') && memory.dataVersion === '1.0.0')).toBe(true)

    const unsafe = structuredClone(dataset) as { source: string }
    unsafe.source = 'production'
    expect(() => validateEvaluationDataset(unsafe)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATASET_METADATA' })
    )
  })

  it('rejects arbitrary executable candidate payloads and unknown strategies', () => {
    const executablePayload = {
      schemaVersion: 1,
      id: 'malicious-candidate',
      version: '1.0.0',
      strategy: 'javascript-source',
      topK: 5,
      minimumCoverage: 0,
      source: 'globalThis.fetch("https://example.invalid")'
    }
    expect(() => validateCandidateSpec(executablePayload)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CANDIDATE_SPEC' })
    )
  })

  it('enforces M2 approval/recovery safety and scores the isolated candidate against M1', async () => {
    const safety = await runM2SafetyFixtures()
    expect(safety.passed).toBe(true)
    expect(safety.networkAttempts).toBe(0)
    expect(safety.executionCalls).toBe(1)
    expect(safety.verificationCalls).toBe(1)
    expect(safety.memoryStateUnchanged).toBe(true)
    expect(safety.cases.map((item) => item.id)).toContain('prompt-injection-cannot-expand-goal-scope')

    const report = await evaluate(safety)
    expect(report.gate.passed).toBe(true)
    expect(report.baselineMetrics.precision).toBe(0.4)
    expect(report.candidateMetrics.precision).toBe(1)
    expect(report.candidateMetrics.recall).toBe(1)
    expect(report.candidateMetrics.unknownCaseLeakCount).toBe(0)
    expect(report.candidateMetrics.sourceLeakCount).toBe(0)
    expect(report.candidateMetrics.scopeLeakCount).toBe(0)
    expect(report.candidateMetrics.restrictedLeakCount).toBe(0)
    expect(report.candidateMetrics.uncertaintyLeakCount).toBe(0)
    expect(report.candidateMetrics.retractedOrDeletedLeakCount).toBe(0)
    expect(report.candidateActivation).toEqual({
      state: 'offline-review-only',
      activated: false,
      automaticPromotion: false
    })
    expect(report.comparison.find((sample) => sample.caseId === 'injected-text-is-data')?.candidateIds).toEqual([])
  })

  it('produces the same result hash for repeated runs with the same seed and configuration', async () => {
    const safety = await runM2SafetyFixtures()
    const first = await evaluate(safety)
    const second = await evaluate(safety)
    expect(first.determinism.repeatable).toBe(true)
    expect(second.determinism.repeatable).toBe(true)
    expect(first.determinism.resultHash).toBe(second.determinism.resultHash)
  })

  it('rejects output paths outside the evaluation reports directory', () => {
    const child = runCli(['--output', '../escaped.json'])
    expect(child.status).not.toBe(0)
    expect(child.stderr).toContain('INVALID_REPORT_NAME')
  })

  it('clears only a named report under evaluation/reports', () => {
    const reportName = `test-clear-${process.pid}.json`
    const reportPath = resolve(cliRoot, 'evaluation/reports', reportName)
    const clearExisting = runCli(['--clear', '--output', reportName])
    expect(clearExisting.status).toBe(0)

    const generated = runCli(['--output', reportName])
    expect(generated.status).toBe(0)
    expect(existsSync(reportPath)).toBe(true)

    const cleared = runCli(['--clear', '--output', reportName])
    expect(cleared.status).toBe(0)
    expect(existsSync(reportPath)).toBe(false)
    expect(existsSync(resolve(cliRoot, 'evaluation/fixtures/retrieval-v1.json'))).toBe(true)
    expect(existsSync(resolve(cliRoot, 'evaluation/reports/m3-synthetic-example.json'))).toBe(true)
  })
})
