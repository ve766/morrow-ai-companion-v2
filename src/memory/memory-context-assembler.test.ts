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

  it('renders the same selection as entries without changing what is admitted', () => {
    const records = [
      memory('00000000-0000-4000-8000-000000000011', '我住在杭州。', 'personal'),
      memory('00000000-0000-4000-8000-000000000012', '我住在大阪。', 'personal')
    ]
    const json = assembler.assemble('我住在哪里？', records, 'personal')
    const entries = assembler.assemble('我住在哪里？', records, 'personal', 25, 3000, undefined, undefined, 'entries')
    // Same admission and same conflict groups; only the text differs.
    expect(entries.selected.map((item) => item.id)).toEqual(json.selected.map((item) => item.id))
    expect(entries.conflicts).toEqual(json.conflicts)
    expect(entries.text).toContain('1. 我住在')
    expect(entries.text).toContain('冲突：同一事实存在两种说法')
    expect(entries.text.startsWith('Untrusted evidence about the user')).toBe(true)
    expect(entries.text).not.toContain('"memories"')
  })

  it('does not let an oversized candidate crowd out later memories that fit the context budget', () => {
    const oversized = memory('00000000-0000-4000-8000-000000000006', `coffee ${'x'.repeat(1200)}`, 'normal')
    const compact = memory('00000000-0000-4000-8000-000000000007', 'coffee', 'normal')
    const result = assembler.assemble('coffee', [oversized, compact], 'personal', 25, 500)
    expect(result.selected.map((item) => item.id)).toEqual(['00000000-0000-4000-8000-000000000007'])
    expect(result.omitted).toBe(1)
    expect(result.characterCount).toBeLessThanOrEqual(500)
  })
})

describe('context utility: conflict and staleness reach the ranking', () => {
  // Both records are equally relevant, so the order is decided by the utility
  // terms rather than by overlap. `selected[].score` is the pre-ranking
  // relevance, so the assertion is on the order, which is what the ranking
  // actually produces.
  const now = '2026-10-29T00:00:00.000Z'
  const query = '我住在哪里'

  it('ranks a record involved in an unresolved conflict below its twin', () => {
    const conflicted = memory('11111111-1111-4111-8111-000000000901', '我住在杭州。', 'personal')
    const plain = memory('11111111-1111-4111-8111-000000000902', '我住在杭州。', 'personal')

    const tie = assembler.assemble(query, [conflicted, plain], 'personal', 25, 3000, now)
    const ranked = assembler.assemble(query, [conflicted, plain], 'personal', 25, 3000, now, undefined, 'json', new Set([conflicted.id]))

    // Control: without the conflict signal the two are interchangeable.
    expect(new Set(tie.selected.map((item) => item.id))).toEqual(new Set([conflicted.id, plain.id]))
    expect(ranked.selected.map((item) => item.id)).toEqual([plain.id, conflicted.id])
  })

  it('penalises a record that was never confirmed and is old', () => {
    const stale = memory('11111111-1111-4111-8111-000000000903', '我住在杭州。', 'personal', 'active', {
      lastConfirmedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    const confirmed = memory('11111111-1111-4111-8111-000000000904', '我住在杭州。', 'personal', 'active', {
      lastConfirmedAt: '2026-10-25T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    const assembled = assembler.assemble(query, [stale, confirmed], 'personal', 25, 3000, now)
    expect(assembled.selected.map((item) => item.id)).toEqual([confirmed.id, stale.id])
  })
})

describe('context utility: preference fit reaches the ranking', () => {
  const now = '2026-10-29T00:00:00.000Z'

  it('promotes a memory that is about a dimension the user personalised', () => {
    const aboutDepth = memory('11111111-1111-4111-8111-000000000911', '回答要简短一点。', 'personal')
    const unrelated = memory('11111111-1111-4111-8111-000000000912', '回答要简短一点。', 'personal')

    const tied = assembler.assemble('回答', [aboutDepth, unrelated], 'personal', 25, 3000, now)
    expect(new Set(tied.selected.map((item) => item.id))).toEqual(new Set([aboutDepth.id, unrelated.id]))

    // P is supplied by PersonalizationService.personalizationFit; only one of the
    // two records is treated as being about the personalised dimension.
    const ranked = assembler.assemble('回答', [aboutDepth, unrelated], 'personal', 25, 3000, now, undefined, 'json',
      undefined,
      (record) => (record.id === aboutDepth.id ? 0.6 : 0))
    expect(ranked.selected.map((item) => item.id)).toEqual([aboutDepth.id, unrelated.id])
  })
})
