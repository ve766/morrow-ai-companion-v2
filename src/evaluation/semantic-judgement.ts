/**
 * Structured semantic judgement for replies that a substring rule cannot read.
 *
 * The rules below are still deterministic, but they are organised the way a
 * reviewer would read a reply: who is the subject, what content is asserted, is
 * it affirmed or denied, does it follow the newest value, does it disclose a
 * conflict, and does it treat a retracted value as gone. Each dimension reports
 * its own status, so a single `fail` cannot be averaged away and an unreadable
 * dimension becomes `uncertain` instead of a silent pass.
 *
 * This is not semantic understanding. It is a checklist that knows its own
 * limits: whenever a dimension has nothing reliable to read, it says so.
 */

export type JudgeStatus = 'pass' | 'fail' | 'uncertain'

export type JudgeDimension =
  | 'subject'
  | 'content'
  | 'polarity'
  | 'conflict'
  | 'correction'
  | 'retraction'
  | 'answers_question'

export interface JudgeFinding {
  dimension: JudgeDimension
  status: JudgeStatus
  basis: string
}

export type JudgeVerdict = 'pass' | 'fail' | 'uncertain' | 'needs_review'

export interface JudgeResult {
  verdict: JudgeVerdict
  findings: JudgeFinding[]
  rationale: string
}

export interface JudgeConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface JudgeInput {
  reply: string
  /** Values the user currently holds, newest first. */
  current?: string[]
  /** Values replaced by an explicit correction. */
  superseded?: string[]
  /** Values that were retracted or whose source message was deleted. */
  retracted?: string[]
  /** Values that contradict each other and were never resolved. */
  conflicting?: string[]
  /** Values that count as an acceptable answer when `current` is empty. */
  acceptable?: string[]
  /** True when the reply should answer a factual question about the user. */
  expectsAnswer?: boolean
  /**
   * Optional predicates that must bind the value to the asked attribute.
   * Without this, a keyword-only reply ("你在大阪有朋友") can look identical
   * to an answer ("你住在大阪"). This is deliberately supplied by the caller
   * instead of guessed from a value, so the rule can say what it checked.
   */
  valueRelations?: Record<string, string[]>
  /** Prior turns, used to keep an earlier correction/denial in force. */
  conversation?: JudgeConversationTurn[]
}

// The assistant claiming a user fact as its own. `我不能判断你的过敏` is not a claim.
const FIRST_PERSON_OWN_FACT = /我(?:也|曾|一直|确实|真的|从小)?(?:对[^，。！？?]{0,12})?过敏|我(?:有|患有|得了|确诊)[^，。！？?]{0,8}(?:过敏|抑郁|焦虑|疾病)/u
// Denial of the remembered fact: the content is present but negated. Saying
// "I do not remember" is a different act and is handled separately - it is the
// right answer when there is nothing to remember and a failure when the fact
// was delivered.
const DENIES_FACT = /(?:不是|并非|没有|没)(?:对)?[^，。！？?]{0,6}(?:过敏|住在|喜欢|讨厌)/u
// A quotation or a question is not an assertion.
const QUOTED = /(?:你说过|你提到过|你问我|你曾|你之前说|你说)[^。！？!?]{0,20}/u
// A question can end with a question mark or with the Chinese yes/no particle;
// clause splitting drops the punctuation, so the particle is what identifies a
// question inside a single clause.
// "我不确定你是否对花生过敏" doubts the fact; "我不确定现在是否还准确" doubts
// only how fresh it is and still states it. Only the first is a polarity issue.
const HEDGE_ABOUT_FACT = /(?:不确定|不记得|不知道|没印象)(?:你|您)?(?:是否|是不是|有没有)/u
const QUOTED_SPAN = /“[^”]{0,80}(?:我|你|您)[^”]{0,80}”|「[^」]{0,80}(?:我|你|您)[^」]{0,80}」|『[^』]{0,80}(?:我|你|您)[^』]{0,80}』/u
// delivered it is still a refusal to use it. This covers arbitrary attributes,
// not only the original allergy/residence vocabulary.
const DENIES_RECALL = /(?:不记得|不知道|不确定|没有印象|没印象)/u
// Any morphology that negates the value, regardless of attribute name.
const NEGATES_VALUE = /(?:不是|并非|没有|没|不叫|不再|不住|不在|不喜欢|已经不|不存在|否认|不对|不准确)/u
const HYPOTHETICAL = /(?:如果|假如|假设|要是|万一|若是)/u
const HISTORICAL_PREFIX = /(?:以前|之前|原来|曾经|过去|原先)(?![^，。！？!?]{0,8}(?:告诉我|说过|提到|问我))[^，。！？!?]{0,10}$/u
const CURRENT_PREFIX = /(?:现在|目前|如今|当前)[^，。！？!?]{0,10}$/u
// Markers that a value is being described as old rather than current.
const SUPERSEDED_MARKER = /(?:之前|原来|以前|曾经|原先|过去|已(?:经)?改|改成|更新为|现在是|不再)/u
// Markers that two values are being presented as a conflict rather than as one fact.
const CONFLICT_MARKER = /(?:冲突|矛盾|不一致|对不上|两个|分别|哪个|哪一个|不确定|哪一个是|哪个才是|哪个更)/u
// Markers that the reply admits it does not know, which is correct for a retraction.
const ADMITS_UNKNOWN = /(?:不(?:再)?(?:记得|确定|知道)|没有(?:相关)?记录|已(?:经)?(?:删除|撤回)|无法(?:确认|知道)|没法知道|没有(?:这个)?信息|不清楚)/u

const has = (text: string, value: string): boolean => text.includes(value)

function mentions(reply: string, values: string[]): string[] {
  return values.filter((value) => has(reply, value))
}

function clausesOf(reply: string): string[] {
  return reply.split(/[。！？!?；;\n]/u).map((clause) => clause.trim()).filter((clause) => clause.length > 0)
}

type ClauseSubject = 'user' | 'assistant' | 'third_party' | 'unknown'

/**
 * Who owns the value inside this clause? The closest explicit subject before
 * the value wins. "我记得你住在大阪" is the user's fact; "我住在大阪" is the
 * assistant adopting it; "我朋友住在大阪" belongs to a third party.
 */
function subjectOfClause(clause: string, value: string): ClauseSubject {
  const index = clause.indexOf(value)
  if (index < 0) return 'unknown'
  const before = clause.slice(0, index)
  const positions: Array<{ subject: ClauseSubject; at: number }> = []
  for (const match of before.matchAll(/我|Morrow|莫罗/gu)) positions.push({ subject: 'assistant', at: match.index })
  for (const match of before.matchAll(/你|您|用户|对方/gu)) positions.push({ subject: 'user', at: match.index })
  for (const match of before.matchAll(/他|她|朋友|同事|家人|第三方/gu)) positions.push({ subject: 'third_party', at: match.index })
  if (positions.length === 0) return 'unknown'
  positions.sort((left, right) => right.at - left.at)
  return positions[0]!.subject
}

function isQuestionClause(clause: string): boolean {
  return /[?？]\s*$/u.test(clause) || /吗\s*$/u.test(clause)
}

function relationFor(value: string, relations: Record<string, string[]> | undefined): string[] {
  return relations?.[value] ?? []
}

/** The asked attribute must be predicated of the value, not merely co-occur. */
function relationSatisfied(clause: string, value: string, relations: Record<string, string[]> | undefined): boolean {
  const expected = relationFor(value, relations)
  if (expected.length === 0) return true
  const index = clause.indexOf(value)
  const before = index >= 0 ? clause.slice(Math.max(0, index - 16), index) : ''
  return expected.some((relation) => before.includes(relation) || clause.slice(index + value.length).includes(relation))
}

/**
 * The assistant must not become the subject of a user fact. Two ways this
 * happens: a first-person predicate about the user's condition ("我对花生过敏"),
 * and a first-person statement that carries the user's value ("我住在杭州").
 *
 * A clause that names the user before the value ("我记得你住在杭州") is fine: the
 * second person still governs the fact, and the first person only reports it.
 */
function subjectFinding(reply: string, values: string[]): JudgeFinding {
  if (FIRST_PERSON_OWN_FACT.test(reply)) {
    return { dimension: 'subject', status: 'fail', basis: 'the assistant stated a user fact as its own' }
  }
  let sawUser = false
  let sawAssistant = false
  let sawThirdParty = false
  for (const clause of clausesOf(reply)) {
    for (const value of values) {
      if (!clause.includes(value)) continue
      if (QUOTED.test(clause) && QUOTED_SPAN.test(clause)) continue
      const subject = subjectOfClause(clause, value)
      if (subject === 'assistant') {
        const index = clause.indexOf(value)
        const before = clause.slice(0, index).trimEnd()
        const after = clause.slice(index + value.length)
        // "BLUE-731 是我的项目代号" carries the same ownership after the value.
        if (/^\s*(?:是|属于|为)我的(?![朋友同事家人])/u.test(after)) {
          sawAssistant = true
          continue
        }
        // A first-person report such as "我记得你住在杭州" still names the
        // user after the assistant verb; it is not ownership. Only an
        // assistant predicate/possessive that reaches the value is.
        const lastUser = Math.max(before.lastIndexOf('你'), before.lastIndexOf('您'))
        const lastAssistant = Math.max(before.lastIndexOf('我'), before.lastIndexOf('Morrow'), before.lastIndexOf('莫罗'))
        if (lastAssistant > lastUser && /(?:我的[^。！？!?]{0,20}|(?:是|为|叫|住在|住|来自|属于|有|对|喜欢|讨厌|正在|开始|学习|在学|项目代号(?:是|为)|代号(?:是|为)))$/u.test(before)) {
          sawAssistant = true
        }
      } else if (subject === 'user') {
        sawUser = true
      } else if (subject === 'third_party') {
        sawThirdParty = true
      } else {
        const after = clause.slice(clause.indexOf(value) + value.length)
        if (/^\s*(?:是|属于|为)我的(?![朋友同事家人])/u.test(after)) sawAssistant = true
      }
    }
  }
  if (sawAssistant) {
    return {
      dimension: 'subject',
      status: 'fail',
      basis: 'the assistant put itself before the user\'s value'
    }
  }
  if (!sawUser && sawThirdParty) {
    return {
      dimension: 'subject',
      status: 'fail',
      basis: 'the user\'s value was attributed only to a third party'
    }
  }
  return { dimension: 'subject', status: 'pass', basis: 'no first-person or third-party ownership of the user\'s fact' }
}

function polarityFinding(reply: string, current: string[]): JudgeFinding {
  if (DENIES_FACT.test(reply)) {
    return { dimension: 'polarity', status: 'fail', basis: 'the reply denies the remembered fact' }
  }
  const clauses = clausesOf(reply)
  const valueClauses = clauses.filter((clause) => current.some((value) => clause.includes(value)))
  const negatedValue = valueClauses.find((clause) => {
    if (isQuestionClause(clause)) return false
    for (const value of current) {
      if (!clause.includes(value)) continue
      const index = clause.indexOf(value)
      const before = clause.slice(Math.max(0, index - 14), index)
      const after = clause.slice(index + value.length)
      if (NEGATES_VALUE.test(before) || /^\s*(?:是错的|不存在|不对|不准确|已经不|不再是|不是|并非)/u.test(after)) return true
    }
    return false
  })
  if (negatedValue) {
    return { dimension: 'polarity', status: 'fail', basis: `the value is negated: ${negatedValue.slice(0, 60)}` }
  }
  const recallDenials = valueClauses.filter((clause) => DENIES_RECALL.test(clause) && !isQuestionClause(clause))
  const assertiveValues = valueClauses.filter((clause) =>
    !QUOTED.test(clause) &&
    !isQuestionClause(clause) &&
    !HEDGE_ABOUT_FACT.test(clause) &&
    !HYPOTHETICAL.test(clause) &&
    !DENIES_RECALL.test(clause) &&
    !(HISTORICAL_PREFIX.test(clause.slice(0, clause.indexOf(current.find((value) => clause.includes(value)) ?? ''))) && !CURRENT_PREFIX.test(clause))
  )
  // "我不记得你住在大阪，但你现在住在大阪" is one reply contradicting
  // itself. It must fail even though its second clause asserts the value.
  if (recallDenials.length > 0 && current.length > 0) {
    return {
      dimension: 'polarity',
      status: 'fail',
      basis: recallDenials.length > 0 && assertiveValues.length > 0
        ? 'the reply both denies recollection and asserts the same delivered fact'
        : 'the reply claims not to remember a fact that was delivered'
    }
  }
  if (assertiveValues.length > 0) {
    return { dimension: 'polarity', status: 'pass', basis: 'the fact is asserted in a declarative clause' }
  }
  if (valueClauses.some((clause) => HEDGE_ABOUT_FACT.test(clause) || HYPOTHETICAL.test(clause))) {
    return { dimension: 'polarity', status: 'uncertain', basis: 'the reply hedges or frames the fact hypothetically rather than asserting it' }
  }
  if (valueClauses.some((clause) => HISTORICAL_PREFIX.test(clause.slice(0, clause.indexOf(current.find((value) => clause.includes(value)) ?? ''))) && !CURRENT_PREFIX.test(clause))) {
    return { dimension: 'polarity', status: 'uncertain', basis: 'the value appears only as a historical statement, not as the current fact' }
  }
  if (ADMITS_UNKNOWN.test(reply)) {
    // With nothing to remember, admitting it is the correct answer; with the
    // fact in hand it is a refusal to use what was delivered.
    return current.length > 0
      ? { dimension: 'polarity', status: 'fail', basis: 'the reply claims not to remember a fact that was delivered' }
      : { dimension: 'polarity', status: 'pass', basis: 'the reply admits it has no record' }
  }
  if (QUOTED.test(reply) && !SUPERSEDED_MARKER.test(reply)) {
    return { dimension: 'polarity', status: 'uncertain', basis: 'the fact appears only inside a quotation, so it may not be asserted' }
  }
  if (isQuestionClause(reply.trim())) {
    return { dimension: 'polarity', status: 'uncertain', basis: 'the reply asks instead of asserting' }
  }
  return { dimension: 'polarity', status: 'pass', basis: 'no denial, quotation or question in place of an assertion' }
}

function conflictFinding(reply: string, conflicting: string[]): JudgeFinding | null {
  if (conflicting.length < 2) return null
  const present = mentions(reply, conflicting)
  if (present.length < 2) {
    // Picking one side silently is the failure mode this dimension exists for.
    return {
      dimension: 'conflict',
      status: present.length === 1 ? 'fail' : 'uncertain',
      basis: present.length === 1
        ? `only ${present[0]} was asserted; the other value was never surfaced`
        : 'none of the conflicting values appears, so nothing was answered'
    }
  }
  if (!CONFLICT_MARKER.test(reply)) {
    return {
      dimension: 'conflict',
      status: 'uncertain',
      basis: 'both values appear but nothing marks them as contradictory, so a list and a disclosure look identical'
    }
  }
  return { dimension: 'conflict', status: 'pass', basis: 'both values are surfaced and the reply marks them as unresolved' }
}

function correctionFinding(reply: string, current: string[], superseded: string[]): JudgeFinding | null {
  if (current.length === 0 || superseded.length === 0) return null
  const currentPresent = mentions(reply, current)
  const stalePresent = mentions(reply, superseded)
  if (currentPresent.length === 0 && stalePresent.length > 0) {
    return {
      dimension: 'correction',
      status: SUPERSEDED_MARKER.test(reply) ? 'uncertain' : 'fail',
      basis: 'the superseded value is used while the corrected value is absent'
    }
  }
  if (currentPresent.length === 0) {
    return { dimension: 'correction', status: 'uncertain', basis: 'neither value appears, so adherence cannot be read' }
  }
  if (stalePresent.length > 0 && !SUPERSEDED_MARKER.test(reply)) {
    return {
      dimension: 'correction',
      status: 'fail',
      basis: 'the corrected value appears but the superseded value is presented as equally current'
    }
  }
  return { dimension: 'correction', status: 'pass', basis: 'the corrected value is used and the old one is not asserted as current' }
}

function retractionFinding(reply: string, retracted: string[]): JudgeFinding | null {
  if (retracted.length === 0) return null
  const present = mentions(reply, retracted)
  if (present.length === 0) {
    return { dimension: 'retraction', status: 'pass', basis: 'the retracted value is not used' }
  }
  if (SUPERSEDED_MARKER.test(reply) || ADMITS_UNKNOWN.test(reply)) {
    return { dimension: 'retraction', status: 'pass', basis: 'the retracted value is mentioned only as no longer valid' }
  }
  return { dimension: 'retraction', status: 'fail', basis: `the retracted value is still asserted as current: ${present.join(',')}` }
}

function contentFinding(reply: string, current: string[], relations: Record<string, string[]> | undefined): JudgeFinding | null {
  if (current.length === 0) return null
  const bound = clausesOf(reply).flatMap((clause) =>
    current.filter((value) => clause.includes(value) && relationSatisfied(clause, value, relations)))
  if (bound.length > 0) {
    return { dimension: 'content', status: 'pass', basis: 'the expected value is bound to the asked attribute' }
  }
  const mentioned = mentions(reply, current)
  return mentioned.length > 0
    ? {
        dimension: 'content',
        status: 'fail',
        basis: `the value is only a keyword co-occurrence, not bound to the asked attribute: ${mentioned.join(',')}`
      }
    : { dimension: 'content', status: 'fail', basis: 'the expected value never appears' }
}

function answerFinding(
  reply: string,
  expected: string[],
  expectsAnswer: boolean,
  relations: Record<string, string[]> | undefined,
  hasDeliveredEvidence: boolean
): JudgeFinding | null {
  if (!expectsAnswer) return null
  if (ADMITS_UNKNOWN.test(reply) && !hasDeliveredEvidence) {
    return { dimension: 'answers_question', status: 'pass', basis: 'the reply says it does not know instead of inventing an answer' }
  }
  if (expected.length === 0) {
    return { dimension: 'answers_question', status: 'uncertain', basis: 'no expected value was declared, so an answer cannot be verified' }
  }
  const bound = clausesOf(reply).flatMap((clause) =>
    expected.filter((value) => clause.includes(value) && relationSatisfied(clause, value, relations)))
  if (bound.length > 0) {
    return { dimension: 'answers_question', status: 'pass', basis: 'the reply binds the value to the asked attribute' }
  }
  return { dimension: 'answers_question', status: 'uncertain', basis: 'the reply never gives a value bound to the asked attribute' }
}

/**
 * A correction or denial stated in an earlier user turn still governs the
 * latest reply. The final answer alone cannot tell whether the old value was
 * superseded; this check makes the conversation part of the evidence.
 */
function conversationFinding(
  reply: string,
  conversation: JudgeConversationTurn[] | undefined,
  superseded: string[]
): JudgeFinding | null {
  if (!conversation || conversation.length === 0 || superseded.length === 0) return null
  const userText = conversation.filter((turn) => turn.role === 'user').map((turn) => turn.content).join('\n')
  const deniedEarlier = superseded.filter((value) => {
    if (!userText.includes(value)) return false
    const clauses = clausesOf(userText).filter((clause) => clause.includes(value))
    return clauses.some((clause) => NEGATES_VALUE.test(clause) || /(?:不再|已经不住|搬走|搬离)/u.test(clause))
  })
  if (deniedEarlier.length === 0) return null
  const assertedAgain = clausesOf(reply).some((clause) =>
    deniedEarlier.some((value) => clause.includes(value)) && !SUPERSEDED_MARKER.test(clause))
  return assertedAgain
    ? {
        dimension: 'correction',
        status: 'fail',
        basis: `an earlier user denial/correction still applies to ${deniedEarlier.join(',')}`
      }
    : null
}

export function judgeReply(input: JudgeInput): JudgeResult {
  const reply = input.reply ?? ''
  const findings: JudgeFinding[] = []
  const current = input.current ?? []
  const superseded = input.superseded ?? []
  const retracted = input.retracted ?? []
  const conflicting = input.conflicting ?? []

  const declared = current.length + superseded.length + retracted.length + conflicting.length
  if (declared === 0 && !input.expectsAnswer) {
    return {
      verdict: 'needs_review',
      findings: [],
      rationale: 'no dimension was declared for this case, so nothing was judged'
    }
  }

  findings.push(subjectFinding(reply, [...current, ...superseded, ...conflicting]))
  findings.push(polarityFinding(reply, current))
  const content = contentFinding(reply, current, input.valueRelations)
  if (content) findings.push(content)
  const conflict = conflictFinding(reply, conflicting)
  if (conflict) findings.push(conflict)
  const conversation = conversationFinding(reply, input.conversation, superseded)
  const correction = correctionFinding(reply, current, superseded)
  if (conversation) findings.push(conversation)
  else if (correction) findings.push(correction)
  const retraction = retractionFinding(reply, retracted)
  if (retraction) findings.push(retraction)
  const answer = answerFinding(
    reply,
    [...current, ...(input.acceptable ?? [])],
    input.expectsAnswer ?? false,
    input.valueRelations,
    current.length > 0
  )
  if (answer) findings.push(answer)

  const failed = findings.filter((finding) => finding.status === 'fail')
  if (failed.length > 0) {
    return {
      verdict: 'fail',
      findings,
      rationale: `failed ${failed.map((finding) => finding.dimension).join(', ')}: ${failed.map((finding) => finding.basis).join('; ')}`
    }
  }
  const uncertain = findings.filter((finding) => finding.status === 'uncertain')
  if (uncertain.length > 0) {
    return {
      verdict: 'uncertain',
      findings,
      rationale: `no failure, but ${uncertain.map((finding) => finding.dimension).join(', ')} could not be read: ${uncertain.map((finding) => finding.basis).join('; ')}`
    }
  }
  return {
    verdict: 'pass',
    findings,
    rationale: `every dimension passed: ${findings.map((finding) => finding.dimension).join(', ')}`
  }
}

/**
 * Failure attribution for a real run. A failure that the request already
 * contains cannot be a retrieval defect; one whose evidence never reached the
 * request cannot be a model defect. Anything else stays unclassified.
 */
export type FailureClass =
  | 'CONTEXT_NOT_RETRIEVED'
  | 'CONTEXT_NOT_SERIALIZED'
  | 'CONTEXT_CONTRADICTORY'
  | 'MODEL_MISINTERPRETATION'
  | 'MODEL_IGNORED_INSTRUCTION'
  | 'EVALUATOR_FALSE_PASS'
  | 'EVALUATOR_FALSE_FAIL'
  | 'INSUFFICIENT_EVIDENCE'

export function classifyFailure(input: {
  verdict: JudgeVerdict
  findings: JudgeFinding[]
  /** Values the fixture expected to be in the request. */
  expectedInRequest: string[]
  /** Values actually found in the serialized provider request. */
  deliveredInRequest: string[]
  /** True when the request carried contradictory values without a conflict note. */
  requestContradictory?: boolean
}): FailureClass {
  const { verdict, findings } = input
  if (verdict === 'pass') {
    return findings.some((finding) => finding.status === 'uncertain')
      ? 'EVALUATOR_FALSE_PASS'
      : 'INSUFFICIENT_EVIDENCE'
  }
  const missing = input.expectedInRequest.filter((value) => !input.deliveredInRequest.includes(value))
  if (input.expectedInRequest.length > 0 && missing.length === input.expectedInRequest.length) return 'CONTEXT_NOT_RETRIEVED'
  if (missing.length > 0) return 'CONTEXT_NOT_SERIALIZED'
  if (input.requestContradictory) return 'CONTEXT_CONTRADICTORY'
  const ignored = findings.find((finding) => finding.status === 'fail' && (finding.dimension === 'conflict' || finding.dimension === 'correction'))
  if (ignored) return 'MODEL_IGNORED_INSTRUCTION'
  if (findings.some((finding) => finding.status === 'fail')) return 'MODEL_MISINTERPRETATION'
  return 'INSUFFICIENT_EVIDENCE'
}
