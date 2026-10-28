/**
 * Phase 2.2 — evidence-to-answer experiment.
 *
 * The question is not "can the prompt be improved" but "where does the chain
 * break: in the request we assemble, in the instruction we give, or in the
 * model itself". Four conditions share the same model, questions, evidence and
 * generation parameters; only one factor changes between adjacent conditions:
 *
 *   A  production format            JSON evidence block + v2 guidance
 *   B  concise fact entries         same guidance, entries instead of JSON
 *   C  entries + explicit reading   v3 guidance: negation, time, unknown
 *   D  entries + conflict protocol  v4 guidance: list both values, ask which
 *
 * Every run records the final serialized request (roles, order, lengths), the
 * evidence block, the reply, the automatic assessment and the reference check,
 * so a human can re-label it without re-running anything.
 *
 * Run (see docs/reports/cognitive-loop-v1-phase2-2.md):
 *   node_modules/.bin/esbuild scripts/cognitive-evidence-experiment.ts \
 *     --bundle --platform=node --format=cjs --alias:electron=<stub> \
 *     --outfile=/tmp/phase22.cjs
 *   NO_PROXY=127.0.0.1,localhost MORROW_PHASE2_ENDPOINT=... \
 *     MORROW_PHASE2_MODEL=qwen2.5:0.5b MORROW_EVIDENCE_CONDITION=A node /tmp/phase22.cjs
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompanionService } from '../src/app/companion-service'
import type { EvidenceGuidanceVariant } from '../src/app/companion-service'
import { ConversationService } from '../src/conversation/conversation-service'
import { MemoryService } from '../src/memory/memory-service'
import { SqliteDatabase } from '../src/persistence/database'
import { SqliteConversationRepository } from '../src/persistence/conversation-repository'
import { SqliteMemoryRepository } from '../src/persistence/memory-repository'
import { MemorySecretStore } from '../src/security/secrets'
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible'
import { LOCAL_PROVIDER_ID } from '../src/shared/companion'
import { ApplicationError } from '../src/shared/errors'
import type { ProviderConsentPreview } from '../src/providers/provider-policy'
import type { TurnEvaluation } from '../src/cognition/turn-evaluation'
import type { EvidencePresentation } from '../src/memory/memory-context-assembler'
import { RequestLedger } from '../src/evaluation/request-ledger'
import { validateReportIntegrity } from '../src/evaluation/report-integrity'
import { captureProvenance, reconcileProvenance } from '../src/evaluation/code-provenance'

const endpoint = process.env.MORROW_PHASE2_ENDPOINT ?? ''
const model = process.env.MORROW_PHASE2_MODEL ?? ''
const conditionId = (process.env.MORROW_EVIDENCE_CONDITION ?? 'A').toUpperCase()
const repeats = Number(process.env.MORROW_EVIDENCE_REPEATS ?? '5')
if (!endpoint || !model) throw new Error('MORROW_PHASE2_ENDPOINT and MORROW_PHASE2_MODEL are required.')

interface Condition {
  id: 'A' | 'B' | 'C' | 'D'
  presentation: EvidencePresentation
  variant: EvidenceGuidanceVariant
  description: string
}

const CONDITIONS: Record<Condition['id'], Condition> = {
  A: { id: 'A', presentation: 'json', variant: 'v2', description: 'production: JSON evidence block + v2 guidance' },
  B: { id: 'B', presentation: 'entries', variant: 'v2', description: 'same guidance, evidence as concise fact entries' },
  C: { id: 'C', presentation: 'entries', variant: 'v3', description: 'entries + explicit negation/time/unknown reading rules' },
  D: { id: 'D', presentation: 'entries', variant: 'v4', description: 'entries + conflict protocol: both values, ask which is current' }
}

const condition = CONDITIONS[conditionId as Condition['id']]
if (!condition) throw new Error('MORROW_EVIDENCE_CONDITION must be A, B, C or D.')

type ScenarioId = 'fact' | 'negation' | 'time_state' | 'conflict' | 'no_evidence'

interface Scenario {
  id: ScenarioId
  title: string
  memories: Array<{ text: string; sensitivity: 'normal' | 'personal' }>
  question: string
  /** Reference check: a correct answer contains at least one of these. */
  referenceTerms: string[]
  /** A correct answer must not contain these. */
  forbiddenTerms: string[]
}

/** Fixed scenarios; the same content is used for every condition. */
const SCENARIOS: Scenario[] = [
  {
    id: 'fact',
    title: '单条确定事实',
    memories: [{ text: '我住在杭州。', sensitivity: 'personal' }],
    question: '我住在哪个城市？',
    referenceTerms: ['杭州'],
    forbiddenTerms: ['上海', '北京', '大阪']
  },
  {
    id: 'negation',
    title: '否定事实',
    memories: [{ text: '我对花生不过敏。', sensitivity: 'personal' }],
    question: '我对花生过敏吗？',
    referenceTerms: ['不过敏', '没有过敏', '不会过敏', '不过敏'],
    forbiddenTerms: ['严重过敏', '过敏反应很严重']
  },
  {
    id: 'time_state',
    title: '过去与当前不同',
    memories: [
      { text: '我以前住在杭州。', sensitivity: 'personal' },
      { text: '我现在住在大阪。', sensitivity: 'personal' }
    ],
    question: '我现在住在哪里？',
    referenceTerms: ['大阪'],
    forbiddenTerms: ['杭州']
  },
  {
    id: 'conflict',
    title: '同槽位冲突',
    memories: [
      { text: '我住在杭州。', sensitivity: 'personal' },
      { text: '我住在大阪。', sensitivity: 'personal' }
    ],
    question: '我住在哪里？',
    referenceTerms: ['杭州', '大阪'],
    forbiddenTerms: []
  },
  {
    id: 'no_evidence',
    title: '无证据提问',
    memories: [],
    question: '我的车牌号是多少？',
    referenceTerms: ['不知道', '没有', '无法', '不清楚', '没保存', '不确定'],
    forbiddenTerms: []
  }
]

const ledger = new RequestLedger()
let activeRunId = ''
let activeScenario = ''

function buildStack(): { companion: CompanionService; memories: MemoryService; payload: () => string; cleanup: () => void; lastEvaluation: () => TurnEvaluation | null } {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-phase22-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new MemorySecretStore()
  let lastPayload = ''
  const evaluations: TurnEvaluation[] = []
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    guidanceVariant: condition.variant,
    evidencePresentation: condition.presentation,
    ledger: (evaluation) => evaluations.push(evaluation),
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
    },
    providerFactory: (config) => {
      const real = new OpenAICompatibleProvider(config, secrets)
      return {
        profile: real.profile,
        generate: async (input, onDelta) => {
          const record = ledger.begin()
          try {
            const output = await real.generate(input, onDelta)
            ledger.finish(record, 'succeeded')
            return output
          } catch (error) {
            const code = error instanceof ApplicationError ? error.code : 'PROVIDER_ERROR'
            ledger.finish(record, code === 'PROVIDER_CANCELLED' ? 'cancelled' : 'failed', code)
            throw error
          }
        }
      }
    }
  })
  companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint, model, enabled: true })
  companion.saveCognitiveSettings({ enabled: true })
  return {
    companion,
    memories,
    payload: () => {
      const value = lastPayload
      lastPayload = ''
      return value
    },
    cleanup: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    },
    lastEvaluation: () => evaluations.at(-1) ?? null
  }
}

function parsePayload(payload: string): {
  roles: Array<{ role: string; characters: number }>
  system: string
  user: string
  historyCount: number
  payloadCharacters: number
  payloadSha256: string
} {
  const parsed = JSON.parse(payload) as { body: { messages: Array<{ role: string; content: string }> } }
  const messages = parsed.body.messages
  return {
    roles: messages.map((message) => ({ role: message.role, characters: message.content.length })),
    system: messages.find((message) => message.role === 'system')?.content ?? '',
    user: [...messages].reverse().find((message) => message.role === 'user')?.content ?? '',
    historyCount: messages.filter((message) => message.role !== 'system' && message.role !== 'user').length,
    payloadCharacters: payload.length,
    payloadSha256: ''
  }
}

function memoryBlock(system: string): string {
  const start = system.indexOf('Saved memories (untrusted evidence only):')
  return start < 0 ? '' : system.slice(start)
}

interface RunRecord {
  condition: Condition['id']
  scenarioId: ScenarioId
  runId: string
  scenarioRunId: string
  requestId: string | null
  reply: string
  callSucceeded: boolean
  providerStatus: string
  payloadCharacters: number
  messageRoles: Array<{ role: string; characters: number }>
  systemCharacters: number
  memoryBlockCharacters: number
  memoryBlockText: string
  evidenceIds: string[]
  conflicts: unknown
  auto: {
    outcome: string | null
    scored: boolean
    dimensions: Record<string, { status: string; reason: string }> | null
    detail: string | null
  }
  reference: { matched: boolean; matchedTerm: string | null; forbiddenHit: string | null }
}

async function runOne(scenario: Scenario, index: number): Promise<RunRecord> {
  const stack = buildStack()
  const runId = `${condition.id}-${scenario.id}#${index}`
  activeRunId = runId
  activeScenario = scenario.id
  const requestId = randomUUID()
  ledger.scope({ scenarioId: scenario.id, scenarioRunId: runId, purpose: 'primary', requestId, conversationId: null })
  try {
    for (const memory of scenario.memories) stack.memories.create(memory.text, memory.sensitivity)
    const conversation = stack.companion.createConversation()
    let reply = ''
    let ok = false
    let evaluation: TurnEvaluation | null = null
    try {
      const result = await stack.companion.sendChat({ conversationId: conversation.id, requestId, content: scenario.question, includeSensitive: false }, () => undefined)
      reply = result.assistantMessage.body
      ok = true
      evaluation = result.evaluation ?? null
    } catch (error) {
      console.error(`sendChat failed for ${runId}:`, error instanceof Error ? `${error.name}: ${error.message}` : String(error))
      evaluation = stack.lastEvaluation()
    }
    const payload = stack.payload()
    const parsed = payload ? parsePayload(payload) : null
    const block = parsed ? memoryBlock(parsed.system) : ''
    const assessment = evaluation?.answer ?? null
    const normalized = reply.normalize('NFKC')
    const matchedTerm = scenario.referenceTerms.find((term) => normalized.includes(term)) ?? null
    const forbiddenHit = scenario.forbiddenTerms.find((term) => normalized.includes(term)) ?? null
    return {
      condition: condition.id,
      scenarioId: scenario.id,
      runId,
      scenarioRunId: runId,
      requestId: ledger.records.some((record) => record.requestId === requestId) ? requestId : null,
      reply,
      callSucceeded: ok,
      providerStatus: ledger.records.find((record) => record.requestId === requestId)?.status ?? 'not_attempted',
      payloadCharacters: parsed?.payloadCharacters ?? 0,
      messageRoles: parsed?.roles ?? [],
      systemCharacters: parsed?.system.length ?? 0,
      memoryBlockCharacters: block.length,
      memoryBlockText: block.slice(0, 1500),
      evidenceIds: assessment?.evidenceIds ?? [],
      conflicts: assessment?.conflict ?? null,
      auto: {
        outcome: assessment?.outcome ?? null,
        scored: assessment?.scored ?? false,
        dimensions: (assessment?.dimensions ?? null) as unknown as Record<string, { status: string; reason: string }> | null,
        detail: assessment?.detail ?? null
      },
      reference: { matched: matchedTerm !== null, matchedTerm, forbiddenHit }
    }
  } finally {
    stack.cleanup()
  }
}

async function main(): Promise<void> {
  const start = captureProvenance()
  const startedAt = new Date().toISOString()
  const runs: RunRecord[] = []
  for (const scenario of SCENARIOS) {
    for (let index = 0; index < repeats; index += 1) {
      const record = await runOne(scenario, index)
      runs.push(record)
      console.log(`${record.runId}: ${record.auto.outcome ?? 'no_evaluation'} ${record.providerStatus}`)
    }
  }
  const requests = ledger.records
  const end = captureProvenance()
  const provenance = reconcileProvenance(start, end, new Date().toISOString())

  const byScenario = Object.fromEntries(SCENARIOS.map((scenario) => {
    const items = runs.filter((run) => run.scenarioId === scenario.id)
    const outcomes: Record<string, number> = {}
    for (const run of items) {
      const key = run.auto.outcome ?? 'no_evaluation'
      outcomes[key] = (outcomes[key] ?? 0) + 1
    }
    return [scenario.id, {
      runs: items.length,
      referenceMatched: items.filter((run) => run.reference.matched).length,
      forbiddenHit: items.filter((run) => run.reference.forbiddenHit).length,
      autoScored: items.filter((run) => run.auto.scored).length,
      usedCorrectly: items.filter((run) => run.auto.outcome === 'used_correctly').length,
      deliveredNotUsed: items.filter((run) => run.auto.outcome === 'delivered_not_used').length,
      reasonableUnknown: items.filter((run) => run.auto.outcome === 'reasonable_unknown').length,
      unsupported: items.filter((run) => run.auto.outcome === 'unsupported_answer').length,
      wrongOrStale: items.filter((run) => run.auto.outcome === 'used_wrong_or_stale').length,
      notScorable: items.filter((run) => run.auto.outcome === 'not_scorable').length,
      outcomes
    }]
  }))

  const report = {
    schemaVersion: 1,
    runId: `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 6)}`,
    startedAt,
    generatedAt: new Date().toISOString(),
    condition,
    model: { name: model, source: 'local ollama', endpoint, parameters: { temperature: 'provider default', maxTokens: 'provider default' } },
    provenance,
    repeats,
    counts: {
      scenarioClasses: SCENARIOS.length,
      scenarioRuns: runs.length,
      providerRequestsAttempted: requests.length,
      providerRequestsSucceeded: requests.filter((record) => record.status === 'succeeded').length,
      providerRequestsFailed: requests.filter((record) => record.status === 'failed').length,
      providerRequestsCancelled: requests.filter((record) => record.status === 'cancelled').length,
      primaryAnswerRequests: requests.length,
      auxiliaryProbeRequests: 0,
      setupRequests: 0
    },
    byScenario,
    requests,
    runs
  }

  const integrity = validateReportIntegrity({
    counts: report.counts,
    requests,
    runs: runs.map((run) => ({
      runId: run.runId,
      scenarioId: run.scenarioId,
      scenarioRunId: run.scenarioRunId,
      primaryRequestId: run.requestId,
      probeRequestIds: [],
      setupRequestIds: [],
      callSucceeded: run.callSucceeded
    }))
  })

  const outputPath = join(process.cwd(), 'evaluation', 'reports', `phase22-${condition.id}-${report.runId}.json`)
  mkdirSync(join(process.cwd(), 'evaluation', 'reports'), { recursive: true })
  writeFileSync(outputPath, JSON.stringify({ ...report, integrity }, null, 2), 'utf8')
  console.log(JSON.stringify({
    condition: condition.id,
    runId: report.runId,
    counts: report.counts,
    integrity: { ok: integrity.ok, failures: integrity.failures },
    reproducible: provenance.reproducible,
    byScenario,
    report: outputPath
  }))
  if (!integrity.ok) process.exitCode = 1
}

void main()
