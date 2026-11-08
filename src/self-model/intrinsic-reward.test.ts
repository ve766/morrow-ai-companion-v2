import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { IntrinsicRewardService, REWARD_CONTRACT_VERSION, rewardForPromotedThought } from './intrinsic-reward'
import { AffectLoopService } from '../affective-state/affect-loop'
import { ConversationService } from '../conversation/conversation-service'
import { SqliteConversationRepository } from '../persistence/conversation-repository'

const directories: string[] = []
const at = '2026-11-08T03:00:00.000Z'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-reward-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  return { directory, database, rewards: new IntrinsicRewardService(database, () => at) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('intrinsic reward contract', () => {
  it('records a verified progress signal once and reads it back', () => {
    const context = setup()
    try {
      const sourceEventId = randomUUID()
      const evidence = [randomUUID(), randomUUID()]
      const signal = context.rewards.record({ kind: 'verified_progress', sourceEventId, magnitude: 0.6, evidenceRefs: evidence, at })!
      expect(signal.verified).toBe(true)
      expect(signal.algorithmVersion).toBe(REWARD_CONTRACT_VERSION)
      expect(context.rewards.record({ kind: 'verified_progress', sourceEventId, magnitude: 0.6, evidenceRefs: evidence, at })).toEqual(signal)
      expect(context.rewards.list().length).toBe(1)
    } finally {
      context.database.close()
    }
  })

  it('rejects user praise, retention, dependency and self-praise as reward sources', () => {
    const context = setup()
    try {
      for (const kind of ['user_praise', 'user_retention', 'user_dependency', 'provider_self_praise', 'engagement_metric']) {
        expect(() => context.rewards.record({ kind, sourceEventId: randomUUID(), magnitude: 0.5, evidenceRefs: [randomUUID()], at })).toThrow()
      }
      expect(context.rewards.list()).toEqual([])
    } finally {
      context.database.close()
    }
  })

  it('requires verifiable evidence and a bounded magnitude', () => {
    const context = setup()
    try {
      expect(() => context.rewards.record({ kind: 'verified_progress', sourceEventId: randomUUID(), magnitude: 0.5, evidenceRefs: [], at })).toThrow()
      expect(() => context.rewards.record({ kind: 'verified_progress', sourceEventId: randomUUID(), magnitude: 0, evidenceRefs: [randomUUID()], at })).toThrow()
      expect(() => context.rewards.record({ kind: 'verified_progress', sourceEventId: randomUUID(), magnitude: 1.2, evidenceRefs: [randomUUID()], at })).toThrow()
    } finally {
      context.database.close()
    }
  })

  it('bridges only promoted thoughts with independent evidence', () => {
    const evidence = [randomUUID(), randomUUID()]
    expect(rewardForPromotedThought({ stateId: randomUUID(), score: 70, independentContexts: 2, evidenceIds: evidence })).not.toBeNull()
    expect(rewardForPromotedThought({ stateId: randomUUID(), score: 40, independentContexts: 3, evidenceIds: evidence })).toBeNull()
    expect(rewardForPromotedThought({ stateId: randomUUID(), score: 80, independentContexts: 1, evidenceIds: evidence })).toBeNull()
    expect(rewardForPromotedThought({ stateId: randomUUID(), score: 80, independentContexts: 3, evidenceIds: [] })).toBeNull()
  })

  it('bridges a promoted thought review into a verified reward row', () => {
    const context = setup()
    try {
      const affect = new AffectLoopService(context.database, () => at, () => randomUUID())
      const conversations = new ConversationService(new SqliteConversationRepository(context.database), () => at)
      const firstConversation = conversations.create()
      const firstTurn = randomUUID()
      const firstUser = conversations.appendMessage(firstConversation.id, 'user', '蛋白质折叠的动力学问题', firstTurn)
        .messages.find((message) => message.turnId === firstTurn && message.role === 'user')!
      conversations.appendMessage(firstConversation.id, 'assistant', '这是一个尚未解决的问题。', firstTurn)
      const secondConversation = conversations.create()
      const secondTurn = randomUUID()
      const secondUser = conversations.appendMessage(secondConversation.id, 'user', '继续讨论蛋白质折叠。', secondTurn)
        .messages.find((message) => message.turnId === secondTurn && message.role === 'user')!
      const conversationId = firstConversation.id
      const state = {
        id: randomUUID(),
        actor: 'morrow' as const,
        domain: 'interest' as const,
        proposition: '蛋白质折叠的动力学问题',
        stance: 'uncertain' as const,
        evidenceRefs: [
          { turnId: firstTurn, conversationId, messageId: firstUser.id, occurredAt: at, kind: 'turn' as const, ref: 'one' },
          { turnId: secondTurn, conversationId: secondConversation.id, messageId: secondUser.id, occurredAt: at, kind: 'turn' as const, ref: 'two' }
        ],
        counterEvidenceRefs: [],
        independentContexts: 2,
        score: 70,
        status: 'active' as const,
        revision: 2,
        supersedes: null,
        rationale: 'test',
        algorithmVersion: 'inner-cognition-v1',
        createdAt: at,
        updatedAt: at
      }
      const rewards = affect.observeThoughtReviews([state])
      expect(rewards.length).toBe(1)
      expect(rewards[0]!.kind).toBe('verified_progress')
      expect(context.rewards.list().length).toBe(1)
    } finally {
      context.database.close()
    }
  })

  it('clears the reward ledger without touching anything else', () => {
    const context = setup()
    try {
      context.rewards.record({ kind: 'exploration_finding', sourceEventId: randomUUID(), magnitude: 0.4, evidenceRefs: [randomUUID()], at })
      expect(context.rewards.clearAll()).toBe(1)
      expect(context.rewards.list()).toEqual([])
    } finally {
      context.database.close()
    }
  })
})
