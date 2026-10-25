import {
  COGNITIVE_ANALYZER_VERSION,
  COGNITIVE_SCHEMA_VERSION,
  createIntentEvidence,
  isCognitiveUuid,
  stripQuotedAndReportedText,
  type CognitiveHistoryMessage,
  type CognitiveIntent,
  type CognitiveTurnAnalysis,
  type CognitiveUncertainty
} from './cognition'

export const COGNITIVE_HISTORY_LIMIT_MESSAGES = 12
export const COGNITIVE_HISTORY_LIMIT_CHARACTERS = 6000

const stopWords = new Set(['a', 'an', 'and', 'for', 'from', 'have', 'how', 'is', 'it', 'me', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your', '我', '你', '他', '她', '它', '的', '了', '是', '在', '和', '有', '就', '都', '而', '及', '与', '着', '或', '一个'])

const patterns = {
  correction: /(?:更正|纠正|我(?:刚才)?(?:说错了?|讲错了?)|你理解错了|我的意思是|其实(?:我|是)|不对|不是我说的|记错了|改正|不应该是)|\b(?:correction|i meant|i mean|i was wrong|that's not right|that is not right|not what i meant|not what i asked|you misunderstood|your answer(?: is| was)? (?:wrong|incorrect)|(?:this|that|the) answer (?:is|was) (?:wrong|incorrect)|you(?:'re| are) wrong|you got (?:it|that) wrong|your answer(?: is| was)? not (?:correct|right)|you said .{0,60}(?:wrong|incorrect)|you missed the point|i gave you the wrong|actually i (?:meant|said))\b/iu,
  changedMind: /(?:我改主意|改变主意|改了主意|不再(?:喜欢|想要|想)|我不喜欢了|换一个|改成|不想要了|还是.{0,12}(?:吧|好了)|\b(?:let's do.{0,40}instead|i changed my mind|i changed it|i'd rather|i would rather|instead of|i no longer (?:like|prefer)|i (?:don't|do not) like.{0,40}anymore)\b)/iu,
  feedback: /(?:谢谢|感谢|很好用|有帮助|没帮助|很差|不满意|做得好|回答不错|反馈|你回答得)|\b(?:thank you|thanks|not useful|helpful|not helpful|great answer|poor answer|missed the point|i appreciate|feedback)\b/iu,
  venting: /(?:想倾诉|想吐槽|只是想说|心情(?:很|有点)?(?:差|糟|不好)|(?:很|有点|非常|特别)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受)|压力很大|受不了了|感觉(?:很|有点)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受)|\b(?:i need to vent|i (?:feel|am feeling) (?:really )?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down)|i['’]m (?:feeling (?:really )?)?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down)|i am (?:feeling (?:really )?)?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down))\b)/iu,
  planning: /(?:计划|规划|安排|下一步|帮我制定|帮我计划|我打算|我的目标|目标是|我想(?:先|要|在|于|把|完成|实现|开始)|怎么开始|如何开始|\b(?:plan|planning|schedule|roadmap|next steps|help me plan|i want to achieve|my goal is|i intend to|how should i start)\b)/iu,
  explanation: /(?:解释(?:一下)?|说明一下|为什么会|为什么(?:是|要|会|不|.{1,12})|原理|原因是什么|是什么意思|怎么回事|\b(?:explain|why does|why is|how does|what causes|what does .* mean|explain why)\b)/iu,
  exploration: /(?:聊聊|讨论一下|探讨|探索|头脑风暴|一起想想|有什么想法|可以聊|\b(?:brainstorm|explore|let's discuss|let us discuss|talk through|what are some ideas)\b)/iu,
  informationQuery: /(?:什么|怎么|如何|为什么|哪一个|哪种|哪儿|哪里|什么时候|多少|谁|是否|吗[？?。!！]?$|怎么样|\b(?:what|who|where|when|which|why|how|can you tell me|could you tell me|do you know|is there|are there)\b)/iu,
  sharing: /(?:我觉得|我认为|我想说|我喜欢|我不喜欢|我偏好|我住在|我工作在|我从事|我通常|我最近|我正在|我的目标是|\b(?:i think|i believe|i like|i prefer|i dislike|i live in|i work at|i usually|i tend to|i use|i avoid|i want)\b)/iu,
  explicitMemoryRequest: /(?:你还记得|你记得我.{0,24}(?:吗|么)|我(?:之前|上次)告诉过你|我之前说过|我上次提到过|我们之前聊过|能回忆起|我的(?:偏好|目标|习惯)(?:是什么|是什么来着|吗|呢)|\b(?:do you remember|can you recall|what do i|what did i tell you|what have i told you|recall my|what is my|what's my)\b)/iu,
  explicitMemorySaveRequest: /(?:请(?:你)?记住|记住(?:我|这个|这件事|一下)|以后(?:都)?记得|把这(?:条|件事|个)记下来|保存为记忆|\b(?:please remember|remember that|remember this|save this as a memory|save that as a memory)\b)/iu,
  explicitSelfFact: /(?:我(?:不喜欢|喜欢|偏好|住在|工作在|从事|通常|习惯|的目标|的生日|会)|\bi (?:(?:do not|don't) )?(?:like|prefer|dislike|live|work|usually|tend to|use|avoid)\b)/iu,
  explicitGoal: /(?:我想(?:先|要|在|于|把|完成|实现|开始)|我打算|我的目标(?:是|为)|目标是|计划(?:在|于)?|\b(?:i want to|my goal (?:is|to)|i plan to|i intend to|i am trying to)\b)/iu,
  explicitConstraint: /(?:必须|一定要|不要|不能|仅限|只要|只在|不超过|预算|截止时间|时间限制|避免|\b(?:must|only|don't|do not|cannot|can't|no more than|budget|deadline|avoid|constraint)\b)/iu,
  unresolvedReference: /(?:这个|那个|它|他们|她们|这件事|那件事|上面(?:说的)?|刚才(?:说的)?|之前(?:说的)?|那么|那(?:怎么办|如何|怎么|为什么|么|个|件|次)(?:呢|怎么办|如何|怎么|为什么)?|那里|这点|\b(?:it|that|this|those|these|then|there|the above|what about that)\b)/iu,
  topicSwitch: /(?:换个话题|换个问题|另一个问题|另外(?:问)?|先不说|说点别的|顺便问|\b(?:new topic|different question|by the way|separate question|unrelated question|switch topics|never mind|ignore that|forget that|drop that)\b)/iu,
  ambiguousReference: /(?:你指的是什么|不确定你指|不太明白你的意思|我不懂你说的|\b(?:i'm not sure what you mean|i am not sure what you mean|unclear what you mean|ambiguous)\b)/iu,
  followUp: /^(?:那.{0,24}(?:呢|怎么办|如何|怎么|为什么|可以吗|行吗)|然后|所以|那么|(?:这个|那个|它|这件事|那件事)(?:呢|怎么办|如何|怎么|为什么|怎么样)|上面|刚才|之前|\b(?:and then|then what|what about|how so|why so|what next|about that|and it|and this)\b)/iu
} as const

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim()
}

function wordCount(value: string): number {
  const normalized = normalize(value)
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const nonHanWords = words.filter((item) => !/\p{Script=Han}/u.test(item) && !stopWords.has(item)).length
  const hanCharacters = (normalized.match(/\p{Script=Han}/gu) ?? []).length
  return nonHanWords + Math.ceil(hanCharacters / 2)
}

function hasUnresolvedShortReference(value: string): boolean {
  const normalized = normalize(value).replace(/[\p{P}\p{S}\s]/gu, '')
  const hanCount = (normalized.match(/\p{Script=Han}/gu) ?? []).length
  const latinWordCount = (normalized.match(/[a-z0-9]+/gu) ?? []).length
  return hanCount > 0 ? hanCount <= 5 && latinWordCount <= 2 : latinWordCount <= 4
}

export function boundCognitiveHistory(history: readonly CognitiveHistoryMessage[]): CognitiveHistoryMessage[] {
  if (!Array.isArray(history)) throw new TypeError('Invalid cognitive history.')
  const selected: CognitiveHistoryMessage[] = []
  const seen = new Set<string>()
  let budget = COGNITIVE_HISTORY_LIMIT_CHARACTERS
  const recent = history.slice(-COGNITIVE_HISTORY_LIMIT_MESSAGES)
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index]
    if (!message || !isCognitiveUuid(message.id) || typeof message.body !== 'string' || message.body.length > 20_000 || (message.role !== 'user' && message.role !== 'assistant')) {
      throw new TypeError('Invalid cognitive history.')
    }
    if (seen.has(message.id) || message.body.length > budget) break
    seen.add(message.id)
    selected.push({ id: message.id, role: message.role, body: message.body })
    budget -= message.body.length
  }
  return selected.reverse()
}

function uncertaintyFor(intent: CognitiveIntent, confidence: number, alternatives: CognitiveIntent[], content: string): Exclude<CognitiveUncertainty, 'not_scored'> {
  if (intent === 'uncertain' || confidence < 50 || /(?:\b(?:said no one ever|said nobody ever|yeah right|as if)\b|🙃|😏|🙄)/iu.test(content)) return 'high'
  if (confidence < 72 || alternatives.length > 0) return 'medium'
  return 'low'
}

export function analyzeCognitiveTurn(
  content: string,
  history: readonly CognitiveHistoryMessage[],
  sourceMessageId: string
): CognitiveTurnAnalysis {
  if (typeof content !== 'string' || content.trim().length === 0 || content.length > 8000 || !isCognitiveUuid(sourceMessageId)) {
    throw new TypeError('Invalid cognitive turn input.')
  }
  const current = normalize(stripQuotedAndReportedText(content))
  const boundedHistory = boundCognitiveHistory(history)
  const priorUser = [...boundedHistory].reverse().find((message) => message.role === 'user')
  const signals = {
    correction: patterns.correction.test(current),
    negation: /(?:不是|并非|没有|不再|不要|不能|没|不|\b(?:no|not|never|don't|do not|doesn't|didn't|won't|can't|cannot|wouldn't)\b)/iu.test(current),
    changedMind: patterns.changedMind.test(current),
    explicitGoal: patterns.explicitGoal.test(current),
    explicitConstraint: patterns.explicitConstraint.test(current),
    explicitMemoryRequest: patterns.explicitMemoryRequest.test(current),
    explicitMemorySaveRequest: patterns.explicitMemorySaveRequest.test(current),
    explicitSelfFact: patterns.explicitSelfFact.test(current),
    topicSwitch: patterns.topicSwitch.test(current)
  }
  const scores = new Map<CognitiveIntent, number>()
  const add = (intent: CognitiveIntent, score: number): void => {
    scores.set(intent, Math.min(100, Math.max(scores.get(intent) ?? 0, score)))
  }
  if (signals.correction) add('correction', 94)
  if (signals.changedMind) add('correction', 88)
  if (patterns.feedback.test(current)) add('feedback', 88)
  if (patterns.venting.test(current)) add('venting', 86)
  if (patterns.planning.test(current)) add('planning', 88)
  if (signals.explicitGoal) add('planning', 88)
  if (patterns.explanation.test(current)) add('explanation', 88)
  if (patterns.exploration.test(current)) add('exploration', 84)
  if (patterns.informationQuery.test(current)) add('information_query', 80)
  if (patterns.sharing.test(current)) add('sharing', 80)
  if (/[?？]/u.test(current)) add('information_query', 64)
  if (patterns.ambiguousReference.test(current)) add('uncertain', 86)
  if (scores.size === 0) add('uncertain', 28)

  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  const intent = ranked[0]![0]
  const confidenceScore = ranked[0]![1]
  const alternatives = ranked.slice(1)
    .filter(([, score]) => confidenceScore - score <= 18)
    .slice(0, 2)
    .map(([candidate]) => candidate)
  const uncertainty = uncertaintyFor(intent, confidenceScore, alternatives, current)
  const currentHasReference = patterns.unresolvedReference.test(current)
  const likelyFollowUp = Boolean(priorUser && !signals.topicSwitch && intent !== 'feedback' && currentHasReference && (
    wordCount(current) <= 4 || (patterns.followUp.test(current) && signals.explicitMemoryRequest)
  ))
  const topicSource = likelyFollowUp
    ? 'previous_user_message' as const
    : currentHasReference && !signals.topicSwitch
      ? 'none' as const
      : 'current' as const
  const topicReferenceMessageId = likelyFollowUp ? priorUser!.id : null
  const previousUserHasMemoryCue = Boolean(priorUser && (
    patterns.explicitMemoryRequest.test(normalize(stripQuotedAndReportedText(priorUser.body))) ||
    patterns.explicitSelfFact.test(normalize(stripQuotedAndReportedText(priorUser.body)))
  ))
  const shouldRetrieveMemory = signals.explicitMemoryRequest ||
    ((signals.correction || signals.changedMind) && signals.explicitSelfFact) ||
    (likelyFollowUp && previousUserHasMemoryCue)
  const correctionNeedsDetail = signals.correction && !signals.explicitSelfFact && !signals.changedMind && wordCount(current) <= 4
  const unresolved = correctionNeedsDetail || (currentHasReference && !likelyFollowUp && !signals.topicSwitch && (
    patterns.ambiguousReference.test(current) ||
    (hasUnresolvedShortReference(current) && ['information_query', 'correction', 'uncertain'].includes(intent))
  ))
  const strategy = shouldRetrieveMemory
    ? 'retrieve_memory' as const
    : unresolved
      ? 'clarify' as const
      : 'answer' as const
  const evidence = createIntentEvidence(sourceMessageId, topicReferenceMessageId, confidenceScore, uncertainty)

  return {
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    analyzerVersion: COGNITIVE_ANALYZER_VERSION,
    intent,
    alternatives,
    confidenceScore,
    confidenceBasis: 'unvalidated_rule_strength',
    uncertainty,
    strategy,
    topicSource,
    topicReferenceMessageId,
    signals,
    evidence
  }
}
