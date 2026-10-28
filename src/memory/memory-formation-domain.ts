import type { Sensitivity } from '../shared/companion'
import { classifyInterestIntent, isQuestionSentence } from '../self-model/interest-intent'
import {
  classifyFactAttribute,
  classifyTemporalReference,
  isSingleValuedAttribute,
  normalizedMemoryKey,
  type FactAttribute
} from './memory-domain'

/**
 * Deterministic candidate formation, not semantic extraction.
 *
 * This layer runs locally after a completed turn. It never calls a model and
 * never writes a memory: it proposes at most one reviewable candidate whose
 * source message remains the evidence. A separate user decision is still the
 * only path into durable memory.
 */

export type FormationKind = 'fact' | 'preference' | 'goal' | 'project' | 'correction'
export type FormationEvidenceType = 'user_explicit_statement' | 'user_explicit_correction'

export interface FormationCandidate {
  claim: string
  kind: FormationKind
  evidenceType: FormationEvidenceType
  confidence: number
  sensitivity: Sensitivity
  claimKey: string
  /** Text the user explicitly said they no longer hold, if present. */
  supersededHint: string | null
  /** A statement that signals a possible correction rather than a first fact. */
  correctionHint: boolean
}

const GREETING = /^(?:你好|您好|嗨|hi|hello|早上好|晚上好|晚安|谢谢|多谢|好的|好吧|嗯|知道了|明白了|收到)[。！!…\s]*$/iu
const TEMPORARY = /(?:我今天|我今晚|我明天|我待会|我待会儿|我刚才|我现在很|我最近有点|我最近很|这周末我|下周我)/u
const THIRD_PARTY_OR_ADDRESSING = /^(?:你|您|Morrow|莫罗)|(?:我(?:的)?(?:朋友|同事|家人|妈妈|爸爸|父母|孩子|室友|同学|老板|老师))/u

/**
 * Explicit correction intent. Every pattern names a denial, a move, an
 * acknowledged mistake, or a past/present contrast.
 *
 * Broad markers such as "现在在" or "现在是" are deliberately absent: "我现在在
 * 学习 Blender" and "我现在在大阪工作" are new facts. Treating them as
 * corrections rewrote an unrelated memory, which is the P1-B defect.
 */
const CORRECTION_PATTERNS: readonly RegExp[] = [
  // 我不再住杭州 / 我不住大阪了 / 我不用那个邮箱了
  /(?:不再)(?:住|在|用|做|叫|从事|干|对|喜欢|需要|使用)/u,
  /(?:不)(?:住|在|用|做|叫|从事|干)[^，。；\n]{0,24}了/u,
  // 我搬到京都了 / 换到新公司
  /(?:搬家|搬到|搬离|迁居|换到|调到)/u,
  // 改成 / 改为 / 更正
  /(?:改成|改为|更正|纠正|订正)/u,
  // 刚才说错了
  /(?:说错|记错|搞错|写错|弄错)/u,
  // 不是大阪，是京都
  /(?:不是|并非)[^，。；\n]{1,24}(?:是|而是)/u,
  // 我以前喜欢摄影，现在更喜欢绘画
  /(?:以前|之前|过去)[^，。；\n]{1,40}(?:现在|如今|目前)/u
]

/**
 * A statement about a past state is not a current fact. It becomes a memory
 * only when the same sentence contrasts it with the present, because the
 * pipeline has no "historical fact" memory type: writing "I used to live in
 * Osaka" as current residence is exactly the failure this guards against.
 */
const HISTORICAL = /(?:曾经|以前|过去|当年|那时候)/u
const PRESENT_CONTRAST = /(?:现在|如今|目前)/u

const RESIDENCE = /我(?:一直|现在|目前)?(?:住|居住)(?:在|于)?[^，。；\n]{1,40}/u
const IDENTITY = /我(?:的)?(?:名字|生日|职业|工作|公司|项目|项目代号|代号|家乡|年龄)[^，。；\n]{0,80}/u
const PREFERENCE = /我(?:一直|通常|平时|很|特别|非常)?(?:喜欢|不喜欢|偏好|讨厌|习惯|更愿意|更喜欢)[^，。；\n]{1,120}/u
const GOAL = /我(?:计划|打算|准备|正在|最近开始|希望长期|的目标是|想长期)[^，。；\n]{1,120}/u
const PROJECT = /我(?:正在做|在做|负责|参与)[^，。；\n]{1,120}/u
const STUDY = /我(?:现在|目前|最近|一直)?(?:在)?(?:学习|学|正在学)[^，。；\n]{1,60}/u
const WORK = /我(?:现在|目前|最近)?(?:在|于)[^，。；\n]{1,24}(?:工作|上班|任职|实习)/u
const SENSITIVE_FACT = /我(?:对[^，。；\n]{0,24}过敏|患有[^，。；\n]{0,24}|确诊[^，。；\n]{0,24}|有[^，。；\n]{0,12}(?:病|症))/u

const SENSITIVE_MARKERS = [
  '过敏', '疾病', '生病', '确诊', '抑郁', '焦虑', '自杀', '自残', '癌', '艾滋',
  '住院', '吃药', '药物', '精神', '创伤', '家暴', '虐待', '离婚', '债务', '欠款',
  '负债', '工资', '薪资', '收入', '投资', '贷款', '怀孕', '性取向', '性生活', '性侵',
  '宗教', '政治', '身份证', '银行卡', '密码'
] as const

const PERSONAL_MARKERS = [
  '住', '城市', '家', '生日', '年龄', '工作', '公司', '职业', '项目', '代号',
  '学习', '正在学', '计划', '目标', '喜欢', '偏好', '讨厌', '习惯',
  'prefer', 'like', 'love', 'favorite', 'favourite', 'project', 'live', 'work'
] as const

export function classifyMemorySensitivity(claim: string): Sensitivity {
  const normalized = claim.normalize('NFKC').toLocaleLowerCase()
  if (SENSITIVE_MARKERS.some((marker) => normalized.includes(marker))) return 'sensitive'
  if (PERSONAL_MARKERS.some((marker) => normalized.includes(marker))) return 'personal'
  return 'normal'
}

/**
 * Two statements describe the same fact family even when the new sentence has
 * almost no lexical overlap with the old one. "我现在住在大阪" and "我住在杭州"
 * share the residence attribute; without this they would look unrelated.
 */
export function sharesFactAttribute(left: string, right: string): boolean {
  const leftAttribute = classifyFactAttribute(left)
  const rightAttribute = classifyFactAttribute(right)
  // Shared words are not proof of a shared fact. "我养了一只叫咪咪的猫" and
  // "我养了一只叫花花的猫" overlap almost completely and still describe
  // different values; when the slot cannot be named, the honest answer is "I
  // cannot tell", which must not be turned into "same fact".
  if (leftAttribute === null || rightAttribute === null) return false
  return leftAttribute === rightAttribute
}

function claimForSentence(sentence: string): string {
  return sentence.trim().replace(/\s+/gu, ' ').slice(0, 1000)
}

/**
 * The value the user said is no longer true. It is only a hint for choosing a
 * target: the target is still re-validated against the edited content before
 * anything is written.
 */
function extractSupersededValue(text: string): string | null {
  const patterns: readonly RegExp[] = [
    /(?:不再|已经不住|已经不用|不再使用)(?:住|用|使用|叫|是)?([^，。；\n]{1,60})/u,
    /(?:不|不再)(?:住|在)([^，。；\n]{1,60}?)(?:了)/u,
    /(?:不是|并非)([^，。；\n]{1,60})/u,
    /(?:以前|之前|过去)(?:我)?(?:喜欢|爱|住|在|用)([^，。；\n]{1,60})/u
  ]
  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1]?.trim().replace(/[了的]+$/u, '').trim()
    if (value !== undefined && value.length >= 2) return value
  }
  return null
}

export function hasExplicitCorrectionIntent(text: string): boolean {
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Produces at most one candidate. Returning a list keeps the contract open for
 * future sentence-level extraction without changing callers.
 */
export function extractFormationCandidates(text: string): FormationCandidate[] {
  const normalized = text.normalize('NFKC').trim()
  if (normalized.length < 6 || normalized.length > 1000) return []
  if (GREETING.test(normalized)) return []
  if (TEMPORARY.test(normalized)) return []
  if (THIRD_PARTY_OR_ADDRESSING.test(normalized)) return []
  if (isQuestionSentence(normalized)) return []

  const intent = classifyInterestIntent(normalized)
  if (intent === 'question' || intent === 'task_request' || intent === 'third_party' || intent === 'uncertain') return []

  const correctionHint = hasExplicitCorrectionIntent(normalized)
  // A pure past-tense statement is skipped instead of being stored as a
  // current fact. With a present contrast ("我以前喜欢摄影，现在更喜欢绘画")
  // the sentence is a real update and continues as a correction candidate.
  if (!correctionHint && HISTORICAL.test(normalized) && !PRESENT_CONTRAST.test(normalized)) return []

  let kind: FormationKind
  if (correctionHint) kind = 'correction'
  else if (PREFERENCE.test(normalized)) kind = 'preference'
  else if (GOAL.test(normalized)) kind = 'goal'
  else if (PROJECT.test(normalized)) kind = 'project'
  else if (RESIDENCE.test(normalized) || IDENTITY.test(normalized) || SENSITIVE_FACT.test(normalized)) kind = 'fact'
  else if (STUDY.test(normalized)) kind = 'fact'
  else if (WORK.test(normalized)) kind = 'fact'
  else return []

  const claim = claimForSentence(normalized)
  if (claim.length < 6) return []
  return [{
    claim,
    kind,
    evidenceType: kind === 'correction' ? 'user_explicit_correction' : 'user_explicit_statement',
    confidence: kind === 'correction' ? 85 : kind === 'fact' ? 80 : 75,
    sensitivity: classifyMemorySensitivity(claim),
    claimKey: normalizedMemoryKey(claim),
    supersededHint: correctionHint ? extractSupersededValue(normalized) : null,
    correctionHint
  }]
}

/**
 * Whether a candidate may be bound to an existing memory at all. This is the
 * creation-time half of the correction guard: a preference candidate must never
 * be attached to a residence record even before the user edits anything.
 */
export function canTargetCorrection(claim: string, memoryText: string): boolean {
  const claimAttribute = classifyFactAttribute(claim)
  const memoryAttribute = classifyFactAttribute(memoryText)
  // A candidate may only be bound to a memory whose fact slot is known and the
  // same. Unclassified statements get no target at all, so they can never
  // rewrite an existing record by accident.
  if (claimAttribute === null || memoryAttribute === null) return false
  return claimAttribute === memoryAttribute
}


/**
 * Text that is not a plain assertion cannot become the new value of a memory.
 * A hypothetical ("如果我搬去京都") or an explicit "I am not sure" is not
 * evidence, and a quotation is someone else's words.
 */
const NON_ASSERTION_MARKERS = /(?:如果|假设|假如|要是|万一|可能|也许|或许|说不定|不确定|不知道|记不清|据说|听说|你说过|他说过|「|」|“|”)/u

function isPlainAssertion(text: string): boolean {
  return !NON_ASSERTION_MARKERS.test(text.normalize('NFKC'))
}

/**
 * A single-valued fact has one value. "我不再住在大阪" denies the old value but
 * asserts nothing about where the user lives now, so writing it as the new
 * value would replace a fact with a denial. Retraction is the honest action.
 *
 * Preference is exempt: "我不喜欢摄影" is itself a (negative) preference value.
 */
function isPureDenialOfTarget(edited: string, targetText: string, attribute: FactAttribute | null): boolean {
  if (!isSingleValuedAttribute(attribute)) return false
  const normalizedEdited = edited.normalize('NFKC')
  if (!/(?:不再|不住|不是|并非|没有|已经不)/u.test(normalizedEdited)) return false
  const stripped = normalizedEdited
    .replace(/(?:已经)?不再|已经不住|不住|不是|并非|没有|已经|不/gu, '')
    .replace(/[\s。！？!?，,；;、]/gu, '')
  if (stripped.length < 2) return false
  return normalizedMemoryKey(targetText).replace(/[\s。！？!?，,；;、]/gu, '').includes(stripped)
}

export type CorrectionRejectionReason =
  | 'target_missing'
  | 'target_inactive'
  | 'target_changed'
  /** The candidate predates trustworthy revision tracking; nothing is proven. */
  | 'revision_unproven'
  | 'attribute_mismatch'
  | 'subject_mismatch'
  | 'temporal_mismatch'
  /** A hypothetical, quoted, conditional or explicitly uncertain edit. */
  | 'not_an_assertion'
  /** The edit only denies the old value without stating a new one. */
  | 'negation_mismatch'
  | 'content_unchanged'

export interface CorrectionTargetSnapshot {
  id: string
  currentText: string
  status: 'active' | 'retracted'
  revision: number
  sensitivity: Sensitivity
}

export interface CorrectionValidation {
  ok: boolean
  reason: CorrectionRejectionReason | null
  detail: string
}

/**
 * Re-validates a correction at acceptance time against the *current* target.
 *
 * The candidate's classification is not trusted: the user may have edited the
 * text, and the target may have changed, been retracted, or been corrected by
 * someone else since the candidate was created. A correction that cannot be
 * proven to describe the same subject and attribute is refused, never silently
 * downgraded to a new memory and never applied to a different record.
 */
export function validateCorrectionTarget(input: {
  editedContent: string
  target: CorrectionTargetSnapshot | null
  expectedRevision: number | null
}): CorrectionValidation {
  const { editedContent, target, expectedRevision } = input
  if (target === null) {
    return { ok: false, reason: 'target_missing', detail: 'The memory this correction pointed at no longer exists.' }
  }
  if (target.status !== 'active') {
    return { ok: false, reason: 'target_inactive', detail: 'The target memory is no longer active.' }
  }
  // A candidate whose creation-time revision is unknown cannot be checked at
  // all. Treating "unknown" as "matches" is exactly how a stale candidate
  // overwrites a newer fact, so it is refused instead.
  if (expectedRevision === null) {
    return { ok: false, reason: 'revision_unproven', detail: 'The revision this candidate was built against is unknown.' }
  }
  if (target.revision !== expectedRevision) {
    return { ok: false, reason: 'target_changed', detail: 'The target memory changed after this candidate was created.' }
  }
  const content = editedContent.normalize('NFKC').trim()
  if (normalizedMemoryKey(content) === normalizedMemoryKey(target.currentText)) {
    return { ok: false, reason: 'content_unchanged', detail: 'The edited content is identical to the current memory.' }
  }
  // The block is about the user. A correction that switches subject would move
  // the fact to someone else while keeping the user's record id.
  // "如果我住在京都" is still a first-person statement; requiring 我 at a
  // clause boundary rejected it for the wrong reason. What matters is that the
  // content is about the user and not about someone else.
  if (!content.includes('我') || THIRD_PARTY_OR_ADDRESSING.test(content)) {
    return { ok: false, reason: 'subject_mismatch', detail: 'The edited content is not a first-person statement about the user.' }
  }
  if (!isPlainAssertion(content)) {
    return { ok: false, reason: 'not_an_assertion', detail: 'The edited content is hypothetical, quoted or explicitly uncertain.' }
  }
  // A past/present flip is not a wording fix. Accepting it would erase a
  // historical fact (past -> present) or demote a current one (present -> past)
  // without the user ever seeing that choice.
  const editedTemporal = classifyTemporalReference(content)
  const targetTemporal = classifyTemporalReference(target.currentText)
  if (
    (editedTemporal === 'past' && targetTemporal === 'present') ||
    (editedTemporal === 'present' && targetTemporal === 'past')
  ) {
    return {
      ok: false,
      reason: 'temporal_mismatch',
      detail: 'The edited content refers to a different time than the target memory.'
    }
  }
  const editedAttribute: FactAttribute | null = classifyFactAttribute(content)
  const targetAttribute: FactAttribute | null = classifyFactAttribute(target.currentText)
  // Unknown on either side means the relationship cannot be established at all.
  // Word overlap is not a substitute: it is exactly the signal that let a
  // different fact be written into an existing record.
  if (editedAttribute === null || targetAttribute === null) {
    return {
      ok: false,
      reason: 'attribute_mismatch',
      detail: 'The fact attribute cannot be reliably established; manual review is required.'
    }
  }
  if (editedAttribute !== targetAttribute) {
    return {
      ok: false,
      reason: 'attribute_mismatch',
      detail: `The edited content is about ${editedAttribute}, the target memory is about ${targetAttribute}.`
    }
  }
  if (isPureDenialOfTarget(content, target.currentText, editedAttribute)) {
    return {
      ok: false,
      reason: 'negation_mismatch',
      detail: 'The edited content only denies the old value; retract the memory instead.'
    }
  }
  // Same slot is necessary, not sufficient: subject, time and denial are checked
  // above, and a candidate still needs a recorded revision to be accepted.
  return { ok: true, reason: null, detail: 'Same subject and fact attribute.' }
}
