import type { SqliteDatabase } from './database'

// The deletion boundary journal records the latest user-driven lifecycle fact
// for memories and conversations so that restoring an older backup can
// re-apply it instead of silently resurrecting deleted or retracted content.
// `unretracted` exists because an explicit memory restore revokes the
// retraction boundary on purpose.

export type DeletionJournalEntity = 'memory' | 'conversation' | 'message' | 'evidence' | 'candidate'
export type DeletionJournalState = 'deleted' | 'retracted' | 'unretracted'

export interface DeletionJournalEntry {
  entity: DeletionJournalEntity
  entityId: string
  state: DeletionJournalState
  /** Groups the rows written by one deletion request; null for legacy rows. */
  operationId: string | null
  recordedAt: string
}

const journalTablePresent = (database: SqliteDatabase): boolean =>
  Number(database.connection.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'deletion_journal'").get()?.count ?? 0) === 1

export function recordDeletionState(
  database: SqliteDatabase,
  entity: DeletionJournalEntity,
  entityId: string,
  state: DeletionJournalState,
  recordedAt: string,
  operationId: string | null = null
): void {
  if (!journalTablePresent(database)) return
  database.connection.prepare(`
    INSERT INTO deletion_journal(entity, entity_id, state, operation_id, recorded_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(entity, entity_id) DO UPDATE SET
      state = excluded.state,
      operation_id = COALESCE(excluded.operation_id, deletion_journal.operation_id),
      recorded_at = excluded.recorded_at
  `).run(entity, entityId, state, operationId, recordedAt)
}

/**
 * Evidence identity inside the journal: candidate id, conversation id and the
 * evidence hash. No user text and no message body, so the journal stays a
 * boundary record rather than a second copy of the conversation.
 */
export function evidenceJournalKey(candidateId: string, conversationId: string, evidenceHash: string): string {
  return `${candidateId}:${conversationId}:${evidenceHash}`
}

export function readDeletionJournal(database: SqliteDatabase): DeletionJournalEntry[] {
  if (!journalTablePresent(database)) return []
  const rows = database.connection.prepare('SELECT entity, entity_id, state, operation_id, recorded_at FROM deletion_journal ORDER BY recorded_at, entity, entity_id')
    .all() as unknown as Array<{ entity: string; entity_id: string; state: string; operation_id: string | null; recorded_at: string }>
  return rows.map((row) => ({
    entity: row.entity as DeletionJournalEntity,
    entityId: row.entity_id,
    state: row.state as DeletionJournalState,
    operationId: row.operation_id,
    recordedAt: row.recorded_at
  }))
}

export function readLatestDeletionStates(database: SqliteDatabase): Map<string, { state: DeletionJournalState; entityId: string }> {
  const latest = new Map<string, { state: DeletionJournalState; entityId: string }>()
  // Rows are ordered by recorded_at; later rows describe the newest fact and win.
  for (const entry of readDeletionJournal(database)) {
    latest.set(`${entry.entity}:${entry.entityId}`, { state: entry.state, entityId: entry.entityId })
  }
  return latest
}

// Merge rule for restores: for each (entity, entity_id) the newer recorded_at
// wins because it describes the most recent user decision. An equal timestamp
// keeps the live row, which is the database the user actually kept using.
export function mergeDeletionJournal(live: DeletionJournalEntry[], backup: DeletionJournalEntry[]): DeletionJournalEntry[] {
  const merged = new Map<string, DeletionJournalEntry>()
  for (const entry of live) merged.set(`${entry.entity}:${entry.entityId}`, entry)
  for (const entry of backup) {
    const key = `${entry.entity}:${entry.entityId}`
    const current = merged.get(key)
    if (!current || entry.recordedAt > current.recordedAt) merged.set(key, entry)
  }
  return [...merged.values()]
}
