/**
 * What a sentence is doing, before it becomes an interest.
 *
 * `question | statement` was too coarse. It could not tell "我朋友喜欢天文学"
 * (someone else's attribute) from "我很喜欢天文学" (the user's), nor a task
 * request from a disclosure. Those distinctions decide whether a row about the
 * user may exist at all, so they are made explicitly and tested.
 */

export const INTEREST_INTENTS = [
  'statement',
  'mixed',
  'question',
  'task_request',
  'third_party',
  'uncertain',
  'withdrawn'
] as const

export type InterestIntent = (typeof INTEREST_INTENTS)[number]

// First-person predicates that describe the user, not a topic in the abstract.
const SELF_FACT = /我(?:不喜欢|喜欢|偏好|住在|工作在|从事|通常|习惯|的目标|的生日|会|对[^，。！？?]{0,12}(?:感兴趣|着迷|有研究)|很(?:喜欢|感兴趣)|特别(?:喜欢|感兴趣)|非常(?:喜欢|感兴趣))/u

// A third party is the grammatical subject of the predicate. "我朋友喜欢…" must
// not become an interest of the user's; "我喜欢…，我朋友也是" is a self fact and
// is handled by the SELF_FACT branch before this one.
// `(?<!其)` keeps 其他/其它 from looking like a person.
const THIRD_PARTY = /我(?:的)?(?:朋友|同事|家人|妈妈|爸爸|父母|孩子|室友|同学|老板|老师|女朋友|男朋友)|(?<!其)他(?:们)?|她(?:们)?/u

const TASK_REQUEST = /(?:帮我|请帮我|帮忙|研究一下|查一下|搜一下|介绍一下|推荐一下|给我推荐|告诉我|解释一下)/u

const UNCERTAIN = /(?:不确定|不知道|说不好|不清楚|是不是|可能|也许|大概|或许|拿不准)/u

const WITHDRAWN = /(?:没兴趣了|不感兴趣了|不再喜欢|不喜欢了|已经不喜欢|失去兴趣|放弃(?:了)?(?:这个)?爱好)/u

const INTERROGATIVE_OPENING = /^(?:吗|呢|什么|怎么|为什么|哪|谁|多少|如何|是否|能不能|可不可以|请问)/u

export function isQuestionSentence(text: string): boolean {
  const trimmed = text.trim()
  return /[?？]\s*$/u.test(trimmed) || INTERROGATIVE_OPENING.test(trimmed)
}

/**
 * Order matters and is deliberate:
 * withdrawal and uncertainty beat a positive predicate, a self fact beats a
 * third-party mention, and a third party beats a task request.
 */
export function classifyInterestIntent(text: string): InterestIntent {
  const normalized = text.normalize('NFKC').trim()
  if (normalized.length === 0) return 'uncertain'
  if (WITHDRAWN.test(normalized)) return 'withdrawn'
  if (UNCERTAIN.test(normalized)) return 'uncertain'
  const selfFact = SELF_FACT.test(normalized)
  if (selfFact) return isQuestionSentence(normalized) ? 'mixed' : 'statement'
  if (THIRD_PARTY.test(normalized)) return 'third_party'
  if (TASK_REQUEST.test(normalized)) return 'task_request'
  if (isQuestionSentence(normalized)) return 'question'
  return 'statement'
}

/** Only an assertion about the user may create a row. */
export function interestIntentAllowsCreation(intent: InterestIntent): boolean {
  return intent === 'statement' || intent === 'mixed'
}

/**
 * A question may add evidence to a topic the user already stated, but it may
 * not start one. Third-party, task, uncertain and withdrawn sentences touch
 * nothing: they are not about the user, or not about a settled fact.
 */
export function interestIntentAllowsReinforcement(intent: InterestIntent): boolean {
  return intent === 'statement' || intent === 'mixed' || intent === 'question'
}
