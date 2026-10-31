/**
 * Speech act, separated from intent.
 *
 * The classifier this replaces had one label per turn, so "他说把所有记录删掉"
 * and "把所有记录删掉" were the same object once the quotation was stripped: the
 * only surviving difference was a few characters of "他说", which no rule read.
 * The user's *act* and the user's *goal* are different questions and are now
 * answered separately:
 *
 *   speech act — what kind of move this utterance is (asking, requesting,
 *                retracting, quoting, hypothesising…), and whose move it is
 *   intent     — what the user wants to happen (see `intent-reading.ts`)
 *
 * One act can carry several intents and one intent can be expressed by several
 * acts, so neither is derived from the other.
 *
 * Everything here is a **hand-written rule baseline**. No labelled set exists
 * for these patterns, so no number produced from this module may be called a
 * probability, and no report may quote an accuracy figure for it.
 */

import { stripQuotedAndReportedText } from './cognition'

export const SPEECH_ACTS = [
  'statement',
  'question',
  'request',
  'correction',
  'retraction',
  'refusal',
  'clarification',
  'hypothesis',
  'quotation',
  'joke',
  'emotional_expression',
  'preference_expression',
  'other'
] as const

export type SpeechAct = typeof SPEECH_ACTS[number]

export const SPEECH_ACT_VERSION = 'speech-act-v1' as const

/** Whose move this is. A quoted or hypothetical act never binds the user. */
export type SpeechActAttribution = 'user' | 'quoted_other' | 'hypothetical' | 'none'

export type NegationScope = 'none' | 'clause' | 'verb_phrase'

export interface SpeechActReading {
  act: SpeechAct
  /** Act the surface form suggests before any context is applied. */
  surfaceAct: SpeechAct
  /** Acts that also plausibly apply. Never used to overwrite `act`. */
  secondary: SpeechAct[]
  attributedTo: SpeechActAttribution
  /**
   * Whether this utterance authorises the assistant to *perform* something.
   *
   * Only a first-person request binds. A quotation of someone else's command, a
   * hypothetical, a joke and a preference statement all return false — that is
   * the entire point of keeping the field here rather than re-deriving it at
   * the call site.
   */
  binds: boolean
  /** Canonical action named by the utterance, when it names one. */
  action: string | null
  negation: { scope: NegationScope; verb: string | null }
  /** Auditable rule codes, never free-form model text. */
  evidence: string[]
  version: typeof SPEECH_ACT_VERSION
}

export interface SpeechActInput {
  content: string
  /** The user's previous message, for confirmation/denial and reference turns. */
  priorUserBody?: string | null
  /** The assistant's previous message, for capability-vs-request and offers. */
  priorAssistantBody?: string | null
}

/** Canonical actions, so "删掉" and "清空" are one thing downstream. */
const ACTIONS: ReadonlyArray<{ action: string; pattern: RegExp }> = [
  { action: 'delete', pattern: /(?:删除|删掉|删了|删掉它|清空|清除|抹掉|移除)|\b(?:delete|remove|erase|wipe|clear)\b/iu },
  { action: 'save', pattern: /(?:保存|记住|记下来|存起来|记录一下)|\b(?:save|remember|store)\b/iu },
  { action: 'execute', pattern: /(?:执行|运行|跑一下|动手|开始做|做一遍)|\b(?:execute|run it|do it|go ahead)\b/iu },
  { action: 'modify', pattern: /(?:修改|改一下|改成|重写|调整)|\b(?:modify|change|rewrite|edit)\b/iu },
  { action: 'continue', pattern: /(?:继续|接着说|往下说|接着讲|接着做)|\b(?:continue|go on|carry on|keep going)\b/iu },
  { action: 'look', pattern: /(?:看看|看一下|帮我看|检查|审查|review)|\b(?:look at|check|review|take a look)\b/iu }
]

/** A negated action is a retraction of that action, not a request for it. */
const NEGATED_ACTION = /(?:不要|别|不用|不需要|无需|停止|取消|先别|暂时别)\s*(?:再\s*)?/iu
const RETRACTION_MARKERS = /(?:算了|当我没说|撤回|收回|取消(?:刚才|这个|上面)|不做了|不弄了|先不(?:做|弄|管)了|forget it|never mind|scratch that|call it off|withdraw that)/iu
const CORRECTION_MARKERS = /(?:更正|纠正|我(?:刚才)?(?:说错了?|讲错了?)|你理解错了|我的意思是|我说的是|我不是说|不是我说的|记错了|改正|不应该是|不对)|\b(?:correction|i meant|i mean|i was wrong|that'?s not right|not what i meant|you misunderstood|you got (?:it|that) wrong)\b/iu
/** A correction *of the assistant's reading*, not of a fact. */
const MISREAD_CORRECTION = /(?:我不是说|我没说|不是让你|我没让你|我的意思不是|不是这个意思)|\b(?:i didn'?t (?:say|mean)|that'?s not what i (?:said|meant)|i wasn'?t asking you to)\b/iu
const CLARIFICATION_REQUEST = /(?:你指的是什么|你指的是哪个|什么意思|不太明白你(?:的)?意思|我没(?:有)?懂|没听懂|再说一遍|能说清楚)|\b(?:what do you mean|i don'?t understand|i don'?t follow|can you clarify|which one do you mean)\b/iu
const HYPOTHETICAL = /(?:如果|假如|假设|要是|万一|倘若)|\b(?:if |suppose|supposing|what if|hypothetically|in case)\b/iu
/** A hypothetical that asks about behaviour ("你会怎么做") is not an authorisation. */
const HYPOTHETICAL_BEHAVIOUR = /(?:会(?:怎么做|怎么办|怎么处理|如何处理|做什么)|该(?:怎么|如何)|你(?:会|能)(?:做|处理|办))|\b(?:what would you do|how would you handle|what would happen)\b/iu
const REFUSAL = /^(?:不用了?|不必了?|不需要|算了|不用麻烦了|暂时不用|先不用|no thanks|no thank you|not necessary)(?=[\s，。！？、,.!?;：:]|$)/iu
const JOKE = /(?:开玩笑|逗你的|逗你玩|说说而已|开个玩笑|哈哈|呵呵|😂|🤣)|\b(?:just kidding|kidding|joking|jk|haha|lol)\b/iu
const IRONY = /(?:说反话|阴阳怪气|真是好极了|太好了呢)|\b(?:yeah right|as if|sure,? that went well|great,? just great)\b/iu
const EMOTION = /(?:想倾诉|想吐槽|只是想说|心情(?:很|有点)?(?:差|糟|不好)|(?:很|有点|非常|特别)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受)|压力很大|受不了了|感觉(?:很|有点)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受))|\b(?:i need to vent|i (?:feel|am feeling) (?:really )?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down)|i['’]m (?:feeling (?:really )?)?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down))\b/iu
const PREFERENCE = /(?:我喜欢|我不喜欢|我偏好|我讨厌|我更(?:喜欢|愿意)|我更喜欢)|\b(?:i (?:like|love|prefer|dislike|hate)|i (?:do not|don'?t) (?:like|prefer))\b/iu
/** A bare continuation ("继续", "继续", "可以，继续") is an imperative. */
const CONTINUATION_IMPERATIVE = /^(?:(?:那|就)?(?:继续|接着|往下|然后继续|接着说|接着讲)|(?:可以|好|行|嗯|对)[，,。.\s]*(?:继续|接着|往下|go on)|(?:go on|continue|carry on|keep going))\s*[。.!！,，]?$/iu
/** Imperative request shapes, including the polite forms. */
const REQUEST = /(?:帮我|帮忙|请(?:你)?|麻烦(?:你)?|给我|替我|替我看看|能不能(?:帮我|给我)|可以(?:帮我|给我)|把.{1,20}(?:删|改|加|换|做|写))|\b(?:please|can you|could you|would you|help me|i need you to|do me a favor)\b/iu
/** "你能不能…" asks about capability *or* requests, decided by context only. */
const CAPABILITY_QUESTION = /(?:你能不能|你可以|你会不会|你能|能否|可不可以)|\b(?:can you|could you|are you able to|is it possible for you to)\b/iu
const QUESTION_SURFACE = /[?？]/u
const QUESTION_WORD = /(?:什么|怎么|如何|为什么|哪一?个|哪家|哪些|哪种|哪儿|哪里|什么时候|多少|谁|是否|吗)|\b(?:what|who|where|when|which|why|how)\b/iu
const AFFIRMATION = /^(?:可以|好|行|嗯|对|是的|没问题|ok|okay|sure|yes|yep|fine)\b/iu

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim()
}

/** Locates the action named by the utterance, first match wins by table order. */
function findAction(text: string): string | null {
  for (const entry of ACTIONS) if (entry.pattern.test(text)) return entry.action
  return null
}

/**
 * Negation *scope*, not merely negation presence.
 *
 * "不要删除刚才那条" negates the verb phrase, so it withdraws a delete. "我觉得
 * 不删除也没关系" contains a negation but states a position, so it withdraws
 * nothing. A whole-clause negation is recorded as `clause` and only counts as a
 * retraction when it is also imperative.
 */
function negationOf(text: string, action: string | null): SpeechActReading['negation'] {
  // The imperative check comes first on purpose. It used to come second behind
  // an anchored "starts with 不" test, so "不要删除刚才那条" was classified as a
  // clause-level negation and the retraction was lost — the one sentence in the
  // task that must stop a previous delete.
  const imperative = NEGATED_ACTION.test(text) && action !== null
  if (imperative) return { scope: 'verb_phrase', verb: action }
  if (/(?:不|没|别|未|非|无)|\b(?:not|no|never|don'?t)\b/iu.test(text)) return { scope: 'clause', verb: null }
  return { scope: 'none', verb: null }
}

/** Whether the assistant's previous turn offered an action it could perform. */
function assistantOfferedAction(priorAssistantBody: string | null | undefined): boolean {
  if (typeof priorAssistantBody !== 'string' || priorAssistantBody.trim().length === 0) return false
  return /(?:要我|需要我|我可以|我来|帮你|给你|要不要我|需要的话)|\b(?:shall i|should i|do you want me to|i can|may i)\b/iu.test(priorAssistantBody)
}

/**
 * Reads one utterance's speech act.
 *
 * Order is deliberate: the most specific reading wins. A quotation cannot also
 * be the user's request, a hypothetical cannot authorise anything, and a
 * negated imperative is a retraction of the action it negates.
 */
export function analyzeSpeechAct(input: SpeechActInput): SpeechActReading {
  if (typeof input.content !== 'string') throw new TypeError('Speech act input requires text.')
  const raw = input.content
  // Every marker is tested on the text with quotations and reported speech
  // removed. Testing the raw text read "Translate this quote: “You misunderstood
  // me”" as a correction *by the user*, which is the exact misattribution the
  // speech-act layer exists to prevent.
  const unquoted = stripQuotedAndReportedText(raw)
  const text = normalize(unquoted)
  const evidence: string[] = []
  const secondary: SpeechAct[] = []
  const action = findAction(text)
  const negation = negationOf(text, action)

  // A turn that is *entirely* quoted or reported speech has no first-person act
  // left to read. It is recorded as quotation so nothing downstream can use the
  // quoted command as the user's own.
  const quotedOnly = text.replace(/[\s，。！？、；：,.!?;:]/gu, '')
  const hasQuotation = /["“”‘’「」『』`]/u.test(raw) || /(?:说|提到|表示|写道|称)/u.test(raw)
  // A turn that is *mostly* someone else's words is a quotation even when a
  // short instruction frames it ("Translate this quote: …"). The instruction is
  // real, but it is not a proposition about the user's own state, and the quoted
  // words must never become one.
  const quotedCharacters = (raw.match(/"[^"\r\n]*"|“[^”\r\n]*”|‘[^’\r\n]*’|「[^」\r\n]*」|『[^』\r\n]*』|`[^`\r\n]*`/gu) ?? []).join('').length
  const dominantQuotation = hasQuotation && quotedCharacters >= Math.max(8, Math.round(raw.length * 0.4))
  if (hasQuotation && (quotedOnly.length === 0 || dominantQuotation)) {
    evidence.push(quotedOnly.length === 0 ? 'quotation_only' : 'quotation_dominant')
    return {
      act: 'quotation',
      surfaceAct: QUESTION_SURFACE.test(raw) ? 'question' : /(?:删|改|做|给我|帮我)/u.test(raw) ? 'request' : 'statement',
      secondary,
      attributedTo: 'quoted_other',
      // The whole point: someone else's command is not the user's request.
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  if (HYPOTHETICAL.test(text)) {
    evidence.push('conditional_mood')
    if (HYPOTHETICAL_BEHAVIOUR.test(text)) evidence.push('hypothetical_behaviour_question')
    if (QUESTION_SURFACE.test(raw) || QUESTION_WORD.test(text)) secondary.push('question')
    return {
      act: 'hypothesis',
      surfaceAct: secondary.includes('question') ? 'question' : 'statement',
      secondary,
      attributedTo: 'hypothetical',
      // "如果我让你删除，你会怎么做" authorises nothing.
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  // A negated imperative withdraws an action; a retraction marker withdraws the
  // whole turn. Both are the user's own act and neither binds.
  if (RETRACTION_MARKERS.test(text) || negation.scope === 'verb_phrase') {
    evidence.push(negation.scope === 'verb_phrase' ? 'negated_imperative' : 'retraction_marker')
    return {
      act: 'retraction',
      surfaceAct: 'request',
      secondary,
      attributedTo: 'user',
      binds: false,
      action: negation.verb ?? action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  if (MISREAD_CORRECTION.test(text) || CORRECTION_MARKERS.test(text)) {
    evidence.push(MISREAD_CORRECTION.test(text) ? 'misread_correction' : 'correction_marker')
    if (action) secondary.push('request')
    return {
      act: 'correction',
      surfaceAct: QUESTION_SURFACE.test(raw) ? 'question' : 'statement',
      secondary,
      attributedTo: 'user',
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  if (CLARIFICATION_REQUEST.test(text)) {
    evidence.push('clarification_marker')
    return {
      act: 'clarification',
      surfaceAct: 'question',
      secondary,
      attributedTo: 'user',
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  if (REFUSAL.test(text)) {
    evidence.push('refusal_marker')
    return {
      act: 'refusal',
      surfaceAct: 'statement',
      secondary,
      attributedTo: 'user',
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  if (JOKE.test(text) || IRONY.test(text)) {
    evidence.push(JOKE.test(text) ? 'joke_marker' : 'irony_marker')
    // Irony inverts the surface reading, so the surface act is kept separately
    // and the act itself is `joke`: a joke is not an instruction.
    return {
      act: 'joke',
      surfaceAct: REQUEST.test(text) ? 'request' : QUESTION_SURFACE.test(raw) ? 'question' : 'statement',
      secondary,
      attributedTo: 'user',
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  // "你能不能……" is capability or request depending on what the assistant just
  // offered. Without that context the turn is answered as both ("yes, and here
  // it is") rather than interrogated, which is why the ambiguity is recorded
  // instead of resolved by a guess.
  if (CAPABILITY_QUESTION.test(text) && !QUESTION_WORD.test(text.replace(/(?:能不能|可以|能否|可不可以|你能)/gu, ''))) {
    const offered = assistantOfferedAction(input.priorAssistantBody)
    evidence.push(offered ? 'capability_after_offer' : 'capability_without_offer')
    if (offered) {
      secondary.push('question')
      return {
        act: 'request',
        surfaceAct: 'question',
        secondary,
        attributedTo: 'user',
        binds: true,
        action,
        negation,
        evidence,
        version: SPEECH_ACT_VERSION
      }
    }
    secondary.push('request')
    return {
      act: 'question',
      surfaceAct: 'question',
      secondary,
      attributedTo: 'user',
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  if (EMOTION.test(text)) {
    evidence.push('affect_lexicon')
    return {
      act: 'emotional_expression',
      surfaceAct: 'statement',
      secondary,
      attributedTo: 'user',
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  if (PREFERENCE.test(text) && !REQUEST.test(text)) {
    evidence.push('preference_marker')
    return {
      act: 'preference_expression',
      surfaceAct: 'statement',
      secondary,
      attributedTo: 'user',
      // "我更喜欢你直接一点" asks for a style without asking for a task, so it
      // does not authorise execution; the growth layer reads it separately.
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }

  // A bare imperative naming an action ("删除刚才那条记录") is a request even
  // without a politeness marker. The guard is the grammatical subject: a
  // sentence with a first-person subject is a report ("我删除了那个文件"), and a
  // question is a question.
  const bareImperative = action !== null && !QUESTION_SURFACE.test(raw) &&
    !/(?:^|[^\p{L}])(?:我|我们)(?=[^\p{L}]|$)|\b(?:i|we)\b/iu.test(text)
  const imperative = REQUEST.test(text) || bareImperative
  // "继续" alone names an action with no object: it is a request to carry on,
  // and the *what* comes from the assistant's previous turn, not from this one.
  if (CONTINUATION_IMPERATIVE.test(text)) {
    evidence.push('continuation_imperative')
    if (QUESTION_SURFACE.test(raw)) secondary.push('question')
    return {
      act: 'request',
      surfaceAct: 'statement',
      secondary,
      attributedTo: 'user',
      binds: true,
      action: action ?? 'continue',
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }
  const asking = QUESTION_SURFACE.test(raw) || QUESTION_WORD.test(text)
  if (imperative) {
    evidence.push('imperative_marker')
    if (asking) secondary.push('question')
    return {
      act: 'request',
      surfaceAct: asking ? 'question' : 'request',
      secondary,
      attributedTo: 'user',
      binds: true,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }
  if (asking) {
    evidence.push(QUESTION_SURFACE.test(raw) ? 'question_punctuation' : 'question_word')
    return {
      act: 'question',
      surfaceAct: 'question',
      secondary,
      attributedTo: 'user',
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    }
  }
  if (AFFIRMATION.test(text)) evidence.push('affirmation_marker')

  return {
    act: 'statement',
    surfaceAct: 'statement',
    secondary,
    attributedTo: 'user',
    binds: false,
    action,
    negation,
    evidence: evidence.length > 0 ? evidence : ['no_act_marker'],
    version: SPEECH_ACT_VERSION
  }
}

export function isSpeechAct(value: unknown): value is SpeechAct {
  return typeof value === 'string' && (SPEECH_ACTS as readonly string[]).includes(value)
}

/** Structural check for the persisted reading. */
export function isSpeechActReading(value: unknown): value is SpeechActReading {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.version !== SPEECH_ACT_VERSION) return false
  if (!isSpeechAct(record.act) || !isSpeechAct(record.surfaceAct)) return false
  if (!Array.isArray(record.secondary) || record.secondary.length > 3 || !record.secondary.every(isSpeechAct)) return false
  if (!['user', 'quoted_other', 'hypothetical', 'none'].includes(String(record.attributedTo))) return false
  if (typeof record.binds !== 'boolean') return false
  if (record.action !== null && typeof record.action !== 'string') return false
  const negation = record.negation as Record<string, unknown> | undefined
  if (!negation || !['none', 'clause', 'verb_phrase'].includes(String(negation.scope))) return false
  if (negation.verb !== null && typeof negation.verb !== 'string') return false
  if (!Array.isArray(record.evidence) || record.evidence.length === 0 || record.evidence.length > 8) return false
  if (!record.evidence.every((item) => typeof item === 'string' && /^[a-z_]{3,48}$/u.test(item))) return false
  // A quoted or hypothetical act that claims to bind is internally inconsistent:
  // reject it rather than let a later reader trust the flag over the act.
  if (record.attributedTo !== 'user' && record.binds === true) return false
  return true
}
