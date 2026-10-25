import { createHash } from 'node:crypto'
import { REMINDER_RULE_VERSION } from '../motivation/reminders'
import type { ReminderDecisionReason } from '../motivation/reminders'
import {
  decideGoalReviewReminder,
  type ReminderPolicyDecision,
  type ReminderPolicyInput,
  type ReminderPolicySettings
} from '../motivation/reminder-policy'

const inputKeys = [
  'now', 'scheduledAt', 'replayed', 'featureEnabled', 'notificationSupported', 'goalState',
  'shownInLast24Hours', 'lastShownAt', 'settings'
] as const
const settingKeys = [
  'enabled', 'goalReviewEnabled', 'consentStatus', 'consentVersion', 'maxPer24Hours',
  'cooldownMinutes', 'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd', 'timeZone', 'mutedUntil'
] as const
const reasonCodes: readonly ReminderDecisionReason[] = [
  'user_scheduled', 'user_rescheduled', 'triggered_on_time', 'triggered_after_restart',
  'feature_disabled', 'consent_withdrawn', 'paused', 'type_disabled', 'invalid_state',
  'goal_inactive', 'goal_deleted', 'quiet_hours', 'daily_limit', 'cooldown', 'muted',
  'overdue', 'notification_unsupported', 'notification_failed', 'user_cancelled', 'history_cleared'
]
const safetyReasons: readonly ReminderDecisionReason[] = [
  'feature_disabled', 'consent_withdrawn', 'paused', 'type_disabled', 'invalid_state',
  'goal_inactive', 'goal_deleted', 'quiet_hours', 'daily_limit', 'cooldown', 'muted',
  'overdue', 'notification_unsupported'
]

export class ReminderEvaluationError extends Error {
  constructor(readonly code: string) {
    super('Reminder evaluation input is invalid.')
    this.name = 'ReminderEvaluationError'
  }
}

interface ReminderFixtureCase {
  id: string
  overrides: Partial<Omit<ReminderPolicyInput, 'settings'>> & { settings?: Partial<ReminderPolicySettings> }
  expected: ReminderPolicyDecision
}

interface ReminderFixture {
  schemaVersion: 1
  id: string
  version: string
  source: 'synthetic'
  seed: number
  policyVersion: typeof REMINDER_RULE_VERSION
  defaults: ReminderPolicyInput
  cases: ReminderFixtureCase[]
}

export interface ReminderPolicyEvaluationReport {
  dataset: {
    id: string
    version: string
    source: 'synthetic'
    seed: number
    caseCount: number
    policyVersion: string
  }
  candidate: { id: 'bounded-goal-review-policy'; version: string }
  metrics: {
    expectedTriggerCount: number
    predictedTriggerCount: number
    truePositiveCount: number
    falsePositiveCount: number
    falseNegativeCount: number
    precision: number
    recall: number
    safetyLeakCounts: Record<string, number>
  }
  gate: { passed: boolean; failures: string[] }
  candidateActivation: {
    state: 'offline-shadow-only'
    activated: false
    automaticPromotion: false
    featureFlagRequired: true
  }
  determinism: { repeatable: boolean; resultHash: string }
  cases: Array<{
    id: string
    expected: ReminderPolicyDecision
    actual: ReminderPolicyDecision
    passed: boolean
  }>
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactDataKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length !== expected.length || keys.some((key) => typeof key !== 'string' || !expected.includes(key))) return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor?.enumerable && 'value' in descriptor)
  })
}

function parseSettings(value: unknown, allowPartial: boolean): Partial<ReminderPolicySettings> {
  if (!isPlainRecord(value)) throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string' || !settingKeys.includes(key as typeof settingKeys[number]))) {
    throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')
  }
  if (!allowPartial && !hasExactDataKeys(value, settingKeys)) throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return !descriptor?.enumerable || !('value' in descriptor)
  })) throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')

  const settings = value as Record<string, unknown>
  const booleanFields = ['enabled', 'goalReviewEnabled', 'quietHoursEnabled']
  if (booleanFields.some((key) => key in settings && typeof settings[key] !== 'boolean')) {
    throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')
  }
  if ('consentStatus' in settings && !['never', 'active', 'withdrawn'].includes(String(settings.consentStatus))) {
    throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')
  }
  if ('consentVersion' in settings && settings.consentVersion !== null && typeof settings.consentVersion !== 'string') {
    throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')
  }
  for (const key of ['maxPer24Hours', 'cooldownMinutes']) {
    if (key in settings && (typeof settings[key] !== 'number' || !Number.isInteger(settings[key]))) {
      throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')
    }
  }
  for (const key of ['quietHoursStart', 'quietHoursEnd', 'timeZone']) {
    if (key in settings && typeof settings[key] !== 'string') throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')
  }
  if ('mutedUntil' in settings && settings.mutedUntil !== null && typeof settings.mutedUntil !== 'string') {
    throw new ReminderEvaluationError('INVALID_REMINDER_SETTINGS')
  }
  return settings as Partial<ReminderPolicySettings>
}

function parsePolicyInput(value: unknown, allowPartial: boolean): Partial<ReminderPolicyInput> {
  if (!isPlainRecord(value)) throw new ReminderEvaluationError('INVALID_REMINDER_INPUT')
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string' || !inputKeys.includes(key as typeof inputKeys[number]))) {
    throw new ReminderEvaluationError('INVALID_REMINDER_INPUT')
  }
  if (!allowPartial && !hasExactDataKeys(value, inputKeys)) throw new ReminderEvaluationError('INVALID_REMINDER_INPUT')
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return !descriptor?.enumerable || !('value' in descriptor)
  })) throw new ReminderEvaluationError('INVALID_REMINDER_INPUT')

  const input = value as Record<string, unknown>
  for (const key of ['now', 'scheduledAt']) {
    if (key in input && typeof input[key] !== 'string') throw new ReminderEvaluationError('INVALID_REMINDER_INPUT')
  }
  for (const key of ['replayed', 'featureEnabled', 'notificationSupported']) {
    if (key in input && typeof input[key] !== 'boolean') throw new ReminderEvaluationError('INVALID_REMINDER_INPUT')
  }
  if ('goalState' in input && !['active', 'inactive', 'missing'].includes(String(input.goalState))) {
    throw new ReminderEvaluationError('INVALID_REMINDER_INPUT')
  }
  if ('shownInLast24Hours' in input && (typeof input.shownInLast24Hours !== 'number' || !Number.isSafeInteger(input.shownInLast24Hours))) {
    throw new ReminderEvaluationError('INVALID_REMINDER_INPUT')
  }
  if ('lastShownAt' in input && input.lastShownAt !== null && typeof input.lastShownAt !== 'string') {
    throw new ReminderEvaluationError('INVALID_REMINDER_INPUT')
  }
  const settings = 'settings' in input ? parseSettings(input.settings, allowPartial) : undefined
  return { ...input, ...(settings ? { settings } : {}) } as Partial<ReminderPolicyInput>
}

function validateFixture(value: unknown): ReminderFixture {
  const fixtureKeys = ['schemaVersion', 'id', 'version', 'source', 'seed', 'policyVersion', 'defaults', 'cases'] as const
  if (!hasExactDataKeys(value, fixtureKeys)) throw new ReminderEvaluationError('INVALID_REMINDER_DATASET')
  if (value.schemaVersion !== 1 || value.source !== 'synthetic' || value.policyVersion !== REMINDER_RULE_VERSION ||
    typeof value.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.id) ||
    typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(value.version) ||
    typeof value.seed !== 'number' || !Number.isSafeInteger(value.seed) || value.seed < 0 ||
    !Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 100) {
    throw new ReminderEvaluationError('INVALID_REMINDER_DATASET')
  }

  const defaults = parsePolicyInput(value.defaults, false) as ReminderPolicyInput
  if (!Array.isArray(value.cases)) throw new ReminderEvaluationError('INVALID_REMINDER_DATASET')
  const caseIds = new Set<string>()
  const cases = value.cases.map((item) => {
    if (!hasExactDataKeys(item, ['id', 'overrides', 'expected']) || typeof item.id !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.id) || caseIds.has(item.id)) {
      throw new ReminderEvaluationError('INVALID_REMINDER_CASE')
    }
    caseIds.add(item.id)
    const overrides = parsePolicyInput(item.overrides, true)
    const expected = item.expected
    if (!hasExactDataKeys(expected, ['disposition', 'reason']) ||
      !['notify', 'suppress', 'cancel'].includes(String(expected.disposition)) ||
      !reasonCodes.includes(expected.reason as ReminderDecisionReason)) {
      throw new ReminderEvaluationError('INVALID_REMINDER_CASE')
    }
    return { id: item.id, overrides, expected: expected as unknown as ReminderPolicyDecision }
  })

  return {
    schemaVersion: 1,
    id: value.id,
    version: value.version,
    source: 'synthetic',
    seed: value.seed,
    policyVersion: REMINDER_RULE_VERSION,
    defaults,
    cases
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function evaluateCases(fixture: ReminderFixture): ReminderPolicyEvaluationReport['cases'] {
  return fixture.cases.map(({ id, overrides, expected }) => {
    const { settings: settingOverrides, ...inputOverrides } = overrides
    const input = {
      ...fixture.defaults,
      ...inputOverrides,
      settings: { ...fixture.defaults.settings, ...settingOverrides }
    } as ReminderPolicyInput
    const actual = decideGoalReviewReminder(input)
    return { id, expected, actual, passed: actual.disposition === expected.disposition && actual.reason === expected.reason }
  })
}

export function runReminderPolicyEvaluation(value: unknown): ReminderPolicyEvaluationReport {
  const fixture = validateFixture(value)
  const firstCases = evaluateCases(fixture)
  const secondCases = evaluateCases(fixture)
  const repeatable = canonicalJson(firstCases) === canonicalJson(secondCases)
  const truePositiveCount = firstCases.filter((item) => item.expected.disposition === 'notify' && item.actual.disposition === 'notify').length
  const falsePositiveCount = firstCases.filter((item) => item.expected.disposition !== 'notify' && item.actual.disposition === 'notify').length
  const falseNegativeCount = firstCases.filter((item) => item.expected.disposition === 'notify' && item.actual.disposition !== 'notify').length
  const expectedTriggerCount = firstCases.filter((item) => item.expected.disposition === 'notify').length
  const predictedTriggerCount = firstCases.filter((item) => item.actual.disposition === 'notify').length
  const safetyLeakCounts = Object.fromEntries(safetyReasons.map((reason) => [
    reason,
    firstCases.filter((item) => item.expected.reason === reason && item.actual.disposition === 'notify').length
  ]))
  const mismatches = firstCases.filter((item) => !item.passed).map((item) => item.id)
  const safetyLeaks = Object.values(safetyLeakCounts).reduce((total, count) => total + count, 0)
  const resultHash = createHash('sha256').update(canonicalJson({
    dataset: { id: fixture.id, version: fixture.version, seed: fixture.seed, policyVersion: fixture.policyVersion },
    fixture,
    cases: firstCases
  })).digest('hex')
  const failures = [
    ...(!repeatable ? ['non_repeatable'] : []),
    ...(!fixture.cases.every((item) => item.expected.disposition === 'notify' || item.expected.disposition === 'suppress' || item.expected.disposition === 'cancel') ? ['invalid_expected_decision'] : []),
    ...(!mismatches.length ? [] : [`case_mismatch:${mismatches.join(',')}`]),
    ...(falsePositiveCount === 0 ? [] : ['unauthorized_notification']),
    ...(falseNegativeCount === 0 ? [] : ['missed_expected_notification']),
    ...(safetyLeaks === 0 ? [] : ['safety_leak'])
  ]
  return {
    dataset: {
      id: fixture.id,
      version: fixture.version,
      source: 'synthetic',
      seed: fixture.seed,
      caseCount: fixture.cases.length,
      policyVersion: fixture.policyVersion
    },
    candidate: { id: 'bounded-goal-review-policy', version: REMINDER_RULE_VERSION },
    metrics: {
      expectedTriggerCount,
      predictedTriggerCount,
      truePositiveCount,
      falsePositiveCount,
      falseNegativeCount,
      precision: predictedTriggerCount === 0 ? 0 : truePositiveCount / predictedTriggerCount,
      recall: expectedTriggerCount === 0 ? 0 : truePositiveCount / expectedTriggerCount,
      safetyLeakCounts
    },
    gate: { passed: failures.length === 0, failures },
    candidateActivation: {
      state: 'offline-shadow-only',
      activated: false,
      automaticPromotion: false,
      featureFlagRequired: true
    },
    determinism: { repeatable, resultHash },
    cases: firstCases
  }
}
