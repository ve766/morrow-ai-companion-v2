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
  /**
   * Set when importance decay pushed the memory out of retrieval competition.
   * Not a user action: `retracted` means the user withdrew it, `archived` means
   * time did. Archived memories stay readable and restorable.
   */
  archivedAt: string | null
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

// Memories older than this without any user confirmation are treated as
// stale: they stay retrievable but rank below recently confirmed evidence.
export const MEMORY_STALE_DAYS = 180

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

export function isStaleMemory(record: Pick<MemoryRecord, 'lastConfirmedAt' | 'updatedAt' | 'status'>, now: string): boolean {
  if (record.status !== 'active') return false
  const reference = record.lastConfirmedAt ?? record.updatedAt
  const ageDays = (Date.parse(now) - Date.parse(reference)) / 86_400_000
  return Number.isFinite(ageDays) && ageDays > MEMORY_STALE_DAYS
}

// Normalized content key for duplicate merging: case-, width- and
// whitespace-insensitive so the same fact re-entered with cosmetic
// differences merges instead of forking.
export function normalizedMemoryKey(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
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
