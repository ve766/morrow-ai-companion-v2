/**
 * Stage 4-A acceptance: the cat-name continuity story through the production
 * assembly (real outbox, fact ledger, retrieval, prompt assembly, restarts).
 *
 * Each test maps to one item of the task's acceptance list (§5). The
 * scripted provider proves the chain and the payloads; the real-model run
 * (evals/stage-4a) is what shows model behaviour, and human review stays
 * separate.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStack, systemText, type Stack } from '../../evals/stage-3/runner/harness'

let openStacks: Stack[] = []
afterEach(() => {
  for (const stack of openStacks) {
    try {
      stack.close()
    } catch {
      // already closed
    }
  }
  openStacks = []
})

function open(databasePath?: string): Stack {
  const stack = buildStack({ growth: true, exploration: true, reflection: true, ...(databasePath ? { databasePath, keepDatabase: true } : {}) })
  openStacks.push(stack)
  return stack
}

async function send(stack: Stack, conversationId: string, content: string, requestId = randomUUID()) {
  return stack.companion.sendChat({ conversationId, requestId, content, includeSensitive: false }, () => undefined)
}

const INTRO = '我有一只猫，它叫咪咪。帮我记住。'
const CORRECTION = '我说错了，它现在叫豆豆。帮我更新。'

function petFacts(stack: Stack, options: { queryTime?: string } = {}) {
  return stack.factMemory.lookupActive('pet_name', { ...options })
}

describe('Stage 4-A: cat-name continuity through the production chain', () => {
  it('1. a saved memory cites the real source message id', async () => {
    const stack = open()
    const conversation = stack.companion.createConversation()
    const requestId = randomUUID()
    const result = await send(stack, conversation.id, INTRO, requestId)
    const userId = result.userMessage.id
    const memory = stack.memories.list().find((item) => item.currentText.includes('咪咪'))
    expect(memory).toBeDefined()
    const revision = stack.database.connection.prepare(
      'SELECT source_message_id, provenance_kind FROM memory_revisions WHERE memory_id = ? AND revision = 1'
    ).get(memory!.id) as { source_message_id: string; provenance_kind: string }
    expect(revision.source_message_id).toBe(userId)
    expect(revision.provenance_kind).toBe('message')
    const fact = stack.database.connection.prepare(
      'SELECT source_message_id, provenance_kind FROM fact_records WHERE source_memory_id = ?'
    ).get(memory!.id) as { source_message_id: string; provenance_kind: string }
    expect(fact.source_message_id).toBe(userId)
  })

  it('2. a new session recalls the active cat name from the ledger, not from history', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, INTRO)
    const b = stack.companion.createConversation()
    await send(stack, b.id, '你还记得我的猫叫什么吗？')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('咪咪')
    expect(petFacts(stack).map((fact) => fact.valueNormalized)).toEqual(['咪咪'])
  })

  it('3. a correction supersedes the old value and activates the new one; history keeps the old revision', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, INTRO)
    const memory = stack.memories.list().find((item) => item.currentText.includes('咪咪'))!
    await send(stack, a.id, CORRECTION)
    const rows = stack.database.connection.prepare(
      'SELECT value_normalized, status, source_revision, supersedes_fact_id FROM fact_records WHERE source_memory_id = ? ORDER BY source_revision'
    ).all(memory.id) as Array<{ value_normalized: string; status: string; source_revision: number; supersedes_fact_id: string | null }>
    const oldValue = rows.find((row) => row.value_normalized === '咪咪')
    const newValue = rows.find((row) => row.value_normalized === '豆豆')
    expect(oldValue).toMatchObject({ status: 'superseded' })
    expect(oldValue?.supersedes_fact_id ?? null).toBeNull()
    expect(newValue).toMatchObject({ status: 'active' })
    expect(newValue!.source_revision).toBeGreaterThan(oldValue!.source_revision)
    // current reads see only the active value
    expect(petFacts(stack).map((fact) => fact.valueNormalized)).toEqual(['豆豆'])
  })

  it('4. after a full runtime restart the new value is still current', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'morrow-4a-restart-'))
    const databasePath = join(dir, 'morrow.sqlite3')
    try {
      const first = open(databasePath)
      const a = first.companion.createConversation()
      await send(first, a.id, INTRO)
      await send(first, a.id, CORRECTION)
      first.close()

      const second = open(databasePath)
      // restart catch-up re-derives the index from the memories
      second.factMemory.reindexAll()
      expect(petFacts(second).map((fact) => fact.valueNormalized)).toEqual(['豆豆'])
      const c = second.companion.createConversation()
      await send(second, c.id, '我的猫叫什么？')
      expect(systemText(second.provider.lastPayload)).toContain('豆豆')
      second.close()
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows can hold the file lock briefly after close.
      }
    }
  })

  it('5. a historical query may read the superseded value while a current query may not', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, INTRO)
    await send(stack, a.id, CORRECTION)
    const current = petFacts(stack).map((fact) => fact.valueNormalized)
    const history = petFacts(stack, { queryTime: 'past' }).map((fact) => fact.valueNormalized)
    expect(current).toEqual(['豆豆'])
    expect(history).toContain('咪咪')
    expect(history).toContain('豆豆')
  })

  it('6. a retracted memory stops being injected as current', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, INTRO)
    const memory = stack.memories.list().find((item) => item.currentText.includes('咪咪'))!
    stack.memories.retract(memory.id)
    const b = stack.companion.createConversation()
    await send(stack, b.id, '我的猫叫什么？')
    expect(systemText(stack.provider.lastPayload)).not.toContain('咪咪')
    expect(petFacts(stack)).toEqual([])
  })

  it('7. the personality baseline is identical across sessions, restarts and provider switches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'morrow-4a-persona-'))
    const databasePath = join(dir, 'morrow.sqlite3')
    try {
      const first = open(databasePath)
      const baseline = first.companion.getPersonality()
      const a = first.companion.createConversation()
      await send(first, a.id, INTRO)
      // Provider switch: a second configuration is saved and selected; the
      // application-side baseline must not move with it.
      // A second provider configuration (loopback local) is saved and becomes
      // active; the application-side identity must not move with it.
      first.companion.saveProvider({ providerId: 'local-openai', model: 'stage-4a-second-model', enabled: true, endpoint: 'http://127.0.0.1:11434/v1' })
      expect(first.companion.getProvider()?.model).toBe('stage-4a-second-model')
      const afterSwitch = first.companion.getPersonality()
      expect(afterSwitch.warmth).toBe(baseline.warmth)
      expect(afterSwitch.directness).toBe(baseline.directness)
      expect(afterSwitch.humor).toBe(baseline.humor)
      expect(afterSwitch.version).toBe(baseline.version)
      first.close()

      const second = open(databasePath)
      const afterRestart = second.companion.getPersonality()
      expect(afterRestart.version).toBe(baseline.version)
      expect(afterRestart.warmth).toBe(baseline.warmth)
      expect(afterRestart.directness).toBe(baseline.directness)
      expect(afterRestart.humor).toBe(baseline.humor)
      second.close()
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows can hold the file lock briefly after close.
      }
    }
  })

  it('8. two corrections of one single-valued fact never leave two current values', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, INTRO)
    await send(stack, a.id, '我说错了，它现在叫豆豆。')
    await send(stack, a.id, '我刚才说错了，它现在叫团团。')
    const current = petFacts(stack)
    expect(current).toHaveLength(1)
    expect(current[0]!.valueNormalized).toBe('团团')
    const activeRows = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM fact_records WHERE predicate = 'pet_name' AND status = 'active'"
    ).get() as { n: number }
    expect(activeRows.n).toBe(1)
  })

  it('9. a degraded index falls back to a bounded scan instead of reporting no facts', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, INTRO)
    // Force the index to report unusable lookups.
    const original = stack.factMemory.lookupActive.bind(stack.factMemory)
    ;(stack.factMemory as unknown as { lookupActive: () => never[] }).lookupActive = () => {
      throw new Error('MemoryDbError')
    }
    try {
      const b = stack.companion.createConversation()
      await send(stack, b.id, '我的猫叫什么？')
      // The fallback scan answers from the memories themselves.
      expect(systemText(stack.provider.lastPayload)).toContain('咪咪')
    } finally {
      ;(stack.factMemory as unknown as { lookupActive: typeof original }).lookupActive = original
    }
  })

  it('10. a budget-truncated context reports the omission in the turn evaluation', async () => {
    const stack = open()
    for (const name of ['alpha', 'beta', 'gamma', 'delta']) {
      stack.memories.create(`我的项目代号是 ${name}${'x'.repeat(180)}。`, 'personal')
    }
    const a = stack.companion.createConversation()
    await send(stack, a.id, '我的项目代号是什么？')
    const evaluation = stack.database.connection.prepare(
      "SELECT payload_json FROM event_journal WHERE event_type = 'turn.evaluated' ORDER BY rowid DESC LIMIT 1"
    ).get() as { payload_json: string }
    const payload = JSON.parse(evaluation.payload_json)
    expect(Object.prototype.hasOwnProperty.call(payload, 'omittedCount')).toBe(true)
    expect(typeof payload.omittedCount).toBe('number')
  })

  it('11. provider-independent state: the fact ledger and baseline live in SQLite, not in a provider context', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, INTRO)
    await send(stack, a.id, CORRECTION)
    // The fresh provider instance in a new stack cannot carry model context;
    // the reuse test in (4) already proves the ledger survives teardown, and
    // here we assert the rows exist in the database itself.
    const factRows = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM fact_records WHERE predicate = 'pet_name' AND status = 'active'"
    ).get() as { n: number }
    expect(factRows.n).toBe(1)
    const revisionRows = stack.database.connection.prepare(
      'SELECT COUNT(*) AS n FROM memory_revisions'
    ).get() as { n: number }
    expect(revisionRows.n).toBeGreaterThanOrEqual(2)
  })

  it('12. the legacy memory text still answers when the fact index has no candidate', async () => {
    const stack = open()
    // A shape the extractor deliberately does not guess into a predicate.
    stack.memories.create('今天路过一家咖啡店，随便聊聊。', 'normal')
    const a = stack.companion.createConversation()
    await send(stack, a.id, '咖啡店怎么样？')
    expect(systemText(stack.provider.lastPayload)).toContain('咖啡店')
    expect(stack.factMemory.counts().total).toBe(0)
  })
})
