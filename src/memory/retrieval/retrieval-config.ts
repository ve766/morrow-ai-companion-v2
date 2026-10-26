import { ApplicationError } from '../../shared/errors'
import type { MemorySourceCategory } from '../memory-domain'

// Central, typed and range-checked parameters for memory retrieval.
//
// Rationale: the audited baseline hard-coded its weights and budgets inside the
// assembler body (plus one unused duplicate constant in the app layer). Every
// value that can change ranking behaviour lives here so that (a) a decision
// trace can name the exact configuration used, and (b) v1 and v2 can be run
// against the same, fully specified inputs.

export const RETRIEVAL_ALGORITHM_V1 = 'memory-retrieval-v1' as const
export const RETRIEVAL_ALGORITHM_V2 = 'memory-retrieval-v2' as const
export const RETRIEVAL_ALGORITHM_V3_HYBRID = 'memory-retrieval-v3-hybrid' as const

export type RetrievalAlgorithmId =
  | typeof RETRIEVAL_ALGORITHM_V1
  | typeof RETRIEVAL_ALGORITHM_V2
  | typeof RETRIEVAL_ALGORITHM_V3_HYBRID

export const RETRIEVAL_ALGORITHMS: readonly RetrievalAlgorithmId[] = [
  RETRIEVAL_ALGORITHM_V1,
  RETRIEVAL_ALGORITHM_V2,
  RETRIEVAL_ALGORITHM_V3_HYBRID
]

/**
 * Version of the parameter set below. Bump it whenever a default changes, so a
 * stored decision trace can be replayed against the configuration it used.
 */
export const RETRIEVAL_CONFIG_VERSION = '2.1.0' as const

/**
 * Which algorithm the live chat path uses.
 *
 * Switched to v2 only after `npm run evaluate:retrieval` cleared every gate
 * (no leak, no budget overrun, deterministic, no recall/MRR/NDCG/coverage
 * regression). v1 remains available and is still the control arm of the
 * benchmark; see docs/algorithm-v2/retrieval-benchmark.md.
 */
export const DEFAULT_RETRIEVAL_ALGORITHM: RetrievalAlgorithmId = RETRIEVAL_ALGORITHM_V2

export interface RetrievalWeights {
  /** Relevance of the memory text to the current query. */
  lexical: number
  /** Stored confidence (1-100), normalized. */
  confidence: number
  /** How the memory entered the system (explicit statement vs accepted inference). */
  provenance: number
  /** Whether the user ever confirmed this memory after it was stored. */
  confirmation: number
  /** Freshness of the last confirmation, decayed per stability class. */
  recency: number
  /** Extra freshness weight, applied only when the current turn is time-sensitive. */
  timeSensitivity: number
  /**
   * Penalty proportional to topic overlap with already selected memories (MMR).
   *
   * Duplicate suppression is deliberately *not* a weight: near-identical
   * memories are excluded outright via `duplicateOverlapThreshold`, because a
   * soft penalty can still let the same fact occupy two budget slots. The
   * correction chain is likewise a hard exclusion, not a penalty.
   */
  diversityPenalty: number
}

export interface RetrievalDecayPolicy {
  /** Half-life for explicitly stated, non-ephemeral memories. */
  explicitHalfLifeDays: number
  /** Half-life for memories the user confirmed but the model originally proposed. */
  inferredHalfLifeDays: number
  /** Half-life for statements carrying temporary-need cues. */
  ephemeralHalfLifeDays: number
  /** Half-life used by the time-sensitivity signal on time-sensitive turns. */
  timeSensitiveHalfLifeDays: number
}

export type SemanticFusion = 'weighted' | 'rrf'

export interface SemanticPolicy {
  /**
   * Only the hybrid algorithm consumes semantic signals. Kept in config so a
   * decision can record exactly which encoder and thresholds were used.
   */
  enabled: boolean
  modelId: string
  /** Cosine similarity treated as "no semantic relevance". */
  floor: number
  /** Cosine similarity treated as fully relevant. */
  ceiling: number
  /** Weight of the semantic term under weighted fusion. */
  weight: number
  fusion: SemanticFusion
  /** Rank-fusion constant; larger means gentler rank differences. */
  rrfK: number
  /**
   * Below this similarity a memory is not a candidate at all. Prevents a weak
   * semantic match from smuggling an unrelated memory into the context.
   */
  candidateFloor: number
}

export interface RetrievalConfig {
  algorithm: RetrievalAlgorithmId
  configVersion: string
  maxMemories: number
  maxCharacters: number
  weights: RetrievalWeights
  decay: RetrievalDecayPolicy
  /** Provenance quality per source category, 0..1. */
  provenanceScores: Record<MemorySourceCategory, number>
  /** Term overlap at or above which two memories are treated as near-duplicates. */
  duplicateOverlapThreshold: number
  semantic: SemanticPolicy
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  algorithm: DEFAULT_RETRIEVAL_ALGORITHM,
  configVersion: RETRIEVAL_CONFIG_VERSION,
  maxMemories: 25,
  maxCharacters: 3000,
  weights: {
    lexical: 0.5,
    confidence: 0.12,
    provenance: 0.12,
    confirmation: 0.06,
    recency: 0.2,
    timeSensitivity: 0.15,
    diversityPenalty: 0.05
  },
  decay: {
    explicitHalfLifeDays: 180,
    inferredHalfLifeDays: 45,
    ephemeralHalfLifeDays: 7,
    timeSensitiveHalfLifeDays: 7
  },
  provenanceScores: {
    user_explicit_input: 1,
    model_inferred_confirmed: 0.6,
    turn_derived_confirmed: 0.45
  },
  duplicateOverlapThreshold: 0.9,
  semantic: {
    enabled: false,
    modelId: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    floor: 0.2,
    ceiling: 0.6,
    weight: 0.5,
    fusion: 'weighted',
    rrfK: 20,
    candidateFloor: 0.28
  }
}

const weightKeys: readonly (keyof RetrievalWeights)[] = [
  'lexical', 'confidence', 'provenance', 'confirmation', 'recency',
  'timeSensitivity', 'diversityPenalty'
]

const decayKeys: readonly (keyof RetrievalDecayPolicy)[] = [
  'explicitHalfLifeDays', 'inferredHalfLifeDays', 'ephemeralHalfLifeDays', 'timeSensitiveHalfLifeDays'
]

const sourceCategories: readonly MemorySourceCategory[] = [
  'user_explicit_input', 'model_inferred_confirmed', 'turn_derived_confirmed'
]

function fail(): never {
  throw new ApplicationError('INVALID_INPUT')
}

function bounded(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail()
  return value
}

export type RetrievalConfigOverrides = {
  algorithm?: RetrievalAlgorithmId
  maxMemories?: number
  maxCharacters?: number
  weights?: Partial<RetrievalWeights>
  decay?: Partial<RetrievalDecayPolicy>
  provenanceScores?: Partial<Record<MemorySourceCategory, number>>
  duplicateOverlapThreshold?: number
  semantic?: Partial<SemanticPolicy>
}

/**
 * Merges overrides over the safe defaults and validates every value.
 *
 * Validation is strict rather than clamping: a silently clamped threshold hides
 * a caller bug and makes a decision trace lie about the configuration used.
 */
export function resolveRetrievalConfig(overrides: RetrievalConfigOverrides = {}): RetrievalConfig {
  if (overrides === null || typeof overrides !== 'object') fail()

  const algorithm = overrides.algorithm ?? DEFAULT_RETRIEVAL_CONFIG.algorithm
  if (!RETRIEVAL_ALGORITHMS.includes(algorithm)) fail()

  const weights: RetrievalWeights = { ...DEFAULT_RETRIEVAL_CONFIG.weights, ...overrides.weights }
  for (const key of weightKeys) bounded(weights[key], 0, 10)

  const decay: RetrievalDecayPolicy = { ...DEFAULT_RETRIEVAL_CONFIG.decay, ...overrides.decay }
  for (const key of decayKeys) bounded(decay[key], 1, 3650)

  const provenanceScores = { ...DEFAULT_RETRIEVAL_CONFIG.provenanceScores, ...overrides.provenanceScores }
  for (const category of sourceCategories) bounded(provenanceScores[category], 0, 1)

  const semantic: SemanticPolicy = { ...DEFAULT_RETRIEVAL_CONFIG.semantic, ...overrides.semantic }
  // Only the hybrid algorithm may consume semantic signals; this keeps the
  // algorithm id in the trace an honest statement of what actually ran.
  semantic.enabled = algorithm === RETRIEVAL_ALGORITHM_V3_HYBRID && (overrides.semantic?.enabled ?? true)
  if (typeof semantic.modelId !== 'string' || semantic.modelId.length === 0 || semantic.modelId.length > 200) fail()
  bounded(semantic.floor, -1, 1)
  bounded(semantic.ceiling, -1, 1)
  if (semantic.ceiling <= semantic.floor) fail()
  bounded(semantic.weight, 0, 10)
  if (semantic.fusion !== 'weighted' && semantic.fusion !== 'rrf') fail()
  bounded(semantic.rrfK, 1, 200)
  bounded(semantic.candidateFloor, -1, 1)

  return {
    algorithm,
    configVersion: RETRIEVAL_CONFIG_VERSION,
    maxMemories: bounded(overrides.maxMemories ?? DEFAULT_RETRIEVAL_CONFIG.maxMemories, 1, 200),
    maxCharacters: bounded(overrides.maxCharacters ?? DEFAULT_RETRIEVAL_CONFIG.maxCharacters, 200, 20_000),
    weights,
    decay,
    provenanceScores,
    duplicateOverlapThreshold: bounded(
      overrides.duplicateOverlapThreshold ?? DEFAULT_RETRIEVAL_CONFIG.duplicateOverlapThreshold,
      0.5,
      1
    ),
    semantic
  }
}
