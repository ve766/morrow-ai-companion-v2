import { describe, expect, it } from 'vitest'
import { evaluateAnswerEvidence, isAnswerEvidenceAssessment } from './answer-evidence-evaluation'

const memory = (id: string, content: string, overrides: Partial<{ status: 'active' | 'unresolved'; conflictWith: string[] }> = {}) => ({ id, content, ...overrides })

const conflictPair = (left = '我住在杭州。', right = '我住在大阪。') => [
  memory('m1', left, { status: 'unresolved', conflictWith: ['m2'] }),
  memory('m2', right, { status: 'unresolved', conflictWith: ['m1'] })
]

describe('phase 2.1 B: uncertainty is not a keyword', () => {
  it('accepts an admission with no invented fact', () => {
    const result = evaluateAnswerEvidence({ reply: '我不知道你的车牌号。', callSucceeded: true, memories: [], question: '我的车牌号是多少？' })
    expect(result).toMatchObject({ outcome: 'reasonable_unknown', scored: true })
    expect(result.dimensions.uncertaintyExpressed).toMatchObject({ status: 'pass' })
    expect(result.dimensions.unsupportedClaimDetected).toMatchObject({ status: 'pass' })
  })

  it('rejects "sorry, not sure, but your plate is 京A12345"', () => {
    // The defect this replaces: matching 不确定 was enough to pass.
    const result = evaluateAnswerEvidence({ reply: '抱歉，我不确定，但你的车牌号是京A12345。', callSucceeded: true, memories: [], question: '我的车牌号是多少？' })
    expect(result.dimensions.uncertaintyExpressed).toMatchObject({ status: 'pass' })
    expect(result.dimensions.unsupportedClaimDetected).toMatchObject({ status: 'fail', reason: 'specific_claim_without_evidence' })
    expect(result.dimensions.uncertaintyAppropriate).toMatchObject({ status: 'fail', reason: 'claim_without_evidence' })
    expect(result.outcome).toBe('unsupported_answer')
  })

  it('rejects "not sure, probably 京A12345"', () => {
    const result = evaluateAnswerEvidence({ reply: '我不能确定，应该是京A12345。', callSucceeded: true, memories: [], question: '我的车牌号是多少？' })
    expect(result).toMatchObject({ outcome: 'unsupported_answer' })
  })

  it('accepts an explicit statement that memory is missing plus a question back', () => {
    const result = evaluateAnswerEvidence({ reply: '我没有相关记忆，你可以告诉我。', callSucceeded: true, memories: [], question: '我的车牌号是多少？' })
    expect(result).toMatchObject({ outcome: 'reasonable_unknown', scored: true })
  })

  it('accepts a correct value that the evidence supports', () => {
    const result = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')], question: '我住在哪里？' })
    expect(result).toMatchObject({ outcome: 'used_correctly' })
    expect(result.dimensions.unsupportedClaimDetected).toMatchObject({ status: 'pass' })
  })

  it('does not accept a different city as use of the evidence', () => {
    const result = evaluateAnswerEvidence({ reply: '你住在上海。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')], question: '我住在哪里？' })
    expect(result).toMatchObject({ outcome: 'delivered_not_used' })
  })

  it('treats a hedged restatement of the stored fact as reported speech, not a time shift', () => {
    const result = evaluateAnswerEvidence({
      reply: '你之前说住在杭州，但我没有足够信息判断你现在是否仍住在那里。',
      callSucceeded: true,
      memories: [memory('m1', '我住在杭州。')],
      question: '我住在哪里？'
    })
    expect(result.dimensions.temporalConsistent).not.toMatchObject({ status: 'fail' })
    expect(result.dimensions.evidenceMentioned).toMatchObject({ status: 'pass' })
  })

  it('does not count a failed call as a reasonable admission', () => {
    const result = evaluateAnswerEvidence({ reply: '我不能确定。', callSucceeded: false, memories: [], question: '我的车牌号是多少？' })
    expect(result).toMatchObject({ outcome: 'not_scorable', scored: false, detail: 'provider_call_failed' })
    expect(result.scoring).toEqual({ status: 'unscored', reason: 'provider_call_failed' })
  })

  it('rejects a reply that mixes a supported fact with an invented one', () => {
    const result = evaluateAnswerEvidence({
      reply: '你住在杭州，你的车牌号是京A12345。',
      callSucceeded: true,
      memories: [memory('m1', '我住在杭州。')],
      question: '我住在哪里？',
      fabricationPattern: /京[A-Z]\d{5}/u
    })
    expect(result).toMatchObject({ outcome: 'unsupported_answer' })
  })

  it('does not accept a partial restatement as an answer to the question', () => {
    const result = evaluateAnswerEvidence({
      reply: '你养了猫。',
      callSucceeded: true,
      memories: [memory('m1', '我住在杭州。')],
      question: '我住在哪里？',
      expectedAnswerTerms: ['杭州']
    })
    expect(result.dimensions.answersCurrentQuestion).toMatchObject({ status: 'fail' })
    expect(result.outcome).toBe('delivered_not_used')
  })
})

describe('phase 2.1.1 C: conflict handling', () => {
  const question = '我住在哪里？'

  it('1. fails when two same-slot entries disagree and the reply picks one', () => {
    const result = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: conflictPair(), question })
    expect(result.dimensions.conflictAcknowledged).toMatchObject({ status: 'fail', reason: 'silently_picked_one_side' })
    expect(result.conflict.groups[0]).toMatchObject({ unsupportedSideSelected: true, valuesIdentified: false })
    expect(result.outcome).toBe('used_wrong_or_stale')
  })

  it('2. has nothing to judge when the entries do not conflict', () => {
    const result = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')], question })
    expect(result.dimensions.conflictAcknowledged).toMatchObject({ status: 'unscored', reason: 'no_conflict_delivered' })
  })

  it('3. does not treat two coexisting preferences as a conflict', () => {
    const memories = [memory('m1', '我喜欢咖啡。'), memory('m2', '我喜欢茶。')]
    const result = evaluateAnswerEvidence({ reply: '你喜欢咖啡和茶。', callSucceeded: true, memories, question: '我喜欢什么？' })
    expect(result.dimensions.conflictAcknowledged).toMatchObject({ status: 'unscored' })
  })

  it('4. fails when the reply restates only one side', () => {
    const result = evaluateAnswerEvidence({ reply: '根据记忆，你住在大阪。', callSucceeded: true, memories: conflictPair(), question })
    expect(result.outcome).toBe('used_wrong_or_stale')
    expect(result.dimensions.conflictAcknowledged).toMatchObject({ reason: 'silently_picked_one_side' })
  })

  it('5. fails when the reply only says there is a conflict', () => {
    const result = evaluateAnswerEvidence({ reply: '这里有冲突。', callSucceeded: true, memories: conflictPair(), question })
    expect(result.conflict.groups[0]).toMatchObject({ valuesIdentified: false, relationshipExplained: false })
    expect(result.dimensions.conflictAcknowledged).toMatchObject({ status: 'fail', reason: 'conflict_claimed_without_values' })
  })

  it('6. fails when both values are listed but their relationship is not explained', () => {
    const result = evaluateAnswerEvidence({ reply: '记忆里写了杭州，也写了大阪。', callSucceeded: true, memories: conflictPair(), question })
    expect(result.conflict.groups[0]).toMatchObject({ valuesIdentified: true, relationshipExplained: false, clarificationRequested: false })
    expect(result.dimensions.conflictAcknowledged).toMatchObject({ status: 'fail', reason: 'values_listed_without_relationship' })
  })

  it('7. passes when both values are named and the user is asked which is current', () => {
    const result = evaluateAnswerEvidence({
      reply: '保存的记忆有两条相互矛盾的说法：一条说杭州，一条说大阪。你现在以哪个为准？',
      callSucceeded: true,
      memories: conflictPair(),
      question
    })
    expect(result.dimensions.conflictAcknowledged).toMatchObject({ status: 'pass' })
    expect(result.outcome).toBe('used_correctly')
  })

  it('8. fails when one of two independent conflict groups is ignored', () => {
    const memories = [
      memory('m1', '我住在杭州。', { status: 'unresolved', conflictWith: ['m2'] }),
      memory('m2', '我住在大阪。', { status: 'unresolved', conflictWith: ['m1'] }),
      memory('m3', '我的职业是设计师。', { status: 'unresolved', conflictWith: ['m4'] }),
      memory('m4', '我的职业是工程师。', { status: 'unresolved', conflictWith: ['m3'] })
    ]
    const result = evaluateAnswerEvidence({
      reply: '两条关于住处的说法不一致：杭州和大阪，你现在以哪个为准？',
      callSucceeded: true,
      memories,
      // Both groups are relevant only when the question mentions both facts.
      question: '你还记得我住在哪里、做什么工作吗？'
    })
    expect(result.conflict.groups).toHaveLength(2)
    const residence = result.conflict.groups.find((group) => group.predicate === 'residence')
    const role = result.conflict.groups.find((group) => group.predicate === 'job_role')
    expect(residence?.outcome).toBe('pass')
    expect(role?.outcome).toBe('fail')
    expect(result.conflict.outcome).toBe('fail')
    expect(result.outcome).toBe('used_wrong_or_stale')
  })

  it('9. leaves an unrelated conflict group unscored', () => {
    const memories = [
      memory('m1', '我住在杭州。', { status: 'unresolved', conflictWith: ['m2'] }),
      memory('m2', '我住在大阪。', { status: 'unresolved', conflictWith: ['m1'] }),
      memory('m3', '我的职业是设计师。', { status: 'unresolved', conflictWith: ['m4'] }),
      memory('m4', '我的职业是工程师。', { status: 'unresolved', conflictWith: ['m3'] })
    ]
    const result = evaluateAnswerEvidence({
      reply: '两条住处记录不一致：杭州和大阪，你现在以哪个为准？',
      callSucceeded: true,
      memories,
      question
    })
    const role = result.conflict.groups.find((group) => group.predicate === 'job_role')
    expect(role).toMatchObject({ relevant: false, outcome: 'unscored', reason: 'group_not_relevant_to_question' })
    expect(result.conflict.outcome).toBe('pass')
  })

  it('10. does not raise a conflict for an unrelated question', () => {
    const result = evaluateAnswerEvidence({
      reply: '这是一个冒泡排序的实现。',
      callSucceeded: true,
      memories: conflictPair(),
      question: '帮我写一段排序算法。'
    })
    expect(result.conflict.outcome).toBe('unscored')
    expect(result.dimensions.conflictAcknowledged.status).toBe('unscored')
  })

  it('14. does not invent a conflict from a single entry', () => {
    const result = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')], question })
    expect(result.conflict.groups).toHaveLength(0)
    expect(result.dimensions.conflictAcknowledged.status).toBe('unscored')
  })

  it('16. does not treat a question that matches a claim pattern as a claim', () => {
    // "我的猫的名字是什么" matches a name pattern; it asks rather than asserts.
    const result = evaluateAnswerEvidence({
      reply: '我想确认一下：我的猫的名字是什么？',
      callSucceeded: true,
      memories: [],
      question: '我的猫叫什么名字？',
      fabricationPattern: /(?:叫|名字是|名为)\s*[^\s，。！？]{1,10}/u
    })
    expect(result.dimensions.unsupportedClaimDetected).toMatchObject({ status: 'pass' })
  })

  it('15. rejects a confident claim when the evidence is unreadable', () => {
    const result = evaluateAnswerEvidence({ reply: '你对花生肯定过敏，请放心。', callSucceeded: true, memories: [memory('m1', '我以前对花生过敏，现在不过敏了。')], question: '我现在对花生过敏吗？' })
    expect(result.outcome).toBe('not_scorable')
    expect(result.scoring.status).toBe('unscored')
  })
})

describe('phase 2 D: legacy behaviours still hold', () => {
  it('counts a delivered value that appears in the reply', () => {
    const result = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')] })
    expect(result).toMatchObject({ outcome: 'used_correctly', scored: true, matchedEvidenceIds: ['m1'] })
  })

  it('detects a reply that reverses the delivered polarity', () => {
    expect(evaluateAnswerEvidence({ reply: '你不对花生过敏。', callSucceeded: true, memories: [memory('m1', '我对花生严重过敏。')] })).toMatchObject({ outcome: 'contradicts_evidence' })
    expect(evaluateAnswerEvidence({ reply: '好的，花生不引起过敏反应。', callSucceeded: true, memories: [memory('m1', '我对花生严重过敏。')] })).toMatchObject({ outcome: 'contradicts_evidence' })
  })

  it('reads a time shift that sits after the whole predicate', () => {
    const result = evaluateAnswerEvidence({ reply: '你对花生的过敏已经过去了。', callSucceeded: true, memories: [memory('m1', '我对花生严重过敏。')] })
    expect(result.dimensions.temporalConsistent).toEqual({ status: 'fail', reason: 'reply_shifts_present_to_past' })
  })

  it('can score a memory that has no readable predicate', () => {
    expect(evaluateAnswerEvidence({ reply: '你的猫叫咪咪。', callSucceeded: true, memories: [memory('m5', '我养了一只叫咪咪的猫。')] })).toMatchObject({ outcome: 'used_correctly' })
    expect(evaluateAnswerEvidence({ reply: '我可能不知道它叫什么名字。', callSucceeded: true, memories: [memory('m5', '我养了一只叫咪咪的猫。')] }).dimensions.evidenceMentioned).toMatchObject({ status: 'fail' })
  })

  it('does not let a generic token make a two-state memory look usable', () => {
    const mixed = evaluateAnswerEvidence({ reply: '我以前对花生过敏，现在不过敏了。', callSucceeded: true, memories: [memory('m6', '我以前对花生过敏，现在不过敏了。')] })
    expect(mixed.dimensions.evidenceMentioned).toEqual({ status: 'unscored', reason: 'evidence_unreadable' })
    expect(mixed).toMatchObject({ outcome: 'not_scorable', scored: false })
  })

  it('does not count a question back as correct use', () => {
    const result = evaluateAnswerEvidence({ reply: '你对花生过敏吗？', callSucceeded: true, memories: [memory('m1', '我对花生严重过敏。')] })
    expect(result).toMatchObject({ outcome: 'delivered_not_used', detail: 'evidence_named_but_reply_is_question' })
  })

  it('distinguishes a cancelled call from a failed one', () => {
    expect(evaluateAnswerEvidence({ reply: '', callSucceeded: false, callOutcome: 'cancelled', memories: [] })).toMatchObject({ outcome: 'not_scorable', detail: 'provider_call_cancelled' })
  })

  it('validates its own record shape', () => {
    const assessment = evaluateAnswerEvidence({ reply: '你住在杭州。', callSucceeded: true, memories: [memory('m1', '我住在杭州。')] })
    expect(isAnswerEvidenceAssessment(assessment)).toBe(true)
    expect(isAnswerEvidenceAssessment({ ...assessment, outcome: 'made_up' })).toBe(false)
    expect(isAnswerEvidenceAssessment({ ...assessment, dimensions: { evidenceMentioned: { status: 'maybe', reason: 'x' } } })).toBe(false)
    expect(isAnswerEvidenceAssessment({ ...assessment, conflict: { outcome: 'maybe', groups: [] } })).toBe(false)
  })
})
