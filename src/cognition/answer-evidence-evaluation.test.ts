import { describe, expect, it } from 'vitest'
import { evaluateAnswerEvidence } from './answer-evidence-evaluation'

const memory = (id: string, content: string, overrides: Partial<{ status: 'active' | 'unresolved'; conflictWith: string[] }> = {}) => ({ id, content, ...overrides })

describe('phase 2 D: answer evidence assessment', () => {
  it('counts a delivered value that appears in the reply', () => {
    const result = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')] })
    expect(result).toMatchObject({ outcome: 'used_correctly', scored: true, matchedEvidenceIds: ['m1'] })
  })

  it('counts evidence that was delivered and ignored', () => {
    const result = evaluateAnswerEvidence({ reply: '这个问题我不方便回答。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')] })
    expect(result).toMatchObject({ outcome: 'delivered_not_used', scored: true })
  })

  it('detects a reply that reverses the delivered polarity', () => {
    const result = evaluateAnswerEvidence({ reply: '你不对花生过敏。', callSucceeded: true, memories: [memory('m1', '我对花生严重过敏。')] })
    expect(result).toMatchObject({ outcome: 'contradicts_evidence', contradictedEvidenceIds: ['m1'] })
  })

  it('detects a negation that follows the value instead of preceding it', () => {
    // This is a real false pass found by the Phase-2 benchmark: the reply names
    // the value and reverses the fact *after* it.
    const result = evaluateAnswerEvidence({ reply: '好的，花生不引起过敏反应，对你来说没有害处。', callSucceeded: true, memories: [memory('m1', '我对花生严重过敏。')] })
    expect(result).toMatchObject({ outcome: 'contradicts_evidence', contradictedEvidenceIds: ['m1'] })
    // A correct sentence that negates something else is not a contradiction.
    expect(evaluateAnswerEvidence({ reply: '你对花生过敏，不能吃花生糖。', callSucceeded: true, memories: [memory('m1', '我对花生严重过敏。')] })).toMatchObject({ outcome: 'used_correctly' })
  })

  it('detects a silently picked side of a delivered conflict', () => {
    const memories = [
      memory('m1', '我住在杭州。', { status: 'unresolved', conflictWith: ['m2'] }),
      memory('m2', '我住在大阪。', { status: 'unresolved', conflictWith: ['m1'] })
    ]
    expect(evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories })).toMatchObject({ outcome: 'used_wrong_or_stale' })
    // Naming the conflict is the required behaviour, so it is not a failure.
    expect(evaluateAnswerEvidence({ reply: '两条记录冲突：一条说杭州，一条说大阪。你想以哪个为准？', callSucceeded: true, memories })).toMatchObject({ outcome: 'used_correctly' })
  })

  it('counts a reasonable admission of missing evidence', () => {
    const result = evaluateAnswerEvidence({ reply: '我这边没有关于车牌号的记忆，你能告诉我吗？', callSucceeded: true, memories: [] })
    expect(result).toMatchObject({ outcome: 'reasonable_unknown', scored: true })
  })

  it('does not score a failed call or an unsupported answer', () => {
    expect(evaluateAnswerEvidence({ reply: '', callSucceeded: false, memories: [memory('m1', '我住在杭州。')] })).toMatchObject({ outcome: 'not_scorable', scored: false, detail: 'provider_call_failed' })
    expect(evaluateAnswerEvidence({ reply: '好的。', callSucceeded: true, memories: [] })).toMatchObject({ outcome: 'not_scorable', scored: false })
  })

  it('never reports a score without a stated reason code', () => {
    const outcomes = [
      evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')] }),
      evaluateAnswerEvidence({ reply: '不知道。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')] }),
      evaluateAnswerEvidence({ reply: '', callSucceeded: false, memories: [] })
    ]
    for (const outcome of outcomes) expect(outcome.detail).toMatch(/^[a-z_]+$/u)
  })
})
