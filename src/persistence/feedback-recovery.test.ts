import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CompanionService } from '../app/companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { MemorySecretStore } from '../security/secrets'
import { FeedbackCandidateService } from '../self-model/feedback-candidate-service'
import { BackupService } from './backup-service'
import { SqliteConversationRepository } from './conversation-repository'
import { SqliteDatabase } from './database'
import { SqliteMemoryRepository } from './memory-repository'

/**
 * End-to-end recovery: a deletion that happens after a backup must survive
 * restoring that backup. The journal used to cover only memories and
 * conversations, so withdrawn feedback evidence came back as active and the
 * candidate returned to `supported`.
 */

const directories: string[] = []
const databases: SqliteDatabase[] = []
const clock = (): string => '2026-10-27T12:00:00.000Z'

afterEach(() => {
  while (databases.length > 0) {
    try { databases.pop()?.close() } catch { /* already closed */ }
  }
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) {
      try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) } catch { /* locked file */ }
    }
  }
})

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'morrow-recovery-'))
  directories.push(root)
  const databasePath = join(root, 'morrow.sqlite3')
  const database = SqliteDatabase.open(databasePath)
  databases.push(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock)
  const conversations = new ConversationService(new SqliteConversationRepository(database), clock)
  const feedback = new FeedbackCandidateService(database, clock)
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async () => undefined,
    clock,
    feedback
  })
  return { root, databasePath, database, memories, conversations, feedback, companion, backup: new BackupService(database, databasePath) }
}

describe('a restore cannot resurrect data deleted after the backup', () => {
  it('keeps the message, its evidence, its memory and the support count consistent', async () => {
    const space = workspace()
    const { companion, feedback, memories, database } = space

    const conversationA = companion.createConversation()
    const conversationB = companion.createConversation()
    const conversationC = companion.createConversation()
    const messageA = space.conversations.appendMessage(conversationA.id, 'user', '你说话太长了，请简短一点。', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1').messages[0]!
    const messageB = space.conversations.appendMessage(conversationB.id, 'user', '你说话太长了，请简短一点。', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2').messages[0]!
    const messageC = space.conversations.appendMessage(conversationC.id, 'user', '请简短一点。', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3').messages[0]!

    // One candidate supported by two independent conversations.
    feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationA.id, messageId: messageA.id, claim: '请简短一点。', confidence: 70, sensitivity: 'normal' })
    feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationB.id, messageId: messageB.id, claim: '请简短一点。', confidence: 70, sensitivity: 'normal' })
    // An unrelated candidate in a third conversation that must stay untouched.
    feedback.record({ kind: 'boundary', source: 'user_explicit', conversationId: conversationC.id, messageId: messageC.id, claim: '不要叫我宝贝。', confidence: 70, sensitivity: 'normal' })

    const allergy = memories.create('用户对花生过敏。', 'sensitive')
    const city = memories.create('用户住在杭州。', 'personal')
    database.connection.prepare(`
      INSERT INTO memory_suggestions(id, conversation_id, source_message_id, claim, sensitivity, status, provider_model, evidence_hash, created_at, reviewed_at, accepted_memory_id, accepted_content)
      VALUES (?, ?, ?, ?, 'sensitive', 'accepted', 'test', ?, ?, ?, ?, ?)
    `).run('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', conversationA.id, messageA.id, '用户对花生过敏。', 'c'.repeat(64), clock(), clock(), allergy.id, '用户对花生过敏。')

    const tone = feedback.list().find((candidate) => candidate.kind === 'tone')!
    const boundary = feedback.list().find((candidate) => candidate.kind === 'boundary')!
    expect(tone.status).toBe('supported')
    expect(tone.distinctConversations).toBe(2)
    expect(boundary.status).toBe('pending')

    // 1. backup while everything is still live.
    const backupRoot = join(space.root, 'backups')
    const exported = await space.backup.export(backupRoot)
    expect(exported.status).toBe('created')

    // 2. delete one message; its evidence and its memory must follow.
    const deleted = companion.deleteMessage({ conversationId: conversationA.id, messageId: messageA.id })
    expect(deleted.evidenceWithdrawn).toBeGreaterThan(0)
    expect(deleted.memoriesRetracted).toEqual([allergy.id])

    // 3. verify the live state before restoring.
    const liveEvidence = database.connection.prepare(
      'SELECT conversation_id, status FROM persona_feedback_evidence WHERE candidate_id = ? ORDER BY conversation_id'
    ).all(tone.id) as Array<{ conversation_id: string; status: string }>
    expect(liveEvidence.find((row) => row.conversation_id === conversationA.id)?.status).toBe('withdrawn')
    expect(liveEvidence.find((row) => row.conversation_id === conversationB.id)?.status).toBe('active')
    expect(feedback.get(tone.id)?.status).toBe('pending')
    expect(database.connection.prepare('SELECT status FROM memories WHERE id = ?').get(allergy.id)?.status).toBe('retracted')
    expect(memories.assembleContext('花生', 'sensitive').text).not.toContain('花生')

    // 4. restore the older backup.
    const preview = await space.backup.preview(exported.directory)
    const restored = await space.backup.restore({ token: preview.token, confirmed: true })
    expect(restored.status).toBe('restored')

    // 5. reopen and verify the boundary was replayed.
    const reopened = SqliteDatabase.open(space.databasePath)
    databases.push(reopened)
    try {
      const message = reopened.connection.prepare('SELECT COUNT(*) AS count FROM messages WHERE id = ?').get(messageA.id)
      expect(Number(message?.count)).toBe(0)

      const evidence = reopened.connection.prepare(
        'SELECT conversation_id, status FROM persona_feedback_evidence WHERE candidate_id = ? ORDER BY conversation_id'
      ).all(tone.id) as Array<{ conversation_id: string; status: string }>
      expect(evidence.find((row) => row.conversation_id === conversationA.id)?.status).toBe('withdrawn')
      expect(evidence.find((row) => row.conversation_id === conversationB.id)?.status).toBe('active')

      const toneRow = reopened.connection.prepare('SELECT status, evidence_excerpt FROM persona_feedback_candidates WHERE id = ?').get(tone.id)
      expect(toneRow?.status).toBe('pending')
      expect(Number(reopened.connection.prepare(
        "SELECT COUNT(DISTINCT conversation_id) AS count FROM persona_feedback_evidence WHERE candidate_id = ? AND status = 'active'"
      ).get(tone.id)?.count)).toBe(1)

      // The unrelated candidate keeps its live evidence.
      const boundaryRow = reopened.connection.prepare('SELECT status FROM persona_feedback_candidates WHERE id = ?').get(boundary.id)
      expect(boundaryRow?.status).toBe('pending')
      expect(Number(reopened.connection.prepare(
        "SELECT COUNT(*) AS count FROM persona_feedback_evidence WHERE candidate_id = ? AND status = 'active'"
      ).get(boundary.id)?.count)).toBe(1)

      // The memory from the deleted message stays retracted; the unrelated one survives.
      expect(reopened.connection.prepare('SELECT status FROM memories WHERE id = ?').get(allergy.id)?.status).toBe('retracted')
      expect(reopened.connection.prepare('SELECT status FROM memories WHERE id = ?').get(city.id)?.status).toBe('active')

      // 6. the memory block that goes into the provider request reflects the boundary.
      const recoveredMemories = new MemoryService(new SqliteMemoryRepository(reopened), clock)
      expect(recoveredMemories.assembleContext('花生', 'sensitive').text).not.toContain('花生')
      expect(recoveredMemories.assembleContext('杭州', 'personal').text).toContain('杭州')

      const journal = reopened.connection.prepare('SELECT entity, state FROM deletion_journal ORDER BY entity').all() as Array<{ entity: string; state: string }>
      expect(journal.some((row) => row.entity === 'message' && row.state === 'deleted')).toBe(true)
      expect(journal.some((row) => row.entity === 'evidence' && row.state === 'retracted')).toBe(true)
      expect(journal.some((row) => row.entity === 'memory' && row.state === 'retracted')).toBe(true)
    } finally {
      reopened.close()
      databases.pop()
    }
  })

  it('replays the same boundary to the same outcome twice', async () => {
    const space = workspace()
    const { companion, feedback } = space
    const conversationA = companion.createConversation()
    const conversationB = companion.createConversation()
    const messageA = space.conversations.appendMessage(conversationA.id, 'user', '请简短一点。', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4').messages[0]!
    const messageB = space.conversations.appendMessage(conversationB.id, 'user', '请简短一点。', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5').messages[0]!
    feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationA.id, messageId: messageA.id, claim: '请简短一点。', confidence: 70, sensitivity: 'normal' })
    feedback.record({ kind: 'tone', source: 'user_explicit', conversationId: conversationB.id, messageId: messageB.id, claim: '请简短一点。', confidence: 70, sensitivity: 'normal' })
    const tone = feedback.list()[0]!

    const backupRoot = join(space.root, 'backups')
    const exported = await space.backup.export(backupRoot)
    companion.deleteMessage({ conversationId: conversationA.id, messageId: messageA.id })

    const first = await space.backup.restore({ token: (await space.backup.preview(exported.directory)).token, confirmed: true })

    // A restore closes the live handle, so the second attempt runs on a fresh
    // service - which is what a restarted application looks like.
    const reopenedHandle = SqliteDatabase.open(space.databasePath)
    databases.push(reopenedHandle)
    const secondService = new BackupService(reopenedHandle, space.databasePath)
    const second = await secondService.restore({ token: (await secondService.preview(exported.directory)).token, confirmed: true })

    // Same outcome both times: the replay is idempotent in result, not cumulative.
    expect(first.reappliedEvidenceWithdrawals).toBe(second.reappliedEvidenceWithdrawals)
    const reopened = SqliteDatabase.open(space.databasePath)
    databases.push(reopened)
    try {
      expect(Number(reopened.connection.prepare(
        "SELECT COUNT(*) AS count FROM persona_feedback_evidence WHERE candidate_id = ? AND status = 'active'"
      ).get(tone.id)?.count)).toBe(1)
      expect(reopened.connection.prepare('SELECT status FROM persona_feedback_candidates WHERE id = ?').get(tone.id)?.status).toBe('pending')
    } finally {
      reopened.close()
      databases.pop()
    }
  })
})
