import { createHash } from 'node:crypto'
import type { ContextMemory, Sensitivity } from '../shared/companion'
import { MemoryContextAssembler } from '../memory/memory-context-assembler'
import type { MemoryRecord } from '../memory/memory-domain'

/**
 * Production retrieval benchmark: the shipped assembler versus a frozen copy of
 * the previous scoring rule.
 *
 * The point is not to prove the new code is good. It is to make the difference
 * measurable on the same labelled cases, including the cases where both fail.
 * `continuity` is excluded from recall/precision on purpose: it is a deliberate
 * background layer, so counting it as a retrieval hit would flatter both
 * algorithms and hide the signal.
 */

export interface RetrievalBenchmarkMemory {
  id: string
  content: string
  sensitivity?: Sensitivity
  status?: 'active' | 'retracted'
  ageDays?: number
}

export interface RetrievalBenchmarkCase {
  id: string
  query: string
  /** Prior turns, as the production path passes them. */
  conversationContext?: string
  maximumSensitivity?: Sensitivity
  memories: RetrievalBenchmarkMemory[]
  /** Ids that should be retrieved as topic/context. */
  relevant: string[]
  /** Ids that must never appear, including as continuity. */
  mustNotRecall?: string[]
  /** Why this case exists; shown in the report so a number is never bare. */
  note?: string
}

export interface RetrievalBenchmarkDataset {
  schemaVersion: 1
  id: string
  description?: string
  cases: RetrievalBenchmarkCase[]
}

export interface AlgorithmRetrievalMetrics {
  recallAt3: number
  precisionAt3: number
  mrr: number
  relevantTotal: number
  missed: number
  falseRecall: number
  leakCount: number
  continuityCount: number
  averageRetrieved: number
}

export interface RetrievalBenchmarkCaseResult {
  id: string
  note?: string
  relevant: string[]
  baseline: { retrieved: string[]; continuity: string[]; leaks: string[] }
  candidate: { retrieved: string[]; continuity: string[]; leaks: string[] }
}

export interface RetrievalBenchmarkReport {
  dataset: { id: string; caseCount: number }
  baseline: AlgorithmRetrievalMetrics
  candidate: AlgorithmRetrievalMetrics
  cases: RetrievalBenchmarkCaseResult[]
  determinism: { resultHash: string; replayStable: boolean }
}

export class RetrievalBenchmarkError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'RetrievalBenchmarkError'
  }
}

const fixedNow = '2026-10-26T00:00:00.000Z'
const dayMs = 86_400_000
const sensitivityOrder: readonly Sensitivity[] = ['normal', 'personal', 'sensitive']
const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'was', 'were', 'will', 'your', 'about', '我', '你', '他', '她', '它', '的', '了', '是', '在', '和', '有', '就', '都', '而', '及', '与', '着', '或', '一个'])

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

/** Frozen copy of the pre-Phase-2.2 term extraction (substring comparison). */
function legacyTerms(value: string): string[] {
  const normalized = normalize(value)
  const result = new Set<string>()
  for (const token of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (token.length > 1 && !stopWords.has(token)) result.add(token)
    const characters = Array.from(token)
    if (characters.length >= 2 && /\p{Script=Han}/u.test(token)) {
      for (let index = 0; index < characters.length - 1; index += 1) {
        const pair = characters[index]! + characters[index + 1]!
        if (!stopWords.has(pair)) result.add(pair)
      }
    }
  }
  return [...result].slice(0, 64)
}

function legacyScore(content: string, queryTerms: string[], phrase: string): number {
  const normalized = normalize(content)
  const phraseMatch = phrase.length >= 2 && normalized.includes(phrase) ? 4 : 0
  let overlaps = 0
  for (const term of queryTerms) if (normalized.includes(term)) overlaps += 1
  return phraseMatch + overlaps
}

function rankScore(record: MemoryRecord, score: number, now: string): number {
  const reference = record.lastConfirmedAt ?? record.updatedAt
  const ageDays = Math.max(0, (Date.parse(now) - Date.parse(reference)) / dayMs)
  return score + record.confidence / 50 + 2 * Math.pow(0.5, ageDays / 30)
}

function continuityOrder(left: MemoryRecord, right: MemoryRecord): number {
  const leftConfirmed = left.lastConfirmedAt === null ? 0 : 1
  const rightConfirmed = right.lastConfirmedAt === null ? 0 : 1
  if (leftConfirmed !== rightConfirmed) return rightConfirmed - leftConfirmed
  if (left.confidence !== right.confidence) return right.confidence - left.confidence
  const leftReference = left.lastConfirmedAt ?? left.updatedAt
  const rightReference = right.lastConfirmedAt ?? right.updatedAt
  if (leftReference !== rightReference) return rightReference.localeCompare(leftReference)
  return left.id.localeCompare(right.id)
}

interface LegacySelection {
  retrieved: string[]
  continuity: string[]
}

/** The previous rule: substring match, no conversation-context tier. */
function legacyAssemble(
  query: string,
  records: MemoryRecord[],
  maximumSensitivity: Sensitivity,
  now: string
): LegacySelection {
  const queryTerms = legacyTerms(query)
  const phrase = normalize(query).trim()
  const eligible = records.filter((record) =>
    record.status === 'active' && sensitivityOrder.indexOf(record.sensitivity) <= sensitivityOrder.indexOf(maximumSensitivity))
  const scored = eligible.map((record) => ({ record, score: legacyScore(record.currentText, queryTerms, phrase) }))
  const matched = scored
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      rankScore(right.record, right.score, now) - rankScore(left.record, left.score, now) ||
      right.record.updatedAt.localeCompare(left.record.updatedAt) ||
      left.record.id.localeCompare(right.record.id))
  const continuity = scored
    .filter((item) => item.score === 0)
    .map((item) => item.record)
    .sort(continuityOrder)
    .slice(0, 3)
  return {
    retrieved: matched.map((item) => item.record.id),
    continuity: continuity.map((record) => record.id)
  }
}

function toRecord(spec: RetrievalBenchmarkMemory, now: string): MemoryRecord {
  const ageDays = spec.ageDays ?? 0
  const reference = new Date(Date.parse(now) - ageDays * dayMs).toISOString()
  return {
    id: spec.id,
    originalText: spec.content,
    currentText: spec.content,
    sourceCategory: 'user_explicit_input',
    status: spec.status ?? 'active',
    sensitivity: spec.sensitivity ?? 'personal',
    createdAt: reference,
    updatedAt: reference,
    revision: 1,
    confidence: 85,
    lastConfirmedAt: reference
  }
}

function hitsInTop3(relevant: Set<string>, retrieved: string[]): string[] {
  return retrieved.slice(0, 3).filter((id) => relevant.has(id))
}

function leaksIn(ids: string[], caseSpec: RetrievalBenchmarkCase, records: Map<string, MemoryRecord>): string[] {
  const ceiling = caseSpec.maximumSensitivity ?? 'personal'
  const forbidden = new Set(caseSpec.mustNotRecall ?? [])
  return ids.filter((id) => {
    if (forbidden.has(id)) return true
    const record = records.get(id)
    if (!record) return true
    return record.status !== 'active' ||
      sensitivityOrder.indexOf(record.sensitivity) > sensitivityOrder.indexOf(ceiling)
  })
}

function metricsFor(results: RetrievalBenchmarkCaseResult[]): AlgorithmRetrievalMetrics {
  let recallSum = 0
  let precisionSum = 0
  let mrrSum = 0
  let relevantTotal = 0
  let missed = 0
  let falseRecall = 0
  let leakCount = 0
  let continuityCount = 0
  let retrievedTotal = 0
  let casesWithRelevant = 0

  for (const result of results) {
    const relevant = new Set(result.relevant)
    relevantTotal += relevant.size
    const baseline = result.baseline
    const top3 = hitsInTop3(relevant, baseline.retrieved)
    if (relevant.size > 0) {
      casesWithRelevant += 1
      recallSum += top3.length / relevant.size
      const denominator = Math.min(3, baseline.retrieved.length)
      precisionSum += denominator === 0 ? 0 : top3.length / denominator
      const rank = baseline.retrieved.findIndex((id) => relevant.has(id))
      mrrSum += rank < 0 ? 0 : 1 / (rank + 1)
      missed += relevant.size - baseline.retrieved.filter((id) => relevant.has(id)).length
    }
    falseRecall += baseline.retrieved.filter((id) => !relevant.has(id)).length
    leakCount += baseline.leaks.length
    continuityCount += baseline.continuity.length
    retrievedTotal += baseline.retrieved.length
  }

  return {
    recallAt3: casesWithRelevant === 0 ? 0 : recallSum / casesWithRelevant,
    precisionAt3: casesWithRelevant === 0 ? 0 : precisionSum / casesWithRelevant,
    mrr: casesWithRelevant === 0 ? 0 : mrrSum / casesWithRelevant,
    relevantTotal,
    missed,
    falseRecall,
    leakCount,
    continuityCount,
    averageRetrieved: results.length === 0 ? 0 : retrievedTotal / results.length
  }
}

function metricsForCandidate(results: RetrievalBenchmarkCaseResult[]): AlgorithmRetrievalMetrics {
  // Same arithmetic, reading the candidate side. Kept separate rather than
  // parameterised so a future edit to one side cannot silently change the other.
  const flipped = results.map((result) => ({
    ...result,
    baseline: { retrieved: result.candidate.retrieved, continuity: result.candidate.continuity, leaks: result.candidate.leaks }
  }))
  return metricsFor(flipped)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function runOnce(dataset: RetrievalBenchmarkDataset): RetrievalBenchmarkCaseResult[] {
  const assembler = new MemoryContextAssembler()
  return dataset.cases.map((caseSpec) => {
    const records = caseSpec.memories.map((memory) => toRecord(memory, fixedNow))
    const byId = new Map(records.map((record) => [record.id, record]))
    const ceiling = caseSpec.maximumSensitivity ?? 'personal'
    const context = caseSpec.conversationContext ?? ''

    const legacy = legacyAssemble(caseSpec.query, records, ceiling, fixedNow)
    const legacyAll = [...legacy.retrieved, ...legacy.continuity]
    const modern = assembler.assemble(caseSpec.query, records, ceiling, 25, 3000, fixedNow, context)
    const modernRetrieved = modern.selected.filter((item: ContextMemory) => item.match !== 'continuity').map((item) => item.id)
    const modernContinuity = modern.selected.filter((item) => item.match === 'continuity').map((item) => item.id)

    return {
      id: caseSpec.id,
      ...(caseSpec.note === undefined ? {} : { note: caseSpec.note }),
      relevant: [...caseSpec.relevant],
      baseline: {
        retrieved: legacy.retrieved,
        continuity: legacy.continuity,
        leaks: leaksIn(legacyAll, caseSpec, byId)
      },
      candidate: {
        retrieved: modernRetrieved,
        continuity: modernContinuity,
        leaks: leaksIn([...modernRetrieved, ...modernContinuity], caseSpec, byId)
      }
    }
  })
}

export function runRetrievalBenchmark(dataset: RetrievalBenchmarkDataset): RetrievalBenchmarkReport {
  const first = runOnce(dataset)
  const replay = runOnce(dataset)
  const resultHash = createHash('sha256').update(canonicalJson(first)).digest('hex')
  const replayHash = createHash('sha256').update(canonicalJson(replay)).digest('hex')
  return {
    dataset: { id: dataset.id, caseCount: dataset.cases.length },
    baseline: metricsFor(first),
    candidate: metricsForCandidate(first),
    cases: first,
    determinism: { resultHash, replayStable: resultHash === replayHash }
  }
}

const CASE_KEYS = ['id', 'query', 'conversationContext', 'maximumSensitivity', 'memories', 'relevant', 'mustNotRecall', 'note'] as const
const MEMORY_KEYS = ['id', 'content', 'sensitivity', 'status', 'ageDays'] as const
const SENSITIVITIES = ['normal', 'personal', 'sensitive'] as const

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new RetrievalBenchmarkError(`UNKNOWN_FIELD:${where}:${key}`)
}

function requireIdList(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new RetrievalBenchmarkError(`INVALID_ID_LIST:${where}`)
  }
  return value as string[]
}

export function parseRetrievalDataset(value: unknown): RetrievalBenchmarkDataset {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RetrievalBenchmarkError('INVALID_DATASET')
  const record = value as Record<string, unknown>
  rejectUnknown(record, ['schemaVersion', 'id', 'description', 'cases'], 'dataset')
  if (record.schemaVersion !== 1) throw new RetrievalBenchmarkError('UNSUPPORTED_SCHEMA')
  if (typeof record.id !== 'string' || !Array.isArray(record.cases) || record.cases.length === 0) {
    throw new RetrievalBenchmarkError('INVALID_DATASET')
  }
  const seen = new Set<string>()
  const cases = record.cases.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new RetrievalBenchmarkError('INVALID_CASE')
    const candidate = entry as Record<string, unknown>
    const id = candidate.id
    if (typeof id !== 'string' || id.length === 0) throw new RetrievalBenchmarkError('INVALID_CASE_ID')
    if (seen.has(id)) throw new RetrievalBenchmarkError(`DUPLICATE_CASE_ID:${id}`)
    seen.add(id)
    rejectUnknown(candidate, CASE_KEYS, id)
    if (typeof candidate.query !== 'string' || candidate.query.length === 0) throw new RetrievalBenchmarkError(`INVALID_QUERY:${id}`)
    if (candidate.conversationContext !== undefined && typeof candidate.conversationContext !== 'string') {
      throw new RetrievalBenchmarkError(`INVALID_CONTEXT:${id}`)
    }
    if (candidate.maximumSensitivity !== undefined && !SENSITIVITIES.includes(candidate.maximumSensitivity as never)) {
      throw new RetrievalBenchmarkError(`INVALID_SENSITIVITY:${id}`)
    }
    if (!Array.isArray(candidate.memories) || candidate.memories.length === 0) throw new RetrievalBenchmarkError(`INVALID_MEMORIES:${id}`)
    const ids = new Set<string>()
    for (const item of candidate.memories) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new RetrievalBenchmarkError(`INVALID_MEMORY:${id}`)
      const memory = item as Record<string, unknown>
      rejectUnknown(memory, MEMORY_KEYS, `${id}:memory`)
      if (typeof memory.id !== 'string' || memory.id.length === 0) throw new RetrievalBenchmarkError(`INVALID_MEMORY_ID:${id}`)
      if (ids.has(memory.id)) throw new RetrievalBenchmarkError(`DUPLICATE_MEMORY_ID:${id}:${memory.id}`)
      ids.add(memory.id)
      if (typeof memory.content !== 'string' || memory.content.length === 0) throw new RetrievalBenchmarkError(`INVALID_MEMORY:${id}`)
      if (memory.sensitivity !== undefined && !SENSITIVITIES.includes(memory.sensitivity as never)) {
        throw new RetrievalBenchmarkError(`INVALID_MEMORY_SENSITIVITY:${id}`)
      }
      if (memory.status !== undefined && memory.status !== 'active' && memory.status !== 'retracted') {
        throw new RetrievalBenchmarkError(`INVALID_MEMORY_STATUS:${id}`)
      }
      if (memory.ageDays !== undefined && (typeof memory.ageDays !== 'number' || !Number.isSafeInteger(memory.ageDays) || memory.ageDays < 0)) {
        throw new RetrievalBenchmarkError(`INVALID_MEMORY_AGE:${id}`)
      }
    }
    const relevant = requireIdList(candidate.relevant, `${id}:relevant`)
    const mustNot = candidate.mustNotRecall === undefined ? [] : requireIdList(candidate.mustNotRecall, `${id}:mustNotRecall`)
    for (const reference of [...relevant, ...mustNot]) {
      if (!ids.has(reference)) throw new RetrievalBenchmarkError(`UNKNOWN_MEMORY_REFERENCE:${id}:${reference}`)
    }
    return candidate as unknown as RetrievalBenchmarkCase
  })
  return {
    schemaVersion: 1,
    id: record.id,
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    cases
  }
}
