import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { applyMigrations } from '../persistence/migrations'
import { SqliteSelfModelStateRepository, SelfModelStateService, deriveSelfModelCandidates } from './self-model-state'

function service() {
  const database = SqliteDatabase.open(':memory:')
  applyMigrations(database.connection)
  return {
    database,
    states: new SelfModelStateService(new SqliteSelfModelStateRepository(database), undefined, () => '2026-11-07T10:00:00.000Z', () => randomUUID())
  }
}

describe('structured self-model state', () => {
  it('extracts a user-stated preference as user_explicit, never as Morrow own preference', () => {
    const [candidate] = deriveSelfModelCandidates('我更喜欢安静的工作环境。', [{ kind: 'message', id: randomUUID() }])
    expect(candidate).toMatchObject({ type: 'preference', stance: 'support', origin: 'user_explicit', scope: 'user' })
  })

  it('activates a sufficiently evidenced explicit state and keeps revision history', () => {
    const { database, states } = service()
    try {
      const ref = { kind: 'message' as const, id: randomUUID() }
      const first = states.propose({ ...deriveSelfModelCandidates('我更喜欢安静的工作环境。', [ref])[0]!, evidenceRefs: [ref] })
      expect(first.state.status).toBe('active')
      expect(first.state.origin).toBe('user_explicit')
      expect(first.state.revision).toBe(1)
      const second = states.propose({ ...first.state, evidenceRefs: [ref, { kind: 'message', id: randomUUID() }] })
      expect(second.state.revision).toBe(2)
      expect(second.state.supersedes).toBe(first.state.id)
      expect(states.history('preference', 'user')).toHaveLength(2)
      expect(states.listActive()).toHaveLength(1)
    } finally { database.close() }
  })

  it('keeps a conflicting low-evidence claim pending instead of overwriting the active state', () => {
    const { database, states } = service()
    try {
      const ref = { kind: 'message' as const, id: randomUUID() }
      const active = states.propose({ ...deriveSelfModelCandidates('我更喜欢安静的工作环境。', [ref])[0]!, evidenceRefs: [ref] })
      const conflict = states.propose({ ...deriveSelfModelCandidates('我讨厌安静的工作环境。', [ref])[0]!, evidenceRefs: [ref] })
      expect(conflict.score.decision).toBe('conflict_pending')
      expect(conflict.state.status).toBe('conflict_pending')
      expect(conflict.state.supersedes).toBeNull()
      expect(states.history('preference', 'user')).toHaveLength(2)
    } finally { database.close() }
  })

  it('revises an active state only when strong evidence supports the opposite stance', () => {
    const { database, states } = service()
    try {
      const refs = Array.from({ length: 6 }, () => ({ kind: 'message' as const, id: randomUUID() }))
      const active = states.propose({ ...deriveSelfModelCandidates('我更喜欢安静的工作环境。', refs.slice(0, 1))[0]!, evidenceRefs: refs.slice(0, 1) })
      const revised = states.propose({ ...deriveSelfModelCandidates('我讨厌安静的工作环境。', refs)[0]!, evidenceRefs: refs })
      expect(revised.score.decision).toBe('revise')
      expect(revised.state.status).toBe('active')
      expect(revised.state.supersedes).toBe(active.state.id)
      expect(states.listActive()[0]!.stance).toBe('oppose')
    } finally { database.close() }
  })

  it('rejects an unsupported unknown-origin guess instead of turning it into a state', () => {
    const { database, states } = service()
    try {
      const result = states.propose({ type: 'experience', proposition: 'Morrow remembers visiting a place.', stance: 'neutral', origin: 'unknown', scope: 'morrow', evidenceRefs: [{ kind: 'system', id: randomUUID() }] })
      expect(result.score.decision).toBe('candidate')
      expect(result.state.status).toBe('candidate')
    } finally { database.close() }
  })
})

import { buildCognitiveProjectors, buildSelfModelContextBlock } from '../app/companion-service'

describe('self-model runtime wiring', () => {
  it('places structured states in the model context with origin and revision', () => {
    const state = {
      id: '11111111-1111-4111-8111-111111111111', type: 'preference' as const, proposition: '我更喜欢安静的工作环境。', stance: 'support' as const, confidence: 72, evidenceRefs: [{ kind: 'message' as const, id: '22222222-2222-4222-8222-222222222222' }], origin: 'user_explicit' as const, scope: 'user', revision: 2, supersedes: null, status: 'active' as const, rationale: 'reinforce', sourceMessageId: null, conversationId: null, createdAt: '2026-11-07T10:00:00.000Z', updatedAt: '2026-11-07T10:00:00.000Z'
    }
    const block = buildSelfModelContextBlock({
      events: {} as never, interests: { activeForContext: () => [] } as never, selfModel: { activeStatementsForContext: () => [] } as never, selfModelStates: { listActive: () => [state] } as never
    })
    expect(block).toContain('Structured self-model state')
    expect(block).toContain('user_explicit')
    expect(block).toContain('revision 2')
  })

  it('runs the self_state projector from the real post-turn outbox module', () => {
    const propose = vi.fn()
    const projectors = buildCognitiveProjectors({ events: {} as never, interests: {} as never, selfModel: {} as never, selfModelStates: { propose } as never })
    const projector = projectors.find((entry) => entry.module === 'self_fact')
    expect(projector).toBeTruthy()
    projector!.project({
      turnId: '33333333-3333-4333-8333-333333333333',
      conversationId: '44444444-4444-4444-8444-444444444444',
      userMessageId: '55555555-5555-4555-8555-555555555555',
      occurredAt: '2026-11-07T10:00:00.000Z',
      analysis: null,
      readUserMessage: () => '我更喜欢安静的工作环境。'
    })
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ type: 'preference', origin: 'user_explicit', sourceMessageId: '55555555-5555-4555-8555-555555555555' }))
  })
})
