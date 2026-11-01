/**
 * Stage 4-A — the cat-name continuity story, scripted and live.
 *
 * Scripted (default): drives the production chain through the four sessions
 * of the fixture and asserts the ledger/prompt state at each step. Proves
 * the wiring, never the model.
 *
 * Live (`--live`, needs MORROW_TEST_API_KEY): replays the three real-model
 * scenarios on the contract provider, records every raw reply, the prompt
 * digest, the evidence delivered and the objective signals. Human review is
 * separate and stays PENDING.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildStack, head, systemText, type Stack } from '../stage-3/runner/harness'
import { buildProviderStack, commitOrUnknown, payloadDigest, readKeyOrNull, selectProvider, writeBlockedNoSecret } from '../stage-3/shared/real-provider'

interface Fixture {
  version: string
  sessions: Array<{ id: string; turns: Array<{ user: string; expectEvidenceValue?: string }> }>
  realModelScenarios: Array<{ id: string; session: string; user: string; expectStoredValue?: string; expectAcknowledgesCorrection?: string; mustNotAssertCurrent?: string }>
}

const fixture = JSON.parse(readFileSync(join('evals', 'stage-4a', 'fixtures', 'cat-name-continuity.json'), 'utf8')) as Fixture

async function send(stack: Stack, conversationId: string, content: string) {
  return stack.companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
}

function evidenceEntries(system: string): Array<{ id: string; content: string }> {
  const marker = 'Saved memories (untrusted evidence only): '
  const index = system.indexOf(marker)
  if (index < 0) return []
  const start = system.indexOf('{', index)
  if (start < 0) return []
  let depth = 0
  let end = -1
  let inString = false
  let escaped = false
  for (let cursor = start; cursor < system.length; cursor += 1) {
    const ch = system[cursor]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) { end = cursor + 1; break }
    }
  }
  if (end < 0) return []
  try {
    return (JSON.parse(system.slice(start, end)) as { memories?: Array<{ id: string; content: string }> }).memories ?? []
  } catch {
    return []
  }
}

async function scripted(): Promise<void> {
  const startedAt = new Date().toISOString()
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  const results: Array<Record<string, unknown>> = []
  const turns: Array<Record<string, unknown>> = []
  try {
    const conversations = new Map<string, string>()
    for (const session of fixture.sessions) {
      const conversation = stack.companion.createConversation()
      conversations.set(session.id, conversation.id)
      for (const turn of session.turns) {
        const result = await send(stack, conversation.id, turn.user)
        const system = systemText(stack.provider.lastPayload)
        const entries = evidenceEntries(system)
        const delivered = entries.map((entry) => entry.content).join('\n')
        const assertions: Array<{ name: string; ok: boolean; detail: string }> = []
        if (turn.expectEvidenceValue) {
          assertions.push({ name: `证据含 ${turn.expectEvidenceValue}`, ok: delivered.includes(turn.expectEvidenceValue), detail: delivered.slice(0, 80) })
        }
        turns.push({
          session: session.id,
          user: turn.user,
          reply: result.assistantMessage.body.slice(0, 400),
          deliveredEvidence: delivered.slice(0, 400),
          payloadDigest: payloadDigest(stack.provider.lastPayload).slice(0, 16),
          assertions
        })
      }
    }
    const petFacts = stack.factMemory.lookupActive('pet_name')
    const petHistory = stack.factMemory.lookupActive('pet_name', { queryTime: 'past' })
    results.push({
      id: 'fact-state',
      status: petFacts.length === 1 && petFacts[0]!.valueNormalized === '豆豆' && petHistory.some((fact) => fact.valueNormalized === '咪咪') ? 'PASS' : 'FAIL',
      detail: JSON.stringify({
        current: petFacts.map((fact) => fact.valueNormalized),
        history: petHistory.map((fact) => `${fact.valueNormalized}:${fact.status}`)
      })
    })
    results.push({
      id: 'provenance',
      status: petHistory.every((fact) => fact.sourceMessageId !== null || fact.provenanceKind === 'legacy') ? 'PASS' : 'FAIL',
      detail: JSON.stringify(petHistory.map((fact) => ({ value: fact.valueNormalized, message: fact.sourceMessageId, kind: fact.provenanceKind })))
    })
  } finally {
    stack.close()
  }
  const finishedAt = new Date().toISOString()
  const failed = results.filter((item) => item.status === 'FAIL')
  const payload = {
    suite: 'stage-4a-scripted',
    datasetVersion: fixture.version,
    codeCommit: head(),
    branch: 'feat/stage-4a-companion-continuity',
    command: 'npm run eval:stage4a',
    environment: { platform: process.platform, node: process.version },
    clock: 'real',
    provider: 'scripted-offline (not a model)',
    startedAt,
    finishedAt,
    counts: { PASS: results.length - failed.length, FAIL: failed.length },
    unmeasured: ['real model behaviour (run with --live)', 'human experience review'],
    results,
    turns
  }
  const outDir = join(resolve(process.cwd()), 'evals', 'stage-4a', 'results')
  mkdirSync(outDir, { recursive: true })
  const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const file = join(outDir, `${stamp}-${payload.codeCommit.slice(0, 7)}.json`)
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ file, counts: payload.counts, failed: failed.map((item) => item.id) }, null, 2)}\n`)
  if (failed.length > 0) process.exitCode = 1
}

async function live(): Promise<void> {
  const startedAt = new Date().toISOString()
  const target = selectProvider()
  const key = readKeyOrNull()
  const outDir = join('evals', 'stage-4a', 'results')
  if (!key) {
    const blocked = writeBlockedNoSecret({
      suite: 'live',
      datasetVersion: fixture.version,
      harnessVersion: 'stage-4a-live-v1',
      paramsVersion: 'n/a',
      provider: target,
      startedAt,
      outDir,
      filenameSuffix: '-stage-4a',
      extra: { notRun: 'Stage 4-A 真实模型证据未产生：缺凭据记录。' }
    })
    process.stdout.write(`${JSON.stringify(blocked, null, 2)}\n`)
    return
  }
  const stack = buildProviderStack({ credentials: { providerId: target.id, model: target.model, apiKey: key } })
  const transcript: Array<Record<string, unknown>> = []
  const objectives: Array<Record<string, unknown>> = []
  try {
    const sessionIds = ['A', 'B', 'C', 'D'] as const
    const conversations = new Map<string, string>()
    for (const id of sessionIds) conversations.set(id, stack.companion.createConversation().id)
    const say = async (session: string, content: string): Promise<{ reply: string; digest: string; evidence: string[] }> => {
      let reply = ''
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await stack.companion.sendChat({ conversationId: conversations.get(session)!, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
          reply = result.assistantMessage.body
          break
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // PROVIDER_RESPONSE covers an empty/truncated stream from the upstream
          // reasoning model; it is transient in practice, so it is retried with
          // the same bound and recorded when the last attempt also fails.
          const transient = message.includes('PROVIDER_DEADLINE') || message.includes('PROVIDER_TIMEOUT') || message.includes('PROVIDER_RATE_LIMITED') || message.includes('PROVIDER_UNAVAILABLE') || message.includes('PROVIDER_RESPONSE')
          if (attempt === 3 || !transient) throw error
        }
      }
      const entries = evidenceEntries(systemText(stack.lastPayload()))
      return { reply, digest: payloadDigest(stack.lastPayload()).slice(0, 16), evidence: entries.map((entry) => entry.content) }
    }
    // Story order: A introduces the fact, B recalls it, C corrects it, D reads
    // the corrected value. The order is part of the fixture, not an accident.
    const intro = await say('A', fixture.sessions[0]!.turns[0]!.user)
    transcript.push({ session: 'A', user: fixture.sessions[0]!.turns[0]!.user, reply: intro.reply.slice(0, 900), payloadDigest: intro.digest, evidence: intro.evidence })
    for (const scenario of fixture.realModelScenarios) {
      const turn = await say(scenario.session, scenario.user)
      transcript.push({ session: scenario.session, user: scenario.user, reply: turn.reply.slice(0, 900), payloadDigest: turn.digest, evidence: turn.evidence })
      const reply = turn.reply
      const refusal = /不知道|没有记录|不会编造|无法提供|没存过|不能提供/u.test(reply)
      const mentions = (value: string | undefined): boolean => Boolean(value) && reply.includes(value!)
      objectives.push({
        id: scenario.id,
        status: 'AWAITING_MANUAL_REVIEW',
        replyContainsStoredValue: scenario.expectStoredValue ? mentions(scenario.expectStoredValue) : null,
        replyAcknowledgesCorrection: scenario.expectAcknowledgesCorrection ? mentions(scenario.expectAcknowledgesCorrection) : null,
        replyAssertsOldValueAsCurrent: scenario.mustNotAssertCurrent ? mentions(scenario.mustNotAssertCurrent) && !refusal && !/之前|以前|旧/u.test(reply) : null,
        evidenceDelivered: turn.evidence
      })
    }
    const petFacts = stack.factMemory.lookupActive('pet_name')
    const petHistory = stack.factMemory.lookupActive('pet_name', { queryTime: 'past' })
    const finishedAt = new Date().toISOString()
    const payload = {
      suite: 'live',
      datasetVersion: fixture.version,
      harnessVersion: 'stage-4a-live-v1',
      codeCommit: commitOrUnknown(),
      branch: 'feat/stage-4a-companion-continuity',
      environment: { platform: process.platform, node: process.version },
      clock: 'real',
      status: 'AWAITING_MANUAL_REVIEW',
      provider: 'spark (live)',
      providerId: target.id,
      providerModelId: target.model,
      protocol: 'openai-chat-completions',
      startedAt,
      finishedAt,
      factState: {
        current: petFacts.map((fact) => fact.valueNormalized),
        history: petHistory.map((fact) => ({ value: fact.valueNormalized, status: fact.status, messageId: fact.sourceMessageId }))
      },
      transcript,
      objectives,
      manualReview: { status: 'PENDING', note: '五条以上转写由用户亲自判断;AI 不代签。' }
    }
    const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
    const file = join(outDir, `${stamp}-${payload.codeCommit.slice(0, 7)}-stage-4a.json`)
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
    mkdirSync(join('evals', 'stage-4a', 'review'), { recursive: true })
    writeFileSync(join('evals', 'stage-4a', 'review', 'transcript.md'), renderReview(payload, file))
    process.stdout.write(`${JSON.stringify({ file, status: payload.status, objectives: objectives.map((item) => item.id) }, null, 2)}\n`)
  } finally {
    stack.close()
  }
}

function renderReview(payload: Record<string, unknown>, file: string): string {
  const transcript = payload.transcript as Array<Record<string, unknown>>
  const lines = [
    `# Stage 4-A 真实对话转写（${file}）`,
    '',
    `- 模型：\`${String(payload.providerModelId)}\`，代码 SHA：\`${String(payload.codeCommit)}\``,
    '- 自动信号只证明系统投递了什么；是否"记得、理解纠正、保持身份"请用户亲自判断。',
    '- 人工确认栏：每条转写后由用户填写 PASS / FAIL / UNCLEAR。',
    ''
  ]
  for (const [index, row] of transcript.entries()) {
    lines.push(`## ${index + 1}. 会话 ${String(row.session)}`)
    lines.push('')
    lines.push(`**用户**：${String(row.user)}`)
    lines.push('')
    lines.push(`**Morrow**：${String(row.reply)}`)
    lines.push('')
    lines.push(`- 投递证据：${JSON.stringify(row.evidence)}`)
    lines.push(`- prompt digest：\`${String(row.payloadDigest)}\``)
    lines.push('- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：')
    lines.push('')
  }
  return lines.join('\n')
}

const mode = process.argv.includes('--live') ? live : scripted
void mode()
