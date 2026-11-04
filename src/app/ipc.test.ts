import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AppInfo, GoalCreateRequest } from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import { GOAL_DEFAULT_CONSTRAINTS, GOAL_SUCCESS_CRITERION, SUPPORTED_GOAL_INTENT } from '../motivation/goals'
import { GoalService } from '../motivation/goal-service'
import { PendingSchemaUnavailableError } from '../cognition/pending-items'
import { createIpcHandlers, type CompanionActions, type CompanionGoalActions, type ContinuityActions, type IpcEventLike, type IpcHandler } from './ipc'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteGoalRepository } from '../persistence/goal-repository'
import { SqliteReminderRepository } from '../persistence/reminder-repository'
import { ReminderService } from '../motivation/reminder-service'
import { ApplicationError } from '../shared/errors'
import type { GoalRecord, TaskRecord } from '../motivation/goals'
import { SqliteMemoryRepository } from '../persistence/memory-repository'

const trustedUrl = 'file:///opt/morrow/out/renderer/index.html'
const appInfo: AppInfo = {
  name: 'Morrow',
  version: '0.0.0',
  platform: 'win32',
  electronVersion: '44.9.0',
  dataPolicy: 'local-first-consented-deepseek-egress-memory-goals-reminders'
}

const validGoal: GoalCreateRequest = {
  intent: SUPPORTED_GOAL_INTENT,
  successCriterion: GOAL_SUCCESS_CRITERION,
  constraints: GOAL_DEFAULT_CONSTRAINTS,
  acceptedBoundary: true
}

function createHarness(
  service?: MemoryService,
  provider: { getAppInfo(): AppInfo } = { getAppInfo: () => appInfo },
  companion?: CompanionActions,
  continuity?: ContinuityActions,
  companionGoals?: CompanionGoalActions
) {
  const database = SqliteDatabase.open(':memory:')
  const memories = service ?? new MemoryService(
    new SqliteMemoryRepository(database),
    () => '2026-10-22T02:00:00.000Z',
    () => randomUUID()
  )
  const goalRepository = new SqliteGoalRepository(database)
  const reminders = new ReminderService(
    new SqliteReminderRepository(database),
    goalRepository,
    { isSupported: () => true, show: () => ({ close: () => undefined }) },
    { featureEnabled: true, timeZone: () => 'Asia/Shanghai', now: () => new Date('2026-10-22T02:00:00.000Z') }
  )
  const goals = new GoalService(goalRepository, memories, { reminderLifecycle: reminders })
  return {
    handlers: createIpcHandlers(provider, trustedUrl, { memories, goals, reminders, ...(companion ? { companion } : {}), ...(continuity ? { continuity } : {}), ...(companionGoals ? { companionGoals } : {}) }),
    reminders,
    close: () => {
      reminders.shutdown()
      database.close()
    }
  }
}

function trustedEvent(): IpcEventLike {
  const frame = { url: trustedUrl }
  return { sender: { mainFrame: frame }, senderFrame: frame }
}

function call(handlers: Record<string, IpcHandler>, channel: string, event: IpcEventLike, payload?: unknown) {
  return handlers[channel]!(event, payload)
}

describe('main-frame IPC authorization and error boundary', () => {
  it('returns runtime info for the trusted main frame', async () => {
    const harness = createHarness()
    try {
      await expect(call(harness.handlers, IPC_CHANNELS.appInfo, trustedEvent())).resolves.toEqual({ ok: true, data: appInfo })
    } finally {
      harness.close()
    }
  })

  it('requires explicit reminder consent, schedules only active goals, and pauses immediately', async () => {
    const harness = createHarness()
    try {
      const initial = await call(harness.handlers, IPC_CHANNELS.remindersSnapshot, trustedEvent())
      expect(initial).toMatchObject({ ok: true, data: { featureEnabled: true, settings: { enabled: false, consentStatus: 'never' } } })
      const rejectedSettings = await call(harness.handlers, IPC_CHANNELS.remindersSaveSettings, trustedEvent(), {
        enabled: true,
        goalReviewEnabled: true,
        acceptConsent: true,
        maxPer24Hours: 3,
        cooldownMinutes: 120,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        timeZone: 'Asia/Shanghai',
        toolId: 'shell'
      })
      expect(rejectedSettings).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })

      const goalResult = await call(harness.handlers, IPC_CHANNELS.goalsCreate, trustedEvent(), validGoal)
      if (!goalResult.ok) throw new Error('Reminder goal fixture failed.')
      const goal = goalResult.data as GoalRecord
      const enabled = await call(harness.handlers, IPC_CHANNELS.remindersSaveSettings, trustedEvent(), {
        enabled: true,
        goalReviewEnabled: true,
        acceptConsent: true,
        maxPer24Hours: 3,
        cooldownMinutes: 120,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        timeZone: 'Asia/Shanghai'
      })
      expect(enabled).toMatchObject({ ok: true, data: { settings: { enabled: true, consentStatus: 'active' } } })

      const scheduled = await call(harness.handlers, IPC_CHANNELS.remindersSchedule, trustedEvent(), {
        goalId: goal.id,
        localDateTime: '2026-10-22T15:00'
      })
      expect(scheduled).toMatchObject({ ok: true, data: { status: 'scheduled', goalId: goal.id } })
      const paused = await call(harness.handlers, IPC_CHANNELS.remindersPause, trustedEvent())
      expect(paused).toMatchObject({ ok: true, data: { settings: { enabled: false }, reminders: [{ status: 'cancelled', lastReason: 'paused' }] } })

      const withdrawn = await call(harness.handlers, IPC_CHANNELS.remindersWithdrawConsent, trustedEvent())
      expect(withdrawn).toMatchObject({ ok: true, data: { settings: { consentStatus: 'withdrawn', enabled: false } } })
    } finally {
      harness.close()
    }
  })

  it('rejects untrusted URLs before inspecting attacker-controlled payloads', async () => {
    const harness = createHarness()
    try {
      const frame = { url: 'https://attacker.invalid/' }
      const result = await call(harness.handlers, IPC_CHANNELS.memoryCreate, {
        sender: { mainFrame: frame },
        senderFrame: frame
      }, { content: 'private words', extra: 'private key' })
      expect(result).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: '此请求不被允许。' } })
      expect(JSON.stringify(result)).not.toContain('private')
    } finally {
      harness.close()
    }
  })

  it('rejects subframe requests even when their URL is trusted', async () => {
    const harness = createHarness()
    try {
      const mainFrame = { url: trustedUrl }
      const childFrame = { url: trustedUrl }
      const result = await call(harness.handlers, IPC_CHANNELS.memoryList, {
        sender: { mainFrame },
        senderFrame: childFrame
      }, {})
      expect(result).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: '此请求不被允许。' } })
    } finally {
      harness.close()
    }
  })

  it('authorizes and strictly validates cognitive settings before changing persisted state', async () => {
    const writes: boolean[] = []
    const settings = { enabled: true, available: true, updatedAt: '2026-10-24T00:00:00.000Z', analyzerVersion: 'rules-v2' }
    const companion = {
      getCognitiveSettings: () => ({ ...settings, enabled: false, updatedAt: null }),
      saveCognitiveSettings: (request: { enabled: boolean }) => {
        writes.push(request.enabled)
        return { ...settings, enabled: request.enabled }
      }
    } as unknown as CompanionActions
    const harness = createHarness(undefined, undefined, companion)
    try {
      const frame = { url: 'https://attacker.invalid/' }
      const untrusted = await call(harness.handlers, IPC_CHANNELS.cognitiveSettingsSave, {
        sender: { mainFrame: frame },
        senderFrame: frame
      }, { enabled: true })
      const invalidType = await call(harness.handlers, IPC_CHANNELS.cognitiveSettingsSave, trustedEvent(), { enabled: 'true' })
      const extraField = await call(harness.handlers, IPC_CHANNELS.cognitiveSettingsSave, trustedEvent(), { enabled: true, override: true })
      expect(untrusted).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
      expect(invalidType).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      expect(extraField).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      expect(writes).toEqual([])
      await expect(call(harness.handlers, IPC_CHANNELS.cognitiveSettingsSave, trustedEvent(), { enabled: true }))
        .resolves.toEqual({ ok: true, data: settings })
      expect(writes).toEqual([true])
    } finally {
      harness.close()
    }
  })

  it('rejects malformed, unknown-field and invalid-ID requests without echoing memory text', async () => {
    const harness = createHarness()
    try {
      const badCreate = await call(harness.handlers, IPC_CHANNELS.memoryCreate, trustedEvent(), {
        content: 'never echo this body', unexpected: 'never echo this either'
      })
      const badHistory = await call(harness.handlers, IPC_CHANNELS.memoryHistory, trustedEvent(), { id: '../private.sqlite' })
      const badSearch = await call(harness.handlers, IPC_CHANNELS.memorySearch, trustedEvent(), ['not an object'])
      const badGoal = await call(harness.handlers, IPC_CHANNELS.goalsCreate, trustedEvent(), {
        ...validGoal,
        acceptedBoundary: false,
        toolId: 'shell'
      })
      expect(badCreate).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      expect(badHistory).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      expect(badSearch).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      expect(badGoal).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      expect(JSON.stringify([badCreate, badHistory, badSearch, badGoal])).not.toContain('never echo')
      expect(JSON.stringify([badCreate, badHistory, badSearch, badGoal])).not.toContain('private.sqlite')
    } finally {
      harness.close()
    }
  })

  it('routes goal creation and planning only through the fixed typed service', async () => {
    const harness = createHarness()
    try {
      const createdResult = await call(harness.handlers, IPC_CHANNELS.goalsCreate, trustedEvent(), validGoal)
      expect(createdResult).toMatchObject({ ok: true, data: { intent: SUPPORTED_GOAL_INTENT, sourceCategory: 'user_explicit_input', status: 'active' } })
      if (!createdResult.ok) throw new Error('Goal IPC fixture failed.')
      const created = createdResult.data as GoalRecord
      const preparedResult = await call(harness.handlers, IPC_CHANNELS.goalsPrepare, trustedEvent(), {
        goalId: created.id,
        acknowledgeUnknown: false
      })
      expect(preparedResult).toMatchObject({
        ok: true,
        data: { status: 'queued', action: { toolId: 'memory.count_active', risk: 'read-only', parametersHash: expect.stringMatching(/^[0-9a-f]{64}$/u) } }
      })
      if (!preparedResult.ok) throw new Error('Plan IPC fixture failed.')
      const prepared = preparedResult.data as TaskRecord
      const challenge = await call(harness.handlers, IPC_CHANNELS.goalsRequestApproval, trustedEvent(), { taskId: prepared.id })
      expect(challenge).toMatchObject({ ok: true, data: { toolId: 'memory.count_active', resourceScope: 'memory.active_count', singleUse: true } })
      const listed = await call(harness.handlers, IPC_CHANNELS.goalsList, trustedEvent(), undefined)
      expect(listed).toMatchObject({ ok: true, data: [{ goal: { id: created.id }, tasks: [{ status: 'awaiting_approval' }] }] })
    } finally {
      harness.close()
    }
  })

  it('rejects untrusted and subframe goal actions before they create any state', async () => {
    const harness = createHarness()
    try {
      const mainFrame = { url: trustedUrl }
      const childFrame = { url: trustedUrl }
      const subframeResult = await call(harness.handlers, IPC_CHANNELS.goalsCreate, {
        sender: { mainFrame },
        senderFrame: childFrame
      }, validGoal)
      const externalFrame = { url: 'https://attacker.invalid/' }
      const externalResult = await call(harness.handlers, IPC_CHANNELS.goalsCreate, {
        sender: { mainFrame: externalFrame },
        senderFrame: externalFrame
      }, validGoal)
      expect(subframeResult).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
      expect(externalResult).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
      const listed = await call(harness.handlers, IPC_CHANNELS.goalsList, trustedEvent())
      expect(listed).toEqual({ ok: true, data: [] })
    } finally {
      harness.close()
    }
  })

  it('routes valid memory requests through the typed application service', async () => {
    const harness = createHarness()
    try {
      const created = await call(harness.handlers, IPC_CHANNELS.memoryCreate, trustedEvent(), { content: 'A memory I typed deliberately.' })
      expect(created).toMatchObject({
        ok: true,
        data: { currentText: 'A memory I typed deliberately.', sourceCategory: 'user_explicit_input', status: 'active', revision: 1 }
      })
      const listed = await call(harness.handlers, IPC_CHANNELS.memoryList, trustedEvent(), undefined)
      expect(listed).toMatchObject({ ok: true, data: [{ currentText: 'A memory I typed deliberately.' }] })
    } finally {
      harness.close()
    }
  })

  it('converts internal errors to a generic response without exposing paths, content, or stack data', async () => {
    const failingService = {
      create() {
        throw new Error('C:\\private\\morrow.sqlite3 secret memory phrase')
      }
    } as unknown as MemoryService
    const harness = createHarness(failingService)
    try {
      const result = await call(harness.handlers, IPC_CHANNELS.memoryCreate, trustedEvent(), { content: 'not logged' })
      expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: '请求无法完成。' } })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('private')
      expect(serialized).not.toContain('secret memory')
      expect(serialized).not.toContain('Error')
    } finally {
      harness.close()
    }
  })

  it('surfaces a distinct generic credential-corruption error without leaking local paths or ciphertext', async () => {
    const companion = {
      getProvider() {
        throw new ApplicationError('PROVIDER_CREDENTIAL_STORE_ERROR')
      }
    } as unknown as CompanionActions
    const harness = createHarness(undefined, undefined, companion)
    try {
      const result = await call(harness.handlers, IPC_CHANNELS.providerGet, trustedEvent())
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'PROVIDER_CREDENTIAL_STORE_ERROR',
          message: '本机 API 凭据无法安全读取，可能已损坏或无权访问。聊天和替换密钥已阻止；请重启应用复查，仍无法读取时可在确认后删除本机密钥并重新设置。'
        }
      })
      expect(JSON.stringify(result)).not.toContain('/home/')
      expect(JSON.stringify(result)).not.toContain('ciphertext')
      expect(JSON.stringify(result)).not.toContain('private key')
    } finally {
      harness.close()
    }
  })

  it('requires explicit opt-in and validates reminder schedules in the trusted main frame', async () => {
    const harness = createHarness()
    try {
      const initial = await call(harness.handlers, IPC_CHANNELS.remindersSnapshot, trustedEvent())
      expect(initial).toMatchObject({ ok: true, data: { featureEnabled: true, settings: { enabled: false, consentStatus: 'never' } } })

      const preferences = {
        enabled: true,
        goalReviewEnabled: true,
        acceptConsent: false,
        maxPer24Hours: 3,
        cooldownMinutes: 120,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        timeZone: 'Asia/Shanghai'
      }
      const refused = await call(harness.handlers, IPC_CHANNELS.remindersSaveSettings, trustedEvent(), preferences)
      expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      const accepted = await call(harness.handlers, IPC_CHANNELS.remindersSaveSettings, trustedEvent(), {
        ...preferences,
        acceptConsent: true
      })
      expect(accepted).toMatchObject({ ok: true, data: { settings: { enabled: true, consentStatus: 'active' } } })

      const goalResult = await call(harness.handlers, IPC_CHANNELS.goalsCreate, trustedEvent(), validGoal)
      if (!goalResult.ok) throw new Error('Goal IPC fixture failed.')
      const goal = goalResult.data as GoalRecord
      const invalid = await call(harness.handlers, IPC_CHANNELS.remindersSchedule, trustedEvent(), {
        goalId: goal.id,
        localDateTime: '2026-02-30T10:30',
        extra: 'not accepted'
      })
      expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })

      const untrusted = { sender: { mainFrame: {} }, senderFrame: { url: 'https://attacker.invalid/' } }
      const denied = await call(harness.handlers, IPC_CHANNELS.remindersSchedule, untrusted, {
        goalId: goal.id,
        localDateTime: '2026-10-22T10:30'
      })
      expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })

      const scheduled = await call(harness.handlers, IPC_CHANNELS.remindersSchedule, trustedEvent(), {
        goalId: goal.id,
        localDateTime: '2026-10-22T10:30'
      })
      expect(scheduled).toMatchObject({ ok: true, data: { goalId: goal.id, status: 'scheduled', scheduledTimeZone: 'Asia/Shanghai' } })
      const paused = await call(harness.handlers, IPC_CHANNELS.remindersPause, trustedEvent())
      expect(paused).toMatchObject({ ok: true, data: { settings: { enabled: false }, reminders: [{ status: 'cancelled' }] } })
    } finally {
      harness.close()
    }
  })

  it('does not expose application-provider exceptions', async () => {
    const failingHarness = createHarness(undefined, {
      getAppInfo() {
        throw new Error('C:\\private\\morrow.sqlite3')
      }
    })
    try {
      const result = await call(failingHarness.handlers, IPC_CHANNELS.appInfo, trustedEvent())
      expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: '请求无法完成。' } })
      expect(JSON.stringify(result)).not.toContain('private')
    } finally {
      failingHarness.close()
    }
  })
})

describe('Phase 2.4 continuity surface', () => {
  function continuityHarness() {
    const completed: string[] = []
    const actions: ContinuityActions = {
      listPendingItems: () => [],
      decidePendingItem: (request) => {
        completed.push(request.itemId)
        return { status: 'decided', decision: request.decision, itemStatus: request.decision === 'accepted' ? 'done' : 'dropped' }
      },
      readTurnContext: () => null
    }
    return { harness: createHarness(undefined, undefined, undefined, actions), completed }
  }

  it('lists open internal items for the trusted main frame', async () => {
    const { harness } = continuityHarness()
    try {
      await expect(call(harness.handlers, IPC_CHANNELS.pendingItemsList, trustedEvent())).resolves.toEqual({ ok: true, data: [] })
    } finally {
      harness.close()
    }
  })

  it('routes accepted and rejected decisions through the single decide action', async () => {
    const { harness, completed } = continuityHarness()
    try {
      const itemId = randomUUID()
      const accepted = await call(harness.handlers, IPC_CHANNELS.pendingItemsDecide, trustedEvent(), { itemId, decision: 'accepted' })
      expect(accepted).toMatchObject({ ok: true, data: { status: 'decided', decision: 'accepted', itemStatus: 'done' } })
      const rejected = await call(harness.handlers, IPC_CHANNELS.pendingItemsDecide, trustedEvent(), { itemId, decision: 'rejected' })
      expect(rejected).toMatchObject({ ok: true, data: { status: 'decided', decision: 'rejected', itemStatus: 'dropped' } })
      expect(completed).toEqual([itemId, itemId])
    } finally {
      harness.close()
    }
  })

  it('rejects an unknown field or a malformed id before calling the action', async () => {
    const { harness, completed } = continuityHarness()
    try {
      const withExtra = await call(harness.handlers, IPC_CHANNELS.pendingItemsDecide, trustedEvent(), { itemId: randomUUID(), decision: 'accepted', status: 'done' })
      expect(withExtra).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      const badId = await call(harness.handlers, IPC_CHANNELS.pendingItemsDecide, trustedEvent(), { itemId: 'not-a-uuid', decision: 'accepted' })
      expect(badId).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      expect(completed).toEqual([])
    } finally {
      harness.close()
    }
  })

  it('maps a schema capability failure to SCHEMA_UPGRADE_REQUIRED', async () => {
    const actions: ContinuityActions = {
      listPendingItems: () => [],
      decidePendingItem: () => { throw new PendingSchemaUnavailableError() },
      readTurnContext: () => null
    }
    const harness = createHarness(undefined, undefined, undefined, actions)
    try {
      const result = await call(harness.handlers, IPC_CHANNELS.pendingItemsDecide, trustedEvent(), { itemId: randomUUID(), decision: 'accepted' })
      expect(result).toMatchObject({ ok: false, error: { code: 'SCHEMA_UPGRADE_REQUIRED' } })
    } finally {
      harness.close()
    }
  })

  it('keeps the removed complete channel unregistered', async () => {
    const { harness } = continuityHarness()
    try {
      expect(harness.handlers['morrow:continuity:pending:complete']).toBeUndefined()
    } finally {
      harness.close()
    }
  })

  it('reads a turn context by id and rejects a malformed one', async () => {
    const { harness } = continuityHarness()
    try {
      await expect(call(harness.handlers, IPC_CHANNELS.turnContextRead, trustedEvent(), { turnId: randomUUID() })).resolves.toEqual({ ok: true, data: null })
      await expect(call(harness.handlers, IPC_CHANNELS.turnContextRead, trustedEvent(), { turnId: '../../etc/passwd' }))
        .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    } finally {
      harness.close()
    }
  })

  it('rejects an untrusted frame before it can decide an item', async () => {
    const { harness, completed } = continuityHarness()
    try {
      const frame = { url: 'https://attacker.invalid/' }
      const result = await call(harness.handlers, IPC_CHANNELS.pendingItemsDecide, { sender: { mainFrame: frame }, senderFrame: frame }, { itemId: randomUUID(), decision: 'accepted' })
      expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
      expect(completed).toEqual([])
    } finally {
      harness.close()
    }
  })

  it('does not register the channels when no continuity actions are wired', () => {
    const harness = createHarness()
    try {
      expect(harness.handlers[IPC_CHANNELS.pendingItemsList]).toBeUndefined()
      expect(harness.handlers[IPC_CHANNELS.turnContextRead]).toBeUndefined()
    } finally {
      harness.close()
    }
  })
})

describe('companion goal candidate IPC', () => {
  const candidate = {
    id: '11111111-1111-4111-8111-111111111111',
    title: '完成 Morrow 的第一阶段',
    conversationId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-11-01T08:00:00.000Z',
    dueAt: null,
    dueExpression: '以后',
    owner: 'user' as const,
    sourceState: 'live'
  }

  it('lists candidates and forwards accept/reject decisions with validation', async () => {
    const calls: string[] = []
    const goal = { id: '33333333-3333-4333-8333-333333333333', title: candidate.title, detail: '', owner: 'user' as const, status: 'active' as const, priority: 50, dueAt: null, sourceMessageId: null, createdAt: candidate.createdAt, updatedAt: candidate.createdAt, revision: 1 }
    const companionGoals: CompanionGoalActions = {
      list: () => [],
      listCandidates: () => [candidate],
      decideCandidate: (candidateId, decision) => {
        calls.push(`${candidateId}:${decision}`)
        if (decision === 'accept') return { status: 'accepted', goal, replayed: false }
        return { status: 'rejected', candidateId, replayed: false }
      }
    }
    const harness = createHarness(undefined, undefined, undefined, undefined, companionGoals)
    try {
      const list = await call(harness.handlers, IPC_CHANNELS.companionGoalCandidatesList, trustedEvent())
      expect(list).toMatchObject({ ok: true, data: [candidate] })
      const accepted = await call(harness.handlers, IPC_CHANNELS.companionGoalCandidateAccept, trustedEvent(), { candidateId: candidate.id })
      expect(accepted).toMatchObject({ ok: true, data: { status: 'accepted' } })
      const rejected = await call(harness.handlers, IPC_CHANNELS.companionGoalCandidateReject, trustedEvent(), { candidateId: candidate.id })
      expect(rejected).toMatchObject({ ok: true, data: { status: 'rejected' } })
      expect(calls).toEqual([`${candidate.id}:accept`, `${candidate.id}:reject`])
      const invalid = await call(harness.handlers, IPC_CHANNELS.companionGoalCandidateAccept, trustedEvent(), { candidateId: 'not-a-uuid' })
      expect(invalid).toMatchObject({ ok: false })
    } finally {
      harness.close()
    }
  })
})
