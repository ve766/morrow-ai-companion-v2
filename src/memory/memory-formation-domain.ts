import type { Sensitivity } from '../shared/companion'
import { classifyInterestIntent, isQuestionSentence } from '../self-model/interest-intent'
import { normalizedMemoryKey } from './memory-domain'

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
const CORRECTION_HINT = /(?:不再|搬家|搬到|改成|改为|已经不住|已经不用|现在是|现在住|现在在)/u
const SUPERSEDED_VALUE = /(?:不再|已经不住|已经不用|不再使用)(?:住|用|使用|叫|是)?([^，。；\n]{1,80})/u
const RESIDENCE = /我(?:一直|现在|目前)?(?:住|居住)(?:在|于)?[^，。；\n]{1,40}/u
const IDENTITY = /我(?:的)?(?:名字|生日|职业|工作|公司|项目|项目代号|代号|家乡|年龄)[^，。；\n]{0,80}/u
const PREFERENCE = /我(?:一直|通常|平时|很|特别|非常)?(?:喜欢|不喜欢|偏好|讨厌|习惯|更愿意|更喜欢)[^，。；\n]{1,120}/u
const GOAL = /我(?:计划|打算|准备|正在|最近开始|希望长期|的目标是|想长期)[^，。；\n]{1,120}/u
const PROJECT = /我(?:正在做|在做|负责|参与)[^，。；\n]{1,120}/u
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
 * share the residence attribute; without this they would look unrelated and a
 * correction would silently leave the old value active.
 */
export function sharesFactAttribute(left: string, right: string): boolean {
  const families: ReadonlyArray<(value: string) => boolean> = [
    (value) => /(?:我|你|您)[^。；\n]{0,16}(?:住在|居住|搬家|搬到|搬离)/u.test(value),
    (value) => /(?:项目代号|代号|项目名称)/u.test(value),
    (value) => /(?:我|你|您)[^。；\n]{0,16}(?:喜欢|不喜欢|偏好|讨厌|习惯)/u.test(value),
    (value) => /(?:我|你|您)[^。；\n]{0,16}(?:工作|职业|公司|从事)/u.test(value),
    (value) => /(?:我|你|您)[^。；\n]{0,16}(?:学习|正在学|开始学)/u.test(value)
  ]
  return families.some((matches) => matches(left) && matches(right))
}

function claimForSentence(sentence: string): string {
  return sentence.trim().replace(/\s+/gu, ' ').slice(0, 1000)
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

  const correctionHint = CORRECTION_HINT.test(normalized)
  const superseded = SUPERSEDED_VALUE.exec(normalized)?.[1]?.trim() ?? null
  let kind: FormationKind
  if (correctionHint) kind = 'correction'
  else if (PREFERENCE.test(normalized)) kind = 'preference'
  else if (GOAL.test(normalized)) kind = 'goal'
  else if (PROJECT.test(normalized)) kind = 'project'
  else if (RESIDENCE.test(normalized) || IDENTITY.test(normalized) || SENSITIVE_FACT.test(normalized)) kind = 'fact'
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
    supersededHint: superseded,
    correctionHint
  }]
}
