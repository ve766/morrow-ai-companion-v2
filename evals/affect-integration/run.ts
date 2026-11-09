/**
 * Reproducible micro-benchmark for the Issue #72 affect pipeline.
 *
 * It measures deterministic local work only: appraisal, candidate merge, the
 * trait fold, and durable trait observation. No provider call is made.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { analyzeCognitiveTurn } from '../../src/cognition/cognitive-turn-analyzer'
import { appraiseTurn } from '../../src/affective-state/appraisal-engine'
import { createInitialAffectState, mergeEmotionCandidates } from '../../src/affective-state/emotion-model'
import { deterministicEmotionId } from '../../src/affective-state/emotion-service'
import { SqliteDatabase } from '../../src/persistence/database'
import { MorrowTraitService, TRAIT_DEFINITIONS, foldTraitObservations, type TraitObservation } from '../../src/self-model/morrow-trait-service'

const at = '2026-11-08T05:00:00.000Z'

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return Number((sorted[index] ?? 0).toFixed(3))
}

function stats(values: number[]): { count: number; p50Ms: number; p95Ms: number; meanMs: number; maxMs: number } {
  return {
    count: values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    meanMs: Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3))
  }
}

function run(): void {
  const content = 'That answer was not helpful. Please recheck the database conclusion.'
  const analysis = analyzeCognitiveTurn(content, [], randomUUID())
  const appraisalTimes: number[] = []
  for (let index = 0; index < 500; index += 1) {
    const start = performance.now()
    appraiseTurn({ content, analysis, at, interactionEventType: 'system_correction', sourceMessageId: randomUUID() })
    appraisalTimes.push(performance.now() - start)
  }

  let state = createInitialAffectState(at)
  const projectionTimes: number[] = []
  for (let index = 0; index < 300; index += 1) {
    const result = appraiseTurn({ content, analysis, at, interactionEventType: 'system_correction', sourceMessageId: randomUUID() })
    const start = performance.now()
    let generated = 0
    state = mergeEmotionCandidates({
      state, candidates: result.accepted, eventId: randomUUID(), at,
      makeId: () => deterministicEmotionId(`bench-${index}-${generated++}`)
    })
    projectionTimes.push(performance.now() - start)
  }

  const observations: TraitObservation[] = Array.from({ length: 200 }, (_, index) => ({
    id: randomUUID(),
    traitKey: 'responsibility',
    turnId: randomUUID(),
    conversationId: randomUUID(),
    sourceMessageId: null,
    sourceEventId: randomUUID(),
    sourceKind: 'morrow_self_appraisal',
    signal: 0.5,
    weight: 0.85,
    quality: 0.85,
    contextTag: index % 2 === 0 ? 'database' : 'deployment',
    at: new Date(Date.parse(at) + index * 3_600_000).toISOString()
  }))
  const foldTimes: number[] = []
  for (let index = 0; index < 100; index += 1) {
    const start = performance.now()
    foldTraitObservations(observations.slice(0, Math.min(observations.length, index + 1)), at, TRAIT_DEFINITIONS.responsibility)
    foldTimes.push(performance.now() - start)
  }

  const directory = mkdtempSync(join(tmpdir(), 'morrow-affect-bench-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const traits = new MorrowTraitService(database, () => at)
  const traitWriteTimes: number[] = []
  try {
    for (const observation of observations) {
      const start = performance.now()
      traits.observe(observation)
      traitWriteTimes.push(performance.now() - start)
    }
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }

  console.log(JSON.stringify({
    issue: 72,
    measuredAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    units: 'milliseconds',
    appraisal: stats(appraisalTimes),
    emotionProjection: stats(projectionTimes),
    traitFold: stats(foldTimes),
    traitWrite: stats(traitWriteTimes),
    note: 'Local deterministic functions and SQLite; no provider call, no network.'
  }, null, 2))
}

run()
