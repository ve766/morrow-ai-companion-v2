import { randomUUID } from 'node:crypto'
import { ApplicationError } from '../shared/errors'
import type { MemoryRepository } from '../persistence/memory-repository'
import {
  MEMORY_SOURCE_CATEGORY,
  MEMORY_SOURCE_CATEGORIES,
  normalizedMemoryKey,
  transitionMemory,
  validateMemoryConfidence,
  validateMemorySearchQuery,
  validateMemorySensitivity,
  validateMemorySourceCategory,
  validateMemoryText,
  type MemoryChangeType,
  type MemoryRecord,
  type MemoryRevisionRecord,
  type MemorySourceCategory,
  type MemoryTransition
} from './memory-domain'

import type { AssembledMemoryContext, Sensitivity } from '../shared/companion'
import type { RetrievalPolicy } from './retrieval-policy'
import type { EvidencePresentation } from './memory-context-assembler'
import { MemoryContextAssembler } from './memory-context-assembler'
import type { MorrowEvent } from '../persistence/event-log'

// Minimal event sink so the memory module never depends on the persistence
// module's concrete service; tests inject nothing.
export interface MemoryEventSink {
  tryRecord(event: Omit<MorrowEvent, 'schemaVersion' | 'occurredAt' | 'id'>): MorrowEvent | null
}

export interface MemoryCreateOptions {
  sourceCategory?: MemorySourceCategory
  confidence?: number
  correlationId?: string
  /** Skip duplicate merging (used when the caller has already deduplicated). */
  allowDuplicate?: boolean
}

export interface MemoryConflictReport {
  memoryId: string
  conflictsWith: MemoryRecord[]
}

// Terms significant enough that sharing several of them suggests two memories
// talk about the same subject; used for conservative conflict flagging.
const CONFLICT_MIN_SHARED_TERMS = 2

function significantTerms(text: string): Set<string> {
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  const result = new Set<string>()
  for (const token of normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
    result.add(token)
    // CJK runs have no word separators; overlapping character bigrams are the
    // smallest honest unit for "same subject" comparisons.
    const characters = Array.from(token)
    if (characters.some((character) => /\p{Script=Han}/u.test(character))) {
      for (let index = 0; index < characters.length - 1; index += 1) {
        result.add(characters[index]! + characters[index + 1]!)
      }
    }
  }
  return result
}

export class MemoryService {
  private readonly contextAssembler: MemoryContextAssembler

  constructor(
    private readonly repository: MemoryRepository,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID(),
    private readonly events?: MemoryEventSink,
    options: { useContextUtility?: boolean } = {}
  ) {
    this.contextAssembler = new MemoryContextAssembler(
      options.useContextUtility === undefined ? {} : { useContextUtility: options.useContextUtility }
    )
  }

  create(content: string, sensitivity: MemoryRecord['sensitivity'] = 'personal', options: MemoryCreateOptions = {}): MemoryRecord {
    validateMemoryText(content)
    validateMemorySensitivity(sensitivity)
    const sourceCategory = options.sourceCategory ?? MEMORY_SOURCE_CATEGORY
    validateMemorySourceCategory(sourceCategory)
    const confidence = options.confidence ?? (sourceCategory === MEMORY_SOURCE_CATEGORY ? 85 : 60)
    validateMemoryConfidence(confidence)

    // Duplicate merge: the same fact re-entered (or re-confirmed by an
    // accepted suggestion) refreshes the existing record instead of forking.
    if (options.allowDuplicate !== true) {
      const key = normalizedMemoryKey(content)
      const duplicate = this.repository.listActiveForContext(1000)
        .find((record) => normalizedMemoryKey(record.currentText) === key)
      if (duplicate) {
        return this.confirm(duplicate.id, options.correlationId === undefined ? {} : { correlationId: options.correlationId })
      }
    }

    const timestamp = this.timestamp()
    const id = this.makeId()
    if (this.repository.get(id)) throw new ApplicationError('CONFLICT')
    const record: MemoryRecord = {
      id,
      originalText: content,
      currentText: content,
      sourceCategory,
      status: 'active',
      sensitivity,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      confidence,
      lastConfirmedAt: timestamp
    }
    this.repository.create(record, this.revision(record, 'created', null))
    this.recordEvent(sourceCategory === MEMORY_SOURCE_CATEGORY ? 'memory.created' : 'memory.created_inferred', record, options.correlationId, { confidence, sensitivity })
    return record
  }

  /** Conservative same-subject flagging: shares several significant terms with active memories but is not a duplicate. */
  detectConflicts(id: string): MemoryConflictReport {
    const record = this.repository.get(id)
    if (!record) throw new ApplicationError('NOT_FOUND')
    const terms = significantTerms(record.currentText)
    const conflictsWith = this.repository.listActiveForContext(1000).filter((other) => {
      if (other.id === id) return false
      const otherTerms = significantTerms(other.currentText)
      let shared = 0
      for (const term of terms) if (otherTerms.has(term)) shared += 1
      return shared >= CONFLICT_MIN_SHARED_TERMS && normalizedMemoryKey(other.currentText) !== normalizedMemoryKey(record.currentText)
    })
    if (conflictsWith.length > 0) {
      this.events?.tryRecord({
        sourceModule: 'memory', eventType: 'memory.conflict_flagged', actor: 'system',
        subjectType: 'memory', subjectId: id, correlationId: null,
        payload: { conflictsWith: conflictsWith.slice(0, 5).map((item) => item.id) }
      })
    }
    return { memoryId: id, conflictsWith }
  }

  /**
   * Ids whose wording overlaps another active record on the same predicate-ish
   * terms. One pass over the given set, no event writes: ranking calls this on
   * every assembly, while `detectConflicts` is the audited single-record view.
   */
  conflictedIds(records: readonly MemoryRecord[]): Set<string> {
    const terms = records.map((record) => significantTerms(record.currentText))
    const keys = records.map((record) => normalizedMemoryKey(record.currentText))
    const conflicted = new Set<string>()
    for (let left = 0; left < records.length; left += 1) {
      for (let right = left + 1; right < records.length; right += 1) {
        if (keys[left] === keys[right]) continue
        let shared = 0
        for (const term of terms[left]!) if (terms[right]!.has(term)) shared += 1
        if (shared < CONFLICT_MIN_SHARED_TERMS) continue
        conflicted.add(records[left]!.id)
        conflicted.add(records[right]!.id)
      }
    }
    return conflicted
  }

  list(): MemoryRecord[] {
    return this.repository.list()
  }

  countActive(): number {
    return this.repository.countActive()
  }

  countActiveForVerification(): number {
    return this.repository.countActiveForVerification()
  }

  search(query: string): MemoryRecord[] {
    validateMemorySearchQuery(query)
    return this.repository.search(query.trim())
  }

  assembleContext(query: string, maximumSensitivity: Sensitivity, policy?: RetrievalPolicy, presentation: EvidencePresentation = 'json'): AssembledMemoryContext {
    if (typeof query !== 'string' || query.length > 20_000) throw new ApplicationError('INVALID_INPUT')
    const records = this.repository.listActiveForContext(1000)
    // Conflict risk is a property of the candidate set, so it is computed once
    // here and handed to the ranking instead of being re-derived per record.
    return this.contextAssembler.assemble(query, records, maximumSensitivity, undefined, undefined, undefined, policy, presentation, this.conflictedIds(records))
  }

  history(id: string): MemoryRevisionRecord[] {
    const history = this.repository.history(id)
    if (history === null) throw new ApplicationError('NOT_FOUND')
    return history
  }

  correct(id: string, content: string, correlationId?: string): MemoryRecord {
    validateMemoryText(content)
    return this.transition(id, { type: 'correct', content }, 'corrected', correlationId)
  }

  retract(id: string, correlationId?: string): MemoryRecord {
    return this.transition(id, { type: 'retract' }, 'retracted', correlationId)
  }

  restore(id: string, correlationId?: string): MemoryRecord {
    return this.transition(id, { type: 'restore' }, 'restored', correlationId)
  }

  confirm(id: string, options: { correlationId?: string } = {}): MemoryRecord {
    return this.transition(id, { type: 'confirm' }, 'confirmed', options.correlationId)
  }

  delete(id: string): void {
    if (!this.repository.delete(id)) throw new ApplicationError('NOT_FOUND')
  }

  private transition(id: string, transition: MemoryTransition, changeType: Exclude<MemoryChangeType, 'created'>, correlationId?: string): MemoryRecord {
    const current = this.repository.get(id)
    if (!current) throw new ApplicationError('NOT_FOUND')
    const changedAt = this.timestamp()
    let updated: MemoryRecord
    try {
      updated = transitionMemory(current, transition, changedAt)
    } catch {
      throw new ApplicationError('CONFLICT')
    }
    const revision = this.revision(updated, changeType, current.revision)
    this.repository.transition(current.revision, updated, revision)
    this.recordEvent(`memory.${changeType}`, updated, correlationId, { revision: updated.revision })
    return updated
  }

  private recordEvent(eventType: string, record: MemoryRecord, correlationId: string | null | undefined, payload: Record<string, unknown>): void {
    this.events?.tryRecord({
      sourceModule: 'memory',
      eventType,
      // Every memory transition here is user-initiated (direct edits or a
      // user accepting an inferred suggestion); the correlation id links it
      // to the originating suggestion or request either way.
      actor: 'user',
      subjectType: 'memory',
      subjectId: record.id,
      correlationId: correlationId ?? null,
      payload
    })
  }

  private revision(record: MemoryRecord, changeType: MemoryChangeType, previousRevision: number | null): MemoryRevisionRecord {
    return {
      memoryId: record.id,
      revision: record.revision,
      content: record.currentText,
      sourceCategory: record.sourceCategory,
      status: record.status,
      changeType,
      createdAt: record.updatedAt,
      previousRevision,
      confidence: record.confidence
    }
  }

  private timestamp(): string {
    const value = this.clock()
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !value.endsWith('Z')) {
      throw new ApplicationError('STORAGE_ERROR')
    }
    return new Date(value).toISOString()
  }
}
