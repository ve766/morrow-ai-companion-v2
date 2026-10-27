import type { MemoryRecord, MemorySourceCategory } from '../memory/memory-domain'
import type { CognitiveTurnRecord } from '../cognition/cognition'

export const DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-flash' as const
export const DEEPSEEK_PROVIDER_ID = 'deepseek' as const
export const LOCAL_PROVIDER_ID = 'local-openai' as const

export type ProviderId = typeof DEEPSEEK_PROVIDER_ID | typeof LOCAL_PROVIDER_ID
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
  // Why this record entered the request. 'topic' means it shares terms with the
  // current turn; 'context' means it shares nothing with this turn but is
  // about the recent conversation; 'continuity' means it carries no topical
  // overlap at all and is included only so the companion does not treat the
  // user as a stranger. The prompt labels all three.
  match: 'topic' | 'context' | 'continuity'
  // True when the record has gone past the staleness window for its volatility
  // class without a fresh user confirmation. Stale evidence stays retrievable
  // but must be presented to the model as possibly outdated, not as fact.
  stale?: boolean
  // How fast this kind of fact normally changes. A favourite food and a job
  // title do not share one expiry window.
  volatility?: 'stable' | 'volatile' | 'unknown'
  // Age in whole days at assembly time, so the request itself carries the
  // evidence behind `stale` instead of only a boolean.
  ageDays?: number
  // Entries in the same group may contradict each other. The model is told to
  // surface the conflict, not to silently pick one.
  conflictGroup?: number
}

export interface AssembledMemoryContext {
  text: string
  selected: ContextMemory[]
  omitted: number
  characterCount: number
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
  providerId: typeof DEEPSEEK_PROVIDER_ID
  model: typeof DEEPSEEK_MODEL
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

export type ProviderConfigInput = DeepSeekProviderConfigInput | LocalProviderConfigInput

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
