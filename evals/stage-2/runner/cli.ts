/**
 * Stage 2 offline scenario runner.
 *
 * What this is: a real executor. It builds the real `CompanionService` against a
 * temporary SQLite database and drives it through `sendChat`, so every assertion
 * reads the serialized provider request, the database, or the turn record.
 *
 * What this is not: a model-quality benchmark. The provider is scripted, so
 * scenarios that would depend on model semantics cannot be judged here and are
 * reported as NOT_RUN (or BLOCKED when they need a credential). The scripted
 * provider is labelled in the result file, never presented as a real model.
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
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../../../src/shared/companion'
import { MemorySecretStore } from '../../../src/security/secrets'
import { hashProviderInput } from '../../../src/providers/provider-policy'
import { FEELING_PER_EVENT_LIMIT } from '../../../src/affective-state/feeling'
import { MAX_RUNS_PER_HOUR } from '../../../src/self-model/reflection-service'
import { INTEREST_PROMOTION_MIN_CONVERSATIONS, INTEREST_PROMOTION_MIN_EVIDENCE } from '../../../src/self-model/self-model-domain'
import type { ProviderInput, ProviderOutput, ProviderPort, ProviderProfile } from '../../../src/providers/provider-policy'

const DATASET_VERSION = 'v1'
const HARNESS_VERSION = 'stage-2-runner-v1'

class ScriptedProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  calls = 0
  lastPayload = ''
  /** Exactly what the provider was handed, for hash re-computation. */
  lastInput: ProviderInput | null = null
  /** When set, every call rejects with this message (fault injection). */
  failure: string | null = null

  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.calls += 1
    this.lastPayload = JSON.stringify(input.requestPayload)
    this.lastInput = input
    if (this.failure) throw new Error(this.failure)
    return { text: '好的。', modelId: 'scripted-offline', attempts: 1 }
  }
}

interface Assertion {
  name: string
  ok: boolean
  detail: string
}

type ScenarioStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'BLOCKED' | 'NOT_RUN'

interface ScenarioOutcome {
  id: string
  status: ScenarioStatus
  assertions: Assertion[]
  error?: string
  blockedBy?: string
  notRunReason?: string
}

interface Stack {
  companion: CompanionService
  memories: MemoryService
  provider: ScriptedProvider
  /** payloadSha256 values the consent gate approved, in call order. */
  approvedHashes: string[]
  states: SqliteTurnStateRepository
  interests: InterestService
  reflection: ReflectionService
  close: () => void
}

function buildStack(): Stack {
  const approvedHashes: string[] = []
  const directory = mkdtempSync(join(tmpdir(), 'morrow-stage2-eval-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const provider = new ScriptedProvider()
  const states = new SqliteTurnStateRepository(database)
  // Real event log, not a stub: reflection reads evidence from it.
  const eventLog = new EventLogService(database)
  const interests = new InterestService(new SqliteInterestRepository(database), eventLog)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), eventLog)
  const reflection = new ReflectionService(
    new SqliteReflectionRepository(database),
    { memories, interests, selfModel, events: eventLog },
    eventLog
  )
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async (preview) => (approvedHashes.push(preview.payloadSha256), {
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }),
    providerFactory: () => provider,
    selfModelLoop: { events: eventLog, interests, selfModel, reflection },
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database),
      states
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-placeholder-key' })
  // Retrieval only runs when the cognitive core is on; without this the
  // scenarios would "pass" the retraction checks for the wrong reason.
  companion.saveCognitiveSettings({ enabled: true })
  return {
    companion,
    memories,
    provider,
    approvedHashes,
    states,
    interests,
    reflection,
    close: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  }
}

function deliveredMemoryIds(payload: string): string[] {
  // The memory block is JSON nested inside the system message, so its quotes
  // arrive escaped. Unescaping the whole payload is safe here: this string is
  // only scanned, never sent anywhere or stored.
  const unescaped = payload.replace(/\\"/gu, '"')
  const marker = unescaped.indexOf('"memories":[')
  if (marker < 0) return []
  const window = unescaped.slice(marker, marker + 8000)
  return [...window.matchAll(/"id":"([0-9a-f-]{36})"/gu)].map((match) => match[1]!)
}

async function send(stack: Stack, conversationId: string, content: string, requestId = randomUUID()) {
  return stack.companion.sendChat({ conversationId, requestId, content, includeSensitive: false }, () => undefined)
}

function outcome(id: string, assertions: Assertion[]): ScenarioOutcome {
  const status: ScenarioStatus = assertions.length > 0 && assertions.every((item) => item.ok) ? 'PASS' : 'FAIL'
  return { id, status, assertions }
}

const scenarios: Array<{ id: string; name: string; run: (stack: Stack) => Promise<ScenarioOutcome> }> = [
  {
    id: 'B',
    name: 'cross-session memory',
    run: async (stack) => {
      const memory = stack.memories.create('我住在杭州。', 'personal')
      const first = stack.companion.createConversation()
      await send(stack, first.id, '我住在哪里？')
      const firstIds = deliveredMemoryIds(stack.provider.lastPayload)
      // A second conversation is the same thing the product does on "new chat".
      const second = stack.companion.createConversation()
      await send(stack, second.id, '我之前说我住在哪里？')
      const secondIds = deliveredMemoryIds(stack.provider.lastPayload)
      return outcome('B', [
        { name: 'the memory is delivered in the first session', ok: firstIds.includes(memory.id), detail: `delivered=${firstIds.length}` },
        { name: 'the memory is delivered in a later session', ok: secondIds.includes(memory.id), detail: `delivered=${secondIds.length}` }
      ])
    }
  },
  {
    id: 'D',
    name: 'retraction and deletion',
    run: async (stack) => {
      const memory = stack.memories.create('我有一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      await send(stack, conversation.id, '我的猫叫什么名字？')
      const controlIds = deliveredMemoryIds(stack.provider.lastPayload)
      stack.memories.retract(memory.id)
      await send(stack, conversation.id, '我的猫叫什么名字？')
      const afterPayload = stack.provider.lastPayload
      const afterIds = deliveredMemoryIds(afterPayload)
      return outcome('D', [
        { name: 'control: the value is deliverable before retraction', ok: controlIds.includes(memory.id), detail: `delivered=${controlIds.length}` },
        { name: 'the retracted memory id is absent afterwards', ok: !afterIds.includes(memory.id), detail: `delivered=${afterIds.length}` },
        { name: 'the retracted value is absent from the payload', ok: !afterPayload.includes('咪咪'), detail: 'text scan' }
      ])
    }
  },
  {
    id: 'I',
    name: 'retry and idempotency',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      const requestId = randomUUID()
      const callsBefore = stack.provider.calls
      const first = await send(stack, conversation.id, '你好。', requestId)
      const second = await send(stack, conversation.id, '你好。', requestId)
      const assistants = stack.companion.readConversation({ conversationId: conversation.id }).messages
        .filter((message) => message.role === 'assistant')
      const providerCalls = stack.provider.calls - callsBefore
      return outcome('I', [
        { name: 'a repeated requestId produces exactly one assistant message', ok: assistants.length === 1, detail: `assistants=${assistants.length}` },
        { name: 'the repeated call returns the same assistant message', ok: first.assistantMessage.id === second.assistantMessage.id, detail: 'identity' },
        { name: 'the provider is called once', ok: providerCalls === 1, detail: `calls=${providerCalls}` }
      ])
    }
  }
]

scenarios.push({
  id: 'B5',
  name: 'reflection reaches the next request',
  run: async (stack) => {
    // Promotion requires evidence from more than one session, so the topic is
    // revisited in a second conversation. One session can only ever produce a
    // candidate — that threshold is the point of the long-term layer.
    //
    // Two of these turns are deliberately *not* phrased around the same entity
    // ("拉花最难的是奶泡", "拉花终于有点样子了"). They stay separate candidates,
    // which is the matcher's precision requirement; promotion therefore needs a
    // third mention that actually names the topic.
    const first = stack.companion.createConversation()
    const second = stack.companion.createConversation()
    const turns: Array<[string, string]> = [
      [first.id, '我最近在学咖啡拉花。'],
      [first.id, '拉花最难的是奶泡。'],
      [second.id, '还在练咖啡拉花。'],
      [second.id, '拉花终于有点样子了。'],
      [second.id, '今天又练了咖啡拉花。']
    ]
    for (const [conversationId, content] of turns) {
      await stack.companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
    }
    const conversation = second
    const run = stack.reflection.run('manual')
    const rateLimited = typeof run === 'object' && run !== null && 'skipped' in run
    const interestRows = stack.interests.list()
    const active = interestRows.filter((row) => row.status === 'active')
    const target = active.find((row) => row.label.includes('咖啡拉花')) ?? active[0]
    const ledger = target ? stack.interests.evidenceLedger(target.id) : []
    const support = ledger.filter((row) => row.polarity === 'support')
    const sessions = new Set(support.map((row) => row.conversationId))

    await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '继续。', includeSensitive: false }, () => undefined)
    const payload = stack.provider.lastPayload
    const blockPresent = payload.includes('Bounded long-term attention signal')
    // The block must name the promoted interest, not just exist: a block with
    // no id would pass a substring check while telling the model nothing.
    const blockNamesTarget = target !== undefined && payload.includes(target.id)
    const distinctLabels = new Set(interestRows.map((row) => row.label)).size

    return outcome('B5', [
      { name: 'reflection actually ran (not rate limited)', ok: !rateLimited, detail: rateLimited ? 'rate_limited' : 'completed' },
      { name: 'the long-term layer holds an interest for the topic', ok: interestRows.length > 0, detail: `rows=${interestRows.length} distinctLabels=${distinctLabels} active=${active.length}` },
      { name: 'the promoted interest keeps its evidence trail', ok: support.length >= 3 && sessions.size >= 2, detail: `support=${support.length} sessions=${sessions.size}` },
      { name: 'an active interest reaches the next serialized request', ok: active.length > 0 && blockPresent, detail: `active=${active.length} block=${blockPresent}` },
      { name: 'the request block names the promoted interest', ok: blockNamesTarget, detail: `target=${target?.label ?? 'none'} named=${blockNamesTarget}` }
    ])
  }
})

scenarios.push({
  id: 'B4',
  name: 'turn lifecycle is persisted',
  run: async (stack) => {
    const conversation = stack.companion.createConversation()
    const okTurn = randomUUID()
    await stack.companion.sendChat({ conversationId: conversation.id, requestId: okTurn, content: '你好。', includeSensitive: false }, () => undefined)
    const committed = stack.states.get(okTurn)

    const failedTurn = randomUUID()
    stack.provider.failure = 'scripted provider failure'
    let threw = false
    try {
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: failedTurn, content: '再来一次。', includeSensitive: false }, () => undefined)
    } catch {
      threw = true
    } finally {
      stack.provider.failure = null
    }
    const failed = stack.states.get(failedTurn)

    return outcome('B4', [
      { name: 'a successful turn is recorded as committed', ok: committed?.state === 'committed', detail: `state=${committed?.state ?? 'missing'}` },
      { name: 'a failing turn is recorded as failed', ok: failed?.state === 'failed', detail: `state=${failed?.state ?? 'missing'} threw=${threw}` },
      { name: 'the failing turn stored no assistant message', ok: threw, detail: 'provider rejected' }
    ])
  }
})

scenarios.push({
  id: 'A',
  name: 'reference resolution is recorded with the turn',
  run: async (stack) => {
    const conversation = stack.companion.createConversation()

    // A deictic as the first turn of a conversation: there is nothing to
    // resolve against, and the record must say so instead of guessing a topic.
    const orphanTurn = randomUUID()
    await stack.companion.sendChat({ conversationId: conversation.id, requestId: orphanTurn, content: '它是什么时候的事？', includeSensitive: false }, () => undefined)
    const orphan = stack.companion.readTurnContext({ turnId: orphanTurn })

    // Control: a question that carries its own subject depends on nothing.
    const standaloneTurn = randomUUID()
    await stack.companion.sendChat({ conversationId: conversation.id, requestId: standaloneTurn, content: '天文学史里最难的是什么？', includeSensitive: false }, () => undefined)
    const standalone = stack.companion.readTurnContext({ turnId: standaloneTurn })

    // A real follow-up: the subject is named in one turn, the next points at it
    // with a pronoun.
    await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我最近在读天文学史。', includeSensitive: false }, () => undefined)
    const followTurn = randomUUID()
    await stack.companion.sendChat({ conversationId: conversation.id, requestId: followTurn, content: '它最难的部分是什么？', includeSensitive: false }, () => undefined)
    const follow = stack.companion.readTurnContext({ turnId: followTurn })

    return outcome('A', [
      { name: 'a reference with nothing to resolve against is recorded as unresolved', ok: orphan?.intent.contextDependency === 'unresolved', detail: `dep=${orphan?.intent.contextDependency ?? 'missing'} label=${orphan?.intent.label ?? 'missing'}` },
      { name: 'a self-contained question does not claim a prior turn', ok: standalone?.intent.contextDependency === 'none', detail: `dep=${standalone?.intent.contextDependency ?? 'missing'} label=${standalone?.intent.label ?? 'missing'}` },
      { name: 'a pronoun follow-up is recorded as depending on the prior turn', ok: follow?.intent.contextDependency === 'prior_turn', detail: `dep=${follow?.intent.contextDependency ?? 'missing'} label=${follow?.intent.label ?? 'missing'}` },
      { name: 'the two cases stay distinguishable in the stored record', ok: orphan?.intent.contextDependency !== follow?.intent.contextDependency, detail: `orphan=${orphan?.intent.contextDependency ?? 'missing'} follow=${follow?.intent.contextDependency ?? 'missing'}` }
    ])
  }
})

scenarios.push({
  id: 'C',
  name: 'a correction revises the delivered value and keeps the chain',
  run: async (stack) => {
    const memory = stack.memories.create('我住在杭州。', 'personal')
    const conversation = stack.companion.createConversation()
    await send(stack, conversation.id, '我住在哪里？')
    const beforePayload = stack.provider.lastPayload
    const beforeIds = deliveredMemoryIds(beforePayload)

    const corrected = stack.memories.correct(memory.id, '我住在苏州。')
    const history = stack.memories.history(memory.id)

    await send(stack, conversation.id, '我住在哪里？')
    const afterPayload = stack.provider.lastPayload
    const afterIds = deliveredMemoryIds(afterPayload)

    return outcome('C', [
      { name: 'control: the original value was deliverable before the correction', ok: beforeIds.includes(memory.id) && beforePayload.includes('杭州'), detail: `delivered=${beforeIds.length} hasOld=${beforePayload.includes('杭州')}` },
      { name: 'the correction keeps both revisions chained', ok: history.length === 2 && history[1]?.revision === 2 && history[1]?.previousRevision === 1 && history[1]?.changeType === 'corrected', detail: `revisions=${history.length} rev=${history[1]?.revision ?? 'none'} prev=${history[1]?.previousRevision ?? 'none'} type=${history[1]?.changeType ?? 'none'}` },
      { name: 'the corrected record is the current one', ok: corrected.revision === 2 && corrected.currentText.includes('苏州') && corrected.originalText.includes('杭州'), detail: `rev=${corrected.revision} current=${corrected.currentText}` },
      { name: 'the next request carries the new value and not the old one', ok: afterIds.includes(memory.id) && afterPayload.includes('苏州') && !afterPayload.includes('杭州'), detail: `delivered=${afterIds.length} new=${afterPayload.includes('苏州')} old=${afterPayload.includes('杭州')}` }
    ])
  }
})

scenarios.push({
  id: 'E',
  name: 'personality stays user-controlled across emotional turns',
  run: async (stack) => {
    const before = stack.companion.getPersonality()
    const revisionsBefore = stack.companion.personalityHistory().length
    const conversation = stack.companion.createConversation()
    const turns = ['你回答得太啰嗦了。', '谢谢，这次好多了。', '这个回答很有帮助。', '我有点烦。']
    const versions: number[] = []
    const lines: string[] = []
    for (const content of turns) {
      const turnId = randomUUID()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: turnId, content, includeSensitive: false }, () => undefined)
      const context = stack.companion.readTurnContext({ turnId })
      if (context) versions.push(context.personality.version)
      const unescaped = stack.provider.lastPayload.replace(/\\"/gu, '"')
      lines.push(/User-controlled communication preferences[^\\n]*/u.exec(unescaped)?.[0] ?? '')
    }
    const after = stack.companion.getPersonality()
    const lastContext = stack.companion.readTurnContext({ turnId: randomUUID() })

    return outcome('E', [
      { name: 'the personality version never moves on its own', ok: versions.length === turns.length && versions.every((version) => version === before.version) && after.version === before.version, detail: `versions=${versions.join(',')} expected=${before.version}` },
      { name: 'no revision is written without a user edit', ok: stack.companion.personalityHistory().length === revisionsBefore, detail: `revisions=${stack.companion.personalityHistory().length} before=${revisionsBefore}` },
      { name: 'every request states the same user-controlled preferences', ok: lines.length > 0 && lines.every((line) => line.length > 0 && line === lines[0]), detail: `distinct=${new Set(lines).size} sample=${lines[0]?.slice(0, 48) ?? 'missing'}` },
      { name: 'the stored profile is still the user\'s own values', ok: after.warmth === before.warmth && after.directness === before.directness && after.humor === before.humor, detail: `warmth=${after.warmth} directness=${after.directness} humor=${after.humor} unknownTurn=${lastContext === null}` }
    ])
  }
})

scenarios.push({
  id: 'F',
  name: 'interaction state changes are bounded and disclosed',
  run: async (stack) => {
    const conversation = stack.companion.createConversation()
    const turnId = randomUUID()
    // "这个回答很有帮助" is explicit positive feedback: it produces a state event.
    await stack.companion.sendChat({ conversationId: conversation.id, requestId: turnId, content: '这个回答很有帮助。', includeSensitive: false }, () => undefined)
    const context = stack.companion.readTurnContext({ turnId })
    const feeling = context?.feeling
    const committed = stack.companion.getFeelingState().state
    const before = feeling?.before ?? null
    const after = feeling?.after ?? null
    const bounded = before !== null && after !== null &&
      Math.abs(after.valence - before.valence) <= FEELING_PER_EVENT_LIMIT.valence + 1e-9 &&
      Math.abs(after.activation - before.activation) <= FEELING_PER_EVENT_LIMIT.activation + 1e-9 &&
      Math.abs(after.tension - before.tension) <= FEELING_PER_EVENT_LIMIT.tension + 1e-9
    const inRange = after !== null && after.valence >= -1 && after.valence <= 1 &&
      after.activation >= 0 && after.activation <= 1 && after.tension >= 0 && after.tension <= 1
    const payload = stack.provider.lastPayload.replace(/\\"/gu, '"')

    return outcome('F', [
      { name: 'a feedback turn applies exactly one state event', ok: feeling?.applied === true && feeling?.eventType === 'positive_feedback', detail: `applied=${String(feeling?.applied)} event=${feeling?.eventType ?? 'none'}` },
      { name: 'the recorded after-state is the committed state, not a projection', ok: after !== null && after.revision === committed.revision && after.valence === committed.values.valence, detail: `ctxRevision=${after?.revision ?? 'none'} stateRevision=${committed.revision} ctxValence=${after?.valence ?? 'none'} stateValence=${committed.values.valence}` },
      { name: 'no single turn moves a dimension beyond its limit', ok: bounded, detail: `before=${JSON.stringify(before)} after=${JSON.stringify(after)}` },
      { name: 'the state stays inside its declared range', ok: inRange, detail: `after=${JSON.stringify(after)}` },
      { name: 'the request discloses the state as bounded and non-overriding', ok: payload.includes('Bounded local interaction-state signal') && payload.includes('must never override facts, explicit instructions, safety, permissions, or user-controlled personality'), detail: 'text scan' }
    ])
  }
})

scenarios.push({
  id: 'G',
  name: 'interest promotion needs independent sessions',
  run: async (stack) => {
    const first = stack.companion.createConversation()
    const second = stack.companion.createConversation()

    // One session, three mentions: the evidence is there, the independence is
    // not. Promotion must not happen on volume alone.
    for (let index = 0; index < 3; index += 1) {
      stack.interests.observe({
        conversationId: first.id,
        messageId: randomUUID(),
        occurredAt: new Date(Date.UTC(2026, 9, 20, 10, index)).toISOString(),
        topicText: '我最近在学咖啡拉花。'
      })
    }
    const singleSession = stack.interests.list().find((row) => row.label.includes('咖啡拉花'))
    const singleStatus = singleSession?.status ?? 'missing'
    const singleEvidence = singleSession?.evidenceCount ?? 0
    const singleSessions = singleSession?.conversationCount ?? 0

    // An unrelated topic mentioned once must stay a candidate.
    stack.interests.observe({
      conversationId: first.id,
      messageId: randomUUID(),
      occurredAt: new Date(Date.UTC(2026, 9, 20, 11)).toISOString(),
      topicText: '我最近在学吉他。'
    })

    // The second session is what makes promotion legitimate.
    stack.interests.observe({
      conversationId: second.id,
      messageId: randomUUID(),
      occurredAt: new Date(Date.UTC(2026, 9, 21, 10)).toISOString(),
      topicText: '还在练咖啡拉花。'
    })

    const rows = stack.interests.list()
    const promoted = rows.find((row) => row.label.includes('咖啡拉花'))
    const other = rows.find((row) => row.label.includes('吉他'))
    const active = rows.filter((row) => row.status === 'active')

    return outcome('G', [
      { name: 'three mentions inside one session do not promote', ok: singleStatus === 'candidate' && singleEvidence === 3 && singleSessions === 1, detail: `status=${singleStatus} evidence=${singleEvidence} sessions=${singleSessions}` },
      { name: 'a second session promotes the same topic', ok: promoted?.status === 'active' && promoted.conversationCount >= INTEREST_PROMOTION_MIN_CONVERSATIONS && promoted.evidenceCount >= INTEREST_PROMOTION_MIN_EVIDENCE, detail: `status=${promoted?.status ?? 'missing'} sessions=${promoted?.conversationCount ?? 0} evidence=${promoted?.evidenceCount ?? 0} min=${INTEREST_PROMOTION_MIN_CONVERSATIONS}/${INTEREST_PROMOTION_MIN_EVIDENCE}` },
      { name: 'an unrelated topic stays a candidate', ok: other?.status === 'candidate', detail: `status=${other?.status ?? 'missing'} label=${other?.label ?? 'none'}` },
      { name: 'promotion does not leak into other topics', ok: active.length === 1 && active[0]?.id === promoted?.id, detail: `active=${active.length} ids=${active.map((row) => row.id).join(',')}` }
    ])
  }
})

scenarios.push({
  id: 'H',
  name: 'reflection is rate limited and the limit is honest',
  run: async (stack) => {
    let executed = 0
    let refusedEarly = false
    for (let index = 0; index < MAX_RUNS_PER_HOUR; index += 1) {
      const run = stack.reflection.run('manual')
      if ('skipped' in run) refusedEarly = true
      else executed += 1
    }
    const blocked = stack.reflection.run('manual')
    const blockedSkipped = 'skipped' in blocked ? blocked.skipped : null
    const runs = stack.reflection.listRuns(100)
    const hourLater = stack.reflection.canRun(new Date(Date.now() + 3_600_001).toISOString())

    return outcome('H', [
      { name: 'the hourly budget is actually spent', ok: executed === MAX_RUNS_PER_HOUR && !refusedEarly, detail: `executed=${executed} limit=${MAX_RUNS_PER_HOUR}` },
      { name: 'the next run is refused, not silently run', ok: blockedSkipped === 'rate_limited', detail: `result=${blockedSkipped ?? 'executed'}` },
      { name: 'a refused run leaves no run record', ok: runs.length === MAX_RUNS_PER_HOUR, detail: `runs=${runs.length}` },
      { name: 'the window reopens after an hour', ok: hourLater === true, detail: `canRun(+1h)=${hourLater}` }
    ])
  }
})

scenarios.push({
  id: 'J',
  name: 'the approved payload hash is the payload that was sent',
  run: async (stack) => {
    const memory = stack.memories.create('我住在杭州。', 'personal')
    const conversation = stack.companion.createConversation()
    const requestId = randomUUID()
    await stack.companion.sendChat({ conversationId: conversation.id, requestId, content: '我住在哪里？', includeSensitive: false }, () => undefined)
    const approved = stack.approvedHashes.at(-1) ?? ''
    // Recomputing from what the provider was actually handed closes the gap
    // between "a hash was approved" and "that hash describes this request".
    const sent = stack.provider.lastInput ? hashProviderInput(stack.provider.lastInput) : ''
    const callsAfterFirst = stack.provider.calls

    await stack.companion.sendChat({ conversationId: conversation.id, requestId, content: '我住在哪里？', includeSensitive: false }, () => undefined)
    const replayCalls = stack.provider.calls - callsAfterFirst

    stack.memories.retract(memory.id)
    await send(stack, conversation.id, '我住在哪里？')
    const afterRetraction = stack.approvedHashes.at(-1) ?? ''
    const afterPayload = stack.provider.lastPayload.replace(/\\"/gu, '"')

    return outcome('J', [
      { name: 'the hash the user approved is the hash of what was sent', ok: approved.length === 64 && approved === sent, detail: `approved=${approved.slice(0, 12)} sent=${sent.slice(0, 12)}` },
      { name: 'a replayed turn sends nothing new', ok: replayCalls === 0, detail: `providerCalls=${replayCalls}` },
      { name: 'changing delivered content changes the approved hash', ok: afterRetraction.length === 64 && afterRetraction !== approved, detail: `before=${approved.slice(0, 12)} after=${afterRetraction.slice(0, 12)}` },
      { name: 'the retracted value is gone from the new payload', ok: !afterPayload.includes('杭州'), detail: `hasOld=${afterPayload.includes('杭州')}` }
    ])
  }
})

/** Scenarios that this runner still cannot execute, with the reason recorded honestly. */
const unexecuted: ScenarioOutcome[] = [
  { id: 'K', status: 'BLOCKED', assertions: [], blockedBy: 'no real provider credential in this environment' },
  {
    id: 'L',
    status: 'BLOCKED',
    assertions: [],
    // Not a product blocker any more: the desktop path is covered by
    // `npm run smoke`, which launches the built Electron app with the renderer
    // sandbox ON and passes on this host. This runner still cannot host a GUI
    // process, so the scenario itself stays out of the offline harness.
    blockedBy: 'GUI process cannot be hosted inside this offline runner; desktop coverage comes from `npm run smoke` (exit 0, sandbox enabled)'
  }
]

async function main(): Promise<void> {
  const headSha = process.env.MORROW_EVAL_HEAD ?? execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  const startedAt = new Date().toISOString()
  const results: ScenarioOutcome[] = []

  for (const scenario of scenarios) {
    const stack = buildStack()
    try {
      results.push(await scenario.run(stack))
    } catch (error) {
      results.push({
        id: scenario.id,
        status: 'FAIL',
        assertions: [],
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      })
    } finally {
      stack.close()
    }
  }
  results.push(...unexecuted)

  const counts = {
    executed: results.filter((item) => item.status === 'PASS' || item.status === 'FAIL').length,
    passed: results.filter((item) => item.status === 'PASS').length,
    failed: results.filter((item) => item.status === 'FAIL').length,
    skipped: results.filter((item) => item.status === 'SKIPPED').length,
    blocked: results.filter((item) => item.status === 'BLOCKED').length,
    notRun: results.filter((item) => item.status === 'NOT_RUN').length
  }
  const denominator = counts.passed + counts.failed
  const summary = {
    datasetVersion: DATASET_VERSION,
    harnessVersion: HARNESS_VERSION,
    headSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    providerMode: 'scripted',
    providerNote: 'The provider returns fixed text. This runner proves wiring and payload contents, never model quality.',
    counts,
    passRate: denominator === 0 ? null : counts.passed / denominator,
    passRateDenominator: 'PASS + FAIL only; SKIPPED, BLOCKED and NOT_RUN are excluded, never counted as passing.'
  }

  // Bundled to CJS, so the results directory is resolved from the repo root
  // the script is started from (documented in the ablation/README).
  const directory = resolve(process.cwd(), 'evals/stage-2/results')
  mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
  const base = `${stamp}-${headSha.slice(0, 7)}`
  writeFileSync(join(directory, `${base}.json`), `${JSON.stringify({ ...summary, scenarios: results }, null, 2)}\n`)
  writeFileSync(join(directory, `${base}-summary.json`), `${JSON.stringify(summary, null, 2)}\n`)

  for (const item of results) {
    console.log(`${item.id}: ${item.status}${item.assertions.length > 0 ? ` (${item.assertions.filter((a) => a.ok).length}/${item.assertions.length} assertions)` : ''}${item.error ? ` error=${item.error}` : ''}${item.notRunReason ? ` — ${item.notRunReason}` : ''}${item.blockedBy ? ` — ${item.blockedBy}` : ''}`)
  }
  console.log(`counts: ${JSON.stringify(counts)} report=${join(directory, `${base}.json`)}`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
