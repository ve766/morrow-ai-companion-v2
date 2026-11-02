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
import { readFactSlot, extractFactSlots, SINGLE_VALUED_PREDICATES, type FactCandidate } from './fact-slot'
import type { MemoryOperationOutcome, MemoryOperationPlan } from './memory-operation-planner'
import { slotsConflict } from './fact-slot'
/**
 * Stage 4-A: display templates for facts created from explicit requests.
 * Each shape re-extracts to the same predicate, so the fact ledger and the
 * retriever stay consistent with the text the user sees.
 */
const FACT_DISPLAY_TEMPLATES: Partial<Record<import('./fact-slot').FactPredicate, (value: string) => string>> = {
  residence: (value) => `我住在${value}。`,
  employer: (value) => `我在${value}工作。`,
  name: (value) => `我的名字叫${value}。`,
  age: (value) => `我${value}岁。`,
  project_code: (value) => `我的项目代号是${value}。`,
  pet_name: (value) => `我的宠物叫${value}。`,
  object_location: (value) => `我的证件放在${value}。`,
  health: (value) => `我对${value}过敏。`,
  preference: (value) => `我喜欢${value}。`,
  study: (value) => `我在学习${value}。`,
  goal: (value) => `我的目标是${value}。`
}
import type { MorrowEvent } from '../persistence/event-log'
import { normalizeAssertion, readMemoryUtterance, sameAssertion } from './memory-evidence-policy'

// Minimal event sink so the memory module never depends on the persistence
// module's concrete service; tests inject nothing.
export interface MemoryEventSink {
  tryRecord(event: Omit<MorrowEvent, 'schemaVersion' | 'occurredAt' | 'id'>): MorrowEvent | null
}

export interface MemoryProvenance {
  /** The real user message that produced this memory, when one exists. */
  sourceMessageId: string | null
  kind: 'message' | 'legacy'
}

export interface MemoryCreateOptions {
  sourceCategory?: MemorySourceCategory
  confidence?: number
  correlationId?: string
  /** Skip duplicate merging (used when the caller has already deduplicated). */
  allowDuplicate?: boolean
  /** B (final closure review): message-level provenance, threaded to the revision and the fact ledger. */
  provenance?: MemoryProvenance
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
    options: { useContextUtility?: boolean; importance?: import('./memory-importance').MemoryImportancePort; factIndex?: import('./fact-memory').FactMemoryService } = {}
  ) {
    this.importance = options.importance
    this.factIndex = options.factIndex
    this.contextAssembler = new MemoryContextAssembler({
      ...(options.useContextUtility === undefined ? {} : { useContextUtility: options.useContextUtility }),
      // Ranking reads the cached importance score. Admission does not: a memory
      // still has to be relevant before importance can order it.
      importanceOf: (memoryId) => this.importance?.scoreOf?.(memoryId) ?? 0
    })
  }

  private readonly importance: import('./memory-importance').MemoryImportancePort | undefined
  /** P0-A: the addressable fact layer, re-indexed after every lifecycle write. */
  private readonly factIndex: import('./fact-memory').FactMemoryService | undefined
  /** One-shot provenance for the next revision write (correct path). */
  private pendingProvenance: MemoryProvenance | undefined

  private factIndexDegraded = 0

  private reindexFact(memoryId: string): void {
    try {
      this.factIndex?.reindexMemory(memoryId)
      return
    } catch (error) {
      // A: structured, sanitized degradation — memoryId + classification only,
      // never the memory text, SQL parameters, secrets or the raw exception.
      const errorCode = error instanceof Error ? error.name : 'UNKNOWN'
      this.factIndexDegraded += 1
      // The index service marks its own failures; this covers a failure raised
      // by a wrapper (adapter, fault injection) so the job row still exists for
      // the retry path. Idempotent for an already-degraded job.
      try {
        this.factIndex?.markDegradedJob(memoryId, errorCode)
      } catch {
        // The event below still records that this memory's index is behind.
      }
      this.events?.tryRecord?.({
        sourceModule: 'memory',
        eventType: 'memory.fact_index.degraded',
        actor: 'system',
        subjectType: 'memory',
        subjectId: memoryId,
        correlationId: null,
        payload: { errorCode, attempt: this.factIndexDegraded }
      })
    }
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
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      confidence,
      lastConfirmedAt: timestamp
    }
    this.repository.create(record, this.revision(record, 'created', null, options.provenance))
    // The ledger records where this memory came from; the score is derived from
    // it, never incremented, so a replay cannot inflate importance.
    this.importance?.recordEvidence?.({
      memoryId: record.id,
      sourceRef: `create:${record.id}`,
      sourceKind: 'user_explicit',
      actor: 'user',
      conversationId: null,
      evidenceType: 'statement',
      confidence: 1,
      independenceGroup: `memory:${record.id}`
    })
    this.importance?.onMemoryChanged(record.id)
    this.recordEvent(sourceCategory === MEMORY_SOURCE_CATEGORY ? 'memory.created' : 'memory.created_inferred', record, options.correlationId, { confidence, sensitivity })
    this.reindexFact(record.id)
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

  assembleContext(
    query: string,
    maximumSensitivity: Sensitivity,
    policy?: RetrievalPolicy,
    presentation: EvidencePresentation = 'json',
    preferenceFor?: (record: MemoryRecord) => number
  ): AssembledMemoryContext {
    if (typeof query !== 'string' || query.length > 20_000) throw new ApplicationError('INVALID_INPUT')
    const records = this.repository.listActiveForContext(1000)
    // P0-A fact channel: facts addressed by attribute (predicate lookup on
    // the fact index), not by text similarity. Their memory ids are marked so
    // the assembler admits and ranks them through the fact channel.
    const factAddressedIds = new Set<string>()
    const querySlotForFacts = readFactSlot(query)
    if (querySlotForFacts?.predicate && this.factIndex) {
      try {
        for (const fact of this.factIndex.lookupActive(querySlotForFacts.predicate, { queryTime: querySlotForFacts.time, includeSuperseded: querySlotForFacts.time === 'past' })) factAddressedIds.add(fact.sourceMemoryId)
      } catch {
        // A: degraded fallback — the index is untrustworthy, so derive the
        // candidates directly from a bounded slice of the active memories
        // with the same extractor the index uses. Still never guesses: the
        // scan answers the same predicate question the index would.
        for (const record of records.slice(0, 200)) {
          if (factAddressedIds.has(record.id)) continue
          try {
            if (extractFactSlots(record.currentText).some((candidate) => candidate.predicate === querySlotForFacts.predicate)) factAddressedIds.add(record.id)
          } catch {
            // One unreadable memory stays out of the fact channel.
          }
        }
      }
    }
    // R3 query plan: a bare value assertion ("你就说我在北京") does not carry
    // a residence marker, but it asserts a value FOR a personal attribute.
    // The single-valued attributes are exactly the ones where the stored
    // current value must be in view — to resist, agree or clarify.
    // Activity verbs right after 我在 (我在学习/我在做…) are not places.
    const bareAssertion = /我(?:现在)?(?:在|住在|搬到|搬去|搬进了?)([\p{Script=Han}]{2,8})/u.exec(query)
    const assertedValue = bareAssertion?.[1] ?? ''
    const activityVerb = /^(?:学|做|看|写|想|试|用|开|玩|读|听|跑|吃)/u.test(assertedValue)
    if (this.factIndex && bareAssertion && !activityVerb) {
      try {
        // C: '我在北京' asserts a place-of-living/working fact — not a name,
        // age or project code. Narrow candidates to the place predicates so a
        // bare value cannot spray every attribute into the prompt.
        for (const predicate of ['residence', 'employer']) {
          for (const fact of this.factIndex.lookupActive(predicate)) factAddressedIds.add(fact.sourceMemoryId)
        }
      } catch {
        // Same degradation contract.
      }
    }
    // Conflict risk is a property of the candidate set, so it is computed once
    // here and handed to the ranking instead of being re-derived per record.
    return this.contextAssembler.assemble(
      query, records, maximumSensitivity, undefined, undefined, undefined, policy, presentation,
      this.conflictedIds(records),
      preferenceFor,
      factAddressedIds
    )
  }

  history(id: string): MemoryRevisionRecord[] {
    const history = this.repository.history(id)
    if (history === null) throw new ApplicationError('NOT_FOUND')
    return history
  }

  correct(id: string, content: string, correlationId?: string, provenance?: MemoryProvenance): MemoryRecord {
    validateMemoryText(content)
    // B: the correction's own provenance rides on the new revision; the
    // superseded history keeps the old revision's source. The one-shot slot is
    // cleared even when the transition throws, or a later create would inherit
    // this correction's source message.
    this.pendingProvenance = provenance
    try {
      const record = this.transition(id, { type: 'correct', content }, 'corrected', correlationId)
      this.reindexFact(id)
      return record
    } finally {
      this.pendingProvenance = undefined
    }
  }

  retract(id: string, correlationId?: string): MemoryRecord {
    const record = this.transition(id, { type: 'retract' }, 'retracted', correlationId)
    this.reindexFact(id)
    return record
  }

  restore(id: string, correlationId?: string): MemoryRecord {
    const record = this.transition(id, { type: 'restore' }, 'restored', correlationId)
    this.reindexFact(id)
    return record
  }

  confirm(id: string, options: { correlationId?: string } = {}): MemoryRecord {
    return this.transition(id, { type: 'confirm' }, 'confirmed', options.correlationId)
  }

  /**
   * Reads one user turn for memory evidence (P0-5).
   *
   * This is the production producer the repetition term never had. It records
   * a row only when the turn is an *assertion* that matches a stored fact, and
   * it records it once per message (`source_ref` is the message id, and that is
   * the ledger's primary key), so a retried turn cannot inflate the count.
   *
   * The gates live in `memory-evidence-policy`: a question, a negation, a
   * quote, a hypothetical, a role-play or a discussion is not a restatement,
   * however similar it looks. Being conservative here is the point — a wrong
   * repetition count is worse than a missing one, because it silently promotes
   * a passing mention above a fact the user actually cares about.
   */
  observeUtterance(input: {
    text: string
    messageId: string
    conversationId: string
    occurredAt: string
    actor?: 'user' | 'morrow' | 'system'
  }): Array<{ memoryId: string; signal: 'restatement' | 'confirmation' }> {
    const reading = readMemoryUtterance({ text: input.text, ...(input.actor ? { actor: input.actor } : {}) })
    if (reading.signal === 'none' || !reading.assertion) return []
    const matched = this.repository.listActiveForContext(1000)
      .filter((record) => sameAssertion(normalizeAssertion(record.currentText), reading.assertion!))
    const recorded: Array<{ memoryId: string; signal: 'restatement' | 'confirmation' }> = []
    for (const record of matched) {
      this.importance?.recordEvidence?.({
        memoryId: record.id,
        // The message is the identity: one turn contributes once, and a replay
        // of the same turn is a no-op rather than a second mention.
        sourceRef: input.messageId,
        sourceKind: 'message',
        actor: 'user',
        conversationId: input.conversationId,
        evidenceType: reading.signal === 'confirmation' ? 'confirmation' : 'restatement',
        confidence: 0.9,
        // Same conversation, same group: three repeats in one conversation are
        // one context, not three independent mentions.
        independenceGroup: input.conversationId
      })
      this.importance?.onMemoryChanged(record.id)
      this.recordEvent('memory.restated', record, input.conversationId, { signal: reading.signal })
      recorded.push({ memoryId: record.id, signal: reading.signal })
    }
    return recorded
  }

  delete(id: string): void {
    if (!this.repository.delete(id)) throw new ApplicationError('NOT_FOUND')
    this.reindexFact(id)
  }

  /**
   * Stage 4-A: the explicit "帮我记住" path. The user's own words authorize
   * the memory, so the statement is extracted into facts and stored with the
   * real source message id — the link the vertical story was missing. A
   * candidate that conflicts with an existing active single-valued memory is
   * treated as the user's explicit correction of that memory (the request
   * said 帮我记住/帮我更新); otherwise it creates a new memory.
   * Unknown or ambiguous shapes are skipped — the text stays in the
   * conversation and in lexical retrieval, never guessed into a predicate.
   */
  /**
   * Stage 4-A final repair: executes a planned operation BEFORE the provider
   * call, in one transaction, then re-reads the ledger and verifies the shape
   * it promised. The returned outcome is what the prompt is allowed to claim;
   * a failed verification returns `failed`, never a success status.
   *
   * Idempotent by construction: a replayed turn (provider retry, or the second
   * prepare of the same turn) finds the committed state and returns the same
   * outcome with `replayed: true` instead of writing again.
   */
  /** Runs the batch inside one transaction when the ledger can provide one. */
  private inTransaction<T>(operation: () => T): T {
    // Bound call: an unbound method loses `this` and fails reading its options.
    return this.factIndex ? this.factIndex.inTransaction(operation) : operation()
  }

  /** Read-only view for the planner: active facts for one predicate. */
  activeFactsFor(predicate: import('./fact-slot').FactPredicate): ReturnType<import('./fact-memory').FactMemoryService['lookupActive']> {
    return this.factIndex?.lookupActive(predicate) ?? []
  }

  /**
   * Stage 4-A final repair: superseded values of the given memories, for a
   * past-tense question. History only — the caller renders it as such.
   */
  supersededForMemories(memoryIds: readonly string[]): Array<{ predicate: string; value: string }> {
    if (!this.factIndex || memoryIds.length === 0) return []
    const placeholders = memoryIds.map(() => '?').join(',')
    return this.factIndex.supersededFor(memoryIds)
  }

  /** The stored text of one memory (planner species carry-over). */
  textOf(memoryId: string): string {
    return this.repository.get(memoryId)?.currentText ?? ''
  }

  /** False when no fact ledger is wired: the planner must not claim certainty. */
  get ledgerAvailable(): boolean {
    return this.factIndex !== undefined
  }

  executeOperation(plan: MemoryOperationPlan): MemoryOperationOutcome {
    if (plan.operation === 'none') return { operation: 'none', status: 'not_applied', reason: plan.reason }
    if (plan.operation === 'clarify') return { operation: 'clarify', status: 'clarify', reason: plan.reason }
    if (plan.operation === 'rejected') return { operation: 'rejected', status: 'rejected', reason: plan.reason }
    if (plan.operation === 'failed') return { operation: 'failed', status: 'failed', errorCode: plan.errorCode }

    if (plan.operation === 'create') {
      const first = plan.facts[0]!
      // Replay: this turn already committed this value.
      const existing = this.factIndex?.lookupActive(first.predicate) ?? []
      const already = existing.find((fact) => fact.sourceMessageId === plan.messageId && fact.valueNormalized === first.valueNormalized)
      if (already) {
        return {
          operation: 'create',
          status: 'committed_and_verified',
          predicate: first.predicate,
          currentValue: already.valueDisplay,
          memoryId: already.sourceMemoryId,
          revision: already.sourceRevision,
          factId: already.id,
          ...(already.sourceMessageId ? { sourceMessageId: already.sourceMessageId } : {}),
          replayed: true
        }
      }
      try {
        // P1-E: creation and verification share one transaction. The repository
        // opens a savepoint per write; the batch wrapper is what makes a later
        // verification failure roll the earlier facts back instead of leaving a
        // half-committed batch that reports success.
        const degradedBefore = this.factIndexDegraded
        const outcome = this.inTransaction(() => {
          const created = plan.facts.map((fact) => this.create(fact.displayText, 'personal', {
            correlationId: plan.messageId,
            provenance: { sourceMessageId: plan.messageId, kind: 'message' }
          }))
          // Verify against the ledger, not against the object we just built.
          // D3: every planned fact is verified, not only the first one.
          const missing: string[] = []
          let hit: import('./fact-memory').FactRecord | undefined
          for (const fact of plan.facts) {
            const verified = this.factIndex?.lookupActive(fact.predicate) ?? []
            const found = verified.find((row) => row.sourceMessageId === plan.messageId && row.valueNormalized === fact.valueNormalized)
            if (!found) missing.push(fact.predicate)
            else if (!hit) hit = found
          }
          if (!hit || missing.length > 0) {
            // An index write that failed during this batch is recoverable: the
            // primary records exist and the durable job finishes the index. A
            // mismatch with no index failure is not, and must not survive.
            if (this.factIndexDegraded === degradedBefore) {
              throw new Error(missing.length > 0 ? 'PARTIAL_VERIFICATION_FAILED' : 'VERIFICATION_FAILED')
            }
            return { created, hit: null, recovery: true as const }
          }
          return { created, hit, recovery: false as const }
        })
        if (outcome.recovery) {
          this.recordOperationFailure(plan.messageId, 'verification', 'INDEX_DEGRADED')
          return { operation: 'create', status: 'recovery_required', predicate: first.predicate, errorCode: 'INDEX_DEGRADED', reason: 'index_pending' }
        }
        const hit = outcome.hit
        return {
          operation: 'create',
          status: 'committed_and_verified',
          predicate: first.predicate,
          currentValue: hit.valueDisplay,
          memoryId: hit.sourceMemoryId,
          revision: hit.sourceRevision,
          factId: hit.id,
          ...(hit.sourceMessageId ? { sourceMessageId: hit.sourceMessageId } : {}),
          ...(outcome.created.length > 1 ? { reason: 'multiple_facts' } : {})
        }
      } catch (error) {
        const name = error instanceof Error ? error.name : 'UNKNOWN'
        this.recordOperationFailure(plan.messageId, name.includes('VERIFICATION') ? 'verification' : 'commit', name)
        // P1-E: distinguish "nothing was kept" from "the record exists but its
        // index is still catching up". The renderer must not claim success for
        // either; recovery_required names the durable job that will finish it.
        const kept = (this.factIndex?.lookupActive(first.predicate) ?? []).filter((fact) => fact.sourceMessageId === plan.messageId)
        if (kept.length === plan.facts.length) {
          return { operation: 'create', status: 'recovery_required', predicate: first.predicate, errorCode: name, reason: 'index_pending' }
        }
        return { operation: 'create', status: 'rolled_back', predicate: first.predicate, errorCode: name }
      }
    }

    // correct
    const { target, newValue, displayText } = plan
    // Replay: the old fact is already superseded by a fact from this turn.
    const history = this.factIndex?.lookupActive(target.predicate, { queryTime: 'past' }) ?? []
    const already = history.find((fact) => fact.sourceMemoryId === target.memoryId && fact.valueNormalized === newValue.normalize('NFKC').trim().toLocaleLowerCase() && fact.sourceMessageId === plan.messageId)
    if (already) {
      return {
        operation: 'correct',
        status: 'committed_and_verified',
        predicate: target.predicate,
        previousValue: target.previousValue,
        currentValue: already.valueDisplay,
        memoryId: already.sourceMemoryId,
        revision: already.sourceRevision,
        factId: already.id,
        ...(already.sourceMessageId ? { sourceMessageId: already.sourceMessageId } : {}),
        replayed: true
      }
    }
    try {
      // P1-E: the write and its verification commit together, so a correction
      // whose ledger read disagrees is rolled back rather than reported done.
      const degradedBefore = this.factIndexDegraded
      const outcome = this.inTransaction(() => {
        this.correct(target.memoryId, displayText, plan.messageId, { sourceMessageId: plan.messageId, kind: 'message' })
        const current = this.factIndex?.lookupActive(target.predicate) ?? []
        const previous = this.factIndex?.lookupActive(target.predicate, { queryTime: 'past' }) ?? []
        // Bind both sides to the memory being corrected. A value from another
        // memory of the same predicate must not satisfy verification.
        const newFact = current.find((fact) => fact.sourceMemoryId === target.memoryId && fact.valueNormalized === newValue.normalize('NFKC').trim().toLocaleLowerCase())
        const oldFact = previous.find((fact) => fact.sourceMemoryId === target.memoryId && fact.valueNormalized === target.previousValue.normalize('NFKC').trim().toLocaleLowerCase())
        if (!newFact || !oldFact || oldFact.status !== 'superseded') {
          // Same split as create: a failed index write is recoverable through
          // the durable job; a real mismatch rolls the correction back.
          if (this.factIndexDegraded !== degradedBefore) return { newFact: newFact ?? null, oldFact: oldFact ?? null, recovery: true as const }
          throw new Error('VERIFICATION_FAILED')
        }
        return { newFact, oldFact, recovery: false as const }
      })
      if (outcome.recovery) {
        this.recordOperationFailure(plan.messageId, 'verification', 'INDEX_DEGRADED')
        return {
          operation: 'correct',
          status: 'recovery_required',
          predicate: target.predicate,
          previousValue: target.previousValue,
          errorCode: 'INDEX_DEGRADED',
          reason: 'index_pending'
        }
      }
      return {
        operation: 'correct',
        status: 'committed_and_verified',
        predicate: target.predicate,
        previousValue: outcome.oldFact.valueDisplay,
        currentValue: outcome.newFact.valueDisplay,
        memoryId: outcome.newFact.sourceMemoryId,
        revision: outcome.newFact.sourceRevision,
        factId: outcome.newFact.id,
        ...(outcome.newFact.sourceMessageId ? { sourceMessageId: outcome.newFact.sourceMessageId } : {})
      }
    } catch (error) {
      this.recordOperationFailure(plan.messageId, 'commit', error instanceof Error ? error.name : 'UNKNOWN')
      return { operation: 'correct', status: 'failed', predicate: target.predicate, previousValue: target.previousValue, errorCode: error instanceof Error ? error.name : 'UNKNOWN' }
    }
  }

  /** Sanitized, stage-tagged failure record: ids and codes only. */
  private recordOperationFailure(messageId: string, stage: 'planning' | 'commit' | 'verification' | 'context', errorCode: string): void {
    try {
      this.events?.tryRecord({
        sourceModule: 'memory',
        eventType: 'memory.operation.failed',
        actor: 'system',
        subjectType: 'conversation_message',
        subjectId: messageId,
        correlationId: null,
        payload: { stage, errorCode: errorCode.slice(0, 64) }
      })
    } catch {
      // Diagnostics must never break the turn; the caller still sees 'failed'.
    }
  }

  createExplicitFromTurn(input: {
    text: string
    messageId: string
    conversationId: string
    occurredAt: string
    sensitivity?: MemoryRecord['sensitivity']
  }): Array<{ memory: MemoryRecord; corrected: boolean }> {
    const results: Array<{ memory: MemoryRecord; corrected: boolean }> = []
    for (const candidate of extractFactSlots(input.text)) {
      // The pet template names the species the user actually stated ("我的猫叫
      // 咪咪" keeps 猫). A generic 宠物 line is weaker evidence for a question
      // about 猫, and this story is about a cat.
      const petSpecies = candidate.predicate === 'pet_name' ? (/猫/u.test(input.text) ? '猫' : /狗/u.test(input.text) ? '狗' : null) : null
      const display = candidate.predicate === 'pet_name' && petSpecies
        ? '我的' + petSpecies + '叫' + candidate.value + '。'
        : FACT_DISPLAY_TEMPLATES[candidate.predicate]?.(candidate.value)
      if (!display) continue
      validateMemoryText(display)
      const conflicting = this.repository.listActiveForContext(1000).find((record) => {
        if (record.status !== 'active') return false
        const slot = readFactSlot(record.currentText)
        if (!slot || slot.predicate !== candidate.predicate) return false
        const asserted = { ...slot, value: candidate.value, kind: candidate.polarity === 'negative' ? 'negated' as const : 'assertion' as const }
        if (slotsConflict(asserted, slot)) return true
        return SINGLE_VALUED_PREDICATES.has(candidate.predicate) && comparableFactValue(slot.value) !== comparableFactValue(candidate.value)
      })
      if (conflicting) {
        // Keep the species the existing memory names: correcting 咪咪→豆豆 must
        // leave '我的猫叫豆豆。', not fall back to the generic 宠物 line.
        const carried = candidate.predicate === 'pet_name' && !petSpecies ? speciesOf(conflicting.currentText) : null
        const correctedText = carried ? '我的' + carried + '叫' + candidate.value + '。' : display
        const memory = this.correct(conflicting.id, correctedText, input.messageId, { sourceMessageId: input.messageId, kind: 'message' })
        results.push({ memory, corrected: true })
        continue
      }
      // Skip an exact restatement: the memory already exists.
      if (this.repository.listActiveForContext(1000).some((record) => sameAssertion(normalizeAssertion(record.currentText), normalizeAssertion(display)))) continue
      const memory = this.create(display, input.sensitivity ?? 'personal', {
        correlationId: input.messageId,
        provenance: { sourceMessageId: input.messageId, kind: 'message' }
      })
      results.push({ memory, corrected: false })
    }
    // Stage 4-A pronoun correction: "我说错了，它现在叫豆豆" names no
    // predicate of its own. It is only resolved when exactly ONE active
    // single-valued pet memory exists in the ledger — zero or several means
    // ambiguous, and an ambiguous referent is skipped rather than guessed.
    if (results.length === 0) {
      const pronoun = /它(?:现在)?(?:的?名字)?叫([^，。！？]+)/u.exec(input.text)
      const value = pronoun ? cleanFactValue(pronoun[1] ?? '') : ''
      if (value.length > 0 && value.length <= 40) {
        const petSources = new Set(this.factIndex ? this.factIndex.lookupActive('pet_name').map((fact) => fact.sourceMemoryId) : [])
        if (petSources.size === 1) {
          const target = [...petSources][0]!
          const targetText = this.repository.get(target)?.currentText ?? ''
          const species = speciesOf(input.text) ?? speciesOf(targetText)
          const templateText = species ? '我的' + species + '叫' + value + '。' : FACT_DISPLAY_TEMPLATES.pet_name!(value)
          const memory = this.correct(target, templateText, input.messageId, { sourceMessageId: input.messageId, kind: 'message' })
          results.push({ memory, corrected: true })
        }
      }
    }
    if (results.length > 0) {
      this.recordEvent('memory.explicit_created', results[0]!.memory, input.conversationId, {
        count: results.length,
        corrected: results.filter((item) => item.corrected).length
      })
    }
    return results
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
    // A correction is evidence that this memory matters, and it is recorded as
    // such — but it is not a repetition: being corrected twice does not mean the
    // user stated it twice.
    if (changeType === 'corrected') {
      this.importance?.recordEvidence?.({
        memoryId: updated.id,
        sourceRef: `correct:${updated.id}:${updated.revision}`,
        sourceKind: 'user_explicit',
        actor: 'user',
        conversationId: null,
        evidenceType: 'correction',
        confidence: 1,
        independenceGroup: `correction:${updated.id}`
      })
    }
    // A confirmation is evidence that the fact still holds and still matters.
    // It is deliberately *not* a repetition: agreeing that something is true is
    // not the same as saying it again, and counting it as one inflated `n`
    // every time the user accepted a suggestion.
    if (changeType === 'confirmed') {
      this.importance?.recordEvidence?.({
        memoryId: updated.id,
        sourceRef: `confirm:${updated.id}:${updated.revision}`,
        sourceKind: 'user_explicit',
        actor: 'user',
        conversationId: null,
        evidenceType: 'confirmation',
        confidence: 1,
        independenceGroup: `confirmation:${updated.id}`
      })
    }
    // A retraction suppresses the fact's standing: the ledger keeps the row for
    // the audit, the score stops counting repetitions, and retrieval drops the
    // memory. Nothing is deleted, so `restore()` can bring it back intact.
    if (changeType === 'retracted') {
      this.importance?.recordEvidence?.({
        memoryId: updated.id,
        sourceRef: `retract:${updated.id}:${updated.revision}`,
        sourceKind: 'user_explicit',
        actor: 'user',
        conversationId: null,
        evidenceType: 'retraction',
        confidence: 1,
        independenceGroup: `retraction:${updated.id}`
      })
    }
    // Importance is recomputed from the new revision set, never incremented, so
    // a correction raises it and a retraction cannot leave a stale high score.
    this.importance?.onMemoryChanged(updated.id)
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

  private revision(record: MemoryRecord, changeType: MemoryChangeType, previousRevision: number | null, provenance?: MemoryProvenance): MemoryRevisionRecord {
    if (!provenance) provenance = this.pendingProvenance
    this.pendingProvenance = undefined
    return {
      memoryId: record.id,
      revision: record.revision,
      content: record.currentText,
      sourceCategory: record.sourceCategory,
      status: record.status,
      changeType,
      createdAt: record.updatedAt,
      previousRevision,
      confidence: record.confidence,
      sourceMessageId: provenance?.sourceMessageId ?? null,
      provenanceKind: provenance?.kind ?? 'legacy'
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

function comparableFactValue(value: string): string {
  // Mirrors fact-slot's comparable(): strips place suffixes is unnecessary here —
  // exact normalized compare for the same-predicate check.
  return value.normalize('NFKC').replace(/[的了]/gu, '').trim().toLocaleLowerCase()
}

function cleanFactValue(value: string): string {
  return value.normalize('NFKC').replace(/^[s，,。.；;：:！!？?、]+|[s，,。.；;：:！!？?、]+$/gu, '').trim()
}

/** The species a memory text names, when it names one. */
function speciesOf(text: string): '猫' | '狗' | null {
  if (/猫/u.test(text)) return '猫'
  if (/狗/u.test(text)) return '狗'
  return null
}

