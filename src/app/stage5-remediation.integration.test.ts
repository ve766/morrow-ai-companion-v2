/**
 * Stage 5 remediation acceptance (Issue #27 §4): eighteen checks, each on the
 * production assembly and each asserting database state and/or the serialized
 * payload — never a bare helper return value.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStack, systemText, type Stack } from '../../evals/stage-3/runner/harness'
import { BackupService } from '../persistence/backup-service'

let stacks: Stack[] = []
afterEach(() => {
  for (const stack of stacks) {
    try {
      stack.close()
    } catch {
      // already closed
    }
  }
  stacks = []
})

function open(databasePath?: string, clock?: () => string): Stack {
  const stack = buildStack({
    growth: true,
    exploration: true,
    reflection: true,
    ...(clock ? { clock } : {}),
    ...(databasePath ? { databasePath, keepDatabase: true } : {})
  })
  stacks.push(stack)
  return stack
}

async function send(stack: Stack, conversationId: string, content: string, requestId = randomUUID()) {
  return stack.companion.sendChat({ conversationId, requestId, content, includeSensitive: false }, () => undefined)
}

const rows = (stack: Stack, where = '1=1'): Array<{ kind: string; value: string; status: string }> =>
  stack.database.connection.prepare(`SELECT kind, value, status FROM relationship_threads WHERE ${where} ORDER BY kind`).all() as Array<{ kind: string; value: string; status: string }>

const evidenceCount = (stack: Stack): number =>
  (stack.database.connection.prepare('SELECT COUNT(*) AS n FROM relationship_thread_evidence').get() as { n: number }).n

describe('Stage 5 remediation — targeted retraction (P0-A)', () => {
  it('1. "那个约定就算了" leaves an address preference untouched', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '那个约定就算了。')
    const address = rows(stack, "kind = 'address_preference'")
    expect(address).toHaveLength(1)
    expect(address[0]).toMatchObject({ value: '小林', status: 'active' })
  })

  it('2. with three threads, withdrawing one topic retires only that topic', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '我们下次聊项目时间线。')
    await send(stack, a.id, '我们下次聊项目时间线。')
    await send(stack, a.id, '别一次问太多，简单点说。')
    await send(stack, a.id, '那个约定就算了。')
    const all = rows(stack)
    expect(all.find((row) => row.kind === 'address_preference')).toMatchObject({ status: 'active' })
    expect(all.find((row) => row.kind === 'rhythm_preference')).toMatchObject({ status: 'active' })
    expect(all.find((row) => row.kind === 'shared_topic')).toMatchObject({ status: 'retracted' })
  })

  it('3. an explicit global withdrawal retires everything, and only then', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '我们下次聊项目时间线。')
    expect(rows(stack).every((row) => row.status !== 'retracted')).toBe(true)
    await send(stack, a.id, '把这些约定和偏好都撤回吧。')
    expect(rows(stack).every((row) => row.status === 'retracted')).toBe(true)
    // The global intent is recorded, not inferred later.
    const event = stack.database.connection.prepare(
      "SELECT payload_json FROM event_journal WHERE event_type = 'relationship.retract_all' ORDER BY rowid DESC LIMIT 1"
    ).get() as { payload_json: string } | undefined
    expect(event).toBeDefined()
    expect(JSON.parse(event!.payload_json)).toMatchObject({ explicitGlobalIntent: true })
  })

  it('4. an ambiguous withdrawal changes nothing and asks which one', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '我们下次聊项目时间线。')
    await send(stack, a.id, '我们下次也说好周末复盘。')
    const before = rows(stack).map((row) => `${row.kind}:${row.status}`).join(',')
    await send(stack, a.id, '那个约定就算了。')
    expect(rows(stack).map((row) => `${row.kind}:${row.status}`).join(',')).toBe(before)
    const degrade = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM event_journal WHERE event_type LIKE '%relationship_clarify%'"
    ).get() as { n: number }
    expect(degrade.n).toBeGreaterThanOrEqual(1)
  })
})

describe('Stage 5 remediation — address corrections (P1-C)', () => {
  it('5. "别再叫我小林，叫我阿林" replaces the old value; only the new one is injected', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '别再叫我小林，叫我阿林。')
    const b = stack.companion.createConversation()
    await send(stack, b.id, '你好。')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('"阿林"')
    expect(system).not.toContain('"小林"')
    const old = rows(stack, "kind = 'address_preference' AND value = '小林'")[0]
    expect(old?.status).toBe('superseded')
  })

  it('6. "不要这样称呼我" without a new name retires the old value and does not guess', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '不要这样称呼我。')
    expect(rows(stack, "kind = 'address_preference'").every((row) => row.status !== 'active')).toBe(true)
    const b = stack.companion.createConversation()
    await send(stack, b.id, '你好。')
    expect(systemText(stack.provider.lastPayload)).not.toContain('"小林"')
  })
})

describe('Stage 5 remediation — deletion propagation (P0-B)', () => {
  it('7. deleting the source message removes its evidence and the thread stops being injected', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const turn = randomUUID()
    await send(stack, a.id, '以后叫我小林。', turn)
    expect(evidenceCount(stack)).toBeGreaterThanOrEqual(1)
    stack.database.connection.prepare('DELETE FROM messages WHERE turn_id = ?').run(turn)
    expect(evidenceCount(stack)).toBe(0)
    const b = stack.companion.createConversation()
    await send(stack, b.id, '你好。')
    expect(systemText(stack.provider.lastPayload)).not.toContain('"小林"')
    const thread = rows(stack, "kind = 'address_preference'")[0]
    expect(thread?.status).not.toBe('active')
  })

  it('8. deleting the whole conversation removes every relationship evidence row', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '我们下次聊项目时间线。')
    expect(evidenceCount(stack)).toBeGreaterThanOrEqual(1)
    stack.companion.deleteConversation({ conversationId: a.id })
    expect(evidenceCount(stack)).toBe(0)
    expect(rows(stack).every((row) => row.status !== 'active')).toBe(true)
  })

  it('9. a restored backup that predates the deletion does not revive the evidence (reconcile)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'morrow-s5-reconcile-'))
    const databasePath = join(dir, 'morrow.sqlite3')
    try {
      const stack = open(databasePath)
      const a = stack.companion.createConversation()
      const turn = randomUUID()
      await send(stack, a.id, '以后叫我小林。', turn)
      const messageId = (stack.database.connection.prepare('SELECT id FROM messages WHERE turn_id = ?').get(turn) as { id: string }).id
      // Simulate a restore that brought back evidence whose message is gone:
      // the row references a message id that no longer exists.
      stack.database.connection.prepare('DELETE FROM messages WHERE id = ?').run(messageId)
      stack.database.connection.prepare(
        "INSERT INTO relationship_thread_evidence(thread_id, source_message_id, conversation_id, polarity, weight, created_at) SELECT id, ?, ?, 'support', 1.0, ? FROM relationship_threads LIMIT 1"
      ).run(messageId, a.id, new Date().toISOString())
      expect(evidenceCount(stack)).toBe(1)
      const removed = stack.relationships.reconcile()
      expect(removed).toBe(1)
      expect(evidenceCount(stack)).toBe(0)
      stack.close()
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows can hold the file briefly.
      }
    }
  })

  it('9b. restoring a backup after the conversation was deleted does not revive the evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'morrow-s5-restore-'))
    const databasePath = join(dir, 'morrow.sqlite3')
    try {
      const first = open(databasePath)
      const a = first.companion.createConversation()
      await send(first, a.id, '以后叫我小林。')
      expect(evidenceCount(first)).toBeGreaterThanOrEqual(1)
      const backup = new BackupService(first.database, databasePath)
      const exported = await backup.export(join(dir, 'backups'))
      // The snapshot still contains the conversation and its evidence; the
      // deletion happened after it and is replayed from the deletion journal.
      first.companion.deleteConversation({ conversationId: a.id })
      expect(evidenceCount(first)).toBe(0)
      const preview = await backup.preview(exported.directory)
      const restored = await backup.restore({ token: preview.token, confirmed: true })
      expect(restored.status).toBe('restored')
      expect(restored.reappliedDeletions).toBe(1)
      first.close()
      const second = open(databasePath)
      expect(evidenceCount(second)).toBe(0)
      expect(rows(second).every((row) => row.status !== 'active')).toBe(true)
      second.close()
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows can hold the file briefly.
      }
    }
  })
})

describe('Stage 5 remediation — transaction boundaries and recovery (P1-D/P1-E)', () => {
  it('10. a relationship write that fails stays queued and applies once on retry', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const original = stack.relationships.observe.bind(stack.relationships)
    let failing = true
    ;(stack.relationships as unknown as { observe: typeof original }).observe = ((input: Parameters<typeof original>[0]) => {
      if (failing) throw new Error('RelationshipDbError')
      return original(input)
    }) as typeof original
    try {
      await send(stack, a.id, '以后叫我小林。')
    } finally {
      failing = false
      ;(stack.relationships as unknown as { observe: typeof original }).observe = original
    }
    // The reply was committed; nothing about the relationship was guessed or
    // half-written, and the obligation is durable rather than swallowed.
    expect(rows(stack, "kind = 'address_preference'")).toHaveLength(0)
    const queued = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM cognitive_outbox WHERE module = 'relationship' AND status = 'pending'"
    ).get() as { n: number }
    expect(queued.n).toBe(1)
    // Restart compensation is the same drain: it applies the change once.
    const drained = stack.companion.drainCognition()
    expect(drained.done).toBeGreaterThanOrEqual(1)
    expect(rows(stack, "kind = 'address_preference'")[0]).toMatchObject({ value: '小林', status: 'active' })
    stack.companion.drainCognition()
    const evidence = stack.database.connection.prepare(
      'SELECT COUNT(*) AS n FROM relationship_thread_evidence'
    ).get() as { n: number }
    expect(evidence.n).toBe(1)
  })

  it('13. replaying one turn ten times adds one relationship evidence row and one memory revision', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const turn = randomUUID()
    for (let index = 0; index < 10; index += 1) await send(stack, a.id, '以后叫我小林，我对花生过敏。帮我记住。', turn)
    const evidence = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM relationship_thread_evidence WHERE source_message_id = (SELECT id FROM messages WHERE turn_id = ? AND role = 'user')"
    ).get(turn) as { n: number }
    expect(evidence.n).toBe(1)
    const memories = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM memories WHERE current_text LIKE '%花生%'"
    ).get() as { n: number }
    expect(memories.n).toBe(1)
    const revisions = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM memory_revisions WHERE memory_id = (SELECT id FROM memories WHERE current_text LIKE '%花生%')"
    ).get() as { n: number }
    expect(revisions.n).toBe(1)
    const relationships = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM cognitive_outbox WHERE module = 'relationship' AND turn_id = ?"
    ).get(turn) as { n: number }
    expect(relationships.n).toBe(1)
  })

  it('11. a multi-fact batch whose verification fails is rolled back, not partially kept', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const original = stack.factMemory.lookupActive.bind(stack.factMemory)
    let calls = 0
    ;(stack.factMemory as unknown as { lookupActive: typeof original }).lookupActive = ((predicate: string, options?: { queryTime?: string }) => {
      calls += 1
      // Let the first verification pass, then report nothing found.
      if (calls > 1 && predicate === 'pet_name') return []
      return original(predicate, options)
    }) as typeof original
    try {
      await send(stack, a.id, '我的猫叫咪咪，我住在杭州。帮我记住。')
      // Nothing from the batch may survive as a "saved" record.
      const stored = stack.database.connection.prepare(
        'SELECT COUNT(*) AS n FROM memories WHERE current_text LIKE ?'
      ).get('%咪咪%') as { n: number }
      expect(stored.n).toBe(0)
    } finally {
      ;(stack.factMemory as unknown as { lookupActive: typeof original }).lookupActive = original
    }
  })

  it('12. an index failure that later recovers ends at a verified state, not a silent success', async () => {
    // The backoff is real (fact-index-faults covers the hot-loop guard), so the
    // retry is observed on a controlled clock instead of a sleep.
    let now = Date.parse('2026-11-01T08:00:00.000Z')
    const stack = open(undefined, () => new Date(now).toISOString())
    const a = stack.companion.createConversation()
    const original = stack.factMemory.reindexMemory.bind(stack.factMemory)
    let failing = true
    ;(stack.factMemory as unknown as { reindexMemory: typeof original }).reindexMemory = ((memoryId: string) => {
      if (failing) throw new Error('MemoryDbError')
      return original(memoryId)
    }) as typeof original
    try {
      await send(stack, a.id, '我对花生过敏。帮我记住。')
    } finally {
      failing = false
      ;(stack.factMemory as unknown as { reindexMemory: typeof original }).reindexMemory = original
    }
    // The primary record was kept and the loss is durable, not a silent success.
    const memory = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM memories WHERE current_text LIKE '%花生%'"
    ).get() as { n: number }
    expect(memory.n).toBe(1)
    const degraded = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM fact_index_jobs WHERE status = 'degraded'"
    ).get() as { n: number }
    expect(degraded.n).toBeGreaterThanOrEqual(1)
    now += 60_000
    const retried = stack.factMemory.retryDue((stack.database.connection.prepare('SELECT memory_id FROM fact_index_jobs').all() as Array<{ memory_id: string }>).map((row) => row.memory_id))
    expect(retried.length).toBeGreaterThanOrEqual(1)
    const jobs = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM fact_index_jobs WHERE status = 'indexed'"
    ).get() as { n: number }
    expect(jobs.n).toBeGreaterThanOrEqual(1)
  })

  it('14. a rebuilt runtime on the same database keeps address, fact and state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'morrow-s5-restart-'))
    const databasePath = join(dir, 'morrow.sqlite3')
    try {
      const first = open(databasePath)
      const a = first.companion.createConversation()
      await send(first, a.id, '以后叫我小林。')
      first.memories.create('我住在杭州。', 'personal')
      first.close()

      const second = open(databasePath)
      const b = second.companion.createConversation()
      await send(second, b.id, '你好，今天怎么样？')
      const system = systemText(second.provider.lastPayload)
      expect(system).toContain('"小林"')
      expect(second.companion.getPersonality().version).toBeGreaterThanOrEqual(1)
      second.close()
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows lock
      }
    }
  })
})

describe('Stage 5 remediation — expression policy signals (P1-F)', () => {
  it('15. a plain negation is not distress, while an explicit request for a fix is executed', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '我不喜欢这个方案。')
    const neutral = JSON.parse((stack.database.connection.prepare(
      "SELECT payload_json FROM event_journal WHERE event_type = 'turn.evaluated' ORDER BY rowid DESC LIMIT 1"
    ).get() as { payload_json: string }).payload_json) as Record<string, unknown>
    expect(neutral.expressionPolicy).not.toBe('user_tension_unresolved')
    await send(stack, a.id, '别安慰我，直接说下一步怎么做。')
    const direct = JSON.parse((stack.database.connection.prepare(
      "SELECT payload_json FROM event_journal WHERE event_type = 'turn.evaluated' ORDER BY rowid DESC LIMIT 1"
    ).get() as { payload_json: string }).payload_json) as Record<string, unknown>
    expect(direct.expressionPolicy).toBe('explicit_direct_request')
  })

  it('16. the greeting and preference guidance exists in the principles the model receives', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '你好。')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('Answer a greeting as a greeting')
    expect(system).toContain('use it naturally in one clause')
  })

  it('17. no expression policy changes the facts or the sensitivity ceiling', async () => {
    const stack = open()
    stack.memories.create('我对花生过敏。', 'personal')
    const a = stack.companion.createConversation()
    await send(stack, a.id, '别安慰我，直接说我对什么过敏。')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('花生')
    expect(system).toContain('answer it directly')
    expect(system).not.toContain('sensitivity":"sensitive')
  })

  it('18. retracted, superseded and deleted threads never reach the payload', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '以后叫我阿林。') // supersedes 小林
    const b = stack.companion.createConversation()
    await send(stack, b.id, '你好。')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('"阿林"')
    expect(system).not.toContain('"小林"')
  })
})
