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
})
