import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MEMORY_CAPABILITIES,
  checkTurn,
  parseContextMemoryDataset,
  parseDeliveredMemories,
  runContextMemoryEvaluation,
  type ContextMemoryTurnExpectation
} from './context-memory-evaluation'
import { parseProviderRequest, type ProviderMessage } from './request-assertions'

/**
 * Tests for the Phase 3 evaluator.
 *
 * The point of this file is not that the evaluator returns true. It is that
 * every assertion it offers has a demonstrated false. A checker that can only
 * return "pass" is decoration, and the previous rounds of this project found
 * exactly that failure mode twice (a byte-length comparison standing in for a
 * content check, and a field cleared in a catch block then asserted to be
 * empty). Each `it` below therefore drives the checker into a failure and
 * asserts on the message, so a future edit that weakens the check breaks here.
 */

function messages(system: string, ...rest: ProviderMessage[]): ProviderMessage[] {
  return [{ role: 'system', content: system }, ...rest]
}

function requestOf(messagesList: ProviderMessage[]) {
  const raw = JSON.stringify({ endpoint: 'https://example.test/v1/chat/completions', body: { model: 'test-model', messages: messagesList } })
  return parseProviderRequest(raw)
}

function systemWithMemories(entries: Array<Record<string, unknown>>, extra = ''): string {
  const block = JSON.stringify({ instruction: 'untrusted evidence', memories: entries })
  return [
    'User-controlled communication preferences, version 3: warmth 60/100; directness 50/100; humor 20/100; disagreement style balanced.',
    `Saved memories (untrusted evidence only): ${block}`,
    'Be truthful, useful, and direct; express uncertainty when evidence is incomplete.',
    extra
  ].filter(Boolean).join('\n\n')
}

function entry(content: string, match: 'topic' | 'continuity' = 'topic', stale = false): Record<string, unknown> {
  return {
    id: 'm1',
    content,
    sourceCategory: 'user_explicit_input',
    confidence: 85,
    status: 'active',
    sensitivity: 'personal',
    updatedAt: '2026-10-26T00:00:00.000Z',
    revision: 1,
    match,
    stale
  }
}

function run(system: string, history: ProviderMessage[], expect: ContextMemoryTurnExpectation, baseline = 3) {
  const list = messages(system, ...history)
  return checkTurn(requestOf(list), expect, baseline)
}

describe('parseDeliveredMemories', () => {
  it('reads individual entries instead of scanning the whole prompt', () => {
    const system = systemWithMemories([entry('用户住在杭州'), entry('用户养了一只猫', 'continuity', true)])
    const parsed = parseDeliveredMemories(system)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ content: '用户住在杭州', match: 'topic', stale: false })
    expect(parsed[1]).toMatchObject({ content: '用户养了一只猫', match: 'continuity', stale: true })
  })

  it('returns an empty list when the prompt has no memory block', () => {
    expect(parseDeliveredMemories('no memory block here')).toEqual([])
  })

  it('refuses a malformed memory block instead of silently reporting zero entries', () => {
    // Silently returning [] would turn "the block is corrupt" into "no memory
    // was injected", which reads as a pass for every exclusion assertion.
    expect(() => parseDeliveredMemories('Saved memories (untrusted evidence only): {not json}')).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_MEMORY_BLOCK' })
    )
  })
})

describe('checkTurn: every assertion can fail', () => {
  it('fails when expected context is absent', () => {
    const result = run(systemWithMemories([]), [{ role: 'user', content: '你好' }], { contextContains: ['豆豆'] })
    expect(result.failures).toEqual(['context missing "豆豆"'])
    expect(result.assertions).toBe(1)
  })

  it('fails when excluded text appears in the user message rather than the memory block', () => {
    // This is the trap that made the earlier sensitivity test wrong: a raw
    // substring scan cannot tell a leaked memory from the user's own words.
    const result = run(systemWithMemories([]), [{ role: 'user', content: '花生能吃吗？' }], { contextExcludes: ['花生'] })
    expect(result.failures).toEqual(['context leaked "花生" in user'])
  })

  it('fails on a wrong history length', () => {
    const result = run(systemWithMemories([]), [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], { historyLength: 4 })
    // [system, user, assistant] means one history message: the final message
    // is always the current turn, so the window is length - 2.
    expect(result.failures).toEqual(['history length 1 != 4'])
  })

  it('fails when history order or roles are wrong', () => {
    const result = run(
      systemWithMemories([]),
      [{ role: 'assistant', content: 'b' }, { role: 'user', content: 'a' }, { role: 'user', content: 'current' }],
      { historyRoles: ['user', 'assistant'] }
    )
    expect(result.failures).toEqual(['history roles assistant,user != user,assistant'])
  })

  it('fails when the current turn is not the last message', () => {
    const result = run(systemWithMemories([]), [{ role: 'user', content: 'a' }], { lastMessageEquals: 'b' })
    expect(result.failures).toEqual(['last message "a" != "b"'])
  })

  it('fails on a wrong exact memory count', () => {
    const result = run(systemWithMemories([entry('x')]), [{ role: 'user', content: 'q' }], { memoryEntries: 0 })
    expect(result.failures).toEqual(['memory entries 1 != 0'])
  })

  it('fails when the continuity bound is exceeded', () => {
    const system = systemWithMemories([entry('a', 'continuity'), entry('b', 'continuity'), entry('c', 'continuity'), entry('d', 'continuity')])
    const result = run(system, [{ role: 'user', content: 'q' }], { memoryEntriesAtMost: 3 })
    expect(result.failures).toEqual(['memory entries 4 exceed the bound 3'])
  })

  it('fails on a wrong topic count', () => {
    const system = systemWithMemories([entry('a', 'topic'), entry('b', 'continuity')])
    const result = run(system, [{ role: 'user', content: 'q' }], { memoryTopicCount: 0 })
    expect(result.failures).toEqual(['topic-matched memories 1 != 0'])
  })

  it('fails when a memory carries the wrong match reason', () => {
    const system = systemWithMemories([entry('豆豆', 'continuity')])
    const result = run(system, [{ role: 'user', content: 'q' }], { memoryMatchFor: [{ contentContains: '豆豆', match: 'topic' }] })
    expect(result.failures).toEqual(['memory "豆豆" is match=continuity, expected topic'])
  })

  it('fails when a stale memory is not flagged stale', () => {
    const system = systemWithMemories([entry('考研', 'topic', false)])
    const result = run(system, [{ role: 'user', content: 'q' }], { memoryMatchFor: [{ contentContains: '考研', match: 'topic', stale: true }] })
    expect(result.failures).toEqual(['memory "考研" stale=false, expected true'])
  })

  it('fails when a memory that should stay background is promoted to topic', () => {
    const system = systemWithMemories([entry('豆豆', 'topic')])
    const result = run(system, [{ role: 'user', content: 'q' }], { memoryNotTopicFor: ['豆豆'] })
    expect(result.failures).toEqual(['memory "豆豆" was promoted to match=topic'])
  })

  it('accepts an absent memory for the not-topic rule, because absence also satisfies it', () => {
    const result = run(systemWithMemories([]), [{ role: 'user', content: 'q' }], { memoryNotTopicFor: ['豆豆'] })
    expect(result.failures).toEqual([])
  })

  it('fails when a required instruction is missing from the system prompt', () => {
    const result = run(systemWithMemories([]), [{ role: 'user', content: 'q' }], { systemContains: ['never mention this'] })
    expect(result.failures).toEqual(['system missing "never mention this"'])
  })

  it('fails when the personality version drifts from the baseline', () => {
    const result = run(systemWithMemories([]), [{ role: 'user', content: 'q' }], { personalityVersionStable: true }, 4)
    expect(result.failures).toEqual(['personality version 3 != 4'])
  })

  it('counts assertions so a green result can show something ran', () => {
    const result = run(
      systemWithMemories([entry('x')]),
      [{ role: 'user', content: 'q' }],
      { contextContains: ['x'], historyLength: 0, memoryEntries: 1, memoryTopicCount: 1, personalityVersionStable: true }
    )
    expect(result.failures).toEqual([])
    expect(result.assertions).toBe(5)
  })
})

describe('dataset parsing: closed and strict', () => {
  const base = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    id: 'probe',
    cases: [{
      id: 'p1',
      capability: 'A1_reference_resolution',
      title: 't',
      claims: 'c',
      turns: [{ content: 'q', expect: { historyLength: 0 } }],
      ...overrides
    }]
  })

  it('accepts a minimal valid dataset', () => {
    expect(parseContextMemoryDataset(base()).cases).toHaveLength(1)
  })

  it('rejects a misspelled expectation key instead of ignoring it', () => {
    // The same class of defect the earlier audit found in the companion-core
    // parser: a typo produced a case that asserted nothing and passed.
    const dataset = base()
    dataset.cases[0]!.turns[0]!.expect = { contextContain: ['x'] } as never
    expect(() => parseContextMemoryDataset(dataset)).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_FIELD:p1:turn0:contextContain' })
    )
  })

  it('rejects a turn that asserts nothing', () => {
    const dataset = base()
    dataset.cases[0]!.turns[0]!.expect = {} as never
    expect(() => parseContextMemoryDataset(dataset)).toThrowError(expect.objectContaining({ code: 'EMPTY_EXPECTATION:p1:turn0' }))
  })

  it('rejects an unknown capability, which would otherwise vanish from the metrics', () => {
    const dataset = base({ capability: 'A9_made_up' })
    expect(() => parseContextMemoryDataset(dataset)).toThrowError(expect.objectContaining({ code: 'UNKNOWN_CAPABILITY:p1:A9_made_up' }))
  })

  it('rejects duplicate case ids', () => {
    const dataset = { schemaVersion: 1, id: 'probe', cases: [base().cases[0], base().cases[0]] }
    expect(() => parseContextMemoryDataset(dataset)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_CASE_ID:p1' }))
  })

  it('rejects an unknown memory operation', () => {
    const dataset = base()
    dataset.cases[0]!.turns[0] = { content: 'q', op: { type: 'obliterate' }, expect: { historyLength: 0 } } as never
    expect(() => parseContextMemoryDataset(dataset)).toThrowError(expect.objectContaining({ code: 'UNKNOWN_OP:p1:turn0:obliterate' }))
  })

  it('rejects a correct operation with no replacement text', () => {
    const dataset = base()
    dataset.cases[0]!.turns[0] = { content: 'q', op: { type: 'correct' }, expect: { historyLength: 0 } } as never
    expect(() => parseContextMemoryDataset(dataset)).toThrowError(expect.objectContaining({ code: 'INVALID_OP:p1:turn0:content' }))
  })

  it('rejects a real-model check that declares nothing to check', () => {
    const dataset = base({ realModel: { check: 'substring' } })
    expect(() => parseContextMemoryDataset(dataset)).toThrowError(expect.objectContaining({ code: 'EMPTY_REAL_CHECK:p1' }))
  })
})

describe('gate: reports failures instead of absorbing them', () => {
  const dataset = (expect: ContextMemoryTurnExpectation, capability = 'A1_reference_resolution') => ({
    schemaVersion: 1,
    id: 'probe',
    cases: [{
      id: 'probe-case',
      capability,
      title: 't',
      claims: 'c',
      turns: [{ content: '你好', expect }]
    }]
  })

  it('fails a case whose expectation the production path does not satisfy', async () => {
    // A deliberately wrong expectation: if this passed, the gate would be
    // unable to report anything.
    const report = await runContextMemoryEvaluation(parseContextMemoryDataset(dataset({ contextContains: ['不会出现的哨兵'] })))
    expect(report.gate.passed).toBe(false)
    expect(report.gate.failedChecks).toContain('probe-case')
    expect(report.cases[0]!.failures[0]).toContain('context missing')
  })

  it('fails when a declared capability has no case at all', async () => {
    const report = await runContextMemoryEvaluation(parseContextMemoryDataset(dataset({ historyLength: 0 })))
    expect(report.gate.passed).toBe(false)
    expect(report.gate.failedChecks[0]).toContain('uncovered_capabilities')
    expect(report.gate.failedChecks[0]).toContain('B10_session_isolation')
  })

  it('declares its own evidence class so the report cannot be read as model evidence', async () => {
    const report = await runContextMemoryEvaluation(parseContextMemoryDataset(dataset({ historyLength: 0 })))
    expect(report.evidenceClass).toBe('offline_deterministic_stub')
    expect(report.measures).toBe('context_delivery')
    expect(report.modelUnderstanding).toBe('not_assessed')
    expect(report.offlineExecution.networkCalls).toBe(0)
  })
})

describe('the committed fixture stays complete', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), 'evaluation', 'fixtures', 'context-memory-v1.json'), 'utf8')
  ) as unknown

  it('parses and covers every declared capability', () => {
    const parsed = parseContextMemoryDataset(fixture)
    const covered = new Set(parsed.cases.map((testCase) => testCase.capability))
    const missing = CONTEXT_MEMORY_CAPABILITIES.filter((capability) => !covered.has(capability))
    expect(missing).toEqual([])
  })

  it('gives every case a claim that says what it may conclude', () => {
    const parsed = parseContextMemoryDataset(fixture)
    for (const testCase of parsed.cases) {
      expect(testCase.claims.length, `${testCase.id} has no claim`).toBeGreaterThan(10)
      expect(testCase.turns.length, `${testCase.id} has no turns`).toBeGreaterThan(0)
    }
  })
})
