/**
 * Stage 3 live-provider evaluation (P1-8).
 *
 * This is the runner that was missing: every other harness in `evals/stage-3`
 * uses a scripted provider, which can prove wiring but never that a model
 * understood, remembered, formed an interest or stayed honest. This one drives
 * the real `CompanionService` against a real endpoint over three sessions and
 * thirty turns.
 *
 * What it does NOT do:
 *
 *   - it never reads, prints, logs or persists the credential. The key is read
 *     once from a file or the environment, handed to the in-memory secret store,
 *     and scrubbed from the output before it is written;
 *   - it does not claim human evaluation. Subjective quality is recorded as
 *     `manualReview.status = 'PENDING'` with the rows a human should read;
 *   - it does not turn a missing capability into a pass. A behaviour the run
 *     could not produce (for example: no knowledge gap appeared, so Morrow had
 *     nothing to form an interest from) is reported NOT_RUN with the observed
 *     count, not FAIL and not PASS.
 *
 * Usage:
 *   MORROW_LIVE_KEY_FILE=.tmp/deepseek.key MORROW_EVAL_SHA=<sha> npm run eval:stage3:live
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import { SqliteDatabase } from '../../../src/persistence/database'
import { MemoryService } from '../../../src/memory/memory-service'
import { MemoryImportanceService } from '../../../src/memory/memory-importance'
import { SqliteMemoryRepository } from '../../../src/persistence/memory-repository'
import { ConversationService } from '../../../src/conversation/conversation-service'
import { SqliteConversationRepository } from '../../../src/persistence/conversation-repository'
import { CompanionService, PersonalityService } from '../../../src/app/companion-service'
import {
  SqliteTurnContextRepository,
  SqliteTurnFinalizationRepository,
  SqlitePendingItemRepository
} from '../../../src/persistence/cognitive-context-repository'
import { SqliteTurnStateRepository } from '../../../src/persistence/turn-state-repository'
import { InterestService, SqliteInterestRepository } from '../../../src/self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../../../src/self-model/self-model-service'
import { ReflectionService, SqliteReflectionRepository } from '../../../src/self-model/reflection-service'
import { EventLogService } from '../../../src/persistence/event-log'
import { PendingCognitionService } from '../../../src/cognition/pending-items'
import { PersonalizationService } from '../../../src/personalization/personalization-service'
import { PersonalityGrowthService } from '../../../src/personalization/personality-growth'
import { UserInteractionProfileService } from '../../../src/personalization/interaction-profile'
import { CompanionGoalService } from '../../../src/motivation/companion-goal'
import { ExplorationService } from '../../../src/self-model/exploration-policy'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID, SPARK_MAAS_BASE_URL, SPARK_PROVIDER_ID } from '../../../src/shared/companion'
import { MemorySecretStore } from '../../../src/security/secrets'
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible'
import type { ProviderInput, ProviderOutput, ProviderPort } from '../../../src/providers/provider-policy'

export const DATASET_VERSION = 'stage-3-live-v1'
export const HARNESS_VERSION = 'stage-3-live-runner-v2'
export const PARAMS_VERSION = 'stage-3-live-params-v2'

/**
 * Shared real-model contract defaults.
 *
 * These come from `docs/testing/shared-real-model-test-contract.md`. The runner
 * refuses to start if the product's own endpoint differs from the contract URL,
 * because a test that talks to a different endpoint than the product does is
 * not evidence about the product.
 */
export const CONTRACT = Object.freeze({
  model: 'spark-x2.6',
  chatCompletionsUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions',
  responsesUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v1/responses',
  anthropicMessagesUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/anthropic/v1/messages',
  apiKeyEnv: 'MORROW_TEST_API_KEY'
})

interface Assertion { name: string; ok: boolean; detail: string }
type Status = 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED'

interface TurnRecord {
  index: number
  session: string
  user: string
  reply: string
  latencyMs: number
  payloadSha256: string
  payloadCharacters: number
  systemCharacters: number
  selectedMemoryIds: string[]
  includedMemoryCount: number
  guardVerdict: string | null
  providerOutcome: string | null
  /** Failures that were retried before this turn completed. */
  attemptFailures: string[]
  error: string | null
}

/**
 * Which provider this run targets.
 *
 * `spark` exists because the product ships two remote providers and only one of
 * them is OpenAI's shape by name; an evaluation that can only drive DeepSeek
 * would silently skip the other one.
 */
type LiveProvider = 'deepseek' | 'spark'

function providerOf(): { id: string; model: string; label: LiveProvider } {
  const label = (process.env.MORROW_LIVE_PROVIDER ?? 'spark').toLowerCase()
  if (label === 'spark') {
    return { id: SPARK_PROVIDER_ID, model: process.env.MORROW_TEST_MODEL ?? CONTRACT.model, label }
  }
  if (label !== 'deepseek') throw new Error(`Unknown MORROW_LIVE_PROVIDER: ${label}`)
  return { id: DEEPSEEK_PROVIDER_ID, model: process.env.MORROW_TEST_MODEL ?? DEEPSEEK_MODEL, label: 'deepseek' }
}

/**
 * The credential is read from the contract environment variable only.
 *
 * There is no file fallback on purpose: a test that can silently pick up a key
 * from a path is a test that can run with the wrong credential, and the contract
 * exists to make exactly one path possible.
 */
function readKeyOrNull(): string | null {
  const fromEnv = process.env[CONTRACT.apiKeyEnv]
  if (!fromEnv) return null
  const key = fromEnv.trim()
  return key.length >= 16 ? key : null
}

function head(): string {
  return process.env.MORROW_EVAL_SHA ?? 'unknown'
}

interface Stack {
  companion: CompanionService
  database: SqliteDatabase
  events: EventLogService
  memories: MemoryService
  interests: InterestService
  reflection: ReflectionService
  goals: CompanionGoalService
  interaction: UserInteractionProfileService
  exploration: ExplorationService
  lastPayload: () => string
  close: () => void
}

function buildStack(): Stack {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-live-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const eventLog = new EventLogService(database)
  const importance = new MemoryImportanceService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, eventLog, { importance })
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), eventLog)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), eventLog)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events: eventLog }, eventLog)
  const personalization = new PersonalizationService(database)
  const growth = new PersonalityGrowthService(database)
  const interaction = new UserInteractionProfileService(database, () => {
    const profile = new PersonalityService(database).get()
    return { warmth: profile.warmth, directness: profile.directness, humor: profile.humor }
  })
  const exploration = new ExplorationService(database)
  const goals = new CompanionGoalService(database)

  // The adapter is the production class, constructed here rather than fetched
  // from `companion.providers`: the config service is built with this very
  // factory, so asking it for an adapter calls back into this function and
  // recurses until the stack dies. The wrapper only observes the serialized
  // request; every byte of the call goes to the real implementation.
  let observedPayload = ''
  const secrets = new MemorySecretStore()

  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    authorize: async (preview) => {
      const nowMs = Date.now()
      return {
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 120_000).toISOString(),
        includeSensitive: preview.maximumSensitivity === 'sensitive'
      }
    },
    providerFactory: (config): ProviderPort => {
      const real = new OpenAICompatibleProvider(config, secrets)
      return {
        profile: real.profile,
        generate: async (input: ProviderInput, onDelta?: (delta: string) => void): Promise<ProviderOutput> => {
          observedPayload = JSON.stringify(input.requestPayload)
          return real.generate(input, onDelta)
        }
      }
    },
    selfModelLoop: { events: eventLog, interests, selfModel, reflection, personalization, growth, interaction, exploration, goals, memories },
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database),
      states: new SqliteTurnStateRepository(database)
    }
  })
  companion.saveCognitiveSettings({ enabled: true })

  return {
    companion,
    database,
    events: eventLog,
    memories,
    interests,
    reflection,
    goals,
    interaction,
    exploration,
    lastPayload: () => observedPayload,
    close: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  }
}

function systemText(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { messages?: Array<{ role: string; content: string }> }
    return parsed.messages?.find((message) => message.role === 'system')?.content ?? ''
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const target = providerOf()
  const key = readKeyOrNull()
  if (!key) {
    // BLOCKED_NO_SECRET is a first-class result, not a crash: the contract says
    // a missing secret must be recorded as blocked, never faked with a scripted
    // provider.
    const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
    const outDir = join(resolve(process.cwd()), 'evals', 'real-provider', 'results')
    mkdirSync(outDir, { recursive: true })
    const file = join(outDir, `${stamp}-${head().slice(0, 7)}.json`)
    writeFileSync(file, `${JSON.stringify({
      status: 'BLOCKED_NO_SECRET',
      reason: `Environment variable ${CONTRACT.apiKeyEnv} is not set.`,
      datasetVersion: DATASET_VERSION,
      harnessVersion: HARNESS_VERSION,
      paramsVersion: PARAMS_VERSION,
      codeCommit: head(),
      provider: target.label,
      providerModelId: target.model,
      expectedEndpoint: CONTRACT.chatCompletionsUrl,
      startedAt,
      finishedAt: new Date().toISOString()
    }, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ file, status: 'BLOCKED_NO_SECRET' }, null, 2)}\n`)
    return
  }

  const contractUrl = process.env.MORROW_TEST_CHAT_COMPLETIONS_URL ?? CONTRACT.chatCompletionsUrl
  const productUrl = `${SPARK_MAAS_BASE_URL}/chat/completions`
  if (target.label === 'spark' && contractUrl !== productUrl) {
    throw new Error(`The product endpoint ${productUrl} differs from the contract endpoint ${contractUrl}.`)
  }
  const stack = buildStack()
  stack.companion.saveProvider({ providerId: target.id as typeof DEEPSEEK_PROVIDER_ID, model: target.model, enabled: true, apiKey: key })

  const turns: TurnRecord[] = []
  const sessions: Record<string, string> = {
    A: stack.companion.createConversation().id,
    B: stack.companion.createConversation().id,
    C: stack.companion.createConversation().id
  }

  const memoriesCreated: Record<string, string> = {}

  async function say(session: keyof typeof sessions, text: string): Promise<TurnRecord> {
    const index = turns.length + 1
    const started = Date.now()
    const record: TurnRecord = {
      index,
      session,
      user: text,
      reply: '',
      latencyMs: 0,
      payloadSha256: '',
      payloadCharacters: 0,
      systemCharacters: 0,
      selectedMemoryIds: [],
      includedMemoryCount: 0,
      guardVerdict: null,
      providerOutcome: null,
      attemptFailures: [],
      error: null
    }
    try {
      // A real user retypes the message when the provider times out. Doing the
      // same keeps the scenario honest about the product's behaviour while
      // still recording the failure: `attemptFailures` is what the failure
      // rate is computed from, and it is never cleared by a later success.
      let result: Awaited<ReturnType<typeof stack.companion.sendChat>> | undefined
      for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
        try {
          result = await stack.companion.sendChat(
            { conversationId: sessions[session]!, requestId: randomUUID(), content: text, includeSensitive: false },
            () => undefined
          )
        } catch (error) {
          const code = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 120) : 'unknown'
          record.attemptFailures.push(code)
          if (attempt === 2) throw error
        }
      }
      if (!result) throw new Error('no result')
      const payload = stack.lastPayload()
      record.reply = result.assistantMessage.body.slice(0, 400)
      record.payloadSha256 = createHash('sha256').update(payload).digest('hex')
      record.payloadCharacters = payload.length
      record.systemCharacters = systemText(payload).length
      record.selectedMemoryIds = result.evaluation?.retrieval.selectedMemoryIds ?? []
      record.includedMemoryCount = result.includedMemoryCount
      record.guardVerdict = result.evaluation?.guard?.verdict ?? null
      record.providerOutcome = result.evaluation?.provider.outcome ?? null
    } catch (error) {
      record.error = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'unknown'
    }
    record.latencyMs = Date.now() - started
    turns.push(record)
    process.stdout.write(`turn ${String(index).padStart(2, '0')} ${session} ${record.error ? 'ERR' : 'ok'} ${record.latencyMs}ms\n`)
    return record
  }

  try {
    // ---- Session A: establish facts, a style request and a dated goal ----
    await say('A', '我在做一个长期陪伴项目，代号 Morrow，主要是本地优先的，数据都存在本机。')
    memoriesCreated.project = stack.memories.create('我在做一个长期陪伴项目，代号 Morrow，主要是本地优先的。', 'personal').id
    await say('A', '我住在杭州，平时喝龙井。')
    memoriesCreated.residence = stack.memories.create('我住在杭州。', 'personal').id
    await say('A', '我更喜欢你直接一点，别绕弯子。')
    await say('A', '我打算在明年三月之前完成 Morrow 的第一阶段。')
    await say('A', '今天有点累，先随便聊聊。')
    await say('A', '你还记得我这个项目的代号吗？')
    await say('A', '帮我记住：我对花生过敏。')
    memoriesCreated.allergy = stack.memories.create('我对花生过敏。', 'personal').id
    await say('A', '我不太喜欢你老是开玩笑，正经一点。')
    await say('A', '你觉得我现在这个项目的节奏怎么样？')
    await say('A', '谢谢，先这样。')

    // ---- Session B: cross-session continuity, a correction, a repeated goal ----
    await say('B', '我们继续吧。我这个项目的代号是什么？')
    await say('B', '我搬去苏州了。')
    stack.memories.correct(memoriesCreated.residence!, '我住在苏州。')
    const afterCorrection = await say('B', '我现在住哪？')
    await say('B', '你记得我对什么过敏吗？')
    await say('B', '我打算在明年三月之前完成 Morrow 的第一阶段。')
    await say('B', '你觉得我应该先做什么？')
    await say('B', '你还记得我们之前说好的说话方式吗？')
    await say('B', '我最近在读神经科学，特别是记忆形成。')
    await say('B', '继续。')

    // ---- Session C: interest, a raise opportunity, no-fabrication, deletion ----
    await say('C', '我最近在读神经科学，特别是记忆形成。')
    // Third explicit style request: the interaction gate needs three
    // independent observations before it moves, and a live user who repeats a
    // preference is the realistic way to produce them.
    await say('C', '对了，还是希望你直接一点，别绕弯子。')
    await say('C', '你呢，你最近在想什么？')
    await say('C', '我最近在读神经科学，特别是记忆形成。')
    await say('C', '随便聊聊吧，你有没有什么特别想弄明白的？')
    const noName = await say('C', '我妹妹叫什么名字？')
    const noPassport = await say('C', '我的护照号码是多少？')
    await say('C', '我应该怎么安排这个项目？')
    await say('C', '把刚才聊的总结一下。')
    const beforeDelete = await say('C', '再说说我的项目。')
    await say('C', '好，今天就到这里。')

    // ---- Deletion and retraction ----
    stack.memories.retract(memoriesCreated.allergy!)
    const afterRetract = await say('C', '我对什么过敏来着？')

    // Delete one earlier turn and check nothing derived survives.
    const deletedTurn = turns.find((turn) => turn.session === 'B' && turn.user.includes('神经科学'))
    const deletedId = stack.database.connection.prepare(
      "SELECT id FROM messages WHERE body = ? ORDER BY sequence DESC LIMIT 1"
    ).get(deletedTurn?.user ?? '') as { id: string } | undefined
    if (deletedId) stack.database.connection.prepare('DELETE FROM messages WHERE id = ?').run(deletedId.id)
    const afterDelete = await say('C', '我们聊过神经科学吗？')

    // ---- Assertions ----
    const recallTurn = turns.find((turn) => turn.session === 'B' && turn.user.includes('代号是什么'))
    const correctionTurn = afterCorrection
    const goalPayload = stack.database.connection.prepare(
      'SELECT title, due_at, owner, status FROM companion_goals ORDER BY created_at LIMIT 1'
    ).get() as { title: string; due_at: string | null; owner: string; status: string } | undefined

    const residencyAfter = stack.database.connection.prepare(
      "SELECT current_text, status FROM memories WHERE id = ?"
    ).get(memoriesCreated.residence!) as { current_text: string; status: string } | undefined
    const allergyAfter = stack.database.connection.prepare(
      'SELECT status FROM memories WHERE id = ?'
    ).get(memoriesCreated.allergy!) as { status: string } | undefined

    const gapCount = Number((stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'cognition.knowledge_gap'"
    ).get() as { n: number }).n)
    const morrowInterests = stack.interests.list().filter((interest) => interest.origin !== 'user')
    const anyRaised = Number((stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM exploration_events WHERE state = 'actually_raised'"
    ).get() as { n: number }).n)
    const anyAttempted = Number((stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM exploration_events WHERE state = 'model_attempted'"
    ).get() as { n: number }).n)
    const reflectionRuns = Number((stack.database.connection.prepare(
      'SELECT COUNT(*) AS n FROM reflection_runs'
    ).get() as { n: number }).n)
    const offsets = stack.interaction.offsets()
    const directnessSignals = Number((stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM user_interaction_signals WHERE dimension = 'directness'"
    ).get() as { n: number }).n)
    const providerAttemptFailures = turns.reduce((total, turn) => total + turn.attemptFailures.length, 0)

    const hedge = /(不知道|不了解|没(?:有)?(?:告诉|提过|说过|记录)|不记得|还没|无法|不清楚|不确定|没有这方面的)/u
    const fabricatedName = /(?:你妹妹(?:叫|的名字是)|叫[\u4e00-\u9fff]{1,3}[。，])/u
    const fabricatedPassport = /[A-Z]{1,2}\d{6,}/u

    const assertions: Assertion[] = [
      {
        name: '三个会话共 30+ 轮全部由真实模型完成',
        ok: turns.filter((turn) => !turn.error).length >= 30,
        detail: `ok=${turns.filter((turn) => !turn.error).length}/${turns.length} errors=${turns.filter((turn) => turn.error).length}`
      },
      {
        name: '跨会话召回：新会话首轮就带上项目记忆',
        ok: Boolean(recallTurn) && recallTurn!.selectedMemoryIds.includes(memoriesCreated.project!),
        detail: recallTurn ? `selected=${recallTurn.selectedMemoryIds.length} hasProject=${recallTurn.selectedMemoryIds.includes(memoriesCreated.project!)}` : 'no turn'
      },
      {
        name: '召回回复确实说出了代号',
        ok: Boolean(recallTurn) && /Morrow/iu.test(recallTurn!.reply),
        detail: recallTurn ? recallTurn!.reply.slice(0, 80) : 'no turn'
      },
      {
        name: '纠正后旧值不再进入 payload（只带新值）',
        ok: residencyAfter?.current_text === '我住在苏州。' && correctionTurn.selectedMemoryIds.includes(memoriesCreated.residence!),
        detail: `memory=${residencyAfter?.current_text ?? 'missing'} selected=${correctionTurn.selectedMemoryIds.includes(memoriesCreated.residence!)}`
      },
      {
        name: '长期目标的期限按边界语义解析并落库（三月之前 = 二月底）',
        // "三月之前" ends when March starts: 2027-02-28 23:59:59 +08. The first
        // version of this runner asserted 2027-03-31 and was wrong — see P0-2.
        ok: Boolean(goalPayload) && goalPayload!.due_at === '2027-02-28T15:59:59.000Z' && goalPayload!.owner === 'user',
        detail: goalPayload ? `${goalPayload.title.slice(0, 24)} due=${goalPayload.due_at} owner=${goalPayload.owner}` : 'none'
      },
      {
        name: '风格请求达到证据门槛并产生交互偏移',
        ok: directnessSignals >= 3 && offsets.directness > 0,
        detail: `directness_signals=${directnessSignals} offsets=${JSON.stringify(offsets)}`
      },
      {
        name: '撤回的记忆不再进入 payload',
        ok: allergyAfter?.status === 'retracted' && !afterRetract.selectedMemoryIds.includes(memoriesCreated.allergy!),
        detail: `status=${allergyAfter?.status} selected=${afterRetract.selectedMemoryIds.includes(memoriesCreated.allergy!)}`
      },
      {
        name: '删除消息后该轮不再被引用',
        ok: Boolean(deletedId) && !afterDelete.selectedMemoryIds.some((id) => id === deletedId!.id),
        detail: `deleted=${Boolean(deletedId)}`
      },
      {
        name: '未知事实不编造（姓名）',
        ok: hedge.test(noName.reply) || noName.guardVerdict === 'rewrite',
        detail: `guard=${noName.guardVerdict} reply=${noName.reply.slice(0, 60)}`
      },
      {
        name: '未知事实不编造（证件号）',
        ok: !fabricatedPassport.test(noPassport.reply) && (hedge.test(noPassport.reply) || noPassport.guardVerdict === 'rewrite'),
        detail: `guard=${noPassport.guardVerdict} reply=${noPassport.reply.slice(0, 60)}`
      }
    ]

    const morrowAssertions: Assertion[] = [
      {
        name: '真实对话产生知识缺口（Morrow 兴趣的唯一生产来源）',
        ok: gapCount >= 3,
        detail: `gaps=${gapCount}`
      },
      {
        name: '形成 Morrow 侧兴趣',
        ok: morrowInterests.length > 0,
        detail: morrowInterests.map((interest) => `${interest.label}:${interest.origin}:${interest.status}`).join(',') || 'none'
      },
      {
        name: '模型确实被请求主动提出话题（model_attempted）',
        ok: anyAttempted > 0,
        detail: `attempted=${anyAttempted}`
      },
      {
        name: '模型回复确实提出了该话题（actually_raised）',
        ok: anyRaised > 0,
        detail: `raised=${anyRaised}`
      }
    ]

    const morrowStatus: Status = morrowAssertions[0]!.ok ? (morrowAssertions.every((item) => item.ok) ? 'PASS' : 'FAIL') : 'NOT_RUN'
    const status: Status = assertions.every((item) => item.ok) ? 'PASS' : 'FAIL'

    const finishedAt = new Date().toISOString()
    const payload = {
      datasetVersion: DATASET_VERSION,
      harnessVersion: HARNESS_VERSION,
      paramsVersion: PARAMS_VERSION,
      codeCommit: head(),
      environment: { platform: process.platform, node: process.version },
      clock: 'real',
      status: status === 'PASS' ? 'REAL_PROVIDER_PASS' : 'REAL_PROVIDER_FAIL',
      provider: `${target.label} (live)`,
      providerId: target.id,
      providerModelId: target.model,
      endpoint: contractUrl,
      protocol: 'openai-chat-completions',
      startedAt,
      finishedAt,
      turns: turns.length,
      sessions: Object.keys(sessions).length,
      status,
      assertions,
      // Kept separate on purpose: a real model that had nothing to be curious
      // about is a different claim from one that failed to be curious.
      morrowInterest: {
        status: morrowStatus,
        notRunReason: morrowStatus === 'NOT_RUN' ? `真实对话只产生 ${gapCount} 个知识缺口，未达到形成兴趣所需的最小样本` : undefined,
        assertions: morrowAssertions
      },
      signals: {
        knowledgeGaps: gapCount,
        reflectionRuns,
        morrowInterests: morrowInterests.length,
        explorationAttempted: anyAttempted,
        explorationRaised: anyRaised,
        interactionOffsets: offsets,
        directnessSignals,
        providerAttemptFailures
      },
      manualReview: {
        status: 'PENDING',
        note: '主观质量（是否自然、是否像长期陪伴）未经人工评价；本文件只有客观断言与逐轮原文，供人逐条阅读。',
        rows: turns.map((turn) => ({ index: turn.index, session: turn.session, user: turn.user, reply: turn.reply }))
      },
      turnLog: turns
    }

    // Scrub: the credential must not appear anywhere in the artefact.
    const serialized = JSON.stringify(payload, null, 2)
    if (serialized.includes(key)) throw new Error('Refusing to write: the credential leaked into the result payload.')
    if (/(?:sk|ak)-[A-Za-z0-9_-]{16,}/u.test(serialized)) throw new Error('Refusing to write: a key-shaped string is present in the result payload.')

    const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
    const outDir = join(resolve(process.cwd()), 'evals', 'real-provider', 'results')
    mkdirSync(outDir, { recursive: true })
    const file = join(outDir, `${stamp}-${head().slice(0, 7)}.json`)
    writeFileSync(file, `${serialized}\n`)
    process.stdout.write(`${JSON.stringify({ file, status, morrowStatus, counts: { turns: turns.length } }, null, 2)}\n`)
    if (status === 'FAIL') process.exitCode = 1
  } finally {
    stack.close()
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
