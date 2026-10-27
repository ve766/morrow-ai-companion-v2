import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from './memory-domain'
import { MemoryContextAssembler } from './memory-context-assembler'

function memory(id: string, text: string, sensitivity: MemoryRecord['sensitivity'], status: MemoryRecord['status'] = 'active', overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    originalText: text,
    currentText: text,
    sourceCategory: 'user_explicit_input',
    status,
    sensitivity,
    createdAt: '2026-10-22T01:00:00.000Z',
    updatedAt: '2026-10-22T01:00:00.000Z',
    revision: 1,
    confidence: 85,
    lastConfirmedAt: '2026-10-22T01:00:00.000Z',
    ...overrides
  }
}

const assembler = new MemoryContextAssembler()

describe('bounded memory context assembly', () => {
  it('selects only relevant active memories and excludes sensitive records by default', () => {
    const result = assembler.assemble('我喜欢咖啡 concise', [
      memory('00000000-0000-4000-8000-000000000001', '我喜欢咖啡。', 'personal'),
      memory('00000000-0000-4000-8000-000000000002', 'I prefer concise answers.', 'normal'),
      memory('00000000-0000-4000-8000-000000000003', '我对咖啡过敏。', 'sensitive'),
      memory('00000000-0000-4000-8000-000000000004', '我喜欢茶。', 'personal', 'retracted')
    ], 'personal')

    expect(result.selected.map((item) => item.id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002'
    ])
    expect(result.text).toContain('user_explicit_input')
    expect(result.text).not.toContain('我对咖啡过敏')
    expect(result.text).not.toContain('我喜欢茶')
  })

  it('includes sensitive memory only when the caller raises the explicit sensitivity bound', () => {
    const sensitive = memory('00000000-0000-4000-8000-000000000005', 'This health detail is sensitive.', 'sensitive')
    expect(assembler.assemble('health detail', [sensitive], 'personal').selected).toEqual([])
    expect(assembler.assemble('health detail', [sensitive], 'sensitive').selected).toHaveLength(1)
  })

  it('does not let an oversized candidate crowd out later memories that fit the context budget', () => {
    const oversized = memory('00000000-0000-4000-8000-000000000006', `coffee ${'x'.repeat(1200)}`, 'normal')
    const compact = memory('00000000-0000-4000-8000-000000000007', 'coffee', 'normal')
    const result = assembler.assemble('coffee', [oversized, compact], 'personal', 25, 500)
    expect(result.selected.map((item) => item.id)).toEqual(['00000000-0000-4000-8000-000000000007'])
    expect(result.omitted).toBe(1)
    expect(result.characterCount).toBeLessThanOrEqual(500)
  })

  it('keeps a bounded continuity layer so a zero-overlap turn is not treated as a first meeting', () => {
    const result = assembler.assemble('今天有点累', [
      memory('00000000-0000-4000-8000-000000000011', '我住在杭州。', 'personal'),
      memory('00000000-0000-4000-8000-000000000012', '我常喝手冲咖啡。', 'personal')
    ], 'personal')

    expect(result.selected.map((item) => item.id)).toEqual([
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012'
    ])
    expect(result.selected.every((item) => item.match === 'continuity')).toBe(true)
    expect(result.text).toContain('"match":"continuity"')
  })

  it('labels term-matched records as topic matches and ranks them before continuity records', () => {
    const result = assembler.assemble('杭州天气如何', [
      memory('00000000-0000-4000-8000-000000000021', '我住在杭州。', 'personal'),
      memory('00000000-0000-4000-8000-000000000022', '我养了一只黑猫。', 'personal')
    ], 'personal')

    expect(result.selected.map((item) => item.id)).toEqual([
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000022'
    ])
    expect(result.selected.map((item) => item.match)).toEqual(['topic', 'continuity'])
  })

  it('caps continuity entries and never revives a retracted or still-sensitive record', () => {
    const bounded = new MemoryContextAssembler(1)
    const records = [
      memory('00000000-0000-4000-8000-000000000031', '我住在杭州。', 'personal'),
      memory('00000000-0000-4000-8000-000000000032', '我常喝手冲咖啡。', 'personal'),
      memory('00000000-0000-4000-8000-000000000033', '我撤回过的旧地址。', 'personal', 'retracted'),
      memory('00000000-0000-4000-8000-000000000034', '我的病史。', 'sensitive')
    ]
    const result = bounded.assemble('今天有点累', records, 'personal')

    expect(result.selected).toHaveLength(1)
    expect(result.selected[0]?.id).toBe('00000000-0000-4000-8000-000000000031')
    expect(result.text).not.toContain('我撤回过的旧地址')
    expect(result.text).not.toContain('我的病史')
  })

  it('preserves the previous lexical-only behaviour when continuity is disabled', () => {
    const lexicalOnly = new MemoryContextAssembler(0)
    const result = lexicalOnly.assemble('今天有点累', [
      memory('00000000-0000-4000-8000-000000000041', '我住在杭州。', 'personal')
    ], 'personal')

    expect(result.selected).toEqual([])
    expect(result.omitted).toBe(0)
  })

  it('spends a tight budget on the record the question needs, not on background', () => {
    const topic = memory('00000000-0000-4000-8000-000000000061', '我住在杭州。', 'personal')
    const background = [0, 1, 2].map((index) =>
      memory(`00000000-0000-4000-8000-00000000007${index}`, `我有一件与今天无关的事情，编号 ${index}。`, 'personal'))

    const generous = assembler.assemble('杭州天气如何', [topic, ...background], 'personal')
    expect(generous.selected.map((item) => item.match)).toEqual(['topic', 'continuity', 'continuity', 'continuity'])

    // A budget that fits exactly one entry must be spent on the topic match,
    // because continuity is background and the current question is not.
    const oneEntry = assembler.assemble('杭州天气如何', [topic], 'personal', 25, 100_000).characterCount
    const tight = assembler.assemble('杭州天气如何', [topic, ...background], 'personal', 25, oneEntry)
    expect(tight.selected).toHaveLength(1)
    expect(tight.selected[0]?.id).toBe(topic.id)
    expect(tight.selected[0]?.match).toBe('topic')
    expect(tight.characterCount).toBeLessThanOrEqual(oneEntry)
  })

  it('never lists the same record twice under two different reasons', () => {
    const result = assembler.assemble('杭州', [
      memory('00000000-0000-4000-8000-000000000081', '我住在杭州。', 'personal')
    ], 'personal')
    expect(result.selected).toHaveLength(1)
    expect(new Set(result.selected.map((item) => item.id)).size).toBe(result.selected.length)
  })

  it('marks an unconfirmed record past the staleness window instead of presenting it as current', () => {
    const now = '2026-10-26T00:00:00.000Z'
    const stale = memory('00000000-0000-4000-8000-000000000051', '我住在南京。', 'personal', 'active', {
      updatedAt: '2025-01-01T00:00:00.000Z',
      lastConfirmedAt: null
    })
    const fresh = memory('00000000-0000-4000-8000-000000000052', '我住在杭州。', 'personal', 'active', {
      updatedAt: '2026-10-20T00:00:00.000Z',
      lastConfirmedAt: '2026-10-20T00:00:00.000Z'
    })
    const result = assembler.assemble('住在哪里', [stale, fresh], 'personal', 25, 3000, now)

    const encoded = JSON.parse(result.text) as { memories: Array<{ id: string; stale: boolean }> }
    expect(encoded.memories.find((item) => item.id.endsWith('51'))?.stale).toBe(true)
    expect(encoded.memories.find((item) => item.id.endsWith('52'))?.stale).toBe(false)
  })

  // --- Task 1: lexical precision and conversation-context recall -----------

  it('does not match a short latin term inside a longer word', () => {
    const records = [
      memory('00000000-0000-4000-8000-000000000091', 'I work as a data analyst.', 'normal'),
      memory('00000000-0000-4000-8000-000000000092', 'I have a dog named Pixel.', 'normal'),
      memory('00000000-0000-4000-8000-000000000093', 'I dislike horror films.', 'normal')
    ]
    const result = new MemoryContextAssembler(0).assemble(
      'What is the airspeed of an unladen swallow? What pet do I have? Do I like scary movies?',
      records,
      'personal'
    )
    // "an" must not match "analyst", "do" must not match "dog", "like" must not
    // match "dislike". All three were substring false positives.
    expect(result.selected).toEqual([])
    expect(result.text).not.toContain('analyst')
    expect(result.text).not.toContain('Pixel')
    expect(result.text).not.toContain('horror')
  })

  it('still matches a whole latin token', () => {
    const result = new MemoryContextAssembler(0).assemble('coffee', [
      memory('00000000-0000-4000-8000-000000000094', 'I drink coffee every morning.', 'normal')
    ], 'personal')
    expect(result.selected.map((item) => item.match)).toEqual(['topic'])
  })

  it('recalls a memory that shares nothing with an elliptical turn but is on-topic in the recent conversation', () => {
    const record = memory('00000000-0000-4000-8000-000000000095', '我住在杭州。', 'personal')
    // Without prior context the record can only be background.
    const alone = assembler.assemble('那后天呢？', [record], 'personal')
    expect(alone.selected.map((item) => item.match)).toEqual(['continuity'])
    // With the prior turn ("下周去杭州出差") it is on-topic, but labelled
    // `context`, not `topic`: it did not match this turn's words.
    const withContext = assembler.assemble('那后天呢？', [record], 'personal', 25, 3000, '2026-10-26T00:00:00.000Z', '我下周要去杭州出差。')
    expect(withContext.selected.map((item) => item.match)).toEqual(['context'])
    expect(withContext.text).toContain('"match":"context"')
  })

  it('never lets conversation context revive a retracted or unauthorised record', () => {
    const retracted = memory('00000000-0000-4000-8000-000000000096', '我住在杭州。', 'personal', 'retracted')
    const sensitive = memory('00000000-0000-4000-8000-000000000097', '我住在杭州的医院。', 'sensitive')
    const result = assembler.assemble('那后天呢？', [retracted, sensitive], 'personal', 25, 3000, '2026-10-26T00:00:00.000Z', '我下周要去杭州出差。')
    expect(result.selected).toEqual([])
    expect(result.text).not.toContain('我住在杭州')
  })

  it('tags two same-subject records as one possible conflict and tells the model to surface it', () => {
    const result = assembler.assemble('我住在哪里', [
      memory('00000000-0000-4000-8000-000000000098', '我住在杭州。', 'personal'),
      memory('00000000-0000-4000-8000-000000000099', '我住在上海。', 'personal')
    ], 'personal')
    const encoded = JSON.parse(result.text) as { instruction: string; memories: Array<{ conflictGroup?: number }> }
    expect(encoded.memories.map((item) => item.conflictGroup)).toEqual([0, 0])
    expect(encoded.instruction).toContain('conflictGroup')
    expect(encoded.instruction).toContain('ask which is current')
  })

  it('does not group two unrelated records just because both are present', () => {
    const result = assembler.assemble('我住在哪里', [
      memory('00000000-0000-4000-8000-0000000000a1', '我住在杭州。', 'personal'),
      memory('00000000-0000-4000-8000-0000000000a2', '我喜欢手冲咖啡。', 'personal')
    ], 'personal')
    const encoded = JSON.parse(result.text) as { memories: Array<{ conflictGroup?: number }> }
    expect(encoded.memories.every((item) => item.conflictGroup === undefined)).toBe(true)
  })

  // --- Task 3: volatility-aware staleness ---------------------------------

  it('applies a shorter staleness window to volatile facts than to stable preferences', () => {
    const now = '2026-10-26T00:00:00.000Z'
    const reference = '2026-01-01T00:00:00.000Z' // 298 days
    const records = [
      memory('00000000-0000-4000-8000-0000000000b1', '我住在南京。', 'personal', 'active', { updatedAt: reference, lastConfirmedAt: null }),
      memory('00000000-0000-4000-8000-0000000000b2', '我喜欢咖啡。', 'personal', 'active', { updatedAt: reference, lastConfirmedAt: null }),
      memory('00000000-0000-4000-8000-0000000000b3', '我的项目代号是蓝鲸。', 'personal', 'active', { updatedAt: reference, lastConfirmedAt: null })
    ]
    const result = assembler.assemble('住在哪里 喜欢什么 项目', records, 'personal', 25, 3000, now)
    const encoded = JSON.parse(result.text) as { memories: Array<{ id: string; stale: boolean; volatility?: string; ageDays?: number }> }
    const bySuffix = (suffix: string) => encoded.memories.find((item) => item.id.endsWith(suffix))
    expect(bySuffix('b1')?.stale).toBe(true)   // volatile: > 90 days
    expect(bySuffix('b2')?.stale).toBe(false)  // stable: < 365 days
    expect(bySuffix('b3')?.stale).toBe(true)   // unknown: > 180 days
    expect(bySuffix('b1')?.volatility).toBe('volatile')
    expect(bySuffix('b2')?.volatility).toBe('stable')
    expect(bySuffix('b3')?.volatility).toBeUndefined()
    expect(bySuffix('b1')?.ageDays).toBe(298)
  })

  it('eventually flags a stable preference once it passes its own window', () => {
    const now = '2026-10-26T00:00:00.000Z'
    const old = memory('00000000-0000-4000-8000-0000000000b4', '我喜欢咖啡。', 'personal', 'active', {
      updatedAt: '2025-01-01T00:00:00.000Z',
      lastConfirmedAt: null
    })
    const result = assembler.assemble('喜欢什么', [old], 'personal', 25, 3000, now)
    const encoded = JSON.parse(result.text) as { memories: Array<{ stale: boolean }> }
    expect(encoded.memories[0]?.stale).toBe(true)
  })
})
