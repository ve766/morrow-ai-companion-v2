import type { MemoryRecord } from '../memory/memory-domain'
import type { CognitiveTurnRecord } from '../cognition/cognition'

export const DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-flash' as const
export const DEEPSEEK_PROVIDER_ID = 'deepseek' as const

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
  sensitivity: Sensitivity
  updatedAt: string
  revision: number
  score: number
}

export interface AssembledMemoryContext {
  text: string
  selected: ContextMemory[]
  omitted: number
  characterCount: number
}

export interface ProviderConfigRecord {
  id: typeof DEEPSEEK_PROVIDER_ID
  providerClass: 'remote'
  endpoint: typeof DEEPSEEK_API_BASE_URL
  model: typeof DEEPSEEK_MODEL
  enabled: boolean
  apiKeyConfigured: boolean
  updatedAt: string
}

export interface ProviderConfigInput {
  model: typeof DEEPSEEK_MODEL
  enabled: boolean
  apiKey?: string
}

export interface ProviderConnectionRequest {
  providerId: typeof DEEPSEEK_PROVIDER_ID
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
  providerId: typeof DEEPSEEK_PROVIDER_ID
  endpoint: typeof DEEPSEEK_API_BASE_URL
  model: typeof DEEPSEEK_MODEL
  payloadSha256: string
  payloadCharacters: number
  includedMemories: Array<{ id: string; excerpt: string; sensitivity: Sensitivity }>
  maximumSensitivity: Sensitivity
}

export interface MemoryProposalPreview {
  action: 'memory-proposal'
  conversationId: string
  sourceMessageId: string
  providerId: typeof DEEPSEEK_PROVIDER_ID
  endpoint: typeof DEEPSEEK_API_BASE_URL
  model: typeof DEEPSEEK_MODEL
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
  providerId: typeof DEEPSEEK_PROVIDER_ID
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
