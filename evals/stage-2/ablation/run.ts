/**
 * Stage 2 ablation runner.
 *
 * One question: does a module actually change what reaches the model, or is it
 * only present in the code? Each arm runs the same scripted conversation with
 * one module switched off and compares the **serialized provider payloads** —
 * not return values, not internal flags.
 *
 * Arms implemented here:
 *   full                 everything on
 *   no_personalization   B2 switched off (no PersonalizationService injected)
 *   no_context_utility   B3 switched off (`useContextUtility: false` on the
 *                        assembler, so ordering falls back to relevance only)
 *   no_reflection        reflection not injected into the self-model loop
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
import {
  SqlitePendingItemRepository,
  SqliteTurnContextRepository,
  SqliteTurnFinalizationRepository
} from '../../../src/persistence/cognitive-context-repository'
import { SqliteTurnStateRepository } from '../../../src/persistence/turn-state-repository'
import { PendingCognitionService } from '../../../src/cognition/pending-items'
import { InterestService, SqliteInterestRepository } from '../../../src/self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../../../src/self-model/self-model-service'
import { ReflectionService, SqliteReflectionRepository } from '../../../src/self-model/reflection-service'
import { EventLogService } from '../../../src/persistence/event-log'
import { PersonalizationService } from '../../../src/personalization/personalization-service'
import { MemorySecretStore } from '../../../src/security/secrets'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../../../src/shared/companion'
import type { ProviderInput, ProviderOutput, ProviderPort } from '../../../src/providers/provider-policy'

const HARNESS_VERSION = 'stage-2-ablation-v1'
const TURNS = ['我想规划一下下个月的学习计划。', '再帮我细化到每周。', '继续。', '顺便问一下，我住在哪里、生日是哪天？']

class ScriptedProvider implements ProviderPort {
  readonly profile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock' as const, configured: true }
  payloads: string[] = []
  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.payloads.push(JSON.stringify(input.requestPayload))
    return { text: '好的。', modelId: 'scripted-offline', attempts: 1 }
  }
}

interface ArmConfig {
  personalization: boolean
  contextUtility: boolean
  reflection: boolean
}

interface ArmResult {
  arm: string
  config: ArmConfig
  turns: number
  payloadBytes: number[]
  personalizationBlockTurns: number
  /**
   * Delivered memories per turn, as indices into the fixture list.
   *
   * Indices rather than ids: the comparison below only asks whether the order
   * changed, and an index is stable across the four arms where an id is not.
   * The type said `string[][]` long after the implementation stopped producing
   * strings — the runners were never type-checked, so nothing caught it.
   */
  memoryOrderByTurn: number[][]
  reflectionRuns: number
  attentionBlockTurns: number
  recordedPersonalization: Array<{ dimension: string; value: number; evidenceCount: number }>
}

function deliveredIds(payload: string): string[] {
  const unescaped = payload.replace(/\\"/gu, '"')
  const marker = unescaped.indexOf('"memories":[')
  if (marker < 0) return []
  return [...unescaped.slice(marker, marker + 8000).matchAll(/"id":"([0-9a-f-]{36})"/gu)].map((match) => match[1]!)
}

async function runArm(arm: string, config: ArmConfig): Promise<ArmResult> {
  const directory = mkdtempSync(join(tmpdir(), `morrow-ablation-${arm}-`))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const provider = new ScriptedProvider()
  const eventLog = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, undefined, {
    useContextUtility: config.contextUtility
  })
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const personalization = new PersonalizationService(database)
  const interests = new InterestService(new SqliteInterestRepository(database), eventLog)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), eventLog)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events: eventLog }, eventLog)
  let reflectionRuns = 0
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
      ...(config.personalization ? { personalization } : {}),
      // A real service, counted: the off arm omits the injection entirely, which
      // is the only honest way to switch reflection off.
      ...(config.reflection ? { reflection: { run: (trigger: Parameters<ReflectionService['run']>[0]) => { reflectionRuns += 1; return reflection.run(trigger) }, findings: (runId: string) => reflection.findings(runId) } } : {})
    },
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database),
      states: new SqliteTurnStateRepository(database)
    }
  })
  try {
    companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-placeholder-key' })
    companion.saveCognitiveSettings({ enabled: true })
    companion.savePersonality({ warmth: 60, directness: 50, humor: 20, disagreementStyle: 'gentle', systemRules: '' })
    // Creation order is the stable label across arms: ids are random per arm, so
    // comparing raw ids would "detect" a difference that is only new uuids.
    const fixtures = ['我住在杭州。', '我养了一只叫咪咪的猫。', '我住在苏州。', '我的生日是三月十二日。']
    const createdIds = fixtures.map((text) => memories.create(text, 'personal').id)
    const indexOfId = new Map(createdIds.map((id, index) => [id, index]))
    const conversation = companion.createConversation()
    for (const content of TURNS) {
      await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
    }
    return {
      arm,
      config,
      turns: provider.payloads.length,
      payloadBytes: provider.payloads.map((payload) => payload.length),
      personalizationBlockTurns: provider.payloads.filter((payload) => payload.includes('Bounded interaction preference state')).length,
      // Indices into the fixture list, in delivered order.
      memoryOrderByTurn: provider.payloads.map((payload) => deliveredIds(payload).map((id) => indexOfId.get(id)).filter((index): index is number => index !== undefined)),
      reflectionRuns,
      attentionBlockTurns: provider.payloads.filter((payload) => payload.includes('Bounded long-term attention signal')).length,
      recordedPersonalization: personalization.list().map((entry) => ({ dimension: entry.dimension, value: entry.value, evidenceCount: entry.evidenceCount }))
    }
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
}

async function main(): Promise<void> {
  const headSha = process.env.MORROW_EVAL_HEAD ?? execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  const startedAt = new Date().toISOString()
  const arms = [
    await runArm('full', { personalization: true, contextUtility: true, reflection: true }),
    await runArm('no_personalization', { personalization: false, contextUtility: true, reflection: true }),
    await runArm('no_context_utility', { personalization: true, contextUtility: false, reflection: true }),
    await runArm('no_reflection', { personalization: true, contextUtility: true, reflection: false })
  ]
  const [full, off, noUtility, noReflection] = arms as [ArmResult, ArmResult, ArmResult, ArmResult]
  const orderOf = (arm: ArmResult): string => JSON.stringify(arm.memoryOrderByTurn)

  const comparison = {
    personalizationBlockAppearsOnlyWhenEnabled:
      full.personalizationBlockTurns > 0 && off.personalizationBlockTurns === 0,
    fullBlockTurns: full.personalizationBlockTurns,
    offBlockTurns: off.personalizationBlockTurns,
    payloadBytesDelta: full.payloadBytes.map((bytes, index) => bytes - (off.payloadBytes[index] ?? bytes)),
    // B3: does turning the utility ranking off change what the model is shown?
    contextUtilityChangesMemoryOrder: orderOf(full) !== orderOf(noUtility),
    fullMemoryOrder: full.memoryOrderByTurn,
    noContextUtilityMemoryOrder: noUtility.memoryOrderByTurn,
    contextUtilityPayloadBytesDelta: full.payloadBytes.map((bytes, index) => bytes - (noUtility.payloadBytes[index] ?? bytes)),
    // B5: reflection runs vs not; the attention block is the payload-level signal.
    reflectionRunsFull: full.reflectionRuns,
    reflectionRunsOff: noReflection.reflectionRuns,
    attentionBlockTurnsFull: full.attentionBlockTurns,
    attentionBlockTurnsOff: noReflection.attentionBlockTurns
  }

  const notRun: Array<{ arm: string; status: string; reason: string }> = []

  const result = {
    harnessVersion: HARNESS_VERSION,
    headSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    providerMode: 'scripted',
    dataset: { turns: TURNS.length, memories: 2 },
    arms,
    comparison,
    notRun,
    limits: [
      'Scripted provider: this measures what is serialized, not reply quality.',
      'One conversation per arm, three turns: enough to detect a wiring difference, not a rate.',
      'B1 has no arm: the confidence score does not change the strategy, so there is nothing to switch off.',
    ]
  }

  const directory = resolve(process.cwd(), 'evals/stage-2/ablation/results')
  mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
  const path = join(directory, `${stamp}-${headSha.slice(0, 7)}.json`)
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`)

  console.log(`full: personalization block in ${full.personalizationBlockTurns}/${full.turns} payloads, bytes=${full.payloadBytes.join(',')}`)
  console.log(`no_personalization: block in ${off.personalizationBlockTurns}/${off.turns} payloads, bytes=${off.payloadBytes.join(',')}`)
  console.log(`wiring difference detected: ${comparison.personalizationBlockAppearsOnlyWhenEnabled}`)
  console.log(`report: ${path}`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
