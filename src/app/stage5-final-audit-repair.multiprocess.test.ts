/**
 * F6 (Issue #31): real OS-process contention for the relationship obligation.
 *
 * Each worker is a separate Node process with its own SQLite connection. The
 * test bundles `evals/stage-5/final-audit-repair/worker.ts` with esbuild and
 * spawns it; a barrier file coordinates claim vs. delete without random sleeps.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildSync } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { buildStack } from '../../evals/stage-3/runner/harness'

let root = ''
let workerBundle = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'morrow-f6-'))
  workerBundle = join(root, 'relationship-worker.mjs')
  buildSync({
    entryPoints: [resolve('evals/stage-5/final-audit-repair/worker.ts')],
    outfile: workerBundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'bundle',
    external: ['electron'],
    logLevel: 'silent'
  })
})

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Windows can hold the file briefly.
  }
})

interface WorkerResult { code: number | null; stdout: string; stderr: string }

function runWorker(args: string[]): Promise<WorkerResult> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [workerBundle, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    // Hang guard only: every wait below is coordinated by files, not by sleep.
    const guard = setTimeout(() => child.kill(), 20_000)
    child.on('exit', (code) => {
      clearTimeout(guard)
      resolveRun({ code, stdout, stderr })
    })
  })
}

function parse(result: WorkerResult): Record<string, number> {
  const line = result.stdout.trim().split('\n').at(-1) ?? '{}'
  try {
    return JSON.parse(line) as Record<string, number>
  } catch {
    return {}
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for worker barrier')
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
}

function messageFor(dbPath: string, turnId: string): { id: string; created_at: string } {
  const database = SqliteDatabase.open(dbPath)
  try {
    return database.connection.prepare(
      "SELECT id, created_at FROM messages WHERE turn_id = ? AND role = 'user'"
    ).get(turnId) as { id: string; created_at: string }
  } finally {
    database.close()
  }
}

function inspect(dbPath: string): {
  threads: Array<{ value: string; status: string }>
  evidence: number
  applied: number
  outbox: number
} {
  const database = SqliteDatabase.open(dbPath)
  try {
    const threads = database.connection.prepare(
      'SELECT value, status FROM relationship_threads ORDER BY kind'
    ).all() as unknown as Array<{ value: string; status: string }>
    const evidence = (database.connection.prepare('SELECT COUNT(*) AS n FROM relationship_thread_evidence').get() as { n: number }).n
    const applied = (database.connection.prepare(
      "SELECT COUNT(*) AS n FROM cognitive_effect_ledger WHERE module = 'relationship' AND state = 'applied'"
    ).get() as { n: number }).n
    const outbox = (database.connection.prepare(
      "SELECT COUNT(*) AS n FROM cognitive_outbox WHERE module = 'relationship'"
    ).get() as { n: number }).n
    return { threads, evidence, applied, outbox }
  } finally {
    database.close()
  }
}

/** A user message committed with its relationship obligation still pending. */
async function pendingTurn(directory: string, text: string): Promise<{ dbPath: string; turnId: string; messageId: string; conversationId: string; occurredAt: string }> {
  mkdirSync(directory, { recursive: true })
  const dbPath = join(directory, 'morrow.sqlite3')
  const stack = buildStack({ databasePath: dbPath, keepDatabase: true, growth: true, exploration: true, reflection: true })
  try {
    const conversation = stack.companion.createConversation()
    const turnId = randomUUID()
    stack.provider.failure = 'upstream timeout'
    await expect(stack.companion.sendChat({ conversationId: conversation.id, requestId: turnId, content: text, includeSensitive: false }, () => undefined)).rejects.toThrow()
    const message = stack.database.connection.prepare(
      "SELECT id, created_at FROM messages WHERE turn_id = ? AND role = 'user'"
    ).get(turnId) as { id: string; created_at: string }
    return { dbPath, turnId, messageId: message.id, conversationId: conversation.id, occurredAt: message.created_at }
  } finally {
    stack.close()
  }
}

describe('F6 — cross-process outbox invariants', () => {
  it('two processes contend: one claims, the other is busy, the write happens once', async () => {
    const dir = join(root, 'claim')
    const { dbPath, turnId } = await pendingTurn(dir, '以后叫我小林。')
    const barrier = join(dir, 'barrier')
    mkdirSync(barrier, { recursive: true })
    const clock = '2026-11-02T08:00:00.000Z'
    const winner = runWorker([dbPath, turnId, clock, barrier, 'normal'])
    await waitFor(() => readdirSync(barrier).some((name) => name.startsWith('ready-')))
    // The winner holds the claim and waits at the barrier. A second process
    // starts while the lease is live and must not run the projection.
    const contender = await runWorker([dbPath, turnId, clock, '', 'normal'])
    const contenderResult = parse(contender)
    expect(contenderResult.done ?? 0).toBe(0)
    expect(contenderResult.busy ?? 0).toBeGreaterThanOrEqual(1)
    writeFileSync(join(barrier, 'go'), '1')
    const winnerResult = await winner
    expect(winnerResult.code).toBe(0)
    expect(parse(winnerResult).done).toBe(1)
    const state = inspect(dbPath)
    expect(state.threads).toEqual([expect.objectContaining({ value: '小林', status: 'active' })])
    expect(state.evidence).toBe(1)
    expect(state.applied).toBe(1)
    // A later process finds nothing pending and changes nothing.
    const later = await runWorker([dbPath, turnId, clock, '', 'normal'])
    expect(later.code).toBe(0)
    expect(parse(later).done ?? 0).toBe(0)
    expect(inspect(dbPath).evidence).toBe(1)
  })

  it('a crashed claim is taken over after the lease expires, exactly once', async () => {
    const dir = join(root, 'lease')
    const { dbPath, turnId, messageId } = await pendingTurn(dir, '以后叫我小林。')
    const barrier = join(dir, 'barrier')
    mkdirSync(barrier, { recursive: true })
    const clock = '2026-11-02T08:00:00.000Z'
    const crashed = await runWorker([dbPath, turnId, clock, barrier, 'crash'])
    expect(crashed.code).toBe(9)
    expect(inspect(dbPath).evidence).toBe(0)
    // The crashed process left a running claim with a 60s lease.
    const future = new Date(Date.parse(clock) + 61_000).toISOString()
    const takeover = await runWorker([dbPath, turnId, future, '', 'normal'])
    expect(takeover.code).toBe(0)
    expect(parse(takeover).done).toBe(1)
    const state = inspect(dbPath)
    expect(state.evidence).toBe(1)
    expect(state.applied).toBe(1)
    expect(messageId).toBeTruthy()
  })

  it('an old worker whose lease was stolen cannot mark the obligation done', async () => {
    const dir = join(root, 'fencing')
    const { dbPath, turnId } = await pendingTurn(dir, '以后叫我小林。')
    const barrier = join(dir, 'barrier')
    mkdirSync(barrier, { recursive: true })
    const clock = '2026-11-02T08:00:00.000Z'
    const oldWorker = runWorker([dbPath, turnId, clock, barrier, 'normal'])
    await waitFor(() => readdirSync(barrier).some((name) => name.startsWith('ready-')))
    // The old claim is held at the barrier. A second process takes over after
    // the lease expires, projects and completes.
    const future = new Date(Date.parse(clock) + 61_000).toISOString()
    const takeover = await runWorker([dbPath, turnId, future, '', 'normal'])
    expect(takeover.code).toBe(0)
    expect(parse(takeover).done).toBe(1)
    // Release the old worker: its side effect is idempotent, but its completion
    // is fenced by the old generation and must be rejected.
    writeFileSync(join(barrier, 'go'), '1')
    const oldResult = await oldWorker
    expect(oldResult.code).toBe(0)
    expect(parse(oldResult).lostLease).toBe(1)
    const state = inspect(dbPath)
    expect(state.evidence).toBe(1)
    expect(state.applied).toBe(1)
    expect(state.outbox).toBe(1)
  })

  it('deleting the message while a process holds the claim prevents projection', async () => {
    const dir = join(root, 'delete')
    const { dbPath, turnId, messageId } = await pendingTurn(dir, '以后叫我小林。')
    const barrier = join(dir, 'barrier')
    mkdirSync(barrier, { recursive: true })
    const clock = '2026-11-02T08:00:00.000Z'
    const worker = runWorker([dbPath, turnId, clock, barrier, 'normal'])
    await waitFor(() => readdirSync(barrier).some((name) => name.startsWith('ready-')))
    // Delete on a different connection while the claim is held but before the
    // business write; then let the worker proceed.
    const database = SqliteDatabase.open(dbPath)
    try {
      database.connection.prepare('DELETE FROM messages WHERE id = ?').run(messageId)
    } finally {
      database.close()
    }
    writeFileSync(join(barrier, 'go'), '1')
    const result = await worker
    expect(result.code).toBe(0)
    const state = inspect(dbPath)
    expect(state.evidence).toBe(0)
    expect(state.threads.every((thread) => thread.status !== 'active')).toBe(true)
    expect(state.outbox).toBe(1)
  })

  it('an older obligation cannot override a newer correction across processes', async () => {
    const dir = join(root, 'stale')
    mkdirSync(dir, { recursive: true })
    const dbPath = join(dir, 'morrow.sqlite3')
    const stack = buildStack({ databasePath: dbPath, keepDatabase: true, growth: true, exploration: true, reflection: true })
    let oldMessage: { id: string; created_at: string }
    let conversationId = ''
    try {
      const conversation = stack.companion.createConversation()
      conversationId = conversation.id
      const oldTurn = randomUUID()
      const newTurn = randomUUID()
      const send = (turnId: string, content: string) => stack.companion.sendChat(
        { conversationId, requestId: turnId, content, includeSensitive: false },
        () => undefined
      )
      await send(oldTurn, '以后叫我阿林。')
      await send(newTurn, '以后叫我阿乐。')
      oldMessage = stack.database.connection.prepare(
        "SELECT id, created_at FROM messages WHERE turn_id = ? AND role = 'user'"
      ).get(oldTurn) as { id: string; created_at: string }
      // A stale holder's obligation, committed long ago and replayed now.
      const staleTurn = randomUUID()
      stack.database.connection.prepare(
        "INSERT INTO cognitive_outbox(turn_id, module, handler_version, conversation_id, user_message_id, occurred_at, analysis_json, status, attempts, created_at, updated_at) VALUES (?, 'relationship', 1, ?, ?, ?, NULL, 'pending', 0, ?, ?)"
      ).run(staleTurn, conversationId, oldMessage.id, oldMessage.created_at, new Date().toISOString(), new Date().toISOString())
      const result = await runWorker([dbPath, staleTurn, oldMessage.created_at, '', 'normal'])
      expect(result.code).toBe(0)
    } finally {
      stack.close()
    }
    const state = inspect(dbPath)
    const active = state.threads.filter((thread) => thread.status === 'active')
    expect(active.map((thread) => thread.value)).toEqual(['阿乐'])
    expect(state.threads.find((thread) => thread.value === '阿林')?.status).toBe('superseded')
  })
})
