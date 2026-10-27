export const MEMORY_SOURCE_CATEGORY = 'user_explicit_input' as const

// Provenance: how a memory entered the system. Directly typed memories and
// model-proposed memories the user reviewed and accepted are different kinds
// of evidence and are never conflated.
export const MEMORY_SOURCE_CATEGORIES = ['user_explicit_input', 'model_inferred_confirmed', 'turn_derived_confirmed'] as const
export type MemorySourceCategory = typeof MEMORY_SOURCE_CATEGORIES[number]

export type MemoryStatus = 'active' | 'retracted'
export type MemorySensitivity = 'normal' | 'personal' | 'sensitive'
export type MemoryChangeType = 'created' | 'corrected' | 'retracted' | 'restored' | 'confirmed'

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
}

export type MemoryTransition =
  | { type: 'correct'; content: string }
  | { type: 'retract' }
  | { type: 'restore' }
  | { type: 'confirm' }

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
