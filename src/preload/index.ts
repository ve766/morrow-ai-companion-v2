import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppInfo,
  type BackupExportOutcome,
  type BackupPreviewOutcome,
  type BackupRestoreOutcome,
  type BackupRestoreRequest,
  type IpcResult,
  type MemoryCorrectRequest,
  type MemoryCreateRequest,
  type MemoryIdRequest,
  type MemorySearchRequest,
  type GoalCreateRequest,
  type GoalIdRequest,
  type GoalPrepareRequest,
  type TaskIdRequest,
  type MorrowBridge,
  type ConversationIdRequest,
  type PersonalityRestoreRequest,
  type CognitiveSettingsRequest,
  type InterestStatusRequest,
  type SelfModelListRequest,
  type SelfModelCorrectRequest,
  type SelfModelIdRequest,
  type ReflectionFindingsRequest
} from '../shared/contracts'
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
import type { MemoryRecord, MemoryRevisionRecord } from '../memory/memory-domain'
import type { ApprovalChallenge, GoalListItem, GoalRecord, TaskRecord } from '../motivation/goals'
import type { ReminderIdRequest, ReminderRescheduleRequest, ReminderScheduleRequest, ReminderSettingsRequest, ReminderRecord, ReminderSnapshot } from '../motivation/reminders'
import type { CognitiveCoreSettings } from '../cognition/cognition'
import type { FeelingStateView } from '../affective-state/feeling'

function invoke<T>(channel: string, request?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, request) as Promise<IpcResult<T>>
}

const bridge: MorrowBridge = Object.freeze({
  getAppInfo: () => invoke<AppInfo>(IPC_CHANNELS.appInfo),
  providers: Object.freeze({
    get: () => invoke<ProviderConfigRecord | null>(IPC_CHANNELS.providerGet),
    save: (request: ProviderConfigInput) => invoke<ProviderConfigRecord>(IPC_CHANNELS.providerSave, request),
    clearCredential: () => invoke<ProviderConfigRecord | null>(IPC_CHANNELS.providerClearCredential),
    testConnection: (request: ProviderConnectionRequest) => invoke<ProviderConnectionResult>(IPC_CHANNELS.providerTestConnection, request)
  }),
  conversations: Object.freeze({
    create: () => invoke<ConversationRecord>(IPC_CHANNELS.conversationsCreate),
    list: () => invoke<ConversationRecord[]>(IPC_CHANNELS.conversationsList),
    read: (request: ConversationIdRequest) => invoke<ConversationWithMessages>(IPC_CHANNELS.conversationsRead, request),
    delete: (request: ConversationIdRequest) => invoke<void>(IPC_CHANNELS.conversationsDelete, request)
  }),
  personality: Object.freeze({
    get: () => invoke<PersonalityProfile>(IPC_CHANNELS.personalityGet),
    save: (request: PersonalityInput) => invoke<PersonalityProfile>(IPC_CHANNELS.personalitySave, request),
    history: () => invoke<PersonalityRevision[]>(IPC_CHANNELS.personalityHistory),
    restore: (request: PersonalityRestoreRequest) => invoke<PersonalityProfile>(IPC_CHANNELS.personalityRestore, request)
  }),
  selfModel: Object.freeze({
    listInterests: () => invoke<import('../self-model/self-model-domain').InterestRecord[]>(IPC_CHANNELS.interestsList),
    setInterestStatus: (request: InterestStatusRequest) => invoke<import('../self-model/self-model-domain').InterestRecord>(IPC_CHANNELS.interestSetStatus, request),
    listEntries: (request?: SelfModelListRequest) => invoke<import('../self-model/self-model-domain').SelfModelEntry[]>(IPC_CHANNELS.selfModelList, request ?? {}),
    correctEntry: (request: SelfModelCorrectRequest) => invoke<import('../self-model/self-model-domain').SelfModelEntry>(IPC_CHANNELS.selfModelCorrect, request),
    retractEntry: (request: SelfModelIdRequest) => invoke<void>(IPC_CHANNELS.selfModelRetract, request),
    runReflection: () => invoke<import('../self-model/self-model-domain').ReflectionRunSummary | { skipped: 'rate_limited' }>(IPC_CHANNELS.reflectionRun),
    listReflectionRuns: () => invoke<import('../self-model/self-model-domain').ReflectionRunSummary[]>(IPC_CHANNELS.reflectionListRuns),
    listReflectionFindings: (request: ReflectionFindingsRequest) => invoke<import('../self-model/self-model-domain').ReflectionFinding[]>(IPC_CHANNELS.reflectionFindings, request)
  }),
  cognition: Object.freeze({
    getSettings: () => invoke<CognitiveCoreSettings>(IPC_CHANNELS.cognitiveSettingsGet),
    saveSettings: (request: CognitiveSettingsRequest) => invoke<CognitiveCoreSettings>(IPC_CHANNELS.cognitiveSettingsSave, request),
    getFeelingState: () => invoke<FeelingStateView>(IPC_CHANNELS.cognitiveFeelingSnapshot),
    clearHistory: () => invoke<FeelingStateView>(IPC_CHANNELS.cognitiveClearHistory)
  }),
  chat: Object.freeze({
    send: (request: ChatRequest) => invoke<ChatResult>(IPC_CHANNELS.chatSend, request),
    cancel: (request: ConversationIdRequest) => invoke<boolean>(IPC_CHANNELS.chatCancel, request),
    onDelta: (listener: (event: ChatStreamEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: ChatStreamEvent): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.chatDelta, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.chatDelta, handler)
    }
  }),
  memorySuggestions: Object.freeze({
    list: (request: ConversationIdRequest) => invoke<MemorySuggestion[]>(IPC_CHANNELS.memorySuggestionsList, request),
    preview: (request: MemoryProposalRequest) => invoke<MemoryProposalPreview>(IPC_CHANNELS.memorySuggestionsPreview, request),
    propose: (request: MemoryProposalRequest) => invoke<MemorySuggestion[]>(IPC_CHANNELS.memorySuggestionsPropose, request),
    review: (request: MemorySuggestionReviewRequest) => invoke<MemorySuggestion[]>(IPC_CHANNELS.memorySuggestionsReview, request)
  }),
  memories: Object.freeze({
    create: (request: MemoryCreateRequest) => invoke<MemoryRecord>(IPC_CHANNELS.memoryCreate, request),
    list: () => invoke<MemoryRecord[]>(IPC_CHANNELS.memoryList),
    search: (request: MemorySearchRequest) => invoke<MemoryRecord[]>(IPC_CHANNELS.memorySearch, request),
    history: (request: MemoryIdRequest) => invoke<MemoryRevisionRecord[]>(IPC_CHANNELS.memoryHistory, request),
    correct: (request: MemoryCorrectRequest) => invoke<MemoryRecord>(IPC_CHANNELS.memoryCorrect, request),
    revoke: (request: MemoryIdRequest) => invoke<MemoryRecord>(IPC_CHANNELS.memoryRevoke, request),
    restore: (request: MemoryIdRequest) => invoke<MemoryRecord>(IPC_CHANNELS.memoryRestore, request),
    delete: (request: MemoryIdRequest) => invoke<void>(IPC_CHANNELS.memoryDelete, request)
  }),
  goals: Object.freeze({
    list: () => invoke<GoalListItem[]>(IPC_CHANNELS.goalsList),
    create: (request: GoalCreateRequest) => invoke<GoalRecord>(IPC_CHANNELS.goalsCreate, request),
    prepare: (request: GoalPrepareRequest) => invoke<TaskRecord>(IPC_CHANNELS.goalsPrepare, request),
    requestApproval: (request: TaskIdRequest) => invoke<ApprovalChallenge>(IPC_CHANNELS.goalsRequestApproval, request),
    approveAndExecute: (request: TaskIdRequest) => invoke<TaskRecord>(IPC_CHANNELS.goalsApprove, request),
    rejectApproval: (request: TaskIdRequest) => invoke<TaskRecord>(IPC_CHANNELS.goalsRejectApproval, request),
    cancelTask: (request: TaskIdRequest) => invoke<TaskRecord>(IPC_CHANNELS.goalsCancelTask, request),
    stop: (request: GoalIdRequest) => invoke<GoalRecord>(IPC_CHANNELS.goalsStop, request),
    delete: (request: GoalIdRequest) => invoke<void>(IPC_CHANNELS.goalsDelete, request)
  }),
  reminders: Object.freeze({
    getSnapshot: () => invoke<ReminderSnapshot>(IPC_CHANNELS.remindersSnapshot),
    saveSettings: (request: ReminderSettingsRequest) => invoke<ReminderSnapshot>(IPC_CHANNELS.remindersSaveSettings, request),
    pause: () => invoke<ReminderSnapshot>(IPC_CHANNELS.remindersPause),
    withdrawConsent: () => invoke<ReminderSnapshot>(IPC_CHANNELS.remindersWithdrawConsent),
    muteForOneHour: () => invoke<ReminderSnapshot>(IPC_CHANNELS.remindersMuteForOneHour),
    unmute: () => invoke<ReminderSnapshot>(IPC_CHANNELS.remindersUnmute),
    schedule: (request: ReminderScheduleRequest) => invoke<ReminderRecord>(IPC_CHANNELS.remindersSchedule, request),
    reschedule: (request: ReminderRescheduleRequest) => invoke<ReminderRecord>(IPC_CHANNELS.remindersReschedule, request),
    cancel: (request: ReminderIdRequest) => invoke<ReminderRecord>(IPC_CHANNELS.remindersCancel, request),
    clearHistory: () => invoke<ReminderSnapshot>(IPC_CHANNELS.remindersClearHistory),
    onChanged: (listener: () => void) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC_CHANNELS.remindersChanged, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.remindersChanged, handler)
    }
  }),
  backups: Object.freeze({
    export: () => invoke<BackupExportOutcome>(IPC_CHANNELS.backupExport),
    preview: () => invoke<BackupPreviewOutcome>(IPC_CHANNELS.backupPreview),
    restore: (request: BackupRestoreRequest) => invoke<BackupRestoreOutcome>(IPC_CHANNELS.backupRestore, request)
  })
})

contextBridge.exposeInMainWorld('morrow', bridge)
