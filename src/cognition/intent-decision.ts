/**
 * Intent understanding, Phase 2.
 *
 * One decision engine produces both the Phase-2 intent label and the legacy
 * `CognitiveIntent` that is persisted with a turn, so there is exactly one
 * classifier in the codebase. The legacy label exists because stored
 * observations from earlier slices are validated against the old taxonomy;
 * new labels are a superset and map onto it deterministically.
 *
 * Design rules enforced here:
 *   - a single keyword never decides the intent; every rule is a phrase-level
 *     pattern and each decision lists the reasons it fired
 *   - a short deictic turn with no prior message becomes `ambiguous` instead of
 *     being guessed
 *   - correction / preference / goal only ever produce a *candidate*; nothing
 *     in this module writes memory or personality
 *   - confidence is uncalibrated rule strength, never a probability
 */
import { readFactSlot, type FactSlot } from '../memory/fact-slot'
import type { CognitiveIntent } from './cognition'

export const INTENT_DECISION_VERSION = 'intent-rules-v2' as const

export const INTENT_LABELS = [
  'information_query',
  'continuation',
  'correction',
  'preference_expression',
  'emotion_expression',
  'goal_or_plan',
  'new_topic',
  'ambiguous',
  // A plain self-disclosure ("我住在杭州") is neither a preference nor a query;
  // it keeps its own class so it is never read as either.
  'self_fact',
  // A request for an action ("帮我把这段代码删掉") is not a question. Without its
  // own label it was either `ambiguous` or `information_query`, and both are
  // wrong in a way that reaches the retrieval policy.
  'request',
  // Preserved from the earlier taxonomy so stored turns keep a meaningful label.
  'explanation',
  'exploration',
  'feedback'
] as const

export type IntentLabel = typeof INTENT_LABELS[number]
export type IntentConfidenceLevel = 'low' | 'medium' | 'high'

export interface IntentDecision {
  version: typeof INTENT_DECISION_VERSION
  intent: IntentLabel
  /** Label written to the persisted turn record (legacy taxonomy). */
  legacyIntent: CognitiveIntent
  confidence: number
  confidenceLevel: IntentConfidenceLevel
  needsMemoryRetrieval: boolean
  dependsOnPriorTurn: boolean
  /** True only for "may create a candidate", never for "writes memory". */
  mayProduceMemoryCandidate: boolean
  alternatives: IntentLabel[]
  /** Short, auditable rule codes; never free-form model text. */
  reasons: string[]
}

export interface IntentInput {
  content: string
  priorUserBody?: string | null
  hasPriorTurn: boolean
}

const LEGACY_MAP: Readonly<Record<IntentLabel, CognitiveIntent>> = {
  information_query: 'information_query',
  continuation: 'information_query',
  correction: 'correction',
  preference_expression: 'sharing',
  emotion_expression: 'venting',
  goal_or_plan: 'planning',
  // A topic switch is a routing hint, not a request to brainstorm: mapping it
  // to `exploration` made the affect engine emit an exploration event.
  new_topic: 'information_query',
  ambiguous: 'uncertain',
  self_fact: 'sharing',
  // The legacy taxonomy has no request class; a request is answered like a
  // query, and the speech act carries the difference that matters.
  request: 'information_query',
  explanation: 'explanation',
  exploration: 'exploration',
  feedback: 'feedback'
}

/** The single projection from a Phase-2 label onto the legacy taxonomy. */
export function legacyIntentOf(label: IntentLabel): CognitiveIntent {
  return LEGACY_MAP[label]
}

/** Retrieval need per label. Ambiguity deliberately retrieves nothing. */
export const RETRIEVAL: Readonly<Record<IntentLabel, boolean>> = {
  information_query: true,
  continuation: true,
  correction: true,
  // "按需" retrieval: a stated preference is answered first; the policy still
  // restricts what may be attached to related preference history.
  preference_expression: false,
  emotion_expression: false,
  goal_or_plan: true,
  new_topic: false,
  ambiguous: false,
  self_fact: false,
  request: true,
  explanation: false,
  exploration: false,
  feedback: false
}

/** Labels that may propose a memory candidate (never write one). */
const CANDIDATE: Readonly<Record<IntentLabel, boolean>> = {
  information_query: false,
  continuation: false,
  correction: true,
  preference_expression: true,
  emotion_expression: false,
  goal_or_plan: true,
  new_topic: false,
  ambiguous: false,
  self_fact: true,
  request: false,
  explanation: false,
  exploration: false,
  feedback: false
}

interface RuleSignal {
  label: IntentLabel
  weight: number
  /** Every rule text that fired for this source, kept for the audit trail. */
  reasons: string[]
  /**
   * What evidence produced this signal.
   *
   * Two rules reading the *same* evidence must not count twice. `EXPLICIT_GOAL`
   * and `GOAL_REQUEST` are two patterns over one sentence, and a turn ending in
   * "？" fired both `question_marker` and `question_punctuation` — same surface
   * fact, two weights. The corroboration bonus used to be computed from the raw
   * signal count, so one sentence could look like three independent cues.
   * Signals now collapse by source before anything is scored.
   */
  source: string
}

const CORRECTION = /(?:更正|纠正|我(?:刚才)?(?:说错了?|讲错了?)|你理解错了|我的意思是|我说的是|我不是说|其实(?:我|是)|不对|不是我说的|记错了|改正|不应该是)|\b(?:correction|i meant|i mean|i was wrong|that's not right|that is not right|not what i meant|not what i asked|you misunderstood|your answer(?: is| was)? (?:wrong|incorrect)|(?:this|that|the) answer (?:is|was) (?:wrong|incorrect)|you(?:'re| are) wrong|you got (?:it|that) wrong|i gave you the wrong|actually i (?:meant|said))\b/iu
const CHANGED_MIND = /(?:我改主意|改变主意|改了主意|不再(?:喜欢|想要|想)|我不喜欢了|换一个|改成|不想要了|还是.{0,12}(?:吧|好了))|\b(?:let's do.{0,40}instead|i changed my mind|i'd rather|i would rather|instead of|i no longer (?:like|prefer)|i (?:don't|do not) like.{0,40}anymore)\b/iu
const FEEDBACK = /(?:谢谢|感谢|很好用|有帮助|没帮助|很差|不满意|做得好|回答不错|反馈|你回答得)|\b(?:thank you|thanks|not useful|helpful|not helpful|great answer|poor answer|i appreciate|feedback)\b/iu
const EMOTION = /(?:想倾诉|想吐槽|只是想说|心情(?:很|有点)?(?:差|糟|不好)|(?:很|有点|非常|特别)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受)|压力很大|受不了了|感觉(?:很|有点)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受))|\b(?:i need to vent|i (?:feel|am feeling) (?:really )?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down)|i['’]m (?:feeling (?:really )?)?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down))\b/iu
/** A request to plan ("帮我制定计划") is not the same as stating a goal. */
const GOAL_REQUEST = /(?:计划|规划|安排|下一步|帮我制定|帮我计划|怎么开始|如何开始)|\b(?:plan|planning|schedule|roadmap|next steps|help me plan|how should i start)\b/iu
/** An explicit goal statement: the user says what they intend to do. */
const EXPLICIT_GOAL = /(?:我(?:打算|计划|准备|想要?)|我的目标|目标是|我想(?:先|要|在|于|把|完成|实现|开始))|\b(?:i want to|i want to achieve|my goal is|i intend to|i plan to)\b/iu
/** An imperative asking Morrow to do something, not to answer something. */
const REQUEST_SHAPE = /(?:帮我|帮忙|请(?:你)?(?:帮|给|把)|麻烦(?:你)?|给我(?:把|写|改|看|查)|替我|把[^，。！？,!?]{1,20}(?:删|改|加|换|做|写|清空|移))|(?:please|can you|could you|would you|help me)/iu
const EXPLANATION = /(?:解释(?:一下)?|说明一下|为什么会|为什么(?:是|要|会|不|.{1,12})|原理|原因是什么|是什么意思|怎么回事)|\b(?:explain|why does|why is|how does|what causes|what does .* mean)\b/iu
const EXPLORATION = /(?:聊聊|讨论一下|探讨|探索|头脑风暴|一起想想|有什么想法|可以聊)|\b(?:brainstorm|explore|let's discuss|let us discuss|talk through|what are some ideas)\b/iu
const INFORMATION = /(?:什么|怎么|如何|为什么|哪一?个|哪家|哪些|哪种|哪儿|哪里|什么时候|多少|谁|是否|吗[？?。!！]?$|怎么样)|\b(?:what|who|where|when|which|why|how|can you tell me|could you tell me|do you know|is there|are there)\b/iu
const PREFERENCE = /(?:我喜欢|我不喜欢|我偏好|我讨厌|我更(?:喜欢|愿意))|\b(?:i (?:like|love|prefer|dislike|hate)|i (?:do not|don't) (?:like|prefer))\b/iu
const TOPIC_SWITCH = /(?:换个话题|换个问题|另一个问题|另外(?:问)?|先不说|说点别的|顺便问)|\b(?:new topic|different question|by the way|separate question|unrelated question|switch topics|never mind|ignore that|forget that|drop that)\b/iu
const AMBIGUOUS_REFERENCE = /(?:你指的是什么|不确定你指|不太明白你的意思|我不懂你说的)|\b(?:i'm not sure what you mean|i am not sure what you mean|unclear what you mean|ambiguous)\b/iu
const FOLLOW_UP = /^(?:那.{0,24}(?:呢|怎么办|如何|怎么|为什么|可以吗|行吗)|然后|所以|那么|(?:这个|那个|它|这件事|那件事)(?:呢|怎么办|如何|怎么|为什么|怎么样)|上面|刚才|之前)|\b(?:and then|then what|what about|how so|why so|what next|about that|and it|and this)\b/iu
// `that` is deliberately absent: it is a conjunction in "remember that I…".
// Only pronouns and explicit back-references count as a reference.
const DEICTIC = /(?:这个|那个|它|他们|她们|这件事|那件事|上面(?:说的)?|刚才(?:说的)?|之前(?:说的|提的|提到的)|那么|那里|这点)|\b(?:it|this|those|these)\b|\b(?:the above|what about that|that mean|this mean|how so|why so|then what|what next)\b/iu
const SELF_FACT = /(?:我(?:不喜欢|喜欢|偏好|住在|工作在|从事|通常|习惯|的目标|的生日|会))|\bi (?:(?:do not|don't) )?(?:like|prefer|dislike|live|work|usually|tend to|use|avoid)\b/iu
/** A self-disclosure that is not a preference: residence, routine, identity. */
const SELF_DISCLOSURE = /(?:我(?:住在|在.{1,12}(?:工作|上班|学习)|通常|平时|一般|每天|叫|的生日是|今年\d{1,3}岁))|\bi\s+(?:live|work|study|usually|normally|drink|eat|use|am from|am a|am an)\b|\bmy\s+(?:name|job|birthday|routine)\b/iu
const RECALL_REQUEST = /(?:你还记得|你记得我.{0,24}(?:吗|么)|我(?:之前|上次)告诉过你|我(?:之前|上次)(?:说过|说的|提过|提到的|聊过)|我们之前聊过|能回忆起|我的(?:偏好|目标|习惯)(?:是什么|是什么来着|吗|呢))|\b(?:do you remember|can you recall|what do i|what did i tell you|what have i told you|recall my|what is my|what's my)\b/iu
const SAVE_REQUEST = /(?:请(?:你)?记住|记住(?:我|这个|这件事|一下)|以后(?:都)?记得|把这(?:条|件事|个)记下来|保存为记忆)|\b(?:please remember|remember that|remember this|save this as a memory|save that as a memory)\b/iu

function isShortReference(value: string): boolean {
  // Latin words are counted *before* whitespace is removed: stripping spaces
  // turned "What is the capital of Portugal?" into one "word" and made every
  // English question look like a two-word follow-up.
  const han = (value.match(/\p{Script=Han}/gu) ?? []).length
  const latinWords = (value.match(/[A-Za-z0-9]+/gu) ?? []).length
  if (han > 0) return han <= 5 && latinWords <= 2
  return latinWords <= 4
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim()
}

/**
 * Every rule returns a *signal*, not a decision. The weights are hand-set rule
 * strengths on the same scale the earlier slice used, so thresholds remain
 * comparable across reports.
 */
function collectSignals(content: string, hasPriorTurn: boolean, fact: FactSlot | null): RuleSignal[] {
  const signals: RuleSignal[] = []
  const seen = new Map<string, RuleSignal>()
  /** Collapses by (label, source); the first reason text wins, the higher weight stays. */
  const add = (label: IntentLabel, weight: number, reason: string, source: string = reason): void => {
    const key = `${label}|${source}`
    const existing = seen.get(key)
    if (existing) {
      // Same evidence, second pattern: the weight stays single, the audit trail
      // keeps both rule names.
      existing.weight = Math.max(existing.weight, weight)
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
      return
    }
    const signal: RuleSignal = { label, weight, reasons: [reason], source }
    seen.set(key, signal)
    signals.push(signal)
  }

  if (CORRECTION.test(content)) add('correction', 94, 'explicit_correction_marker')
  if (CHANGED_MIND.test(content)) add('correction', 88, 'changed_mind_marker')
  if (FEEDBACK.test(content)) add('feedback', 88, 'feedback_marker')
  if (EMOTION.test(content)) add('emotion_expression', 86, 'affect_lexicon')
  // "我下周有哪些安排？" mentions 安排 but asks a question: the plan marker must
  // not outrank the question reading.
  const goalRequest = GOAL_REQUEST.test(content)
  const explicitGoal = EXPLICIT_GOAL.test(content)
  if ((goalRequest || explicitGoal) && fact?.kind !== 'question') {
    add('goal_or_plan', 88, 'goal_or_plan_marker', 'goal_marker')
  }
  if (explicitGoal) add('goal_or_plan', 88, 'explicit_goal_statement', 'goal_marker')
  // A save request is not a request to act: "请记住我喜欢" is a preference turn.
  if (REQUEST_SHAPE.test(content) && !SAVE_REQUEST.test(content)) add('request', 86, 'imperative_request')
  if (EXPLANATION.test(content)) add('explanation', 88, 'explanation_marker')
  const explorationRequest = EXPLORATION.test(content)
  if (explorationRequest) add('exploration', 84, 'exploration_marker')
  if (TOPIC_SWITCH.test(content)) add('new_topic', 90, 'explicit_topic_switch')
  if (AMBIGUOUS_REFERENCE.test(content)) add('ambiguous', 86, 'self_reported_ambiguity')

  // "我们一起想想还有哪些方案" contains a question word inside an exploration
  // request; that is not a fact query, and treating it as one would split the
  // turn into two equal-confidence readings.
  if (INFORMATION.test(content) && !explorationRequest) {
    add('information_query', 80, 'question_marker', 'question_surface')
  }
  // The punctuation cue shares its source with the question word: both are the
  // same observation ("this sentence asks something"), so it can corroborate
  // nothing. It still fires on its own for turns with no wh-word.
  if (/[?？]/u.test(content)) add('information_query', 64, 'question_punctuation', 'question_surface')
  // A hypothesis or reported speech is not a preference the user holds.
  const hypothetical = /(?:如果|假设|假如|要是|万一|听说|据说|有人说)/u.test(content)
  if (PREFERENCE.test(content) && !hypothetical) add('preference_expression', 80, 'preference_marker')
  if (hypothetical) add('information_query', 82, 'hypothetical_or_reported')
  if (SELF_DISCLOSURE.test(content)) add('self_fact', 78, 'self_disclosure_marker')
  if (RECALL_REQUEST.test(content)) add('information_query', 90, 'explicit_recall_request')
  // A save request that states a preference is a preference turn: the user is
  // telling us something, not asking us to recall something.
  if (SAVE_REQUEST.test(content)) add(PREFERENCE.test(content) || SELF_FACT.test(content) ? 'preference_expression' : 'information_query', 86, 'save_request_with_self_fact')

  // A predicate-level reading is stronger evidence than a lexical marker: the
  // fact layer already decided that this sentence states or asks about a fact.
  if (fact) {
    if (fact.predicate === 'preference' && fact.kind !== 'question') add('preference_expression', 70, 'fact_predicate_preference')
    if (fact.predicate === 'goal') add('goal_or_plan', 70, 'fact_predicate_goal')
    if (fact.predicate === 'schedule' && fact.kind !== 'question') add('goal_or_plan', 62, 'fact_predicate_schedule')
    if (fact.kind === 'question') add('information_query', 66, 'fact_predicate_question')
    if (fact.predicate === 'health' && fact.kind !== 'question') add('information_query', 20, 'fact_predicate_health')
  }

  // Reference-dependent turns. Without a prior turn they cannot be resolved,
  // and guessing the topic is worse than asking.
  // The short-question fallback is for bare follow-ups ("多少钱？"). A complete
  // wh-question ("我住在哪里？") already stands on its own; treating it as a
  // reference let the mere presence of history create a `continuation` candidate
  // that outranked the real reading.
  const reference = FOLLOW_UP.test(content) || DEICTIC.test(content) ||
    (isShortReference(content) && /[?？]/u.test(content) && !INFORMATION.test(content))
  if (reference) {
    // A short reference ("那怎么办？") is almost entirely carried by the prior
    // turn, so it outranks a question word inside it. A longer reference only
    // adds context and must not outrank an explicit marker.
    if (hasPriorTurn) add('continuation', isShortReference(content) ? 86 : 72, 'reference_to_prior_turn')
    else add('ambiguous', 84, 'reference_without_context')
  }
  if (SELF_FACT.test(content) && hasPriorTurn && reference) add('continuation', 60, 'self_fact_inside_reference')

  return signals
}

function levelOf(confidence: number): IntentConfidenceLevel {
  if (confidence >= 80) return 'high'
  if (confidence >= 55) return 'medium'
  return 'low'
}

/**
 * Whether a reading only makes sense against the previous turn.
 *
 * Used by the confidence layer to decide whether context credit is *earned*:
 * labels that stand alone must not gain anything from history being present.
 */
export function referenceDependenceOf(label: IntentLabel, reasons: readonly string[]): boolean {
  if (label === 'continuation') return true
  return reasons.includes('reference_to_prior_turn') || reasons.includes('reference_without_context')
}

/**
 * Retrieval route for one reading.
 *
 * Extracted so the analyser can ask "what would *this* reading need?" about the
 * reading the confidence model selected, instead of always asking about the
 * decision layer's first guess. Two code paths here would let the strategy
 * disagree with the score that supposedly justified it.
 *
 * A question only becomes a *memory* lookup when it is about the user or when
 * the fact layer read a personal predicate in it: "这个多少钱？" is a question
 * with an object, but nothing about it asks for saved personal facts.
 */
export function retrievalNeedOf(
  label: IntentLabel,
  input: { content: string; fact: FactSlot | null; reasons: readonly string[]; hasPriorTurn: boolean }
): boolean {
  if (label === 'emotion_expression') return input.reasons.includes('reference_to_prior_turn')
  if (label === 'information_query') {
    // An explicit recall request retrieves by definition: the user is asking for
    // something stored ("我之前说的茶呢？"). Missing this sent the turn to
    // `answer` even though the only way to answer is to look it up.
    if (input.reasons.includes('explicit_recall_request')) return true
    // Only phrasings that ask about *stored facts about the user*. A bare
    // "how do I cook rice" is a general question; matching `do i` made every such
    // turn look like a memory lookup.
    const personalReference = /(?:我的|我(?:住在|叫|今年|的)|我自己)|\b(?:my|mine|about me|do i (?:like|prefer|have|own|remember)|did i (?:say|tell|mention)|have i (?:told|said|mentioned)|am i (?:allergic|living|working))\b/iu.test(input.content)
    // A reference turn answers from the conversation, not from saved facts.
    const referenceOnly = input.reasons.includes('reference_to_prior_turn') && !personalReference
    if (referenceOnly) return false
    return personalReference || (input.fact?.kind === 'question')
  }
  if (label === 'continuation') return input.hasPriorTurn
  if (label === 'request') {
    // A request to perform something retrieves when it is about the user
    // ("帮我看看我之前说的那个计划") or when it is a planning request, which needs
    // the saved goals to answer. "帮我把这段代码删掉" needs neither.
    const personalReference = /(?:我的|我之前|我上次|我(?:住在|叫|今年)|我自己)|\b(?:my|mine|about me)\b/iu.test(input.content)
    return personalReference || GOAL_REQUEST.test(input.content)
  }
  return RETRIEVAL[label]
}

export interface IntentCandidateScore {
  label: IntentLabel
  /** 0-100 rule strength for this label (strongest rule + corroboration). */
  score: number
  /** Strongest single rule weight behind the label (0-100). */
  maxWeight: number
  reasons: string[]
}

/**
 * Candidate scores for one turn, before any confidence model is applied.
 *
 * Exported so the B1 confidence layer reads the *same* rule evidence the
 * decision uses. A second scoring path would let the two disagree, which is
 * exactly the failure this refactor exists to remove.
 */
export function scoreIntentCandidates(input: IntentInput): IntentCandidateScore[] {
  const content = normalize(input.content)
  const fact = readFactSlot(input.content)
  const signals = collectSignals(content, input.hasPriorTurn, fact)
  // Strength is the *strongest* rule for a label, plus a small corroboration
  // bonus. Summing weights let three weak cues outvote one explicit marker,
  // which is how "为什么…" was once read as a plain question.
  const scores = new Map<IntentLabel, { score: number; maxWeight: number; reasons: string[]; sources: number }>()
  for (const signal of signals) {
    const entry = scores.get(signal.label) ?? { score: 0, maxWeight: 0, reasons: [], sources: 0 }
    entry.maxWeight = Math.max(entry.maxWeight, signal.weight)
    // One entry per (label, source), so the corroboration count is a count of
    // independent observations rather than of pattern hits.
    entry.sources += 1
    for (const reason of signal.reasons) if (!entry.reasons.includes(reason)) entry.reasons.push(reason)
    scores.set(signal.label, entry)
  }
  for (const entry of scores.values()) {
    entry.score = Math.min(100, entry.maxWeight + Math.min(8, 4 * Math.max(0, entry.sources - 1)))
  }
  return [...scores.entries()]
    .map(([label, entry]) => ({ label, score: entry.score, maxWeight: entry.maxWeight, reasons: entry.reasons }))
    .sort((left, right) => right.score - left.score || right.maxWeight - left.maxWeight || left.label.localeCompare(right.label))
}

export function decideIntent(input: IntentInput): IntentDecision {
  const content = normalize(input.content)
  const fact = readFactSlot(input.content)
  const signals = collectSignals(content, input.hasPriorTurn, fact)
  const candidates = scoreIntentCandidates(input)
  const scores = new Map<IntentLabel, { score: number; maxWeight: number; reasons: string[]; sources: number }>(
    candidates.map((candidate) => [candidate.label, { score: candidate.score, maxWeight: candidate.maxWeight, reasons: candidate.reasons, sources: candidate.reasons.length }])
  )

  const ranked = [...scores.entries()].sort((left, right) =>
    right[1].score - left[1].score ||
    right[1].maxWeight - left[1].maxWeight ||
    left[0].localeCompare(right[0]))
  const label: IntentLabel = ranked[0]?.[0] ?? 'ambiguous'
  let confidence = ranked[0]?.[1].score ?? 30
  const reasons = [...(ranked[0]?.[1].reasons ?? [])]
  if (signals.length === 0) {
    reasons.push('no_rule_matched')
    confidence = 30
  }
  // One weak rule is not enough to be confident: the rule fires, the strength
  // is capped, and the reason list shows exactly why.
  const strong = signals.filter((signal) => signal.weight >= 80).length
  if (strong === 0 && reasons.length <= 1) {
    confidence = Math.min(confidence, 62)
    reasons.push('single_weak_signal')
  }
  // "I cannot tell" is never a high-confidence answer.
  if (label === 'ambiguous') confidence = Math.min(confidence, 74)

  const alternatives = ranked
    .slice(1)
    .filter(([, entry]) => (ranked[0]?.[1].score ?? 0) - entry.score <= 18)
    .slice(0, 2)
    .map(([candidate]) => candidate)

  // A reference the turn actually depends on is resolved against the previous
  // message even when another label (explanation, correction) wins the turn.
  const dependsOnPriorTurn = (signals.some((signal) => signal.reasons.includes('reference_to_prior_turn')) && input.hasPriorTurn) ||
    (label === 'ambiguous' && reasons.includes('reference_without_context'))
  // Emotion turns never trigger private-memory recall unless they explicitly
  // point back at the previous turn.
  // A general-knowledge question ("What is the capital of Portugal?") must not
  // be routed as a memory lookup: only a question *about the user* needs saved
  // evidence. Note that the route is a prompt hint — the assembler still runs,
  // and its relevance rules decide what is actually delivered.
  const personalReference = /(?:我的|我(?:住在|叫|今年|的)|我自己)|\b(?:my|mine|about me|do i|did i|have i|am i)\b/iu.test(content)
  const needsMemoryRetrieval = retrievalNeedOf(label, { content, fact, reasons, hasPriorTurn: input.hasPriorTurn })

  return {
    version: INTENT_DECISION_VERSION,
    intent: label,
    legacyIntent: LEGACY_MAP[label],
    confidence,
    confidenceLevel: levelOf(confidence),
    needsMemoryRetrieval,
    dependsOnPriorTurn,
    mayProduceMemoryCandidate: CANDIDATE[label],
    alternatives,
    reasons
  }
}

const labelSet = new Set<string>(INTENT_LABELS)

export function isIntentDecision(value: unknown): value is IntentDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.version !== INTENT_DECISION_VERSION) return false
  if (typeof record.intent !== 'string' || !labelSet.has(record.intent)) return false
  if (typeof record.legacyIntent !== 'string') return false
  if (!Number.isSafeInteger(record.confidence) || Number(record.confidence) < 0 || Number(record.confidence) > 100) return false
  if (!['low', 'medium', 'high'].includes(String(record.confidenceLevel))) return false
  if (typeof record.needsMemoryRetrieval !== 'boolean' || typeof record.dependsOnPriorTurn !== 'boolean' || typeof record.mayProduceMemoryCandidate !== 'boolean') return false
  if (!Array.isArray(record.alternatives) || record.alternatives.length > 2 || !record.alternatives.every((item) => typeof item === 'string' && labelSet.has(item))) return false
  if (!Array.isArray(record.reasons) || record.reasons.length === 0 || record.reasons.length > 8) return false
  if (!record.reasons.every((item) => typeof item === 'string' && /^[a-z_]{3,48}$/u.test(item))) return false
  return true
}
