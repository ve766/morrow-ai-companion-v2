import type { MemoryRecord, MemorySourceCategory } from '../memory/memory-domain'
import type { CognitiveTurnRecord } from '../cognition/cognition'
import type { TurnEvaluation } from '../cognition/turn-evaluation'

export const DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-flash' as const
export const DEEPSEEK_PROVIDER_ID = 'deepseek' as const
export const LOCAL_PROVIDER_ID = 'local-openai' as const

/**
 * 讯飞星火 MaaS, OpenAI-compatible entrance. The `/v1` suffix is part of the
 * base URL: `/v1/chat/completions` and `/v1/models` are routed by the gateway
 * while `/v1/messages` is not (verified 2026-10-28: 401 for the routed paths,
 * 404 for the unrouted one).
 */
export const SPARK_PROVIDER_ID = 'spark' as const
// The shared real-model contract (docs/testing/shared-real-model-test-contract.md)
// pins Chat Completions to /v2. The adapter appends `/chat/completions`, so the
// base carries the version: /v1 produced a 200 with an empty completion for
// spark-x2.6, and the contract names /v2 explicitly.
export const SPARK_MAAS_BASE_URL = 'https://maas-api.cn-huabei-1.xf-yun.com/v2'

export type ProviderId = typeof DEEPSEEK_PROVIDER_ID | typeof LOCAL_PROVIDER_ID | typeof SPARK_PROVIDER_ID
export type ProviderClassKind = 'remote' | 'local'

export type Sensitivity = 'normal' | 'personal' | 'sensitive'
export type PersonalityDisagreementStyle = 'gentle' | 'balanced' | 'direct'
export type MemorySuggestionStatus = 'pending' | 'accepted' | 'rejected'

export interface ConversationRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  body: string
  createdAt: string
  sequence: number
  turnId: string
  cognitiveObservations?: CognitiveTurnRecord[]
}

export interface ConversationWithMessages {
  conversation: ConversationRecord
  messages: ConversationMessage[]
}

export interface ContextMemory {
  id: string
  content: string
  sourceCategory: MemorySourceCategory
  confidence: number
  sensitivity: Sensitivity
  updatedAt: string
  revision: number
  score: number
  /** `unresolved` means this entry disagrees with another delivered entry. */
  status?: 'active' | 'unresolved'
  /** Ids of delivered entries that state a different value for the same fact. */
  conflictWith?: string[]
}

/**
 * One unresolved disagreement inside the delivered set. It is computed from the
 * fact slots of the delivered entries, never from keywords in the reply.
 */
export interface ContextConflict {
  predicate: string
  memoryIds: string[]
  /** The distinct values the entries state, in delivery order. */
  values: string[]
}

export interface AssembledMemoryContext {
  text: string
  selected: ContextMemory[]
  omitted: number
  characterCount: number
  /** Present only when two delivered entries state different values. */
  conflicts?: ContextConflict[]
}

export interface ProviderConfigRecord {
  id: ProviderId
  providerClass: ProviderClassKind
  endpoint: string
  model: string
  enabled: boolean
  apiKeyConfigured: boolean
  updatedAt: string
}

export interface DeepSeekProviderConfigInput {
  providerId: ProviderId
  model: string
  enabled: boolean
  apiKey?: string
}

export interface LocalProviderConfigInput {
  providerId: typeof LOCAL_PROVIDER_ID
  endpoint: string
  model: string
  enabled: boolean
  apiKey?: string
}

export interface SparkProviderConfigInput {
  providerId: typeof SPARK_PROVIDER_ID
  /** A model id the account actually exposes; verified against GET /v1/models. */
  model: string
  enabled: boolean
  apiKey?: string
}

export type ProviderConfigInput = DeepSeekProviderConfigInput | LocalProviderConfigInput | SparkProviderConfigInput

export interface ProviderConnectionRequest {
  providerId: ProviderId
}

export interface PersonalityInput {
  warmth: number
  directness: number
  humor: number
  disagreementStyle: PersonalityDisagreementStyle
  systemRules: string
}

export interface PersonalityProfile extends PersonalityInput {
  version: number
  updatedAt: string
}

export interface PersonalityRevision {
  version: number
  warmth: number
  directness: number
  humor: number
  disagreementStyle: PersonalityDisagreementStyle
  systemRules: string
  createdAt: string
  changeType: 'user_edit' | 'restored'
}

export interface ChatRequest {
  conversationId: string
  requestId: string
  content: string
  includeSensitive?: boolean
}

export interface ChatPreview {
  action: 'chat' | 'connection-test' | 'memory-proposal'
  providerId: ProviderId
  endpoint: string
  model: string
  payloadSha256: string
  payloadCharacters: number
  includedMemories: Array<{ id: string; excerpt: string; sensitivity: Sensitivity }>
  maximumSensitivity: Sensitivity
}

export interface MemoryProposalPreview {
  action: 'memory-proposal'
  conversationId: string
  sourceMessageId: string
  providerId: ProviderId
  endpoint: string
  model: string
  payloadSha256: string
  payloadCharacters: number
}

export interface ChatResult {
  conversation: ConversationRecord
  userMessage: ConversationMessage
  assistantMessage: ConversationMessage
  includedMemoryCount: number
  /** Phase 2 ledger record: intent, evidence, payload, provider and answer outcome. */
  evaluation?: TurnEvaluation
}

export interface ChatStreamEvent {
  conversationId: string
  requestId: string
  delta: string
}

export interface ProviderConnectionResult {
  providerId: ProviderId
  model: string
  connected: boolean
}


export interface MemoryProposalRequest {
  conversationId: string
  sourceMessageId: string
}

export interface MemorySuggestion {
  id: string
  conversationId: string
  sourceMessageId: string
  claim: string
  sensitivity: Sensitivity
  status: MemorySuggestionStatus
  providerModel: string
  createdAt: string
  reviewedAt: string | null
  acceptedMemoryId: string | null
  acceptedContent: string | null
}

export interface MemorySuggestionReviewRequest {
  id: string
  decision: 'accept' | 'reject'
  content?: string
  sensitivity?: Sensitivity
}


export interface CompanionSnapshot {
  provider: ProviderConfigRecord
  personality: PersonalityProfile
  personalityHistory: PersonalityRevision[]
  conversations: ConversationRecord[]
  memories: MemoryRecord[]
}
