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
 *
 * B3 and B5 arms are not implemented yet and are reported as NOT_RUN rather than
 * being approximated: B3 has no injectable switch and B5 needs a reflection
 * finding to survive the confirmation boundary, which this harness cannot fake
 * without turning the test into its own premise.
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
import { PersonalizationService } from '../../../src/personalization/personalization-service'
import { MemorySecretStore } from '../../../src/security/secrets'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../../../src/shared/companion'
import type { ProviderInput, ProviderOutput, ProviderPort } from '../../../src/providers/provider-policy'

const HARNESS_VERSION = 'stage-2-ablation-v1'
const TURNS = ['我想规划一下下个月的学习计划。', '再帮我细化到每周。', '继续。']

class ScriptedProvider implements ProviderPort {
  readonly profile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock' as const, configured: true }
  payloads: string[] = []
  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.payloads.push(JSON.stringify(input.requestPayload))
    return { text: '好的。', modelId: 'scripted-offline', attempts: 1 }
  }
}

interface ArmResult {
  arm: string
  personalizationEnabled: boolean
  turns: number
  payloadBytes: number[]
  personalizationBlockTurns: number
  memoryIdsFirstTurn: number
  recordedPersonalization: Array<{ dimension: string; value: number; evidenceCount: number }>
}

async function runArm(arm: string, personalizationEnabled: boolean): Promise<ArmResult> {
  const directory = mkdtempSync(join(tmpdir(), `morrow-ablation-${arm}-`))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const provider = new ScriptedProvider()
  const eventLog = { tryRecord: () => undefined } as never
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const personalization = new PersonalizationService(database)
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
      interests: new InterestService(new SqliteInterestRepository(database), eventLog),
      selfModel: new SelfModelService(new SqliteSelfModelRepository(database), eventLog),
      ...(personalizationEnabled ? { personalization } : {})
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
    memories.create('我住在杭州。', 'personal')
    memories.create('我养了一只叫咪咪的猫。', 'personal')
    const conversation = companion.createConversation()
    for (const content of TURNS) {
      await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
    }
    return {
      arm,
      personalizationEnabled,
      turns: provider.payloads.length,
      payloadBytes: provider.payloads.map((payload) => payload.length),
      personalizationBlockTurns: provider.payloads.filter((payload) => payload.includes('Bounded interaction preference state')).length,
      memoryIdsFirstTurn: (provider.payloads[0]?.match(/"memories":\[/gu) ?? []).length,
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
  const arms = [await runArm('full', true), await runArm('no_personalization', false)]
  const [full, off] = arms as [ArmResult, ArmResult]

  const comparison = {
    personalizationBlockAppearsOnlyWhenEnabled:
      full.personalizationBlockTurns > 0 && off.personalizationBlockTurns === 0,
    fullBlockTurns: full.personalizationBlockTurns,
    offBlockTurns: off.personalizationBlockTurns,
    payloadBytesDelta: full.payloadBytes.map((bytes, index) => bytes - (off.payloadBytes[index] ?? bytes))
  }

  const notRun = [
    { arm: 'no_context_utility', status: 'NOT_RUN', reason: 'B3 has no injectable switch; adding one would change the assembler signature in a batch that also touches ranking' },
    { arm: 'no_reflection', status: 'NOT_RUN', reason: 'B5 needs a reflection finding to cross the confirmation boundary; the harness cannot fabricate that without asserting its own premise' }
  ]

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
      'B1/B3/B5 arms are NOT_RUN and are not counted as evidence of anything.'
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
