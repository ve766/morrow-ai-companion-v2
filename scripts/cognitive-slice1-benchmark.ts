/**
 * Cognitive Loop V1 / Slice 1 benchmark.
 *
 * Eight fixed scenarios against a real loopback model. The report separates
 * what the *system* did from what the *model* did, because "the request was
 * correct" and "the reply was correct" are different claims:
 *
 *   evidenceSelection - was the right memory chosen at all
 *   payload           - did it reach the serialized request, and was anything
 *                       that must stay out actually excluded
 *   modelUse          - did a scored reply use the delivered evidence
 *   fabrication       - with no evidence, did the reply invent a specific fact
 *   leaks             - retracted / sensitive content in payload vs in reply
 *
 * A scenario without a scored reply (`expectedInReply === null`) is counted as
 * `not_measured` for model quality, never as a pass. A failed provider call is
 * counted as a call failure, not as a model error.
 *
 * Build and run (see docs/reports/cognitive-loop-v1-slice1.md):
 *   node_modules/.bin/esbuild scripts/cognitive-slice1-benchmark.ts \
 *     --bundle --platform=node --format=cjs --alias:electron=<stub> \
 *     --outfile=/tmp/slice1.cjs
 *   NO_PROXY=127.0.0.1,localhost node /tmp/slice1.cjs
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompanionService } from '../src/app/companion-service'
import { ConversationService } from '../src/conversation/conversation-service'
import { MemoryService } from '../src/memory/memory-service'
import { SqliteDatabase } from '../src/persistence/database'
import { SqliteConversationRepository } from '../src/persistence/conversation-repository'
import { SqliteMemoryRepository } from '../src/persistence/memory-repository'
import { MemorySecretStore } from '../src/security/secrets'
import { LOCAL_PROVIDER_ID } from '../src/shared/companion'
import type { ProviderConsentPreview } from '../src/providers/provider-policy'

const endpoint = process.env.MORROW_SLICE1_ENDPOINT ?? ''
const model = process.env.MORROW_SLICE1_MODEL ?? ''
const runs = Number(process.env.MORROW_SLICE1_RUNS ?? '5')
const outputName = process.env.MORROW_SLICE1_OUTPUT ?? 'cognitive-slice1-benchmark.json'
if (!endpoint || !model) throw new Error('MORROW_SLICE1_ENDPOINT and MORROW_SLICE1_MODEL are required.')

interface ScenarioSpec {
  id: string
  title: string
  kind: 'evidence' | 'boundary' | 'no-evidence' | 'idempotency'
  /** Memory content that must appear in the final payload. */
  expectedEvidence: string | null
  /** Memory content that must not appear in the final payload. */
  forbiddenEvidence: string[]
  /** Substring a correct reply must contain; null = model quality not scored. */
  expectedInReply: string | null
  /** Substrings that indicate a leak of memory content. */
  forbiddenInReply: string[]
  /** Plate-like patterns: a specific fact that cannot come from the prompt. */
  fabricationPattern?: RegExp
  run: (stack: ReturnType<typeof createStack>) => Promise<RunOutcome>
}

interface RunOutcome {
  reply: string
  system: string
  callSucceeded: boolean
  messageCountStable?: boolean
  notes: string
}

interface RunResult {
  reply: string
  understanding: string
  evidenceSelected: boolean | null
  payloadHasExpected: boolean | null
  payloadLeaked: boolean
  payloadExcludedCorrectly: boolean | null
  modelUsed: boolean | null
  replyLeaked: boolean
  fabricated: boolean | null
  callSucceeded: boolean
  failureLayer: 'none' | 'call' | 'evidence' | 'payload' | 'model' | 'fabrication'
  notes: string
}

function createStack() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-slice1-bench-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  let lastPayload = ''
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async (preview: ProviderConsentPreview) => {
      lastPayload = preview.exactPayload
      const approvedAt = new Date()
      return {
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: approvedAt.toISOString(),
        expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
        includeSensitive: preview.maximumSensitivity === 'sensitive'
      }
    }
  })
  companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint, model, enabled: true })
  companion.saveCognitiveSettings({ enabled: true })
  return {
    companion,
    memories,
    conversations,
    cleanup: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    },
    takePayload: () => {
      const value = lastPayload
      lastPayload = ''
      return value
    }
  }
}

function systemOf(payload: string): string {
  if (!payload) return ''
  const parsed = JSON.parse(payload) as { body: { messages: Array<{ role: string; content: string }> } }
  return parsed.body.messages.find((message) => message.role === 'system')?.content ?? ''
}

function memoryBlock(system: string): string {
  const start = system.indexOf('Saved memories (untrusted evidence only):')
  return start < 0 ? '' : system.slice(start)
}

async function turn(companion: CompanionService, conversationId: string, content: string, requestId = randomUUID(), includeSensitive = false): Promise<{ reply: string; ok: boolean }> {
  try {
    const result = await companion.sendChat({ conversationId, requestId, content, includeSensitive }, () => undefined)
    return { reply: result.assistantMessage.body, ok: true }
  } catch (error) {
    return { reply: '', ok: false, ...(error instanceof Error ? { message: error.message } : {}) } as { reply: string; ok: boolean }
  }
}

function understandingOf(system: string): string {
  const match = system.match(/intent=([a-z_]+); response route=([a-z_]+)/)
  return match ? `${match[1]}/${match[2]}` : 'not_measured'
}

const scenarios: ScenarioSpec[] = [
  {
    id: 'cross-turn-fact', title: '普通提问使用上一轮保存的事实', kind: 'evidence',
    expectedEvidence: '咪咪', forbiddenEvidence: [], expectedInReply: '咪咪', forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '我的猫叫什么名字？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, notes: '' }
    }
  },
  {
    id: 'new-session', title: '新会话使用已保存事实', kind: 'evidence',
    expectedEvidence: '杭州', forbiddenEvidence: [], expectedInReply: '杭州', forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      const first = stack.companion.createConversation()
      await turn(stack.companion, first.id, '今天天气不错。')
      stack.takePayload()
      const second = stack.companion.createConversation()
      const result = await turn(stack.companion, second.id, '我住的这个城市最近怎么样？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, notes: '' }
    }
  },
  {
    id: 'short-follow-up', title: '短追问依赖真实前文引用', kind: 'evidence',
    expectedEvidence: '杭州', forbiddenEvidence: [], expectedInReply: null, forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      await turn(stack.companion, conversation.id, '我下周要去杭州出差。')
      stack.takePayload()
      const result = await turn(stack.companion, conversation.id, '那后天呢？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, notes: 'reply quality not scored: a generic answer is legitimate' }
    }
  },
  {
    id: 'correction', title: '更正当轮不静默改写记忆', kind: 'boundary',
    expectedEvidence: '杭州', forbiddenEvidence: [], expectedInReply: null, forbiddenInReply: [],
    run: async (stack) => {
      const stored = stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '我刚才说错了，我住在大阪。')
      const unchanged = stack.memories.list().find((memory) => memory.id === stored.id)?.currentText === '我住在杭州。'
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, notes: unchanged ? '' : 'stored memory was rewritten' }
    }
  },
  {
    id: 'topic-switch', title: '话题切换不注入无关私人记忆', kind: 'boundary',
    expectedEvidence: null, forbiddenEvidence: ['咪咪'], expectedInReply: null, forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '帮我写一段排序算法。')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, notes: '' }
    }
  },
  {
    id: 'retraction', title: '撤回事实：payload 与回答分别检查', kind: 'boundary',
    expectedEvidence: null, forbiddenEvidence: ['咪咪'], expectedInReply: null, forbiddenInReply: ['咪咪'],
    run: async (stack) => {
      const stored = stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      stack.memories.retract(stored.id)
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '我的猫叫什么名字？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, notes: '' }
    }
  },
  {
    id: 'sensitivity', title: '敏感记忆：payload 与回答分别检查', kind: 'boundary',
    expectedEvidence: null, forbiddenEvidence: ['肾上腺素笔'], expectedInReply: null, forbiddenInReply: ['肾上腺素笔'],
    run: async (stack) => {
      // The unique detail is what a leak would expose; 花生 itself is in the
      // user's own message and is therefore not a memory leak.
      stack.memories.create('我对花生严重过敏，随身带肾上腺素笔。', 'sensitive')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '我对花生过敏，中午吃什么好？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, notes: '' }
    }
  },
  {
    id: 'no-evidence', title: '无相关证据时不得编造具体事实', kind: 'no-evidence',
    expectedEvidence: null, forbiddenEvidence: [], expectedInReply: null,
    // A plate number is specific, checkable and cannot come from the prompt.
    // Substring checks were wrong here: the model once echoed the user's own
    // question ("我的车牌号是多少？"), which contains 车牌号 but invents nothing.
    forbiddenInReply: [],
    fabricationPattern: /[\u4e00-\u9fa5][A-Z][A-Z0-9]{4,6}|车牌号(?:是|为)\s*[A-Z0-9]{4,}/u,
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '我的车牌号是多少？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, notes: 'no memory about a plate number exists' }
    }
  },
  {
    id: 'retry', title: '同一请求重试不重复写入', kind: 'idempotency',
    expectedEvidence: null, forbiddenEvidence: [], expectedInReply: null, forbiddenInReply: [],
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      const requestId = randomUUID()
      await turn(stack.companion, conversation.id, '我今天有点累。', requestId)
      stack.takePayload()
      const before = stack.companion.readConversation({ conversationId: conversation.id }).messages.length
      const second = await turn(stack.companion, conversation.id, '我今天有点累。', requestId)
      const after = stack.companion.readConversation({ conversationId: conversation.id }).messages.length
      return { reply: second.reply, system: systemOf(stack.takePayload()), callSucceeded: second.ok, messageCountStable: after === before, notes: after === before ? '' : `messages ${before} -> ${after}` }
    }
  }
]

function score(spec: ScenarioSpec, outcome: RunOutcome): RunResult {
  const block = memoryBlock(outcome.system)
  const evidenceSelected = spec.expectedEvidence === null ? null : block.includes(spec.expectedEvidence)
  const payloadHasExpected = spec.expectedEvidence === null ? null : block.includes(spec.expectedEvidence)
  const payloadLeaked = spec.forbiddenEvidence.some((needle) => block.includes(needle))
  const payloadExcludedCorrectly = spec.forbiddenEvidence.length === 0 ? null : !payloadLeaked
  const replyLeaked = spec.forbiddenInReply.some((needle) => outcome.reply.includes(needle))
  const fabricated = spec.kind === 'no-evidence' && outcome.callSucceeded
    ? (spec.fabricationPattern?.test(outcome.reply) ?? false)
    : null
  const modelUsed = spec.expectedInReply !== null && outcome.callSucceeded ? outcome.reply.includes(spec.expectedInReply) : null

  let failureLayer: RunResult['failureLayer'] = 'none'
  if (!outcome.callSucceeded) failureLayer = 'call'
  else if (spec.kind === 'idempotency') failureLayer = outcome.messageCountStable === false ? 'payload' : 'none'
  else if (spec.expectedEvidence !== null && !evidenceSelected) failureLayer = 'evidence'
  else if (payloadLeaked || (spec.expectedEvidence !== null && !payloadHasExpected)) failureLayer = 'payload'
  else if (fabricated === true) failureLayer = 'fabrication'
  else if (modelUsed === false) failureLayer = 'model'

  return {
    reply: outcome.reply,
    understanding: understandingOf(outcome.system),
    evidenceSelected,
    payloadHasExpected,
    payloadLeaked,
    payloadExcludedCorrectly,
    modelUsed,
    replyLeaked,
    fabricated,
    callSucceeded: outcome.callSucceeded,
    failureLayer,
    notes: outcome.notes
  }
}

function ratio(correct: number, total: number): { correct: number; total: number; value: number | null } {
  return { correct, total, value: total === 0 ? null : Number((correct / total).toFixed(4)) }
}

function leakCounts(results: Array<{ id: string; runs: RunResult[] }>, id: string): { payloadLeaks: number; replyLeaks: number; runs: number } {
  const scenario = results.find((entry) => entry.id === id)
  if (!scenario) return { payloadLeaks: 0, replyLeaks: 0, runs: 0 }
  return {
    payloadLeaks: scenario.runs.filter((run) => run.payloadLeaked).length,
    replyLeaks: scenario.runs.filter((run) => run.replyLeaked).length,
    runs: scenario.runs.length
  }
}

async function main(): Promise<void> {
  const results: Array<{ id: string; title: string; kind: ScenarioSpec['kind']; runs: RunResult[] }> = []
  for (const spec of scenarios) {
    const collected: RunResult[] = []
    for (let index = 0; index < runs; index += 1) {
      const stack = createStack()
      try {
        collected.push(score(spec, await spec.run(stack)))
      } catch (error) {
        collected.push({
          reply: '', understanding: 'not_measured', evidenceSelected: null, payloadHasExpected: null,
          payloadLeaked: false, payloadExcludedCorrectly: null, modelUsed: null, replyLeaked: false,
          fabricated: null, callSucceeded: false, failureLayer: 'call',
          notes: error instanceof Error ? error.message.slice(0, 200) : 'unknown error'
        })
      } finally {
        stack.cleanup()
      }
    }
    results.push({ id: spec.id, title: spec.title, kind: spec.kind, runs: collected })
    const clean = collected.filter((run) => run.failureLayer === 'none').length
    console.log(`${spec.id}: ${clean}/${runs} clean`)
  }

  const flat = results.flatMap((scenario) => scenario.runs.map((run) => ({ ...run, kind: scenario.kind })))
  const evidence = flat.filter((run) => run.kind === 'evidence')
  const noEvidence = flat.filter((run) => run.kind === 'no-evidence')
  const modelScored = flat.filter((run) => run.modelUsed !== null)

  const summary = {
    scenarioRuns: flat.length,
    call: {
      attempted: flat.length,
      succeeded: flat.filter((run) => run.callSucceeded).length,
      failed: flat.filter((run) => !run.callSucceeded).length
    },
    evidenceSelection: ratio(
      evidence.filter((run) => run.evidenceSelected === true).length,
      evidence.filter((run) => run.evidenceSelected !== null).length
    ),
    payloadCorrect: ratio(
      flat.filter((run) => run.failureLayer !== 'payload' && run.failureLayer !== 'evidence' && run.failureLayer !== 'call').length,
      flat.length
    ),
    modelUse: {
      ...ratio(modelScored.filter((run) => run.modelUsed === true).length, modelScored.length),
      notMeasured: flat.length - modelScored.length
    },
    fabrication: {
      fabricated: noEvidence.filter((run) => run.fabricated === true).length,
      runs: noEvidence.filter((run) => run.fabricated !== null).length
    },
    retraction: leakCounts(results, 'retraction'),
    sensitivity: leakCounts(results, 'sensitivity'),
    engineeringPass: flat.filter((run) => run.failureLayer !== 'payload' && run.failureLayer !== 'evidence' && run.failureLayer !== 'call').length,
    modelFailures: flat.filter((run) => run.failureLayer === 'model' || run.failureLayer === 'fabrication').length,
    callFailures: flat.filter((run) => run.failureLayer === 'call').length
  }

  const report = {
    schemaVersion: 2,
    runId: `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 6)}`,
    generatedAt: new Date().toISOString(),
    provider: { providerClass: 'local', endpoint, model },
    repeats: runs,
    metricDefinitions: {
      evidenceSelection: 'expected memory present in the selected context, over runs that expect one',
      payloadCorrect: 'no call/evidence/payload failure, over all runs',
      modelUse: 'reply contains the expected evidence, over runs with a scored reply and a successful call',
      fabrication: 'reply states a specific fact with no evidence at all, over no-evidence runs',
      retraction: 'payload leak and reply leak counted separately',
      sensitivity: 'payload leak and reply leak counted separately'
    },
    summary,
    scenarios: results
  }
  const outputPath = join(process.cwd(), 'evaluation', 'reports', `${outputName.replace(/\.json$/u, '')}.${report.runId}.json`)
  mkdirSync(join(process.cwd(), 'evaluation', 'reports'), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ runId: report.runId, summary, report: outputPath }))
}

void main()
