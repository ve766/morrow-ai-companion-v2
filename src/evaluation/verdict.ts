/**
 * Turns rule results into a verdict that states how much the rule can actually
 * prove.
 *
 * The previous model was binary: a satisfied rule was a pass. Running it
 * against real output showed two passes that were not answers at all - a
 * fabricated weather report that happened to omit a birthday, and a question
 * mark inside "我们来聊聊好吗？" that was about conversational style, not about
 * the ambiguous referent. Neither was a rule bug: absence of a string and
 * presence of a question mark are simply not evidence of understanding.
 *
 * So the verdict is derived from what the rule can observe, not from what the
 * reply seems to mean. A positive requirement (`mustMention`) carries evidence
 * when satisfied. An absence-only or form-only rule can be satisfied by a
 * non-answer, so satisfying it is reported as `uncertain`, never `pass` - the
 * raw reply is kept next to it so a reviewer can decide.
 */

export type RealVerdict = 'pass' | 'fail' | 'uncertain' | 'needs_review'

export interface RealCheck {
  rule: string
  passed: boolean
  detail: string
}

export interface VerdictRule {
  check: 'substring' | 'clarifying_question'
  mustMention?: string[]
  mustNotMention?: string[]
}

export interface VerdictDecision {
  verdict: RealVerdict
  /** Why this verdict follows from the rule and the checks, in one sentence. */
  rationale: string
  /**
   * The specific way this verdict could still be wrong. Populated for `pass`
   * because a lexical hit is weaker evidence than it looks, and for
   * `uncertain` because that is the whole reason for the value.
   */
  caveat: string | null
}

const noReplyRationale = 'No reply was obtained, so the model was never observed; a provider fault is not a model verdict.'

/** Longest run of characters that may legitimately coincide with the request. */
const echoWindow = 40

/**
 * True when the reply reproduces a long verbatim stretch of the request.
 *
 * A 0.5B model does this: one observed `b3` reply was the answer, followed by
 * several hundred characters of the system prompt copied back, including
 * "User-controlled communication preferences". A `mustMention` rule found 杭州
 * in that reply and called it a pass. The reply was not an answer; it was the
 * request read aloud, and no meaning-based reading is needed to see that.
 *
 * The window is deliberately long. Matching a short phrase would fire on
 * ordinary overlap ("用户住在杭州" appears in both a memory and a good reply);
 * forty characters of exact agreement does not happen by coincidence.
 */
export function echoesRequest(reply: string, requestText: string): boolean {
  if (requestText.length < echoWindow) return false
  for (let index = 0; index + echoWindow <= reply.length; index += 1) {
    if (requestText.includes(reply.slice(index, index + echoWindow))) return true
  }
  return false
}

export function decideVerdict(
  rule: VerdictRule | null,
  reply: string | null,
  checks: RealCheck[],
  requestText = ''
): VerdictDecision {
  if (rule === null) {
    return {
      verdict: 'needs_review',
      rationale: 'The fixture declares no mechanical rule for this capability, so nothing was scored.',
      caveat: 'Correct behaviour here is often "do not mention it", which any substring rule would reward for the wrong reason.'
    }
  }
  if (reply === null) {
    return { verdict: 'needs_review', rationale: noReplyRationale, caveat: null }
  }
  const failed = checks.filter((check) => !check.passed)
  if (failed.length > 0) {
    const forbidden = failed.some((check) => check.rule.startsWith('mustNotMention:'))
    return {
      verdict: 'fail',
      rationale: `Satisfied ${checks.length - failed.length} of ${checks.length} checks; failed ${failed.map((check) => check.rule).join(', ')}.`,
      caveat: rule.check === 'clarifying_question'
        ? 'A correct declarative clarification would also fail this rule, so a fail here may be the rule rather than the model.'
        : forbidden
          // Mentioning a forbidden string is not always wrong: a reply can
          // refer to a superseded or retracted fact while saying so.
          ? 'Mentioning the string is not automatically wrong - a reply may cite a superseded fact while marking it superseded, and this rule cannot tell that apart.'
          : 'A correct paraphrase that avoids the literal string would also fail this rule.'
    }
  }
  const echo = requestText.length > 0 && echoesRequest(reply, requestText)
  if (echo) {
    return {
      verdict: 'uncertain',
      rationale: 'The reply reproduces a long verbatim stretch of the request, so whatever the rule matched may have come from the request rather than from an answer.',
      caveat: 'Whether a copied request accidentally satisfies a rule is a reading question; the rule cannot separate the two.'
    }
  }
  const positive = (rule.mustMention ?? []).length > 0
  if (!positive) {
    const onlyAbsence = rule.check === 'substring'
    return {
      verdict: 'uncertain',
      rationale: onlyAbsence
        ? 'Every check passed, but all of them are absence checks: a reply that ignores the question entirely satisfies them too.'
        : 'Every check passed, but a question mark does not establish that the question asked for the missing detail.',
      caveat: onlyAbsence
        ? 'Distinguishing "correctly did not mention it" from "did not answer" needs a reading of the reply.'
        : 'Distinguishing a clarifying question from any other question needs a reading of the reply.'
    }
  }
  return {
    verdict: 'pass',
    rationale: `Every check passed, including ${(rule.mustMention ?? []).map((needle) => `mustMention:${needle}`).join(', ')}.`,
    caveat: 'A mention is not a use: the reply can contain the required string while answering something else, or while denying the fact it repeats.'
  }
}
