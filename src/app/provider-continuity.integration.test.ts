/**
 * Provider switching must not touch Morrow's own state. The test uses the real
 * stack, a real SQLite file, a real chat turn and two custom profiles, closes
 * and reopens the database between A and B, then switches back to A.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTestStack, type Stack } from '../../tests/helpers/companion-stack'

let directory = ''
afterEach(() => {
  if (directory) {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
    directory = ''
  }
})

function snapshot(stack: Stack, conversationId: string) {
  return {
    personality: stack.companion.getPersonality(),
    memories: stack.memories.list().map((memory) => ({ id: memory.id, revision: memory.revision, content: memory.currentText, status: memory.status })),
    goals: stack.goals.list().map((goal) => ({ id: goal.id, title: goal.title, owner: goal.owner })),
    messages: stack.companion.readConversation({ conversationId }).messages.map((message) => ({ id: message.id, role: message.role }))
  }
}

async function send(stack: Stack, conversationId: string, content: string): Promise<void> {
  await stack.companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
}

describe('provider switching keeps Morrow state', () => {
  it('does not reset personality, memory, goals or history across A → reopen → B → A', async () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-provider-continuity-'))
    const path = join(directory, 'morrow.sqlite3')
    let stack = buildTestStack({ databasePath: path, keepDatabase: true })
    const conversation = stack.companion.createConversation()
    let baseline
    let conversationId = conversation.id
    try {
      stack.companion.savePersonality({ warmth: 61, directness: 54, humor: 17, disagreementStyle: 'balanced', systemRules: '保持简洁。' })
      stack.memories.create('我在学习咖啡拉花。', 'personal')
      stack.goals.create({ title: '完成 Morrow 的第一阶段', owner: 'user' })
      await send(stack, conversation.id, '你好，先打个招呼。')

      const profileA = stack.companion.saveProfile({
        displayName: 'Provider A',
        sourceKind: 'custom-proxy',
        protocolId: 'openai-chat-completions',
        endpoint: 'https://provider-a.example.com/v1',
        model: 'model-a',
        enabled: true,
        isDefault: true,
        apiKey: 'test-key-a'
      })
      baseline = snapshot(stack, conversation.id)
      expect(profileA.isDefault).toBe(true)
    } finally {
      stack.close()
    }

    stack = buildTestStack({ databasePath: path, keepDatabase: true })
    try {
      expect(snapshot(stack, conversationId)).toEqual(baseline)
      const existingA = stack.companion.listProfiles().find((item) => item.displayName === 'Provider A')!
      stack.companion.saveProfile({
        profileId: existingA.id,
        displayName: existingA.displayName!,
        sourceKind: 'custom-proxy',
        protocolId: 'openai-chat-completions',
        endpoint: existingA.endpoint,
        model: existingA.model,
        enabled: true,
        isDefault: true,
        apiKey: 'test-key-a'
      })
      const profileB = stack.companion.saveProfile({
        displayName: 'Provider B',
        sourceKind: 'custom-proxy',
        protocolId: 'openai-chat-completions',
        endpoint: 'https://provider-b.example.com',
        model: 'model-b',
        enabled: true,
        isDefault: true,
        apiKey: 'test-key-a'
      })
      expect(profileB.isDefault).toBe(true)
      await send(stack, conversationId, '切换后继续。')
      const afterB = snapshot(stack, conversationId)
      expect(afterB.personality).toEqual(baseline.personality)
      expect(afterB.memories).toEqual(baseline.memories)
      expect(afterB.goals).toEqual(baseline.goals)
      expect(afterB.messages.slice(0, baseline.messages.length)).toEqual(baseline.messages)

      const profiles = stack.companion.listProfiles()
      const a = profiles.find((item) => item.displayName === 'Provider A')!
      stack.companion.saveProfile({
        profileId: a.id,
        displayName: a.displayName!,
        sourceKind: 'custom-proxy',
        protocolId: 'openai-chat-completions',
        endpoint: a.endpoint,
        model: a.model,
        enabled: true,
        isDefault: true,
        apiKey: 'test-key-a'
      })
      await send(stack, conversationId, '切回 A。')
      const afterA = snapshot(stack, conversationId)
      expect(afterA.personality).toEqual(baseline.personality)
      expect(afterA.memories).toEqual(baseline.memories)
      expect(afterA.goals).toEqual(baseline.goals)
      expect(afterA.messages.slice(0, baseline.messages.length)).toEqual(baseline.messages)
      expect(afterA.messages.length).toBeGreaterThan(baseline.messages.length)
    } finally {
      stack.close()
    }
  })
})
