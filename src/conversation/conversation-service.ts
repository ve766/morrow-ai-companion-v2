import { randomUUID } from 'node:crypto'
import type { ConversationMessage, ConversationRecord, ConversationWithMessages } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { isCognitiveTurnRecord, type CognitiveTurnRecord } from '../cognition/cognition'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new ApplicationError('INVALID_INPUT')
  return value.toLowerCase()
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.trim().length === 0) || value.includes('\u0000') || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new ApplicationError('INVALID_INPUT')
  }
  return value
}

function timestamp(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || !value.endsWith('Z')) throw new ApplicationError('STORAGE_ERROR')
  return new Date(parsed).toISOString()
}

export class ConversationService {
  constructor(
    private readonly repository: SqliteConversationRepository,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID()
  ) {}

  create(title = '新对话'): ConversationRecord {
    const now = this.now()
    const record: ConversationRecord = {
      id: identifier(this.makeId()),
      title: boundedText(title, 120),
      createdAt: now,
      updatedAt: now
    }
    return this.repository.create(record)
  }

  list(limit = 50): ConversationRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApplicationError('INVALID_INPUT')
    return this.repository.list(limit)
  }

  read(conversationId: string): ConversationWithMessages {
    const result = this.repository.read(identifier(conversationId))
    if (!result) throw new ApplicationError('NOT_FOUND')
    return result
  }

  appendMessage(
    conversationId: string,
    role: ConversationMessage['role'],
    body: string,
    turnId: string,
    options: { messageId?: string; cognitiveObservation?: CognitiveTurnRecord; afterPersist?: (saved: ConversationWithMessages) => void } = {}
  ): ConversationWithMessages {
    const id = identifier(conversationId)
    const messageRole = role === 'user' || role === 'assistant' ? role : undefined
    if (!messageRole) throw new ApplicationError('INVALID_INPUT')
    const content = boundedText(body, 20_000)
    const turn = identifier(turnId)
    const before = this.read(id)
    const messageId = identifier(options.messageId ?? this.makeId())
    const observation = options.cognitiveObservation
    if (observation) {
      if (messageRole !== 'user' || !isCognitiveTurnRecord(observation) || observation.analysis.evidence.recordId !== messageId) {
        throw new ApplicationError('INVALID_INPUT')
      }
      const topicId = observation.analysis.topicReferenceMessageId
      if (topicId && !before.messages.some((message) => message.id === topicId && message.role === 'user')) {
        throw new ApplicationError('INVALID_INPUT')
      }
    }
    const title = messageRole === 'user' && before.messages.length === 0
      ? Array.from(content.trim()).slice(0, 48).join('')
      : undefined
    const now = this.now()
    return this.repository.append({
      id: messageId,
      conversationId: id,
      role: messageRole,
      body: content,
      createdAt: now,
      turnId: turn
    }, now, title, observation, options.afterPersist)
  }

  delete(conversationId: string): void {
    if (!this.repository.delete(identifier(conversationId))) throw new ApplicationError('NOT_FOUND')
  }

  private now(): string {
    return timestamp(this.clock())
  }
}
