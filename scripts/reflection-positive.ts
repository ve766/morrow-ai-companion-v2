/**
 * B5 — positive reflection fixture.
 *
 * The earlier ablation arm showed no difference between `full` and
 * `no_reflection`, and it was right to: its fixture never gave reflection
 * anything to observe. Reflection contributes interest evidence **from saved
 * memories**, while chat turns contribute it from messages. A fixture with only
 * chat turns therefore cannot cross the promotion threshold with reflection's help.
 *
 * This fixture arranges the counts so the difference is structural, not tuned:
 *
 *   2 memories on one topic  → 2 evidence rows, but all in one conversation
 *   1 chat turn on that topic → 1 more row, in a second conversation
 *
 * Without reflection: 1 evidence / 1 conversation → stays `candidate`.
 * With reflection:    3 evidence / 2 conversations → `active` → the next turn's
 *                     serialized request carries the attention block.
 *
 * It then retracts the memories and re-sends: the block must disappear, which is
 * the same evidence rule that P0-A installed.
 *
 * Run:
 *   node node_modules/esbuild/bin/esbuild scripts/reflection-positive.ts \
 *     --bundle --platform=node --format=cjs --external:electron \
 *     --outfile=node_modules/.cache/reflection-positive.cjs
 *   node node_modules/.cache/reflection-positive.cjs
 */
import { execSync } from 'node:child_process'
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
import {
  SqlitePendingItemRepository,
  SqliteTurnContextRepository,
  SqliteTurnFinalizationRepository
} from '../src/persistence/cognitive-context-repository'
import { PendingCognitionService } from '../src/cognition/pending-items'
import { SqliteTurnStateRepository } from '../src/persistence/turn-state-repository'
import { MemorySecretStore } from '../src/security/secrets'
import { EventLogService } from '../src/persistence/event-log'
import { InterestService, SqliteInterestRepository } from '../src/self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../src/self-model/self-model-service'
import { ReflectionService, SqliteReflectionRepository } from '../src/self-model/reflection-service'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../src/shared/companion'
import type { ProviderInput, ProviderOutput, ProviderPort } from '../src/providers/provider-policy'

const ATTENTION_BLOCK = 'Bounded long-term attention signal'
// Two turns on the same topic, both in the *same* conversation. Reflection can
// add at most one candidate interest per run, so the memory path contributes one
// evidence row; the second conversation is what the promotion rule still needs.
const TOPIC_TURNS = ['今天又练了咖啡拉花。', '还在练咖啡拉花。']
const PROBE_TURN = '继续。'

class CapturingProvider implements ProviderPort {
  readonly profile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock' as const, configured: true }
  payloads: string[] = []
  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.payloads.push(JSON.stringify(input.requestPayload))
    return { text: '好的。', modelId: 'scripted-offline', attempts: 1 }
  }
}

interface ArmResult {
  arm: string
  reflectionEnabled: boolean
  reflectionRuns: number
  interestStatusBefore: string | null
  interestStatusAfter: string | null
  interestStatusAfterRetraction: string | null
  interestEvidence: number
  interestConversations: number
  probePayloadHasAttentionBlock: boolean
  probePayloadMentionsInterestId: string | null
  afterRetractionHasAttentionBlock: boolean | null
  payloadBytes: number
}

async function runArm(arm: string, reflectionEnabled: boolean): Promise<ArmResult> {
  const directory = mkdtempSync(join(tmpdir(), `morrow-b5-${arm}-`))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  // The event log is the input reflection reads: without it `memories.create`
  // emits no `memory.created` event and reflection has nothing to observe.
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events }, events)
  const provider = new CapturingProvider()
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
      events,
      interests,
      selfModel,
      ...(reflectionEnabled
        ? {
            reflection: {
              run: (trigger: Parameters<ReflectionService['run']>[0]) => {
                reflectionRuns += 1
                return reflection.run(trigger)
              }
            }
          }
        : {})
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

    // Two memories on one topic: reflection's raw material.
    const first = memories.create('我在学咖啡拉花。', 'personal')
    memories.create('最近一直在练咖啡拉花。', 'personal')

    // Reflection runs *before* the first topic turn on purpose. Chat turns also
    // contribute interest evidence, so running reflection afterwards would find
    // the topic already known and skip it — the fixture would silently test
    // nothing. Here the memory evidence lands first and the message evidence
    // completes the threshold.
    if (reflectionEnabled) {
      reflectionRuns += 1
      reflection.run('manual')
    }

    // One chat turn on the same topic, in its own conversation: the second
    // conversation the promotion rule requires.
    const topicConversation = companion.createConversation()
    for (const content of TOPIC_TURNS) {
      await companion.sendChat({ conversationId: topicConversation.id, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
    }

    const record = interests.list()[0] ?? null
    const statusBefore = record?.status ?? null
    const evidence = record?.evidenceCount ?? 0
    const conversationCount = record?.conversationCount ?? 0
    const statusAfter = record?.status ?? null

    // Probe turn in a fresh conversation, so the payload can only carry the topic
    // through the long-term layer, not through conversation history.
    const probeConversation = companion.createConversation()
    await companion.sendChat({ conversationId: probeConversation.id, requestId: randomUUID(), content: PROBE_TURN, includeSensitive: false }, () => undefined)
    const probePayload = provider.payloads.at(-1) ?? ''

    let afterRetraction: boolean | null = null
    if (reflectionEnabled) {
      memories.retract(first.id)
      const secondRecord = memories.list().find((item) => item.id !== first.id)
      if (secondRecord) memories.retract(secondRecord.id)
      await companion.sendChat({ conversationId: probeConversation.id, requestId: randomUUID(), content: PROBE_TURN, includeSensitive: false }, () => undefined)
      afterRetraction = (provider.payloads.at(-1) ?? '').includes(ATTENTION_BLOCK)
    }

    const after = interests.list()[0] ?? null
    return {
      arm,
      reflectionEnabled,
      reflectionRuns,
      interestStatusBefore: statusBefore,
      interestStatusAfter: statusAfter,
      interestStatusAfterRetraction: after?.status ?? null,
      interestEvidence: evidence,
      interestConversations: conversationCount,
      probePayloadHasAttentionBlock: probePayload.includes(ATTENTION_BLOCK),
      probePayloadMentionsInterestId: after && probePayload.includes(after.id) ? after.id : null,
      afterRetractionHasAttentionBlock: afterRetraction,
      payloadBytes: probePayload.length
    }
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
}

async function main(): Promise<void> {
  const headSha = process.env.MORROW_EVAL_HEAD ?? execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  const startedAt = new Date().toISOString()
  const full = await runArm('full', true)
  const off = await runArm('no_reflection', false)

  // The four layers the report must separate, in order.
  const layers = {
    reflectionRan: { full: full.reflectionRuns > 0, no_reflection: off.reflectionRuns > 0 },
    candidateProduced: { full: full.interestStatusAfter !== null, no_reflection: off.interestStatusAfter !== null },
    gatePassed: { full: full.interestStatusAfter === 'active', no_reflection: off.interestStatusAfter === 'active' },
    payloadChanged: { full: full.probePayloadHasAttentionBlock, no_reflection: off.probePayloadHasAttentionBlock }
  }

  const summary = {
    kind: 'reflection_positive_ablation' as const,
    generatedAt: startedAt,
    headSha,
    harness: 'reflection-positive-v1',
    providerMode: 'scripted',
    fixture: {
      memories: ['我在学咖啡拉花。', '最近一直在练咖啡拉花。'],
      topicTurns: TOPIC_TURNS,
      probeTurn: PROBE_TURN,
      intent: '2 memory-backed evidence rows (1 conversation) + 1 message evidence (another conversation) = 3 / 2, which is exactly the promotion threshold; without reflection only 1 / 1 remains'
    },
    arms: [full, off],
    layers,
    comparison: {
      reflectionRunsDiffer: full.reflectionRuns !== off.reflectionRuns,
      promotionDiffers: full.interestStatusAfter !== off.interestStatusAfter,
      probePayloadDiffers: full.probePayloadHasAttentionBlock !== off.probePayloadHasAttentionBlock,
      payloadBytesDelta: full.payloadBytes - off.payloadBytes,
      retractionRemovesBlock: full.afterRetractionHasAttentionBlock === false,
      interestIdVisibleInFullPayload: full.probePayloadMentionsInterestId !== null
    },
    limits: [
      'Scripted provider: this measures what is serialized, not reply quality.',
      'One fixture: it shows the wiring exists and the gate is decisive, not a rate.',
      'The probe turn is sent in a fresh conversation, so the topic can only arrive through the long-term layer.'
    ]
  }

  const directory = join(process.cwd(), 'evals', 'stage-2', 'ablation', 'results')
  mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const path = join(directory, `${stamp}-${headSha.slice(0, 7)}-reflection-positive.json`)
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`)

  console.log(`full: runs=${full.reflectionRuns} status=${full.interestStatusAfter} evidence=${full.interestEvidence}/${full.interestConversations} block=${full.probePayloadHasAttentionBlock}`)
  console.log(`off : runs=${off.reflectionRuns} status=${off.interestStatusAfter} evidence=${off.interestEvidence}/${off.interestConversations} block=${off.probePayloadHasAttentionBlock}`)
  console.log(`block after retraction: ${full.afterRetractionHasAttentionBlock} (removed: ${full.afterRetractionHasAttentionBlock === false})`)
  console.log('report', path)
}

void main()
