import { describe, expect, it } from 'vitest'
import {
  canTargetCorrection,
  classifyMemorySensitivity,
  extractFormationCandidates,
  sharesFactAttribute,
  validateCorrectionTarget
} from './memory-formation-domain'

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

describe('P1-B correction intent is not inferred from broad present-tense markers', () => {
  // The matrix the hardening round requires: a plain statement must never be
  // classified as a correction, and an explicit correction must be.
  const matrix: ReadonlyArray<{ text: string; kind: string | null; correction: boolean; superseded?: string }> = [
    { text: '我现在在学习 Blender。', kind: 'fact', correction: false },
    { text: '我现在在大阪工作。', kind: 'fact', correction: false },
    { text: '我现在住在大阪。', kind: 'fact', correction: false },
    { text: '我不住大阪了，现在搬到京都了。', kind: 'correction', correction: true, superseded: '大阪' },
    { text: '刚才说错了，我住在京都，不是大阪。', kind: 'correction', correction: true, superseded: '大阪' },
    { text: '我以前喜欢摄影，现在更喜欢绘画。', kind: 'correction', correction: true, superseded: '摄影' },
    { text: '我不喜欢大阪。', kind: 'preference', correction: false }
  ]

  for (const row of matrix) {
    it(`classifies "${row.text}" as ${row.kind ?? 'nothing'}`, () => {
      const candidate = extractFormationCandidates(row.text)[0]
      if (row.kind === null) {
        expect(candidate).toBeUndefined()
        return
      }
      expect(candidate?.kind).toBe(row.kind)
      expect(candidate?.correctionHint).toBe(row.correction)
      expect(candidate?.evidenceType).toBe(row.correction ? 'user_explicit_correction' : 'user_explicit_statement')
      if (row.superseded !== undefined) expect(candidate?.supersededHint).toContain(row.superseded)
    })
  }

  it('drops a pure past-tense statement instead of storing it as a current fact', () => {
    expect(extractFormationCandidates('我曾经住在大阪。')).toEqual([])
  })

  it('refuses to bind a preference candidate to a residence record', () => {
    expect(canTargetCorrection('我喜欢独自研究。', '我现在住在大阪。')).toBe(false)
    expect(canTargetCorrection('我搬到京都了。', '我现在住在大阪。')).toBe(true)
  })
})

describe('P1-A correction target re-validation', () => {
  const target = {
    id: '11111111-1111-4111-8111-111111111111',
    currentText: '我现在住在大阪。',
    status: 'active' as const,
    revision: 3,
    sensitivity: 'personal' as const
  }

  it('accepts an edit that still describes the same attribute and subject', () => {
    expect(validateCorrectionTarget({ editedContent: '我住在京都。', target, expectedRevision: 3 }))
      .toMatchObject({ ok: true, reason: null })
  })

  it('refuses an edit that changed the fact attribute', () => {
    const result = validateCorrectionTarget({ editedContent: '我喜欢独自研究。', target, expectedRevision: 3 })
    expect(result).toMatchObject({ ok: false, reason: 'attribute_mismatch' })
    expect(result.detail).toContain('preference')
  })

  it('refuses a target that vanished, was retracted, or moved on', () => {
    expect(validateCorrectionTarget({ editedContent: '我住在京都。', target: null, expectedRevision: null }))
      .toMatchObject({ ok: false, reason: 'target_missing' })
    expect(validateCorrectionTarget({ editedContent: '我住在京都。', target: { ...target, status: 'retracted' }, expectedRevision: 3 }))
      .toMatchObject({ ok: false, reason: 'target_inactive' })
    expect(validateCorrectionTarget({ editedContent: '我住在京都。', target: { ...target, revision: 4 }, expectedRevision: 3 }))
      .toMatchObject({ ok: false, reason: 'target_changed' })
  })

  it('refuses a subject switch and a no-op edit', () => {
    expect(validateCorrectionTarget({ editedContent: '他住在京都。', target, expectedRevision: 3 }))
      .toMatchObject({ ok: false, reason: 'subject_mismatch' })
    expect(validateCorrectionTarget({ editedContent: '我现在住在大阪。', target, expectedRevision: 3 }))
      .toMatchObject({ ok: false, reason: 'content_unchanged' })
  })

  it('falls back to shared evidence for facts the classifier cannot name', () => {
    const pet = { ...target, currentText: '我养了一只叫咪咪的猫。' }
    expect(validateCorrectionTarget({ editedContent: '我养了一只叫花花的猫。', target: pet, expectedRevision: 3 }).ok).toBe(true)
    expect(validateCorrectionTarget({ editedContent: '我最近在读一本小说。', target: pet, expectedRevision: 3 }))
      .toMatchObject({ ok: false, reason: 'attribute_mismatch' })
  })

})

describe('P1-2 fact attributes are fine-grained enough to block same-family swaps', () => {
  const target = (currentText: string) => ({
    id: '11111111-1111-4111-8111-111111111111',
    currentText,
    status: 'active' as const,
    revision: 2,
    sensitivity: 'personal' as const
  })

  // The comparison table the hardening round requires. Each row names the
  // target memory, the edited candidate and the expected refusal reason
  // (`null` means "may proceed to the same-attribute correction check").
  const rows: ReadonlyArray<{ target: string; edited: string; reason: string | null }> = [
    { target: '我叫小王。', edited: '我今年 30 岁。', reason: 'attribute_mismatch' },
    { target: '我出生于 1996 年。', edited: '我现在住在京都。', reason: 'attribute_mismatch' },
    { target: '我住在大阪。', edited: '我喜欢独自研究。', reason: 'attribute_mismatch' },
    { target: '我在甲公司工作。', edited: '我在学习 Blender。', reason: 'attribute_mismatch' },
    // A project name and a project code are different slots; "both are about a
    // project" is not evidence that one may replace the other.
    { target: '我的项目代号是 BLUE-731。', edited: '我的项目名称是 Morrow。', reason: 'attribute_mismatch' },
    { target: '我现在住在大阪。', edited: '我现在住在京都。', reason: null },
    // A historical fact must not be rewritten into a current one.
    { target: '我以前住在大阪。', edited: '我现在住在京都。', reason: 'temporal_mismatch' },
    // A preference reversal is a value change, not a denial of the slot.
    { target: '我喜欢摄影。', edited: '我不喜欢摄影。', reason: null },
    { target: '我在学习 Blender。', edited: '我现在在大阪工作。', reason: 'attribute_mismatch' }
  ]

  for (const row of rows) {
    it(`"${row.target}" <- "${row.edited}" => ${row.reason ?? 'allowed'}`, () => {
      const result = validateCorrectionTarget({ editedContent: row.edited, target: target(row.target), expectedRevision: 2 })
      if (row.reason === null) {
        expect(result).toMatchObject({ ok: true })
        return
      }
      expect(result).toMatchObject({ ok: false, reason: row.reason })
    })
  }

  it('refuses third-person, quoted, conditional, hypothetical and uncertain edits', () => {
    const base = target('我住在大阪。')
    const cases: ReadonlyArray<{ edited: string; reason: string }> = [
      { edited: '他住在京都。', reason: 'subject_mismatch' },
      { edited: '我听说「我住在京都」。', reason: 'not_an_assertion' },
      { edited: '如果我住在京都。', reason: 'not_an_assertion' },
      { edited: '假设我住在京都。', reason: 'not_an_assertion' },
      { edited: '我可能住在京都。', reason: 'not_an_assertion' },
      { edited: '我不确定我现在住在哪里。', reason: 'not_an_assertion' }
    ]
    for (const item of cases) {
      expect(validateCorrectionTarget({ editedContent: item.edited, target: base, expectedRevision: 2 }), item.edited)
        .toMatchObject({ ok: false, reason: item.reason })
    }
  })

  it('refuses a pure denial of a single-valued fact and points at retraction', () => {
    const result = validateCorrectionTarget({
      editedContent: '我不再住在大阪。',
      target: target('我住在大阪。'),
      expectedRevision: 2
    })
    expect(result).toMatchObject({ ok: false, reason: 'negation_mismatch' })
    expect(result.detail).toContain('retract')
  })

  it('refuses any correction whose creation-time revision is unknown', () => {
    expect(validateCorrectionTarget({ editedContent: '我住在京都。', target: target('我住在大阪。'), expectedRevision: null }))
      .toMatchObject({ ok: false, reason: 'revision_unproven' })
  })
})
