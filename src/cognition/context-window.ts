/**
 * Local context for one turn.
 *
 * The intent classifier used to look at exactly one thing: the previous **user**
 * message. The assistant's own previous turn was in the window and never read,
 * so "可以，继续。" could not distinguish "continue explaining" from "continue with
 * the draft you just offered to write" — the two turns differ only in what the
 * assistant said. That is the defect this module exists to remove.
 *
 * It is deliberately not a second classifier. It answers four bounded questions
 * about the immediately preceding turns and nothing else:
 *
 *   - did the assistant ask a question the user may be answering?
 *   - did the assistant offer to *do* something?
 *   - did the user just affirm or deny the previous turn?
 *   - what topic is the turn continuing, if any?
 *
 * History is read through `boundCognitiveHistory`, so this can never widen the
 * window beyond what the analyzer already received.
 */
import type { CognitiveHistoryMessage } from './cognition'

export const LOCAL_CONTEXT_VERSION = 'local-context-v1' as const

/** What the assistant's previous turn offered, when it offered anything. */
export type AssistantOffer = 'explain' | 'execute' | 'discuss' | 'none'

export interface LocalContext {
  version: typeof LOCAL_CONTEXT_VERSION
  /** True when at least one prior message exists. */
  hasPriorTurn: boolean
  priorUserBody: string | null
  priorAssistantBody: string | null
  /** The assistant's last turn ended in a question. */
  assistantAskedQuestion: boolean
  /** What that turn offered to do next. */
  assistantOffer: AssistantOffer
  /** The user's turn is a bare affirmation/denial of the prior turn. */
  affirmation: 'affirm' | 'deny' | 'none'
  /** Topic the turn continues, when a continuation is detected. */
  continuationTarget: 'explanation' | 'execution' | 'discussion' | 'none'
  /**
   * The turn sequences the previous one ("先从 X 开始"), without naming what it
   * continues. Kept separate from `continuationTarget` because a sequence is a
   * real continuation while the offer it continues is unknown.
   */
  sequencing: boolean
  /** What a deictic in this turn points at, and how sure that is. */
  antecedent: AntecedentResolution
  /** Auditable rule codes for the above. */
  evidence: string[]
}

export interface LocalContextInput {
  content: string
  history: readonly CognitiveHistoryMessage[]
}

/**
 * Short answers are matched as whole tokens, not with `\b`.
 *
 * `\b` is defined on ASCII word characters, so `/^(?:可以|好)\b/` never matches
 * "可以" at the end of a Chinese phrase — the boundary is between two non-word
 * characters and does not exist. That silently disabled the affirmation path:
 * a bare "好" was not recognised as agreeing to anything.
 *
 * The text is split on punctuation and whitespace and the *first* token decides.
 * Anything after it must be an explicit continuation ("好，继续"), otherwise the
 * turn is not a bare answer and is left alone.
 */
const AFFIRM_TOKENS: ReadonlySet<string> = new Set([
  '好', '好的', '好呀', '好啊', '好滴', '可以', '可以的', '行', '行的', '嗯', '恩', '对', '是的', '是', '没问题',
  'ok', 'okay', 'sure', 'yes', 'yep', 'fine', 'go ahead'
])
const DENY_TOKENS: ReadonlySet<string> = new Set([
  '不用', '不用了', '不要', '不必', '不必了', '不行', '算了', '不用麻烦', '暂时不用', '先不用',
  'no', 'nope', 'not now', 'no thanks', 'not necessary'
])
const CONTINUE_TOKENS: ReadonlySet<string> = new Set([
  '继续', '接着', '往下', '开始', '来吧', 'go on', 'continue', 'carry on', 'keep going'
])
/**
 * A thank-you appended to a short answer does not change what the answer is.
 * "好的，谢谢" and "不用了，谢谢" are the two most common short replies in
 * Chinese, and treating them as non-answers silently dropped both.
 */
const POLITE_TOKENS: ReadonlySet<string> = new Set([
  '谢谢', '谢了', '多谢', '感谢', '辛苦了', 'thanks', 'thank you', 'thx', 'cheers'
])
const CONTINUE = /(?:继续|接着|往下|然后呢|go on|continue|carry on|keep going)/iu
const ASK_QUESTION = /[?？]\s*$/u

function tokensOf(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[。.!！?？~～]+$/gu, '')
    .split(/[\s，,、。.!！?？;；:：]+/gu)
    .filter((token) => token.length > 0)
}

/**
 * A bare answer: exactly one affirmative/negative token, optionally followed by
 * one continuation token.
 *
 * "好，但我有个问题" is deliberately **not** an affirmation — the user attached a
 * new request, and treating it as a go-ahead would skip that request.
 */
function bareAnswerOf(text: string): 'affirm' | 'deny' | 'none' {
  const tokens = tokensOf(text)
  if (tokens.length === 0) return 'none'
  const [first, second, third] = tokens
  if (first !== undefined && DENY_TOKENS.has(first)) {
    if (tokens.length === 1) return 'deny'
    if (tokens.length === 2 && second !== undefined && POLITE_TOKENS.has(second)) return 'deny'
    return 'none'
  }
  if (first === undefined || !AFFIRM_TOKENS.has(first)) return 'none'
  if (tokens.length === 1) return 'affirm'
  if (tokens.length === 2 && second !== undefined && CONTINUE_TOKENS.has(second)) return 'affirm'
  if (tokens.length === 2 && second !== undefined && POLITE_TOKENS.has(second)) return 'affirm'
  if (third !== undefined) return 'none'
  return 'none'
}

/** The assistant asked something answerable. */
function askedQuestion(body: string | null): boolean {
  if (!body) return false
  const tail = body.trim().slice(-160)
  return ASK_QUESTION.test(tail) || /(?:吗|呢)[？?]?$/u.test(tail)
}

/**
 * What the assistant offered. "我可以帮你写" is an offer to execute; "要我继续
 * 讲原理吗" is an offer to explain; "还想聊点什么" opens discussion.
 *
 * Order matters: an offer to perform an action outranks an offer to explain,
 * because a turn that says "I can rewrite it for you" is asking permission to
 * act, not permission to talk.
 */
function offerOf(body: string | null): AssistantOffer {
  if (!body) return 'none'
  const tail = body.trim().slice(-240)
  const offering = /(?:要我|需要我|我可以|我来|要不要我|需要的话|帮你|给你)|\b(?:shall i|should i|do you want me to|i can|may i|would you like me to)\b/iu.test(tail)
  if (offering) {
    if (/(?:写|改|做|生成|创建|执行|运行|整理|删除|保存|build|write|rewrite|create|run|generate|delete|save)/iu.test(tail)) return 'execute'
    if (/(?:讲|解释|说明|展开|详细|介绍|explain|walk you through|go deeper|elaborate)/iu.test(tail)) return 'explain'
    return 'discuss'
  }
  if (/(?:继续(?:讲|说|写)|下一部分|接下来(?:讲|说))/iu.test(tail)) return 'explain'
  if (/(?:还想聊|聊点别的|想聊什么|你怎么看|你觉得呢)/iu.test(tail)) return 'discuss'
  return 'none'
}

/**
 * Which kind of continuation this turn is.
 *
 * Only a turn that is *itself* a continuation gets a target, and the target
 * comes from what the assistant offered. A bare "继续" after an offer to rewrite
 * a file is a request to rewrite the file, not a request for more prose.
 */
function continuationOf(
  content: string,
  offer: AssistantOffer,
  assistantAsked: boolean,
  priorAssistantBody: string | null
): LocalContext['continuationTarget'] {
  // The assistant asked something and the user handed the question back
  // ("那你觉得呢？"). That is a continuation of the same exchange, not a new
  // question, and it is where the answer focus differs from the venting case.
  const returned = /(?:那你|你呢|你觉得呢|你怎么看|your take)/iu.test(content) && /[?？]/u.test(content)
  if (returned && assistantAsked && priorAssistantBody) return 'discussion'

  const continuing = CONTINUE.test(content)
  // "可以，继续。" and a bare "好" both continue the previous turn when the
  // assistant had just asked whether to go on. A bare "好" with no question
  // pending continues nothing — that is the case this guard exists for.
  const affirming = bareAnswerOf(content) === 'affirm'
  if (!continuing && !(affirming && assistantAsked)) return 'none'
  if (offer === 'execute') return 'execution'
  if (offer === 'explain') return 'explanation'
  if (offer === 'discuss') return 'discussion'
  // With no offer the only thing a "继续" can continue is the conversation
  // itself; calling that `discussion` is a claim, so it stays `none`.
  return 'none'
}

/**
 * What a deictic ("这个函数", "它", "那段代码") points at.
 *
 * The previous version bound every deictic to the last user message. That is a
 * guess dressed as a resolution: with two files in play, a task switch in
 * between, or an antecedent that only exists inside a quotation, it silently
 * picked the wrong one and the reply acted on it.
 *
 * This resolver only binds when the evidence is unambiguous:
 *   - a head noun ("函数", "代码", "报告") present in exactly one candidate;
 *   - or exactly one candidate in scope at all, when nothing else competes;
 *   - and no topic switch between the candidate and this turn.
 * Anything else is `ambiguous` or `none`, which the caller must turn into a
 * question rather than an action.
 */
export type AntecedentStatus = 'bound' | 'ambiguous' | 'none'

export interface AntecedentResolution {
  status: AntecedentStatus
  messageId: string | null
  /** Message ids that were plausible, newest first. */
  candidates: string[]
  basis:
    | 'head_noun_unique'
    | 'head_noun_multiple'
    /** The noun appears only in the assistant's turn, which introduced it. */
    | 'head_noun_assistant_unique'
    /** The head noun is not written anywhere, but only one candidate exists. */
    | 'head_noun_absent_single_available'
    /** The head noun is not written anywhere and several candidates exist. */
    | 'head_noun_absent_multiple'
    | 'pronoun_single'
    | 'pronoun_multiple'
    | 'no_candidate'
    | 'blocked_by_topic_switch'
    | 'quoted_antecedent'
}

const TOPIC_SWITCH_MARKER = /(?:换个话题|换个问题|另一个问题|另外|先不说|说点别的|顺便问|new topic|different question|switch topics|unrelated question)/iu
// Not anchored: the deictic usually sits inside a request ("帮我看看这个函数"),
// and anchoring it at the start of the turn found nothing.
const DEICTIC_HEAD = /[这那](?:个|张|段|份|篇|条|行|句|些|种|位|块|只)?\s*([^\s，。！？,!?]{0,12})/u
/**
 * Where a Chinese noun phrase stops.
 *
 * Chinese has no spaces, so `这段代码删掉` captures the following verb as part
 * of the "noun". Matching a candidate against `代码删掉` never succeeds, which
 * turned every imperative that names a deictic object into an unresolved
 * reference. The head is cut at the first verb, question word or particle.
 */
const HEAD_STOP = /(?:删|改|看|查|写|做|加|换|保存|执行|清空|移动|移|修|检查|整理|分析|优化|重写|生成|创建|打开|关闭|读取|读|说|讲|给|发|弄|跑|试|帮|请|为|怎|如|是|有|太|很|不|没|的|了|吧|呢|吗|啊|呗|么)/u

/**
 * The head noun after a deictic determiner: "这个函数" → "函数".
 *
 * A bare pronoun ("它", "这个") yields null, which is a different case: there is
 * no noun to match on, so only a single-candidate window can resolve it.
 */
export function deicticHeadNoun(text: string): string | null {
  const match = DEICTIC_HEAD.exec(text.trim())
  if (!match) return null
  const captured = (match[1] ?? '').trim()
  const stop = HEAD_STOP.exec(captured)
  const head = (stop ? captured.slice(0, stop.index) : captured).replace(/[的了呢吗吧啊]$/u, '').trim()
  return head.length >= 2 ? head.slice(0, 12) : null
}

function isMostlyQuotation(body: string): boolean {
  const quoted = (body.match(/"[^"\r\n]*"|“[^”\r\n]*”|‘[^’\r\n]*’|「[^」\r\n]*」|『[^』\r\n]*』|`[^`\r\n]*`/gu) ?? []).join('').length
  return body.length > 0 && quoted >= Math.max(8, Math.round(body.length * 0.5))
}

/**
 * Resolves a deictic against the last few turns.
 *
 * The window is deliberately small: a pronoun refers to something recent, and
 * searching the whole history would manufacture confidence.
 */
export function resolveAntecedent(content: string, history: readonly CognitiveHistoryMessage[]): AntecedentResolution {
  const recent = history.slice(-6).filter((message) => message.body.trim().length > 0)
  if (recent.length === 0) return { status: 'none', messageId: null, candidates: [], basis: 'no_candidate' }

  // Everything after a topic switch is a new topic; nothing before it can be the
  // antecedent of a pronoun in the new topic.
  let boundary = 0
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (TOPIC_SWITCH_MARKER.test(recent[index]!.body)) { boundary = index + 1; break }
  }
  const window = recent.slice(boundary)
  if (window.length === 0) return { status: 'none', messageId: null, candidates: [], basis: 'blocked_by_topic_switch' }

  const head = deicticHeadNoun(content)
  const quotedOnly = window.filter((message) => isMostlyQuotation(message.body))
  const usable = window.filter((message) => !isMostlyQuotation(message.body))

  /**
   * Who counts as a referent.
   *
   * The assistant's turn is a *response*, not a new thing the user pointed at.
   * Counting it as a competing candidate made "我的函数有问题 → 把这段代码删掉"
   * ambiguous ("函数" and "代码" both in scope), so a perfectly clear request lost
   * its object and became a question. The user's own turns are the scope; the
   * assistant's turn is consulted only when it is the one that named the noun.
   */
  const userCandidates = usable.filter((message) => message.role === 'user')
  const assistantCandidates = usable.filter((message) => message.role === 'assistant')
  const scope = userCandidates.length > 0 ? userCandidates : usable

  const bound = (message: CognitiveHistoryMessage, basis: AntecedentResolution['basis']): AntecedentResolution => ({
    status: 'bound',
    messageId: message.id,
    candidates: [message.id],
    basis
  })
  const ambiguous = (messages: readonly CognitiveHistoryMessage[], basis: AntecedentResolution['basis']): AntecedentResolution => ({
    status: 'ambiguous',
    messageId: null,
    candidates: messages.map((message) => message.id),
    basis
  })

  if (head !== null) {
    // 1. The noun in the user's own turns decides.
    const inUser = scope.filter((message) => message.body.includes(head))
    if (inUser.length === 1) return bound(inUser[0]!, 'head_noun_unique')
    if (inUser.length > 1) return ambiguous(inUser, 'head_noun_multiple')

    // 2. The assistant may have introduced the noun ("这个缓存穿透").
    const inAssistant = assistantCandidates.filter((message) => message.body.includes(head))
    if (inAssistant.length === 1) return bound(inAssistant[0]!, 'head_noun_assistant_unique')
    if (inAssistant.length > 1) return ambiguous(inAssistant, 'head_noun_multiple')

    // 3. The noun is written nowhere. That is not proof there is no antecedent:
    // "这段代码" routinely refers to a function the user described without ever
    // writing the word "代码". Scope is what makes the reference decidable, so
    // it still applies — one candidate in scope is unambiguous, several are not.
    if (scope.length === 1) return bound(scope[0]!, 'head_noun_absent_single_available')
    if (scope.length === 0) {
      return {
        status: 'none',
        messageId: null,
        candidates: quotedOnly.map((message) => message.id),
        basis: 'quoted_antecedent'
      }
    }
    return ambiguous(scope, 'head_noun_absent_multiple')
  }

  // Bare pronoun: only a single candidate in scope is unambiguous.
  if (scope.length === 1) return bound(scope[0]!, 'pronoun_single')
  if (scope.length === 0) {
    return {
      status: 'none',
      messageId: null,
      candidates: quotedOnly.map((message) => message.id),
      basis: 'quoted_antecedent'
    }
  }
  return ambiguous(scope, 'pronoun_multiple')
}

export function readLocalContext(input: LocalContextInput): LocalContext {
  const history = Array.isArray(input.history) ? input.history : []
  const priorUser = [...history].reverse().find((message) => message.role === 'user') ?? null
  const priorAssistant = [...history].reverse().find((message) => message.role === 'assistant') ?? null
  const content = typeof input.content === 'string' ? input.content.normalize('NFKC') : ''
  const evidence: string[] = []
  if (priorUser) evidence.push('prior_user_message')
  if (priorAssistant) evidence.push('prior_assistant_message')

  const assistantAsked = askedQuestion(priorAssistant?.body ?? null)
  if (assistantAsked) evidence.push('assistant_asked_question')
  const assistantOffer = offerOf(priorAssistant?.body ?? null)
  if (assistantOffer !== 'none') evidence.push(`assistant_offered_${assistantOffer}`)

  const affirmation = bareAnswerOf(content)
  if (affirmation !== 'none') evidence.push(affirmation === 'affirm' ? 'user_affirmed_prior' : 'user_denied_prior')

  const continuationTarget = continuationOf(content, assistantOffer, assistantAsked, priorAssistant?.body ?? null)
  if (continuationTarget !== 'none') evidence.push(`continues_${continuationTarget}`)
  const sequencing = priorUser !== null && /^(?:先|首先|然后|接着|下一步|再者|另外)/u.test(content.trim())
  if (sequencing) evidence.push('sequences_prior_turn')
  const antecedent = resolveAntecedent(content, history)
  if (antecedent.status !== 'none') evidence.push(`antecedent_${antecedent.status}`)

  return {
    version: LOCAL_CONTEXT_VERSION,
    hasPriorTurn: history.length > 0,
    priorUserBody: priorUser?.body ?? null,
    priorAssistantBody: priorAssistant?.body ?? null,
    assistantAskedQuestion: assistantAsked,
    assistantOffer,
    affirmation,
    continuationTarget,
    sequencing,
    antecedent,
    evidence
  }
}
