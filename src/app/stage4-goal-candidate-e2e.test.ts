/**
 * End-to-end goal-candidate path (Issue #42 work package B/E):
 * production message -> goal candidate -> IPC accept/reject -> companion goal
 * table -> IPC list. The service and SQLite are real; no candidate mock.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildStack } from '../../evals/stage-3/runner/harness'
import { createIpcHandlers, type IpcEventLike, type IpcHandler } from './ipc'
import { IPC_CHANNELS } from '../shared/contracts'

const trustedUrl = 'file:///opt/morrow/out/renderer/index.html'

function trustedEvent(): IpcEventLike {
  const frame = { url: trustedUrl }
  return { sender: { mainFrame: frame }, senderFrame: frame }
}

async function handlersFor(stack: ReturnType<typeof buildStack>): Promise<Record<string, IpcHandler>> {
  return createIpcHandlers(
    { getAppInfo: () => ({ name: 'Morrow', version: '0.0.0', platform: 'win32', electronVersion: '44.9.0', dataPolicy: 'local-first-consented-deepseek-egress-memory-goals-reminders' }) },
    trustedUrl,
    {
      memories: stack.memories,
      goals: {} as never,
      reminders: {} as never,
      companionGoals: stack.goals
    } as never
  ) as Record<string, IpcHandler>
}

async function seedCandidate(stack: ReturnType<typeof buildStack>): Promise<{ candidateId: string; conversationId: string }> {
  const conversation = stack.companion.createConversation()
  const messageId = randomUUID()
  stack.database.connection.prepare(
    "INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, 'user', ?, ?, 1, ?)"
  ).run(messageId, conversation.id, '我打算以后多读点书。', new Date().toISOString(), randomUUID())
  const result = stack.goals.detectFromTurn({ conversationId: conversation.id, sourceMessageId: messageId, text: '我打算以后多读点书。' })
  expect(result.candidateId).not.toBeNull()
  return { candidateId: result.candidateId!, conversationId: conversation.id }
}

describe('goal candidate IPC end-to-end', () => {
  it('lists a real candidate, accepts it through IPC, and exposes the goal in the formal list', async () => {
    const stack = buildStack({ growth: true, exploration: true, reflection: true })
    try {
      const { candidateId } = await seedCandidate(stack)
      const handlers = await handlersFor(stack)
      const list = await handlers[IPC_CHANNELS.companionGoalCandidatesList]!(trustedEvent(), undefined)
      expect(list).toMatchObject({ ok: true, data: [expect.objectContaining({ id: candidateId, owner: 'user' })] })

      const accepted = await handlers[IPC_CHANNELS.companionGoalCandidateAccept]!(trustedEvent(), { candidateId })
      expect(accepted).toMatchObject({ ok: true, data: { status: 'accepted' } })

      const row = stack.database.connection.prepare('SELECT status FROM goal_candidates WHERE id = ?').get(candidateId) as { status: string }
      expect(row.status).toBe('accepted')
      const goals = await handlers[IPC_CHANNELS.companionGoalsList]!(trustedEvent(), undefined)
      expect(goals).toMatchObject({ ok: true, data: [expect.objectContaining({ title: expect.stringContaining('多读点书'), owner: 'user', status: 'active' })] })
    } finally {
      stack.close()
    }
  })

  it('rejects through IPC without creating a goal', async () => {
    const stack = buildStack({ growth: true, exploration: true, reflection: true })
    try {
      const { candidateId } = await seedCandidate(stack)
      const handlers = await handlersFor(stack)
      const rejected = await handlers[IPC_CHANNELS.companionGoalCandidateReject]!(trustedEvent(), { candidateId })
      expect(rejected).toMatchObject({ ok: true, data: { status: 'rejected' } })
      const row = stack.database.connection.prepare('SELECT status FROM goal_candidates WHERE id = ?').get(candidateId) as { status: string }
      expect(row.status).toBe('rejected')
      const goals = await handlers[IPC_CHANNELS.companionGoalsList]!(trustedEvent(), undefined)
      expect(goals).toMatchObject({ ok: true, data: [] })
    } finally {
      stack.close()
    }
  })
})
