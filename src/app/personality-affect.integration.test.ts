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
import { AffectLoopService } from '../affective-state/affect-loop'
import type { ProviderConsent, ProviderConsentPreview } from '../providers/provider-policy'

const directories: string[] = []
const databases: SqliteDatabase[] = []
const servers: Server[] = []

interface CapturedRequest { url: string; body: { messages: Array<{ role: string; content: string }> } }

function startServer(): { raw: Server; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push({ url: request.url ?? '', body: JSON.parse(raw) as CapturedRequest['body'] })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ model: 'affect-model', choices: [{ delta: { content: '好的，我明白了。' } }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  servers.push(server)
  return { raw: server, requests }
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

function approve(preview: ProviderConsentPreview, at: string): ProviderConsent {
  return {
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt: at,
    expiresAt: new Date(Date.parse(at) + 60_000).toISOString(),
    includeSensitive: preview.maximumSensitivity === 'sensitive'
  }
}

function buildStack(database: SqliteDatabase, clock: () => string) {
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const affect = new AffectLoopService(database, clock, () => randomUUID(), events)
  const companion = new CompanionService({
    database, memories, conversations, secrets: new MemorySecretStore(),
    authorize: async (preview) => approve(preview, clock()), clock,
    selfModelLoop: { events, interests, selfModel, affect }
  })
  return { events, memories, conversations, interests, selfModel, affect, companion }
}

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const database of databases.splice(0)) { try { database.close() } catch { /* already closed */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('affect and trait production path', () => {
  it('puts a real emotion projection into the provider payload and persists it with the turn', async () => {
    const server = startServer()
    const url = await listen(server.raw)
    const directory = mkdtempSync(join(tmpdir(), 'morrow-affect-prod-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)
    let now = '2026-11-01T00:00:00.000Z'
    const stack = buildStack(database, () => now)
    try {
      stack.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'affect-model', enabled: true })
      stack.companion.saveCognitiveSettings({ enabled: true })
      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: 'Thanks, that answer was very helpful and clear.', includeSensitive: false }, () => {})
      const system = server.requests[0]?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(system).toContain("Morrow's current internal affect projection")
      expect(system).toContain('joy')
      const events = stack.affect.emotions.listEvents()
      expect(events.length).toBe(1)
      expect(events[0]!.accepted.some((candidate) => candidate.family === 'joy')).toBe(true)
      expect(stack.affect.emotions.snapshot(now).emotions.some((emotion) => emotion.family === 'joy')).toBe(true)
      // An unrelated next topic must not receive the prior emotion block.
      now = '2026-11-01T00:01:00.000Z'
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '请解释一下太阳系外行星的轨道共振。', includeSensitive: false }, () => {})
      const nextSystem = server.requests[1]?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(nextSystem).not.toContain("Morrow's current internal affect projection")
    } finally {
      await new Promise<void>((resolve) => server.raw.close(() => resolve()))
    }
  })

  it('promotes a responsibility trait from repeated independent corrections and reads it next turn', async () => {
    const server = startServer()
    const url = await listen(server.raw)
    const directory = mkdtempSync(join(tmpdir(), 'morrow-trait-prod-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)
    let now = '2026-11-02T00:00:00.000Z'
    const stack = buildStack(database, () => now)
    try {
      stack.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'affect-model', enabled: true })
      stack.companion.saveCognitiveSettings({ enabled: true })
      const conversations = [stack.companion.createConversation(), stack.companion.createConversation(), stack.companion.createConversation()]
      const corrections = [
        'That answer was not helpful. Please recheck the database conclusion.',
        'Your answer is wrong about the deployment plan. Please recheck it.'
      ]
      for (let index = 0; index < 6; index += 1) {
        await stack.companion.sendChat({ conversationId: conversations[index % 3]!.id, requestId: randomUUID(), content: corrections[index % corrections.length]!, includeSensitive: false }, () => {})
        now = new Date(Date.parse(now) + 25 * 3_600_000).toISOString()
      }
      const trait = stack.affect.traits.current('responsibility')
      expect(trait).not.toBeNull()
      expect(trait!.status).toBe('active')
      expect(trait!.independentContexts).toBeGreaterThanOrEqual(3)
      const activeConversation = conversations[0]!
      await stack.companion.sendChat({ conversationId: activeConversation.id, requestId: randomUUID(), content: 'Please continue the database discussion.', includeSensitive: false }, () => {})
      const activeSystem = server.requests.at(-1)?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(activeSystem).toContain("Morrow's evidence-gated traits")
      expect(activeSystem).toContain('responsibility')
      // A further Morrow-owned failure is a traceable counter-observation; it
      // must not be silently discarded just because a positive observation is
      // written for the same turn.
      await stack.companion.sendChat({ conversationId: conversations[1]!.id, requestId: randomUUID(), content: corrections[0]!, includeSensitive: false }, () => {})
      const afterCounter = stack.affect.traits.current('responsibility')!
      expect(afterCounter.counterEvidenceRefs.length).toBeGreaterThan(0)
      expect(['weakened', 'candidate']).toContain(afterCounter.status)
      now = new Date(Date.parse(now) + 25 * 3_600_000).toISOString()
      // After the counter-evidence the trait is weakened, so it must not be
      // injected as an active trait on the next turn.
      const conversation = conversations[0]!
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: 'Please recheck the database conclusion again.', includeSensitive: false }, () => {})
      const lastSystem = server.requests.at(-1)?.body.messages.find((message) => message.role === 'system')?.content ?? ''
      expect(lastSystem).not.toContain("Morrow's evidence-gated traits")
    } finally {
      await new Promise<void>((resolve) => server.raw.close(() => resolve()))
    }
  })
})
