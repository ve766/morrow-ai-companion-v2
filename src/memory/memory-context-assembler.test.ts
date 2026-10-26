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
})
