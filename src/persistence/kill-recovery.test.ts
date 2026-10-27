import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonalityService } from '../app/companion-service'
import { FeedbackCandidateService } from '../self-model/feedback-candidate-service'
import { SqliteDatabase } from './database'

/**
 * Real forced termination, not an exception.
 *
 * A child process opens the database, starts a write transaction that bumps the
 * personality version and inserts an `applying` application row, then reports
 * that it is inside the transaction and hangs. The parent kills it with
 * SIGKILL (TerminateProcess on Windows) so no cleanup, rollback or `finally`
 * runs. Reopening must show the pre-transaction state: a committed-together
 * design cannot leave half of it behind.
 */

const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) {
      try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) } catch { /* locked */ }
    }
  }
})

const CHILD_SCRIPT = `
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const [databasePath, markerPath] = process.argv.slice(1)
const database = new DatabaseSync(databasePath)
database.exec('PRAGMA journal_mode = WAL')
database.exec('PRAGMA busy_timeout = 5000')
database.exec('BEGIN IMMEDIATE')
database.prepare("UPDATE personality_profiles SET version = version + 1, warmth = 99 WHERE id = 'primary'").run()
database.prepare("INSERT INTO persona_feedback_applications(id, candidate_id, status, base_personality_version, applied_personality_version, created_at, updated_at) SELECT 'ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'applying', 1, NULL, '2026-10-27T12:00:00.000Z', '2026-10-27T12:00:00.000Z' FROM persona_feedback_candidates LIMIT 1").run()
fs.writeFileSync(markerPath, 'in-transaction')
setInterval(() => {}, 1000)
`

function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (existsSync(path)) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('child never reached the transaction'))
      setTimeout(tick, 25)
    }
    tick()
  })
}

describe('a killed process cannot leave a half-applied personality change', () => {
  it('rolls the open transaction back when the process is force-killed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'morrow-kill-'))
    directories.push(root)
    const databasePath = join(root, 'morrow.sqlite3')
    const markerPath = join(root, 'marker')

    const database = SqliteDatabase.open(databasePath)
    const personality = new PersonalityService(database)
    const feedback = new FeedbackCandidateService(database)
    // Used only to seed a candidate before the child process is started.
    const conversationId = '11111111-1111-4111-8111-111111111111'
    feedback.record({ kind: 'tone', source: 'user_explicit', conversationId, messageId: null, claim: '请简短一点。', confidence: 70, sensitivity: 'normal' })
    const before = personality.get()
    database.close()

    const child = spawn(process.execPath, ['-e', CHILD_SCRIPT, databasePath, markerPath], { stdio: 'ignore' })
    try {
      await waitForFile(markerPath)
      // SIGKILL on Windows maps to TerminateProcess: no JS handler runs.
      child.kill('SIGKILL')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
      expect(child.exitCode !== 0 || child.signalCode !== null).toBe(true)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }

    const reopened = SqliteDatabase.open(databasePath)
    try {
      expect(reopened.connection.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
      // The uncommitted personality bump is gone.
      const after = new PersonalityService(reopened).get()
      expect(after.version).toBe(before.version)
      expect(after.warmth).toBe(before.warmth)
      // The uncommitted application row is gone too, so the candidate is still
      // applicable rather than stuck in `applying`.
      expect(reopened.connection.prepare("SELECT COUNT(*) AS count FROM persona_feedback_applications WHERE status = 'applying'").get()?.count).toBe(0)
      expect(new FeedbackCandidateService(reopened).list()[0]?.status).toBe('pending')
    } finally {
      reopened.close()
    }
  })
})
