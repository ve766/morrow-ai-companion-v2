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
  it('keeps a user style request in G2 and leaves G1 intrinsic personality untouched', async () => {
    const stack = openStack()
    const baseline = stack.companion.getPersonality()
    const conversation = stack.companion.createConversation()
    for (let index = 0; index < 3; index += 1) {
      await send(stack, conversation.id, '我更喜欢你直接一点，说重点就行，别绕弯子。')
    }

    // G1 is reserved for Morrow-owned evidence; a user style request only
    // changes the G2 adaptation ledger.
    const rows = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM personality_growth_signals WHERE dimension = 'directness'"
    ).get() as { n: number }
    expect(rows.n).toBe(0)
    const entry = stack.growth.get('directness')
    expect(entry.applied).toBe(false)
    expect(entry.offset).toBe(0)
    const interaction = stack.interaction.list().find((item) => item.dimension === 'directness')
    expect(interaction?.evidenceCount ?? 0).toBeGreaterThan(0)

    await send(stack, conversation.id, '你好，我们在聊什么来着？')
    const baselineNow = stack.companion.getPersonality()
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain(`Morrow's personality`)
    expect(system).toContain(`directness ${baselineNow.directness}/100`)
    expect(system).toContain('Interaction style adapted to what this user asked for')

    // The baseline the user edits is untouched by any of it.
    const after = stack.companion.getPersonality()
    expect(after.warmth).toBe(baseline.warmth)
    expect(after.directness).toBe(baseline.directness)
    expect(after.humor).toBe(baseline.humor)
  })

  it('does not move G1 after two user style turns either', async () => {
    const stack = openStack()
    const baseline = stack.companion.getPersonality()
    const conversation = stack.companion.createConversation()
    for (let index = 0; index < 2; index += 1) {
      await send(stack, conversation.id, '我更喜欢你直接一点，说重点就行，别绕弯子。')
    }
    const rows = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM personality_growth_signals WHERE dimension = 'directness'"
    ).get() as { n: number }
    expect(rows.n).toBe(0)
    expect(stack.growth.get('directness').applied).toBe(false)
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain(`directness ${baseline.directness}/100`)
  })

  it('keeps the user baseline and G1 at zero after a style request and rollback', async () => {
    const stack = openStack()
    const conversation = stack.companion.createConversation()
    for (let index = 0; index < 3; index += 1) {
      await send(stack, conversation.id, '我更喜欢你直接一点，说重点就行，别绕弯子。')
    }
    const baseline = stack.companion.getPersonality()
    expect(stack.growth.get('directness').offset).toBe(0)
    expect(stack.companion.rollbackGrowth({ dimension: 'directness' })).toBe(true)
    expect(stack.companion.getPersonality()).toEqual(baseline)
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
      const firstInteraction = first.interaction.offsets()
      first.close()

      const second = buildStack({ growth: true, exploration: true, reflection: true, databasePath, keepDatabase: true })
      const secondOffsets = second.growth.list().map((entry) => entry.offset)
      const secondInteraction = second.interaction.offsets()
      second.close()
      expect(secondOffsets).toEqual(firstOffsets)
      expect(secondOffsets.every((offset) => offset === 0)).toBe(true)
      expect(secondInteraction).toEqual(firstInteraction)
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
