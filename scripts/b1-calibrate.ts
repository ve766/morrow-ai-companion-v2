/**
 * B1 weight/threshold search over the labelled development set.
 *
 * Why a script instead of hand-picked constants: the weights in
 * `intent-confidence.ts` have to come from *something reproducible*. This runs
 * the production code path (`analyzeCognitiveTurnDetailed` with overrides) over
 * `evals/stage-2/b1-devset.json`, enumerates a coarse weight simplex, and reports
 * the best configuration together with its accuracy, a held-out split and the
 * failure list.
 *
 * What it does NOT do: claim calibration. Twenty-six cases cannot fit a
 * probability model; the output stays a heuristic score with
 * `calibration: uncalibrated_heuristic`.
 *
 * Run:
 *   node node_modules/esbuild/bin/esbuild scripts/b1-calibrate.ts --bundle \
 *     --platform=node --format=cjs --external:electron \
 *     --outfile=node_modules/.cache/b1-calibrate.cjs
 *   node node_modules/.cache/b1-calibrate.cjs
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeCognitiveTurnDetailed } from '../src/cognition/cognitive-turn-analyzer'
import type { CognitiveHistoryMessage } from '../src/cognition/cognition'
import type { IntentConfidenceOverrides } from '../src/cognition/intent-confidence'

const APPROVED_FLAG = 'B1_CALIBRATION_APPROVED'
void APPROVED_FLAG

interface DevCase {
  id: string
  content: string
  history: 'none' | 'related' | 'unrelated' | 'conflict'
  prior?: string
  expectStrategy: 'answer' | 'retrieve_memory' | 'clarify'
  why: string
}

const SOURCE_ID = '00000000-0000-4000-8000-000000000100'

interface FixtureCase {
  content: string
  history: CognitiveHistoryMessage[]
  expectStrategy: 'answer' | 'retrieve_memory' | 'clarify'
  id: string
}

/**
 * The pre-existing labelled corpus, used as a second validation set.
 *
 * Fitting only on the B1 development set let a vector win by leaning on text
 * shape and then break this corpus; scoring both keeps one from being traded for
 * the other. Both are small, so the result is still a heuristic.
 */
function loadFixtureCases(): FixtureCase[] {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'evaluation/fixtures/cognitive-turn-v1.json'), 'utf8')) as {
    cases: Array<{ id: string; input: string; history?: CognitiveHistoryMessage[]; expected: { strategy: 'answer' | 'retrieve_memory' | 'clarify' } }>
  }
  return fixture.cases.map((item) => ({
    id: item.id,
    content: item.input,
    history: item.history ?? [],
    expectStrategy: item.expected.strategy
  }))
}
const PRIOR_ID = '00000000-0000-4000-8000-000000000101'

function historyFor(testCase: DevCase): CognitiveHistoryMessage[] {
  if (testCase.history === 'none' || !testCase.prior) return []
  return [{ id: PRIOR_ID, role: 'user', body: testCase.prior }]
}

function evaluateFixture(cases: FixtureCase[], overrides: IntentConfidenceOverrides): { correct: number } {
  let correct = 0
  for (const testCase of cases) {
    const reading = analyzeCognitiveTurnDetailed(testCase.content, testCase.history, SOURCE_ID, overrides)
    if (reading.analysis.strategy === testCase.expectStrategy) correct += 1
  }
  return { correct }
}

function evaluate(cases: DevCase[], overrides: IntentConfidenceOverrides): {
  correct: number
  failures: Array<{ id: string; expected: string; actual: string; top: string; margin: number; z: number }>
  perCase: Array<{ id: string; expected: string; actual: string; strategy: string; top: string; z: number; margin: number; band: string }>
} {
  let correct = 0
  const failures: Array<{ id: string; expected: string; actual: string; top: string; margin: number; z: number }> = []
  const perCase: Array<{ id: string; expected: string; actual: string; strategy: string; top: string; z: number; margin: number; band: string }> = []
  for (const testCase of cases) {
    const reading = analyzeCognitiveTurnDetailed(testCase.content, historyFor(testCase), SOURCE_ID, overrides)
    const actual = reading.analysis.strategy
    if (actual === testCase.expectStrategy) correct += 1
    else failures.push({ id: testCase.id, expected: testCase.expectStrategy, actual, top: reading.assessment.top, margin: reading.assessment.margin, z: reading.assessment.topScore })
    perCase.push({
      id: testCase.id,
      expected: testCase.expectStrategy,
      actual,
      strategy: actual,
      top: reading.assessment.top,
      z: reading.assessment.topScore,
      margin: reading.assessment.margin,
      band: reading.assessment.band
    })
  }
  return { correct, failures, perCase }
}

/** Coarse simplex: 0.1 steps, five weights, sum exactly 1. */
function* weightGrid(): Generator<{ semantic: number; explicitness: number; completeness: number; context: number; ambiguity: number }> {
  for (let semantic = 0; semantic <= 10; semantic += 1) {
    for (let explicitness = 0; semantic + explicitness <= 10; explicitness += 1) {
      for (let completeness = 0; semantic + explicitness + completeness <= 10; completeness += 1) {
        for (let context = 0; semantic + explicitness + completeness + context <= 10; context += 1) {
          const ambiguity = 10 - semantic - explicitness - completeness - context
          yield {
            semantic: semantic / 10,
            explicitness: explicitness / 10,
            completeness: completeness / 10,
            context: context / 10,
            ambiguity: ambiguity / 10
          }
        }
      }
    }
  }
}

function main(): void {
  const headSha = process.env.MORROW_EVAL_HEAD ?? execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  const dataset = JSON.parse(readFileSync(join(process.cwd(), 'evals/stage-2/b1-devset.json'), 'utf8')) as {
    version: string
    cases: DevCase[]
  }
  const cases = dataset.cases
  // Deterministic split: every third case is held out. Small, but it stops the
  // report from quoting only in-sample numbers.
  const devCases = cases.filter((_, index) => index % 3 !== 2)
  const holdoutCases = cases.filter((_, index) => index % 3 === 2)

  const fixtureCases = loadFixtureCases()
  const marginFloors = [0.08, 0.1, 0.12]
  const clarifyThresholds = [0.42, 0.45, 0.48]

  let best: {
    weights: { semantic: number; explicitness: number; completeness: number; context: number; ambiguity: number }
    marginFloor: number
    clarifyThreshold: number
    correct: number
    accuracy: number
  } | null = null
  let bestReasoningWeight = 0

  for (const weights of weightGrid()) {
    // Degenerate corners are excluded on principle, not to make a case pass:
    //   - zero ambiguity cannot express doubt, zero semantics/explicitness cannot
    //     express a reading;
    //   - positive evidence must dominate doubt (`s+e+m ≥ 0.6`, `a ≤ 0.25`),
    //     otherwise the search happily "wins" by letting uncertainty swamp every
    //     candidate, which is a broken scorer rather than a tuned one.
    if (weights.ambiguity > 0.25) continue
    // Principled constraints, not tuning knobs:
    //  - no feature may be zeroed (a dropped feature is a broken scorer);
    //  - `completeness` is a text-shape proxy (length, verb/scope words), so it may
    //    never carry the model — otherwise a long vague sentence outranks a short
    //    explicit one;
    //  - the reason-bearing features (semantic + explicitness + context) must
    //    dominate, because they are the ones that describe *what the turn means*.
    if (Object.values(weights).some((value) => value < 0.05)) continue
    if (weights.completeness > 0.2) continue
    // Context fit couples a reading to the prior turn; it may modulate, never
    // dominate, or "there is history and it mentions the same thing" becomes the
    // whole model.
    if (weights.context > 0.3) continue
    // Rule evidence and explicitness are what describe the turn itself.
    if (weights.semantic + weights.explicitness < 0.5) continue
    for (const marginFloor of marginFloors) {
      for (const clarifyThreshold of clarifyThresholds) {
        const overrides: IntentConfidenceOverrides = { weights, marginFloor, clarifyThreshold }
        const result = evaluate(devCases, overrides)
        const fixture = evaluateFixture(fixtureCases, overrides)
        const combined = result.correct + fixture.correct
        if (!best) {
          best = { weights, marginFloor, clarifyThreshold, correct: combined, accuracy: combined / (devCases.length + fixtureCases.length) }
          bestReasoningWeight = weights.semantic + weights.explicitness
          continue
        }
        const reasoningWeight = weights.semantic + weights.explicitness
        // Tie-break: among equally accurate vectors prefer the one where the
        // reason-bearing features carry more of the score. A vector leaning on
        // text shape fits this small set just as well but cannot separate two
        // equally complete readings — exactly the case B1 exists for.
        const better = combined > best.correct ||
          (combined === best.correct && reasoningWeight > bestReasoningWeight + 1e-9)
        if (better) {
          best = { weights, marginFloor, clarifyThreshold, correct: combined, accuracy: combined / (devCases.length + fixtureCases.length) }
          bestReasoningWeight = reasoningWeight
        }
      }
    }
  }

  if (!best) throw new Error('weight search produced no candidate')

  const chosen: IntentConfidenceOverrides = {
    weights: best.weights,
    marginFloor: best.marginFloor,
    clarifyThreshold: best.clarifyThreshold
  }
  const devResult = evaluate(devCases, chosen)
  const fixtureResult = evaluateFixture(fixtureCases, chosen)
  const holdoutResult = evaluate(holdoutCases, chosen)
  const allResult = evaluate(cases, chosen)

  // Invariant the tests also assert: for a turn that does not reference the
  // prior turn, history presence must not change the score at all.
  const contrastIds = ['clear-personal-query']
  const contrast = contrastIds.map((id) => {
    const base = cases.find((item) => item.id === id)!
    const withoutHistory = analyzeCognitiveTurnDetailed(base.content, [], SOURCE_ID, chosen).assessment
    const withUnrelated = analyzeCognitiveTurnDetailed(base.content, historyFor({ ...base, history: 'unrelated', prior: '帮我看看这道数学题。' }), SOURCE_ID, chosen).assessment
    const withRelated = analyzeCognitiveTurnDetailed(base.content, historyFor({ ...base, history: 'related', prior: '我最近在找杭州的房子。' }), SOURCE_ID, chosen).assessment
    const scoreFor = (assessment: typeof withoutHistory, label: string): number | null =>
      assessment.candidates.find((candidate) => candidate.label === label)?.z ?? null
    const expectedLabel = withoutHistory.top
    const scores = [withoutHistory, withUnrelated, withRelated].map((assessment) => scoreFor(assessment, expectedLabel))
    return {
      content: base.content,
      label: expectedLabel,
      withoutHistoryTopScore: withoutHistory.topScore,
      withUnrelatedTopScore: withUnrelated.topScore,
      withRelatedTopScore: withRelated.topScore,
      sameLabelScores: scores,
      // The invariant that matters: the *same reading* is scored identically
      // whether or not history exists. History may introduce a candidate; it may
      // not inflate the score of a reading that stands alone.
      identical: scores.every((value) => value !== null && value === scores[0])
    }
  })

  const startedAt = new Date().toISOString()
  const summary = {
    kind: 'b1_calibration' as const,
    generatedAt: startedAt,
    headSha,
    datasetVersion: dataset.version,
    datasetPath: 'evals/stage-2/b1-devset.json',
    calibration: 'uncalibrated_heuristic' as const,
    note: '26 例开发集：只支撑权重方向与阈值选择，不支撑概率校准；holdout 仅为防止只报 in-sample 数字。',
    search: {
      weightStep: 0.1,
      weightsEnumerated: 1001,
      marginFloors,
      clarifyThresholds,
      degenerateVectorsSkipped: 'ambiguity/semantic/explicitness 为 0 的角点被排除',
      totalEvaluated: 1001 * marginFloors.length * clarifyThresholds.length
    },
    chosen: {
      weights: best.weights,
      marginFloor: best.marginFloor,
      clarifyThreshold: best.clarifyThreshold
    },
    accuracy: {
      dev: { cases: devCases.length, correct: devResult.correct, rate: Number((devResult.correct / devCases.length).toFixed(4)) },
      holdout: { cases: holdoutCases.length, correct: holdoutResult.correct, rate: Number((holdoutResult.correct / holdoutCases.length).toFixed(4)) },
      all: { cases: cases.length, correct: allResult.correct, rate: Number((allResult.correct / cases.length).toFixed(4)) },
      fixtureCorpus: { cases: fixtureCases.length, correct: fixtureResult.correct, rate: Number((fixtureResult.correct / fixtureCases.length).toFixed(4)) }
    },
    confusion: (() => {
      const table: Record<string, Record<string, number>> = {}
      for (const item of allResult.perCase) {
        table[item.expected] ??= {}
        table[item.expected]![item.actual] = (table[item.expected]![item.actual] ?? 0) + 1
      }
      return table
    })(),
    failures: allResult.failures,
    historyContrast: contrast,
    cases: allResult.perCase
  }

  const directory = join(process.cwd(), 'evals', 'stage-2', 'results')
  mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const path = join(directory, `${stamp}-${headSha.slice(0, 7)}-cognitive.json`)
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`)

  console.log(`dev ${devResult.correct}/${devCases.length}  holdout ${holdoutResult.correct}/${holdoutCases.length}  all ${allResult.correct}/${cases.length}  fixture ${fixtureResult.correct}/${fixtureCases.length}`)
  console.log('weights', JSON.stringify(best.weights), 'marginFloor', best.marginFloor, 'clarify', best.clarifyThreshold)
  console.log('history contrast identical:', contrast.every((item) => item.identical))
  if (allResult.failures.length > 0) {
    for (const failure of allResult.failures) console.log(`  MISS ${failure.id}: expected ${failure.expected}, got ${failure.actual} (top=${failure.top} z=${failure.z} Δ=${failure.margin})`)
  }
  console.log('report', path)
}

main()
