/**
 * SQLite storage for the persistent turn state machine (B4).
 *
 * `enter` refuses an illegal move by throwing, so a bug in the caller surfaces
 * as a test failure instead of a corrupted lifecycle. Re-entering the current
 * state is a no-op so recovery and retries can replay transitions.
 */
import type { SqliteDatabase } from './database'
import { canTransition, IllegalTurnTransition, type TurnState, type TurnStatePort, type TurnStateRecord } from '../cognition/turn-state-machine'

export class SqliteTurnStateRepository implements TurnStatePort {
  constructor(private readonly database: SqliteDatabase) {}

  get(turnId: string): TurnStateRecord | null {
    const row = this.database.connection.prepare(
      'SELECT turn_id, conversation_id, state, updated_at, reason FROM turn_states WHERE turn_id = ?'
    ).get(turnId.toLowerCase()) as { turn_id: string; conversation_id: string; state: TurnState; updated_at: string; reason: string | null } | undefined
    if (!row) return null
    return { turnId: row.turn_id, conversationId: row.conversation_id, state: row.state, updatedAt: row.updated_at, reason: row.reason }
  }

  enter(record: TurnStateRecord): void {
    const current = this.get(record.turnId)
    if (!canTransition(current?.state ?? null, record.state)) {
      throw new IllegalTurnTransition(current?.state ?? null, record.state)
    }
    if (current?.state === record.state) return
    this.database.connection.prepare(`
      INSERT INTO turn_states(turn_id, conversation_id, state, updated_at, reason)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(turn_id) DO UPDATE SET
        state = excluded.state,
        updated_at = excluded.updated_at,
        reason = excluded.reason
    `).run(record.turnId.toLowerCase(), record.conversationId.toLowerCase(), record.state, record.updatedAt, record.reason)
  }
}
