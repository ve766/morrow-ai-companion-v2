import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { tryCreateOnnxSemanticEncoder } from '../memory/retrieval/onnx-semantic-encoder'
import { validateBenchmarkDataset } from './retrieval-benchmark'
import { diagnoseCase, formatDiagnostic } from './retrieval-diagnostic'

const root = process.env.MORROW_EVALUATION_ROOT
if (!root) throw new Error('MISSING_EVALUATION_ROOT')

const fixturesDirectory = resolve(root, 'evaluation', 'fixtures')

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

const datasetName = option('--dataset', 'semantic-retrieval-holdout-v1.json')
const caseId = option('--case', '')
if (!caseId) throw new Error('Pass --case <caseId>.')

const dataset = validateBenchmarkDataset(JSON.parse(readFileSync(pathInside(fixturesDirectory, datasetName), 'utf8')))
const caseValue = dataset.cases.find((item) => item.id === caseId)
if (!caseValue) throw new Error(`Case "${caseId}" not found in ${datasetName}.`)

const modelId = process.env.MORROW_SEMANTIC_MODEL_ID ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
const modelDirectory = resolve(process.env.MORROW_SEMANTIC_MODEL_DIR ?? resolve(root, '.models'))
const encoder = process.argv.includes('--no-encoder')
  ? null
  : await tryCreateOnnxSemanticEncoder({ modelId, cacheDirectory: modelDirectory })

const report = await diagnoseCase(caseValue, { ...(encoder ? { encoder } : {}) })
process.stdout.write(`${formatDiagnostic(report)}\n`)
