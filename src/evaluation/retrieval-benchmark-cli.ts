import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { BenchmarkError, runRetrievalBenchmark, summarizeReport } from './retrieval-benchmark'

const root = process.env.MORROW_EVALUATION_ROOT
if (!root) throw new BenchmarkError('MISSING_EVALUATION_ROOT')

const fixturesDirectory = resolve(root, 'evaluation', 'fixtures')
const reportsDirectory = resolve(root, 'evaluation', 'reports')
const defaultDatasetName = 'retrieval-benchmark-v1.json'
const defaultReportName = 'retrieval-benchmark-v1.json'

function pathInside(directory: string, filename: string): string {
  if (!filename || isAbsolute(filename)) throw new BenchmarkError('PATH_OUTSIDE_EVALUATION')
  const base = resolve(directory)
  const path = resolve(base, filename)
  const rel = relative(base, path)
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new BenchmarkError('PATH_OUTSIDE_EVALUATION')
  }
  return path
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (typeof value !== 'string' || value.length === 0) throw new BenchmarkError('INVALID_ARGUMENT')
  return value
}

const datasetPath = pathInside(fixturesDirectory, option('--dataset', defaultDatasetName))
const reportPath = pathInside(reportsDirectory, option('--output', defaultReportName))

const dataset: unknown = JSON.parse(readFileSync(datasetPath, 'utf8'))
const report = runRetrievalBenchmark(dataset)

mkdirSync(reportsDirectory, { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

process.stdout.write(`${summarizeReport(report)}\n`)
if (!report.gate.passed) {
  process.stderr.write(`Retrieval benchmark gate failed: ${report.gate.failed.join(', ')}\n`)
  process.exitCode = 1
}
