import { describe, expect, it } from 'vitest'
import { readFactSlot, slotsConflict, valuesDisagree } from './fact-slot'

describe('explainable fact slots', () => {
  it('reads a stated fact into subject, predicate and value', () => {
    expect(readFactSlot('我住在杭州。')).toMatchObject({ subject: 'user', predicate: 'residence', value: '杭州', question: false })
    expect(readFactSlot('我不喜欢吃香菜。')).toMatchObject({ predicate: 'preference', value: '不吃香菜' })
    // Negation must survive: liking and disliking the same thing conflict.
    expect(slotsConflict(readFactSlot('我喜欢吃香菜。'), readFactSlot('我不喜欢吃香菜。'))).toBe(true)
    expect(readFactSlot('我的项目代号是 BLUE-731。')).toMatchObject({ predicate: 'project_code', value: 'blue-731' })
    expect(readFactSlot('我对花生严重过敏。')).toMatchObject({ predicate: 'health' })
  })

  it('marks a question about the predicate instead of inventing a value', () => {
    expect(readFactSlot('我住在哪里？')).toMatchObject({ predicate: 'residence', value: '', question: true })
    expect(readFactSlot('我喜欢什么？')).toMatchObject({ predicate: 'preference', value: '', question: true })
  })

  it('returns null when the predicate cannot be named', () => {
    expect(readFactSlot('帮我写一段排序算法。')).toBeNull()
    expect(readFactSlot('我养了一只叫咪咪的猫。')).toBeNull()
  })

  it('treats a rewording as the same value but two cities as different', () => {
    expect(valuesDisagree('杭州', '杭州市')).toBe(false)
    expect(valuesDisagree('杭州', '大阪')).toBe(true)
    expect(valuesDisagree('', '杭州')).toBe(false)
  })

  it('conflicts only inside the same predicate with different values', () => {
    const a = readFactSlot('我住在杭州。')!
    const b = readFactSlot('我住在大阪。')!
    const c = readFactSlot('我喜欢杭州。')!
    expect(slotsConflict(a, b)).toBe(true)
    expect(slotsConflict(a, c)).toBe(false)
    expect(slotsConflict(a, null)).toBe(false)
  })
})
