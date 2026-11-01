/**
 * Memory evidence semantics (P0-5).
 *
 * The importance formula has a repetition term, `R = 1 − e^(−n/3)`, and for a
 * long time `n` was always zero in production. The formula was not wrong; the
 * producer did not exist. This module is that producer, and most of it is about
 * *refusing* to count.
 *
 * The distinction that matters:
 *
 *   - a **restatement** is the user asserting the same fact again, in a new
 *     turn, without correcting or negating it. Only this raises `n`.
 *   - a **confirmation** is the user agreeing that a stored fact is right. It is
 *     evidence the fact matters, not evidence it was said twice.
 *   - a **correction** or **retraction** suppresses the old evidence.
 *   - a **model_reference** is Morrow repeating the fact. It is recorded so an
 *     audit can see it, and it must never raise `n`: the user did not say it.
 *
 * Everything below is a refusal gate. "Semantically similar" is not
 * "confirmed", and a question, a quote, a hypothetical or a role-play is not an
 * assertion at all.
 */

export type MemoryEvidenceSignal = 'restatement' | 'confirmation' | 'none'

export type MemoryEvidenceRefusal =
  | 'empty'
  | 'question'
  | 'negated'
  | 'quoted'
  | 'hypothetical'
  | 'role_play'
  | 'discussion'
  | 'no_matching_memory'
  | 'model_text'

export interface MemoryUtteranceReading {
  signal: MemoryEvidenceSignal
  /** Why the reading came out this way; safe to log, contains no user text. */
  reason: MemoryEvidenceRefusal | 'asserted' | 'confirmed'
  /** The normalised assertion, when there is one. Used to match a memory. */
  assertion: string | null
}

const QUESTION = /(?:[?？]|(?:吗|呢|么)\s*[。.!！]?$)/u
// Negation is a correction in disguise, and a correction is not a repetition.
// Deliberately broad: a false refusal only loses a repetition signal, while a
// false acceptance invents one.
const NEGATION = /(?:不(?:再|是|想|打算|会|住|喜欢|要|去|爱)|没(?:有|在)|别|从来没|取消|撤销|忘掉|删掉|not|no longer|never)/iu
const QUOTATION = /(?:[「『“"'][^」』”"']{2,}[」』”"']|(?:用户|他|她|别人|朋友|同事|有人说|书上说|网上说)(?:说|讲|提到|认为))/u
const HYPOTHETICAL = /(?:如果|假如|要是|假设|万一|倘若|就算|哪怕是|\bif\b|\bsuppose\b)/iu
const ROLE_PLAY = /(?:假设你是|假装|扮演|角色扮演|你现在是|作为(?:一个)?(?:医生|律师|老师|工程师)|\broleplay\b|\bpretend\b)/iu
const DISCUSSION = /(?:我觉得.{0,12}(?:说法|观点|看法)|这个说法|这种观点|讨论一下|聊聊|听说|据说|是不是可以)/u
const CONFIRMATION = /(?:^(?:对|是的|没错|对的|嗯对|确实|正是|就是|我记得是|你说得对)|(?:对|是的|没错)[，,。]?\s*(?:就是|正是|确实))/u

/** Normalises a sentence for equality: width, case, punctuation, spacing. */
export function normalizeAssertion(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replaceAll(/[\s，。！？、；：,.!?;:()（）[\]「」『』“”"'’]/gu, '')
    .trim()
}

/**
 * Reads one user utterance.
 *
 * `actor` is part of the signature because the same words from Morrow are not
 * the user restating anything.
 */
export function readMemoryUtterance(input: { text: string; actor?: 'user' | 'morrow' | 'system' }): MemoryUtteranceReading {
  const actor = input.actor ?? 'user'
  const text = input.text.normalize('NFKC').trim()
  if (text.length === 0) return { signal: 'none', reason: 'empty', assertion: null }
  if (actor !== 'user') return { signal: 'none', reason: 'model_text', assertion: null }

  // Order matters: a quoted question is still a quote, and a negated quote is
  // still not an assertion. The first gate that fires wins.
  if (ROLE_PLAY.test(text)) return { signal: 'none', reason: 'role_play', assertion: null }
  if (HYPOTHETICAL.test(text)) return { signal: 'none', reason: 'hypothetical', assertion: null }
  if (QUOTATION.test(text)) return { signal: 'none', reason: 'quoted', assertion: null }
  if (QUESTION.test(text)) return { signal: 'none', reason: 'question', assertion: null }
  if (NEGATION.test(text)) return { signal: 'none', reason: 'negated', assertion: null }
  if (DISCUSSION.test(text)) return { signal: 'none', reason: 'discussion', assertion: null }

  const assertion = normalizeAssertion(text)
  if (assertion.length < 2) return { signal: 'none', reason: 'empty', assertion: null }
  if (CONFIRMATION.test(text)) return { signal: 'confirmation', reason: 'confirmed', assertion }
  return { signal: 'restatement', reason: 'asserted', assertion }
}

/**
 * Whether two normalised assertions are the same fact.
 *
 * Deliberately strict: exact equality after normalisation, or one containing
 * the other with at least four characters of difference headroom. A loose
 * similarity score would count "我住在杭州" and "我想去杭州" as the same fact,
 * which is exactly the false positive that makes a repetition count worthless.
 */
export function sameAssertion(left: string, right: string): boolean {
  if (left.length === 0 || right.length === 0) return false
  if (left === right) return true
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
  return shorter.length >= 6 && longer.includes(shorter) && longer.length - shorter.length <= 6
}
