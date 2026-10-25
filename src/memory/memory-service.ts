import { randomUUID } from 'node:crypto'
import { ApplicationError } from '../shared/errors'
import type { MemoryRepository } from '../persistence/memory-repository'
import {
  MEMORY_SOURCE_CATEGORY,
  transitionMemory,
  validateMemorySearchQuery,
  validateMemorySensitivity,
  validateMemoryText,
  type MemoryChangeType,
  type MemoryRecord,
  type MemoryRevisionRecord,
  type MemoryTransition
} from './memory-domain'

import type { AssembledMemoryContext, Sensitivity } from '../shared/companion'
import { MemoryContextAssembler } from './memory-context-assembler'

export class MemoryService {
  private readonly contextAssembler = new MemoryContextAssembler()

  constructor(
    private readonly repository: MemoryRepository,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID()
  ) {}

  create(content: string, sensitivity: MemoryRecord['sensitivity'] = 'personal'): MemoryRecord {
    validateMemoryText(content)
    validateMemorySensitivity(sensitivity)
    const timestamp = this.timestamp()
    const id = this.makeId()
    if (this.repository.get(id)) throw new ApplicationError('CONFLICT')
    const record: MemoryRecord = {
      id,
      originalText: content,
      currentText: content,
      sourceCategory: MEMORY_SOURCE_CATEGORY,
      status: 'active',
      sensitivity,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1
    }
    this.repository.create(record, this.revision(record, 'created', null))
    return record
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

  assembleContext(query: string, maximumSensitivity: Sensitivity): AssembledMemoryContext {
    if (typeof query !== 'string' || query.length > 20_000) throw new ApplicationError('INVALID_INPUT')
    return this.contextAssembler.assemble(query, this.repository.listActiveForContext(1000), maximumSensitivity)
  }

  history(id: string): MemoryRevisionRecord[] {
    const history = this.repository.history(id)
    if (history === null) throw new ApplicationError('NOT_FOUND')
    return history
  }

  correct(id: string, content: string): MemoryRecord {
    validateMemoryText(content)
    return this.transition(id, { type: 'correct', content }, 'corrected')
  }

  retract(id: string): MemoryRecord {
    return this.transition(id, { type: 'retract' }, 'retracted')
  }

  restore(id: string): MemoryRecord {
    return this.transition(id, { type: 'restore' }, 'restored')
  }

  delete(id: string): void {
    if (!this.repository.delete(id)) throw new ApplicationError('NOT_FOUND')
  }

  private transition(id: string, transition: MemoryTransition, changeType: Exclude<MemoryChangeType, 'created'>): MemoryRecord {
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
    return updated
  }

  private revision(record: MemoryRecord, changeType: MemoryChangeType, previousRevision: number | null): MemoryRevisionRecord {
    return {
      memoryId: record.id,
      revision: record.revision,
      content: record.currentText,
      sourceCategory: MEMORY_SOURCE_CATEGORY,
      status: record.status,
      changeType,
      createdAt: record.updatedAt,
      previousRevision
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
