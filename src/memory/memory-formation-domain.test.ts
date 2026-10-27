import { describe, expect, it } from 'vitest'
import { classifyMemorySensitivity, extractFormationCandidates, sharesFactAttribute } from './memory-formation-domain'

describe('deterministic memory candidate boundaries', () => {
  it('extracts durable self statements and preferences', () => {
    expect(extractFormationCandidates('我一直住在杭州。')[0]).toMatchObject({ kind: 'fact', sensitivity: 'personal' })
    expect(extractFormationCandidates('我喜欢独自研究新技术。')[0]).toMatchObject({ kind: 'preference' })
    expect(extractFormationCandidates('我最近开始学习 Blender。')[0]).toMatchObject({ kind: 'goal' })
  })

  it('rejects greetings temporary state questions third parties and assistant-directed text', () => {
    for (const text of [
      '你好。',
      '我今天很累。',
      '我住在哪里？',
      '我朋友住在杭州。',
      '你住在杭州。',
      '你说你住在杭州。'
    ]) {
      expect(extractFormationCandidates(text), text).toEqual([])
    }
  })

  it('recognises natural correction and preserves the superseded hint', () => {
    const candidate = extractFormationCandidates('我现在住在大阪，不再住杭州。')[0]!
    expect(candidate.kind).toBe('correction')
    expect(candidate.evidenceType).toBe('user_explicit_correction')
    expect(candidate.supersededHint).toContain('杭州')
  })

  it('keeps health and financial claims sensitive, preferences personal', () => {
    expect(classifyMemorySensitivity('我对花生严重过敏。')).toBe('sensitive')
    expect(classifyMemorySensitivity('我的工资是两万元。')).toBe('sensitive')
    expect(classifyMemorySensitivity('我喜欢独自研究新技术。')).toBe('personal')
  })

  it('links residence statements with almost no shared vocabulary', () => {
    expect(sharesFactAttribute('我现在住在大阪。', '我住在杭州。')).toBe(true)
    expect(sharesFactAttribute('我现在住在大阪。', '我的项目代号是 BLUE-731。')).toBe(false)
  })

  it('caps candidate claims at the storage bound', () => {
    const long = `我一直住在${'杭'.repeat(1200)}。`
    expect(extractFormationCandidates(long)).toEqual([])
  })
})
