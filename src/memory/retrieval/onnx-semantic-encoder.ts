import type { SemanticEncoder } from './retrieval-semantic'

// Optional ONNX sentence-embedding adapter.
//
// Deliberately loaded through a *computed* module specifier: the embedding
// runtime is a heavy, optional capability, and a static import would make the
// whole app (and its tests) depend on a ~250 MB package that most builds do not
// need. When it is absent, callers fall back to lexical ranking.
//
// `allowRemoteModels` is always false here. Downloading a model is a separate,
// explicit action (scripts/fetch-semantic-model.mjs), never a side effect of a
// chat turn or of the app starting.

export interface OnnxEncoderOptions {
  modelId: string
  /** Directory that already contains the model files. */
  cacheDirectory: string
  /** Quantization variant; q8 keeps the multilingual model near 113 MB. */
  dtype?: string
}

export class SemanticEncoderUnavailableError extends Error {
  constructor(readonly reason: 'module_missing' | 'model_missing' | 'load_failed', message: string) {
    super(message)
    this.name = 'SemanticEncoderUnavailableError'
  }
}

interface TransformersModule {
  env: Record<string, unknown>
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>
  ) => Promise<(input: string[], options?: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>>
}

async function loadModule(): Promise<TransformersModule> {
  const specifier = '@huggingface/transformers'
  try {
    return (await import(specifier)) as unknown as TransformersModule
  } catch {
    throw new SemanticEncoderUnavailableError(
      'module_missing',
      'The optional embedding runtime is not installed; semantic retrieval is unavailable.'
    )
  }
}

export async function createOnnxSemanticEncoder(options: OnnxEncoderOptions): Promise<SemanticEncoder> {
  const module = await loadModule()
  module.env.cacheDir = options.cacheDirectory
  module.env.allowRemoteModels = false
  module.env.allowLocalModels = true

  let extractor: Awaited<ReturnType<TransformersModule['pipeline']>>
  try {
    extractor = await module.pipeline('feature-extraction', options.modelId, { dtype: options.dtype ?? 'q8' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    const modelMissing = /not found|no such file|ENOENT|Could not locate/iu.test(message)
    throw new SemanticEncoderUnavailableError(
      modelMissing ? 'model_missing' : 'load_failed',
      modelMissing
        ? `No local model files for ${options.modelId} in ${options.cacheDirectory}.`
        : `The embedding model could not be loaded: ${message}`
    )
  }

  return {
    modelId: options.modelId,
    async embed(texts: readonly string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return []
      const output = await extractor([...texts], { pooling: 'mean', normalize: true })
      const dimensions = output.dims[output.dims.length - 1]
      if (!dimensions) throw new Error('The embedding model returned no vector dimension.')
      const vectors: Float32Array[] = []
      for (let index = 0; index < texts.length; index += 1) {
        vectors.push(output.data.slice(index * dimensions, (index + 1) * dimensions))
      }
      return vectors
    }
  }
}

/** Attempts to build an encoder; returns null when the capability is unavailable. */
export async function tryCreateOnnxSemanticEncoder(options: OnnxEncoderOptions): Promise<SemanticEncoder | null> {
  try {
    return await createOnnxSemanticEncoder(options)
  } catch {
    return null
  }
}

export interface LazySemanticEncoder extends SemanticEncoder {
  /** Starts loading in the background; failures are remembered, not retried per turn. */
  warmup(): void
}

/**
 * Defers model loading until the first turn that needs it, and remembers a
 * failure so a missing model does not cost a retry on every message.
 *
 * A rejected load makes `embed` throw, which `buildSemanticSignals` turns into
 * "no semantic signal" — the lexical path keeps working.
 */
export function createLazySemanticEncoder(options: OnnxEncoderOptions): LazySemanticEncoder {
  let pending: Promise<SemanticEncoder> | undefined
  const load = (): Promise<SemanticEncoder> => {
    pending ??= createOnnxSemanticEncoder(options)
    return pending
  }
  return {
    modelId: options.modelId,
    warmup(): void {
      void load().catch(() => undefined)
    },
    async embed(texts: readonly string[]): Promise<Float32Array[]> {
      return (await load()).embed(texts)
    }
  }
}
