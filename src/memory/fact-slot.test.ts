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

describe('slice 2.2: sentence mood, negation scope and time state', () => {
  const slot = (text: string) => readFactSlot(text)

  it('recognises sentence-final questions without turning them into facts', () => {
    for (const text of ['我喜欢猫吗？', '我住在杭州吗？', '我今年多少岁？', '我喜欢什么？']) {
      expect(slot(text), text).toMatchObject({ kind: 'question', value: '' })
    }
    expect(slot('我住在杭州。')).toMatchObject({ kind: 'assertion', value: '杭州' })
    expect(slot('我不喜欢猫。')).toMatchObject({ kind: 'negated', value: '猫' })
    expect(slot('如果我喜欢猫呢？')).toMatchObject({ kind: 'uncertain', value: '' })
  })

  it('binds health negation to the predicate instead of the value', () => {
    expect(slot('我对花生严重过敏。')).toMatchObject({ predicate: 'health', value: '花生', kind: 'assertion' })
    expect(slot('我对花生不过敏。')).toMatchObject({ predicate: 'health', value: '花生', kind: 'negated' })
    expect(slot('我没有花生过敏。')).toMatchObject({ predicate: 'health', value: '花生', kind: 'negated' })
    // 花生不 must never be read as the object.
    expect(slot('我对花生不过敏。')?.value).not.toContain('不')
  })

  it('keeps a past and a present health state undecided instead of merging them', () => {
    const mixed = slot('我以前对花生过敏，现在不过敏了。')
    expect(mixed).toMatchObject({ kind: 'uncertain', time: 'mixed', value: '' })
    expect(compareFactValues(mixed, slot('我对花生严重过敏。'))).toBe('uncertain')
  })

  it('keeps modal and reported health statements uncertain', () => {
    expect(slot('我可能对花生过敏。')).toMatchObject({ kind: 'uncertain', value: '' })
    expect(slot('听说我对花生过敏。')).toMatchObject({ kind: 'uncertain', value: '' })
  })

  it('handles negation scope, double negation and contrast', () => {
    expect(slot('我不喜欢猫。')).toMatchObject({ kind: 'negated', value: '猫' })
    expect(slot('我喜欢猫。')).toMatchObject({ kind: 'assertion', value: '猫' })
    expect(slot('我不再喜欢猫了。')).toMatchObject({ kind: 'negated', value: '猫' })
    expect(slot('我不是不喜欢猫。')).toMatchObject({ kind: 'uncertain', value: '' })
    expect(slot('我以前喜欢猫，但现在不喜欢了。')).toMatchObject({ kind: 'uncertain', time: 'mixed', value: '' })
  })

  it('treats a negated health statement as a contradiction of the positive one', () => {
    expect(compareFactValues(slot('我对花生严重过敏。'), slot('我对花生不过敏。'))).toBe('conflict')
    expect(compareFactValues(slot('我对花生过敏。'), slot('我没有花生过敏。'))).toBe('conflict')
  })

  it('does not compare a question or an uncertain sentence as agreement', () => {
    expect(compareFactValues(slot('我喜欢猫吗？'), slot('我喜欢猫。'))).toBe('uncertain')
    expect(compareFactValues(slot('我可能对花生过敏。'), slot('我对花生过敏。'))).toBe('uncertain')
  })

  it('keeps different time states from becoming a contradiction', () => {
    const past = { ...slot('我住在杭州。')!, time: 'past' as const }
    const present = { ...slot('我住在大阪。')!, time: 'present' as const }
    expect(compareFactValues(past, present)).toBe('uncertain')
  })
})
