import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_PROVIDER_ID } from '../shared/companion'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EventLogService } from '../persistence/event-log'
import { MemorySecretStore } from '../security/secrets'
import { InterestService, SqliteInterestRepository } from '../self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../self-model/self-model-service'
import { ReflectionService, SqliteReflectionRepository } from '../self-model/reflection-service'
import type { ProviderConsent, ProviderConsentPreview } from '../providers/provider-policy'

const directories: string[] = []
const databases: SqliteDatabase[] = []
const servers: Server[] = []

interface CapturedRequest {
  url: string
  body: { messages: Array<{ role: string; content: string }> }
}

function startLocalModelServer(): { raw: Server; requests: CapturedRequest[]; close: () => Promise<void> } {
  const requests: CapturedRequest[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push({ url: request.url ?? '', body: JSON.parse(raw) as CapturedRequest['body'] })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ model: 'loop-model', choices: [{ delta: { content: '好的。' } }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  servers.push(server)
  return { raw: server, requests, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function approve(preview: ProviderConsentPreview): ProviderConsent {
  const approvedAt = new Date()
  return {
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
    includeSensitive: preview.maximumSensitivity === 'sensitive'
  }
}

function buildStack(database: SqliteDatabase) {
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events }, events)
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async (preview) => approve(preview),
    selfModelLoop: { events, interests, selfModel }
  })
  return { events, memories, conversations, interests, selfModel, reflection, companion }
}

let tick = 0
const nextTimestamp = (): string => new Date(Date.parse('2026-10-25T10:00:00.000Z') + (tick++) * 60_000).toISOString()

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  for (const database of databases.splice(0)) {
    try {
      database.close()
    } catch {
      continue
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('cognitive closed loop over a real loopback provider', () => {
  it('feeds interests and self-knowledge from completed turns into the next request context', async () => {
    const server = startLocalModelServer()
    const url = await listen(server.raw)
    const directory = mkdtempSync(join(tmpdir(), 'morrow-cognitive-loop-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)
    const stack = buildStack(database)
    try {
      stack.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'loop-model', enabled: true })
      stack.companion.saveCognitiveSettings({ enabled: true })

      // Conversation 1: recurring topic + an explicit self fact about the assistant.
      const conversationA = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversationA.id, requestId: randomUUID(), content: '我们来聊聊天文学吧，最近系外行星很有意思。', includeSensitive: false }, () => {})
      await stack.companion.sendChat({ conversationId: conversationA.id, requestId: randomUUID(), content: '记住：你说话总是太长，我喜欢简短回答。', includeSensitive: false }, () => {})

      // Conversation 2: the same topic from an independent conversation.
      const conversationB = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversationB.id, requestId: randomUUID(), content: '天文学的话题我想继续。', includeSensitive: false }, () => {})
      await stack.companion.sendChat({ conversationId: conversationB.id, requestId: randomUUID(), content: '天文学里你最喜欢什么？', includeSensitive: false }, () => {})

      // The long-term layer observed the topic across two conversations.
      const interests = stack.interests.list()
      expect(interests.length).toBeGreaterThan(0)
      const promoted = interests.find((interest) => interest.status === 'active')
      expect(promoted).toBeDefined()
      expect(promoted?.conversationCount).toBeGreaterThanOrEqual(2)

      // The explicit self fact became a self-model entry with message evidence.
      const selfFacts = stack.selfModel.list({ status: 'active' })
      expect(selfFacts.some((entry) => entry.kind === 'fact' && entry.statement.includes('简短回答'))).toBe(true)

      // Scenario G evidence: the NEXT request payload carries the interest
      // block, distinguishable from plain history, with the confidence framing.
      await stack.companion.sendChat({ conversationId: conversationB.id, requestId: randomUUID(), content: '继续。', includeSensitive: false }, () => {})
      const chatRequests = server.requests.filter((request) => request.url.endsWith('/chat/completions'))
      const lastSystem = chatRequests.at(-1)?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(lastSystem).toContain('Bounded long-term attention signal')
      expect(lastSystem).toContain(promoted!.label)
      // earlier requests (before promotion) did not contain the block
      const firstSystem = chatRequests[0]?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(firstSystem).not.toContain('Bounded long-term attention signal')

      // The unified journal traces the whole chain.
      const journal = stack.events.list({ ascending: true })
      expect(journal.some((event) => event.eventType === 'memory.created')).toBe(false) // no explicit memory saved in this flow
      expect(journal.some((event) => event.eventType === 'interest.observed')).toBe(true)
      expect(journal.some((event) => event.eventType === 'interest.promoted')).toBe(true)
      expect(journal.some((event) => event.eventType === 'selfmodel.recorded' && event.actor === 'user')).toBe(true)
      expect(journal.some((event) => event.eventType === 'feeling.event_applied')).toBe(true)

      // Reflection (bounded, on demand) examines the journal and reports;
      // an unverified inference is expected to surface as a consistency note.
      stack.selfModel.record({ kind: 'inference', statement: '推断：用户可能对系外行星特别感兴趣', confidence: 40 })
      const run = stack.reflection.run('manual')
      expect('skipped' in run).toBe(false)
      if (!('skipped' in run)) {
        expect(run.findingsCount).toBeGreaterThan(0)
        const findings = stack.reflection.findings(run.id)
        expect(findings.some((finding) => finding.kind === 'consistency_note')).toBe(true)
      }
    } finally {
      await server.close()
    }
  })

  it('withholds verbatim user statements unless the turn is authorised for sensitive content', async () => {
    const server = startLocalModelServer()
    const url = await listen(server.raw)
    const directory = mkdtempSync(join(tmpdir(), 'morrow-selfmodel-gate-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)
    const stack = buildStack(database)
    try {
      stack.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'loop-model', enabled: true })
      stack.companion.saveCognitiveSettings({ enabled: true })
      // The raw text a user would keep out by leaving "allow sensitive
      // memories" unchecked. It reaches the self-model verbatim because
      // `explicitSelfFact` matches "我确诊", and it carries no sensitivity label.
      const statement = '我确诊了抑郁症，正在服药，不想让任何模型知道'
      stack.selfModel.record({ kind: 'fact', statement, confidence: 55 })
      // Three observations across two conversations, which is what promotion
      // requires; a single candidate would leave the block empty and the
      // assertion below vacuous.
      const firstConversation = stack.companion.createConversation()
      const secondConversation = stack.companion.createConversation()
      for (const [index, conversationId] of [firstConversation.id, secondConversation.id, firstConversation.id].entries()) {
        stack.interests.observe({
          conversationId,
          messageId: randomUUID(),
          occurredAt: new Date(Date.parse('2026-10-25T10:00:00.000Z') + index * 60_000).toISOString(),
          topicText: '天文学最近很有意思'
        })
      }
      expect(stack.interests.list().some((record) => record.status === 'active')).toBe(true)

      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '今天感觉怎么样？', includeSensitive: false }, () => {})
      const withoutConsent = server.requests.at(-1)?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      // The verbatim channel is closed, and closing it did not close the
      // derived-topic channel as a side effect.
      expect(withoutConsent).not.toContain('抑郁症')
      expect(withoutConsent).not.toContain('Unconfirmed user statements')
      expect(withoutConsent).toContain('Bounded long-term attention signal')

      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '今天感觉怎么样？', includeSensitive: true }, () => {})
      const withConsent = server.requests.at(-1)?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      // With consent the statement is present, and it is labelled as quoted
      // user text rather than as the companion's own self-knowledge.
      expect(withConsent).toContain('抑郁症')
      expect(withConsent).toContain('not self-knowledge')
      expect(withConsent).not.toContain('self-knowledge awaiting user confirmation')
    } finally {
      await server.close()
    }
  })

  it('withholds a sensitive interest from the serialized request unless the turn allows it', async () => {
    const server = startLocalModelServer()
    const url = await listen(server.raw)
    const directory = mkdtempSync(join(tmpdir(), 'morrow-interest-gate-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)
    const stack = buildStack(database)
    try {
      stack.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'loop-model', enabled: true })
      stack.companion.saveCognitiveSettings({ enabled: true })
      const first = stack.companion.createConversation()
      const second = stack.companion.createConversation()
      const observe = (conversationId: string, topicText: string, offset: number): void => {
        stack.interests.observe({
          conversationId,
          messageId: randomUUID(),
          occurredAt: new Date(Date.parse('2026-10-25T10:00:00.000Z') + offset * 60_000).toISOString(),
          topicText
        })
      }
      // Two topics, each promoted through the real lifecycle (three
      // observations across two conversations). One is sensitive, one is not,
      // so the assertion can prove the gate is targeted rather than the whole
      // long-term layer being dropped.
      for (const [index, conversationId] of [first.id, first.id, second.id].entries()) observe(conversationId, '抑郁症让我很难受', index)
      for (const [index, conversationId] of [first.id, first.id, second.id].entries()) observe(conversationId, '天文学最近很有意思', index + 10)
      expect(stack.interests.list().filter((record) => record.status === 'active')).toHaveLength(2)

      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '今天感觉怎么样？', includeSensitive: false }, () => {})
      const withoutConsent = server.requests.at(-1)?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(withoutConsent).toContain('Bounded long-term attention signal')
      expect(withoutConsent).toContain('天文')
      expect(withoutConsent).not.toContain('抑郁')

      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '今天感觉怎么样？', includeSensitive: true }, () => {})
      const withConsent = server.requests.at(-1)?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(withConsent).toContain('抑郁')
    } finally {
      await server.close()
    }
  })

  it('does not turn a question about a topic into a personal interest', async () => {
    const server = startLocalModelServer()
    const url = await listen(server.raw)
    const directory = mkdtempSync(join(tmpdir(), 'morrow-question-interest-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)
    const stack = buildStack(database)
    try {
      stack.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'loop-model', enabled: true })
      stack.companion.saveCognitiveSettings({ enabled: true })
      const conversation = stack.companion.createConversation()
      // Asking about a condition is not having it. No interest row may appear.
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '抑郁症一般怎么治疗？', includeSensitive: false }, () => {})
      expect(stack.interests.list()).toEqual([])

      // A declarative statement about the user still forms a sensitive topic.
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我最近抑郁得厉害。', includeSensitive: false }, () => {})
      const recorded = stack.interests.list()
      expect(recorded).toHaveLength(1)
      expect(recorded[0]?.sensitivity).toBe('sensitive')
    } finally {
      await server.close()
    }
  })

  it('restores interests, self-model and journal across restart without duplicating evidence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-cognitive-restart-'))
    directories.push(directory)
    const path = join(directory, 'morrow.sqlite3')
    const firstDatabase = SqliteDatabase.open(path)
    databases.push(firstDatabase)
    const stack = buildStack(firstDatabase)
    const conversation = stack.companion.createConversation()
    stack.interests.observe({ conversationId: conversation.id, messageId: '22222222-2222-4111-8111-111111111111', occurredAt: nextTimestamp(), topicText: '天文学很有意思' })
    stack.interests.observe({ conversationId: conversation.id, messageId: '22222222-2222-4111-8111-111111111111', occurredAt: nextTimestamp(), topicText: '还是天文学有意思' })
    stack.selfModel.record({ kind: 'fact', statement: '用户偏好简短回答', confidence: 55 })

    const eventsBefore = stack.events.count()
    const interestsBefore = stack.interests.list()
    firstDatabase.close()

    const reopened = SqliteDatabase.open(path)
    databases.push(reopened)
    const restored = buildStack(reopened)
    expect(restored.interests.list()).toEqual(interestsBefore)
    expect(restored.selfModel.list({ status: 'active' })).toHaveLength(1)
    expect(restored.events.count()).toBe(eventsBefore)

    // Observing again across a NEW conversation promotes instead of duplicating.
    const secondConversation = restored.companion.createConversation()
    restored.interests.observe({ conversationId: secondConversation.id, messageId: '33333333-3333-4111-8111-111111111111', occurredAt: nextTimestamp(), topicText: '天文学的进展真快' })
    restored.interests.observe({ conversationId: secondConversation.id, messageId: '33333333-3333-4111-8111-111111111111', occurredAt: nextTimestamp(), topicText: '天文学新闻真多' })
    const promoted = restored.interests.list().find((interest) => interest.status === 'active')
    expect(promoted).toBeDefined()
    expect(promoted?.evidenceCount).toBe(4)
    expect(restored.interests.list().filter((interest) => interest.label === promoted?.label)).toHaveLength(1)
  })
})
