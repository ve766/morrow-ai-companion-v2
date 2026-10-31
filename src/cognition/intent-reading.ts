/**
 * C1 — one versioned reading per turn.
 *
 * The problem this replaces: a turn had an `intent` label and a `confidenceScore`
 * and nothing else. That is not enough to decide anything, because the same
 * label can come from a request, a quotation or a hypothetical, and because a
 * number called "confidence" that was never calibrated invites being read as a
 * probability.
 *
 * This module produces the object the rest of the chain actually needs:
 *
 *   what kind of move this is (speech act, separately)   -> `speech-act.ts`
 *   what the user wants                                 -> candidates + status
 *   on what evidence, and what argues against it        -> support / contra
 *   what is still unknown                               -> uncertainties + slots
 *   what to do about it                                 -> responseMode
 *
 * Two rules are structural, not advisory:
 *
 *   1. `scoreKind` is always `heuristic_score`. No calibration set exists for
 *      these rules, so nothing here may be reported as a probability. The type
 *      has a `calibrated_probability` member for a future calibrated model and
 *      no code path in this repository produces it.
 *   2. Only a first-person request authorises execution. Quotation, hypothesis
 *      and joke readings carry `binds: false` from the speech-act layer, and the
 *      response mode cannot override that.
 */
import { analyzeSpeechAct, type SpeechActReading } from './speech-act'
import { readLocalContext, type LocalContext } from './context-window'
import {
  decideIntent,
  scoreIntentCandidates,
  INTENT_DECISION_VERSION,
  type IntentLabel
} from './intent-decision'
import { assessIntentConfidence, type IntentAssessment } from './intent-confidence'
import { stripQuotedAndReportedText, type CognitiveHistoryMessage } from './cognition'

export const INTENT_READING_VERSION = 'c1-reading-v1' as const
/**
 * Parameter set. Distinct from `INTENT_DECISION_VERSION` on purpose: the rule
 * weights and the reading assembly change for different reasons, and a result
 * file has to be able to say which of the two moved.
 */
export const INTENT_PARAMETER_VERSION = 'c1-params-v1' as const

export type ScoreKind = 'heuristic_score' | 'calibrated_probability' | 'unknown'

/** Whether the user's goal is stated, inferred, inherited, revised or unclear. */
export type IntentStatus = 'explicit' | 'inferred' | 'continuing' | 'changed' | 'unknown' | 'conflicting'

export type ResponseMode =
  | 'answer'
  | 'merge'
  | 'split'
  | 'clarify'
  | 'acknowledge'
  | 'stop_previous'
  | 'execute_pending'

export interface IntentSlot {
  name: 'target' | 'time_horizon' | 'quantity' | 'topic'
  value: string
  /** `stated` only when the user wrote it; `inferred` must cite where from. */
  status: 'stated' | 'inferred' | 'unknown'
  /** Message id the value came from, or null when nothing supports it. */
  evidenceMessageId: string | null
}

export interface IntentCandidateReading {
  label: IntentLabel
  /** 0-100 rule strength. Never a probability; see `scoreKind`. */
  score: number
  scoreKind: 'heuristic_score'
  /** Rule codes that argue for this reading. */
  support: string[]
  /** Rule codes that argue against it. */
  contra: string[]
}

export interface IntentReading {
  version: typeof INTENT_READING_VERSION
  algorithmVersion: typeof INTENT_DECISION_VERSION
  parameterVersion: typeof INTENT_PARAMETER_VERSION
  messageId: string
  primaryIntent: IntentLabel
  /** Rule codes of the winning reading, including the synthetic ones. */
  decisionReasons: string[]
  secondaryIntents: IntentLabel[]
  intentStatus: IntentStatus
  speechAct: SpeechActReading
  entitiesAndSlots: IntentSlot[]
  /** Message ids only; never text. */
  evidenceRefs: string[]
  supportingSignals: string[]
  contradictingSignals: string[]
  context: {
    used: boolean
    priorUser: boolean
    priorAssistant: boolean
    assistantOffer: LocalContext['assistantOffer']
    continuationTarget: LocalContext['continuationTarget']
    evidence: string[]
  }
  uncertainties: string[]
  scoreKind: 'heuristic_score'
  /** Rule strength 0-100, carried for continuity with stored observations. */
  confidence: number
  confidenceBand: IntentAssessment['band']
  clarificationRequired: boolean
  clarificationReason: string | null
  responseMode: ResponseMode
  /**
   * Whether this turn authorises the assistant to perform the named action.
   * False for quotations, hypotheses, jokes, retractions and preferences.
   */
  mayExecute: boolean
  /** True when the turn revises an earlier reading of this conversation. */
  supersedesMessageId: string | null
}

export interface BuildIntentReadingInput {
  content: string
  history: readonly CognitiveHistoryMessage[]
  messageId: string
}

/** Date-ish expressions, bounded to the forms a user actually types. */
const HORIZON = /(?:今天|明天|后天|这周|本周|下周|这个月|本月|下个月|\d{4}\s*年|\d{1,2}\s*月(\d{1,2}\s*[日号])?|\d+\s*(?:天|周|个月|年)(?:之后|以后|后|内)|月底|年底|今年|明年)|\b(?:today|tomorrow|this week|next week|this month|next month|by (?:the end of )?(?:next )?(?:week|month|year))\b/iu
const QUANTITY = /(\d+(?:\.\d+)?)\s*(?:个|次|条|份|页|行|字|元|块|小时|分钟|天|周|%)/u
/** Two requests in one turn, joined rather than nested. */
const COMPOUND_JOIN = /(?:然后|接着|顺便|同时|另外|并且|，然后|;\s*(?:and\s+)?)|\b(?:and then|also|plus|after that)\b/iu
/** The clause after a request verb: what the request is about. */
const REQUEST_TARGET = /(?:帮我|帮忙|请(?:你)?|麻烦(?:你)?|给我|替我)\s*(?:把|将)?\s*([^\s，。！？,!?]{1,24})/u
/** 把-construction: the object sits between 把 and the verb. */
const BA_TARGET = /把\s*([^\s，。！？,!?]{1,20}?)\s*(?:删|改|加|换|做|写|保存|执行|清空|移)/u
/** A leading verb is not the object of the request. */
const LEADING_VERB = /^(?:看看|看一下|看|改一下|改|检查一下|检查|审查|整理|分析|写|做|删掉|删|修一下|修|查一下|查|review|check|look at|fix|rewrite)\s*/u
const LEADING_FILLER = /^(?:一下|一张|张|个|下|这|那)\s*/u
/** A deictic determiner: it points, it does not name. */
const DEICTIC_PREFIX = /^[这那](?:个|张|段|份|篇|条|行|句|些|种|位|块|只)?/u

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim()
}

/**
 * Slots are extracted only from what the user wrote, plus one inference that is
 * explicitly marked as such (a continuation inherits the previous topic).
 *
 * A missing slot stays missing (`status: 'unknown'`, `evidenceMessageId: null`).
 * Filling it from context would be a guess wearing a slot's clothes.
 */
function extractSlots(input: {
  content: string
  messageId: string
  speechAct: SpeechActReading
  context: LocalContext
}): IntentSlot[] {
  const slots: IntentSlot[] = []
  const content = input.content

  // The action's object. Only requested when the act actually names an action.
  if (input.speechAct.action !== null) {
    const match = BA_TARGET.exec(content) ?? REQUEST_TARGET.exec(content)
    const captured = (match?.[1] ?? '').trim()
    const afterVerb = captured.replace(LEADING_VERB, '').trim()
    const stripped = afterVerb.replace(LEADING_FILLER, '').trim()
    // "这个函数" names nothing on its own. Without a prior turn there is nothing
    // in the window it can point at, so the slot stays unknown instead of
    // letting a deictic stand in for an object — otherwise "把这段代码删掉"
    // would execute against a guess.
    const deicticOnly = (DEICTIC_PREFIX.test(afterVerb) || /^(?:它|他们|她们)/u.test(afterVerb)) && input.context.priorUserBody === null
    const deicticTarget = DEICTIC_PREFIX.test(afterVerb) || /^(?:它|他们|她们)/u.test(afterVerb)
    if (stripped.length >= 2 && !deicticOnly) {
      slots.push({ name: 'target', value: stripped.slice(0, 40), status: 'stated', evidenceMessageId: input.messageId })
      // "这个函数" points at the previous turn. Recording it as an inferred topic
      // is what lets two conversations with the same sentence differ, without
      // pretending the user named the object in this turn.
      if (deicticTarget && input.context.priorUserBody) {
        slots.push({ name: 'topic', value: input.context.priorUserBody.slice(0, 40), status: 'inferred', evidenceMessageId: null })
      }
    } else {
      slots.push({ name: 'target', value: '', status: 'unknown', evidenceMessageId: null })
    }
  }

  const horizon = HORIZON.exec(content)
  if (horizon) {
    slots.push({ name: 'time_horizon', value: horizon[0].trim().slice(0, 24), status: 'stated', evidenceMessageId: input.messageId })
  }

  const quantity = QUANTITY.exec(content)
  if (quantity) {
    slots.push({ name: 'quantity', value: quantity[0].trim().slice(0, 24), status: 'stated', evidenceMessageId: input.messageId })
  }

  // A resolved reference inherits the previous topic — as `inferred`, citing the
  // message it came from, so nothing downstream has to guess whether the user
  // said it.
  const inheritedTopic = input.context.continuationTarget !== 'none'
    ? input.context.priorUserBody ?? input.context.priorAssistantBody
    : null
  if (inheritedTopic) {
    // `inferred`, with no message id: the topic came from the previous turn, and
    // nothing here may present it as something the user just said.
    slots.push({
      name: 'topic',
      value: inheritedTopic.slice(0, 40),
      status: 'inferred',
      evidenceMessageId: null
    })
  }

  return slots
}

/** The one slot worth asking about, most critical first. */
function criticalMissingSlot(slots: readonly IntentSlot[]): IntentSlot | null {
  return slots.find((slot) => slot.name === 'target' && slot.status === 'unknown') ?? null
}

/** Reasons that argue *against* the winning reading. */
function contraSignalsOf(input: {
  speechAct: SpeechActReading
  assessment: IntentAssessment
  context: LocalContext
  ambiguous: boolean
}): string[] {
  const contra: string[] = []
  if (input.speechAct.act === 'quotation') contra.push('quoted_act_not_user_request')
  if (input.speechAct.act === 'hypothesis') contra.push('conditional_not_authorisation')
  if (input.speechAct.act === 'joke') contra.push('ironic_surface_form')
  if (input.speechAct.negation.scope === 'verb_phrase') contra.push('negated_action')
  if (input.ambiguous) contra.push('no_matching_evidence')
  if (input.assessment.reasons.includes('competing_readings')) contra.push('competing_reading')
  if (input.assessment.reasons.includes('margin_below_floor')) contra.push('margin_below_floor')
  if (input.assessment.reasons.includes('unresolved_reference')) contra.push('unresolved_reference')
  return [...new Set(contra)]
}

/**
 * Status of the user's goal.
 *
 * `changed` is reserved for a turn that revises something — a correction or a
 * changed-mind marker — because that is the state that has to invalidate an
 * earlier reading. A mere topic switch is not a change of intent.
 */
/**
 * Whether two readings ask for the same thing.
 *
 * A request to explain and an explanation are one act seen twice: the user asks
 * for something and names what they want. Treating every close pair as a
 * conflict made "帮我制定下周的学习计划" trigger a clarifying question about a
 * turn that could simply be answered.
 */
function compatibleWithRequest(a: IntentLabel, b: IntentLabel): boolean {
  if (a === 'request' || b === 'request') return true
  if (a === 'continuation' || b === 'continuation') return true
  const pair = new Set([a, b])
  if (pair.has('information_query') && pair.has('explanation')) return true
  if (pair.has('preference_expression') && pair.has('self_fact')) return true
  return false
}

function statusOf(input: {
  speechAct: SpeechActReading
  context: LocalContext
  ambiguous: boolean
  assessment: IntentAssessment
  decisionReasons: readonly string[]
  secondary: readonly IntentLabel[]
  primary: IntentLabel
}): IntentStatus {
  if (input.speechAct.act === 'retraction') return 'changed'
  if (input.speechAct.act === 'correction') return 'changed'
  if (input.context.continuationTarget !== 'none') return 'continuing'
  if (input.context.sequencing) return 'continuing'
  if (input.ambiguous) return 'unknown'
  // A quoted turn with no question of its own carries no user goal at all.
  if (input.speechAct.act === 'quotation') return 'unknown'
  const explicit = input.decisionReasons.some((reason) => [
    'explicit_correction_marker',
    'changed_mind_marker',
    'explicit_recall_request',
    'save_request_with_self_fact',
    'explicit_goal_statement',
    'goal_or_plan_marker',
    'self_reported_ambiguity'
  ].includes(reason))
  if (explicit && !input.assessment.directionChanging) return 'explicit'
  if (
    input.assessment.directionChanging &&
    input.assessment.margin < 0.08 &&
    !(input.secondary.length > 0 && compatibleWithRequest(input.primary, input.secondary[0]!))
  ) return 'conflicting'
  if (input.secondary.length > 0) return 'inferred'
  return 'inferred'
}

/**
 * What to do with the reading.
 *
 * The table is the policy from the task, in the order the cases must be checked:
 * a retraction stops work even if the words also look like a request; a
 * correction is adopted even when it is low-confidence; asking is reserved for
 * turns where a wrong reading changes what would be done.
 */
function responseModeOf(input: {
  speechAct: SpeechActReading
  context: LocalContext
  intentStatus: IntentStatus
  assessment: IntentAssessment
  clarificationRequired: boolean
  compound: boolean
  primary: IntentLabel
}): ResponseMode {
  if (input.speechAct.act === 'retraction') return 'stop_previous'
  if (input.speechAct.act === 'refusal') return 'stop_previous'
  if (input.speechAct.act === 'correction') return 'answer'
  if (input.speechAct.act === 'quotation') return 'acknowledge'
  if (input.context.continuationTarget === 'execution') return 'execute_pending'
  // The assistant asked something and the user handed it back: that is an answer
  // to give, not an occasion to interrogate them.
  if (input.context.continuationTarget === 'discussion') return 'answer'
  if (input.clarificationRequired) return 'clarify'
  if (input.compound) return 'split'
  if (input.intentStatus === 'conflicting') return 'clarify'
  // Pure sharing, emotion and companionship are answered, never converted into
  // a task list.
  if (input.primary === 'emotion_expression' || input.primary === 'feedback') return 'answer'
  // Ambiguity alone is not a reason to ask. It is a reason to ask only when the
  // turn asks Morrow to *do* something and a wrong reading would do the wrong
  // thing — see the task policy: "低置信但低风险的闲聊/分享：可以自然回应".
  // An unresolved reference cannot be answered however confidently it scores:
  // the object is unknown, so any answer would be a guess. A request with its
  // object present is answered even when two readings compete — asking "which
  // function?" when the user already named it is the mechanical interrogation
  // the policy forbids.
  const unresolved = input.assessment.reasons.includes('unresolved_reference')
  if (unresolved) return 'clarify'
  return 'answer'
}

/**
 * Builds the reading for one turn.
 *
 * This is the single place where speech act, rule candidates, the confidence
 * model and the local context are combined. Every caller — the analyzer, the
 * eval harness, a test — goes through here, so none of them can see a reading
 * the product would not produce.
 */
/**
 * Everything one turn produced, computed once.
 *
 * `buildIntentReading` returns only the persisted reading; the analyzer needs
 * the rule decision and the assessment alongside it, and recomputing them would
 * be a second scoring path waiting to drift.
 */
export interface TurnReading {
  reading: IntentReading
  decision: ReturnType<typeof decideIntent>
  assessment: IntentAssessment
  candidates: ReturnType<typeof scoreIntentCandidates>
}

export function readTurn(input: BuildIntentReadingInput): TurnReading {
  if (typeof input.content !== 'string' || input.content.trim().length === 0) {
    throw new TypeError('Intent reading requires text.')
  }
  if (typeof input.messageId !== 'string' || input.messageId.length === 0) {
    throw new TypeError('Intent reading requires a source message id.')
  }
  const history = Array.isArray(input.history) ? input.history : []
  const context = readLocalContext({ content: input.content, history })
  const speechAct = analyzeSpeechAct({
    content: input.content,
    priorUserBody: context.priorUserBody,
    priorAssistantBody: context.priorAssistantBody
  })

  // Rules run on the text with quotations removed, so a quoted command cannot
  // contribute its own request markers to the user's reading.
  // If stripping removes everything, the turn *was* the quotation. Falling back
  // to the raw text would put the quoted words back into the rule layer, which
  // is how "朋友说我很难过" was read as the user's own distress.
  const content = normalize(stripQuotedAndReportedText(input.content))
  const decision = decideIntent({
    content,
    hasPriorTurn: context.hasPriorTurn,
    priorUserBody: context.priorUserBody
  })
  const candidates = scoreIntentCandidates({
    content,
    hasPriorTurn: context.hasPriorTurn,
    priorUserBody: context.priorUserBody
  })
  const assessment = assessIntentConfidence({
    content,
    priorUserBody: context.priorUserBody,
    candidates
  })

  // A quoted turn has no first-person reading: keep the rule candidates as
  // context but do not let one of them win.
  //
  // A continuation is labelled by what it continues. "可以，继续。" carries no
  // words of its own; the rule layer sees a two-word affirmation and returns
  // `ambiguous`, which is exactly wrong — the turn's meaning is entirely in the
  // assistant's offer, and that offer was read by the context layer.
  // Two requests in one turn ("先看代码，然后解释报错"): the first is the primary
  // goal and the second is kept as a secondary intent, so the split below has
  // something to preserve. Without this the longer clause won on rule strength
  // and the actual first request disappeared.
  const compoundEarly = COMPOUND_JOIN.test(content) && speechAct.binds && speechAct.action !== null
  // Any quotation-dominated turn is `ambiguous`: what the user wants *about* the
  // quoted text is not recoverable from the quoted text, and letting a rule
  // inside the quote win is how a quoted command became a user request.
  const primary: IntentLabel = speechAct.act === 'quotation'
    ? 'ambiguous'
    : context.continuationTarget !== 'none'
      ? 'continuation'
      : compoundEarly && candidates.some((candidate) => candidate.label === 'request')
        ? 'request'
        : decision.intent
  const ambiguous = primary === 'ambiguous' || (candidates.length === 0 && context.continuationTarget === 'none')

  const secondary = decision.alternatives.filter((label) => label !== primary).slice(0, 2)
  const slots = extractSlots({ content: input.content, messageId: input.messageId, speechAct, context })
  const missing = criticalMissingSlot(slots)

  // Only a *request that would be carried out* needs its object before acting.
  // Asking "which file?" when the user merely mused about editing something is
  // the mechanical interrogation this policy exists to avoid.
  const needsTargetBeforeActing =
    speechAct.binds && speechAct.action !== null &&
    ['delete', 'modify', 'execute', 'look', 'continue'].includes(speechAct.action)
  // A continuation inherits its object from the assistant's offer, so a missing
  // target is not missing at all: "继续" after "要我继续写完这个模块吗" has one.
  const targetMissing = needsTargetBeforeActing && missing !== null && context.continuationTarget === 'none'
  const clarificationRequired = targetMissing
  const clarificationReason = clarificationRequired ? `missing_${missing?.name ?? 'target'}` : null

  const intentStatus = statusOf({
    speechAct,
    context,
    ambiguous,
    assessment,
    decisionReasons: decision.reasons,
    secondary,
    primary
  })

  const compound = compoundEarly
  const responseMode = responseModeOf({
    speechAct,
    context,
    intentStatus,
    assessment,
    clarificationRequired,
    compound,
    primary
  })

  // Dedupe again at the reading level: two labels can be supported by the same
  // rule code, and a duplicated code in the audit trail looks like independent
  // corroboration when it is one observation.
  const supportingSignals = [...new Set(candidates.flatMap((candidate) => candidate.reasons))].slice(0, 12)
  const contradictingSignals = contraSignalsOf({ speechAct, assessment, context, ambiguous })

  const uncertainties: string[] = []
  if (ambiguous) uncertainties.push('no_matching_rule')
  if (speechAct.act === 'quotation') uncertainties.push('quoted_act_attribution')
  if (speechAct.act === 'hypothesis') uncertainties.push('hypothetical_not_instruction')
  if (speechAct.negation.scope !== 'none') uncertainties.push('negation_scope')
  if (assessment.reasons.includes('competing_readings')) uncertainties.push('competing_readings')
  if (assessment.reasons.includes('unresolved_reference')) uncertainties.push('unresolved_reference')
  if (context.continuationTarget === 'none' && /(?:继续|接着|往下|go on|continue)/iu.test(content)) {
    uncertainties.push('continuation_without_offer')
  }
  if (missing !== null) uncertainties.push(`missing_${missing.name}`)
  // "你能不能写诗" without a preceding offer asks about capability; the answer is
  // "yes" *and* the poem, so the doubt is recorded rather than resolved.
  if (speechAct.evidence.includes('capability_without_offer')) uncertainties.push('capability_vs_request')

  // A revising turn supersedes the *previous* user message's reading, not
  // itself: the whole point of the link is that the earlier reading stops
  // driving later turns.
  const priorUserMessageId = context.priorUserBody === null
    ? null
    : [...history].reverse().find((message) => message.role === 'user')?.id ?? null
  const supersedes = (
    speechAct.act === 'correction' ||
    intentStatus === 'changed' ||
    decision.reasons.includes('changed_mind_marker')
  ) ? priorUserMessageId : null

  const reading: IntentReading = {
    version: INTENT_READING_VERSION,
    algorithmVersion: INTENT_DECISION_VERSION,
    parameterVersion: INTENT_PARAMETER_VERSION,
    messageId: input.messageId,
    primaryIntent: primary,
    decisionReasons: [...decision.reasons].slice(0, 8),
    secondaryIntents: secondary,
    intentStatus,
    speechAct,
    entitiesAndSlots: slots,
    evidenceRefs: [
      input.messageId,
      ...(context.priorUserBody && context.continuationTarget !== 'none' ? [history.filter((m) => m.role === 'user').at(-1)!.id] : []),
      ...(context.priorAssistantBody && context.assistantOffer !== 'none' ? [history.filter((m) => m.role === 'assistant').at(-1)!.id] : [])
    ].filter((id, index, all) => all.indexOf(id) === index),
    supportingSignals,
    contradictingSignals,
    context: {
      used: context.hasPriorTurn,
      priorUser: context.priorUserBody !== null,
      priorAssistant: context.priorAssistantBody !== null,
      assistantOffer: context.assistantOffer,
      continuationTarget: context.continuationTarget,
      evidence: context.evidence
    },
    uncertainties,
    scoreKind: 'heuristic_score',
    confidence: decision.confidence,
    confidenceBand: assessment.band,
    clarificationRequired,
    clarificationReason,
    responseMode,
    mayExecute: speechAct.binds && responseMode !== 'stop_previous' && responseMode !== 'clarify',
    supersedesMessageId: supersedes
  }

  return { reading, decision, assessment, candidates }
}

/** The persisted reading only. Same computation as `readTurn`. */
export function buildIntentReading(input: BuildIntentReadingInput): IntentReading {
  return readTurn(input).reading
}

const LABELS = new Set<string>([
  'information_query', 'continuation', 'correction', 'preference_expression',
  'emotion_expression', 'goal_or_plan', 'new_topic', 'ambiguous', 'self_fact',
  'request', 'explanation', 'exploration', 'feedback'
])

/** Structural check used on the read path. */
export function isIntentReading(value: unknown): value is IntentReading {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.version !== INTENT_READING_VERSION) return false
  if (typeof record.algorithmVersion !== 'string' || typeof record.parameterVersion !== 'string') return false
  if (typeof record.messageId !== 'string' || record.messageId.length === 0) return false
  if (typeof record.primaryIntent !== 'string' || !LABELS.has(record.primaryIntent)) return false
  if (!Array.isArray(record.secondaryIntents) || record.secondaryIntents.length > 2) return false
  if (!record.secondaryIntents.every((item) => typeof item === 'string' && LABELS.has(item))) return false
  if (!['explicit', 'inferred', 'continuing', 'changed', 'unknown', 'conflicting'].includes(String(record.intentStatus))) return false
  if (!['answer', 'merge', 'split', 'clarify', 'acknowledge', 'stop_previous', 'execute_pending'].includes(String(record.responseMode))) return false
  if (record.scoreKind !== 'heuristic_score') return false
  if (!Number.isSafeInteger(record.confidence) || Number(record.confidence) < 0 || Number(record.confidence) > 100) return false
  if (typeof record.clarificationRequired !== 'boolean') return false
  if (record.clarificationRequired && typeof record.clarificationReason !== 'string') return false
  if (typeof record.mayExecute !== 'boolean') return false
  // The invariant that matters most: nothing but a first-person, non-retracted
  // request may authorise execution.
  if (record.mayExecute === true) {
    const act = record.speechAct as Record<string, unknown> | undefined
    if (!act || act.binds !== true || act.attributedTo !== 'user') return false
    if (record.responseMode === 'stop_previous' || record.responseMode === 'clarify') return false
  }
  if (!Array.isArray(record.entitiesAndSlots)) return false
  if (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.some((item) => typeof item !== 'string')) return false
  if (!Array.isArray(record.uncertainties)) return false
  return true
}
