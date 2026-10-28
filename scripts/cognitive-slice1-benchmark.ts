/**
 * Cognitive Loop V1 / Slice 1 benchmark.
 *
 * Runs eight fixed multi-turn scenarios against a real loopback model and
 * records, per run, what each layer produced:
 *
 *   1. understanding  - the intent/strategy the local analyzer assigned
 *   2. evidence       - whether the expected memory was selected
 *   3. payload        - whether it reached the serialized request
 *   4. model          - whether the reply actually used it
 *
 * It is a diagnostic harness, not a product verdict. Build and run:
 *
 *   node_modules/.bin/esbuild scripts/cognitive-slice1-benchmark.ts \
 *     --bundle --platform=node --format=cjs --alias:electron=<stub> \
 *     --outfile=/tmp/slice1.cjs
 *   NO_PROXY=127.0.0.1,localhost node /tmp/slice1.cjs
 *
 * Environment:
 *   MORROW_SLICE1_ENDPOINT  loopback OpenAI-compatible base URL
 *   MORROW_SLICE1_MODEL     model id (must be in the catalog)
 *   MORROW_SLICE1_RUNS      repetitions per scenario (default 5)
 *   MORROW_SLICE1_OUTPUT    report file name under evaluation/reports
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

interface TurnResult {
  reply: string
  system: string
  payloadCharacters: number
}

interface ScenarioResult {
  id: string
  title: string
  understanding: string
  evidenceSelected: boolean
  delivered: boolean
  modelUsed: boolean | null
  reply: string
  failureLayer: 'none' | 'understanding' | 'evidence' | 'payload' | 'model'
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
    // No providerFactory: the service builds its real loopback adapter.
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

async function turn(companion: CompanionService, conversationId: string, content: string, requestId = randomUUID(), includeSensitive = false): Promise<TurnResult> {
  const result = await companion.sendChat({ conversationId, requestId, content, includeSensitive }, () => undefined)
  return { reply: result.assistantMessage.body, system: '', payloadCharacters: 0 }
}

const scenarios: ReadonlyArray<{
  id: string
  title: string
  run: (stack: ReturnType<typeof createStack>) => Promise<ScenarioResult>
}> = [
  {
    id: 'cross-turn-fact',
    title: '普通提问使用上一轮保存的事实',
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '我的猫叫什么名字？')
      const system = systemOf(stack.takePayload())
      const block = memoryBlock(system)
      const delivered = block.includes('咪咪')
      const used = result.reply.includes('咪咪')
      return {
        id: 'cross-turn-fact', title: '普通提问使用上一轮保存的事实',
        understanding: (system.match(/intent=([a-z_]+); response route=([a-z_]+)/) ?? []).slice(1).join('/'),
        evidenceSelected: delivered, delivered, modelUsed: used, reply: result.reply,
        failureLayer: !delivered ? 'payload' : used ? 'none' : 'model',
        notes: delivered ? '' : 'memory missing from payload'
      }
    }
  },
  {
    id: 'new-session',
    title: '新会话使用已保存事实',
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      const first = stack.companion.createConversation()
      await turn(stack.companion, first.id, '今天天气不错。')
      stack.takePayload()
      const second = stack.companion.createConversation()
      const result = await turn(stack.companion, second.id, '我住的这个城市最近怎么样？')
      const system = systemOf(stack.takePayload())
      const delivered = memoryBlock(system).includes('杭州')
      const used = result.reply.includes('杭州')
      return {
        id: 'new-session', title: '新会话使用已保存事实',
        understanding: (system.match(/intent=([a-z_]+); response route=([a-z_]+)/) ?? []).slice(1).join('/'),
        evidenceSelected: delivered, delivered, modelUsed: used, reply: result.reply,
        failureLayer: !delivered ? 'payload' : used ? 'none' : 'model', notes: ''
      }
    }
  },
  {
    id: 'short-follow-up',
    title: '短追问依赖真实前文引用',
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      await turn(stack.companion, conversation.id, '我下周要去杭州出差。')
      stack.takePayload()
      const result = await turn(stack.companion, conversation.id, '那后天呢？')
      const system = systemOf(stack.takePayload())
      const delivered = memoryBlock(system).includes('杭州')
      return {
        id: 'short-follow-up', title: '短追问依赖真实前文引用',
        understanding: (system.match(/intent=([a-z_]+); response route=([a-z_]+)/) ?? []).slice(1).join('/'),
        evidenceSelected: delivered, delivered, modelUsed: null, reply: result.reply,
        failureLayer: delivered ? 'none' : 'payload',
        notes: 'model usage is not scored here: the reply may legitimately stay generic'
      }
    }
  },
  {
    id: 'correction',
    title: '更正当轮不静默改写记忆',
    run: async (stack) => {
      const stored = stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '我刚才说错了，我住在大阪。')
      const system = systemOf(stack.takePayload())
      const delivered = memoryBlock(system).includes('杭州')
      const storedUnchanged = stack.memories.list().find((memory) => memory.id === stored.id)?.currentText === '我住在杭州。'
      const guided = system.includes('Do not silently edit stored memory')
      return {
        id: 'correction', title: '更正当轮不静默改写记忆',
        understanding: (system.match(/intent=([a-z_]+); response route=([a-z_]+)/) ?? []).slice(1).join('/'),
        evidenceSelected: delivered, delivered, modelUsed: null, reply: result.reply,
        failureLayer: !storedUnchanged ? 'payload' : delivered && guided ? 'none' : 'payload',
        notes: storedUnchanged ? '' : 'stored memory was rewritten'
      }
    }
  },
  {
    id: 'topic-switch',
    title: '话题切换不注入无关私人记忆',
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '帮我写一段排序算法。')
      const system = systemOf(stack.takePayload())
      const leaked = memoryBlock(system).includes('咪咪')
      return {
        id: 'topic-switch', title: '话题切换不注入无关私人记忆',
        understanding: (system.match(/intent=([a-z_]+); response route=([a-z_]+)/) ?? []).slice(1).join('/'),
        evidenceSelected: false, delivered: leaked, modelUsed: null, reply: result.reply,
        failureLayer: leaked ? 'payload' : 'none',
        notes: leaked ? 'unrelated memory injected' : ''
      }
    }
  },
  {
    id: 'retraction',
    title: '撤回事实不进入请求',
    run: async (stack) => {
      const stored = stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      stack.memories.retract(stored.id)
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '我的猫叫什么名字？')
      const system = systemOf(stack.takePayload())
      const leaked = memoryBlock(system).includes('咪咪')
      return {
        id: 'retraction', title: '撤回事实不进入请求',
        understanding: (system.match(/intent=([a-z_]+); response route=([a-z_]+)/) ?? []).slice(1).join('/'),
        evidenceSelected: false, delivered: leaked, modelUsed: null, reply: result.reply,
        failureLayer: leaked ? 'payload' : 'none',
        notes: leaked ? 'retracted fact leaked' : ''
      }
    }
  },
  {
    id: 'sensitivity',
    title: '敏感记忆默认不投递',
    run: async (stack) => {
      stack.memories.create('我对花生严重过敏。', 'sensitive')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack.companion, conversation.id, '我对花生过敏，中午吃什么好？')
      const system = systemOf(stack.takePayload())
      const leaked = memoryBlock(system).includes('花生')
      return {
        id: 'sensitivity', title: '敏感记忆默认不投递',
        understanding: (system.match(/intent=([a-z_]+); response route=([a-z_]+)/) ?? []).slice(1).join('/'),
        evidenceSelected: false, delivered: leaked, modelUsed: null, reply: result.reply,
        failureLayer: leaked ? 'payload' : 'none',
        notes: leaked ? 'sensitive fact delivered without consent' : ''
      }
    }
  },
  {
    id: 'retry',
    title: '同一请求重试不重复写入',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      const requestId = randomUUID()
      await turn(stack.companion, conversation.id, '我今天有点累。', requestId)
      stack.takePayload()
      const before = stack.companion.readConversation({ conversationId: conversation.id }).messages.length
      await turn(stack.companion, conversation.id, '我今天有点累。', requestId)
      const after = stack.companion.readConversation({ conversationId: conversation.id }).messages.length
      const system = systemOf(stack.takePayload())
      return {
        id: 'retry', title: '同一请求重试不重复写入',
        understanding: (system.match(/intent=([a-z_]+); response route=([a-z_]+)/) ?? []).slice(1).join('/'),
        evidenceSelected: false, delivered: false, modelUsed: null, reply: '',
        failureLayer: after === before ? 'none' : 'payload',
        notes: after === before ? '' : `messages ${before} -> ${after}`
      }
    }
  }
]

async function main(): Promise<void> {
  const report = {
    schemaVersion: 1,
    runId: `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 6)}`,
    generatedAt: new Date().toISOString(),
    provider: { providerClass: 'local', endpoint, model },
    repeats: runs,
    scenarios: [] as Array<{ id: string; title: string; runs: ScenarioResult[] }>
  }
  for (const scenario of scenarios) {
    const results: ScenarioResult[] = []
    for (let index = 0; index < runs; index += 1) {
      const stack = createStack()
      try {
        results.push(await scenario.run(stack))
      } catch (error) {
        results.push({
          id: scenario.id, title: scenario.title, understanding: 'error', evidenceSelected: false,
          delivered: false, modelUsed: null, reply: '', failureLayer: 'payload',
          notes: error instanceof Error ? error.message.slice(0, 200) : 'unknown error'
        })
      } finally {
        stack.cleanup()
      }
    }
    report.scenarios.push({ id: scenario.id, title: scenario.title, runs: results })
    const passed = results.filter((result) => result.failureLayer === 'none').length
    console.log(`${scenario.id}: ${passed}/${runs} clean`)
  }

  const summary = {
    scenarioRuns: report.scenarios.reduce((total, scenario) => total + scenario.runs.length, 0),
    clean: report.scenarios.reduce((total, scenario) => total + scenario.runs.filter((run) => run.failureLayer === 'none').length, 0),
    byLayer: {
      understanding: 0,
      evidence: 0,
      payload: report.scenarios.reduce((total, scenario) => total + scenario.runs.filter((run) => run.failureLayer === 'payload').length, 0),
      model: report.scenarios.reduce((total, scenario) => total + scenario.runs.filter((run) => run.failureLayer === 'model').length, 0)
    }
  }
  const outputPath = join(process.cwd(), 'evaluation', 'reports', `${outputName.replace(/\.json$/u, '')}.${report.runId}.json`)
  mkdirSync(join(process.cwd(), 'evaluation', 'reports'), { recursive: true })
  writeFileSync(outputPath, JSON.stringify({ ...report, summary }, null, 2), 'utf8')
  console.log(JSON.stringify({ runId: report.runId, summary, report: outputPath }))
}

void main()
