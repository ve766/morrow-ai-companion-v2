/**
 * The only path a credential takes into a real-model run.
 *
 * Two runners need it — the Stage 3 live evaluation and the C1 semantic suite —
 * and the contract (`docs/testing/shared-real-model-test-contract.md`) requires
 * that there be exactly one. A second copy would not fail loudly: the runner
 * that kept a file fallback would quietly pass with a credential the other
 * runner refuses, and the difference would show up as two contradictory
 * verdicts on the same commit.
 *
 * Rules encoded here, not just documented:
 *
 *   - the key is read from `MORROW_TEST_API_KEY` and nowhere else;
 *   - a missing key is `BLOCKED_NO_SECRET`, a first-class result — never a
 *     crash, and never a scripted provider wearing a real-model label;
 *   - nothing is written unless the key and any key-shaped string are absent
 *     from the artefact.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { SqliteDatabase } from '../../../src/persistence/database'
import { MemoryService } from '../../../src/memory/memory-service'
import { FactMemoryService } from '../../../src/memory/fact-memory'
import { RelationshipThreadService } from '../../../src/relationship/relationship-threads'
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
import { IntentReadingRepository } from '../../../src/persistence/intent-reading-repository'
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
import {
  DEEPSEEK_MODEL,
  DEEPSEEK_PROVIDER_ID,
  SPARK_MAAS_BASE_URL,
  SPARK_PROVIDER_ID
} from '../../../src/shared/companion'
import type { ProviderConfigRecord, ProviderId } from '../../../src/shared/companion'
import { MemorySecretStore } from '../../../src/security/secrets'
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible'
import type { ProviderInput, ProviderOutput, ProviderPort } from '../../../src/providers/provider-policy'

/**
 * Shared real-model contract defaults.
 *
 * The runner refuses to start if the product's own endpoint differs from the
 * contract URL, because a test that talks to a different endpoint than the
 * product does is not evidence about the product.
 */
export const CONTRACT = Object.freeze({
  model: 'spark-x2.6',
  chatCompletionsUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions',
  responsesUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v1/responses',
  anthropicMessagesUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/anthropic/v1/messages',
  apiKeyEnv: 'MORROW_TEST_API_KEY'
})

export type LiveProvider = 'deepseek' | 'spark'

export interface ProviderTarget {
  /** Typed as `ProviderId`, not `string`: a misspelt id must fail to compile. */
  id: ProviderId
  model: string
  label: LiveProvider
}

/**
 * Which provider this run targets.
 *
 * `spark` exists because the product ships two remote providers and only one of
 * them is OpenAI's shape by name; an evaluation that can only drive DeepSeek
 * would silently skip the other one.
 */
export function selectProvider(): ProviderTarget {
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
 * There is deliberately no file fallback: a test that can silently pick up a key
 * from a path is a test that can run with the wrong credential, and the contract
 * exists to make exactly one path possible. Anything that needs to keep the key
 * in a file must read the file into the environment at the call site, where the
 * indirection is visible in the command the reviewer runs.
 */
export function readKeyOrNull(): string | null {
  const fromEnv = process.env[CONTRACT.apiKeyEnv]
  if (!fromEnv) return null
  const key = fromEnv.trim()
  return key.length >= 16 ? key : null
}

/**
 * The endpoint the run will actually call.
 *
 * The check is an equality, not a prefix test: the contract URL is a complete
 * endpoint, and a runner that accepted `.../v2/chat/completions-other` would be
 * measuring an endpoint the product never uses.
 */
export function resolveContractUrl(target: ProviderTarget): string {
  const contractUrl = process.env.MORROW_TEST_CHAT_COMPLETIONS_URL ?? CONTRACT.chatCompletionsUrl
  const productUrl = `${SPARK_MAAS_BASE_URL}/chat/completions`
  if (target.label === 'spark' && contractUrl !== productUrl) {
    throw new Error(`The product endpoint ${productUrl} differs from the contract endpoint ${contractUrl}.`)
  }
  return contractUrl
}

/** The commit the evidence is about. A result file that cannot name it is not evidence. */
export function commitOrUnknown(): string {
  const override = process.env.MORROW_EVAL_SHA
  if (override) return override
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * Whether the tree the run actually read was modified.
 *
 * A result that names a commit but was produced from a modified working tree
 * names code that never existed. Recording the flag lets a reviewer discount
 * the run; `unknown` is kept separate from `clean` because a failed `git` call
 * is not evidence of a clean tree.
 */
export function workingTreeDirty(): 'clean' | 'dirty' | 'unknown' {
  try {
    return execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0
      ? 'dirty'
      : 'clean'
  } catch {
    return 'unknown'
  }
}

/**
 * Refuses to write an artefact that contains the credential.
 *
 * Two separate checks on purpose: the literal key catches a leak of this run's
 * secret, and the shape pattern catches a key that arrived from somewhere else
 * (a logged header, a copied trace). Throwing before the write is the point —
 * a warning after the write has already published the file.
 */
export function assertNoSecret(serialized: string, key: string): void {
  if (serialized.includes(key)) throw new Error('Refusing to write: the credential leaked into the result payload.')
  // The left boundary is load-bearing. Without it this matched `sk-dependency-
  // register`, i.e. the middle of the file name `risk-dependency-register.md`,
  // so any result that cited that path would have aborted the write with a
  // "credential leaked" error. A false alarm here is not harmless: the person
  // seeing it is one edit away from widening the pattern. A real token is
  // preceded by `"`, `=`, a space or a colon; a substring of an identifier is
  // preceded by a word character, which is what the lookbehind excludes.
  if (/(?<![A-Za-z0-9_-])(?:sk|ak)-[A-Za-z0-9_-]{16,}/u.test(serialized)) {
    throw new Error('Refusing to write: a key-shaped string is present in the result payload.')
  }
}

export interface BlockedInput {
  suite: 'live' | 'semantic'
  datasetVersion: string
  harnessVersion: string
  paramsVersion: string
  provider: ProviderTarget
  startedAt: string
  /** Directory to write into. Absolute, or relative to the working directory. */
  outDir: string
  /**
   * Appended to the file name, e.g. `-semantic`.
   *
   * Both suites write into `evals/real-provider/results/`. A directory where
   * two different claims share one file-name pattern and differ only in an
   * internal field is how a scripted result gets quoted as a real-model one;
   * the suffix keeps the distinction visible in `ls`.
   */
  filenameSuffix?: string
  /** Extra fields a suite wants in its blocked record. */
  extra?: Record<string, unknown>
}

/**
 * `BLOCKED_NO_SECRET` is a first-class result, not a crash.
 *
 * The contract says a missing secret must be recorded as blocked, never faked
 * with a scripted provider. The record names the variable that was missing and
 * the endpoint that would have been called, so a reviewer can tell "the suite
 * was not run" from "the suite ran and failed".
 */
export function writeBlockedNoSecret(input: BlockedInput): { file: string; status: 'BLOCKED_NO_SECRET' } {
  const stamp = input.startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const outDir = resolve(process.cwd(), input.outDir)
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `${stamp}-${commitOrUnknown().slice(0, 7)}${input.filenameSuffix ?? ''}.json`)
  writeFileSync(file, `${JSON.stringify({
    status: 'BLOCKED_NO_SECRET',
    suite: input.suite,
    reason: `Environment variable ${CONTRACT.apiKeyEnv} is not set.`,
    datasetVersion: input.datasetVersion,
    harnessVersion: input.harnessVersion,
    paramsVersion: input.paramsVersion,
    codeCommit: commitOrUnknown(),
    provider: input.provider.label,
    providerModelId: input.provider.model,
    expectedEndpoint: CONTRACT.chatCompletionsUrl,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
    ...(input.extra ?? {})
  }, null, 2)}\n`)
  return { file, status: 'BLOCKED_NO_SECRET' }
}

export interface ProviderStack {
  companion: CompanionService
  database: SqliteDatabase
  events: EventLogService
  memories: MemoryService
  /** Stage 4-A: the fact ledger, read back after the story turns. */
  factMemory: FactMemoryService
  relationships: RelationshipThreadService
  interests: InterestService
  reflection: ReflectionService
  goals: CompanionGoalService
  interaction: UserInteractionProfileService
  exploration: ExplorationService
  /**
   * C1 intent readings, read back after the turn.
   *
   * `continuity.readings` is optional in `CompanionService`, and when it is
   * absent the reading is computed and then dropped: `if (verified.reading &&
   * this.continuity?.readings)`. A stack built without it can therefore never
   * show what the model understood — the evidence would be missing, not empty,
   * and "no reading" would look like "did not understand".
   */
  readings: IntentReadingRepository
  /** The serialized request of the most recent turn. */
  lastPayload: () => string
  close: () => void
}

export interface ProviderStackOptions {
  /**
   * Test seam. Real-model runs must not set this: substituting the provider is
   * exactly how a scripted response gets mislabelled as a real-model pass.
   */
  factory?: (config: ProviderConfigRecord) => ProviderPort
  /**
   * D-3 remediation: real-model runners pass the contract credential here so
   * the companion actually has a configured provider. Without it the first
   * turn dies with PROVIDER_UNCONFIGURED — which is what the semantic runner
   * silently did on its first live exercise.
   */
  credentials?: { providerId: import('../../../src/shared/companion').ProviderId; model: string; apiKey: string }
}

/**
 * The production composition, wired to whatever provider the caller configured.
 *
 * The adapter is constructed here rather than fetched from `companion.providers`:
 * the config service is built with this very factory, so asking it for an
 * adapter calls back into this function and recurses until the stack dies.
 *
 * The wrapper only observes the serialized request; every byte of the call goes
 * to the real implementation.
 */
export function buildProviderStack(options: ProviderStackOptions = {}): ProviderStack {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-live-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const eventLog = new EventLogService(database)
  const importance = new MemoryImportanceService(database)
  const factMemory = new FactMemoryService({ database })
  const relationships = new RelationshipThreadService({ database })
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, eventLog, { importance, factIndex: factMemory })
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

  let observedPayload = ''
  const secrets = new MemorySecretStore()
  const readings = new IntentReadingRepository(database)

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
    providerFactory: options.factory ?? ((config): ProviderPort => {
      const real = new OpenAICompatibleProvider(config, secrets)
      return {
        profile: real.profile,
        generate: async (input: ProviderInput, onDelta?: (delta: string) => void): Promise<ProviderOutput> => {
          observedPayload = JSON.stringify(input.requestPayload)
          return real.generate(input, onDelta)
        }
      }
    }),
    selfModelLoop: { events: eventLog, interests, selfModel, reflection, personalization, growth, interaction, exploration, goals, memories, relationships },
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database),
      states: new SqliteTurnStateRepository(database),
      readings
    }
  })
  companion.saveCognitiveSettings({ enabled: true })
  if (options.credentials) {
    companion.saveProvider({ providerId: options.credentials.providerId, model: options.credentials.model, enabled: true, apiKey: options.credentials.apiKey })
  }

  return {
    companion,
    factMemory,
    relationships,
    database,
    events: eventLog,
    memories,
    interests,
    reflection,
    goals,
    interaction,
    exploration,
    readings,
    lastPayload: () => observedPayload,
    close: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  }
}

export function systemText(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { messages?: Array<{ role: string; content: string }> }
    return parsed.messages?.find((message) => message.role === 'system')?.content ?? ''
  } catch {
    return ''
  }
}

/** A short stable id for a payload, so traces can be compared without storing them. */
export function payloadDigest(payload: string): string {
  return createHash('sha256').update(payload).digest('hex')
}
