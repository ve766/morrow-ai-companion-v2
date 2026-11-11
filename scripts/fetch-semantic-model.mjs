import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

// Explicit, one-time model fetch for semantic memory retrieval.
//
// This is the ONLY place that is allowed to reach the network for a model.
// The app itself always runs with `allowRemoteModels = false`, so a chat turn
// can never trigger a download and user memories are never uploaded.
//
//   node scripts/fetch-semantic-model.mjs [--model <hf-id>] [--out <dir>]
//
// Defaults: Xenova/paraphrase-multilingual-MiniLM-L12-v2 (Apache-2.0),
// 384-dim, ~113 MB at q8. It covers Chinese and English, which the English-only
// all-MiniLM-L6-v2 does not.

const DEFAULT_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing value for ${name}`)
  return value
}

const modelId = option('--model', DEFAULT_MODEL)
const outputDirectory = resolve(option('--out', resolve('.models')))
mkdirSync(outputDirectory, { recursive: true })

let transformers
try {
  transformers = await import('@huggingface/transformers')
} catch {
  process.stderr.write(
    'The optional embedding runtime is not installed.\n' +
    'Install it first:  npm install --no-save @huggingface/transformers@3\n'
  )
  process.exit(1)
}

const { pipeline, env } = transformers
env.cacheDir = outputDirectory
env.allowRemoteModels = true
env.allowLocalModels = true

process.stdout.write(`Fetching ${modelId} into ${outputDirectory} ...\n`)
const startedAt = Date.now()
const extractor = await pipeline('feature-extraction', modelId, { dtype: 'q8' })
const loadMs = Date.now() - startedAt

const probe = await extractor(['probe'], { pooling: 'mean', normalize: true })
const dimensions = probe.dims[probe.dims.length - 1]

process.stdout.write(
  `Done in ${(loadMs / 1000).toFixed(1)}s. dimension=${dimensions}\n` +
  `Model files are under ${outputDirectory}/${modelId}.\n` +
  `Set MORROW_SEMANTIC_MODEL_DIR=${outputDirectory} and MORROW_SEMANTIC_MODEL_ID=${modelId} to use them.\n`
)
