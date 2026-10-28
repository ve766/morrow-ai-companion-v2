export const MEMORY_SOURCE_CATEGORY = 'user_explicit_input' as const

// Provenance: how a memory entered the system. Directly typed memories and
// model-proposed memories the user reviewed and accepted are different kinds
// of evidence and are never conflated.
export const MEMORY_SOURCE_CATEGORIES = ['user_explicit_input', 'model_inferred_confirmed', 'turn_derived_confirmed'] as const
export type MemorySourceCategory = typeof MEMORY_SOURCE_CATEGORIES[number]

export type MemoryStatus = 'active' | 'retracted'
export type MemorySensitivity = 'normal' | 'personal' | 'sensitive'
export type MemoryChangeType = 'created' | 'corrected' | 'retracted' | 'restored' | 'confirmed'

/**
 * Provenance of a revision's sensitivity.
 *
 * `recorded` means the value was written by the code that performed the
 * transition, so it is evidence. `inferred_backfill` means a migration copied
 * the memory's sensitivity into an older revision: it is deliberately
 * conservative for filtering, but it must never be presented as the value that
 * was actually recorded at that time.
 */
export type MemorySensitivitySource = 'recorded' | 'inferred_backfill'

export interface MemoryRecord {
  id: string
  originalText: string
  currentText: string
  sourceCategory: MemorySourceCategory
  status: MemoryStatus
  sensitivity: MemorySensitivity
  createdAt: string
  updatedAt: string
  revision: number
  confidence: number
  lastConfirmedAt: string | null
}

export interface MemoryRevisionRecord {
  memoryId: string
  revision: number
  content: string
  sourceCategory: MemorySourceCategory
  status: MemoryStatus
  changeType: MemoryChangeType
  createdAt: string
  previousRevision: number | null
  confidence: number
  /** Sensitivity as of this revision, so a later change is auditable. */
  sensitivity: MemorySensitivity
  /** Whether `sensitivity` was recorded or inferred by a migration. */
  sensitivitySource: MemorySensitivitySource
}

export type MemoryTransition =
  // A correction may carry the sensitivity the user chose at review time. It is
  // part of the same transition because a content change and a sensitivity
  // change must not be written as two half-states.
  | { type: 'correct'; content: string; sensitivity?: MemorySensitivity }
  | { type: 'retract' }
  | { type: 'restore' }
  | { type: 'confirm' }

/**
 * Fact attributes are deliberately narrow. A coarse family ("identity",
 * "project") let a correction swap one fact for another inside the same family:
 * editing "我叫小王" into "我今年 30 岁" passed an `identity == identity` check
 * and rewrote the name. Each attribute below is a distinct fact slot.
 *
 * `preference` intentionally covers liking, disliking, hobbies and habits.
 * Deterministic rules cannot separate "喜欢摄影" from "兴趣是摄影", and
 * splitting them would reject legitimate rewording without adding safety.
 */
export type FactAttribute =
  | 'name'
  | 'birth_date'
  | 'age'
  | 'residence'
  | 'employer'
  | 'job_role'
  | 'study_topic'
  | 'preference'
  | 'project_name'
  | 'project_code'
  | 'relationship'
  | 'health_fact'
  | 'goal'

/**
 * Single-valued attributes: a person has one current name, one birth date, one
 * age, one residence, one employer, one role, one project name and one project
 * code. Two records in the same slot with different text are a real
 * contradiction and must reach the model as an unresolved conflict.
 *
 * `relationship`, `preference`, `study_topic`, `health_fact` and `goal` are
 * multi-valued: having a brother and a sister, or liking coffee and tea, is not
 * a contradiction.
 */
export const SINGLE_VALUED_ATTRIBUTES: readonly FactAttribute[] = Object.freeze([
  'name',
  'birth_date',
  'age',
  'residence',
  'employer',
  'job_role',
  'project_name',
  'project_code'
])

const FACT_ATTRIBUTE_RULES: ReadonlyArray<{ attribute: FactAttribute; pattern: RegExp }> = [
  // Order matters. Birth date before age ("1996 年出生" has no 岁), project
  // code before project name, and employer before job role ("我在甲公司工作").
  { attribute: 'birth_date', pattern: /(?:出生|生于|生日)/u },
  { attribute: 'age', pattern: /(?:年龄|\d{1,3}\s*岁)/u },
  { attribute: 'name', pattern: /(?:我的?名字|我叫|姓名)/u },
  { attribute: 'project_code', pattern: /(?:项目代号|代号)/u },
  { attribute: 'project_name', pattern: /(?:项目名称|项目叫|项目是)/u },
  { attribute: 'residence', pattern: /(?:住在|居住|现居|定居|住址|搬家|搬到|搬离|迁居)/u },
  { attribute: 'employer', pattern: /(?:(?:在|于)[^，。；\n]{1,20}(?:公司|集团|单位|工作|上班|任职|就职|实习))|(?:我的?公司)/u },
  { attribute: 'job_role', pattern: /(?:职业|职位|岗位|职务|职称)/u },
  { attribute: 'study_topic', pattern: /(?:学习|在学|学会|课程|专业|读书)/u },
  { attribute: 'health_fact', pattern: /(?:过敏|忌口|不能吃|患有|确诊|病史)/u },
  { attribute: 'preference', pattern: /(?:喜欢|偏好|讨厌|习惯|兴趣|爱好|更愿意|更喜欢)/u },
  { attribute: 'goal', pattern: /(?:计划|打算|准备|目标|希望)/u },
  { attribute: 'relationship', pattern: /(?:男朋友|女朋友|丈夫|妻子|老公|老婆|伴侣|结婚|恋爱|离婚|未婚|父母|妈妈|爸爸|哥哥|姐姐|弟弟|妹妹|孩子|儿子|女儿)/u }
]

/** The fact slot a sentence talks about, or null when it cannot be named. */
export function classifyFactAttribute(text: string): FactAttribute | null {
  const normalized = text.normalize('NFKC')
  for (const rule of FACT_ATTRIBUTE_RULES) {
    if (rule.pattern.test(normalized)) return rule.attribute
  }
  return null
}

/**
 * Time reference is a separate axis from the fact attribute. A correction that
 * flips between "used to live in Osaka" and "now lives in Kyoto" is not a
 * wording fix: applying it would either erase a historical fact or promote a
 * historical one to current, so it is refused instead of silently rewritten.
 */
export type TemporalReference = 'past' | 'present' | 'unspecified'

const PAST_MARKERS = /(?:曾经|以前|过去|当年|那时候|小时候|上一份)/u
const PRESENT_MARKERS = /(?:现在|目前|如今|当前|这阵子|最近)/u

export function classifyTemporalReference(text: string): TemporalReference {
  const normalized = text.normalize('NFKC')
  const past = PAST_MARKERS.test(normalized)
  const present = PRESENT_MARKERS.test(normalized)
  if (past && !present) return 'past'
  if (present && !past) return 'present'
  return 'unspecified'
}

export function isSingleValuedAttribute(attribute: FactAttribute | null): boolean {
  return attribute !== null && SINGLE_VALUED_ATTRIBUTES.includes(attribute)
}

// A single age threshold for every memory is wrong in both directions: a
// favourite food does not expire in six months, while "I am looking for a new
// job" can be false in six weeks. Volatility is a coarse, deterministic
// property of the sentence, not a guess about the user: a memory with no
// recognisable marker keeps the neutral window.
export type MemoryVolatility = 'stable' | 'volatile' | 'unknown'

export const MEMORY_VOLATILITY_VALUES = ['stable', 'volatile', 'unknown'] as const

// Unconfirmed-for-this-long memories are flagged stale. They stay retrievable
// but must be presented as possibly outdated rather than as current fact.
export const MEMORY_STALE_DAYS_BY_VOLATILITY: Readonly<Record<MemoryVolatility, number>> = Object.freeze({
  stable: 365,
  volatile: 90,
  unknown: 180
})

// Neutral window retained for callers that only have an age, not a text.
export const MEMORY_STALE_DAYS = MEMORY_STALE_DAYS_BY_VOLATILITY.unknown

// Markers are intentionally small and literal. A wrong "volatile" only makes a
// record ask for confirmation sooner; a wrong "stable" would let an old fact
// masquerade as current, so the volatile list takes precedence.
const VOLATILE_MARKERS: readonly RegExp[] = [
  /住在|住址|搬家|迁居|搬到|目前住|现居|定居|租房|合租|室友/u,
  /工作|公司|职位|岗位|任职|入职|离职|跳槽|实习|老板|同事|部门/u,
  /工资|薪水|薪资|收入|年薪|月薪|存款|负债|贷款/u,
  /年龄|岁数|\d+\s*岁/u,
  /体重|身高|减肥|增重/u,
  /怀孕|备孕|恋爱|结婚|离婚|分手|订婚|男朋友|女朋友|伴侣/u,
  /在读|年级|学期|课程|考试|毕业/u,
  /计划|打算|准备|最近|目前|现在|这周|这个月|今年/u,
  /\b(?:live|lives|living|moved|moving|relocat\w*)\b/iu,
  /\b(?:job|work(?:s|ing)? at|employ\w*|salary|income|promot\w*)\b/iu,
  /\b(?:age|weight|pregnant|dating|married|divorc\w*|engaged)\b/iu,
  /\b(?:currently|right now|these days|this week|this month|plan(?:s|ning)? to)\b/iu
]

const STABLE_MARKERS: readonly RegExp[] = [
  /喜欢|偏好|习惯|总是|从不|讨厌|害怕|过敏|信仰|价值观|性格|原则|口味/u,
  /\b(?:like|likes|love|loves|prefer\w*|hate\w*|always|never|afraid of|allerg\w*|value[sd]?|personality)\b/iu
]

export function classifyMemoryVolatility(text: string): MemoryVolatility {
  const normalized = text.normalize('NFKC')
  if (VOLATILE_MARKERS.some((marker) => marker.test(normalized))) return 'volatile'
  if (STABLE_MARKERS.some((marker) => marker.test(normalized))) return 'stable'
  return 'unknown'
}

export function memoryAgeDays(
  record: Pick<MemoryRecord, 'lastConfirmedAt' | 'updatedAt'>,
  now: string
): number | null {
  const reference = record.lastConfirmedAt ?? record.updatedAt
  const ageDays = (Date.parse(now) - Date.parse(reference)) / 86_400_000
  return Number.isFinite(ageDays) ? ageDays : null
}

/** True when the record is past the window for its volatility class. */
export function isStaleMemory(
  record: Pick<MemoryRecord, 'lastConfirmedAt' | 'updatedAt' | 'status'> & { currentText?: string },
  now: string,
  volatility: MemoryVolatility = classifyMemoryVolatility(record.currentText ?? '')
): boolean {
  if (record.status !== 'active') return false
  const ageDays = memoryAgeDays(record, now)
  return ageDays !== null && ageDays > MEMORY_STALE_DAYS_BY_VOLATILITY[volatility]
}

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainValidationError'
  }
}

export class InvalidMemoryTransitionError extends Error {
  constructor() {
    super('The requested memory transition is not allowed.')
    this.name = 'InvalidMemoryTransitionError'
  }
}

export function validateMemoryText(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 4000 ||
    value.includes('\u0000') ||
    /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new DomainValidationError('Memory content must contain 1 to 4000 valid characters.')
  }
}

export function validateMemorySensitivity(value: unknown): asserts value is MemorySensitivity {
  if (value !== 'normal' && value !== 'personal' && value !== 'sensitive') {
    throw new DomainValidationError('Memory sensitivity is invalid.')
  }
}

export function validateMemorySearchQuery(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 256 ||
    value.includes('\u0000') ||
    /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new DomainValidationError('Search query is invalid.')
  }
}

export function canTransitionMemory(status: MemoryStatus, transition: MemoryTransition): boolean {
  if (transition.type === 'correct') return status === 'active'
  if (transition.type === 'retract') return status === 'active'
  if (transition.type === 'confirm') return status === 'active'
  return status === 'retracted'
}

export function transitionMemory(
  record: MemoryRecord,
  transition: MemoryTransition,
  changedAt: string
): MemoryRecord {
  if (!canTransitionMemory(record.status, transition)) throw new InvalidMemoryTransitionError()

  const currentText = transition.type === 'correct' ? transition.content : record.currentText
  if (transition.type === 'correct') validateMemoryText(currentText)
  if (transition.type === 'correct' && currentText === record.currentText) throw new InvalidMemoryTransitionError()
  const sensitivity = transition.type === 'correct' && transition.sensitivity !== undefined
    ? transition.sensitivity
    : record.sensitivity
  validateMemorySensitivity(sensitivity)
  if (transition.type === 'confirm') {
    // Re-confirming identical content must still be meaningful: it refreshes
    // recency and can raise confidence, but a no-op confirm with unchanged
    // confidence and timestamp is rejected so revision history stays honest.
    if (record.lastConfirmedAt === changedAt && record.confidence >= 100) throw new InvalidMemoryTransitionError()
  }

  const status: MemoryStatus = transition.type === 'retract'
    ? 'retracted'
    : transition.type === 'restore'
      ? 'active'
      : record.status

  const confidence = transition.type === 'confirm'
    ? Math.min(100, record.confidence + 5)
    : record.confidence

  return {
    ...record,
    currentText,
    status,
    sensitivity,
    updatedAt: changedAt,
    revision: record.revision + 1,
    confidence,
    lastConfirmedAt: transition.type === 'retract' ? record.lastConfirmedAt : changedAt
  }
}

export function isRetrievableMemory(record: Pick<MemoryRecord, 'status'>): boolean {
  return record.status === 'active'
}

// Normalized content key for duplicate merging: case-, width- and
// whitespace-insensitive so the same fact re-entered with cosmetic
// differences merges instead of forking.
export function normalizedMemoryKey(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

/**
 * Terms that are significant enough that sharing several of them suggests two
 * memories talk about the same subject. Latin words are compared whole (no
 * substring matching), CJK runs contribute adjacent bigrams because there are
 * no word separators. Shared by conflict flagging and context assembly so the
 * two cannot drift apart.
 */
export function significantMemoryTerms(text: string): Set<string> {
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  const result = new Set<string>()
  for (const token of normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
    result.add(token)
    const characters = Array.from(token)
    if (characters.some((character) => /\p{Script=Han}/u.test(character))) {
      for (let index = 0; index < characters.length - 1; index += 1) {
        result.add(characters[index]! + characters[index + 1]!)
      }
    }
  }
  return result
}

export function sharedTermCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let shared = 0
  for (const term of left) if (right.has(term)) shared += 1
  return shared
}

export function validateMemorySourceCategory(value: unknown): asserts value is MemorySourceCategory {
  if (typeof value !== 'string' || !MEMORY_SOURCE_CATEGORIES.includes(value as MemorySourceCategory)) {
    throw new DomainValidationError('Memory source category is invalid.')
  }
}

export function validateMemoryConfidence(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new DomainValidationError('Memory confidence must be an integer from 1 to 100.')
  }
}
