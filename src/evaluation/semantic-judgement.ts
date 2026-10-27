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
const QUESTION_FORM = /(?:[?？]|吗)\s*$/u
// "我不确定你是否对花生过敏" doubts the fact; "我不确定现在是否还准确" doubts
// only how fresh it is and still states it. Only the first is a polarity issue.
const HEDGE_ABOUT_FACT = /(?:不确定|不记得|不知道|没印象)(?:你|您)?(?:是否|是不是|有没有)/u
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
  for (const clause of reply.split(/[。！？!?；;，,\n]/u)) {
    for (const value of values) {
      const index = clause.indexOf(value)
      if (index < 0) continue
      const before = clause.slice(0, index)
      if (/你|您/u.test(before)) continue
      // A first person that merely mentions the value is not a claim about it:
      // "我会特别留意并避免推荐含花生的内容" is the assistant's own action, and
      // scoring it as role confusion was a false fail on a real reply. The
      // pronoun has to be the subject of a predicate that takes the value.
      if (/(?:我的[^。！？!?]{0,6}|我(?:也|就|一直|现在|目前|从小|确实)?[^。！？!?]{0,2}(?:住在|住|来自|属于|是|在|对|有))$/u.test(before)) {
        return {
          dimension: 'subject',
          status: 'fail',
          basis: `the assistant put itself before the user's value: ${clause.trim().slice(0, 40)}`
        }
      }
    }
  }
  return { dimension: 'subject', status: 'pass', basis: 'no first-person claim about the user\'s fact' }
}

function polarityFinding(reply: string, current: string[]): JudgeFinding {
  if (DENIES_FACT.test(reply)) {
    return { dimension: 'polarity', status: 'fail', basis: 'the reply denies the remembered fact' }
  }
  const clauses = reply.split(/[。！？!?；;\n]/u).map((clause) => clause.trim()).filter((clause) => clause.length > 0)
  const valueClauses = clauses.filter((clause) => current.some((value) => clause.includes(value)))
  // Polarity is decided per clause: stating the fact and then asking a
  // follow-up question is an assertion, not an evasion.
  const asserts = valueClauses.some((clause) =>
    !QUOTED.test(clause) && !QUESTION_FORM.test(clause) && !HEDGE_ABOUT_FACT.test(clause))
  if (asserts) {
    return { dimension: 'polarity', status: 'pass', basis: 'the fact is asserted in a declarative clause' }
  }
  if (valueClauses.some((clause) => HEDGE_ABOUT_FACT.test(clause))) {
    return { dimension: 'polarity', status: 'uncertain', basis: 'the reply hedges the fact itself rather than stating it' }
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
  if (QUESTION_FORM.test(reply.trim())) {
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

function answerFinding(reply: string, expected: string[], expectsAnswer: boolean): JudgeFinding | null {
  if (!expectsAnswer) return null
  if (ADMITS_UNKNOWN.test(reply)) {
    return { dimension: 'answers_question', status: 'pass', basis: 'the reply says it does not know instead of inventing an answer' }
  }
  if (expected.length === 0) {
    return { dimension: 'answers_question', status: 'uncertain', basis: 'no expected value was declared, so an answer cannot be verified' }
  }
  if (mentions(reply, expected).length > 0) {
    return { dimension: 'answers_question', status: 'pass', basis: 'the reply names the value the question asked for' }
  }
  return { dimension: 'answers_question', status: 'uncertain', basis: 'the reply never names the asked-for value' }
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
  if (current.length > 0) {
    findings.push(mentions(reply, current).length > 0
      ? { dimension: 'content', status: 'pass', basis: 'the expected value appears' }
      : { dimension: 'content', status: 'fail', basis: 'the expected value never appears' })
  }
  const conflict = conflictFinding(reply, conflicting)
  if (conflict) findings.push(conflict)
  const correction = correctionFinding(reply, current, superseded)
  if (correction) findings.push(correction)
  const retraction = retractionFinding(reply, retracted)
  if (retraction) findings.push(retraction)
  const answer = answerFinding(reply, [...current, ...(input.acceptable ?? [])], input.expectsAnswer ?? false)
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
