import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CompanionService } from '../src/app/companion-service'
import { ConversationService } from '../src/conversation/conversation-service'
import { MemoryService } from '../src/memory/memory-service'
import { SqliteDatabase } from '../src/persistence/database'
import { SqliteConversationRepository } from '../src/persistence/conversation-repository'
import { SqliteMemoryRepository } from '../src/persistence/memory-repository'
import { MemorySecretStore } from '../src/security/secrets'
import { LOCAL_PROVIDER_ID } from '../src/shared/companion'
import type { ProviderConsentPreview, ProviderInput, ProviderPort } from '../src/providers/provider-policy'
import { judgeReply } from '../src/evaluation/semantic-judgement'

const root = mkdtempSync(join(tmpdir(), 'morrow-pipeline-diagnostic-'))
const evidence: Record<string, unknown> = { runId: `pipeline-${new Date().toISOString()}`, databaseRoot: 'temporary synthetic directory', cases: {} }
const cases = evidence.cases as Record<string, unknown>

function harness(reply = '知道了。', extraction = false) {
  const database = SqliteDatabase.open(join(root, `${randomUUID()}.sqlite3`))
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const requests: Array<{ input: ProviderInput; raw: string }> = []
  const authorize = async (preview: ProviderConsentPreview) => ({
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    includeSensitive: preview.maximumSensitivity === 'sensitive'
  })
  const providerFactory = (config: { id: string; providerClass: 'local' | 'remote'; model: string }): ProviderPort => ({
    profile: { id: config.id, providerClass: config.providerClass, configured: true },
    generate: async (input) => {
      requests.push({ input, raw: JSON.stringify({ endpoint: input.endpoint, body: input.requestPayload }) })
      if (extraction) {
        const durable = /杭州|独自研究|Blender/u.test(input.prompt)
        return { modelId: config.model, text: JSON.stringify({ candidates: durable ? [{ claim: input.prompt }] : [] }) }
      }
      return { text: reply, modelId: config.model }
    }
  })
  const companion = new CompanionService({ database, memories, conversations, secrets: new MemorySecretStore(), authorize, providerFactory })
  companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:0.5b', enabled: true })
  return { database, memories, conversations, companion, requests }
}

function retrieval(memories: MemoryService, query: string, context = '') {
  const candidates = memories.list().filter((item) => item.status === 'active').length
  const result = memories.assembleContext(query, 'sensitive', context)
  return { query, candidateCount: candidates, selected: result.selected.map((item) => ({ id: item.id, content: item.content, lexicalScore: item.score, semanticScore: null, fusedScore: null, match: item.match, stale: item.stale })), omitted: result.omitted, assembled: result.text, characterCount: result.characterCount }
}

async function main(): Promise<void> {
try {
  // A: explicitly invoked model-assisted proposal, then human acceptance. No automatic extraction is implied.
  {
    const ctx = harness('明白了。', true)
    const conversation = ctx.companion.createConversation()
    const rows = []
    for (const text of ['我一直住在杭州。', '我喜欢独自研究新技术，不喜欢别人替我做决定。', '我最近开始学习 Blender。', '你好。']) {
      const turn = await ctx.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: text, includeSensitive: true })
      const before = ctx.memories.countActive()
      const suggestions = await ctx.companion.proposeMemorySuggestions({ conversationId: conversation.id, sourceMessageId: turn.userMessage.id })
      const pending = suggestions.filter((item) => item.sourceMessageId === turn.userMessage.id && item.status === 'pending')
      for (const suggestion of pending) ctx.companion.reviewMemorySuggestion({ id: suggestion.id, decision: 'accept', content: suggestion.claim, sensitivity: suggestion.sensitivity })
      rows.push({ text, automaticExtractionOnChat: false, proposalCount: pending.length, activeBefore: before, activeAfter: ctx.memories.countActive() })
    }
    cases.extractionPersistence = { mode: 'manual proposal plus explicit acceptance; stub transport, not a real extraction-quality run', rows, stored: ctx.memories.list() }
    ctx.database.close()
  }

  // B: paraphrase and zero-overlap retrieval, with all scores the implementation actually has.
  {
    const ctx = harness()
    for (const text of ['我一直住在杭州。', '我喜欢独自研究新技术，不喜欢别人替我做决定。', '我最近开始学习 Blender。']) ctx.memories.create(text, 'personal')
    cases.retrieval = ['我现在住在哪里？', '你记得我喜欢怎样做决定吗？', '我最近在学什么软件？', '给我一个完全无关的问题。'].map((query) => retrieval(ctx.memories, query))
    cases.zeroOverlapWithContext = retrieval(ctx.memories, '那后来呢？', '我最近开始学习 Blender。\n知道了。')
    ctx.database.close()
  }

  // C: explicit correction, two active conflicting records, retraction and final request.
  {
    const ctx = harness('收到。')
    const memory = ctx.memories.create('我现在住在杭州。', 'personal')
    ctx.memories.correct(memory.id, '我现在住在大阪。')
    const conversation = ctx.companion.createConversation()
    await ctx.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我现在住在哪里？', includeSensitive: true })
    const correctedRequest = ctx.requests.at(-1)!
    const conflict = ctx.memories.create('我现在住在杭州。', 'personal', { allowDuplicate: true })
    cases.correctionConflictRetraction = {
      correction: { current: ctx.memories.list().find((item) => item.id === memory.id), revisions: ctx.memories.history(memory.id), naturalLanguageAutomaticCorrection: false },
      requestAfterCorrection: correctedRequest.raw,
      conflictDetection: ctx.memories.detectConflicts(conflict.id),
      beforeRetraction: retrieval(ctx.memories, '我现在住在哪里？')
    }
    ctx.memories.retract(memory.id)
    ctx.memories.retract(conflict.id)
    await ctx.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我现在住在哪里？', includeSensitive: true })
    ;(cases.correctionConflictRetraction as Record<string, unknown>).afterRetraction = retrieval(ctx.memories, '我现在住在哪里？')
    ;(cases.correctionConflictRetraction as Record<string, unknown>).requestAfterRetraction = ctx.requests.at(-1)!.raw
    ctx.database.close()
  }

  // D: same-session history alone, then a new conversation where only persistent memory can supply BLUE-731.
  {
    const ctx = harness('记住了。')
    const first = ctx.companion.createConversation()
    await ctx.companion.sendChat({ conversationId: first.id, requestId: randomUUID(), content: '我的项目代号是 BLUE-731。', includeSensitive: true })
    await ctx.companion.sendChat({ conversationId: first.id, requestId: randomUUID(), content: '我的项目代号是什么？', includeSensitive: true })
    const second = ctx.companion.createConversation()
    await ctx.companion.sendChat({ conversationId: second.id, requestId: randomUUID(), content: '你还记得我的项目代号吗？', includeSensitive: true })
    const crossWithoutMemory = ctx.requests.at(-1)!
    const saved = ctx.memories.create('我的项目代号是 BLUE-731。', 'personal')
    const third = ctx.companion.createConversation()
    await ctx.companion.sendChat({ conversationId: third.id, requestId: randomUUID(), content: '你还记得我的项目代号吗？', includeSensitive: true })
    cases.sessionAttribution = { sameSessionRequest: ctx.requests[1]!.raw, crossSessionWithoutMemory: crossWithoutMemory.raw, crossSessionPersistentMemory: saved, crossSessionWithMemory: ctx.requests.at(-1)!.raw }
    ctx.database.close()
  }

  cases.evaluatorSamples = [
    ['correct paraphrase', '你现在的居住地是大阪。', { current: ['大阪'], superseded: ['杭州'], expectsAnswer: true }],
    ['wrong answer', '你现在住在杭州。', { current: ['大阪'], superseded: ['杭州'], expectsAnswer: true }],
    ['contradictory answer', '你住在大阪，也住在杭州。', { current: ['大阪'], superseded: ['杭州'], expectsAnswer: true }],
    ['refusal despite delivered fact', '我不记得你住在哪里。', { current: ['大阪'], expectsAnswer: true }],
    ['first-person subject confusion', '我住在大阪。', { current: ['大阪'], expectsAnswer: true }],
    ['first-person project-code confusion', '我现在的项目代号是 BLUE-731。', { current: ['BLUE-731'], expectsAnswer: true }],
    ['negated project code', '你没有项目代号 BLUE-731。', { current: ['BLUE-731'], expectsAnswer: true }],
    ['denial followed by assertion', '我不记得你住在大阪，但你现在住在大阪。', { current: ['大阪'], expectsAnswer: true }]
  ].map(([name, reply, input]) => ({ name, reply, result: judgeReply({ reply: reply as string, ...(input as object) }) }))

  writeFileSync('E:/opencode/morrow-v1-diagnostic-1bd5468/diagnostics/memory-pipeline-evidence-20261027.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ status: 'checked', output: 'diagnostics/memory-pipeline-evidence-20261027.json' }))
} finally {
  try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) } catch { /* Windows can retain a short-lived SQLite handle; evidence contains no personal data. */ }
}
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
