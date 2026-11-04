import type { MemoryRecord, MemoryRevisionRecord } from '../memory/memory-domain'
import type { ApprovalChallenge, GoalListItem, GoalRecord, TaskRecord } from '../motivation/goals'
import type { ReminderIdRequest, ReminderRescheduleRequest, ReminderScheduleRequest, ReminderSettingsRequest, ReminderRecord, ReminderSnapshot } from '../motivation/reminders'
import type { CognitiveCoreSettings } from '../cognition/cognition'
import type { FeelingStateView } from '../affective-state/feeling'
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
  ProviderConnectionResult,
  ProviderModelsRequest,
  ProviderModelsResult,
  ProviderProfileIdRequest,
  ProviderProfileSaveInput
} from './companion'
export type { ProviderModelsRequest, ProviderModelsResult, ProviderProfileIdRequest, ProviderProfileSaveInput } from './companion'

export const IPC_CHANNELS = {
  appInfo: 'morrow:app:info',
  memoryCreate: 'morrow:memory:create',
  providerGet: 'morrow:provider:get',
  providerSave: 'morrow:provider:save',
  providerProfilesList: 'morrow:provider:profiles:list',
  providerProfileSave: 'morrow:provider:profiles:save',
  providerProfileDelete: 'morrow:provider:profiles:delete',
  providerProfileSetDefault: 'morrow:provider:profiles:set-default',
  providerProfileDiscoverModels: 'morrow:provider:profiles:discover-models',
  providerClearCredential: 'morrow:provider:clear-credential',
  providerTestConnection: 'morrow:provider:test-connection',
  conversationsCreate: 'morrow:conversations:create',
  conversationsList: 'morrow:conversations:list',
  conversationsRead: 'morrow:conversations:read',
  conversationsDelete: 'morrow:conversations:delete',
  personalityGet: 'morrow:personality:get',
  personalitySave: 'morrow:personality:save',
  personalityHistory: 'morrow:personality:history',
  personalityRestore: 'morrow:personality:restore',
  personalityGrowthGet: 'morrow:personality:growth:get',
  personalityGrowthRollback: 'morrow:personality:growth:rollback',
  chatSend: 'morrow:chat:send',
  chatCancel: 'morrow:chat:cancel',
  chatDelta: 'morrow:chat:delta',
  memorySuggestionsList: 'morrow:memory-suggestions:list',
  memorySuggestionsPreview: 'morrow:memory-suggestions:preview',
  memorySuggestionsPropose: 'morrow:memory-suggestions:propose',
  memorySuggestionsReview: 'morrow:memory-suggestions:review',
  memoryList: 'morrow:memory:list',
  memorySearch: 'morrow:memory:search',
  memoryHistory: 'morrow:memory:history',
  memoryCorrect: 'morrow:memory:correct',
  memoryRevoke: 'morrow:memory:revoke',
  memoryRestore: 'morrow:memory:restore',
  memoryDelete: 'morrow:memory:delete',
  goalsList: 'morrow:goals:list',
  goalsCreate: 'morrow:goals:create',
  goalsPrepare: 'morrow:goals:prepare',
  goalsRequestApproval: 'morrow:goals:request-approval',
  goalsApprove: 'morrow:goals:approve',
  goalsRejectApproval: 'morrow:goals:reject-approval',
  goalsCancelTask: 'morrow:goals:cancel-task',
  goalsStop: 'morrow:goals:stop',
  goalsDelete: 'morrow:goals:delete',
  remindersSnapshot: 'morrow:reminders:snapshot',
  remindersSaveSettings: 'morrow:reminders:save-settings',
  remindersPause: 'morrow:reminders:pause',
  remindersWithdrawConsent: 'morrow:reminders:withdraw-consent',
  remindersMuteForOneHour: 'morrow:reminders:mute-one-hour',
  remindersUnmute: 'morrow:reminders:unmute',
  remindersSchedule: 'morrow:reminders:schedule',
  remindersReschedule: 'morrow:reminders:reschedule',
  remindersCancel: 'morrow:reminders:cancel',
  remindersClearHistory: 'morrow:reminders:clear-history',
  remindersChanged: 'morrow:reminders:changed',
  backupExport: 'morrow:backup:export',
  backupPreview: 'morrow:backup:preview',
  backupRestore: 'morrow:backup:restore',
  cognitiveSettingsGet: 'morrow:cognitive:settings:get',
  cognitiveSettingsSave: 'morrow:cognitive:settings:save',
  cognitiveFeelingSnapshot: 'morrow:cognitive:feeling:snapshot',
  cognitiveClearHistory: 'morrow:cognitive:history:clear',
  interestsList: 'morrow:selfmodel:interests:list',
  interestSetStatus: 'morrow:selfmodel:interests:set-status',
  selfModelList: 'morrow:selfmodel:entries:list',
  selfModelCorrect: 'morrow:selfmodel:entries:correct',
  selfModelRetract: 'morrow:selfmodel:entries:retract',
  reflectionRun: 'morrow:selfmodel:reflection:run',
  reflectionListRuns: 'morrow:selfmodel:reflection:runs',
  reflectionFindings: 'morrow:selfmodel:reflection:findings',
  pendingItemsList: 'morrow:continuity:pending:list',
  pendingItemsComplete: 'morrow:continuity:pending:complete',
  pendingItemsDecide: 'morrow:continuity:pending:decide',
  turnContextRead: 'morrow:continuity:turn:read'
} as const

export type IpcErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STORAGE_ERROR'
  | 'BACKUP_INVALID'
  | 'INTERNAL_ERROR'
  | 'PROVIDER_STORAGE_UNAVAILABLE'
  | 'PROVIDER_CREDENTIAL_STORE_ERROR'
  | 'PROVIDER_UNCONFIGURED'
  | 'PROVIDER_PAYLOAD_TOO_LARGE'
  | 'PROVIDER_RESPONSE'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_QUOTA'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_MODEL'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_DEADLINE'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_ENDPOINT_BLOCKED'
  | 'PROVIDER_CANCELLED'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: IpcErrorCode; message: string } }

export interface AppInfo {
  name: string
  version: string
  platform: string
  electronVersion: string
  dataPolicy: 'local-first-consented-deepseek-egress-memory-goals-reminders'
}

export interface MemoryCreateRequest {
  content: string
  sensitivity?: 'normal' | 'personal' | 'sensitive'
}

export interface MemorySearchRequest {
  query: string
}

export interface MemoryIdRequest {
  id: string
}

export interface MemoryCorrectRequest {
  id: string
  content: string
}

export interface GoalCreateRequest {
  intent: string
  successCriterion: GoalRecord['successCriterion']
  constraints: string
  acceptedBoundary: true
}

export interface GoalIdRequest {
  goalId: string
}

export interface GoalPrepareRequest {
  goalId: string
  acknowledgeUnknown: boolean
}

export interface TaskIdRequest {
  taskId: string
}

export interface ConversationIdRequest {
  conversationId: string
}

export interface ProviderGetRequest {
  providerId?: string
}

export interface InterestIdRequest {
  interestId: string
}

export interface InterestStatusRequest {
  interestId: string
  status: 'candidate' | 'active' | 'archived' | 'dropped'
}

export interface SelfModelListRequest {
  kind?: 'fact' | 'inference' | 'unknown' | 'correction'
}

export interface SelfModelCorrectRequest {
  entryId: string
  statement: string
}

export interface SelfModelIdRequest {
  entryId: string
}

export interface ReflectionFindingsRequest {
  runId: string
}

/** Phase 2.4: a stored internal item, readable and completable from the shell. */
export interface PendingItemIdRequest {
  itemId: string
}

/** D-11: the user decision on one open internal item. */
export interface PendingItemDecisionRequest {
  itemId: string
  decision: 'accepted' | 'rejected' | 'dismissed'
}

/** Phase 2.4: read one turn's recorded cognitive context. */
export interface TurnContextRequest {
  turnId: string
}

export interface PersonalityRestoreRequest {
  version: number
}

/** D-1: diagnostic read / user-facing rollback of the G1 growth ledger. */
export interface PersonalityGrowthRollbackRequest {
  dimension: 'warmth' | 'directness' | 'humor'
}

export interface CognitiveSettingsRequest {
  enabled: boolean
}

export interface BackupCounts {
  conversations: number
  messages: number
  memories: number
  retractedMemories: number
  deletionJournalEntries: number
}

export type BackupExportOutcome =
  | { status: 'created'; directory: string; createdAt: string; counts: BackupCounts }
  | { status: 'cancelled' }

export type BackupPreviewOutcome =
  | {
    status: 'preview'
    token: string
    createdAt: string
    schemaVersion: number
    counts: BackupCounts
    missingDeletionJournal: boolean
    boundaryNotice: string
  }
  | { status: 'cancelled' }

export interface BackupRestoreRequest {
  token: string
  confirmed: true
  acknowledgeMissingDeletionJournal?: true
}

export type BackupRestoreOutcome =
  | { status: 'restored'; schemaVersion: number; reappliedDeletions: number; reappliedRetractions: number; reappliedUnretractions: number }
  | { status: 'cancelled' }

export interface MorrowBridge {
  getAppInfo(): Promise<IpcResult<AppInfo>>
  providers: {
    get(request?: ProviderGetRequest): Promise<IpcResult<ProviderConfigRecord | null>>
    save(request: ProviderConfigInput): Promise<IpcResult<ProviderConfigRecord>>
    clearCredential(request?: ProviderGetRequest): Promise<IpcResult<ProviderConfigRecord | null>>
    testConnection(request: ProviderConnectionRequest): Promise<IpcResult<ProviderConnectionResult>>
    listProfiles(): Promise<IpcResult<ProviderConfigRecord[]>>
    saveProfile(request: ProviderProfileSaveInput): Promise<IpcResult<ProviderConfigRecord>>
    deleteProfile(request: ProviderProfileIdRequest): Promise<IpcResult<void>>
    setDefaultProfile(request: ProviderProfileIdRequest): Promise<IpcResult<ProviderConfigRecord>>
    discoverModels(request: ProviderModelsRequest): Promise<IpcResult<ProviderModelsResult>>
  }
  conversations: {
    create(): Promise<IpcResult<ConversationRecord>>
    list(): Promise<IpcResult<ConversationRecord[]>>
    read(request: ConversationIdRequest): Promise<IpcResult<ConversationWithMessages>>
    delete(request: ConversationIdRequest): Promise<IpcResult<void>>
  }
  personality: {
    get(): Promise<IpcResult<PersonalityProfile>>
    save(request: PersonalityInput): Promise<IpcResult<PersonalityProfile>>
    history(): Promise<IpcResult<PersonalityRevision[]>>
    restore(request: PersonalityRestoreRequest): Promise<IpcResult<PersonalityProfile>>
    growthGet(): Promise<IpcResult<import('../personalization/personality-growth').GrowthEntry[] | null>>
    growthRollback(request: PersonalityGrowthRollbackRequest): Promise<IpcResult<boolean>>
  }
  selfModel: {
    listInterests(): Promise<IpcResult<import('../self-model/self-model-domain').InterestRecord[]>>
    setInterestStatus(request: InterestStatusRequest): Promise<IpcResult<import('../self-model/self-model-domain').InterestRecord>>
    listEntries(request?: SelfModelListRequest): Promise<IpcResult<import('../self-model/self-model-domain').SelfModelEntry[]>>
    correctEntry(request: SelfModelCorrectRequest): Promise<IpcResult<import('../self-model/self-model-domain').SelfModelEntry>>
    retractEntry(request: SelfModelIdRequest): Promise<IpcResult<void>>
    runReflection(): Promise<IpcResult<import('../self-model/self-model-domain').ReflectionRunSummary | { skipped: 'rate_limited' | 'budget_exhausted' }>>
    listReflectionRuns(): Promise<IpcResult<import('../self-model/self-model-domain').ReflectionRunSummary[]>>
    listReflectionFindings(request: ReflectionFindingsRequest): Promise<IpcResult<import('../self-model/self-model-domain').ReflectionFinding[]>>
  }
  cognition: {
    getSettings(): Promise<IpcResult<CognitiveCoreSettings>>
    saveSettings(request: CognitiveSettingsRequest): Promise<IpcResult<CognitiveCoreSettings>>
    getFeelingState(): Promise<IpcResult<FeelingStateView>>
    clearHistory(): Promise<IpcResult<FeelingStateView>>
  }
  /**
   * Phase 2.4 continuity. Read-only except `completePendingItem`, which can
   * only mark an internal item as done: it never sends anything outward.
   */
  continuity: {
    listPendingItems(): Promise<IpcResult<import('../cognition/pending-items').PendingItem[]>>
    completePendingItem(request: PendingItemIdRequest): Promise<IpcResult<boolean>>
    decidePendingItem(request: PendingItemDecisionRequest): Promise<IpcResult<boolean>>
    readTurnContext(request: TurnContextRequest): Promise<IpcResult<import('../cognition/turn-context').CognitiveTurnContext | null>>
  }
  chat: {
    send(request: ChatRequest): Promise<IpcResult<ChatResult>>
    cancel(request: ConversationIdRequest): Promise<IpcResult<boolean>>
    onDelta(listener: (event: ChatStreamEvent) => void): () => void
  }
  memorySuggestions: {
    list(request: ConversationIdRequest): Promise<IpcResult<MemorySuggestion[]>>
    preview(request: MemoryProposalRequest): Promise<IpcResult<MemoryProposalPreview>>
    propose(request: MemoryProposalRequest): Promise<IpcResult<MemorySuggestion[]>>
    review(request: MemorySuggestionReviewRequest): Promise<IpcResult<MemorySuggestion[]>>
  }
  memories: {
    create(request: MemoryCreateRequest): Promise<IpcResult<MemoryRecord>>
    list(): Promise<IpcResult<MemoryRecord[]>>
    search(request: MemorySearchRequest): Promise<IpcResult<MemoryRecord[]>>
    history(request: MemoryIdRequest): Promise<IpcResult<MemoryRevisionRecord[]>>
    correct(request: MemoryCorrectRequest): Promise<IpcResult<MemoryRecord>>
    revoke(request: MemoryIdRequest): Promise<IpcResult<MemoryRecord>>
    restore(request: MemoryIdRequest): Promise<IpcResult<MemoryRecord>>
    delete(request: MemoryIdRequest): Promise<IpcResult<void>>
  }
  goals: {
    list(): Promise<IpcResult<GoalListItem[]>>
    create(request: GoalCreateRequest): Promise<IpcResult<GoalRecord>>
    prepare(request: GoalPrepareRequest): Promise<IpcResult<TaskRecord>>
    requestApproval(request: TaskIdRequest): Promise<IpcResult<ApprovalChallenge>>
    approveAndExecute(request: TaskIdRequest): Promise<IpcResult<TaskRecord>>
    rejectApproval(request: TaskIdRequest): Promise<IpcResult<TaskRecord>>
    cancelTask(request: TaskIdRequest): Promise<IpcResult<TaskRecord>>
    stop(request: GoalIdRequest): Promise<IpcResult<GoalRecord>>
    delete(request: GoalIdRequest): Promise<IpcResult<void>>
  }
  reminders: {
    getSnapshot(): Promise<IpcResult<ReminderSnapshot>>
    saveSettings(request: ReminderSettingsRequest): Promise<IpcResult<ReminderSnapshot>>
    pause(): Promise<IpcResult<ReminderSnapshot>>
    withdrawConsent(): Promise<IpcResult<ReminderSnapshot>>
    muteForOneHour(): Promise<IpcResult<ReminderSnapshot>>
    unmute(): Promise<IpcResult<ReminderSnapshot>>
    schedule(request: ReminderScheduleRequest): Promise<IpcResult<ReminderRecord>>
    reschedule(request: ReminderRescheduleRequest): Promise<IpcResult<ReminderRecord>>
    cancel(request: ReminderIdRequest): Promise<IpcResult<ReminderRecord>>
    clearHistory(): Promise<IpcResult<ReminderSnapshot>>
    onChanged(listener: () => void): () => void
  }
  backups: {
    export(): Promise<IpcResult<BackupExportOutcome>>
    preview(): Promise<IpcResult<BackupPreviewOutcome>>
    restore(request: BackupRestoreRequest): Promise<IpcResult<BackupRestoreOutcome>>
  }
}


declare global {
  interface Window {
    morrow: MorrowBridge
  }
}
