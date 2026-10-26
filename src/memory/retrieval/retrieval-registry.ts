import { MemoryContextAssembler } from '../memory-context-assembler'
import { RETRIEVAL_ALGORITHM_V1, RETRIEVAL_ALGORITHM_V2, type RetrievalAlgorithmId } from './retrieval-config'
import type { RetrievalStrategy } from './retrieval-strategy'
import { MultiSignalMemoryRetriever } from './retrieval-v2'

// One entry point that can run either algorithm over identical inputs. This is
// what makes "old vs new on the same cases" a fair comparison instead of two
// separate harnesses that might drift apart.

const strategies: Record<RetrievalAlgorithmId, RetrievalStrategy> = {
  [RETRIEVAL_ALGORITHM_V1]: new MemoryContextAssembler(),
  [RETRIEVAL_ALGORITHM_V2]: new MultiSignalMemoryRetriever()
}

export function selectRetrievalStrategy(algorithm: RetrievalAlgorithmId): RetrievalStrategy {
  return strategies[algorithm]
}

export { RETRIEVAL_ALGORITHM_V1, RETRIEVAL_ALGORITHM_V2 }
