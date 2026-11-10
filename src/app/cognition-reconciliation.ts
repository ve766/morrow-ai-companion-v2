/**
 * Startup deletion/revalidation gate (Issue #83 P0-A).
 *
 * This function is the production startup boundary and the recovery entry. It
 * deliberately returns a status instead of swallowing errors: the caller locks
 * Provider context when any required step fails.
 */
import type { SqliteDatabase } from '../persistence/database'
import type { EventLogService } from '../persistence/event-log'
import { readLatestDeletionStates } from '../persistence/deletion-journal'
import type { SourceValidityService } from '../persistence/source-validity'
import type { CognitionConsistencyGate, CognitionConsistencySnapshot } from './cognition-consistency'

export interface CognitionReconciliationDeps {
  database: SqliteDatabase
  gate: CognitionConsistencyGate
  sourceValidity: SourceValidityService
  revalidate: () => { updated: number; retracted: number }
  recoverInvestigations: () => number
  replayConversation: (conversationId: string) => void
  events?: EventLogService | undefined
  /** Test seam: a corrupted journal reader must lock, not be silently ignored. */
  readJournal?: (database: SqliteDatabase) => Map<string, { state: string; entityId: string }>
}

export interface CognitionReconciliationOutcome extends CognitionConsistencySnapshot {
  reconciled: boolean
}

export function reconcileCognitionConsistency(deps: CognitionReconciliationDeps): CognitionReconciliationOutcome {
  const reasons: string[] = []
  const details: Record<string, number> = {}
  try {
    const read = deps.readJournal ?? ((database: SqliteDatabase) => readLatestDeletionStates(database) as Map<string, { state: string; entityId: string }>)
    const deletions = read(deps.database)
    let conversations = 0
    let memories = 0
    for (const [key, entry] of deletions) {
      if (entry.state === 'unretracted') continue
      if (key.startsWith('conversation:')) {
        deps.sourceValidity.invalidateConversation(entry.entityId)
        deps.replayConversation(entry.entityId)
        conversations += 1
      } else if (key.startsWith('memory:')) {
        deps.sourceValidity.invalidateMemory(entry.entityId, entry.state === 'deleted' ? 'deleted' : 'retracted')
        memories += 1
      }
    }
    details.conversations = conversations
    details.memories = memories
    if (conversations > 0 || memories > 0) {
      deps.events?.tryRecord({
        sourceModule: 'app',
        eventType: 'deletion.replayed',
        actor: 'system',
        subjectType: 'application',
        subjectId: null,
        correlationId: null,
        payload: { conversations, memories, schemaVersion: deps.database.schemaVersion }
      })
    }
  } catch {
    reasons.push('deletion_replay_failed')
  }
  try {
    const revalidated = deps.revalidate()
    details.revalidated = revalidated.updated
    details.retracted = revalidated.retracted
  } catch {
    reasons.push('self_state_revalidation_failed')
  }
  try {
    details.suspended = deps.recoverInvestigations()
  } catch {
    reasons.push('investigation_recovery_failed')
  }
  if (reasons.length === 0) {
    deps.gate.ready(details)
    return { ...deps.gate.snapshot(), reconciled: true }
  }
  deps.gate.lock(reasons, details)
  return { ...deps.gate.snapshot(), reconciled: false }
}
