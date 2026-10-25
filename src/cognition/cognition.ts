import type { MemoryRecord } from '../memory/memory-domain'
import type { MemorySuggestion, PersonalityProfile } from '../shared/companion'

export const COGNITIVE_SCHEMA_VERSION = 1 as const
export const COGNITIVE_ANALYZER_VERSION = 'rules-v2' as const
export type CognitiveAnalyzerVersion = 'rules-v1' | typeof COGNITIVE_ANALYZER_VERSION

export const COGNITIVE_INTENTS = [
  'information_query',
  'explanation',
  'venting',
  'feedback',
  'correction',
  'exploration',
  'planning',
  'sharing',
  'uncertain'
] as const

export type CognitiveIntent = typeof COGNITIVE_INTENTS[number]
export type CognitiveStrategy = 'answer' | 'retrieve_memory' | 'clarify'
export type CognitiveUncertainty = 'low' | 'medium' | 'high' | 'not_scored'
export type CognitiveTopicSource = 'current' | 'previous_user_message' | 'none'
export type CognitiveConfidenceBasis = 'unscored' | 'unvalidated_rule_strength'
export type CognitiveRecordKind = 'intent' | 'memory' | 'personality' | 'memory_suggestion'
export type CognitiveRecordSource = 'local_rules' | 'user_explicit' | 'user_edited' | 'provider_proposal'
export type CognitiveRecordStatus = 'observation' | 'active' | 'candidate' | 'retracted' | 'historical'
export type CognitiveChangeReason =
  | 'rule_inference'
  | 'explicit_memory_entry'
  | 'explicit_memory_correction'
  | 'explicit_memory_retraction'
  | 'explicit_memory_restore'
  | 'explicit_memory_control'
  | 'user_controlled_personality_edit'
  | 'user_controlled_personality_restore'
  | 'model_proposal'
  | 'user_approved_proposal'
  | 'user_rejected_proposal'

export type CognitiveEvidenceReference =
  | { kind: 'conversation_message'; id: string; revision: null }
  | { kind: 'memory_revision'; id: string; revision: number }
  | { kind: 'personality_revision'; id: 'primary'; revision: number }
  | { kind: 'memory_suggestion'; id: string; revision: null }

export interface CognitiveEvidenceEnvelope {
  schemaVersion: typeof COGNITIVE_SCHEMA_VERSION
  recordKind: CognitiveRecordKind
  recordId: string
  source: CognitiveRecordSource
  status: CognitiveRecordStatus
  evidenceRefs: CognitiveEvidenceReference[]
  confidenceScore: number | null
  confidenceBasis: CognitiveConfidenceBasis
  uncertainty: CognitiveUncertainty
  requiresUserConfirmation: boolean
  revision: number | null
  changeReason: CognitiveChangeReason
}

export interface CognitiveTurnSignals {
  correction: boolean
  negation: boolean
  changedMind: boolean
  explicitGoal: boolean
  explicitConstraint: boolean
  explicitMemoryRequest: boolean
  explicitMemorySaveRequest: boolean
  explicitSelfFact: boolean
  topicSwitch: boolean
}

export interface CognitiveTurnAnalysis {
  schemaVersion: typeof COGNITIVE_SCHEMA_VERSION
  analyzerVersion: CognitiveAnalyzerVersion
  intent: CognitiveIntent
  alternatives: CognitiveIntent[]
  confidenceScore: number
  confidenceBasis: 'unvalidated_rule_strength'
  uncertainty: Exclude<CognitiveUncertainty, 'not_scored'>
  strategy: CognitiveStrategy
  topicSource: CognitiveTopicSource
  topicReferenceMessageId: string | null
  signals: CognitiveTurnSignals
  evidence: CognitiveEvidenceEnvelope
}

export interface CognitiveTurnRecord {
  attempt: number
  analyzedAt: string
  analysis: CognitiveTurnAnalysis
}

export interface CognitiveCoreSettings {
  enabled: boolean
  available: boolean
  updatedAt: string | null
  analyzerVersion: typeof COGNITIVE_ANALYZER_VERSION
}

export interface CognitiveHistoryMessage {
  id: string
  role: 'user' | 'assistant'
  body: string
}

const intentSet = new Set<string>(COGNITIVE_INTENTS)
const supportedCognitiveAnalyzerVersions = new Set<CognitiveAnalyzerVersion>(['rules-v1', COGNITIVE_ANALYZER_VERSION])
const quotedTextPattern = /"[^"\r\n]*"|“[^”\r\n]*”|‘[^’\r\n]*’|「[^」\r\n]*」|『[^』\r\n]*』|«[^»\r\n]*»|`[^`\r\n]*`|(?<![\p{L}\p{N}])'[^'\r\n]+'(?![\p{L}\p{N}])/gu
const reportedEnglishSpeechPattern = /\b(?:my\s+(?:friend|coworker|colleague|partner|mother|father|sister|brother)|someone|he|she|they|a\s+review|the\s+review|a\s+reviewer|the\s+reviewer)\s+(?:said|says|wrote|writes|texted|mentioned|reported|stated|claimed)\b[^.!?;。！？；\r\n]*(?:[.!?;。！？；]|$)/giu
const reportedChineseSpeechPattern = /(?:我(?:的)?(?:朋友|同事|伴侣|家人|母亲|父亲)|朋友|同事|伴侣|家人|有人|他|她|对方|评论者|这条评论|那条评论)\s*(?:说|提到|表示|写道|称)[^。！？!?；;\r\n]*(?:[。！？!?；;]|$)/gu

export function stripQuotedAndReportedText(value: string): string {
  return value
    .replace(quotedTextPattern, ' ')
    .replace(/^\s*>[^\r\n]*$/gmu, ' ')
    .replace(reportedEnglishSpeechPattern, ' ')
    .replace(reportedChineseSpeechPattern, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const envelopeKeys = [
  'schemaVersion', 'recordKind', 'recordId', 'source', 'status', 'evidenceRefs', 'confidenceScore',
  'confidenceBasis', 'uncertainty', 'requiresUserConfirmation', 'revision', 'changeReason'
].sort().join('|')
const turnKeys = [
  'schemaVersion', 'analyzerVersion', 'intent', 'alternatives', 'confidenceScore', 'confidenceBasis',
  'uncertainty', 'strategy', 'topicSource', 'topicReferenceMessageId', 'signals', 'evidence'
].sort().join('|')

function exactKeys(value: Record<string, unknown>, expected: string): boolean {
  return Object.keys(value).sort().join('|') === expected
}

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function isEvidenceReference(value: unknown): value is CognitiveEvidenceReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const reference = value as Record<string, unknown>
  if (typeof reference.kind !== 'string' || typeof reference.id !== 'string') return false
  if (reference.kind === 'conversation_message' || reference.kind === 'memory_suggestion') {
    return Object.keys(reference).sort().join('|') === 'id|kind|revision' && isValidUuid(reference.id) && reference.revision === null
  }
  if (reference.kind === 'memory_revision') {
    return Object.keys(reference).sort().join('|') === 'id|kind|revision' && isValidUuid(reference.id) && Number.isSafeInteger(reference.revision) && Number(reference.revision) > 0
  }
  if (reference.kind === 'personality_revision') {
    return Object.keys(reference).sort().join('|') === 'id|kind|revision' && reference.id === 'primary' && Number.isSafeInteger(reference.revision) && Number(reference.revision) > 0
  }
  return false
}

export function isCognitiveEvidenceEnvelope(value: unknown): value is CognitiveEvidenceEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!exactKeys(record, envelopeKeys) || record.schemaVersion !== COGNITIVE_SCHEMA_VERSION) return false
  if (!['intent', 'memory', 'personality', 'memory_suggestion'].includes(String(record.recordKind))) return false
  if (typeof record.recordId !== 'string' || record.recordId.length < 1 || record.recordId.length > 80) return false
  if (!['local_rules', 'user_explicit', 'user_edited', 'provider_proposal'].includes(String(record.source))) return false
  if (!['observation', 'active', 'candidate', 'retracted', 'historical'].includes(String(record.status))) return false
  if (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.length > 32 || !record.evidenceRefs.every(isEvidenceReference)) return false
  if (record.confidenceScore !== null && (!Number.isSafeInteger(record.confidenceScore) || Number(record.confidenceScore) < 0 || Number(record.confidenceScore) > 100)) return false
  if (!['unscored', 'unvalidated_rule_strength'].includes(String(record.confidenceBasis))) return false
  if (!['low', 'medium', 'high', 'not_scored'].includes(String(record.uncertainty))) return false
  if (typeof record.requiresUserConfirmation !== 'boolean') return false
  if (record.revision !== null && (!Number.isSafeInteger(record.revision) || Number(record.revision) < 1)) return false
  if (!['rule_inference', 'explicit_memory_entry', 'explicit_memory_correction', 'explicit_memory_retraction', 'explicit_memory_restore', 'explicit_memory_control', 'user_controlled_personality_edit', 'user_controlled_personality_restore', 'model_proposal', 'user_approved_proposal', 'user_rejected_proposal'].includes(String(record.changeReason))) return false
  if (record.confidenceBasis === 'unscored' && (record.confidenceScore !== null || record.uncertainty !== 'not_scored')) return false
  if (record.confidenceBasis === 'unvalidated_rule_strength' && (record.confidenceScore === null || record.uncertainty === 'not_scored')) return false
  if (record.recordKind === 'intent') {
    if (record.source !== 'local_rules' || record.status !== 'observation' || record.changeReason !== 'rule_inference' || record.revision !== null || record.requiresUserConfirmation !== true) return false
    const messages = record.evidenceRefs.filter((item) => item.kind === 'conversation_message')
    const memories = record.evidenceRefs.filter((item) => item.kind === 'memory_revision')
    const personalities = record.evidenceRefs.filter((item) => item.kind === 'personality_revision')
    if (messages.length < 1 || messages.length > 2 || messages[0]?.id !== record.recordId || memories.length > 25 || personalities.length > 1) return false
    if (record.evidenceRefs.some((item) => item.kind === 'memory_suggestion')) return false
    if (new Set(record.evidenceRefs.map((item) => `${item.kind}:${item.id}:${item.revision}`)).size !== record.evidenceRefs.length) return false
  }
  if (record.recordKind === 'memory') {
    if (record.source !== 'user_explicit' || !['active', 'retracted'].includes(String(record.status)) || !record.evidenceRefs.some((item) => item.kind === 'memory_revision' && item.id === record.recordId && item.revision === record.revision)) return false
  }
  if (record.recordKind === 'personality') {
    if (record.source !== 'user_edited' || record.status !== 'active' || record.recordId !== 'primary' || !record.evidenceRefs.some((item) => item.kind === 'personality_revision' && item.revision === record.revision)) return false
  }
  if (record.recordKind === 'memory_suggestion') {
    if (record.source !== 'provider_proposal' || !['candidate', 'historical', 'retracted'].includes(String(record.status))) return false
    if (record.requiresUserConfirmation !== (record.status === 'candidate')) return false
    if (!record.evidenceRefs.some((item) => item.kind === 'memory_suggestion' && item.id === record.recordId)) return false
  }
  return true
}

export function assertCognitiveEvidenceEnvelope(value: unknown): asserts value is CognitiveEvidenceEnvelope {
  if (!isCognitiveEvidenceEnvelope(value)) throw new TypeError('Invalid cognitive evidence envelope.')
}

export function isCognitiveTurnAnalysis(value: unknown): value is CognitiveTurnAnalysis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!exactKeys(record, turnKeys) || record.schemaVersion !== COGNITIVE_SCHEMA_VERSION || !supportedCognitiveAnalyzerVersions.has(String(record.analyzerVersion) as CognitiveAnalyzerVersion)) return false
  if (typeof record.intent !== 'string' || !intentSet.has(record.intent)) return false
  if (!Array.isArray(record.alternatives) || record.alternatives.length > 2 || !record.alternatives.every((item) => typeof item === 'string' && intentSet.has(item)) || new Set(record.alternatives).size !== record.alternatives.length || record.alternatives.includes(record.intent)) return false
  if (!Number.isSafeInteger(record.confidenceScore) || Number(record.confidenceScore) < 0 || Number(record.confidenceScore) > 100 || record.confidenceBasis !== 'unvalidated_rule_strength') return false
  if (!['low', 'medium', 'high'].includes(String(record.uncertainty))) return false
  if (!['answer', 'retrieve_memory', 'clarify'].includes(String(record.strategy))) return false
  if (!['current', 'previous_user_message', 'none'].includes(String(record.topicSource))) return false
  if (record.topicReferenceMessageId !== null && !isValidUuid(record.topicReferenceMessageId)) return false
  if ((record.topicSource === 'previous_user_message') !== (record.topicReferenceMessageId !== null)) return false
  if (!record.signals || typeof record.signals !== 'object' || Array.isArray(record.signals)) return false
  const signals = record.signals as Record<string, unknown>
  if (Object.keys(signals).sort().join('|') !== 'changedMind|correction|explicitConstraint|explicitGoal|explicitMemoryRequest|explicitMemorySaveRequest|explicitSelfFact|negation|topicSwitch') return false
  if (Object.values(signals).some((item) => typeof item !== 'boolean')) return false
  if (!isCognitiveEvidenceEnvelope(record.evidence) || record.evidence.recordKind !== 'intent' || record.evidence.recordId !== record.evidence.evidenceRefs[0]?.id || record.evidence.confidenceScore !== record.confidenceScore || record.evidence.uncertainty !== record.uncertainty) return false
  if (record.topicReferenceMessageId !== null && !record.evidence.evidenceRefs.some((item) => item.kind === 'conversation_message' && item.id === record.topicReferenceMessageId)) return false
  return true
}

export function assertCognitiveTurnAnalysis(value: unknown): asserts value is CognitiveTurnAnalysis {
  if (!isCognitiveTurnAnalysis(value)) throw new TypeError('Invalid cognitive turn analysis.')
}

export function isCognitiveTurnRecord(value: unknown, sourceMessageId?: string): value is CognitiveTurnRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!exactKeys(record, 'analysis|analyzedAt|attempt') || !Number.isSafeInteger(record.attempt) || Number(record.attempt) < 1 || Number(record.attempt) > 1_000_000) return false
  if (typeof record.analyzedAt !== 'string' || record.analyzedAt.length < 20 || record.analyzedAt.length > 40 || !record.analyzedAt.endsWith('Z')) return false
  const timestamp = Date.parse(record.analyzedAt)
  if (!Number.isFinite(timestamp)) return false
  try {
    if (new Date(timestamp).toISOString() !== record.analyzedAt) return false
  } catch {
    return false
  }
  if (!isCognitiveTurnAnalysis(record.analysis)) return false
  return sourceMessageId === undefined || record.analysis.evidence.recordId === sourceMessageId
}

export function assertCognitiveTurnRecord(value: unknown, sourceMessageId?: string): asserts value is CognitiveTurnRecord {
  if (!isCognitiveTurnRecord(value, sourceMessageId)) throw new TypeError('Invalid cognitive turn record.')
}

export function createIntentEvidence(
  sourceMessageId: string,
  topicReferenceMessageId: string | null,
  confidenceScore: number,
  uncertainty: Exclude<CognitiveUncertainty, 'not_scored'>,
  memoryRefs: readonly CognitiveEvidenceReference[] = [],
  personalityVersion?: number
): CognitiveEvidenceEnvelope {
  const evidenceRefs: CognitiveEvidenceReference[] = [
    { kind: 'conversation_message', id: sourceMessageId, revision: null },
    ...(topicReferenceMessageId ? [{ kind: 'conversation_message' as const, id: topicReferenceMessageId, revision: null }] : []),
    ...(personalityVersion === undefined ? [] : [{ kind: 'personality_revision' as const, id: 'primary' as const, revision: personalityVersion }]),
    ...memoryRefs
  ]
  const envelope: CognitiveEvidenceEnvelope = {
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    recordKind: 'intent',
    recordId: sourceMessageId,
    source: 'local_rules',
    status: 'observation',
    evidenceRefs,
    confidenceScore,
    confidenceBasis: 'unvalidated_rule_strength',
    uncertainty,
    requiresUserConfirmation: true,
    revision: null,
    changeReason: 'rule_inference'
  }
  assertCognitiveEvidenceEnvelope(envelope)
  return envelope
}

export function createMemoryEvidence(record: Pick<MemoryRecord, 'id' | 'revision' | 'status'> & { changeType?: 'created' | 'corrected' | 'retracted' | 'restored' }): CognitiveEvidenceEnvelope {
  const envelope: CognitiveEvidenceEnvelope = {
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    recordKind: 'memory',
    recordId: record.id,
    source: 'user_explicit',
    status: record.status === 'active' ? 'active' : 'retracted',
    evidenceRefs: [{ kind: 'memory_revision', id: record.id, revision: record.revision }],
    confidenceScore: null,
    confidenceBasis: 'unscored',
    uncertainty: 'not_scored',
    requiresUserConfirmation: false,
    revision: record.revision,
    changeReason: record.status === 'retracted'
      ? 'explicit_memory_retraction'
      : record.changeType === 'created'
        ? 'explicit_memory_entry'
        : record.changeType === 'corrected'
          ? 'explicit_memory_correction'
          : record.changeType === 'restored'
            ? 'explicit_memory_restore'
            : 'explicit_memory_control'
  }
  assertCognitiveEvidenceEnvelope(envelope)
  return envelope
}

export function createPersonalityEvidence(
  profile: Pick<PersonalityProfile, 'version'>,
  changeType: 'user_edit' | 'restored' = 'user_edit'
): CognitiveEvidenceEnvelope {
  const envelope: CognitiveEvidenceEnvelope = {
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    recordKind: 'personality',
    recordId: 'primary',
    source: 'user_edited',
    status: 'active',
    evidenceRefs: [{ kind: 'personality_revision', id: 'primary', revision: profile.version }],
    confidenceScore: null,
    confidenceBasis: 'unscored',
    uncertainty: 'not_scored',
    requiresUserConfirmation: false,
    revision: profile.version,
    changeReason: changeType === 'restored' ? 'user_controlled_personality_restore' : 'user_controlled_personality_edit'
  }
  assertCognitiveEvidenceEnvelope(envelope)
  return envelope
}

export function createMemorySuggestionEvidence(suggestion: Pick<MemorySuggestion, 'id' | 'sourceMessageId' | 'status'>): CognitiveEvidenceEnvelope {
  const status = suggestion.status === 'pending' ? 'candidate' : suggestion.status === 'rejected' ? 'retracted' : 'historical'
  const envelope: CognitiveEvidenceEnvelope = {
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    recordKind: 'memory_suggestion',
    recordId: suggestion.id,
    source: 'provider_proposal',
    status,
    evidenceRefs: [
      { kind: 'memory_suggestion', id: suggestion.id, revision: null },
      { kind: 'conversation_message', id: suggestion.sourceMessageId, revision: null }
    ],
    confidenceScore: null,
    confidenceBasis: 'unscored',
    uncertainty: 'not_scored',
    requiresUserConfirmation: status === 'candidate',
    revision: null,
    changeReason: suggestion.status === 'pending' ? 'model_proposal' : suggestion.status === 'accepted' ? 'user_approved_proposal' : 'user_rejected_proposal'
  }
  assertCognitiveEvidenceEnvelope(envelope)
  return envelope
}

export function withCognitiveContextEvidence(
  analysis: CognitiveTurnAnalysis,
  memoryRefs: readonly CognitiveEvidenceReference[],
  personalityVersion: number
): CognitiveTurnAnalysis {
  assertCognitiveTurnAnalysis(analysis)
  if (!Number.isSafeInteger(personalityVersion) || personalityVersion < 1 || memoryRefs.length > 25 || memoryRefs.some((reference) => reference.kind !== 'memory_revision')) {
    throw new TypeError('Invalid cognitive context evidence.')
  }
  const evidence = createIntentEvidence(
    analysis.evidence.recordId,
    analysis.topicReferenceMessageId,
    analysis.confidenceScore,
    analysis.uncertainty,
    memoryRefs,
    personalityVersion
  )
  const next = { ...analysis, evidence }
  assertCognitiveTurnAnalysis(next)
  return next
}

export function isCognitiveIntent(value: unknown): value is CognitiveIntent {
  return typeof value === 'string' && intentSet.has(value)
}

export function isCognitiveUuid(value: unknown): value is string {
  return isValidUuid(value)
}
