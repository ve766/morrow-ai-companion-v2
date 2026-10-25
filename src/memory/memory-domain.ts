export const MEMORY_SOURCE_CATEGORY = 'user_explicit_input' as const

export type MemoryStatus = 'active' | 'retracted'
export type MemorySensitivity = 'normal' | 'personal' | 'sensitive'
export type MemoryChangeType = 'created' | 'corrected' | 'retracted' | 'restored'

export interface MemoryRecord {
  id: string
  originalText: string
  currentText: string
  sourceCategory: typeof MEMORY_SOURCE_CATEGORY
  status: MemoryStatus
  sensitivity: MemorySensitivity
  createdAt: string
  updatedAt: string
  revision: number
}

export interface MemoryRevisionRecord {
  memoryId: string
  revision: number
  content: string
  sourceCategory: typeof MEMORY_SOURCE_CATEGORY
  status: MemoryStatus
  changeType: MemoryChangeType
  createdAt: string
  previousRevision: number | null
}

export type MemoryTransition =
  | { type: 'correct'; content: string }
  | { type: 'retract' }
  | { type: 'restore' }

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

  const status: MemoryStatus = transition.type === 'retract'
    ? 'retracted'
    : transition.type === 'restore'
      ? 'active'
      : record.status

  return {
    ...record,
    currentText,
    status,
    updatedAt: changedAt,
    revision: record.revision + 1
  }
}

export function isRetrievableMemory(record: Pick<MemoryRecord, 'status'>): boolean {
  return record.status === 'active'
}
