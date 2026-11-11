// Semantic signals as a *port*, not a hard dependency.
//
// The retrieval algorithms stay synchronous and deterministic: embeddings are
// computed before retrieval and handed in as a lookup. That keeps replay
// honest (same model + same text => same vector) and keeps the algorithms
// testable without a 100 MB model on disk.

export interface SemanticSignals {
  /** Identifier of the encoder that produced these signals, recorded in the trace. */
  readonly modelId: string
  /**
   * Cosine similarity between the current query and this memory text.
   * Returns null when no vector is available for the text, so a partial failure
   * degrades that candidate instead of failing the whole turn.
   */
  similarity(memoryText: string): number | null
}

export interface SemanticEncoder {
  readonly modelId: string
  /** Embeds a batch of texts. Must return one vector per input, in order. */
  embed(texts: readonly string[]): Promise<Float32Array[]>
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || left.length === 0) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!
    const b = right[index]!
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

/** In-memory index over one query and the candidate texts of a single turn. */
export function createSemanticSignals(
  modelId: string,
  queryVector: Float32Array,
  vectorsByText: ReadonlyMap<string, Float32Array>
): SemanticSignals {
  return {
    modelId,
    similarity(memoryText: string): number | null {
      const vector = vectorsByText.get(memoryText)
      return vector ? cosineSimilarity(queryVector, vector) : null
    }
  }
}

/**
 * Builds the signals for one turn. Returns null when the encoder is missing or
 * fails, which callers must treat as "no semantic signal", never as "zero
 * similarity for everything" — those are different claims.
 */
export async function buildSemanticSignals(
  encoder: SemanticEncoder | undefined,
  query: string,
  memoryTexts: readonly string[]
): Promise<SemanticSignals | null> {
  if (!encoder || memoryTexts.length === 0) return null
  try {
    const texts = [query, ...new Set(memoryTexts)]
    const vectors = await encoder.embed(texts)
    const queryVector = vectors[0]
    if (!queryVector) return null
    const vectorsByText = new Map<string, Float32Array>()
    for (const [index, text] of texts.slice(1).entries()) {
      const vector = vectors[index + 1]
      if (vector) vectorsByText.set(text, vector)
    }
    return createSemanticSignals(encoder.modelId, queryVector, vectorsByText)
  } catch {
    return null
  }
}
