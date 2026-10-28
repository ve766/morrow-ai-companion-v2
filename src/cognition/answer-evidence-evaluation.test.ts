import { describe, expect, it } from 'vitest'
import { evaluateAnswerEvidence } from './answer-evidence-evaluation'

const memory = (id: string, content: string, overrides: Partial<{ status: 'active' | 'unresolved'; conflictWith: string[] }> = {}) => ({ id, content, ...overrides })

describe('phase 2 D: answer evidence assessment', () => {
  it('counts a delivered value that appears in the reply', () => {
    const result = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')] })
    expect(result).toMatchObject({ outcome: 'used_correctly', scored: true, matchedEvidenceIds: ['m1'] })
    expect(result.dimensions.evidenceMentioned).toEqual({ status: 'pass', reason: 'delivered_value_named' })
  })

  it('counts evidence that was delivered and ignored', () => {
    const result = evaluateAnswerEvidence({ reply: '这个问题我不方便回答。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')] })
    expect(result).toMatchObject({ outcome: 'delivered_not_used', scored: true })
    expect(result.dimensions.evidenceMentioned).toMatchObject({ status: 'fail' })
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
    const picked = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories })
    expect(picked).toMatchObject({ outcome: 'used_wrong_or_stale' })
    expect(picked.dimensions.conflictAcknowledged).toEqual({ status: 'fail', reason: 'silently_picked_one_side' })
    expect(picked.unacknowledgedConflictIds.sort()).toEqual(['m1', 'm2'])
    // Naming the conflict is the required behaviour, so it is not a failure.
    const acknowledged = evaluateAnswerEvidence({ reply: '两条记录冲突：一条说杭州，一条说大阪。你想以哪个为准？', callSucceeded: true, memories })
    expect(acknowledged).toMatchObject({ outcome: 'used_correctly' })
    expect(acknowledged.dimensions.conflictAcknowledged).toMatchObject({ status: 'pass' })
  })

  it('counts a reasonable admission of missing evidence', () => {
    const result = evaluateAnswerEvidence({ reply: '我这边没有关于车牌号的记忆，你能告诉我吗？', callSucceeded: true, memories: [] })
    expect(result).toMatchObject({ outcome: 'reasonable_unknown', scored: true })
    expect(result.dimensions.uncertaintyAppropriate).toMatchObject({ status: 'pass' })
  })

  it('does not score a failed or cancelled call', () => {
    expect(evaluateAnswerEvidence({ reply: '', callSucceeded: false, memories: [memory('m1', '我住在杭州。')] })).toMatchObject({ outcome: 'not_scorable', scored: false, detail: 'provider_call_failed' })
    expect(evaluateAnswerEvidence({ reply: '', callSucceeded: false, callOutcome: 'cancelled', memories: [] })).toMatchObject({ outcome: 'not_scorable', scored: false, detail: 'provider_call_cancelled' })
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

describe('phase 2.1 B: the six dimensions are independent', () => {
  const hangzhou = memory('m1', '我住在杭州。')

  it('separates "mentioned the value" from "answered the question"', () => {
    // The reply names the delivered value but answers a different question.
    const result = evaluateAnswerEvidence({
      reply: '我住在杭州。',
      callSucceeded: true,
      memories: [hangzhou],
      question: '我对什么过敏？',
      expectedAnswerTerms: ['花生']
    })
    expect(result.dimensions.evidenceMentioned).toMatchObject({ status: 'pass' })
    expect(result.dimensions.answersCurrentQuestion).toEqual({ status: 'fail', reason: 'expected_answer_absent' })
  })

  it('separates "mentioned the value" from "kept the time range"', () => {
    const result = evaluateAnswerEvidence({ reply: '你过去住在杭州。', callSucceeded: true, memories: [hangzhou], question: '我住在哪里？' })
    expect(result.dimensions.evidenceMentioned).toMatchObject({ status: 'pass' })
    expect(result.dimensions.temporalConsistent).toEqual({ status: 'fail', reason: 'reply_shifts_present_to_past' })
    expect(result).toMatchObject({ outcome: 'contradicts_evidence' })
  })

  it('keeps a genuinely past memory out of the time failure', () => {
    const past = memory('m2', '我以前住在杭州。')
    const result = evaluateAnswerEvidence({ reply: '你以前住在杭州。', callSucceeded: true, memories: [past], question: '我以前住在哪里？' })
    expect(result.dimensions.temporalConsistent).toMatchObject({ status: 'pass' })
  })

  it('does not count a question back as correct use', () => {
    // Found by manual review: "你对花生过敏吗？" names the value and asks back.
    const result = evaluateAnswerEvidence({ reply: '你对花生过敏吗？', callSucceeded: true, memories: [memory('m1', '我对花生严重过敏。')] })
    expect(result.dimensions.evidenceMentioned).toMatchObject({ status: 'pass' })
    expect(result).toMatchObject({ outcome: 'delivered_not_used', detail: 'evidence_named_but_reply_is_question' })
  })

  it('does not call a repeated word a correct answer', () => {
    const result = evaluateAnswerEvidence({
      reply: '你提过杭州。',
      callSucceeded: true,
      memories: [memory('m3', '我住在杭州，养了一只猫。')],
      question: '我养了什么？',
      expectedAnswerTerms: ['猫']
    })
    expect(result.dimensions.evidenceMentioned).toMatchObject({ status: 'pass' })
    expect(result.dimensions.answersCurrentQuestion).toMatchObject({ status: 'fail' })
  })

  it('does not accept an acknowledgement that never says the two statements differ', () => {
    const memories = [
      memory('m1', '我住在杭州。', { status: 'unresolved', conflictWith: ['m2'] }),
      memory('m2', '我住在大阪。', { status: 'unresolved', conflictWith: ['m1'] })
    ]
    const result = evaluateAnswerEvidence({ reply: '我记得你提过几次住处。', callSucceeded: true, memories })
    expect(result.dimensions.conflictAcknowledged).toEqual({ status: 'fail', reason: 'conflict_ignored' })
  })

  it('flags a specific fact stated without evidence', () => {
    const fabricated = evaluateAnswerEvidence({ reply: '你的车牌号是 浙A12345。', callSucceeded: true, memories: [] })
    expect(fabricated).toMatchObject({ outcome: 'unsupported_answer', scored: true })
    expect(fabricated.dimensions.uncertaintyAppropriate).toEqual({ status: 'fail', reason: 'specific_fact_without_evidence' })
    const probe = evaluateAnswerEvidence({ reply: '可能是蓝色的。', callSucceeded: true, memories: [], fabricationPattern: /蓝色/u })
    expect(probe).toMatchObject({ outcome: 'unsupported_answer' })
  })

  it('does not score a reply it cannot read', () => {
    const unreadable = evaluateAnswerEvidence({ reply: '好的。', callSucceeded: true, memories: [memory('m4', '嗯。')] })
    expect(unreadable).toMatchObject({ outcome: 'not_scorable', scored: false, detail: 'evidence_unreadable' })
    expect(unreadable.dimensions.evidenceMentioned).toEqual({ status: 'unscored', reason: 'evidence_unreadable' })
  })

  it('can score a memory that has no readable predicate', () => {
    // A pet's name has no fact predicate; the repeated bigram is the only
    // distinctive token, and without it this memory was always unscorable.
    const pet = evaluateAnswerEvidence({ reply: '你的猫叫咪咪。', callSucceeded: true, memories: [memory('m5', '我养了一只叫咪咪的猫。')] })
    expect(pet.dimensions.evidenceMentioned).toMatchObject({ status: 'pass' })
    expect(pet.outcome).toBe('used_correctly')
    const missed = evaluateAnswerEvidence({ reply: '我可能不知道它叫什么名字。', callSucceeded: true, memories: [memory('m5', '我养了一只叫咪咪的猫。')] })
    expect(missed.dimensions.evidenceMentioned).toMatchObject({ status: 'fail' })
  })

  it('does not let a generic token make a two-state memory look usable', () => {
    // 过敏 repeats inside this memory, but the memory states two different
    // states; using the repeated bigram would score it as "used".
    const mixed = evaluateAnswerEvidence({ reply: '我以前对花生过敏，现在不过敏了。', callSucceeded: true, memories: [memory('m6', '我以前对花生过敏，现在不过敏了。')] })
    expect(mixed.dimensions.evidenceMentioned).toEqual({ status: 'unscored', reason: 'evidence_unreadable' })
    expect(mixed).toMatchObject({ outcome: 'not_scorable', scored: false })
  })

  it('reads a time shift that sits after the whole predicate', () => {
    // Found by manual review: "已经过去了" is eight characters after 花生.
    const result = evaluateAnswerEvidence({ reply: '你对花生的过敏已经过去了，不需要关注它了。', callSucceeded: true, memories: [memory('m1', '我对花生严重过敏。')] })
    expect(result.dimensions.temporalConsistent).toEqual({ status: 'fail', reason: 'reply_shifts_present_to_past' })
    expect(result.outcome).toBe('contradicts_evidence')
  })

  it('leaves a dimension unscored when it has no basis instead of passing it', () => {
    const result = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: [hangzhou] })
    expect(result.dimensions.answersCurrentQuestion).toEqual({ status: 'unscored', reason: 'no_question_supplied' })
    expect(result.dimensions.conflictAcknowledged).toEqual({ status: 'unscored', reason: 'no_conflict_delivered' })
    expect(result.dimensions.uncertaintyAppropriate).toEqual({ status: 'unscored', reason: 'evidence_used' })
  })
})
