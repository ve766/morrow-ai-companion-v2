/**
 * Production reflection chain (Issue #42 work package C/E):
 * knowledge-gap event -> reflection producer -> open_question finding ->
 * router -> linked pending item -> decision -> route terminal state + audit.
 * Uses the real buildStack assembly and real SQLite, not a hand-built finding.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildStack } from '../../evals/stage-3/runner/harness'
import { EventLogService } from '../persistence/event-log'
import { KnowledgeGapService } from '../self-model/knowledge-gap-service'
import { ReflectionFindingRouter } from '../cognition/reflection-routing'
import { PendingCognitionService } from '../cognition/pending-items'
import { SqlitePendingItemRepository } from '../persistence/cognitive-context-repository'

describe('production reflection producer chain', () => {
  it('turns a single-conversation grounding gap into a linked open_question pending item', () => {
    const stack = buildStack({ growth: true, exploration: true, reflection: true })
    try {
      const conversation = stack.companion.createConversation()
      const events = new EventLogService(stack.database)
      const turnId = randomUUID()
      const label = '量子计算'
      const recorded = events.recordDeterministic(`test-gap:${turnId}`, {
        sourceModule: 'cognition',
        eventType: 'cognition.knowledge_gap',
        actor: 'system',
        subjectType: 'interest',
        subjectId: label,
        correlationId: conversation.id,
        payload: { label, owner: 'morrow', turnId }
      })
      new KnowledgeGapService(stack.database).record({
        eventId: recorded.event.id,
        conversationId: conversation.id,
        turnId,
        label,
        confidence: 0.6,
        occurredAt: new Date().toISOString()
      })

      const run = stack.reflection.run('manual')
      expect('skipped' in run).toBe(false)
      if ('skipped' in run) throw new Error('reflection was rate limited')
      const findings = stack.reflection.findings(run.id)
      const openQuestion = findings.find((finding) => finding.kind === 'open_question')
      expect(openQuestion).toBeDefined()
      if (!openQuestion) throw new Error('open_question missing')

      const pending = new PendingCognitionService(new SqlitePendingItemRepository(stack.database, events))
      const router = new ReflectionFindingRouter({ database: stack.database, pending, events })
      router.ingestRun(run.id, findings)
      const item = pending.listOpen().find((entry) => entry.findingId === openQuestion.id)
      expect(item).toBeDefined()
      const route = stack.database.connection.prepare(
        'SELECT route, status FROM reflection_finding_routes WHERE finding_id = ?'
      ).get(openQuestion.id) as { route: string; status: string }
      expect(route).toMatchObject({ route: 'pending_user', status: 'routed' })

      expect(pending.decide(item!.id, 'accepted')).toMatchObject({ status: 'decided', itemStatus: 'done' })
      const decidedRoute = stack.database.connection.prepare(
        'SELECT status FROM reflection_finding_routes WHERE finding_id = ?'
      ).get(openQuestion.id) as { status: string }
      expect(decidedRoute.status).toBe('consumed')
      const audit = stack.database.connection.prepare(
        "SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'pending.decision'"
      ).get() as { n: number }
      expect(audit.n).toBe(1)
    } finally {
      stack.close()
    }
  })
  it('the startup trigger feeds the same producer and ingestion path', () => {
    const stack = buildStack({ growth: true, exploration: true, reflection: true })
    try {
      const conversation = stack.companion.createConversation()
      const events = new EventLogService(stack.database)
      const turnId = randomUUID()
      const label = '分布式共识'
      const recorded = events.recordDeterministic(`test-startup-gap:${turnId}`, {
        sourceModule: 'cognition',
        eventType: 'cognition.knowledge_gap',
        actor: 'system',
        subjectType: 'interest',
        subjectId: label,
        correlationId: conversation.id,
        payload: { label, owner: 'morrow', turnId }
      })
      new KnowledgeGapService(stack.database).record({
        eventId: recorded.event.id,
        conversationId: conversation.id,
        turnId,
        label,
        confidence: 0.6,
        occurredAt: new Date().toISOString()
      })
      const run = stack.reflection.run('startup')
      expect('skipped' in run).toBe(false)
      if ('skipped' in run) throw new Error('reflection was rate limited')
      const findings = stack.reflection.findings(run.id)
      expect(findings.some((finding) => finding.kind === 'open_question')).toBe(true)
      const pending = new PendingCognitionService(new SqlitePendingItemRepository(stack.database, events))
      const router = new ReflectionFindingRouter({ database: stack.database, pending, events })
      router.ingestRun(run.id, findings)
      expect(pending.listOpen().some((item) => item.kind === 'open_question')).toBe(true)
    } finally {
      stack.close()
    }
  })

})
