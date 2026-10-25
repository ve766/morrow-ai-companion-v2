import { describe, expect, it } from 'vitest'
import {
  canTransitionMemory,
  isRetrievableMemory,
  transitionMemory,
  validateMemorySearchQuery,
  validateMemoryText,
  type MemoryRecord
} from './memory-domain'

const initial: MemoryRecord = {
  id: '06d9f3b8-941d-49c6-8214-3b2324c40791',
  originalText: 'The user explicitly entered the original note.',
  currentText: 'The user explicitly entered the original note.',
  sourceCategory: 'user_explicit_input',
  status: 'active',
  sensitivity: 'personal',
  createdAt: '2026-10-22T01:00:00.000Z',
  updatedAt: '2026-10-22T01:00:00.000Z',
  revision: 1,
  confidence: 85,
  lastConfirmedAt: '2026-10-22T01:00:00.000Z'
}

describe('explicit memory domain rules', () => {
  it('accepts meaningful Unicode text and rejects invalid text', () => {
    expect(() => validateMemoryText('  我自己输入的内容 🌱  ')).not.toThrow()
    for (const value of ['', '   ', 'x'.repeat(4001), 'a\u0000b', 'a\u0007b', null, [], { text: 'not a string' }]) {
      expect(() => validateMemoryText(value)).toThrow()
    }
    expect(() => validateMemorySearchQuery('  ')).toThrow()
    expect(() => validateMemorySearchQuery('x'.repeat(257))).toThrow()
  })

  it('keeps the original text and links each correction to the prior revision', () => {
    const corrected = transitionMemory(initial, { type: 'correct', content: 'Corrected note.' }, '2026-10-22T02:00:00.000Z')
    expect(corrected).toMatchObject({
      id: initial.id,
      originalText: initial.originalText,
      currentText: 'Corrected note.',
      status: 'active',
      revision: 2,
      updatedAt: '2026-10-22T02:00:00.000Z'
    })
    expect(initial.currentText).toBe(initial.originalText)
  })

  it('removes retracted memories from retrieval and permits an explicit restore', () => {
    expect(canTransitionMemory('active', { type: 'retract' })).toBe(true)
    const retracted = transitionMemory(initial, { type: 'retract' }, '2026-10-22T02:00:00.000Z')
    expect(isRetrievableMemory(retracted)).toBe(false)
    expect(() => transitionMemory(retracted, { type: 'retract' }, '2026-10-22T03:00:00.000Z')).toThrow()
    const restored = transitionMemory(retracted, { type: 'restore' }, '2026-10-22T04:00:00.000Z')
    expect(restored).toMatchObject({ status: 'active', revision: 3, currentText: initial.currentText })
    expect(isRetrievableMemory(restored)).toBe(true)
  })
})
