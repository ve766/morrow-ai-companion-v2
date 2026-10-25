import { createHash } from 'node:crypto'
import type { M2SafetyReport } from './m2-safety'

export const EVALUATION_RUNNER_VERSION = '1.0.0'
export const EVALUATION_TOP_K_LIMIT = 5
export const MAX_FIXTURE_CASES = 50
export const MAX_MEMORIES_PER_CASE = 100
export const SQLITE_ASCII_SUBSTRING_STRATEGY = 'sqlite-ascii-substring-v1' as const
export const SCOPE_AWARE_TOKEN_STRATEGY = 'scope-aware-token-overlap-v1' as const

export type EvaluationSourceCategory = 'user_explicit_input' | 'system_observation' | 'external_source' | 'model_inference'
export type EvaluationKind = 'fact' | 'preference' | 'expectation' | 'inference'
export type EvaluationMemoryStatus = 'active' | 'retracted' | 'deleted' | 'expired'
export type EvaluationSensitivity = 'ordinary' | 'restricted'
export type EvaluationUncertainty = 'known' | 'unknown' | 'context_dependent'
export type EvaluationJudgment = 'relevant' | 'irrelevant' | 'unknown'

export interface EvaluationMemory {
  id: string
  text: string
  sourceCategory: EvaluationSourceCategory
  sourceRef: string
  dataVersion: string
  updatedAt: string
  kind: EvaluationKind
  status: EvaluationMemoryStatus
  sensitivity: EvaluationSensitivity
  uncertainty: EvaluationUncertainty
  applicableScopes: string[]
  judgment: EvaluationJudgment
}

export interface EvaluationCase {
  id: string
  version: 1
  source: 'synthetic'
  query: string
  scope: string
  allowSensitive: boolean
  expectation: 'known' | 'unknown'
  memories: EvaluationMemory[]
}

export interface EvaluationDataset {
  schemaVersion: 1
  datasetId: string
  datasetVersion: string
  source: 'synthetic'
  seed: number
  cases: EvaluationCase[]
}

export interface BaselineAlgorithmSpec {
  schemaVersion: 1
  id: string
  version: string
  strategy: typeof SQLITE_ASCII_SUBSTRING_STRATEGY
  topK: number
}

export interface CandidateAlgorithmSpec {
  schemaVersion: 1
  id: string
  version: string
  strategy: typeof SCOPE_AWARE_TOKEN_STRATEGY
  topK: number
  minimumCoverage: number
}

export interface AlgorithmMetrics {
  precision: number
  recall: number
  sourceAttributionAccuracy: number
  unsupportedRate: number
  totalReturned: number
  expectedRelevantCount: number
  falsePositiveCount: number
  falseNegativeCount: number
  unknownCaseLeakCount: number
  sourceLeakCount: number
  scopeLeakCount: number
  restrictedLeakCount: number
  uncertaintyLeakCount: number
  retractedOrDeletedLeakCount: number
  crossSampleConsistencyViolations: number
}

export interface CaseComparison {
  caseId: string
  version: 1
  expectation: 'known' | 'unknown'
  expectedRelevantIds: string[]
  baselineIds: string[]
  candidateIds: string[]
  baselineFailureCodes: string[]
  candidateFailureCodes: string[]
  repeatable: boolean
}

export interface EvaluationReport {
  reportVersion: 1
  runnerVersion: string
  generatedAt: string
  dataset: {
    id: string
    version: string
    schemaVersion: number
    source: 'synthetic'
    seed: number
    caseCount: number
    inputSetHash: string
  }
  algorithms: {
    baseline: { id: string; version: string; sourceHash: string; strategy: string }
    candidate: { id: string; version: string; sourceHash: string; strategy: string }
  }
  config: { topK: number; maximumCases: number; maximumMemoriesPerCase: number }
  determinism: { repeatable: boolean; repeatedRunsPerSample: number; resultHash: string }
  baselineMetrics: AlgorithmMetrics
  candidateMetrics: AlgorithmMetrics
  comparison: CaseComparison[]
  m2Safety: {
    passed: boolean
    isolatedStore: 'sqlite::memory:'
    networkAttempts: number
    executionCalls: number
    verificationCalls: number
    executionStatus: string
    resultCount: number | null
    verifiedCount: number | null
    verificationStatus: string
    memoryStateUnchanged: boolean
    cases: Array<{ id: string; passed: boolean }>
  }
  gate: {
    passed: boolean
    thresholds: Record<string, number>
    checks: Record<string, boolean>
    failedChecks: string[]
  }
  candidateActivation: { state: 'offline-review-only'; activated: false; automaticPromotion: false }
  limitations: string[]
}

export class OfflineEvaluationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'OfflineEvaluationError'
  }
}

interface CandidateMemoryInput {
  id: string
  text: string
  sourceCategory: EvaluationSourceCategory
  sourceRef: string
  dataVersion: string
  updatedAt: string
  kind: EvaluationKind
  status: EvaluationMemoryStatus
  sensitivity: EvaluationSensitivity
  uncertainty: EvaluationUncertainty
  applicableScopes: string[]
}

interface CandidateInput {
  query: string
  scope: string
  allowSensitive: boolean
  seed: number
  topK: number
  memories: CandidateMemoryInput[]
}

const sourceCategories = new Set<EvaluationSourceCategory>([
  'user_explicit_input',
  'system_observation',
  'external_source',
  'model_inference'
])
const kinds = new Set<EvaluationKind>(['fact', 'preference', 'expectation', 'inference'])
const statuses = new Set<EvaluationMemoryStatus>(['active', 'retracted', 'deleted', 'expired'])
const sensitivities = new Set<EvaluationSensitivity>(['ordinary', 'restricted'])
const uncertainties = new Set<EvaluationUncertainty>(['known', 'unknown', 'context_dependent'])
const judgments = new Set<EvaluationJudgment>(['relevant', 'irrelevant', 'unknown'])
const expectedKeys = {
  dataset: ['schemaVersion', 'datasetId', 'datasetVersion', 'source', 'seed', 'cases'],
  sample: ['id', 'version', 'source', 'query', 'scope', 'allowSensitive', 'expectation', 'memories'],
  memory: ['id', 'text', 'sourceCategory', 'sourceRef', 'dataVersion', 'updatedAt', 'kind', 'status', 'sensitivity', 'uncertainty', 'applicableScopes', 'judgment'],
  baseline: ['schemaVersion', 'id', 'version', 'strategy', 'topK'],
  candidate: ['schemaVersion', 'id', 'version', 'strategy', 'topK', 'minimumCoverage']
} as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && actual.every((key) => typeof key === 'string' && keys.includes(key))
}

function isText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
}

function isSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value)
}

function isIsoUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isSemver(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/u.test(value)
}

export function isFixtureMemoryEligible(memory: EvaluationMemory, sample: Pick<EvaluationCase, 'scope' | 'allowSensitive'>): boolean {
  return memory.status === 'active' &&
    memory.sourceCategory === 'user_explicit_input' &&
    memory.sourceRef.startsWith('fixture:') &&
    memory.kind !== 'inference' &&
    memory.uncertainty === 'known' &&
    memory.applicableScopes.includes(sample.scope) &&
    (memory.sensitivity !== 'restricted' || sample.allowSensitive)
}

export function validateEvaluationDataset(value: unknown): EvaluationDataset {
  if (!isPlainObject(value) || !hasExactKeys(value, expectedKeys.dataset)) throw new OfflineEvaluationError('INVALID_DATASET_SCHEMA')
  if (
    value.schemaVersion !== 1 || value.source !== 'synthetic' || !isSlug(value.datasetId) ||
    !isSemver(value.datasetVersion) || !Number.isSafeInteger(value.seed) || Number(value.seed) < 0 ||
    !Array.isArray(value.cases) || value.cases.length === 0 || value.cases.length > MAX_FIXTURE_CASES
  ) throw new OfflineEvaluationError('INVALID_DATASET_METADATA')

  const caseIds = new Set<string>()
  for (const sampleValue of value.cases) {
    if (!isPlainObject(sampleValue) || !hasExactKeys(sampleValue, expectedKeys.sample)) throw new OfflineEvaluationError('INVALID_SAMPLE_SCHEMA')
    if (
      !isSlug(sampleValue.id) || caseIds.has(sampleValue.id) || sampleValue.version !== 1 || sampleValue.source !== 'synthetic' ||
      !isText(sampleValue.query, 200) || !isSlug(sampleValue.scope) || typeof sampleValue.allowSensitive !== 'boolean' ||
      (sampleValue.expectation !== 'known' && sampleValue.expectation !== 'unknown') ||
      !Array.isArray(sampleValue.memories) || sampleValue.memories.length > MAX_MEMORIES_PER_CASE
    ) throw new OfflineEvaluationError('INVALID_SAMPLE_METADATA')
    caseIds.add(sampleValue.id)

    const memoryIds = new Set<string>()
    for (const memoryValue of sampleValue.memories) {
      if (!isPlainObject(memoryValue) || !hasExactKeys(memoryValue, expectedKeys.memory)) throw new OfflineEvaluationError('INVALID_MEMORY_SCHEMA')
      if (
        !isSlug(memoryValue.id) || memoryIds.has(memoryValue.id) || !isText(memoryValue.text, 2000) ||
        typeof memoryValue.sourceCategory !== 'string' || !sourceCategories.has(memoryValue.sourceCategory as EvaluationSourceCategory) ||
        typeof memoryValue.sourceRef !== 'string' || !/^fixture:[a-z0-9-]{1,80}$/u.test(memoryValue.sourceRef) ||
        !isSemver(memoryValue.dataVersion) ||
        !isIsoUtcTimestamp(memoryValue.updatedAt) ||
        typeof memoryValue.kind !== 'string' || !kinds.has(memoryValue.kind as EvaluationKind) ||
        typeof memoryValue.status !== 'string' || !statuses.has(memoryValue.status as EvaluationMemoryStatus) ||
        typeof memoryValue.sensitivity !== 'string' || !sensitivities.has(memoryValue.sensitivity as EvaluationSensitivity) ||
        typeof memoryValue.uncertainty !== 'string' || !uncertainties.has(memoryValue.uncertainty as EvaluationUncertainty) ||
        !Array.isArray(memoryValue.applicableScopes) || memoryValue.applicableScopes.length === 0 ||
        !memoryValue.applicableScopes.every((scope) => isSlug(scope)) ||
        typeof memoryValue.judgment !== 'string' || !judgments.has(memoryValue.judgment as EvaluationJudgment)
      ) throw new OfflineEvaluationError('INVALID_MEMORY_METADATA')
      memoryIds.add(memoryValue.id)
    }

    const sample = sampleValue as unknown as EvaluationCase
    const hasEligibleRelevant = sample.memories.some((memory) => isFixtureMemoryEligible(memory, sample) && memory.judgment === 'relevant')
    if ((sample.expectation === 'known') !== hasEligibleRelevant) throw new OfflineEvaluationError('INCONSISTENT_EXPECTATION_LABEL')
  }

  return value as unknown as EvaluationDataset
}

export function validateBaselineSpec(value: unknown): BaselineAlgorithmSpec {
  if (!isPlainObject(value) || !hasExactKeys(value, expectedKeys.baseline)) throw new OfflineEvaluationError('INVALID_BASELINE_SPEC')
  if (
    value.schemaVersion !== 1 || !isSlug(value.id) || !isSemver(value.version) ||
    value.strategy !== SQLITE_ASCII_SUBSTRING_STRATEGY ||
    !Number.isSafeInteger(value.topK) || Number(value.topK) < 1 || Number(value.topK) > EVALUATION_TOP_K_LIMIT
  ) throw new OfflineEvaluationError('INVALID_BASELINE_SPEC')
  return value as unknown as BaselineAlgorithmSpec
}

export function validateCandidateSpec(value: unknown): CandidateAlgorithmSpec {
  if (!isPlainObject(value) || !hasExactKeys(value, expectedKeys.candidate)) throw new OfflineEvaluationError('INVALID_CANDIDATE_SPEC')
  if (
    value.schemaVersion !== 1 || !isSlug(value.id) || !isSemver(value.version) ||
    value.strategy !== SCOPE_AWARE_TOKEN_STRATEGY ||
    !Number.isSafeInteger(value.topK) || Number(value.topK) < 1 || Number(value.topK) > EVALUATION_TOP_K_LIMIT ||
    typeof value.minimumCoverage !== 'number' || !Number.isFinite(value.minimumCoverage) ||
    value.minimumCoverage < 0 || value.minimumCoverage > 1
  ) throw new OfflineEvaluationError('INVALID_CANDIDATE_SPEC')
  return value as unknown as CandidateAlgorithmSpec
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function candidateInput(sample: EvaluationCase, seed: number, topK: number): CandidateInput {
  return deepFreeze({
    query: sample.query,
    scope: sample.scope,
    allowSensitive: sample.allowSensitive,
    seed,
    topK,
    memories: sample.memories.map((memory) => ({
      id: memory.id,
      text: memory.text,
      sourceCategory: memory.sourceCategory,
      sourceRef: memory.sourceRef,
      dataVersion: memory.dataVersion,
      updatedAt: memory.updatedAt,
      kind: memory.kind,
      status: memory.status,
      sensitivity: memory.sensitivity,
      uncertainty: memory.uncertainty,
      applicableScopes: [...memory.applicableScopes]
    }))
  })
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function sqliteAsciiLower(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32))
}

function runBaseline(sample: EvaluationCase, spec: BaselineAlgorithmSpec): string[] {
  const query = sqliteAsciiLower(sample.query.trim())
  return sample.memories
    .filter((memory) => memory.status === 'active' && sqliteAsciiLower(memory.text).includes(query))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, spec.topK)
    .map((memory) => memory.id)
}

function tokenize(value: string): Set<string> {
  const chunks = value.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? []
  const result = new Set<string>()
  for (const chunk of chunks) {
    if (/\p{Script=Han}/u.test(chunk)) {
      const characters = Array.from(chunk)
      if (characters.length === 1) result.add(characters[0]!)
      for (let index = 0; index + 1 < characters.length; index += 1) result.add(characters[index]! + characters[index + 1]!)
    } else {
      result.add(chunk)
    }
  }
  return result
}

function runCandidate(input: CandidateInput, spec: CandidateAlgorithmSpec): string[] {
  const queryTerms = tokenize(input.query)
  if (queryTerms.size === 0) return []
  const eligible = input.memories
    .filter((memory) =>
      memory.status === 'active' &&
      memory.sourceCategory === 'user_explicit_input' &&
      memory.sourceRef.startsWith('fixture:') &&
      memory.kind !== 'inference' &&
      memory.uncertainty === 'known' &&
      memory.applicableScopes.includes(input.scope) &&
      (memory.sensitivity !== 'restricted' || input.allowSensitive)
    )
    .map((memory) => {
      const memoryTerms = tokenize(memory.text)
      let overlap = 0
      for (const term of queryTerms) if (memoryTerms.has(term)) overlap += 1
      return { id: memory.id, updatedAt: memory.updatedAt, coverage: overlap / queryTerms.size }
    })
    .filter((item) => item.coverage >= spec.minimumCoverage)
    .sort((left, right) => right.coverage - left.coverage || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  return eligible.slice(0, Math.min(spec.topK, input.topK)).map((item) => item.id)
}

function isSafeSource(memory: EvaluationMemory): boolean {
  return memory.sourceCategory === 'user_explicit_input' && memory.sourceRef.startsWith('fixture:')
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function countConsistencyViolations(
  samples: readonly EvaluationCase[],
  outputs: ReadonlyMap<string, string[]>,
  seed: number,
  topK: number
): number {
  const seen = new Map<string, string[]>()
  let violations = 0
  for (const sample of samples) {
    const fingerprint = sha256(canonicalJson(candidateInput(sample, seed, topK)))
    const output = outputs.get(sample.id) ?? []
    const previous = seen.get(fingerprint)
    if (previous && !sameIds(previous, output)) violations += 1
    else if (!previous) seen.set(fingerprint, output)
  }
  return violations
}

function metrics(
  samples: readonly EvaluationCase[],
  outputs: ReadonlyMap<string, string[]>,
  expectedByCase: ReadonlyMap<string, Set<string>>,
  seed: number,
  topK: number
): AlgorithmMetrics {
  let totalReturned = 0
  let expectedRelevantCount = 0
  let truePositive = 0
  let falsePositiveCount = 0
  let falseNegativeCount = 0
  let unknownCaseLeakCount = 0
  let sourceLeakCount = 0
  let scopeLeakCount = 0
  let restrictedLeakCount = 0
  let uncertaintyLeakCount = 0
  let retractedOrDeletedLeakCount = 0
  let unsupportedCount = 0

  for (const sample of samples) {
    const ids = outputs.get(sample.id) ?? []
    const byId = new Map(sample.memories.map((memory) => [memory.id, memory]))
    const expected = expectedByCase.get(sample.id) ?? new Set<string>()
    expectedRelevantCount += expected.size
    const returned = new Set(ids)
    truePositive += [...returned].filter((id) => expected.has(id)).length
    falsePositiveCount += [...returned].filter((id) => !expected.has(id)).length
    falseNegativeCount += [...expected].filter((id) => !returned.has(id)).length
    totalReturned += ids.length
    if (sample.expectation === 'unknown' && ids.length > 0) unknownCaseLeakCount += 1

    for (const id of ids) {
      const memory = byId.get(id)
      if (!memory) continue
      if (!isSafeSource(memory)) sourceLeakCount += 1
      if (!memory.applicableScopes.includes(sample.scope)) scopeLeakCount += 1
      if (memory.sensitivity === 'restricted' && !sample.allowSensitive) restrictedLeakCount += 1
      if (memory.uncertainty !== 'known' || memory.judgment === 'unknown') uncertaintyLeakCount += 1
      if (memory.status !== 'active') retractedOrDeletedLeakCount += 1
      if (memory.judgment !== 'relevant') unsupportedCount += 1
    }
  }

  return {
    precision: round(totalReturned === 0 ? 1 : truePositive / totalReturned),
    recall: round(expectedRelevantCount === 0 ? 1 : truePositive / expectedRelevantCount),
    sourceAttributionAccuracy: round(totalReturned === 0 ? 1 : (totalReturned - sourceLeakCount) / totalReturned),
    unsupportedRate: round(totalReturned === 0 ? 0 : unsupportedCount / totalReturned),
    totalReturned,
    expectedRelevantCount,
    falsePositiveCount,
    falseNegativeCount,
    unknownCaseLeakCount,
    sourceLeakCount,
    scopeLeakCount,
    restrictedLeakCount,
    uncertaintyLeakCount,
    retractedOrDeletedLeakCount,
    crossSampleConsistencyViolations: countConsistencyViolations(samples, outputs, seed, topK)
  }
}

function failureCodes(sample: EvaluationCase, ids: string[], expected: Set<string>): string[] {
  const byId = new Map(sample.memories.map((memory) => [memory.id, memory]))
  const failures = new Set<string>()
  for (const id of ids) {
    const memory = byId.get(id)
    if (!memory) failures.add('unknown_memory_id')
    else {
      if (!expected.has(id)) failures.add('unsupported_retrieval')
      if (memory.status !== 'active') failures.add('revoked_or_deleted_memory_returned')
      if (!isSafeSource(memory)) failures.add('untrusted_source_returned')
      if (!memory.applicableScopes.includes(sample.scope)) failures.add('scope_mismatch_returned')
      if (memory.sensitivity === 'restricted' && !sample.allowSensitive) failures.add('restricted_data_returned')
      if (memory.uncertainty !== 'known' || memory.judgment === 'unknown') failures.add('unknown_presented_as_fact')
    }
  }
  if (sample.expectation === 'known' && ![...expected].some((id) => ids.includes(id))) failures.add('relevant_memory_missed')
  if (sample.expectation === 'unknown' && ids.length > 0) failures.add('unknown_case_returned_evidence')
  return [...failures].sort()
}

function validateM2Safety(safety: M2SafetyReport): EvaluationReport['m2Safety'] {
  if (
    !safety || typeof safety.passed !== 'boolean' || safety.isolatedStore !== 'sqlite::memory:' ||
    !Number.isSafeInteger(safety.networkAttempts) || !Number.isSafeInteger(safety.executionCalls) ||
    !Number.isSafeInteger(safety.verificationCalls) || typeof safety.memoryStateUnchanged !== 'boolean' ||
    !isSlug(safety.executionStatus) ||
    !(safety.resultCount === null || (Number.isSafeInteger(safety.resultCount) && safety.resultCount >= 0)) ||
    !(safety.verifiedCount === null || (Number.isSafeInteger(safety.verifiedCount) && safety.verifiedCount >= 0)) ||
    !isSlug(safety.verificationStatus) ||
    !Array.isArray(safety.cases) || safety.cases.length === 0 ||
    !safety.cases.every((item) => isPlainObject(item) && isSlug(item.id) && typeof item.passed === 'boolean')
  ) throw new OfflineEvaluationError('INVALID_M2_SAFETY_EVIDENCE')
  const requiredCases = [
    'prompt-injection-cannot-expand-goal-scope',
    'execution-before-approval-is-rejected',
    'explicit-rejection-never-executes',
    'single-read-only-tool-is-independently-verified',
    'action-is-allowlisted-and-audited-without-memory-text',
    'evaluation-does-not-mutate-memory-state',
    'evaluation-stays-offline'
  ]
  const observed = new Map(safety.cases.map((item) => [item.id, item.passed]))
  const completeCaseSet = observed.size === requiredCases.length && requiredCases.every((id) => observed.has(id))
  const casesPassed = completeCaseSet && requiredCases.every((id) => observed.get(id) === true)
  const passed = safety.passed && casesPassed && safety.networkAttempts === 0 &&
    safety.executionCalls === 1 && safety.verificationCalls === 1 && safety.memoryStateUnchanged &&
    safety.executionStatus === 'succeeded' && safety.resultCount === safety.verifiedCount &&
    safety.verificationStatus === 'matched'
  return {
    passed,
    isolatedStore: safety.isolatedStore,
    networkAttempts: safety.networkAttempts,
    executionCalls: safety.executionCalls,
    verificationCalls: safety.verificationCalls,
    executionStatus: safety.executionStatus,
    resultCount: safety.resultCount,
    verifiedCount: safety.verifiedCount,
    verificationStatus: safety.verificationStatus,
    memoryStateUnchanged: safety.memoryStateUnchanged,
    cases: safety.cases.map((item) => ({ id: item.id, passed: item.passed }))
  }
}

export function runOfflineEvaluation(
  datasetValue: unknown,
  baselineValue: unknown,
  candidateValue: unknown,
  safetyValue: M2SafetyReport
): EvaluationReport {
  const dataset = validateEvaluationDataset(datasetValue)
  const baseline = validateBaselineSpec(baselineValue)
  const candidate = validateCandidateSpec(candidateValue)
  const safety = validateM2Safety(safetyValue)
  const comparisons: CaseComparison[] = []
  const baselineOutputs = new Map<string, string[]>()
  const candidateOutputs = new Map<string, string[]>()
  const expectedByCase = new Map<string, Set<string>>()
  let repeatable = true

  for (const sample of dataset.cases) {
    const expected = new Set(sample.memories.filter((memory) => isFixtureMemoryEligible(memory, sample) && memory.judgment === 'relevant').map((memory) => memory.id))
    expectedByCase.set(sample.id, expected)
    const baselineFirst = runBaseline(sample, baseline)
    const baselineSecond = runBaseline(sample, baseline)
    const input = candidateInput(sample, dataset.seed, candidate.topK)
    const candidateFirst = runCandidate(input, candidate)
    const candidateSecond = runCandidate(input, candidate)
    const caseRepeatable = sameIds(baselineFirst, baselineSecond) && sameIds(candidateFirst, candidateSecond)
    repeatable &&= caseRepeatable
    baselineOutputs.set(sample.id, baselineFirst)
    candidateOutputs.set(sample.id, candidateFirst)
    comparisons.push({
      caseId: sample.id,
      version: sample.version,
      expectation: sample.expectation,
      expectedRelevantIds: [...expected].sort(),
      baselineIds: baselineFirst,
      candidateIds: candidateFirst,
      baselineFailureCodes: failureCodes(sample, baselineFirst, expected),
      candidateFailureCodes: failureCodes(sample, candidateFirst, expected),
      repeatable: caseRepeatable
    })
  }

  const baselineMetrics = metrics(dataset.cases, baselineOutputs, expectedByCase, dataset.seed, baseline.topK)
  const candidateMetrics = metrics(dataset.cases, candidateOutputs, expectedByCase, dataset.seed, candidate.topK)
  const thresholds = {
    minimumPrecision: 0.75,
    minimumRecall: 0.75,
    minimumSourceAttributionAccuracy: 1,
    maximumUnsupportedRate: 0,
    maximumUnknownCaseLeaks: 0,
    maximumSourceLeaks: 0,
    maximumScopeLeaks: 0,
    maximumRestrictedLeaks: 0,
    maximumUncertaintyLeaks: 0,
    maximumRetractedOrDeletedLeaks: 0,
    maximumCrossSampleConsistencyViolations: 0
  }
  const checks = {
    candidatePrecision: candidateMetrics.precision >= thresholds.minimumPrecision,
    candidateRecall: candidateMetrics.recall >= thresholds.minimumRecall,
    sourceAttribution: candidateMetrics.sourceAttributionAccuracy >= thresholds.minimumSourceAttributionAccuracy,
    unsupportedRetrieval: candidateMetrics.unsupportedRate <= thresholds.maximumUnsupportedRate,
    unknownPreserved: candidateMetrics.unknownCaseLeakCount <= thresholds.maximumUnknownCaseLeaks,
    sourceLeakage: candidateMetrics.sourceLeakCount <= thresholds.maximumSourceLeaks,
    scopeLeakage: candidateMetrics.scopeLeakCount <= thresholds.maximumScopeLeaks,
    restrictedDataLeakage: candidateMetrics.restrictedLeakCount <= thresholds.maximumRestrictedLeaks,
    uncertaintyLeakage: candidateMetrics.uncertaintyLeakCount <= thresholds.maximumUncertaintyLeaks,
    deletedOrRevokedLeakage: candidateMetrics.retractedOrDeletedLeakCount <= thresholds.maximumRetractedOrDeletedLeaks,
    crossSampleConsistency: candidateMetrics.crossSampleConsistencyViolations <= thresholds.maximumCrossSampleConsistencyViolations,
    noRecallRegression: candidateMetrics.recall >= baselineMetrics.recall,
    deterministicReplay: repeatable,
    m2AuthorizationAndVerification: safety.passed,
    evaluationNoNetwork: safety.networkAttempts === 0,
    evaluationDoesNotMutateMemory: safety.memoryStateUnchanged,
    evaluationUsesIsolatedDatabase: safety.isolatedStore === 'sqlite::memory:'
  }
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  const reportWithoutHash = {
    reportVersion: 1 as const,
    runnerVersion: EVALUATION_RUNNER_VERSION,
    dataset: {
      id: dataset.datasetId,
      version: dataset.datasetVersion,
      schemaVersion: dataset.schemaVersion,
      source: dataset.source,
      seed: dataset.seed,
      caseCount: dataset.cases.length,
      inputSetHash: sha256(canonicalJson(dataset))
    },
    algorithms: {
      baseline: { id: baseline.id, version: baseline.version, sourceHash: sha256(canonicalJson(baseline)), strategy: baseline.strategy },
      candidate: { id: candidate.id, version: candidate.version, sourceHash: sha256(canonicalJson(candidate)), strategy: candidate.strategy }
    },
    config: { topK: candidate.topK, maximumCases: MAX_FIXTURE_CASES, maximumMemoriesPerCase: MAX_MEMORIES_PER_CASE },
    baselineMetrics,
    candidateMetrics,
    comparison: comparisons,
    m2Safety: safety,
    gate: { passed: failedChecks.length === 0, thresholds, checks, failedChecks },
    candidateActivation: { state: 'offline-review-only' as const, activated: false as const, automaticPromotion: false as const },
    limitations: [
      'All samples are synthetic and intentionally small; results do not establish real-user accuracy, statistical significance or broad safety.',
      'The evaluator reads only the named synthetic dataset and algorithm JSON specs; it does not open the production memory database or call a model.',
      'Algorithm candidates are declarative JSON processed by a fixed pure interpreter; no candidate source code, tool adapter, network client, executor or permission service is loaded.',
      'The M2 safety fixture uses a separate in-memory SQLite database and synthetic memories; its network tripwires are test evidence, not an operating-system network sandbox.',
      'A passing report is evidence for manual review only. It does not change online retrieval, memory, permissions, tasks, feature flags or user-visible behavior.'
    ]
  }
  const resultHash = sha256(canonicalJson(reportWithoutHash))
  return {
    ...reportWithoutHash,
    generatedAt: new Date().toISOString(),
    determinism: { repeatable, repeatedRunsPerSample: 2, resultHash }
  }
}
