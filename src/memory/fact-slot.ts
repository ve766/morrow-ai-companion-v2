/**
 * Explainable fact slots, derived from text at read time.
 *
 * Nothing is persisted: the memory table already carries source, time, status
 * and revision lineage, so a slot is a *reading* of the current text. A record
 * that is corrected or retracted changes its slot automatically, and Slice 2
 * stays inside the existing schema.
 *
 * Predicate detection, value extraction and question detection are separate
 * steps per predicate. That matters: "我今年30岁" used to consume `30岁` in the
 * age pattern and leave an empty value, and "我对花生严重过敏" left nothing
 * because the object sits *before* the health marker.
 */

export type FactPredicate =
  | 'residence'
  | 'employer'
  | 'job_role'
  | 'study'
  | 'preference'
  | 'goal'
  | 'name'
  | 'age'
  | 'project_code'
  | 'health'
  | 'schedule'

export type FactStatus = 'active' | 'superseded' | 'unresolved'
export type FactKind = 'assertion' | 'question' | 'negated' | 'uncertain'
export type ValueRelation = 'equivalent' | 'conflict' | 'uncertain'

export interface FactSlot {
  subject: 'user'
  predicate: FactPredicate
  /** Object text. Empty for questions and for unreadable statements. */
  value: string
  kind: FactKind
  /** Kept for callers that only ask "is this a question". */
  question: boolean
  observedAt: string
  status: FactStatus
  sourceId: string
}

interface Extracted {
  value: string
  negated: boolean
  /** True when the sentence asks about the predicate instead of stating it. */
  asks: boolean
}

const VALUE_NOISE = /^[\s，,。.；;：:！!？?、]+|[\s，。；;：:！!？?、]+$/gu
const QUESTION_TAIL = /^(?:是?什么|有(?:哪些|什么|几个)|哪(?:里|儿|个|种|些)?|多少|谁|吗|呢|几|怎么样|如何)/u
const NON_ASSERTION = /(?:如果|假设|假如|要是|万一|听说|据说|「|」|“|”)/u
const COPULA = /^\s*(?:是|为|就是|叫|在)/u

function clean(value: string): string {
  return value.normalize('NFKC').replace(COPULA, '').replace(/^有/u, '').replace(VALUE_NOISE, '').replace(/\s+/gu, '')
}

function negatedBefore(text: string, index: number): boolean {
  return /(?:不再|没有|不)$/u.test(text.slice(Math.max(0, index - 2), index))
}

/** Every predicate extracts its own value; a marker never consumes the value. */
const EXTRACTORS: ReadonlyArray<{ predicate: FactPredicate; read: (text: string) => Extracted | null }> = [
  {
    predicate: 'name',
    read: (text) => {
      const match = /(?:我的?名字|我叫|姓名)(?:是|叫)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: false, asks: false }
    }
  },
  {
    predicate: 'age',
    read: (text) => {
      const explicit = /(?:年龄)(?:是|为)?\s*(\d{1,3})?/u.exec(text)
      const counter = /(\d{1,3})\s*岁/u.exec(text)
      const asked = /(?:多少|几)\s*岁/u.test(text)
      if (!explicit && !counter && !asked) return null
      const digits = counter?.[1] ?? explicit?.[1] ?? ''
      return { value: digits, negated: false, asks: digits.length === 0 }
    }
  },
  {
    predicate: 'residence',
    read: (text) => {
      const match = /(?:住在|居住在|现居|定居在?|搬到|搬家到|住址(?:是|为)?)/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },
  {
    predicate: 'employer',
    read: (text) => {
      const match = /在([^，。；\n]{1,20}?)(?:公司|集团|单位|工作|上班|任职|就职|实习)/u.exec(text)
      if (match) return { value: clean(match[1] ?? ''), negated: negatedBefore(text, match.index), asks: false }
      const own = /我的?公司(?:是|为)?/u.exec(text)
      if (!own) return null
      return { value: clean(text.slice(own.index + own[0].length)), negated: false, asks: false }
    }
  },
  {
    predicate: 'job_role',
    read: (text) => {
      const match = /(?:职业|职位|岗位|职务)(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },
  {
    predicate: 'study',
    read: (text) => {
      // 学习 must win over 在学, otherwise "我在学习 Blender" leaves "习…".
      const match = /(?:学习|学会|课程|专业|在学(?!习))(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },
  {
    predicate: 'health',
    read: (text) => {
      // The object of an allergy sits before the marker: 我对花生严重过敏.
      const allergy = /对([^，。；\n]{1,20}?)(?:严重|比较|有点)?过敏/u.exec(text)
      if (allergy) return { value: clean(allergy[1] ?? ''), negated: negatedBefore(text, allergy.index), asks: false }
      const marker = /(?:忌口|不能吃|患有|确诊|病史)(?:是|为)?/u.exec(text)
      if (!marker) return null
      return { value: clean(text.slice(marker.index + marker[0].length)), negated: negatedBefore(text, marker.index), asks: false }
    }
  },
  {
    predicate: 'preference',
    read: (text) => {
      const match = /(?:喜欢|偏好|讨厌|习惯|兴趣|爱好)(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },
  {
    predicate: 'goal',
    read: (text) => {
      const match = /(?:计划|打算|目标|准备)(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },
  {
    predicate: 'schedule',
    read: (text) => {
      // Events and appointments: the marker can sit before or after the value.
      const marker = /(?:安排|日程|行程|会议|出差|预约|复查|截止日期|截止)(?:是|为|在|有)?/u.exec(text)
      if (!marker) return null
      const after = clean(text.slice(marker.index + marker[0].length))
      const before = clean(text.slice(0, marker.index).replace(/^我|(?:今天|明天|后天|昨天|本周|这周|下周|上周|这个月|下个月|今年|明年)/gu, ''))
      return { value: after.length > 0 ? after : before, negated: negatedBefore(text, marker.index), asks: false }
    }
  },
  {
    predicate: 'project_code',
    read: (text) => {
      const match = /(?:项目代号|代号)(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: false, asks: false }
    }
  }
]

export function readFactSlot(
  text: string,
  context: { observedAt?: string; status?: FactStatus; sourceId?: string } = {}
): FactSlot | null {
  const normalized = text.normalize('NFKC').trim()
  if (normalized.length === 0) return null
  for (const extractor of EXTRACTORS) {
    const extracted = extractor.read(normalized)
    if (!extracted) continue
    const asks = extracted.asks || extracted.value.length === 0 || QUESTION_TAIL.test(extracted.value)
    const nonAssertion = NON_ASSERTION.test(normalized)
    const kind: FactKind = nonAssertion ? 'uncertain' : asks ? 'question' : extracted.negated ? 'negated' : 'assertion'
    return {
      subject: 'user',
      predicate: extractor.predicate,
      value: asks || nonAssertion ? '' : extracted.value.slice(0, 120).toLocaleLowerCase(),
      kind,
      question: kind === 'question',
      observedAt: context.observedAt ?? '',
      status: context.status ?? 'active',
      sourceId: context.sourceId ?? ''
    }
  }
  return null
}

/** Place suffixes that do not change which place is meant. */
function stripPlaceSuffix(value: string): string {
  return value.replace(/(?:市|省|区|县|镇|街道)$/u, '')
}

function comparable(value: string): string {
  return stripPlaceSuffix(value.normalize('NFKC').replace(/[的了]/gu, '').trim().toLocaleLowerCase())
}

/**
 * Three-state comparison of two values of the same fact.
 *
 * `equivalent` requires an explicit normalisation rule (place suffix, width,
 * particles). Substring containment is *not* equivalence: "喜欢猫" and
 * "喜欢猫狗" are different statements that the current rules cannot order, so
 * they are `uncertain` rather than silently merged or silently declared
 * contradictory.
 */
export function compareFactValues(left: FactSlot | null, right: FactSlot | null): ValueRelation {
  if (!left || !right) return 'uncertain'
  if (left.subject !== right.subject || left.predicate !== right.predicate) return 'uncertain'
  if (left.kind === 'question' || right.kind === 'question') return 'uncertain'
  if (left.value.length === 0 || right.value.length === 0) return 'uncertain'
  if (left.kind === 'negated' !== (right.kind === 'negated')) return 'conflict'
  const a = comparable(left.value)
  const b = comparable(right.value)
  if (a === b) return 'equivalent'
  if (a.includes(b) || b.includes(a)) return 'uncertain'
  return 'conflict'
}

/** True only for a proven contradiction; uncertainty is not a conflict. */
export function slotsConflict(left: FactSlot | null, right: FactSlot | null): boolean {
  return compareFactValues(left, right) === 'conflict'
}

/** Backwards-compatible helper: disagreement means a proven contradiction. */
export function valuesDisagree(left: string, right: string): boolean {
  return compareFactValues(
    { subject: 'user', predicate: 'residence', value: left, kind: 'assertion', question: false, observedAt: '', status: 'active', sourceId: '' },
    { subject: 'user', predicate: 'residence', value: right, kind: 'assertion', question: false, observedAt: '', status: 'active', sourceId: '' }
  ) === 'conflict'
}
