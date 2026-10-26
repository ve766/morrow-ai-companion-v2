import type { AssembledMemoryContext, Sensitivity } from '../../shared/companion'
import type { MemoryRecord } from '../memory-domain'
import type { RetrievalAlgorithmId, RetrievalConfig } from './retrieval-config'
import type { RetrievalDecision } from './retrieval-trace'
import type { SupersededStatement } from './retrieval-supersession'
import type { SemanticSignals } from './retrieval-semantic'

/** Fully specified input to a retrieval algorithm. Same inputs must give the same output. */
export interface RetrievalRequest {
  query: string
  records: MemoryRecord[]
  supersededStatements: SupersededStatement[]
  /**
   * True when the correction chain was read from a truncated window. Ranking
   * still proceeds, but the decision records that some older corrections may be
   * unknown, so a reviewer can tell "no supersession found" apart from "the
   * chain was not fully loaded".
   */
  supersededTruncated: boolean
  /**
   * Precomputed semantic signals for this turn. Absent means "no encoder
   * available", which must fall back to lexical ranking, never to zero
   * similarity for everything.
   */
  semantic?: SemanticSignals
  maximumSensitivity: Sensitivity
  /** Fixed evaluation instant. Never read the wall clock inside an algorithm. */
  now: string
  config: RetrievalConfig
}

export interface RetrievalResult {
  context: AssembledMemoryContext
  decision: RetrievalDecision
}

export interface RetrievalStrategy {
  readonly algorithm: RetrievalAlgorithmId
  retrieve(request: RetrievalRequest): RetrievalResult
}
