import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { SourceValidityService } from '../persistence/source-validity'
import { CognitionConsistencyGate } from './cognition-consistency'
import { reconcileCognitionConsistency } from './cognition-reconciliation'
import { ConversationService } from '../conversation/conversation-service'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { MemoryService } from '../memory/memory-service'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore } from '../security/secrets'
import { CompanionService } from './companion-service'
import { CognitionOutbox } from './cognitive-outbox'
import { CognitiveEffectLedger } from './effect-ledger'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import type { ProviderInput, ProviderOutput, ProviderPort } from '../providers/provider-policy'

const directories: string[] = []
const databases: SqliteDatabase[] = []
const at = '2026-11-10T12:00:00.000Z'

afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close() } catch { /* already closed */ }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function database(): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-p0-'))
  directories.push(directory)
  const db = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  databases.push(db)
  return db
}

class CapturingProvider implements ProviderPort {
  readonly profile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock' as const, configured: true }
  calls = 0
  lastPayload = ''
  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.calls += 1
    this.lastPayload = JSON.stringify(input.requestPayload)
    return { text: 'ok', modelId: 'stub' }
  }
}

function stack() {
  const db = database()
  const events = new EventLogService(db)
  const sourceValidity = new SourceValidityService(db, () => at, events)
  const memories = new MemoryService(new SqliteMemoryRepository(db), () => at, undefined, events, { sourceValidity })
  const conversations = new ConversationService(new SqliteConversationRepository(db), () => at)
  const consistency = new CognitionConsistencyGate(() => at)
  const provider = new CapturingProvider()
  const companion = new CompanionService({
    database: db,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    clock: () => at,
    authorize: async (preview) => ({
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: at,
      expiresAt: '2026-11-10T12:02:00.000Z',
      includeSensitive: false
    }),
    providerFactory: () => provider,
    sourceValidity,
    cognitionConsistency: consistency
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-key' })
  return { db, events, sourceValidity, memories, conversations, consistency, provider, companion }
}

describe('P0-A startup consistency gate', () => {
  it('locks chat when the deletion journal cannot be read and unlocks only after a successful retry', async () => {
    const context = stack()
    const conversation = context.companion.createConversation()
    const outcome = reconcileCognitionConsistency({
      database: context.db,
      gate: context.consistency,
      sourceValidity: context.sourceValidity,
      revalidate: () => ({ updated: 0, retracted: 0 }),
      recoverInvestigations: () => 0,
      replayConversation: () => undefined,
      readJournal: () => { throw new Error('journal read failed') }
    })
    expect(outcome.state).toBe('locked')
    expect(outcome.reasons).toContain('deletion_replay_failed')
    await expect(context.companion.sendChat({
      conversationId: conversation.id, requestId: randomUUID(), content: 'hello', includeSensitive: false
    }, () => undefined)).rejects.toMatchObject({ code: 'COGNITION_LOCKED' })
    expect(context.provider.calls).toBe(0)

    const recovered = reconcileCognitionConsistency({
      database: context.db,
      gate: context.consistency,
      sourceValidity: context.sourceValidity,
      revalidate: () => ({ updated: 0, retracted: 0 }),
      recoverInvestigations: () => 0,
      replayConversation: () => undefined
    })
    expect(recovered.state).toBe('ready')
    await context.companion.sendChat({
      conversationId: conversation.id, requestId: randomUUID(), content: 'hello', includeSensitive: false
    }, () => undefined)
    expect(context.provider.calls).toBe(1)
  })

  it('locks when self-state revalidation or investigation recovery throws', () => {
    const context = stack()
    const revalidation = reconcileCognitionConsistency({
      database: context.db,
      gate: context.consistency,
      sourceValidity: context.sourceValidity,
      revalidate: () => { throw new Error('bad lineage') },
      recoverInvestigations: () => 0,
      replayConversation: () => undefined
    })
    expect(revalidation.state).toBe('locked')
    expect(revalidation.reasons).toContain('self_state_revalidation_failed')

    context.consistency.ready()
    const recovery = reconcileCognitionConsistency({
      database: context.db,
      gate: context.consistency,
      sourceValidity: context.sourceValidity,
      revalidate: () => ({ updated: 0, retracted: 0 }),
      recoverInvestigations: () => { throw new Error('bad budget') },
      replayConversation: () => undefined
    })
    expect(recovery.state).toBe('locked')
    expect(recovery.reasons).toContain('investigation_recovery_failed')
  })
})

describe('P0-C deletion propagation', () => {
  it('invalidates lineage, findings, routes, outbox, ledger and self-model rows', () => {
    const context = stack()
    const conversation = context.conversations.create()
    const turnId = randomUUID()
    const userMessageId = randomUUID()
    context.conversations.appendMessage(conversation.id, 'user', '记住这段对话', turnId, { messageId: userMessageId })
    context.conversations.appendMessage(conversation.id, 'assistant', '好的', turnId, { messageId: randomUUID() })

    const root = context.events.recordDeterministic(`conversation-root:${randomUUID()}`, {
      sourceModule: 'app', eventType: 'turn.completed', actor: 'system', subjectType: 'conversation',
      subjectId: conversation.id, correlationId: turnId, payload: { label: 'x' }
    }).event.id
    context.db.connection.prepare(`
      INSERT INTO evidence_lineage(node_id, owner, root_source_id, correlation_group_id, derivation_kind, source_table, state, parent_ids_json, verified_at, created_at)
      VALUES (?, 'morrow', ?, ?, 'origin', 'event_journal', 'active', '[]', ?, ?)
    `).run(root, root, root, at, at)

    const runId = randomUUID()
    const findingId = randomUUID()
    context.db.connection.prepare(`
      INSERT INTO reflection_runs(id, trigger_kind, started_at, finished_at, examined_turns, examined_events, findings_count, status)
      VALUES (?, 'manual', ?, ?, 1, 1, 1, 'completed')
    `).run(runId, at, at)
    context.db.connection.prepare(`
      INSERT INTO reflection_findings(id, run_id, kind, statement, confidence, evidence_json, created_at)
      VALUES (?, ?, 'memory_gap', '虚构但可审计的 finding', 60, ?, ?)
    `).run(findingId, runId, JSON.stringify([{ kind: 'event', id: root }]), at)
    context.db.connection.prepare(`
      INSERT INTO reflection_finding_routes(finding_id, route, status, reason, run_id, kind, injected_turn_id, created_at, updated_at)
      VALUES (?, 'context_hint', 'injected', 'test', ?, 'hint', ?, ?, ?)
    `).run(findingId, runId, turnId, at, at)
    context.db.connection.prepare(`
      INSERT INTO self_model_entries(id, kind, statement, status, confidence, source_message_id, conversation_id, superseded_by, created_at, updated_at)
      VALUES (?, 'fact', '从对话派生的自我条目', 'active', 80, ?, ?, NULL, ?, ?)
    `).run(randomUUID(), userMessageId, conversation.id, at, at)

    const outbox = new CognitionOutbox(context.db, () => at)
    outbox.enqueue({ turnId, conversationId: conversation.id, userMessageId, occurredAt: at, analysis: null, modules: ['interest'] })
    const ledger = new CognitiveEffectLedger(context.db, () => at)
    const claim = ledger.begin({ turnId, module: 'interest', handlerVersion: 1, effectKey: 'project' })
    if (claim.status !== 'run') throw new Error('expected a running claim')

    const result = context.sourceValidity.invalidateConversation(conversation.id)
    expect(result.lineageNodes).toBeGreaterThanOrEqual(1)
    expect(result.findings).toBe(1)
    expect(result.outboxRows).toBe(1)
    expect(result.effectRows).toBe(1)

    expect(context.db.connection.prepare('SELECT state FROM evidence_lineage WHERE node_id = ?').get(root)?.state).toBe('deleted')
    expect(context.db.connection.prepare('SELECT COUNT(*) AS n FROM reflection_findings WHERE id = ?').get(findingId)?.n).toBe(0)
    expect(context.db.connection.prepare('SELECT COUNT(*) AS n FROM reflection_finding_routes WHERE finding_id = ?').get(findingId)?.n).toBe(0)
    expect(context.db.connection.prepare('SELECT status FROM cognitive_outbox WHERE turn_id = ?').get(turnId)?.status).toBe('cancelled')
    expect(context.db.connection.prepare("SELECT state FROM cognitive_effect_ledger WHERE turn_id = ?").get(turnId)?.state).toBe('terminal_failed')
    expect(ledger.complete({ turnId, module: 'interest', handlerVersion: 1, effectKey: 'project' }, claim.generation)).toBe(false)
    expect(context.db.connection.prepare("SELECT status FROM self_model_entries WHERE conversation_id = ?").get(conversation.id)?.status).toBe('retracted')

    const projector = vi.fn()
    const drained = outbox.drain([{ module: 'interest', version: 1, project: projector }])
    expect(projector).not.toHaveBeenCalled()
    expect(drained.done).toBe(0)

    // Idempotent replay.
    const second = context.sourceValidity.invalidateConversation(conversation.id)
    expect(second.findings).toBe(0)
    expect(second.outboxRows).toBe(0)
  })

  it('cancels a pending projection after the conversation is deleted', () => {
    const context = stack()
    const conversation = context.companion.createConversation()
    const turnId = randomUUID()
    const userMessageId = randomUUID()
    context.conversations.appendMessage(conversation.id, 'user', '一条会被删除的消息', turnId, { messageId: userMessageId })
    const outbox = new CognitionOutbox(context.db, () => at)
    outbox.enqueue({ turnId, conversationId: conversation.id, userMessageId, occurredAt: at, analysis: null, modules: ['interest'] })
    context.companion.deleteConversation({ conversationId: conversation.id })
    const projector = vi.fn()
    const drained = outbox.drain([{ module: 'interest', version: 1, project: projector }])
    expect(projector).not.toHaveBeenCalled()
    expect(drained.done).toBe(0)
    expect(context.db.connection.prepare('SELECT status FROM cognitive_outbox WHERE turn_id = ?').get(turnId)?.status).toBe('cancelled')
  })

  it('removes a memory sourced only by the deleted conversation from the next Provider payload', async () => {
    const context = stack()
    const conversation = context.companion.createConversation()
    const memory = context.memories.create('蓝鲸项目的唯一代号是 ORCA-831。')
    context.db.connection.prepare(`
      INSERT INTO memory_evidence(memory_id, source_ref, source_kind, actor, conversation_id, occurred_at, evidence_type, confidence, independence_group, algorithm_version)
      VALUES (?, ?, 'message', 'user', ?, ?, 'statement', 0.9, ?, 'test-v1')
    `).run(memory.id, randomUUID(), conversation.id, at, memory.id)
    await context.companion.sendChat({
      conversationId: conversation.id, requestId: randomUUID(), content: '蓝鲸项目的唯一代号是什么？', includeSensitive: false
    }, () => undefined)
    expect(context.provider.lastPayload).toContain('ORCA-831')

    context.companion.deleteConversation({ conversationId: conversation.id })
    expect(context.db.connection.prepare('SELECT status FROM memories WHERE id = ?').get(memory.id)?.status).toBe('retracted')
    const next = context.companion.createConversation()
    await context.companion.sendChat({
      conversationId: next.id, requestId: randomUUID(), content: '蓝鲸项目的唯一代号是什么？', includeSensitive: false
    }, () => undefined)
    expect(context.provider.lastPayload).not.toContain('ORCA-831')
  })

  it('writes only counts, never the deleted statement, into the audit event', () => {
    const context = stack()
    const conversation = context.conversations.create()
    const turnId = randomUUID()
    const userMessageId = randomUUID()
    context.conversations.appendMessage(conversation.id, 'user', '我的私密原文不应该进入审计', turnId, { messageId: userMessageId })
    context.sourceValidity.invalidateConversation(conversation.id)
    const row = context.db.connection.prepare(
      "SELECT payload_json FROM event_journal WHERE event_type = 'source.invalidated' ORDER BY seq DESC LIMIT 1"
    ).get() as { payload_json: string }
    expect(row.payload_json).not.toContain('私密原文')
    expect(row.payload_json).toContain('lineage')
  })

  it('retracts memory lineage and derived interest evidence on memory retract', () => {
    const context = stack()
    const memory = context.memories.create('我在学咖啡拉花。')
    context.db.connection.prepare(`
      INSERT INTO evidence_lineage(node_id, owner, root_source_id, correlation_group_id, derivation_kind, source_table, state, parent_ids_json, verified_at, created_at)
      VALUES (?, 'user', ?, ?, 'origin', 'memories', 'active', '[]', ?, ?)
    `).run(memory.id, memory.id, memory.id, at, at)
    context.memories.retract(memory.id)
    expect(context.db.connection.prepare('SELECT state FROM evidence_lineage WHERE node_id = ?').get(memory.id)?.state).toBe('retracted')
    context.memories.restore(memory.id)
    expect(context.db.connection.prepare('SELECT state FROM evidence_lineage WHERE node_id = ?').get(memory.id)?.state).toBe('active')
  })
})

describe('P0-D inner cognition crash and outbox retry', () => {
  it('drains the same message ten times without duplicating the logical effect', () => {
    const db = database()
    const companion = new CompanionService({
      database: db,
      memories: new MemoryService(new SqliteMemoryRepository(db), () => at),
      conversations: new ConversationService(new SqliteConversationRepository(db), () => at),
      secrets: new MemorySecretStore(),
      clock: () => at,
      authorize: async () => undefined,
      providerFactory: () => new CapturingProvider()
    })
    const conversation = companion.createConversation()
    const turnId = randomUUID()
    const userMessageId = randomUUID()
    new ConversationService(new SqliteConversationRepository(db), () => at).appendMessage(conversation.id, 'user', 'x', turnId, { messageId: userMessageId })
    const outbox = new CognitionOutbox(db, () => at)
    outbox.enqueue({ turnId, conversationId: conversation.id, userMessageId, occurredAt: at, analysis: null, modules: ['interest'] })
    const projector = vi.fn()
    for (let index = 0; index < 10; index += 1) {
      outbox.drain([{ module: 'interest', version: 1, project: projector }])
    }
    expect(projector).toHaveBeenCalledTimes(1)
    expect(db.connection.prepare('SELECT status FROM cognitive_outbox WHERE turn_id = ?').get(turnId)?.status).toBe('done')
    expect(db.connection.prepare("SELECT COUNT(*) AS n FROM cognitive_effect_ledger WHERE turn_id = ? AND state = 'applied'").get(turnId)?.n).toBe(1)
  })

  it('lets a second worker take over an expired lease while the old worker cannot complete', () => {
    const db = database()
    let now = at
    const first = new CognitiveEffectLedger(db, () => now)
    const second = new CognitiveEffectLedger(db, () => now)
    const identity = { turnId: randomUUID(), module: 'interest', handlerVersion: 1, effectKey: 'project' }
    const claim = first.begin(identity)
    expect(claim.status).toBe('run')
    if (claim.status !== 'run') throw new Error('unreachable')
    now = '2026-11-10T12:02:00.000Z'
    const takeover = second.begin(identity)
    expect(takeover.status).toBe('run')
    if (takeover.status !== 'run') throw new Error('unreachable')
    expect(first.complete(identity, claim.generation)).toBe(false)
    expect(second.complete(identity, takeover.generation)).toBe(true)
  })

  it('rolls the assistant message back when inner observation throws in afterPersist', async () => {
    const db = database()
    const provider = new CapturingProvider()
    const failingObserve = vi.fn(() => { throw new Error('observation failed') })
    const companion = new CompanionService({
      database: db,
      memories: new MemoryService(new SqliteMemoryRepository(db), () => at),
      conversations: new ConversationService(new SqliteConversationRepository(db), () => at),
      secrets: new MemorySecretStore(),
      clock: () => at,
      authorize: async (preview) => ({
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: at,
        expiresAt: '2026-11-10T12:02:00.000Z',
        includeSensitive: false
      }),
      providerFactory: () => provider,
      selfModelLoop: { innerCognition: { observeTurn: failingObserve, contextBlock: () => '' }, contextBlock: () => '', events: new EventLogService(db) } as never
    })
    companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-key' })
    const conversation = companion.createConversation()
    await expect(companion.sendChat({
      conversationId: conversation.id, requestId: randomUUID(), content: 'hello', includeSensitive: false
    }, () => undefined)).rejects.toMatchObject({ code: 'STORAGE_ERROR' })
    expect(failingObserve).toHaveBeenCalledTimes(1)
    expect(companion.readConversation({ conversationId: conversation.id }).messages.some((message) => message.role === 'assistant')).toBe(false)
  })
})
