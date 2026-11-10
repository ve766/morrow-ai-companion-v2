/**
 * Fixed-dataset memory retrieval benchmark (Issue #81 F6).
 *
 * This measures the *current production lexical path*: MemoryService.create ->
 * SQLite FTS/context assembler -> assembleContext. The historical ONNX semantic
 * encoder is not part of the current runtime (no model file, no onnxruntime
 * dependency, no call site), so the JSON records `semanticStatus` explicitly
 * instead of pretending a semantic channel ran.
 *
 * Usage:
 *   node node_modules/esbuild/bin/esbuild scripts/memory-retrieval-benchmark.ts \
 *     --bundle --platform=node --format=cjs --external:electron \
 *     --outfile=node_modules/.cache/memory-benchmark.cjs --log-level=warning
 *   node node_modules/.cache/memory-benchmark.cjs
 */
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { SqliteDatabase } from '../src/persistence/database'
import { SqliteMemoryRepository } from '../src/persistence/memory-repository'
import { MemoryService } from '../src/memory/memory-service'
import { unrestrictedPolicy } from '../src/memory/retrieval-policy'

const SIZES = [100, 500, 1000, 5000] as const
const QUERY_COUNT = 20
const K = 5

interface QuerySpec {
  index: number
  marker: string
  text: string
  category: 'lexical' | 'correction' | 'retracted' | 'sensitive'
}

interface QueryResult {
  index: number
  category: QuerySpec['category']
  rank: number | null
  selected: number
  misrecalled: number
  latencyMs: number
  characterCount: number
  correctValue: boolean | null
  leak: boolean | null
}

interface SizeResult {
  size: number
  fixtureMs: number
  coldStartMs: number
  queries: QueryResult[]
  recallAt5: number
  mrr: number
  misrecallRate: number
  retractedLeakCount: number
  sensitiveLeakCount: number
  correctionAccuracy: number | null
  latencyP50Ms: number
  latencyP95Ms: number
  characterCountMean: number
  databaseBytes: number
  rssBytes: number
}

const sha = process.env.MORROW_CODE_SHA ?? execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
const stamp = new Date().toISOString().replace(/[:.]/gu, '-')

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index]!
}

const TOPICS = [
  '天狼星', '猎户座', '银河系', '黑洞', '中子星', '系外行星', '太阳风', '暗物质', '引力波', '超新星',
  '脉冲星', '星云', '彗星', '小行星', '月球背面', '火星尘暴', '木星大红斑', '土星环', '柯伊伯带', '宇宙微波背景'
] as const

function specs(): QuerySpec[] {
  return Array.from({ length: QUERY_COUNT }, (_, index) => {
    const category: QuerySpec['category'] = index === 0 ? 'correction' : index === 1 ? 'sensitive' : index === 2 ? 'retracted' : 'lexical'
    const marker = `Q${String(index).padStart(2, '0')}`
    return { index, marker, text: `${marker} ${TOPICS[index]}`, category }
  })
}

function contentFor(index: number, corrected = false): string {
  return `记忆条目 Q${String(index).padStart(2, '0')}：用户关注的天文话题是${TOPICS[index]}${corrected ? `，当前项目代号是 BETA${index}` : ''}。`
}

async function runSize(size: number): Promise<SizeResult> {
  const directory = join(process.env.TEMP ?? process.cwd(), `morrow-benchmark-${size}-${Date.now()}`)
  mkdirSync(directory, { recursive: true })
  const databasePath = join(directory, 'morrow.sqlite3')
  let tick = Date.parse('2026-01-01T00:00:00.000Z')
  const clock = (): string => new Date((tick += 1000)).toISOString()
  const database = SqliteDatabase.open(databasePath)
  const memory = new MemoryService(new SqliteMemoryRepository(database), clock)
  const queries = specs()
  const targets = new Map<number, string>()

  const fixtureStarted = performance.now()
  const fillerCount = Math.max(0, size - QUERY_COUNT)
  for (let index = 0; index < fillerCount; index += 1) {
    memory.create(`记忆条目 F${index}：与本次查询无关的日常记录，编号 ${index}，用于填充检索库。`, 'personal', { allowDuplicate: true, confidence: 70 })
  }
  for (const query of queries) {
    const sensitivity = query.category === 'sensitive' ? 'sensitive' : 'personal'
    const record = memory.create(contentFor(query.index), sensitivity, { allowDuplicate: true, confidence: 80 })
    targets.set(query.index, record.id)
  }
  const correctionTarget = targets.get(0)!
  memory.correct(correctionTarget, contentFor(0, true))
  const retractedTarget = targets.get(2)!
  memory.retract(retractedTarget)
  const fixtureMs = performance.now() - fixtureStarted

  // Cold start: close and reopen so the first query includes page cache warm-up.
  database.close()
  const reopened = SqliteDatabase.open(databasePath)
  const reopenedMemory = new MemoryService(new SqliteMemoryRepository(reopened), clock)
  const coldStarted = performance.now()
  const coldContext = reopenedMemory.assembleContext(queries[3]!.text, 'personal', unrestrictedPolicy(), 'entries')
  const coldStartMs = performance.now() - coldStarted
  void coldContext

  const results: QueryResult[] = []
  for (const query of queries) {
    const iterations = 5
    let last: ReturnType<MemoryService['assembleContext']> | null = null
    let latencyMs = 0
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const started = performance.now()
      last = reopenedMemory.assembleContext(query.text, 'personal', unrestrictedPolicy(), 'entries')
      latencyMs += performance.now() - started
    }
    latencyMs /= iterations
    const selected = last?.selected ?? []
    const targetId = targets.get(query.index)!
    const rankIndex = selected.findIndex((entry) => entry.id === targetId)
    const rank = rankIndex >= 0 ? rankIndex + 1 : null
    const misrecalled = selected.filter((entry) => !entry.content.includes(query.marker)).length
    const selectedText = selected.map((entry) => entry.content).join('\n')
    results.push({
      index: query.index,
      category: query.category,
      rank,
      selected: selected.length,
      misrecalled,
      latencyMs: Math.round(latencyMs * 100) / 100,
      characterCount: last?.characterCount ?? 0,
      correctValue: query.category === 'correction' ? selectedText.includes(`BETA${query.index}`) && !selectedText.includes(`ALPHA${query.index}`) : null,
      leak: query.category === 'retracted' || query.category === 'sensitive' ? selected.some((entry) => entry.id === targetId) : null
    })
  }

  const positive = results.filter((result) => result.category === 'lexical' || result.category === 'correction')
  const recallAt5 = positive.filter((result) => result.rank !== null && result.rank <= K).length / Math.max(1, positive.length)
  const mrr = positive.reduce((sum, result) => sum + (result.rank === null ? 0 : 1 / result.rank), 0) / Math.max(1, positive.length)
  const totalSelected = results.reduce((sum, result) => sum + result.selected, 0)
  const totalMisrecalled = results.reduce((sum, result) => sum + result.misrecalled, 0)
  const latencies = results.map((result) => result.latencyMs)
  const bytes = Number(reopened.connection.prepare('PRAGMA page_count').get()?.page_count ?? 0) * Number(reopened.connection.prepare('PRAGMA page_size').get()?.page_size ?? 0)
  const summary: SizeResult = {
    size,
    fixtureMs: Math.round(fixtureMs),
    coldStartMs: Math.round(coldStartMs * 100) / 100,
    queries: results,
    recallAt5: Math.round(recallAt5 * 1000) / 1000,
    mrr: Math.round(mrr * 1000) / 1000,
    misrecallRate: Math.round((totalMisrecalled / Math.max(1, totalSelected)) * 1000) / 1000,
    retractedLeakCount: results.filter((result) => result.category === 'retracted' && result.leak === true).length,
    sensitiveLeakCount: results.filter((result) => result.category === 'sensitive' && result.leak === true).length,
    correctionAccuracy: results.find((result) => result.category === 'correction')?.correctValue === true ? 1 : 0,
    latencyP50Ms: Math.round(percentile(latencies, 0.5) * 100) / 100,
    latencyP95Ms: Math.round(percentile(latencies, 0.95) * 100) / 100,
    characterCountMean: Math.round(results.reduce((sum, result) => sum + result.characterCount, 0) / Math.max(1, results.length)),
    databaseBytes: bytes,
    rssBytes: process.memoryUsage().rss
  }
  reopened.close()
  return summary
}

async function main(): Promise<void> {
  const results: SizeResult[] = []
  for (const size of SIZES) {
    const result = await runSize(size)
    results.push(result)
    process.stdout.write(`size=${size} recall@${K}=${result.recallAt5} mrr=${result.mrr} misrecall=${result.misrecallRate} p95=${result.latencyP95Ms}ms\n`)
  }
  const payload = {
    schemaVersion: 1,
    issue: 81,
    generatedAt: new Date().toISOString(),
    codeSha: sha,
    sourceCommit: sha,
    testedCommit: sha,
    semanticStatus: 'UNAVAILABLE_NO_ONNX_MODEL',
    semanticReason: 'The current runtime has no ONNX model file, no onnxruntime dependency and no call site; PR #1 code is not part of this line. The lexical channel below is the production path and never bypasses retraction, sensitivity or correction filtering.',
    dataset: {
      queryCount: QUERY_COUNT,
      k: K,
      seed: 'fixed-marker-Q0..Q19',
      sizes: [...SIZES],
      corpusHash: sha,
      queryCategories: specs().map((query) => ({ index: query.index, category: query.category, marker: query.marker }))
    },
    environment: {
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model ?? 'unknown',
      totalMemoryBytes: totalmem(),
      node: process.version
    },
    parameters: {
      policy: 'unrestrictedPolicy (information_query)',
      maximumSensitivity: 'normal',
      presentation: 'entries',
      candidateWindow: 1000,
      iterationsPerQuery: 5
    },
    results
  }
  const outputDirectory = join(process.cwd(), 'evals', 'memory-retrieval', 'benchmark')
  mkdirSync(outputDirectory, { recursive: true })
  const outputPath = join(outputDirectory, `${stamp}-${sha}.json`)
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  process.stdout.write(`wrote ${outputPath}\n`)
}

void main()
