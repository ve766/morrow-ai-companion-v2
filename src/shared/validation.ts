import { isLoopbackEndpoint, isValidLocalModelName } from '../security/url-gate'
import type { ProviderConfigInput, ProviderId } from './companion'
import { validateMemorySearchQuery, validateMemoryText } from '../memory/memory-domain'
import { GOAL_DEFAULT_CONSTRAINTS, GOAL_SUCCESS_CRITERION, SUPPORTED_GOAL_INTENT, validateGoalText } from '../motivation/goals'
import type { ReminderIdRequest, ReminderRescheduleRequest, ReminderScheduleRequest, ReminderSettingsRequest } from '../motivation/reminders'
import { isValidClockTime, isValidTimeZone, REMINDER_MAX_COOLDOWN_MINUTES, REMINDER_MAX_PER_24_HOURS, REMINDER_MIN_COOLDOWN_MINUTES } from '../motivation/reminders'

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputValidationError'
  }
}

export type InputObject = Record<string, unknown>

export function parseObject(value: unknown, allowedKeys: readonly string[], field = 'Request'): InputObject {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError(`${field} must be an object.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new InputValidationError(`${field} must be a plain object.`)
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string')) throw new InputValidationError(`${field} contains an unsupported field.`)
  const object = value as Record<string, unknown>
  for (const key of Object.getOwnPropertyNames(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (!allowedKeys.includes(key) || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new InputValidationError(`${field} contains an unsupported field.`)
    }
  }
  return object
}

export function parseEmptyObject(value: unknown): void {
  if (value === undefined) return
  parseObject(value, [], 'Request')
}

function parseText(value: unknown, field: string, minLength: number, maxLength: number): string {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    throw new InputValidationError(`${field} must be a string with a valid length.`)
  }
  return value
}

function parseMemoryContent(value: unknown): string {
  const content = parseText(value, 'Memory content', 1, 4000)
  try {
    validateMemoryText(content)
  } catch {
    throw new InputValidationError('Memory content is invalid.')
  }
  return content
}

export function parseIdentifier(value: unknown): string {
  const id = parseText(value, 'Memory id', 36, 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new InputValidationError('Memory id is invalid.')
  }
  return id.toLowerCase()
}

export function parseMemoryCreateRequest(value: unknown): { content: string; sensitivity: 'normal' | 'personal' | 'sensitive' } {
  const input = parseObject(value, ['content', 'sensitivity'], 'Memory request')
  const sensitivity = input.sensitivity ?? 'personal'
  if (sensitivity !== 'normal' && sensitivity !== 'personal' && sensitivity !== 'sensitive') {
    throw new InputValidationError('Memory sensitivity is invalid.')
  }
  return { content: parseMemoryContent(input.content), sensitivity }
}

export function parseSensitivity(value: unknown): 'normal' | 'personal' | 'sensitive' {
  if (value !== 'normal' && value !== 'personal' && value !== 'sensitive') throw new InputValidationError('Sensitivity is invalid.')
  return value
}


export function parseMemorySearchRequest(value: unknown): { query: string } {
  const input = parseObject(value, ['query'], 'Memory search')
  const query = parseText(input.query, 'Search query', 1, 256)
  try {
    validateMemorySearchQuery(query)
  } catch {
    throw new InputValidationError('Search query is invalid.')
  }
  if (query.trim().length === 0 || query.includes('\u0000')) throw new InputValidationError('Search query is invalid.')
  return { query: query.trim() }
}

export function parseMemoryIdRequest(value: unknown): { id: string } {
  const input = parseObject(value, ['id'], 'Memory request')
  return { id: parseIdentifier(input.id) }
}

export function parseMemoryCorrectRequest(value: unknown): { id: string; content: string } {
  const input = parseObject(value, ['id', 'content'], 'Memory correction')
  return { id: parseIdentifier(input.id), content: parseMemoryContent(input.content) }
}

export function parseGoalCreateRequest(value: unknown): { intent: string; successCriterion: typeof GOAL_SUCCESS_CRITERION; constraints: string; acceptedBoundary: true } {
  const input = parseObject(value, ['intent', 'successCriterion', 'constraints', 'acceptedBoundary'], 'Goal request')
  if (input.acceptedBoundary !== true) throw new InputValidationError('Goal boundary acknowledgement is required.')
  const intent = parseText(input.intent, 'Goal intent', 1, 800)
  const rawConstraints = parseText(input.constraints, 'Goal constraints', 0, 2000)
  const constraints = rawConstraints.trim() || GOAL_DEFAULT_CONSTRAINTS
  if (input.successCriterion !== GOAL_SUCCESS_CRITERION) throw new InputValidationError('Goal success criterion is unsupported.')
  try {
    validateGoalText(intent, 800, 'Goal intent')
    validateGoalText(constraints, 2000, 'Goal constraints')
  } catch {
    throw new InputValidationError('Goal request is invalid.')
  }
  if (intent.trim() !== SUPPORTED_GOAL_INTENT || constraints.trim() !== GOAL_DEFAULT_CONSTRAINTS) {
    throw new InputValidationError('Goal request is unsupported.')
  }
  return { intent: intent.trim(), successCriterion: GOAL_SUCCESS_CRITERION, constraints: constraints.trim(), acceptedBoundary: true }
}

export function parseGoalIdRequest(value: unknown): { goalId: string } {
  const input = parseObject(value, ['goalId'], 'Goal request')
  return { goalId: parseIdentifier(input.goalId) }
}
export function parseGoalCandidateIdRequest(value: unknown): { candidateId: string } {
  const input = parseObject(value, ['candidateId'], 'Goal candidate request')
  return { candidateId: parseIdentifier(input.candidateId) }
}


export function parseTaskIdRequest(value: unknown): { taskId: string } {
  const input = parseObject(value, ['taskId'], 'Task request')
  return { taskId: parseIdentifier(input.taskId) }
}

export function parseGoalPrepareRequest(value: unknown): { goalId: string; acknowledgeUnknown: boolean } {
  const input = parseObject(value, ['goalId', 'acknowledgeUnknown'], 'Goal plan request')
  if (typeof input.acknowledgeUnknown !== 'boolean') throw new InputValidationError('Goal plan acknowledgement is invalid.')
  return { goalId: parseIdentifier(input.goalId), acknowledgeUnknown: input.acknowledgeUnknown }
}

export function parseConversationIdRequest(value: unknown): { conversationId: string } {
  const input = parseObject(value, ['conversationId'], 'Conversation request')
  return { conversationId: parseIdentifier(input.conversationId) }
}

export function parseBackupRestoreRequest(value: unknown): { token: string; confirmed: true; acknowledgeMissingDeletionJournal?: true } {
  const input = parseObject(value, ['token', 'confirmed', 'acknowledgeMissingDeletionJournal'], 'Backup restore request')
  if (typeof input.token !== 'string' || !/^[0-9a-f]{32}$/.test(input.token)) throw new InputValidationError('Backup restore token is invalid.')
  if (input.confirmed !== true) throw new InputValidationError('Backup restore requires explicit confirmation.')
  if (input.acknowledgeMissingDeletionJournal !== undefined && input.acknowledgeMissingDeletionJournal !== true) {
    throw new InputValidationError('Backup restore acknowledgement is invalid.')
  }
  return input.acknowledgeMissingDeletionJournal === true
    ? { token: input.token, confirmed: true, acknowledgeMissingDeletionJournal: true }
    : { token: input.token, confirmed: true }
}

export function parseProviderConfigInput(value: unknown): ProviderConfigInput {
  const object = parseObject(value, ['providerId', 'model', 'endpoint', 'enabled', 'apiKey'], 'Provider settings')
  if (object.providerId !== 'deepseek' && object.providerId !== 'local-openai' && object.providerId !== 'spark') {
    throw new InputValidationError('Provider settings are invalid.')
  }
  if (typeof object.enabled !== 'boolean') throw new InputValidationError('Provider settings are invalid.')
  if (object.apiKey !== undefined && (typeof object.apiKey !== 'string' || object.apiKey.length > 10000 || /[\u0000-\u001f\u007f]/u.test(object.apiKey))) {
    throw new InputValidationError('Provider API key is invalid.')
  }
  if (object.providerId === 'deepseek') {
    if (object.endpoint !== undefined) throw new InputValidationError('The DeepSeek endpoint is fixed and cannot be changed.')
    if (object.model !== undefined && object.model !== 'deepseek-flash') throw new InputValidationError('Provider settings are invalid.')
    return {
      providerId: 'deepseek',
      model: 'deepseek-flash',
      enabled: object.enabled,
      ...(object.apiKey === undefined ? {} : { apiKey: object.apiKey })
    }
  }
  if (object.providerId === 'spark') {
    // The endpoint is fixed by the registry; the model id comes from the
    // account's own model list and is validated by shape.
    if (object.endpoint !== undefined) throw new InputValidationError('The Spark endpoint is fixed and cannot be changed.')
    if (typeof object.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(object.model)) {
      throw new InputValidationError('The Spark model id must be 1 to 64 letters, digits, dot, colon, underscore or dash.')
    }
    return {
      providerId: 'spark' as const,
      model: object.model,
      enabled: object.enabled,
      ...(object.apiKey === undefined ? {} : { apiKey: object.apiKey })
    }
  }
  if (typeof object.endpoint !== 'string' || !isLoopbackEndpoint(object.endpoint)) {
    throw new InputValidationError('The local model endpoint must be an http(s) loopback address, e.g. http://127.0.0.1:1234.')
  }
  if (typeof object.model !== 'string' || !isValidLocalModelName(object.model)) {
    throw new InputValidationError('The local model name must be 1 to 64 characters without control characters.')
  }
  return {
    providerId: 'local-openai' as const,
    endpoint: object.endpoint,
    model: object.model,
    enabled: object.enabled,
    ...(object.apiKey === undefined ? {} : { apiKey: object.apiKey })
  }
}

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/u

function parseProfileId(value: unknown): string {
  if (typeof value !== 'string' || !PROFILE_ID_PATTERN.test(value)) throw new InputValidationError('Provider profile id is invalid.')
  return value
}

export function parseProviderGetRequest(value: unknown): { providerId?: string } {
  if (value === undefined) return {}
  const input = parseObject(value, ['providerId'], 'Provider request')
  if (input.providerId === undefined) return {}
  return { providerId: parseProfileId(input.providerId) }
}

export function parseProviderConnectionRequest(value: unknown): { providerId: string } {
  const input = parseObject(value, ['providerId'], 'Provider connection test')
  return { providerId: parseProfileId(input.providerId) }
}

export function parseProviderProfileIdRequest(value: unknown): { profileId: string } {
  const input = parseObject(value, ['profileId'], 'Provider profile request')
  return { profileId: parseProfileId(input.profileId) }
}

export function parseProviderModelsRequest(value: unknown): { profileId: string } {
  const input = parseObject(value, ['profileId'], 'Provider model discovery')
  return { profileId: parseProfileId(input.profileId) }
}

export function parseProviderProfileSaveInput(value: unknown): import('../shared/companion').ProviderProfileSaveInput {
  const input = parseObject(value, ['profileId', 'displayName', 'sourceKind', 'protocolId', 'endpoint', 'endpointPath', 'model', 'enabled', 'isDefault', 'apiKey'], 'Provider profile')
  if (input.sourceKind !== 'custom-proxy' && input.sourceKind !== 'local') throw new InputValidationError('Provider source kind is not supported.')
  if (input.protocolId !== 'openai-chat-completions') throw new InputValidationError('Provider protocol is not supported.')
  if (typeof input.displayName !== 'string' || input.displayName.trim().length === 0 || input.displayName.length > 80) throw new InputValidationError('Provider display name is invalid.')
  if (typeof input.endpoint !== 'string' || input.endpoint.length < 8 || input.endpoint.length > 2000) throw new InputValidationError('Provider endpoint is invalid.')
  if (input.endpointPath !== undefined && input.endpointPath !== null && (typeof input.endpointPath !== 'string' || input.endpointPath.length > 300 || !input.endpointPath.startsWith('/') || input.endpointPath.includes('..'))) throw new InputValidationError('Provider endpoint path is invalid.')
  if (typeof input.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.model)) throw new InputValidationError('Provider model is invalid.')
  if (typeof input.enabled !== 'boolean') throw new InputValidationError('Provider enabled flag is invalid.')
  if (input.isDefault !== undefined && typeof input.isDefault !== 'boolean') throw new InputValidationError('Provider default flag is invalid.')
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 10000 || /[ -]/u.test(input.apiKey))) throw new InputValidationError('Provider API key is invalid.')
  return {
    ...(input.profileId === undefined ? {} : { profileId: parseProfileId(input.profileId) }),
    displayName: input.displayName.trim(),
    sourceKind: input.sourceKind,
    protocolId: input.protocolId,
    endpoint: input.endpoint.trim(),
    ...(input.endpointPath === undefined ? {} : { endpointPath: input.endpointPath as string | null }),
    model: input.model.trim(),
    enabled: input.enabled,
    ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey })
  }
}

export function parseInterestIdRequest(value: unknown): { interestId: string } {
  const input = parseObject(value, ['interestId'], 'Interest request')
  return { interestId: parseIdentifier(input.interestId) }
}

export function parseInterestStatusRequest(value: unknown): { interestId: string; status: 'candidate' | 'active' | 'archived' | 'dropped' } {
  const input = parseObject(value, ['interestId', 'status'], 'Interest status request')
  if (!['candidate', 'active', 'archived', 'dropped'].includes(String(input.status))) {
    throw new InputValidationError('Interest status is invalid.')
  }
  return { interestId: parseIdentifier(input.interestId), status: input.status as 'candidate' | 'active' | 'archived' | 'dropped' }
}

export function parseSelfModelListRequest(value: unknown): { kind?: 'fact' | 'inference' | 'unknown' | 'correction' } {
  if (value === undefined) return {}
  const input = parseObject(value, ['kind'], 'Self-model list request')
  if (input.kind === undefined) return {}
  if (!['fact', 'inference', 'unknown', 'correction'].includes(String(input.kind))) {
    throw new InputValidationError('Self-model entry kind is invalid.')
  }
  return { kind: input.kind as 'fact' | 'inference' | 'unknown' | 'correction' }
}

export function parseSelfModelCorrectRequest(value: unknown): { entryId: string; statement: string } {
  const input = parseObject(value, ['entryId', 'statement'], 'Self-model correction request')
  const statement = parseText(input.statement, 'Statement', 1, 4000)
  if (statement.includes(' ') || /[--]/u.test(statement)) {
    throw new InputValidationError('Statement is invalid.')
  }
  return { entryId: parseIdentifier(input.entryId), statement }
}

export function parseSelfModelIdRequest(value: unknown): { entryId: string } {
  const input = parseObject(value, ['entryId'], 'Self-model entry request')
  return { entryId: parseIdentifier(input.entryId) }
}

export function parseReflectionFindingsRequest(value: unknown): { runId: string } {
  const input = parseObject(value, ['runId'], 'Reflection findings request')
  return { runId: parseIdentifier(input.runId) }
}

export function parseTurnContextRequest(value: unknown): { turnId: string } {
  const input = parseObject(value, ['turnId'], 'Turn context request')
  return { turnId: parseIdentifier(input.turnId) }
}

export function parseChatRequest(value: unknown): { conversationId: string; requestId: string; content: string; includeSensitive: boolean } {
  const input = parseObject(value, ['conversationId', 'requestId', 'content', 'includeSensitive'], 'Chat request')
  const content = parseText(input.content, 'Message', 1, 8000)
  if (content.trim().length === 0 || content.includes('\u0000') || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)) {
    throw new InputValidationError('Message content is invalid.')
  }
  if (input.includeSensitive !== undefined && typeof input.includeSensitive !== 'boolean') throw new InputValidationError('Memory sensitivity choice is invalid.')
  return {
    conversationId: parseIdentifier(input.conversationId),
    requestId: parseIdentifier(input.requestId),
    content,
    includeSensitive: input.includeSensitive === true
  }
}

export function parsePersonalityInput(value: unknown): {
  warmth: number
  directness: number
  humor: number
  disagreementStyle: 'gentle' | 'balanced' | 'direct'
  systemRules: string
} {
  const input = parseObject(value, ['warmth', 'directness', 'humor', 'disagreementStyle', 'systemRules'], 'Personality settings')
  for (const key of ['warmth', 'directness', 'humor'] as const) {
    if (!Number.isSafeInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 100) throw new InputValidationError('Personality settings are invalid.')
  }
  if (input.disagreementStyle !== 'gentle' && input.disagreementStyle !== 'balanced' && input.disagreementStyle !== 'direct') {
    throw new InputValidationError('Disagreement style is invalid.')
  }
  const systemRules = parseText(input.systemRules, 'Personal rules', 0, 1500)
  if (systemRules.includes('\u0000') || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(systemRules)) {
    throw new InputValidationError('Personal rules are invalid.')
  }
  return {
    warmth: Number(input.warmth),
    directness: Number(input.directness),
    humor: Number(input.humor),
    disagreementStyle: input.disagreementStyle,
    systemRules
  }
}

export function parsePersonalityRestoreRequest(value: unknown): { version: number } {
  const input = parseObject(value, ['version'], 'Personality revision')
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1) throw new InputValidationError('Personality revision is invalid.')
  return { version: Number(input.version) }
}

export function parseCognitiveSettingsRequest(value: unknown): { enabled: boolean } {
  const input = parseObject(value, ['enabled'], 'Cognitive settings')
  if (typeof input.enabled !== 'boolean') throw new InputValidationError('Cognitive setting is invalid.')
  return { enabled: input.enabled }
}

export function parseMemoryProposalRequest(value: unknown): { conversationId: string; sourceMessageId: string } {
  const input = parseObject(value, ['conversationId', 'sourceMessageId'], 'Memory suggestion request')
  return { conversationId: parseIdentifier(input.conversationId), sourceMessageId: parseIdentifier(input.sourceMessageId) }
}

export function parseMemorySuggestionReviewRequest(value: unknown): {
  id: string
  decision: 'accept' | 'reject'
  content?: string
  sensitivity?: 'normal' | 'personal' | 'sensitive'
} {
  const input = parseObject(value, ['id', 'decision', 'content', 'sensitivity'], 'Memory suggestion review')
  if (input.decision !== 'accept' && input.decision !== 'reject') throw new InputValidationError('Memory suggestion decision is invalid.')
  if (input.sensitivity !== undefined && input.sensitivity !== 'normal' && input.sensitivity !== 'personal' && input.sensitivity !== 'sensitive') {
    throw new InputValidationError('Memory sensitivity is invalid.')
  }
  if (input.decision === 'accept' && input.content === undefined) throw new InputValidationError('Accepted memory content is required.')
  const content = input.content === undefined ? undefined : parseMemoryContent(input.content)
  return {
    id: parseIdentifier(input.id),
    decision: input.decision,
    ...(content === undefined ? {} : { content }),
    ...(input.sensitivity === undefined ? {} : { sensitivity: input.sensitivity })
  }
}

function parseLocalDateTime(value: unknown): string {
  const text = parseText(value, 'Reminder time', 16, 16)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(text)
  if (!match) throw new InputValidationError('Reminder time is invalid.')
  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) throw new InputValidationError('Reminder time is invalid.')
  return text
}

export function parseReminderSettingsRequest(value: unknown): ReminderSettingsRequest {
  const input = parseObject(value, [
    'enabled', 'goalReviewEnabled', 'acceptConsent', 'maxPer24Hours', 'cooldownMinutes',
    'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd', 'timeZone'
  ], 'Reminder settings')
  if (typeof input.enabled !== 'boolean' || typeof input.goalReviewEnabled !== 'boolean' || typeof input.acceptConsent !== 'boolean') {
    throw new InputValidationError('Reminder consent setting is invalid.')
  }
  if (!Number.isSafeInteger(input.maxPer24Hours) || Number(input.maxPer24Hours) < 1 || Number(input.maxPer24Hours) > REMINDER_MAX_PER_24_HOURS) {
    throw new InputValidationError('Reminder frequency is invalid.')
  }
  if (!Number.isSafeInteger(input.cooldownMinutes) || Number(input.cooldownMinutes) < REMINDER_MIN_COOLDOWN_MINUTES || Number(input.cooldownMinutes) > REMINDER_MAX_COOLDOWN_MINUTES) {
    throw new InputValidationError('Reminder cooldown is invalid.')
  }
  if (typeof input.quietHoursEnabled !== 'boolean' || !isValidClockTime(input.quietHoursStart) || !isValidClockTime(input.quietHoursEnd)) {
    throw new InputValidationError('Reminder quiet hours are invalid.')
  }
  if (input.quietHoursEnabled && input.quietHoursStart === input.quietHoursEnd) {
    throw new InputValidationError('Reminder quiet hours are invalid.')
  }
  if (!isValidTimeZone(input.timeZone)) throw new InputValidationError('Reminder time zone is invalid.')
  return {
    enabled: input.enabled,
    goalReviewEnabled: input.goalReviewEnabled,
    acceptConsent: input.acceptConsent,
    maxPer24Hours: input.maxPer24Hours as number,
    cooldownMinutes: input.cooldownMinutes as number,
    quietHoursEnabled: input.quietHoursEnabled,
    quietHoursStart: input.quietHoursStart,
    quietHoursEnd: input.quietHoursEnd,
    timeZone: input.timeZone
  }
}

export function parseReminderScheduleRequest(value: unknown): ReminderScheduleRequest {
  const input = parseObject(value, ['goalId', 'localDateTime'], 'Reminder schedule')
  return { goalId: parseIdentifier(input.goalId), localDateTime: parseLocalDateTime(input.localDateTime) }
}

export function parseReminderRescheduleRequest(value: unknown): ReminderRescheduleRequest {
  const input = parseObject(value, ['reminderId', 'localDateTime'], 'Reminder reschedule')
  return { reminderId: parseIdentifier(input.reminderId), localDateTime: parseLocalDateTime(input.localDateTime) }
}

export function parseReminderIdRequest(value: unknown): ReminderIdRequest {
  const input = parseObject(value, ['reminderId'], 'Reminder request')
  return { reminderId: parseIdentifier(input.reminderId) }
}

export function parsePersonalityGrowthRollbackRequest(value: unknown): { dimension: 'warmth' | 'directness' | 'humor' } {
  const input = parseObject(value, ['dimension'], 'Personality growth rollback request')
  if (input.dimension !== 'warmth' && input.dimension !== 'directness' && input.dimension !== 'humor') {
    throw new InputValidationError('Personality growth rollback requires a known dimension')
  }
  return { dimension: input.dimension }
}

export function parsePendingItemDecisionRequest(value: unknown): { itemId: string; decision: 'accepted' | 'rejected' | 'dismissed' } {
  const input = parseObject(value, ['itemId', 'decision'], 'Pending item decision request')
  if (input.decision !== 'accepted' && input.decision !== 'rejected' && input.decision !== 'dismissed') {
    throw new InputValidationError('Pending item decision must be accepted, rejected or dismissed')
  }
  return { itemId: parseIdentifier(input.itemId), decision: input.decision }
}
