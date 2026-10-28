/**
 * Explainable fact slots, derived from text.
 *
 * Nothing here is persisted. The memory table already carries the source, the
 * observed time, the status and the revision lineage; a slot is a *reading* of
 * a record's current text, recomputed on demand. That keeps Slice 2 inside the
 * existing schema: no migration, no parallel store, and a record that is
 * corrected or retracted changes its slot automatically because the text and
 * the status changed.
 *
 * The classifier is deterministic and deliberately narrow. When it cannot name
 * a predicate it returns null, and callers must treat the record as
 * unclassified rather than guessing a relationship.
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

export type FactStatus = 'active' | 'superseded' | 'unresolved'

export interface FactSlot {
  subject: 'user'
  predicate: FactPredicate
  /** Empty when the sentence asks about the predicate instead of stating it. */
  value: string
  /** Whether this turn asks a question about the predicate. */
  question: boolean
  observedAt: string
  status: FactStatus
  sourceId: string
}

interface PredicateRule {
  predicate: FactPredicate
  pattern: RegExp
}

// Order matters: 项目代号 before generic project wording, 名字 before 年龄 etc.
const RULES: readonly PredicateRule[] = [
  { predicate: 'name', pattern: /(?:我的?名字|我叫|姓名)/u },
  { predicate: 'age', pattern: /(?:年龄|\d{1,3}\s*岁)/u },
  { predicate: 'residence', pattern: /(?:住在|居住|搬家|搬到|现居|定居|住址)/u },
  { predicate: 'employer', pattern: /(?:(?:在|于)[^，。；\n]{1,20}(?:公司|集团|单位|工作|上班|任职|就职|实习))|(?:我的?公司)/u },
  { predicate: 'job_role', pattern: /(?:职业|职位|岗位|职务)/u },
  { predicate: 'study', pattern: /(?:学习|在学|学会|课程|专业)/u },
  { predicate: 'health', pattern: /(?:过敏|忌口|不能吃|患有|确诊|病史)/u },
  { predicate: 'preference', pattern: /(?:喜欢|偏好|讨厌|习惯|兴趣|爱好)/u },
  { predicate: 'goal', pattern: /(?:计划|打算|准备|目标)/u },
  { predicate: 'project_code', pattern: /(?:项目代号|代号)/u }
]

const QUESTION_TAIL = /^(?:是?什么|哪(?:里|儿|个|种)?|多少|谁|吗|呢|几)/u
const VALUE_NOISE = /^[\s，,。.；;：:！!？?、]+|[\s，,。.；;：:！!？?、]+$/gu

function normalizeValue(value: string): string {
  return value.normalize('NFKC').replace(VALUE_NOISE, '').replace(/\s+/gu, '').toLocaleLowerCase()
}

/** Reads one sentence as a fact slot, or returns null when it cannot. */
export function readFactSlot(
  text: string,
  context: { observedAt?: string; status?: FactStatus; sourceId?: string } = {}
): FactSlot | null {
  const normalized = text.normalize('NFKC').trim()
  if (normalized.length === 0) return null
  for (const rule of RULES) {
    const match = rule.pattern.exec(normalized)
    if (!match) continue
    const rest = normalized.slice(match.index + match[0].length).replace(/^\s*(?:是|为|就是|叫)/u, '').replace(VALUE_NOISE, '')
    const question = rest.length === 0 || QUESTION_TAIL.test(rest)
    // "不喜欢" and "喜欢" must not collapse to the same value: keep the
    // negation that sits immediately before the predicate marker.
    const before = normalized.slice(Math.max(0, match.index - 2), match.index)
    const negated = /(?:不再|没有|不)$/u.test(before)
    return {
      subject: 'user',
      predicate: rule.predicate,
      value: question ? '' : normalizeValue(`${negated ? '不' : ''}${rest}`).slice(0, 120),
      question,
      observedAt: context.observedAt ?? '',
      status: context.status ?? 'active',
      sourceId: context.sourceId ?? ''
    }
  }
  return null
}

/**
 * Two active values for the same predicate disagree when neither contains the
 * other. "杭州" and "杭州市" are the same value written differently; "杭州" and
 * "大阪" are not.
 */
export function valuesDisagree(left: string, right: string): boolean {
  if (left.length === 0 || right.length === 0) return false
  if (left === right) return false
  // Polarity beats containment: "不吃香菜" contains "吃香菜" but contradicts it.
  if (left.startsWith('不') !== right.startsWith('不')) return true
  return !left.includes(right) && !right.includes(left)
}

/** Same subject, same predicate, different active values. */
export function slotsConflict(left: FactSlot | null, right: FactSlot | null): boolean {
  if (!left || !right) return false
  if (left.subject !== right.subject || left.predicate !== right.predicate) return false
  return valuesDisagree(left.value, right.value)
}

export function predicateOf(text: string): FactPredicate | null {
  return readFactSlot(text)?.predicate ?? null
}
