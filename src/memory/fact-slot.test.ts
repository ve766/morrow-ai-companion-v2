import { describe, expect, it } from 'vitest'
import { compareFactValues, readFactSlot, slotsConflict, valuesDisagree } from './fact-slot'

describe('explainable fact slots', () => {
  it('extracts the value for every predicate instead of consuming it', () => {
    expect(readFactSlot('我今年30岁。')).toMatchObject({ predicate: 'age', value: '30', kind: 'assertion' })
    expect(readFactSlot('我的年龄是 30。')).toMatchObject({ predicate: 'age', value: '30' })
    expect(readFactSlot('我对花生严重过敏。')).toMatchObject({ predicate: 'health', value: '花生', kind: 'assertion' })
    expect(readFactSlot('我叫小王。')).toMatchObject({ predicate: 'name', value: '小王' })
    expect(readFactSlot('我住在杭州。')).toMatchObject({ predicate: 'residence', value: '杭州' })
    expect(readFactSlot('我在甲公司工作。')).toMatchObject({ predicate: 'employer', value: '甲' })
    expect(readFactSlot('我的职业是设计师。')).toMatchObject({ predicate: 'job_role', value: '设计师' })
    expect(readFactSlot('我在学习 Blender。')).toMatchObject({ predicate: 'study', value: 'blender' })
    expect(readFactSlot('我不喜欢吃香菜。')).toMatchObject({ predicate: 'preference', value: '吃香菜', kind: 'negated' })
    expect(readFactSlot('我计划明年换工作。')).toMatchObject({ predicate: 'goal', value: '明年换工作' })
    expect(readFactSlot('我的项目代号是 BLUE-731。')).toMatchObject({ predicate: 'project_code', value: 'blue-731' })
  })

  it('marks a question instead of inventing a value', () => {
    expect(readFactSlot('我住在哪里？')).toMatchObject({ predicate: 'residence', value: '', kind: 'question' })
    expect(readFactSlot('我今年多少岁？')).toMatchObject({ predicate: 'age', value: '', kind: 'question' })
    expect(readFactSlot('我喜欢什么？')).toMatchObject({ predicate: 'preference', value: '', kind: 'question' })
  })

  it('keeps hypothetical and quoted statements uncertain', () => {
    expect(readFactSlot('如果我喜欢吃香菜呢？')).toMatchObject({ kind: 'uncertain', value: '' })
    expect(readFactSlot('他听说我住在杭州。')).toMatchObject({ kind: 'uncertain', value: '' })
  })

  it('returns null when the predicate cannot be named', () => {
    expect(readFactSlot('帮我写一段排序算法。')).toBeNull()
    expect(readFactSlot('我养了一只叫咪咪的猫。')).toBeNull()
  })
})

describe('three-state fact comparison', () => {
  const slot = (text: string) => readFactSlot(text)

  it('treats a normalised rewording as equivalent', () => {
    expect(compareFactValues(slot('我住在杭州。'), slot('我现居杭州市。'))).toBe('equivalent')
    expect(valuesDisagree('杭州', '杭州市')).toBe(false)
  })

  it('reports a proven contradiction', () => {
    expect(compareFactValues(slot('我住在杭州。'), slot('我住在大阪。'))).toBe('conflict')
    expect(valuesDisagree('杭州', '大阪')).toBe(true)
    expect(slotsConflict(slot('我住在杭州。'), slot('我住在大阪。'))).toBe(true)
  })

  it('keeps substring containment uncertain instead of equivalent', () => {
    expect(compareFactValues(slot('我喜欢猫。'), slot('我喜欢猫狗。'))).toBe('uncertain')
    expect(slotsConflict(slot('我喜欢猫。'), slot('我喜欢猫狗。'))).toBe(false)
  })

  it('treats polarity difference as a contradiction', () => {
    expect(compareFactValues(slot('我喜欢吃香菜。'), slot('我不喜欢吃香菜。'))).toBe('conflict')
  })

  it('does not compare values across different predicates', () => {
    expect(compareFactValues(slot('我住在杭州。'), slot('我喜欢杭州。'))).toBe('uncertain')
    expect(slotsConflict(slot('我住在杭州。'), slot('我喜欢杭州。'))).toBe(false)
  })

  it('treats a question or a missing slot as uncertain, never as agreement', () => {
    expect(compareFactValues(slot('我住在哪里？'), slot('我住在杭州。'))).toBe('uncertain')
    expect(compareFactValues(null, slot('我住在杭州。'))).toBe('uncertain')
  })
})
