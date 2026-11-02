import type { AppInfo, BackupRestoreOutcome, BackupRestoreRequest, CognitiveSettingsRequest, IpcErrorCode, IpcResult, PendingDecisionResult, ProviderGetRequest } from '../shared/contracts'
import type { CompanionGoalCandidate, GoalCandidateDecisionResult } from '../motivation/companion-goal'
import { IPC_CHANNELS } from '../shared/contracts'
import type {
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  ConversationRecord,
  ConversationWithMessages,
  MemoryProposalPreview,
  MemoryProposalRequest,
  MemorySuggestion,
  MemorySuggestionReviewRequest,
  PersonalityInput,
  PersonalityProfile,
  PersonalityRevision,
  ProviderConfigInput,
  ProviderConfigRecord,
  ProviderConnectionRequest,
  ProviderConnectionResult
} from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import type { MemoryService } from '../memory/memory-service'
import type { CognitiveCoreSettings } from '../cognition/cognition'
import type { FeelingStateView } from '../affective-state/feeling'

import type { GoalService } from '../motivation/goal-service'
import type { InterestService } from '../self-model/interest-service'
import type { SelfModelService } from '../self-model/self-model-service'
import type { ReflectionService } from '../self-model/reflection-service'
import type { ReminderActions } from '../motivation/reminder-service'
import { GoalTransitionError, GoalValidationError } from '../motivation/goals'
import {
  InputValidationError,
  parseEmptyObject,
  parseBackupRestoreRequest,
  parseMemoryCorrectRequest,
  parseMemoryCreateRequest,
  parseMemoryIdRequest,
  parseMemorySearchRequest,
  parseConversationIdRequest,
  parseProviderConfigInput,
  parseProviderConnectionRequest,
  parseProviderGetRequest,
  parseChatRequest,
  parsePersonalityInput,
  parsePersonalityRestoreRequest,
  parsePersonalityGrowthRollbackRequest,
  parseMemoryProposalRequest,
  parseMemorySuggestionReviewRequest,
  parseCognitiveSettingsRequest,
  parseInterestIdRequest,
  parseInterestStatusRequest,
  parseSelfModelListRequest,
  parseSelfModelCorrectRequest,
  parseSelfModelIdRequest,
  parseReflectionFindingsRequest,
  parsePendingItemIdRequest,
  parsePendingItemDecisionRequest,
  parseTurnContextRequest
} from '../shared/validation'
import {
  parseGoalCandidateIdRequest,
  parseGoalCreateRequest,
  parseGoalIdRequest,
  parseGoalPrepareRequest,
  parseTaskIdRequest,
  parseReminderIdRequest,
  parseReminderRescheduleRequest,
  parseReminderScheduleRequest,
  parseReminderSettingsRequest
} from '../shared/validation'
import { isTrustedRendererUrl } from '../security/security'
import { ReminderValidationError } from '../motivation/reminders'

export interface IpcEventLike {
  sender: { mainFrame: object; send?: (channel: string, payload: unknown) => void }
  senderFrame: { url: string } | null
}

export type IpcHandler = (event: IpcEventLike, payload: unknown) => Promise<IpcResult<unknown>>

export interface AppInfoProvider {
  getAppInfo(): AppInfo
}

export interface CompanionActions {
  getProvider(request?: ProviderGetRequest): ProviderConfigRecord | null
  saveProvider(request: ProviderConfigInput): ProviderConfigRecord
  clearProviderCredential(request?: ProviderGetRequest): ProviderConfigRecord | null
  testProviderConnection(request: ProviderConnectionRequest): Promise<ProviderConnectionResult>
  createConversation(): ConversationRecord
  listConversations(): ConversationRecord[]
  readConversation(request: { conversationId: string }): ConversationWithMessages
  deleteConversation(request: { conversationId: string }): void
  getPersonality(): PersonalityProfile
  savePersonality(request: PersonalityInput): PersonalityProfile
  personalityHistory(): PersonalityRevision[]
  restorePersonality(request: { version: number }): PersonalityProfile
  getGrowthState(): import('../personalization/personality-growth').GrowthEntry[] | null
  rollbackGrowth(request: { dimension: import('../personalization/personality-growth').GrowthDimension }): boolean
  getCognitiveSettings(): CognitiveCoreSettings
  saveCognitiveSettings(request: CognitiveSettingsRequest): CognitiveCoreSettings
  getFeelingState(): FeelingStateView
  clearCognitiveHistory(): FeelingStateView
  sendChat(request: ChatRequest, onDelta: (delta: string) => void): Promise<ChatResult>
  cancelChat(request: { conversationId: string }): boolean
  listMemorySuggestions(request: { conversationId: string }): MemorySuggestion[]
  previewMemorySuggestions(request: MemoryProposalRequest): MemoryProposalPreview
  proposeMemorySuggestions(request: MemoryProposalRequest): Promise<MemorySuggestion[]>
  reviewMemorySuggestion(request: MemorySuggestionReviewRequest): MemorySuggestion[]
}

export interface BackupActions {
  exportBackup(): Promise<import('../shared/contracts').BackupExportOutcome>
  previewBackup(): Promise<import('../shared/contracts').BackupPreviewOutcome>
  restoreBackup(request: BackupRestoreRequest): Promise<BackupRestoreOutcome>
}

export interface SelfModelActions {
  listInterests(): ReturnType<InterestService['list']>
  setInterestStatus(request: { interestId: string; status: 'candidate' | 'active' | 'archived' | 'dropped' }): ReturnType<InterestService['setUserStatus']>
  listEntries(request?: { kind?: 'fact' | 'inference' | 'unknown' | 'correction' }): ReturnType<SelfModelService['list']>
  correctEntry(request: { entryId: string; statement: string }): ReturnType<SelfModelService['correct']>
  retractEntry(request: { entryId: string }): void
  runReflection(): Promise<import('../self-model/self-model-domain').ReflectionRunSummary | { skipped: 'rate_limited' | 'budget_exhausted' }>
  listReflectionRuns(): ReturnType<ReflectionService['listRuns']>
  listReflectionFindings(request: { runId: string }): ReturnType<ReflectionService['findings']>
}

/**
 * Phase 2.4 continuity surface.
 *
 * Deliberately minimal: reading the internal items and the per-turn record,
 * and marking an item done. Nothing here can send a message outward, change
 * memory, or alter personality.
 */
export interface ContinuityActions {
  listPendingItems(): ReturnType<import('../cognition/pending-items').PendingCognitionService['listOpen']>
  completePendingItem(request: { itemId: string }): boolean
  decidePendingItem(request: { itemId: string; decision: 'accepted' | 'rejected' | 'dismissed' }): PendingDecisionResult
  readTurnContext(request: { turnId: string }): import('../cognition/turn-context').CognitiveTurnContext | null
}

export interface CompanionGoalActions {
  listCandidates(): CompanionGoalCandidate[]
  decideCandidate(candidateId: string, decision: 'accept' | 'reject'): GoalCandidateDecisionResult
}

export interface ApplicationActions {
  memories: MemoryService
  goals: GoalService
  companionGoals?: CompanionGoalActions
  reminders: ReminderActions
  companion?: CompanionActions
  backup?: BackupActions
  selfModel?: SelfModelActions
  continuity?: ContinuityActions
}

function isTrustedSender(event: IpcEventLike, trustedRendererUrl: string): boolean {
  if (!event.senderFrame) return false
  if (event.senderFrame !== event.sender.mainFrame) return false
  return isTrustedRendererUrl(event.senderFrame.url, trustedRendererUrl)
}

function failure(code: IpcErrorCode): IpcResult<never> {
  const messages: Record<IpcErrorCode, string> = {
    INVALID_INPUT: '输入无效，请检查后重试。',
    FORBIDDEN: '此请求不被允许。',
    NOT_FOUND: '记录不存在或已删除。',
    CONFLICT: '记录状态已变化，请刷新后重试。',
    STORAGE_ERROR: '本地数据暂不可用，请重试。',
    BACKUP_INVALID: '所选备份无效、已损坏或与当前版本不兼容；本地数据未做任何更改。',
    INTERNAL_ERROR: '请求无法完成。',
    PROVIDER_STORAGE_UNAVAILABLE: '系统安全存储不可用，无法确认 API 密钥状态。聊天已暂停；请重试或重启应用后检查。',
    PROVIDER_CREDENTIAL_STORE_ERROR: '本机 API 凭据无法安全读取，可能已损坏或无权访问。聊天和替换密钥已阻止；请重启应用复查，仍无法读取时可在确认后删除本机密钥并重新设置。',
    PROVIDER_UNCONFIGURED: '请先配置并启用 DeepSeek API 密钥。',
    PROVIDER_PAYLOAD_TOO_LARGE: '本次对话上下文过长，请缩短消息或精简记忆。',
    PROVIDER_RESPONSE: 'DeepSeek 返回了无效响应，请稍后重试。',
    PROVIDER_AUTH: 'DeepSeek 未接受该 API 密钥或请求权限。',
    PROVIDER_RATE_LIMIT: 'DeepSeek 请求过于频繁，请稍后重试。',
    PROVIDER_QUOTA: '该 Provider 账户没有有效订单或额度不足，请先在服务控制台开通或充值。',
    PROVIDER_DEADLINE: '本次请求的总时限已用完，已停止重试；请稍后再试或检查网络。',
    PROVIDER_MODEL: 'DeepSeek 未找到所选模型。',
    PROVIDER_TIMEOUT: 'DeepSeek 请求超时，可重试。',
    PROVIDER_NETWORK: '无法连接 DeepSeek，请检查网络后重试。',
    PROVIDER_CANCELLED: '请求已取消。'
  }
  return { ok: false, error: { code, message: messages[code] } }
}

function toFailure(error: unknown): IpcResult<never> {
  if (error instanceof InputValidationError || error instanceof GoalValidationError || error instanceof ReminderValidationError) return failure('INVALID_INPUT')

  if (error instanceof ApplicationError) return failure(error.code)
  return failure('INTERNAL_ERROR')
}

function emptyRequest(value: unknown): undefined {
  parseEmptyObject(value)
  return undefined
}

async function execute<T, P>(
  event: IpcEventLike,
  trustedRendererUrl: string,
  payload: unknown,
  parse: (value: unknown) => P,
  action: (request: P) => T | Promise<T>
): Promise<IpcResult<T>> {
  if (!isTrustedSender(event, trustedRendererUrl)) return failure('FORBIDDEN')
  try {
    return { ok: true, data: await action(parse(payload)) }
  } catch (error) {
    return toFailure(error)
  }
}

export function createIpcHandlers(
  appInfo: AppInfoProvider,
  trustedRendererUrl: string,
  actions: ApplicationActions
): Record<string, IpcHandler> {
  const companion = actions.companion
  const backup = actions.backup
  return {
    [IPC_CHANNELS.appInfo]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => appInfo.getAppInfo()),
    [IPC_CHANNELS.memoryCreate]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemoryCreateRequest, ({ content, sensitivity }) => actions.memories.create(content, sensitivity)),
    [IPC_CHANNELS.memoryList]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.memories.list()),
    [IPC_CHANNELS.memorySearch]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemorySearchRequest, ({ query }) => actions.memories.search(query)),
    [IPC_CHANNELS.memoryHistory]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemoryIdRequest, ({ id }) => actions.memories.history(id)),
    [IPC_CHANNELS.memoryCorrect]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemoryCorrectRequest, ({ id, content }) => actions.memories.correct(id, content)),
    [IPC_CHANNELS.memoryRevoke]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemoryIdRequest, ({ id }) => actions.memories.retract(id)),
    [IPC_CHANNELS.memoryRestore]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemoryIdRequest, ({ id }) => actions.memories.restore(id)),
    [IPC_CHANNELS.memoryDelete]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemoryIdRequest, ({ id }) => actions.memories.delete(id)),
    [IPC_CHANNELS.goalsList]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.goals.list()),
    [IPC_CHANNELS.goalsCreate]: (event, payload) => execute(event, trustedRendererUrl, payload, parseGoalCreateRequest, (request) => actions.goals.create(request)),
    [IPC_CHANNELS.goalsPrepare]: (event, payload) => execute(event, trustedRendererUrl, payload, parseGoalPrepareRequest, ({ goalId, acknowledgeUnknown }) => actions.goals.prepare(goalId, acknowledgeUnknown)),
    [IPC_CHANNELS.goalsRequestApproval]: (event, payload) => execute(event, trustedRendererUrl, payload, parseTaskIdRequest, ({ taskId }) => actions.goals.requestApproval(taskId)),
    [IPC_CHANNELS.goalsApprove]: (event, payload) => execute(event, trustedRendererUrl, payload, parseTaskIdRequest, ({ taskId }) => actions.goals.approveAndExecute(taskId)),
    [IPC_CHANNELS.goalsRejectApproval]: (event, payload) => execute(event, trustedRendererUrl, payload, parseTaskIdRequest, ({ taskId }) => actions.goals.rejectApproval(taskId)),
    [IPC_CHANNELS.goalsCancelTask]: (event, payload) => execute(event, trustedRendererUrl, payload, parseTaskIdRequest, ({ taskId }) => actions.goals.cancelTask(taskId)),
    [IPC_CHANNELS.goalsStop]: (event, payload) => execute(event, trustedRendererUrl, payload, parseGoalIdRequest, ({ goalId }) => actions.goals.stop(goalId)),
    [IPC_CHANNELS.goalsDelete]: (event, payload) => execute(event, trustedRendererUrl, payload, parseGoalIdRequest, ({ goalId }) => actions.goals.delete(goalId)),
    ...(actions.companionGoals ? {
      [IPC_CHANNELS.companionGoalCandidatesList]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.companionGoals!.listCandidates()),
      [IPC_CHANNELS.companionGoalCandidateAccept]: (event, payload) => execute(event, trustedRendererUrl, payload, parseGoalCandidateIdRequest, ({ candidateId }) => actions.companionGoals!.decideCandidate(candidateId, 'accept')),
      [IPC_CHANNELS.companionGoalCandidateReject]: (event, payload) => execute(event, trustedRendererUrl, payload, parseGoalCandidateIdRequest, ({ candidateId }) => actions.companionGoals!.decideCandidate(candidateId, 'reject'))
    } : {}),
    [IPC_CHANNELS.remindersSnapshot]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.reminders.snapshot()),
    [IPC_CHANNELS.remindersSaveSettings]: (event, payload) => execute(event, trustedRendererUrl, payload, parseReminderSettingsRequest, (request) => actions.reminders.saveSettings(request)),
    [IPC_CHANNELS.remindersPause]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.reminders.pause()),
    [IPC_CHANNELS.remindersWithdrawConsent]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.reminders.withdrawConsent()),
    [IPC_CHANNELS.remindersMuteForOneHour]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.reminders.muteForOneHour()),
    [IPC_CHANNELS.remindersUnmute]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.reminders.unmute()),
    [IPC_CHANNELS.remindersSchedule]: (event, payload) => execute(event, trustedRendererUrl, payload, parseReminderScheduleRequest, (request) => actions.reminders.schedule(request)),
    [IPC_CHANNELS.remindersReschedule]: (event, payload) => execute(event, trustedRendererUrl, payload, parseReminderRescheduleRequest, (request) => actions.reminders.reschedule(request)),
    [IPC_CHANNELS.remindersCancel]: (event, payload) => execute(event, trustedRendererUrl, payload, parseReminderIdRequest, (request) => actions.reminders.cancel(request.reminderId)),
    [IPC_CHANNELS.remindersClearHistory]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.reminders.clearHistory()),
    ...(backup ? {
      [IPC_CHANNELS.backupExport]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => backup.exportBackup()),
      [IPC_CHANNELS.backupPreview]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => backup.previewBackup()),
      [IPC_CHANNELS.backupRestore]: (event, payload) => execute(event, trustedRendererUrl, payload, parseBackupRestoreRequest, (request) => backup.restoreBackup(request))
    } : {}),
    ...(actions.selfModel ? {
      [IPC_CHANNELS.interestsList]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.selfModel!.listInterests()),
      [IPC_CHANNELS.interestSetStatus]: (event, payload) => execute(event, trustedRendererUrl, payload, parseInterestStatusRequest, (request) => actions.selfModel!.setInterestStatus(request)),
      [IPC_CHANNELS.selfModelList]: (event, payload) => execute(event, trustedRendererUrl, payload, parseSelfModelListRequest, (request) => actions.selfModel!.listEntries(request)),
      [IPC_CHANNELS.selfModelCorrect]: (event, payload) => execute(event, trustedRendererUrl, payload, parseSelfModelCorrectRequest, (request) => actions.selfModel!.correctEntry(request)),
      [IPC_CHANNELS.selfModelRetract]: (event, payload) => execute(event, trustedRendererUrl, payload, parseSelfModelIdRequest, (request) => actions.selfModel!.retractEntry(request)),
      [IPC_CHANNELS.reflectionRun]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.selfModel!.runReflection()),
      [IPC_CHANNELS.reflectionListRuns]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.selfModel!.listReflectionRuns()),
      [IPC_CHANNELS.reflectionFindings]: (event, payload) => execute(event, trustedRendererUrl, payload, parseReflectionFindingsRequest, (request) => actions.selfModel!.listReflectionFindings(request))
    } : {}),
    ...(actions.continuity ? {
      [IPC_CHANNELS.pendingItemsList]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => actions.continuity!.listPendingItems()),
      [IPC_CHANNELS.pendingItemsComplete]: (event, payload) => execute(event, trustedRendererUrl, payload, parsePendingItemIdRequest, (request) => actions.continuity!.completePendingItem(request)),
      [IPC_CHANNELS.pendingItemsDecide]: (event, payload) => execute(event, trustedRendererUrl, payload, parsePendingItemDecisionRequest, (request) => actions.continuity!.decidePendingItem(request)),
      [IPC_CHANNELS.turnContextRead]: (event, payload) => execute(event, trustedRendererUrl, payload, parseTurnContextRequest, (request) => actions.continuity!.readTurnContext(request))
    } : {}),
    ...(companion ? {
      [IPC_CHANNELS.providerGet]: (event, payload) => execute(event, trustedRendererUrl, payload, parseProviderGetRequest, (request) => companion.getProvider(request)),
      [IPC_CHANNELS.providerSave]: (event, payload) => execute(event, trustedRendererUrl, payload, parseProviderConfigInput, (request) => companion.saveProvider(request)),
      [IPC_CHANNELS.providerClearCredential]: (event, payload) => execute(event, trustedRendererUrl, payload, parseProviderGetRequest, (request) => companion.clearProviderCredential(request)),
      [IPC_CHANNELS.providerTestConnection]: (event, payload) => execute(event, trustedRendererUrl, payload, parseProviderConnectionRequest, (request) => companion.testProviderConnection(request)),
      [IPC_CHANNELS.conversationsCreate]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => companion.createConversation()),
      [IPC_CHANNELS.conversationsList]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => companion.listConversations()),
      [IPC_CHANNELS.conversationsRead]: (event, payload) => execute(event, trustedRendererUrl, payload, parseConversationIdRequest, (request) => companion.readConversation(request)),
      [IPC_CHANNELS.conversationsDelete]: (event, payload) => execute(event, trustedRendererUrl, payload, parseConversationIdRequest, (request) => companion.deleteConversation(request)),
      [IPC_CHANNELS.personalityGet]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => companion.getPersonality()),
      [IPC_CHANNELS.personalitySave]: (event, payload) => execute(event, trustedRendererUrl, payload, parsePersonalityInput, (request) => companion.savePersonality(request)),
      [IPC_CHANNELS.personalityHistory]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => companion.personalityHistory()),
      [IPC_CHANNELS.personalityRestore]: (event, payload) => execute(event, trustedRendererUrl, payload, parsePersonalityRestoreRequest, (request) => companion.restorePersonality(request)),
      [IPC_CHANNELS.personalityGrowthGet]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => companion.getGrowthState()),
      [IPC_CHANNELS.personalityGrowthRollback]: (event, payload) => execute(event, trustedRendererUrl, payload, parsePersonalityGrowthRollbackRequest, (request) => companion.rollbackGrowth(request)),
      [IPC_CHANNELS.cognitiveSettingsGet]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => companion.getCognitiveSettings()),
      [IPC_CHANNELS.cognitiveSettingsSave]: (event, payload) => execute(event, trustedRendererUrl, payload, parseCognitiveSettingsRequest, (request) => companion.saveCognitiveSettings(request)),
      [IPC_CHANNELS.cognitiveFeelingSnapshot]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => companion.getFeelingState()),
      [IPC_CHANNELS.cognitiveClearHistory]: (event, payload) => execute(event, trustedRendererUrl, payload, emptyRequest, () => companion.clearCognitiveHistory()),
      [IPC_CHANNELS.chatSend]: (event, payload) => execute(event, trustedRendererUrl, payload, parseChatRequest, (request) => companion.sendChat(request, (delta) => {
        const streamEvent: ChatStreamEvent = { conversationId: request.conversationId, requestId: request.requestId, delta }
        event.sender.send?.(IPC_CHANNELS.chatDelta, streamEvent)
      })),
      [IPC_CHANNELS.chatCancel]: (event, payload) => execute(event, trustedRendererUrl, payload, parseConversationIdRequest, (request) => companion.cancelChat(request)),
      [IPC_CHANNELS.memorySuggestionsList]: (event, payload) => execute(event, trustedRendererUrl, payload, parseConversationIdRequest, (request) => companion.listMemorySuggestions(request)),
      [IPC_CHANNELS.memorySuggestionsPreview]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemoryProposalRequest, (request) => companion.previewMemorySuggestions(request)),
      [IPC_CHANNELS.memorySuggestionsPropose]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemoryProposalRequest, (request) => companion.proposeMemorySuggestions(request)),
      [IPC_CHANNELS.memorySuggestionsReview]: (event, payload) => execute(event, trustedRendererUrl, payload, parseMemorySuggestionReviewRequest, (request) => companion.reviewMemorySuggestion(request))
    } : {})
  }
}
