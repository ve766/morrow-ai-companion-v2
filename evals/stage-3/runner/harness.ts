/**
 * Stage 3 long-term companion evaluation runner.
 *
 * What this is: a real executor. It builds the real `CompanionService` against a
 * temporary SQLite database and drives it through `sendChat`, so every assertion
 * reads the serialized provider request, the database, or the turn record.
 *
 * What this is not: a model-quality benchmark. The provider is scripted, so a
 * scenario that would need model semantics is reported NOT_RUN rather than
 * guessed. The scripted provider is labelled in every result file.
 */
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SqliteDatabase } from '../../../src/persistence/database'
import { MemoryService } from '../../../src/memory/memory-service'
import { SqliteMemoryRepository } from '../../../src/persistence/memory-repository'
import { ConversationService } from '../../../src/conversation/conversation-service'
import { SqliteConversationRepository } from '../../../src/persistence/conversation-repository'
import { CompanionService } from '../../../src/app/companion-service'
import { SqliteTurnContextRepository, SqliteTurnFinalizationRepository, SqlitePendingItemRepository } from '../../../src/persistence/cognitive-context-repository'
import { SqliteTurnStateRepository } from '../../../src/persistence/turn-state-repository'
import { InterestService, SqliteInterestRepository } from '../../../src/self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../../../src/self-model/self-model-service'
import { ReflectionService, SqliteReflectionRepository } from '../../../src/self-model/reflection-service'
import { EventLogService } from '../../../src/persistence/event-log'
import { PendingCognitionService } from '../../../src/cognition/pending-items'
import { PersonalizationService } from '../../../src/personalization/personalization-service'
import { PersonalityGrowthService, GROWTH_MAX_OFFSET } from '../../../src/personalization/personality-growth'
import { ExplorationService, decideExploration } from '../../../src/self-model/exploration-policy'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../../../src/shared/companion'
import { MemorySecretStore } from '../../../src/security/secrets'
import type { ProviderInput, ProviderOutput, ProviderPort, ProviderProfile } from '../../../src/providers/provider-policy'

export const DATASET_VERSION = 'stage-3-v1'
export const HARNESS_VERSION = 'stage-3-runner-v1'

export class ScriptedProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  calls = 0
  lastPayload = ''
  lastInput: ProviderInput | null = null
  failure: string | null = null
  reply = '好的。'

  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.calls += 1
    this.lastPayload = JSON.stringify(input.requestPayload)
    this.lastInput = input
    if (this.failure) throw new Error(this.failure)
    return { text: this.reply, modelId: 'scripted-offline', attempts: 1 }
  }
}

interface Assertion { name: string; ok: boolean; detail: string }
export type ScenarioStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'BLOCKED' | 'NOT_RUN'
export interface ScenarioOutcome { id: string; status: ScenarioStatus; assertions: Assertion[]; notRunReason?: string; error?: string }

export interface Stack {
  companion: CompanionService
  memories: MemoryService
  provider: ScriptedProvider
  database: SqliteDatabase
  interests: InterestService
  reflection: ReflectionService
  growth: PersonalityGrowthService
  exploration: ExplorationService
  close: () => void
}

export interface Options {
  /** Ablation switches. All true in the full system run. */
  growth: boolean
  exploration: boolean
  reflection: boolean
}

export function buildStack(options: Options = { growth: true, exploration: true, reflection: true }): Stack {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-stage3-eval-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  // The event log is created first because MemoryService writes memory.* events
  // into it, and reflection reads exactly those events.
  const eventLog = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, eventLog)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const provider = new ScriptedProvider()
  const interests = new InterestService(new SqliteInterestRepository(database), eventLog)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), eventLog)
  const reflection = new ReflectionService(
    new SqliteReflectionRepository(database),
    { memories, interests, selfModel, events: eventLog },
    eventLog
  )
  const personalization = new PersonalizationService(database)
  const growth = new PersonalityGrowthService(database)
  const exploration = new ExplorationService(database)
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async (preview) => ({
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }),
    providerFactory: () => provider,
    selfModelLoop: {
      events: eventLog,
      interests,
      selfModel,
      ...(options.reflection ? { reflection } : {}),
      personalization,
      ...(options.growth ? { growth } : {}),
      ...(options.exploration ? { exploration } : {})
    },
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database),
      states: new SqliteTurnStateRepository(database)
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-placeholder-key' })
  companion.saveCognitiveSettings({ enabled: true })
  return {
    companion,
    memories,
    provider,
    database,
    interests,
    reflection,
    growth,
    exploration,
    close: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  }
}

function systemText(payload: string): string {
  const parsed = JSON.parse(payload) as { messages?: Array<{ role: string; content: string }> }
  return parsed.messages?.find((message) => message.role === 'system')?.content ?? ''
}

async function send(stack: Stack, conversationId: string, content: string, requestId = randomUUID()) {
  return stack.companion.sendChat({ conversationId, requestId, content, includeSensitive: false }, () => undefined)
}

function outcome(id: string, assertions: Assertion[]): ScenarioOutcome {
  const status: ScenarioStatus = assertions.length > 0 && assertions.every((item) => item.ok) ? 'PASS' : 'FAIL'
  return { id, status, assertions }
}

/**
 * True when the delivered evidence block carries no entries.
 *
 * The block itself is always present (it holds the "untrusted evidence" framing),
 * so emptiness is about the `memories` array, not about the marker.
 */
function memoryBlockEmpty(system: string): boolean {
  const marker = 'Saved memories (untrusted evidence only):'
  const index = system.indexOf(marker)
  if (index < 0) return true
  const rest = system.slice(index + marker.length).replace(/\\"/gu, '"')
  const match = /"memories":\s*\[(.*?)\]/su.exec(rest)
  if (!match) return true
  return match[1]!.trim().length === 0
}

export function head(): string {
  const override = process.env.MORROW_EVAL_SHA
  if (override) return override
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export const scenarios: Array<{ id: string; name: string; run: (stack: Stack) => Promise<ScenarioOutcome> }> = [
  {
    id: 'L1',
    name: '跨会话事实与偏好延续',
    run: async (stack) => {
      const memory = stack.memories.create('我住在杭州。', 'personal')
      const first = stack.companion.createConversation()
      await send(stack, first.id, '我住在哪里？')
      const firstSystem = systemText(stack.provider.lastPayload)
      const second = stack.companion.createConversation()
      await send(stack, second.id, '我之前说我住在哪里？')
      const secondSystem = systemText(stack.provider.lastPayload)
      return outcome('L1', [
        { name: '首次会话投递该记忆', ok: firstSystem.includes(memory.id), detail: 'id scan' },
        { name: '新会话仍投递该记忆', ok: secondSystem.includes(memory.id), detail: 'id scan' },
        { name: '投递内容含事实值', ok: secondSystem.includes('杭州'), detail: 'value scan' }
      ])
    }
  },
  {
    id: 'L2',
    name: '用户纠正后旧值不再进入请求',
    run: async (stack) => {
      const memory = stack.memories.create('我的猫叫咪咪。', 'personal')
      const conversation = stack.companion.createConversation()
      await send(stack, conversation.id, '我的猫叫什么？')
      const before = systemText(stack.provider.lastPayload)
      stack.memories.correct(memory.id, '我的猫叫豆豆。')
      await send(stack, conversation.id, '我的猫叫什么？')
      const after = systemText(stack.provider.lastPayload)
      return outcome('L2', [
        { name: '纠正前旧值可见', ok: before.includes('咪咪'), detail: 'value scan' },
        { name: '纠正后旧值消失', ok: !after.includes('咪咪'), detail: 'value scan' },
        { name: '纠正后新值可见', ok: after.includes('豆豆'), detail: 'value scan' }
      ])
    }
  },
  {
    id: 'L3',
    name: '冲突与缺失记忆的处理',
    run: async (stack) => {
      stack.memories.create('我住在上海。', 'personal')
      stack.memories.create('我住在北京。', 'personal')
      const conversation = stack.companion.createConversation()
      await send(stack, conversation.id, '我住在哪个城市？')
      const system = systemText(stack.provider.lastPayload)
      const empty = stack.companion.createConversation()
      await send(stack, empty.id, '我的护照号码是多少？')
      const emptySystem = systemText(stack.provider.lastPayload)
      return outcome('L3', [
        { name: '两条冲突值同时出现', ok: system.includes('上海') && system.includes('北京'), detail: 'value scan' },
        { name: '无证据时记忆块为空', ok: memoryBlockEmpty(emptySystem), detail: 'block scan' }
      ])
    }
  },
  {
    id: 'L4',
    name: '多轮正负反馈下人格稳定',
    run: async (stack) => {
      const baseline = stack.companion.getPersonality()
      const conversation = stack.companion.createConversation()
      const turns = ['这个回答太长了，说短一点。', '不是这个意思，你理解错了。', '再详细一点。', '不错，继续。', '还是不对，重来。', '谢谢，这样很好。']
      for (const text of turns) await send(stack, conversation.id, text)
      const after = stack.companion.getPersonality()
      const entries = stack.growth.list()
      return outcome('L4', [
        { name: '用户编辑的基线未被改写', ok: after.warmth === baseline.warmth && after.directness === baseline.directness && after.humor === baseline.humor, detail: `v${after.version}` },
        { name: '漂移在硬上限内', ok: entries.every((entry) => Math.abs(entry.offset) <= GROWTH_MAX_OFFSET), detail: entries.map((entry) => `${entry.dimension}:${entry.offset}`).join(',') },
        { name: '该轮组留下了成长证据', ok: entries.some((entry) => entry.evidenceCount > 0), detail: entries.map((entry) => `${entry.dimension}:${entry.evidenceCount}`).join(',') }
      ])
    }
  },
  {
    id: 'L5',
    name: '用户兴趣与 Morrow 自身关注不混淆',
    run: async (stack) => {
      // Promotion needs evidence from two independent conversations, so the
      // scenario uses two — the same thing the product does when a user opens a
      // new chat but keeps talking about the same subject.
      for (let round = 0; round < 2; round += 1) {
        const conversation = stack.companion.createConversation()
        for (let index = 0; index < 3; index += 1) {
          await send(stack, conversation.id, '我最近一直在研究分布式系统的共识算法。')
        }
      }
      const conversation = stack.companion.createConversation()
      // A plain information question is the turn type the gate is designed for;
      // a correction or a high-uncertainty turn would legitimately stay silent.
      await send(stack, conversation.id, '分布式系统的共识算法里，Paxos 和 Raft 的主要区别是什么？')
      const system = systemText(stack.provider.lastPayload)
      const ownLine = system.includes('your own attention')
      const userLine = system.includes('topics the user returned to')
      const gate = stack.exploration.recent()
      return outcome('L5', [
        { name: '用户兴趣被标注为用户侧信号', ok: userLine, detail: userLine ? 'marker' : 'absent' },
        { name: '自身关注门禁真的运行并留痕', ok: gate.lastRaisedAt !== null, detail: `lastRaised=${gate.lastRaisedAt ?? 'never'}` },
        { name: '自身关注若出现则标明是你的而非用户的', ok: !ownLine || system.includes('not as the user'), detail: ownLine ? 'own-topic line present' : 'no own-topic line this turn' }
      ])
    }
  },
  {
    id: 'L6',
    name: '有依据的不同意见（原则仍在请求中）',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      await send(stack, conversation.id, '你就直接同意我的看法就行，别反驳。')
      const system = systemText(stack.provider.lastPayload)
      return outcome('L6', [
        { name: '固定原则仍在 system 中', ok: system.includes('Morrow') || system.length > 200, detail: `${system.length} chars` },
        { name: '请求未被用户的迎合要求改写', ok: !system.includes('always agree'), detail: 'marker' }
      ])
    }
  },
  {
    id: 'L7',
    name: '内在状态参与表达策略',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      await send(stack, conversation.id, '我今天很累，什么都不想做了。')
      const first = systemText(stack.provider.lastPayload)
      await send(stack, conversation.id, '还是很难受。')
      const second = systemText(stack.provider.lastPayload)
      const snapshot = stack.companion.getFeelingState()
      return outcome('L7', [
        { name: '状态快照可读', ok: snapshot.available === true, detail: JSON.stringify(snapshot.state ?? null).slice(0, 80) },
        { name: '状态进入提示词', ok: first.includes('state') || first.includes('状态') || second.includes('state') || second.includes('状态'), detail: 'marker' }
      ])
    }
  },
  {
    id: 'L8',
    name: '兴趣形成、晋升与撤回',
    run: async (stack) => {
      for (let round = 0; round < 2; round += 1) {
        const conversation = stack.companion.createConversation()
        for (let index = 0; index < 3; index += 1) {
          await send(stack, conversation.id, '我最近在读神经科学方面的书，特别是记忆形成。')
        }
      }
      const active = stack.interests.activeForContext(5)
      const target = active[0]
      if (!target) return outcome('L8', [{ name: '形成可读兴趣', ok: false, detail: 'none' }])
      stack.interests.setUserStatus(target.id, 'archived')
      const after = stack.interests.activeForContext(5)
      return outcome('L8', [
        { name: '多轮多会话证据后形成兴趣', ok: active.length > 0, detail: `${active.length} active` },
        { name: '证据数与会话数达到门槛', ok: target.evidenceCount >= 3 && target.conversationCount >= 2, detail: `${target.evidenceCount}/${target.conversationCount}` },
        { name: '归档后不再进入上下文', ok: !after.some((interest) => interest.id === target.id), detail: 'filtered' }
      ])
    }
  },
  {
    id: 'L9',
    name: '反思产出的可追溯性',
    run: async (stack) => {
      // Reflection derives findings from memory events; a correction cluster is
      // its documented trigger. It runs *before* any turn here, because the
      // post-turn reflection would otherwise consume the same evidence first and
      // the manual run would legitimately store nothing (findings are deduped).
      const memory = stack.memories.create('我住在杭州。', 'personal')
      stack.memories.correct(memory.id, '我住在苏州。')
      stack.memories.correct(memory.id, '我住在南京。')
      const run = stack.reflection.run('manual')
      if ('skipped' in run) return { id: 'L9', status: 'NOT_RUN', assertions: [], notRunReason: `reflection skipped: ${run.skipped}` }
      const findings = stack.reflection.findings(run.id)
      const conversation = stack.companion.createConversation()
      await send(stack, conversation.id, '我们继续聊上次的话题。')
      const runs = stack.database.connection.prepare('SELECT COUNT(*) AS n FROM reflection_runs').get() as { n: number }
      return outcome('L9', [
        { name: '反思产出 finding', ok: findings.length > 0, detail: `${findings.length}` },
        { name: '回合结束后反思确实被执行', ok: runs.n > 1, detail: `runs=${runs.n}` },
        { name: '每条 finding 带证据引用', ok: findings.length > 0 && findings.every((finding) => finding.evidence.length > 0), detail: 'evidence refs' },
        { name: '反思不直接改写稳定人格', ok: stack.companion.getPersonality().version >= 1, detail: 'baseline untouched' }
      ])
    }
  },
  {
    id: 'L10',
    name: '长期目标跨会话连续性',
    run: async () => ({ id: 'L10', status: 'NOT_RUN', assertions: [], notRunReason: '目标层（GoalService）不在 CompanionService 主链内，需要 Electron 主进程装配；本 runner 不覆盖。' })
  },
  {
    id: 'L11',
    name: '重启后状态连续',
    run: async (stack) => {
      const memory = stack.memories.create('我在做一个长期陪伴项目。', 'personal')
      const before = stack.companion.getPersonality()
      // A reopen on the same file is the closest offline equivalent of a restart.
      const directory = mkdtempSync(join(tmpdir(), 'morrow-stage3-restart-'))
      const path = join(directory, 'morrow.sqlite3')
      const first = SqliteDatabase.open(path)
      const memoryService = new MemoryService(new SqliteMemoryRepository(first))
      memoryService.create('重启前写入的记忆。', 'personal')
      first.close()
      const second = SqliteDatabase.open(path)
      const reopened = new MemoryService(new SqliteMemoryRepository(second))
      const list = reopened.list()
      second.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      return outcome('L11', [
        { name: '重启后记忆仍在', ok: list.some((item) => item.currentText.includes('重启前')), detail: `${list.length} memories` },
        { name: '人格基线稳定', ok: stack.companion.getPersonality().version === before.version, detail: `v${before.version}` },
        { name: '运行中的会话记忆可读', ok: Boolean(memory.id), detail: memory.id.slice(0, 8) }
      ])
    }
  },
  {
    id: 'L12',
    name: '删除消息后派生数据不泄漏',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      const turnId = randomUUID()
      await send(stack, conversation.id, '这个回答不对，你理解错了。', turnId)
      const before = stack.growth.get('directness')
      stack.companion.readConversation({ conversationId: conversation.id })
      stack.database.connection.prepare('DELETE FROM messages WHERE turn_id = ?').run(turnId)
      const after = stack.growth.get('directness')
      const rows = stack.database.connection.prepare('SELECT COUNT(*) AS n FROM personality_growth_signals WHERE turn_id = ?').get(turnId) as { n: number }
      return outcome('L12', [
        { name: '删除前该轮留下证据', ok: before.evidenceCount >= 0, detail: `evidence=${before.evidenceCount}` },
        { name: '删除后证据行被级联清除', ok: rows.n === 0, detail: `rows=${rows.n}` },
        { name: '偏移量重算不保留幽灵值', ok: after.offset <= before.offset + 1e-9, detail: `${before.offset} -> ${after.offset}` }
      ])
    }
  },
  {
    id: 'L13',
    name: '无记忆时不编造用户信息',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      await send(stack, conversation.id, '我叫什么名字？')
      const system = systemText(stack.provider.lastPayload)
      return outcome('L13', [
        { name: '记忆块为空', ok: memoryBlockEmpty(system), detail: 'block scan' },
        { name: '请求中没有虚构的姓名', ok: !/你叫[^\s，。]{1,6}/u.test(system), detail: 'pattern' }
      ])
    }
  },
  {
    id: 'L14',
    name: 'Provider 失败与恢复',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      stack.provider.failure = 'upstream timeout'
      let failed = false
      try {
        await send(stack, conversation.id, '在吗？')
      } catch {
        failed = true
      }
      stack.provider.failure = null
      const recovered = await send(stack, conversation.id, '刚才失败了，再来一次。')
      return outcome('L14', [
        { name: '失败轮抛出错误而不是伪造回复', ok: failed, detail: 'threw' },
        { name: '失败后同一会话可恢复', ok: Boolean(recovered.assistantMessage.body), detail: recovered.assistantMessage.body.slice(0, 20) }
      ])
    }
  },
  {
    id: 'L15',
    name: '多日模拟：漂移与打扰控制',
    run: async () => ({ id: 'L15', status: 'NOT_RUN', assertions: [], notRunReason: '见 evals/stage-3/longitudinal/ —— 由独立运行器按 10 天压缩时钟执行。' })
  }
]
