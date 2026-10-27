import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { RetrievalBenchmarkError, parseRetrievalDataset, runRetrievalBenchmark } from './retrieval-benchmark'
import { ReportPathError, assertNoSymlink, atomicWriteReport, resolveInsideDirectory, resolveReportPath } from './report-path'

const defaultDatasetName = 'retrieval-context-v1.json'
const defaultReportName = 'retrieval-context-report.json'

function parseArguments(args: string[]): Record<string, string | true> {
  const options: Record<string, string | true> = {}
  const valueOptions = new Set(['--dataset', '--output'])
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    if (typeof option !== 'string') throw new RetrievalBenchmarkError('INVALID_ARGUMENT')
    if (option === '--help') {
      options.help = true
      continue
    }
    if (!valueOptions.has(option)) throw new RetrievalBenchmarkError('INVALID_ARGUMENT')
    const value = args[index + 1]
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--') || options[option]) {
      throw new RetrievalBenchmarkError('INVALID_ARGUMENT')
    }
    options[option] = value
    index += 1
  }
  return options
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function main(): Promise<void> {
  const root = process.env.MORROW_EVALUATION_ROOT
  if (!root) throw new RetrievalBenchmarkError('MISSING_EVALUATION_ROOT')
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log('npm run evaluate:retrieval-context [-- --dataset <fixture.json> --output <report.json>]')
    return
  }
  const fixturesDirectory = resolve(root, 'evaluation', 'fixtures')
  const reportsDirectory = resolve(root, 'evaluation', 'reports')
  const datasetName = typeof options['--dataset'] === 'string' ? options['--dataset'] : defaultDatasetName
  const outputName = typeof options['--output'] === 'string' ? options['--output'] : defaultReportName
  const datasetPath = resolveInsideDirectory(fixturesDirectory, datasetName)
  resolveReportPath(reportsDirectory, outputName)
  assertNoSymlink(fixturesDirectory, datasetPath)
  const dataset = parseRetrievalDataset(JSON.parse(readFileSync(datasetPath, 'utf8')) as unknown)
  const report = runRetrievalBenchmark(dataset)
  const reportSha256 = createHash('sha256').update(canonicalJson(report)).digest('hex')
  atomicWriteReport(reportsDirectory, outputName, `${JSON.stringify({ ...report, reportSha256 }, null, 2)}\n`)
  console.log(JSON.stringify({
    dataset: report.dataset,
    baseline: report.baseline,
    candidate: report.candidate,
    determinism: report.determinism,
    report: `evaluation/reports/${outputName}`
  }))
}

main().catch((error: unknown) => {
  const code = error instanceof ReportPathError
    ? error.code
    : error instanceof RetrievalBenchmarkError ? error.code : 'RETRIEVAL_BENCHMARK_FAILED'
  console.error(JSON.stringify({ failed: true, code }))
  process.exitCode = 1
})
