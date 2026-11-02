/**
 * Real-process worker for the F6 invariants. The test bundles this file with
 * esbuild and spawns it as an OS process; it opens its own SQLite connection,
 * claims one outbox obligation through the effect ledger, and projects it.
 *
 * Modes:
 *   normal  — project, optionally waiting at a barrier before the write
 *   crash   — exit after the claim, before the business write
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SqliteDatabase } from '../../../src/persistence/database'
import { CognitionOutbox, type CognitiveProjector } from '../../../src/app/cognitive-outbox'
import { RelationshipThreadService } from '../../../src/relationship/relationship-threads'

const [dbPath, turnId, clockIso, barrierDir, mode] = process.argv.slice(2)
if (!dbPath || !turnId || !clockIso) {
  console.error('usage: worker <db> <turnId> <clockIso> [barrierDir] [normal|crash]')
  process.exit(2)
}

const database = SqliteDatabase.open(dbPath)
const clock = (): string => clockIso
const outbox = new CognitionOutbox(database, clock)
const relationships = new RelationshipThreadService({ database, clock })

const projector: CognitiveProjector = {
  module: 'relationship',
  version: 1,
  project: (input) => {
    if (barrierDir) {
      writeFileSync(join(barrierDir, `ready-${process.pid}`), '1')
      if (mode === 'crash') process.exit(9)
      const go = join(barrierDir, 'go')
      while (!existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
    // Only the source id crosses into the service; it reads the body itself.
    relationships.observe({
      messageId: input.userMessageId,
      conversationId: input.conversationId,
      at: input.occurredAt
    })
  }
}

try {
  const result = outbox.drain([projector], { turnId })
  console.log(JSON.stringify(result))
  database.close()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'unknown')
  try {
    database.close()
  } catch {
    // best effort
  }
  process.exit(1)
}
