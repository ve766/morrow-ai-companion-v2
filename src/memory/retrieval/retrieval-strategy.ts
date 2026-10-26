import type { AssembledMemoryContext, Sensitivity } from '../../shared/companion'
import type { MemoryRecord } from '../memory-domain'
import type { RetrievalAlgorithmId, RetrievalConfig } from './retrieval-config'
import type { RetrievalDecision } from './retrieval-trace'
import type { SupersededStatement } from './retrieval-supersession'

/** Fully specified input to a retrieval algorithm. Same inputs must give the same output. */
export interface RetrievalRequest {
  query: string
  records: MemoryRecord[]
  supersededStatements: SupersededStatement[]
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
