/**
 * Stage 5 — relational presence scenarios (12).
 *
 * Objective checks only: what the ledger holds, what the serialized payload
 * carries, which structured strategy the turn recorded. Naturalness is a human
 * judgement recorded in evals/stage-5/review/ and never asserted here.
 *
 * `--live` replays the same scenarios against the contract provider and keeps
 * the raw replies for that review.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildStack, head, systemText, type Stack } from '../stage-3/runner/harness'
import { buildProviderStack, commitOrUnknown, payloadDigest, readKeyOrNull, selectProvider, writeBlockedNoSecret } from '../stage-3/shared/real-provider'
import { readGitMetadata } from '../../src/evaluation/git-metadata'

interface Scenario {
  id: string
  name: string
  setup: Array<{ conversation: string; turns: string[] }>
  memorySeed?: string[]
  restartBetween?: boolean
  probe: { conversation: string; text: string }
  expectEvidence?: string
  rejectFactValue?: string
  expectContinuity?: string
  rejectContinuity?: string
  expectNoMemoryOperation?: boolean
  expectOperationBlock?: string
  expectEmptyEvidence?: boolean
  expectPrinciple?: string
  expectPolicyRationale?: string
  expectPolicyRationaleAny?: string[]
  rubric: string
}

const fixture = JSON.parse(readFileSync(join('evals', 'stage-5', 'scenarios-v1.json'), 'utf8')) as { version: string; scenarios: Scenario[] }

function evidenceEntries(system: string): string[] {
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
    return ((JSON.parse(system.slice(start, end)) as { memories?: Array<{ content: string }> }).memories ?? []).map((entry) => entry.content)
  } catch {
    return []
  }
}

interface CompanionLike {
  createConversation(): { id: string }
  sendChat(request: { conversationId: string; requestId: string; content: string; includeSensitive: boolean }, onDelta: (delta: string) => void): Promise<{ assistantMessage: { body: string } }>
  saveProvider(input: unknown): unknown
  getProvider(): { id: string; model: string; enabled: boolean } | null
}

async function runScenario(companion: CompanionLike, scenario: Scenario, lastPayload: () => string, database: { connection: { prepare(sql: string): { get(...args: unknown[]): unknown } } }): Promise<{ id: string; name: string; checks: Array<{ name: string; ok: boolean; detail: string }>; reply: string; system: string }> {
  const conversations = new Map<string, string>()
  const say = async (conversation: string, text: string): Promise<{ reply: string; system: string }> => {
    const id = conversations.get(conversation) ?? companion.createConversation().id
    conversations.set(conversation, id)
    let reply = ''
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const result = await companion.sendChat({ conversationId: id, requestId: randomUUID(), content: text, includeSensitive: false }, () => undefined)
        reply = result.assistantMessage.body
        break
      } catch (error) {
        const marker = [error instanceof Error ? error.message : String(error), String((error as { code?: string }).code ?? '')].join(' ')
        const transient = ['PROVIDER_DEADLINE', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RESPONSE'].some((code) => marker.includes(code))
        if (attempt === 5 || !transient) throw error
      }
    }
    return { reply, system: systemText(lastPayload()) }
  }

  for (const setup of scenario.setup) for (const turn of setup.turns) await say(setup.conversation, turn)
  const probe = await say(scenario.probe.conversation, scenario.probe.text)
  const evidence = evidenceEntries(probe.system).join(' | ')
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  const evaluation = (() => {
    try {
      const row = database.connection.prepare("SELECT payload_json FROM event_journal WHERE event_type = 'turn.evaluated' ORDER BY rowid DESC LIMIT 1").get() as { payload_json: string }
      return JSON.parse(row.payload_json) as Record<string, unknown>
    } catch {
      return {}
    }
  })()

  if (scenario.expectEvidence) checks.push({ name: `证据含 ${scenario.expectEvidence}`, ok: evidence.includes(scenario.expectEvidence), detail: evidence.slice(0, 100) })
  if (scenario.expectEmptyEvidence) checks.push({ name: '证据为空（不编造）', ok: evidence.length === 0, detail: String(evidence).slice(0, 60) })
  if (scenario.expectContinuity) checks.push({ name: `连续性块含 ${scenario.expectContinuity}`, ok: probe.system.includes(scenario.expectContinuity), detail: probe.system.includes('Continuity with this user') ? 'block present' : 'no block' })
  if (scenario.rejectContinuity) checks.push({ name: `连续性块不含 ${scenario.rejectContinuity}`, ok: !probe.system.includes(scenario.rejectContinuity), detail: 'scan' })
  if (scenario.rejectFactValue) {
    const active = evidence.includes(scenario.rejectFactValue)
    checks.push({ name: `未写入 ${scenario.rejectFactValue}`, ok: !active && !probe.system.includes(scenario.rejectFactValue), detail: 'no write' })
  }
  if (scenario.expectNoMemoryOperation) checks.push({ name: '无记忆操作块', ok: !probe.system.includes('Memory operation for this turn'), detail: 'scan' })
  if (scenario.expectOperationBlock) checks.push({ name: `操作块含 ${scenario.expectOperationBlock}`, ok: probe.system.includes(scenario.expectOperationBlock), detail: 'scan' })
  if (scenario.expectPrinciple) checks.push({ name: '使用规则仍在原则中', ok: probe.system.includes(scenario.expectPrinciple), detail: 'scan' })
  if (scenario.expectPolicyRationale) checks.push({ name: `策略=${scenario.expectPolicyRationale}`, ok: evaluation.expressionPolicy === scenario.expectPolicyRationale, detail: String(evaluation.expressionPolicy ?? 'none') })
  if (scenario.expectPolicyRationaleAny) checks.push({ name: '策略已记录', ok: typeof evaluation.expressionPolicy === 'string' && scenario.expectPolicyRationaleAny.includes(evaluation.expressionPolicy as string), detail: String(evaluation.expressionPolicy ?? 'none') })
  // Every scenario also records the privacy invariant: no internal numbers in
  // the instruction blocks the model is told to follow.
  checks.push({ name: '策略块声明不暴露内部数值', ok: probe.system.includes('Do not expose internal state'), detail: 'scan' })

  return { id: scenario.id, name: scenario.name, checks, reply: probe.reply.slice(0, 900), system: probe.system.slice(0, 2000) }
}

async function scripted(): Promise<void> {
  const startedAt = new Date().toISOString()
  const results: Array<Record<string, unknown>> = []
  for (const scenario of fixture.scenarios) {
    const dir = scenario.restartBetween ? mkdtempSync(join(tmpdir(), 'morrow-s5-')) : ''
    const databasePath = scenario.restartBetween ? join(dir, 'morrow.sqlite3') : undefined
    let stack = buildStack({ growth: true, exploration: true, reflection: true, ...(databasePath ? { databasePath, keepDatabase: true } : {}) })
    try {
      for (const memory of scenario.memorySeed ?? []) stack.memories.create(memory, 'personal')
      if (scenario.restartBetween) {
        // The whole runtime is torn down and rebuilt on the same file: services,
        // migrations and the companion, not just the rows.
        const setupOnly = { ...scenario, probe: { conversation: 'setup-only', text: '（setup）' } }
        for (const setup of scenario.setup) for (const turn of setup.turns) {
          const id = stack.companion.createConversation().id
          try { await stack.companion.sendChat({ conversationId: id, requestId: randomUUID(), content: turn, includeSensitive: false }, () => undefined) } catch { /* setup turns are best-effort */ }
        }
        void setupOnly
        stack.close()
        stack = buildStack({ growth: true, exploration: true, reflection: true, databasePath: databasePath!, keepDatabase: true })
        const restarted = { ...scenario, setup: [] }
        const outcome = await runScenario(stack.companion as unknown as CompanionLike, restarted, () => stack.provider.lastPayload, stack.database)
        const failed = outcome.checks.filter((check) => !check.ok)
        results.push({ ...outcome, status: failed.length === 0 ? 'PASS' : 'FAIL', semanticReview: 'PENDING_HUMAN', rubric: scenario.rubric, failed: failed.map((check) => check.name), restarted: true })
      } else {
        const outcome = await runScenario(stack.companion as unknown as CompanionLike, scenario, () => stack.provider.lastPayload, stack.database)
        const failed = outcome.checks.filter((check) => !check.ok)
        results.push({ ...outcome, status: failed.length === 0 ? 'PASS' : 'FAIL', semanticReview: 'PENDING_HUMAN', rubric: scenario.rubric, failed: failed.map((check) => check.name) })
      }
    } finally {
      stack.close()
      if (dir) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch { /* windows lock */ } }
    }
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  const git = readGitMetadata()
  const payload = {
    suite: 'stage-5-scripted',
    datasetVersion: fixture.version,
    codeCommit: head(),
    branch: git.branch,
    branchReason: git.branchReason,
    workingTree: git.workingTree,
    command: 'npm run eval:stage5',
    environment: { platform: process.platform, node: process.version },
    provider: 'scripted-offline (not a model)',
    clock: 'real',
    startedAt,
    finishedAt: new Date().toISOString(),
    counts: { scenarios: results.length, PASS: results.length - failed.length, FAIL: failed.length },
    unmeasured: ['naturalness (human review)', 'real model behaviour (run with --live)'],
    results
  }
  const outDir = join(resolve(process.cwd()), 'evals', 'stage-5', 'results')
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
  const outDir = join('evals', 'stage-5', 'results')
  if (!key) {
    const blocked = writeBlockedNoSecret({
      suite: 'live',
      datasetVersion: fixture.version,
      harnessVersion: 'stage-5-live-v1',
      paramsVersion: 'n/a',
      provider: target,
      startedAt,
      outDir,
      filenameSuffix: '-stage-5',
      extra: { notRun: 'Stage 5 真实模型证据未产生：缺凭据记录。' }
    })
    process.stdout.write(`${JSON.stringify(blocked, null, 2)}\n`)
    return
  }
  const results: Array<Record<string, unknown>> = []
  for (const scenario of fixture.scenarios) {
    const stack = buildProviderStack({ credentials: { providerId: target.id, model: target.model, apiKey: key } })
    try {
      for (const memory of scenario.memorySeed ?? []) stack.memories.create(memory, 'personal')
      const outcome = await runScenario(stack.companion as unknown as CompanionLike, scenario, () => stack.lastPayload(), stack.database)
      const failed = outcome.checks.filter((check) => !check.ok)
      results.push({ ...outcome, status: failed.length === 0 ? 'PASS' : 'FAIL', semanticReview: 'PENDING_HUMAN', rubric: scenario.rubric, failed: failed.map((check) => check.name) })
    } catch (error) {
      results.push({ id: scenario.id, name: scenario.name, status: 'ERROR', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), semanticReview: 'PENDING_HUMAN' })
    } finally {
      stack.close()
    }
  }
  const git = readGitMetadata()
  const payload = {
    suite: 'live',
    datasetVersion: fixture.version,
    harnessVersion: 'stage-5-live-v1',
    codeCommit: commitOrUnknown(),
    branch: git.branch,
    branchReason: git.branchReason,
    workingTree: git.workingTree,
    command: 'npm run eval:stage5:live',
    environment: { platform: process.platform, node: process.version },
    clock: 'real',
    status: 'AWAITING_MANUAL_REVIEW',
    provider: 'spark (live)',
    providerId: target.id,
    providerModelId: target.model,
    protocol: 'openai-chat-completions',
    startedAt,
    finishedAt: new Date().toISOString(),
    counts: {
      scenarios: results.length,
      PASS: results.filter((item) => item.status === 'PASS').length,
      FAIL: results.filter((item) => item.status === 'FAIL').length,
      ERROR: results.filter((item) => item.status === 'ERROR').length
    },
    separationNote: 'Objective checks cover ledger/payload/strategy only; naturalness is human review.',
    results
  }
  const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const file = join(outDir, `${stamp}-${payload.codeCommit.slice(0, 7)}-stage-5.json`)
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  mkdirSync(join('evals', 'stage-5', 'review'), { recursive: true })
  writeFileSync(join('evals', 'stage-5', 'review', 'transcript-live.md'), renderReview(payload, file, fixture.scenarios))
  process.stdout.write(`${JSON.stringify({ file, counts: payload.counts, failed: results.filter((item) => item.status !== 'PASS').map((item) => item.id) }, null, 2)}\n`)
  if (payload.counts.FAIL + payload.counts.ERROR > 0) process.exitCode = 1
}

function renderReview(payload: Record<string, unknown>, file: string, scenarios: Scenario[]): string {
  const results = payload.results as Array<Record<string, unknown>>
  const lines = [
    `# Stage 5 真实对话复核包（${file}）`,
    '',
    `- 模型 \`${String(payload.providerModelId)}\`，SHA \`${String(payload.codeCommit)}\``,
    `- 客观检查：${JSON.stringify(payload.counts)}（只覆盖 ledger/载荷/策略）`,
    '- 自然度与"在场感"由你亲自判断；每条场景填 PASS / FAIL / UNCLEAR 并写理由。',
    ''
  ]
  for (const result of results) {
    const scenario = scenarios.find((item) => item.id === result.id)
    lines.push(`## ${String(result.id)} ${String(result.name)}`)
    lines.push('')
    lines.push(`**用户**：${scenario?.probe.text ?? ''}`)
    lines.push('')
    lines.push(`**Morrow**：${String(result.reply ?? result.error ?? '')}`)
    lines.push('')
    lines.push(`- 客观检查：${JSON.stringify(result.checks ?? [])}`)
    lines.push(`- rubric：${scenario?.rubric ?? ''}`)
    lines.push('- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：')
    lines.push('')
  }
  return lines.join('\n')
}

const mode = process.argv.includes('--live') ? live : scripted
void mode()
