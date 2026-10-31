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
  /** Auditable rule codes for the above. */
  evidence: string[]
}

export interface LocalContextInput {
  content: string
  history: readonly CognitiveHistoryMessage[]
}

const AFFIRM = /^(?:可以|好|行|嗯|对|是的|没问题|ok|okay|sure|yes|yep|fine|go ahead)\b/iu
const DENY = /^(?:不用|不要|不必|不行|算了|no|nope|not now|no thanks)\b/iu
const CONTINUE = /(?:继续|接着|往下|然后呢|go on|continue|carry on|keep going)/iu
const ASK_QUESTION = /[?？]\s*$/u

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
  // assistant had just asked whether to go on.
  const affirming = AFFIRM.test(content) || /^(?:可以|好|行)[，,。.\s]*(?:继续|接着)/u.test(content)
  if (!continuing && !(affirming && assistantAsked)) return 'none'
  if (offer === 'execute') return 'execution'
  if (offer === 'explain') return 'explanation'
  if (offer === 'discuss') return 'discussion'
  // With no offer the only thing a "继续" can continue is the conversation
  // itself; calling that `discussion` is a claim, so it stays `none`.
  return 'none'
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

  const affirmation = AFFIRM.test(content.trim()) ? 'affirm' : DENY.test(content.trim()) ? 'deny' : 'none'
  if (affirmation !== 'none') evidence.push(affirmation === 'affirm' ? 'user_affirmed_prior' : 'user_denied_prior')

  const continuationTarget = continuationOf(content, assistantOffer, assistantAsked, priorAssistant?.body ?? null)
  if (continuationTarget !== 'none') evidence.push(`continues_${continuationTarget}`)
  const sequencing = priorUser !== null && /^(?:先|首先|然后|接着|下一步|再者|另外)/u.test(content.trim())
  if (sequencing) evidence.push('sequences_prior_turn')

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
    evidence
  }
}
