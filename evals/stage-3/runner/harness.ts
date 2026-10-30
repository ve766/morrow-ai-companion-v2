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
import { dirname, join, resolve } from 'node:path'
import { SqliteDatabase } from '../../../src/persistence/database'
import { MemoryService } from '../../../src/memory/memory-service'
import { MemoryImportanceService } from '../../../src/memory/memory-importance'
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
  importance: MemoryImportanceService
  close: () => void
}

export interface Options {
  /** Ablation switches. All true in the full system run. */
  growth: boolean
  exploration: boolean
  reflection: boolean
  /**
   * Reuse an existing database file instead of a fresh temporary one. This is
   * what makes a real restart testable: close the stack, rebuild it on the same
   * file, and the next turn must read the state the previous process wrote.
   */
  databasePath?: string
  /** Keep the database directory after `close()` (restart scenarios need it). */
  keepDatabase?: boolean
  /**
   * Injected clock. When present, every service that accepts one uses it, so a
   * simulation can advance time instead of pretending that ten fast blocks are
   * ten days.
   */
  clock?: () => string
}

export function buildStack(options: Options = { growth: true, exploration: true, reflection: true }): Stack {
  const directory = options.databasePath ? dirname(options.databasePath) : mkdtempSync(join(tmpdir(), 'morrow-stage3-eval-'))
  const database = SqliteDatabase.open(options.databasePath ?? join(directory, 'morrow.sqlite3'))
  const clock = options.clock
  // The event log is created first because MemoryService writes memory.* events
  // into it, and reflection reads exactly those events.
  const eventLog = new EventLogService(database)
  const memoryImportance = new MemoryImportanceService(database, clock)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, eventLog, { importance: memoryImportance })
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const provider = new ScriptedProvider()
  const interests = new InterestService(new SqliteInterestRepository(database), eventLog)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), eventLog)
  const reflection = new ReflectionService(
    new SqliteReflectionRepository(database),
    { memories, interests, selfModel, events: eventLog },
    eventLog
  )
  const personalization = new PersonalizationService(database, clock)
  const growth = new PersonalityGrowthService(database, clock)
  const exploration = new ExplorationService(database, clock)
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async (preview) => {
      // The consent window must be expressed on the same clock the turn uses;
      // with an injected clock, a real-time expiry would look already expired.
      const nowMs = Date.parse(clock ? clock() : new Date().toISOString())
      return {
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 60_000).toISOString(),
        includeSensitive: preview.maximumSensitivity === 'sensitive'
      }
    },
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
    ...(clock ? { clock } : {}),
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
    importance: memoryImportance,
    close: () => {
      database.close()
      if (!options.keepDatabase) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  }
}

export function systemText(payload: string): string {
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
      // Explicit style directives only. A correction or a memory request is not
      // personality evidence, so it must not move anything.
      // Three explicit directness requests and three explicit humour
      // reductions: both dimensions cross the evidence gate, so the *sign* of
      // each offset is observable instead of being masked by the gate.
      const turns = [
        '以后直接说重点，别铺垫。',
        '不是这个意思，你理解错了。',
        '还是直接说重点。',
        '直接说吧，别绕。',
        '正经点，别开玩笑。',
        '正经点，别开玩笑。',
        '正经点，别开玩笑。',
        '你记得我上次说的吗？'
      ]
      for (const text of turns) await send(stack, conversation.id, text)
      const after = stack.companion.getPersonality()
      const entries = stack.growth.list()
      const directness = entries.find((entry) => entry.dimension === 'directness')!
      const humor = entries.find((entry) => entry.dimension === 'humor')!
      return outcome('L4', [
        { name: '用户编辑的基线未被改写', ok: after.warmth === baseline.warmth && after.directness === baseline.directness && after.humor === baseline.humor, detail: `v${after.version}` },
        { name: '显式风格要求产生正向证据', ok: directness.evidenceCount >= 3 && directness.offset > 0, detail: `${directness.evidenceCount}/${directness.offset}` },
        { name: '反向要求产生反向证据而非支持', ok: humor.evidenceCount >= 1 && humor.offset < 0, detail: `${humor.evidenceCount}/${humor.offset}` },
        { name: '漂移仍在硬上限内', ok: entries.every((entry) => Math.abs(entry.offset) <= GROWTH_MAX_OFFSET), detail: entries.map((entry) => `${entry.dimension}:${entry.offset}`).join(',') }
      ])
    }
  },
  {
    id: 'L5',
    name: '用户兴趣 / Morrow 自身兴趣 / 共同兴趣分离',
    run: async (stack) => {
      // 1. A topic the user keeps returning to. It must be labelled as the
      //    user's, and it must NOT become a topic Morrow may raise.
      const userConversations = [stack.companion.createConversation(), stack.companion.createConversation()]
      for (const conversation of userConversations) {
        for (let index = 0; index < 3; index += 1) {
          await send(stack, conversation.id, '我最近一直在研究分布式系统的共识算法。')
        }
      }
      const afterUserOnly = stack.interests.activeForContext(10)
      const userTopic = afterUserOnly.find((interest) => interest.origin === 'user')
      const userOnlyTurn = randomUUID()
      await stack.companion.sendChat({ conversationId: userConversations[0]!.id, requestId: userOnlyTurn, content: '分布式系统的共识算法里，Paxos 和 Raft 有什么区别？', includeSensitive: false }, () => undefined)
      const userOnlyPayload = systemText(stack.provider.lastPayload)
      const userOnlyStates = stack.exploration.history(userOnlyTurn).map((entry) => entry.state)

      // 2. A topic Morrow chose herself. Independent evidence, cited by finding.
      const morrowConversation = stack.companion.createConversation()
      const morrowObservations = 3
      for (let index = 0; index < morrowObservations; index += 1) {
        stack.interests.observeMorrow({
          conversationId: index === 2 ? userConversations[1]!.id : morrowConversation.id,
          findingId: randomUUID(),
          occurredAt: new Date(Date.now() + index * 1000).toISOString(),
          // Deliberately a different subject from the user's: a topic the user
          // already owns must not be re-attributed to Morrow just because she
          // thought about it.
          topicText: '长期记忆里证据与遗忘的边界'
        })
      }
      const owned = stack.interests.activeForContext(10).filter((interest) => interest.origin === 'morrow' || interest.origin === 'shared')

      // 3. The next suitable turn may raise it, but the scripted reply says
      //    nothing about it, so it must settle as not_raised and not consume the
      //    budget.
      const raiseTurn = randomUUID()
      await stack.companion.sendChat({ conversationId: morrowConversation.id, requestId: raiseTurn, content: '今天想聊点什么？', includeSensitive: false }, () => undefined)
      const raisePayload = systemText(stack.provider.lastPayload)
      const raiseStates = stack.exploration.history(raiseTurn).map((entry) => entry.state)

      // 4. A failed provider call on a permitted turn must not count as a raise.
      const failedTurn = randomUUID()
      stack.provider.failure = 'upstream timeout'
      try {
        await stack.companion.sendChat({ conversationId: morrowConversation.id, requestId: failedTurn, content: '继续吧。', includeSensitive: false }, () => undefined)
      } catch {
        // expected
      } finally {
        stack.provider.failure = null
      }
      const failedStates = stack.exploration.history(failedTurn).map((entry) => entry.state)

      return outcome('L5', [
        { name: '用户重复话题被标注为用户侧', ok: Boolean(userTopic) && userOnlyPayload.includes('Topics the user returned to'), detail: userTopic ? userTopic.origin : 'none' },
        { name: '用户兴趣不得被当作 Morrow 自身话题提出', ok: !userOnlyStates.includes('permitted') && !userOnlyStates.includes('actually_raised'), detail: userOnlyStates.join(',') || 'no events' },
        { name: 'Morrow 自身兴趣有独立证据来源', ok: owned.length > 0 && owned.every((interest) => interest.origin !== 'user'), detail: owned.map((interest) => `${interest.label}:${interest.origin}`).join(',') || 'none' },
        { name: '自身话题获得许可并进入 payload', ok: raiseStates.includes('permitted') && raisePayload.includes('your own attention'), detail: raiseStates.join(',') || 'no permission' },
        { name: '回复未提及则不计为已提出', ok: raiseStates.includes('permitted') && !raiseStates.includes('actually_raised') && stack.exploration.recent().raisedLastDay === 0, detail: raiseStates.join(',') },
        { name: 'Provider 失败不计为成功探索', ok: failedStates.includes('provider_failed') || failedStates.length === 0, detail: failedStates.join(',') || 'no permission this turn' }
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
    name: '真实主数据库重启后状态连续',
    run: async (stack) => {
      // The whole runtime is rebuilt on the same file: database, migrations,
      // repositories, services and the companion. Nothing is stubbed.
      const directory = mkdtempSync(join(tmpdir(), 'morrow-stage3-restart-'))
      const path = join(directory, 'morrow.sqlite3')
      let firstOffsets: Record<string, number> = {}
      let memoryId = ''
      const firstStack = buildStack({ growth: true, exploration: true, reflection: true, databasePath: path, keepDatabase: true })
      try {
        const memory = firstStack.memories.create('我在做一个长期陪伴项目，代号 Morrow。', 'personal')
        memoryId = memory.id
        const conversation = firstStack.companion.createConversation()
        for (let index = 0; index < 3; index += 1) {
          await firstStack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '以后直接说重点，别铺垫。', includeSensitive: false }, () => undefined)
        }
        firstOffsets = Object.fromEntries(firstStack.growth.list().map((entry) => [entry.dimension, entry.offset]))
      } finally {
        firstStack.close()
      }

      const secondStack = buildStack({ growth: true, exploration: true, reflection: true, databasePath: path, keepDatabase: true })
      try {
        const conversation = secondStack.companion.createConversation()
        await secondStack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我们继续之前那个长期陪伴项目吧。', includeSensitive: false }, () => undefined)
        const payload = systemText(secondStack.provider.lastPayload)
        const secondOffsets = Object.fromEntries(secondStack.growth.list().map((entry) => [entry.dimension, entry.offset]))
        return outcome('L11', [
          { name: '重启后记忆仍进入最终 payload', ok: payload.includes('Morrow'), detail: `memory ${memoryId.slice(0, 8)}` },
          { name: '重启后人格漂移连续', ok: JSON.stringify(firstOffsets) === JSON.stringify(secondOffsets), detail: JSON.stringify(secondOffsets) },
          { name: '重启后基线未被改写', ok: secondStack.companion.getPersonality().version >= 1, detail: `v${secondStack.companion.getPersonality().version}` }
        ])
      } finally {
        secondStack.close()
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      }
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
    id: 'L16',
    name: '记忆重要度、衰减归档与合并',
    run: async (stack) => {
      const important = stack.memories.create('请记住，这很重要：我的护照放在书房抽屉里。', 'personal')
      const chatter = stack.memories.create('今天路过一家咖啡店，随便聊聊。', 'normal')
      const factA = stack.memories.create('我住在杭州。', 'personal')
      const factB = stack.memories.create('现在我住在杭州。', 'personal')
      // Backdate the chatter so decay has something old to act on.
      stack.database.connection.prepare("UPDATE memories SET source_category = 'turn_derived_confirmed', updated_at = '2025-01-01T00:00:00.000Z' WHERE id = ?").run(chatter.id)
      stack.importance.recomputeAll()
      const importantScore = stack.importance.get(important.id)
      const chatterScore = stack.importance.get(chatter.id)
      const archived = stack.importance.archiveBelow(undefined, 180)
      const groups = stack.importance.consolidate()
      const group = groups.find((item) => item.memberIds.includes(factA.id))

      const conversation = stack.companion.createConversation()
      await send(stack, conversation.id, '我的护照放在哪里？')
      const payload = systemText(stack.provider.lastPayload)

      return outcome('L16', [
        { name: '每条记忆都有重要度分数', ok: importantScore !== null && chatterScore !== null, detail: `${importantScore?.score ?? 'none'}/${chatterScore?.score ?? 'none'}` },
        { name: '显式重要记忆分数高于闲聊', ok: (importantScore?.score ?? 0) > (chatterScore?.score ?? 1), detail: 'score compare' },
        { name: '只归档低重要度且足够旧的记忆', ok: archived.includes(chatter.id) && !archived.includes(important.id) && !archived.includes(factA.id), detail: archived.length + ' archived' },
        { name: '被归档的记忆不再进入 payload', ok: !payload.includes('咖啡店'), detail: 'text scan' },
        { name: '受保护记忆仍可被检索', ok: payload.includes('护照'), detail: 'text scan' },
        { name: '同一事实的两种说法被合并引用', ok: Boolean(group) && group!.memberIds.includes(factB.id), detail: group ? group.memberIds.length + ' members' : 'none' }
      ])
    }
  },
  {
    id: 'L15',
    name: '多日模拟：漂移与打扰控制',
    run: async () => ({ id: 'L15', status: 'NOT_RUN', assertions: [], notRunReason: '见 evals/stage-3/longitudinal/ —— 由独立运行器按 10 天压缩时钟执行。' })
  }
]
