import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { tryCreateOnnxSemanticEncoder } from '../memory/retrieval/onnx-semantic-encoder'
import { runSemanticComparison, summarizeComparison } from './semantic-retrieval-benchmark'

const root = process.env.MORROW_EVALUATION_ROOT
if (!root) throw new Error('MISSING_EVALUATION_ROOT')

const fixturesDirectory = resolve(root, 'evaluation', 'fixtures')
const reportsDirectory = resolve(root, 'evaluation', 'reports')

const SPLIT_FILES: Record<string, string> = {
  dev: 'semantic-retrieval-dev-v1.json',
  validation: 'semantic-retrieval-validation-v1.json',
  holdout: 'semantic-retrieval-holdout-v1.json'
}

function pathInside(directory: string, filename: string): string {
  if (!filename || isAbsolute(filename)) throw new Error('PATH_OUTSIDE_EVALUATION')
  const base = resolve(directory)
  const path = resolve(base, filename)
  const rel = relative(base, path)
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('PATH_OUTSIDE_EVALUATION')
  }
  return path
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing value for ${name}`)
  return value
}

const split = option('--split', 'dev')
const datasetName = SPLIT_FILES[split]
if (!datasetName) throw new Error(`Unknown split "${split}". Use dev, validation or holdout.`)

const datasetPath = pathInside(fixturesDirectory, option('--dataset', datasetName))
const reportName = option('--output', `semantic-retrieval-${split}-report.json`)
const reportPath = pathInside(reportsDirectory, reportName)
const gateMode = process.argv.includes('--gate')

const modelId = process.env.MORROW_SEMANTIC_MODEL_ID ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
const modelDirectory = resolve(process.env.MORROW_SEMANTIC_MODEL_DIR ?? resolve(root, '.models'))

const loadStartedAt = Date.now()
const encoder = await tryCreateOnnxSemanticEncoder({ modelId, cacheDirectory: modelDirectory })
const encoderLoadMs = encoder ? Date.now() - loadStartedAt : 0
if (!encoder) {
  process.stderr.write(
    `Semantic encoder unavailable (model "${modelId}" under ${modelDirectory}).\n` +
    'Hybrid arms will run without semantic signals, and the report will say so.\n' +
    'Fetch the model first: node scripts/fetch-semantic-model.mjs\n'
  )
}

const dataset: unknown = JSON.parse(readFileSync(datasetPath, 'utf8'))
const report = await runSemanticComparison(dataset, { ...(encoder ? { encoder } : {}), encoderLoadMs })

mkdirSync(reportsDirectory, { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

process.stdout.write(`${summarizeComparison(report)}\n`)

if (gateMode && !report.gate.passed) {
  process.stderr.write(`Semantic comparison gate failed: ${report.gate.failed.join(', ')}\n`)
  process.exitCode = 1
}
