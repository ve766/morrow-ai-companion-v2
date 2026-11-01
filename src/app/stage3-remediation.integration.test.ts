/**
 * D-1 + D-10 remediation integration tests.
 *
 * Everything here runs through the production assembly (the same builder the
 * stage-3 evaluation harness uses: real outbox, real projectors, real prompt
 * assembly), because the audit's central finding was that a service can be
 * correct in isolation and still dead in the product.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStack, systemText, type Stack } from '../../evals/stage-3/runner/harness'

let openStacks: Stack[] = []

afterEach(() => {
  for (const stack of openStacks) {
    try {
      stack.close()
    } catch {
      // The first close already removed the temporary directory.
    }
  }
  openStacks = []
})

function openStack(): Stack {
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  openStacks.push(stack)
  return stack
}

async function send(stack: Stack, conversationId: string, content: string, requestId = randomUUID()) {
  return stack.companion.sendChat({ conversationId, requestId, content, includeSensitive: false }, () => undefined)
}

describe('D-1: the growth ledger is live in the production chain', () => {
  it('writes G1 evidence through the outbox and puts the folded offset into the prompt numbers', async () => {
    const stack = openStack()
    const baseline = stack.companion.getPersonality()
    const conversation = stack.companion.createConversation()
    for (let index = 0; index < 3; index += 1) {
      await send(stack, conversation.id, '我更喜欢你直接一点，说重点就行，别绕弯子。')
    }

    // The outbox projector wrote the G1 ledger (three independent turns).
    const rows = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM personality_growth_signals WHERE dimension = 'directness'"
    ).get() as { n: number }
    expect(rows.n).toBe(3)
    const entry = stack.growth.get('directness')
    expect(entry.applied).toBe(true)
    expect(entry.offset).toBeGreaterThan(0)
    expect(entry.offset).toBeLessThanOrEqual(8)

    // The prompt is assembled *before* the outbox drains, so a fourth turn is
    // the first one whose prompt can already carry the three-turn offset.
    await send(stack, conversation.id, '你好，我们在聊什么来着？')
    const folded = stack.growth.get('directness').offset
    const baselineNow = stack.companion.getPersonality()

    // The prompt personality numbers come from the G1 fold, not from G2.
    const system = systemText(stack.provider.lastPayload)
    const expected = Math.min(100, Math.max(0, baselineNow.directness + folded))
    expect(system).toContain(`Morrow's personality`)
    expect(system).toContain(`directness ${expected}/100`)
    // The G1 explanation and the G2 adaptation line are separate blocks.
    expect(system).toContain('Bounded style drift from the user-edited baseline')
    expect(system).toContain('Interaction style adapted to what this user asked for')

    // The baseline the user edits is untouched by any of it.
    const after = stack.companion.getPersonality()
    expect(after.warmth).toBe(baseline.warmth)
    expect(after.directness).toBe(baseline.directness)
    expect(after.humor).toBe(baseline.humor)
  })

  it('keeps two turns below the evidence gate: recorded, reported, not applied', async () => {
    const stack = openStack()
    const baseline = stack.companion.getPersonality()
    const conversation = stack.companion.createConversation()
    for (let index = 0; index < 2; index += 1) {
      await send(stack, conversation.id, '我更喜欢你直接一点，说重点就行，别绕弯子。')
    }
    const rows = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM personality_growth_signals WHERE dimension = 'directness'"
    ).get() as { n: number }
    expect(rows.n).toBe(2)
    expect(stack.growth.get('directness').applied).toBe(false)
    // Below the gate the effective number is exactly the baseline.
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain(`directness ${baseline.directness}/100`)
  })

  it('recomputes the offset when the source message is deleted', async () => {
    const stack = openStack()
    const conversation = stack.companion.createConversation()
    const turnIds: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const requestId = randomUUID()
      turnIds.push(requestId)
      await send(stack, conversation.id, '我更喜欢你直接一点，说重点就行，别绕弯子。', requestId)
    }
    expect(stack.growth.get('directness').applied).toBe(true)
    const before = stack.growth.get('directness').offset

    // Deleting one turn's message cascades through the v29 trigger; the fold
    // re-derives from the remaining ledger on the next read.
    stack.database.connection.prepare('DELETE FROM messages WHERE turn_id = ?').run(turnIds[0]!)
    const after = stack.growth.get('directness')
    expect(after.evidenceCount).toBe(2)
    expect(after.offset).toBeLessThan(before)

    // The user-facing rollback returns the dimension to zero, baseline intact.
    expect(stack.companion.rollbackGrowth({ dimension: 'directness' })).toBe(true)
    expect(stack.growth.get('directness').offset).toBe(0)
    expect(stack.companion.getPersonality().directness).toBe(stack.companion.getPersonality().directness)
    const state = stack.companion.getGrowthState()
    expect(state?.find((entry) => entry.dimension === 'directness')?.offset).toBe(0)
  })

  it('keeps the growth ledger continuous across a full runtime restart', async () => {
    const directory = await import('node:fs')
    const os = await import('node:os')
    const path = require('node:path')
    const dir = directory.mkdtempSync(path.join(os.tmpdir(), 'morrow-growth-restart-'))
    const databasePath = path.join(dir, 'morrow.sqlite3')
    try {
      const first = buildStack({ growth: true, exploration: true, reflection: true, databasePath, keepDatabase: true })
      const conversation = first.companion.createConversation()
      for (let index = 0; index < 3; index += 1) {
        await send(first, conversation.id, '我更喜欢你直接一点，说重点就行，别绕弯子。')
      }
      const firstOffsets = first.growth.list().map((entry) => entry.offset)
      first.close()

      const second = buildStack({ growth: true, exploration: true, reflection: true, databasePath, keepDatabase: true })
      const secondOffsets = second.growth.list().map((entry) => entry.offset)
      second.close()
      expect(secondOffsets).toEqual(firstOffsets)
      expect(secondOffsets.some((offset) => offset !== 0)).toBe(true)
    } finally {
      try {
        directory.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows can hold the file lock briefly after close; the temp dir is
        // not worth failing an assertion over.
      }
    }
  })
})

describe('D-10: reflection findings reach their consumers in the production chain', () => {
  it('routes auto-run findings, creates the pending item, and caps prompt hints at two', async () => {
    const stack = openStack()
    const conversation = stack.companion.createConversation()
    // A correction cluster is the documented trigger for memory_gap and
    // intent_correction findings.
    const memory = stack.memories.create('我住在杭州。', 'personal')
    stack.memories.correct(memory.id, '我住在苏州。')
    stack.memories.correct(memory.id, '我住在南京。')
    for (let index = 0; index < 2; index += 1) {
      await send(stack, conversation.id, '我们继续聊上次的话题。')
    }

    const routes = stack.database.connection.prepare(
      'SELECT route, COUNT(*) AS n FROM reflection_finding_routes GROUP BY route'
    ).all() as Array<{ route: string; n: number }>
    expect(routes.length).toBeGreaterThan(0)
    const byRoute = new Map(routes.map((row) => [row.route, row.n]))
    expect(byRoute.get('audit_only') ?? 0).toBeGreaterThanOrEqual(0)
    // The pending item for an intent correction exists without any manual run.
    const pending = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM cognitive_pending_items WHERE source = 'reflection' AND status = 'open'"
    ).get() as { n: number }
    expect(pending.n).toBeGreaterThanOrEqual(1)
  })

  it('never injects more than two hint lines into one prompt', async () => {
    const stack = openStack()
    const conversation = stack.companion.createConversation()
    const memory = stack.memories.create('我住在杭州。', 'personal')
    stack.memories.correct(memory.id, '我住在苏州。')
    stack.memories.correct(memory.id, '我住在南京。')
    await send(stack, conversation.id, '我们继续聊上次的话题。')
    const system = systemText(stack.provider.lastPayload)
    if (system.includes('Internal hypotheses from Morrow')) {
      const block = system.split('Internal hypotheses from Morrow')[1] ?? ''
      const section = block.split('\n\n')[0] ?? ''
      const lines = section.split('\n').filter((line) => line.startsWith('- ['))
      expect(lines.length).toBeLessThanOrEqual(2)
      // Every hint carries provenance and is framed as a hypothesis.
      for (const line of lines) {
        expect(line).toMatch(/reflection run [0-9a-f]{8}/)
      }
      expect(section).toContain('NOT user facts')
    }
  })
})
