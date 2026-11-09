/**
 * Expression policy (Stage 5, delivery B3; Issue #31 F3).
 *
 * The internal state is a bounded, rule-derived estimate — not a feeling and
 * not evidence about the user. What it may change is *how* Morrow answers:
 * whether to clarify before asserting, whether to offer advice or first
 * acknowledge what the user said, how many optional questions are allowed, and
 * whether the reply should be brief. It never changes facts, permissions,
 * memory truth, or the personality baseline.
 *
 * Distress evidence is scoped before it is scored:
 *   normalize → split clauses → attribute speaker (quote/report) →
 *   negation/conditional scope → explicit E → independent context C →
 *   bounded prior tension T → D → policy.
 */
import type { FeelingState } from './feeling'
import type { CognitiveTurnAnalysis } from '../cognition/cognition'

export type AdviceMode = 'none' | 'acknowledge_first' | 'answer_directly'
export type ClarifyMode = 'as_needed' | 'prefer'
export type AffectStrategy = 'repair' | 'clarify' | 'explore' | 'steady' | null

export interface ExpressionPolicy {
  /** Bounded strategy fields; every field has a closed set of values. */
  adviceMode: AdviceMode
  clarifyMode: ClarifyMode
  /** Optional follow-up questions allowed in this reply (0..2). */
  questionBudget: 0 | 1 | 2
  /** Prefer a shorter answer. */
  brevity: 'normal' | 'brief'
  /** Bounded multi-dimensional affect strategy, when one is relevant. */
  affectStrategy?: AffectStrategy
  /** Human-readable reason for the trace; never shown to the user. */
  rationale: string
}

export const EXPRESSION_POLICY_VERSION = 'expression-policy.v2'
/** Uncertainty above this prefers a clarifying question over a confident claim. */
export const CLARIFY_UNCERTAINTY_THRESHOLD = 0.55
/** D at or above this (with independent contextual evidence) is distress. */
export const DISTRESS_THRESHOLD = 0.65
/** Contextual corroboration below this cannot satisfy the combined rule. */
export const DISTRESS_CONTEXT_MIN = 0.40
/** E at or above this is an explicit, high-confidence emotion statement. */
export const DISTRESS_EXPLICIT_HIGH = 0.85

export type DistressContext = 'neutral' | 'negated' | 'quoted' | 'reported' | 'hypothetical'

export type DistressRationale =
  | 'explicit_emotion_statement'
  | 'contextual_corroboration'
  | 'mild_without_independent_context'
  | 'negated_emotion'
  | 'quoted_emotion'
  | 'reported_emotion'
  | 'hypothetical_emotion'
  | 'unresolved_tension_only'
  | 'no_distress_evidence'

/**
 * E/C/T/D is a fixed, explainable heuristic, not a probability:
 *
 *   E — explicit emotion stated by the current user in the current context
 *   C — *independent* corroboration (somatic/behavioural cue), never the same
 *       phrase, its intensity adverb or its punctuation counted twice
 *   T — unresolved interaction tension from the bounded prior state
 *   D = 0.55E + 0.25C + 0.20T
 *
 *   distress = E >= 0.85 OR (D >= 0.65 AND C >= 0.40)
 *
 * A quoted, reported, negated or hypothetical emotion is not E. If the scope
 * cannot be resolved, the conservative result is no distress.
 */
export interface DistressEvidence {
  explicit: number
  contextual: number
  tension: number
  score: number
  distress: boolean
  context: DistressContext
  rationale: DistressRationale
}

/** A first-person emotion frame; 烦 is excluded when it starts 麻烦/烦请/烦琐/烦杂. */
const STRONG_EXPLICIT_PATTERNS: readonly RegExp[] = [
  /我(?:现在|今天|最近|这两天)?(?:(?:真的|特别|实在|非常|很|太|好|快)){0,2}(?:累|烦(?!麻|请|琐|杂)|难受|难过|崩溃|焦虑|害怕|委屈|生气|愤怒|绝望|撑不住|受不了|不想活)/u,
  /(?:今天|现在|最近|这两天)(?:(?:真的|特别|实在|非常|太|很|好)){1,2}(?:累|难受|难过|烦(?!麻|请|琐|杂)|崩溃|焦虑|害怕|委屈)/u,
  /(?:这事|这件事|这|那|他|她|你|工作|项目)(?:真|可|让|把)我(?:(?:真的|特别|实在|非常|很|太)){0,2}(?:累|烦(?!麻|请|琐|杂)|难受|难过|崩溃|焦虑|害怕|委屈|生气)/u,
  /我(?:真的|实在|快)?(?:撑不住|受不了|不想活)了/u
]

/** A weaker explicit statement needs independent corroboration first. */
const MILD_EXPLICIT_PATTERN = /我(?:有点|有些|稍微)(?:累|烦(?!麻|请|琐|杂)|难受|难过|焦虑|害怕)/u

/** Loose emotion token used only to scope a boundary (negated/quoted/reported/hypothetical); it never raises E by itself. */
const BOUNDARY_EMOTION = /(?:累|烦(?!麻|请|琐|杂)|难受|难过|崩溃|焦虑|害怕|委屈|生气|愤怒|绝望|撑不住|受不了|不想活)/u

/** Independent contextual evidence: physical/behavioural, not the same phrase. */
const SOMATIC_CUE = /(?:睡不着|失眠|没力气|不想动|吃不下|没胃口|心慌|喘不过气|头疼)/gu

const CLAUSE_SPLIT = /[。！？!?；;，,\n]+/u
const QUOTE_MARK = /[“”"「」『』‘’]/u
const HYPOTHETICAL = /(?:如果|要是|假如|万一|倘若|若)/u
const REPORTED = /(?:你|他|她|他们|她们|朋友|同事|家人|别人|有人|听说|据说|医生说|咨询师|主管|老板|我(?:刚才|之前|上次)?).{0,12}(?:说|告诉|提到|表示|觉得|认为|问)/u
const NEGATION = /(?:不是|并不|没有|没|不|别|从不|才不)/u

interface ClauseReading {
  context: DistressContext
  explicit: number
}

function findExplicit(clause: string): { index: number; strength: number } | null {
  let best: { index: number; strength: number } | null = null
  for (const pattern of STRONG_EXPLICIT_PATTERNS) {
    const match = pattern.exec(clause)
    if (match && (!best || match.index < best.index)) best = { index: match.index, strength: 1 }
  }
  const mild = MILD_EXPLICIT_PATTERN.exec(clause)
  if (mild && (!best || mild.index < best.index)) best = { index: mild.index, strength: 0.6 }
  return best
}

function readClause(clause: string): ClauseReading {
  const emotion = findExplicit(clause)
  const token = emotion ?? (() => {
    const loose = BOUNDARY_EMOTION.exec(clause)
    return loose ? { index: loose.index, strength: 0 } : null
  })()
  if (!token) return { context: 'neutral', explicit: 0 }
  if (QUOTE_MARK.test(clause)) return { context: 'quoted', explicit: token.strength }
  const prefix = clause.slice(0, token.index)
  // Negation scope is limited to the same clause and the prefix before the
  // emotion, so a later clause ("…，但我很累") stays positive.
  if (NEGATION.test(prefix)) return { context: 'negated', explicit: token.strength }
  if (REPORTED.test(clause)) return { context: 'reported', explicit: token.strength }
  if (HYPOTHETICAL.test(clause)) return { context: 'hypothetical', explicit: token.strength }
  return { context: 'neutral', explicit: token.strength }
}

export function assessDistressEvidence(input: { text: string; tension: number }): DistressEvidence {
  const clauses = input.text.split(CLAUSE_SPLIT).map((clause) => clause.trim()).filter(Boolean)
  let explicit = 0
  let boundary: DistressContext | null = null
  let somatic = 0
  const somaticSeen = new Set<string>()
  for (const clause of clauses) {
    const reading = readClause(clause)
    if (reading.context === 'neutral') {
      // Contextual corroboration is counted only from physical/behavioural
      // cues, in neutral clauses, and never from the emotion phrase itself,
      // its intensity adverb or its punctuation. Those are part of E.
      for (const match of clause.matchAll(SOMATIC_CUE)) somaticSeen.add(match[0])
    }
    if (reading.context !== 'neutral' && !boundary) boundary = reading.context
    if (reading.explicit > 0 && reading.context === 'neutral') explicit = Math.max(explicit, reading.explicit)
  }
  somatic = somaticSeen.size
  const contextual = somatic >= 2 ? 0.8 : somatic === 1 ? 0.4 : 0
  const tension = Math.max(0, Math.min(1, input.tension))
  const score = 0.55 * explicit + 0.25 * contextual + 0.2 * tension
  const distress = explicit >= DISTRESS_EXPLICIT_HIGH || (score >= DISTRESS_THRESHOLD && contextual >= DISTRESS_CONTEXT_MIN)
  const rationale: DistressRationale = explicit >= DISTRESS_EXPLICIT_HIGH
    ? 'explicit_emotion_statement'
    : distress
      ? 'contextual_corroboration'
      : explicit > 0
        ? 'mild_without_independent_context'
        : boundary === 'negated'
          ? 'negated_emotion'
          : boundary === 'quoted'
            ? 'quoted_emotion'
            : boundary === 'reported'
              ? 'reported_emotion'
              : boundary === 'hypothetical'
                ? 'hypothetical_emotion'
                : tension > 0
                  ? 'unresolved_tension_only'
                  : 'no_distress_evidence'
  return {
    explicit,
    contextual,
    tension,
    score,
    distress,
    context: explicit > 0 ? 'neutral' : boundary ?? 'neutral',
    rationale
  }
}

export function deriveExpressionPolicy(input: {
  state: FeelingState | null
  analysis: CognitiveTurnAnalysis | null
  /** True when the user explicitly asked for a direct answer or a fix. */
  wantsDirectAnswer: boolean
  /** The user's own words, for explicit distress evidence only. */
  text?: string | undefined
  /** Query-relevant emotion families from the affect projection. */
  affectFamilies?: readonly string[] | undefined
  /** Continuous mood state, if the mood layer is available. */
  mood?: { valence: number; arousal: number; tension: number } | undefined
}): ExpressionPolicy {
  const state = input.state
  const analysis = input.analysis
  const tension = state?.values.tension ?? 0
  const uncertainty = analysis?.uncertainty === 'high' ? 0.8 : analysis?.uncertainty === 'medium' ? 0.55 : 0.25
  const evidence = assessDistressEvidence({ text: input.text ?? '', tension })
  const families = new Set(input.affectFamilies ?? [])
  const mood = input.mood
  const affectStrategy: AffectStrategy = families.has('frustration') || families.has('regret') || families.has('disappointment') || (mood && mood.valence < -0.2 && mood.arousal > 0.6)
    ? 'repair'
    : families.has('concern') || families.has('fear')
      ? 'clarify'
      : families.has('curiosity') || families.has('anticipation') || families.has('excitement')
        ? 'explore'
        : families.has('sadness') || families.has('loneliness') || (mood && mood.arousal < 0.2)
          ? 'steady'
          : null

  // A direct request wins over warmth: the user asked for the answer, not for
  // company. This ordering is the point of the policy.
  if (input.wantsDirectAnswer) {
    return {
      adviceMode: 'answer_directly',
      clarifyMode: 'as_needed',
      questionBudget: 1,
      brevity: 'brief',
      affectStrategy: null,
      rationale: 'explicit_direct_request'
    }
  }
  if (uncertainty >= CLARIFY_UNCERTAINTY_THRESHOLD) {
    return {
      adviceMode: evidence.distress ? 'acknowledge_first' : 'none',
      clarifyMode: 'prefer',
      questionBudget: 2,
      brevity: 'normal',
      affectStrategy,
      // Kept from the v1 trace vocabulary; the calibrated reason is on the
      // evidence object, not in the user-visible prompt.
      rationale: evidence.distress ? 'uncertain_and_user_tension' : 'uncertain_reading'
    }
  }
  if (evidence.distress) {
    return {
      adviceMode: 'acknowledge_first',
      clarifyMode: 'as_needed',
      questionBudget: 1,
      brevity: 'normal',
      affectStrategy,
      rationale: 'user_tension_unresolved'
    }
  }
  return {
    adviceMode: 'none',
    clarifyMode: 'as_needed',
    questionBudget: 2,
    brevity: 'normal',
    affectStrategy,
    rationale: evidence.rationale === 'unresolved_tension_only' ? 'unresolved_tension_only' : 'no_special_condition'
  }
}

/**
 * One compact block. It states the strategy, not the numbers, and repeats the
 * invariant that facts are untouched.
 */
export function describeExpressionPolicy(policy: ExpressionPolicy): string {
  const parts: string[] = ['Expression strategy for this reply (derived from the bounded interaction state; it changes how you answer, never what is true):']
  if (policy.adviceMode === 'answer_directly') parts.push('- The user asked for the answer: answer it directly and briefly; do not open with empathy or extra questions.')
  if (policy.adviceMode === 'acknowledge_first') parts.push('- Acknowledge what the user just said in one sentence before any advice; do not lead with a list.')
  if (policy.clarifyMode === 'prefer') parts.push('- Your reading of this turn is uncertain: prefer one clarifying question over a confident claim.')
  if (policy.affectStrategy === 'repair') parts.push('- A relevant Morrow frustration/regret is active: if a concrete error exists, name that point and repair it; do not generalize or blame the user.')
  if (policy.affectStrategy === 'clarify') parts.push('- A relevant concern is active: prefer one clarifying check before asserting; do not present the concern as a fact.')
  if (policy.affectStrategy === 'explore') parts.push('- Relevant curiosity is active: you may offer one closely related angle; stop if the user declines.')
  if (policy.affectStrategy === 'steady') parts.push('- A relevant heavier affect is active: keep the tone steady and do not ask the user to manage it.')
  parts.push(`- Optional follow-up questions allowed: ${policy.questionBudget}. Do not expose internal state, confidence numbers, revision ids or memory ids to the user.`)
  return parts.join('\n')
}
