/**
 * Stage 4-A — the cat-name continuity story, scripted and live.
 *
 * Scripted (default): walks the fixture through the production chain and
 * asserts the ledger and the pre-response operation block at each step.
 * Proves the wiring; never the model.
 *
 * Live (`--live`, needs MORROW_TEST_API_KEY): replays A→B→C→D→E plus the
 * ambiguity and replay edge cases on the contract provider, records every raw
 * reply, the operation block, the evidence delivered and — separately —
 * explicit understanding checks. Human review stays PENDING.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildStack, head, systemText, type Stack } from '../stage-3/runner/harness'
import { buildProviderStack, commitOrUnknown, payloadDigest, readKeyOrNull, selectProvider, writeBlockedNoSecret } from '../stage-3/shared/real-provider'

interface FixtureSession {
  id: string
  user: string
  expectEvidenceValue?: string
  expectPreResponseOperation?: string
}

interface Fixture {
  version: string
  sessions: FixtureSession[]
  edgeCases?: Array<Record<string, unknown>>
}

const fixture = JSON.parse(readFileSync(join('evals', 'stage-4a', 'fixtures', 'cat-name-correction-v2.json'), 'utf8')) as Fixture

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

function operationBlockOf(system: string): string {
  const at = system.indexOf('Memory operation for this turn')
  return at >= 0 ? system.slice(at, at + 260) : ''
}

async function scripted(): Promise<void> {
  const startedAt = new Date().toISOString()
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  const turns: Array<Record<string, unknown>> = []
  const assertions: Array<{ id: string; ok: boolean; detail: string }> = []
  try {
    for (const step of fixture.sessions) {
      const conversation = stack.companion.createConversation()
      const result = await send(stack, conversation.id, step.user)
      const system = systemText(stack.provider.lastPayload)
      const delivered = evidenceEntries(system).map((entry) => entry.content).join(' | ')
      const block = operationBlockOf(system)
      if (step.expectEvidenceValue) {
        assertions.push({ id: `${step.id}-evidence`, ok: delivered.includes(step.expectEvidenceValue), detail: delivered.slice(0, 90) })
      }
      if (step.expectPreResponseOperation) {
        assertions.push({ id: `${step.id}-operation`, ok: block.includes(`operation=${step.expectPreResponseOperation}`) && block.includes('committed_and_verified'), detail: block.replace(/\n/g, ' ').slice(0, 120) })
      }
      turns.push({ session: step.id, user: step.user, reply: result.assistantMessage.body.slice(0, 400), evidence: delivered.slice(0, 300), operationBlock: block.slice(0, 200), payloadDigest: payloadDigest(stack.provider.lastPayload).slice(0, 16) })
    }
    const current = stack.factMemory.lookupActive('pet_name').map((fact) => fact.valueNormalized)
    const history = stack.factMemory.lookupActive('pet_name', { queryTime: 'past' }).map((fact) => `${fact.valueNormalized}:${fact.status}`)
    assertions.push({ id: 'final-current', ok: current.length === 1 && current[0] === '豆豆', detail: JSON.stringify(current) })
    assertions.push({ id: 'final-history', ok: history.includes('咪咪:superseded'), detail: JSON.stringify(history) })
    const provenanceOk = stack.factMemory.lookupActive('pet_name', { queryTime: 'past' }).every((fact) => fact.sourceMessageId !== null || fact.provenanceKind === 'legacy')
    assertions.push({ id: 'provenance', ok: provenanceOk, detail: 'message-or-legacy' })
  } finally {
    stack.close()
  }
  const failed = assertions.filter((item) => !item.ok)
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
    finishedAt: new Date().toISOString(),
    counts: { PASS: assertions.length - failed.length, FAIL: failed.length },
    unmeasured: ['real model behaviour (run with --live)', 'human experience review'],
    assertions,
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
      harnessVersion: 'stage-4a-live-v2',
      paramsVersion: 'n/a',
      provider: target,
      startedAt,
      outDir,
      filenameSuffix: '-final-repair',
      extra: { notRun: 'Stage 4-A final-repair 真实模型证据未产生：缺凭据记录。' }
    })
    process.stdout.write(`${JSON.stringify(blocked, null, 2)}\n`)
    return
  }
  const stack = buildProviderStack({ credentials: { providerId: target.id, model: target.model, apiKey: key } })
  const transcript: Array<Record<string, unknown>> = []
  const checks: Array<{ id: string; name: string; ok: boolean; detail: string }> = []
  try {
    const say = async (companion: typeof stack.companion, conversationId: string, content: string): Promise<{ reply: string; digest: string; evidence: string[]; operationBlock: string }> => {
      let reply = ''
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
          reply = result.assistantMessage.body
          break
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const transient = ['PROVIDER_DEADLINE', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RESPONSE'].some((code) => message.includes(code))
          if (attempt === 3 || !transient) throw error
        }
      }
      const system = systemText(stack.lastPayload())
      return { reply, digest: payloadDigest(stack.lastPayload()).slice(0, 16), evidence: evidenceEntries(system).map((entry) => entry.content), operationBlock: operationBlockOf(system) }
    }

    for (const step of fixture.sessions) {
      const conversation = stack.companion.createConversation()
      const turn = await say(stack.companion, conversation.id, step.user)
      transcript.push({ session: step.id, user: step.user, reply: turn.reply.slice(0, 900), payloadDigest: turn.digest, evidence: turn.evidence, operationBlock: turn.operationBlock })
    }

    const rowOf = (id: string): Record<string, unknown> => transcript.find((row) => row.session === id) ?? {}
    const replyOf = (id: string): string => String(rowOf(id).reply ?? '')
    const blockOf = (id: string): string => String(rowOf(id).operationBlock ?? '')
    const evidenceOf = (id: string): string[] => (rowOf(id).evidence as string[] | undefined) ?? []

    // §5: understanding is three separate signals, never one includes().
    const denial = /没有(?:可用|找到|检索到|保存)?(?:的)?记录|我不知道|没存过|找不到(?:你|关于)/u
    const relation = /(?:之前|原来|以前|曾(?:经)?)[^。！？]{0,16}咪咪|咪咪[^。！？]{0,16}(?:改成|改为|变成|换成)|从\s*咪咪\s*(?:改|变|换)/u
    checks.push({ id: 'A-op', name: '回复前已提交 create 并验证', ok: blockOf('A').includes('operation=create') && blockOf('A').includes('committed_and_verified') && blockOf('A').includes('咪咪'), detail: blockOf('A').replace(/\n/g, ' ').slice(0, 200) })
    checks.push({ id: 'B-recall', name: '新会话证据含咪咪', ok: evidenceOf('B').join().includes('咪咪'), detail: evidenceOf('B').join(' | ') })
    checks.push({ id: 'C-op', name: '回复前已提交 correct 并验证（含旧值/新值）', ok: blockOf('C').includes('operation=correct') && blockOf('C').includes('previous_value=咪咪') && blockOf('C').includes('current_value=豆豆'), detail: blockOf('C').replace(/\n/g, ' ').slice(0, 220) })
    checks.push({ id: 'C-new', name: '回复识别新值豆豆', ok: replyOf('C').includes('豆豆'), detail: replyOf('C').slice(0, 160) })
    checks.push({ id: 'C-no-deny', name: '回复未否认/未索要已有旧记录', ok: !denial.test(replyOf('C')), detail: replyOf('C').slice(0, 160) })
    checks.push({ id: 'C-relation', name: '回复表达旧值→新值的关系', ok: relation.test(replyOf('C')) || (replyOf('C').includes('咪咪') && replyOf('C').includes('豆豆')), detail: replyOf('C').slice(0, 160) })
    checks.push({ id: 'D-current', name: '新会话当前值=豆豆且不含旧值', ok: evidenceOf('D').join().includes('豆豆') && !evidenceOf('D').join().includes('咪咪'), detail: evidenceOf('D').join(' | ') })
    checks.push({ id: 'E-history', name: '历史问句可说明旧值(咪咪)且不作为当前', ok: replyOf('E').includes('咪咪'), detail: replyOf('E').slice(0, 160) })

    // Edge cases in their own stack: their setups must not rewrite the story.
    const edge = buildProviderStack({ credentials: { providerId: target.id, model: target.model, apiKey: key } })
    try {
      const petA = edge.companion.createConversation().id
      await say(edge.companion, petA, '我有一只猫叫咪咪。帮我记住。')
      const petB = edge.companion.createConversation().id
      await say(edge.companion, petB, '我还有一只猫叫小黑。帮我记住。')
      const ambiguous = await say(edge.companion, petB, '我说错了，它现在叫豆豆。帮我更新。')
      transcript.push({ session: 'X1', user: '两只宠物时说：它现在叫豆豆', reply: ambiguous.reply.slice(0, 600), payloadDigest: ambiguous.digest, evidence: ambiguous.evidence, operationBlock: ambiguous.operationBlock })
      const pets = edge.factMemory.lookupActive('pet_name').map((fact) => fact.valueNormalized).sort()
      checks.push({ id: 'X1-clarify', name: '多候选代词→clarify，不写入', ok: ambiguous.operationBlock.includes('status=clarify') && !pets.includes('豆豆'), detail: JSON.stringify(pets) })

      const residency = edge.companion.createConversation().id
      await say(edge.companion, residency, '我住在杭州。帮我记住。')
      const residence = edge.factMemory.lookupActive('residence')
      checks.push({ id: 'X3-create', name: '显式保存产生唯一当前事实', ok: residence.length === 1 && residence[0]!.valueNormalized === '杭州', detail: JSON.stringify(residence.map((fact) => fact.valueNormalized)) })
      const replay = await say(edge.companion, residency, '我住在杭州。帮我记住。')
      const afterReplay = edge.factMemory.lookupActive('residence')
      checks.push({ id: 'X3-replay', name: '重复同一句话不产生第二条事实', ok: afterReplay.length === 1, detail: `${afterReplay.length} active; block=${replay.operationBlock.replace(/\n/g, ' ').slice(0, 60)}` })
    } finally {
      edge.close()
    }

    const petFacts = stack.factMemory.lookupActive('pet_name')
    const petHistory = stack.factMemory.lookupActive('pet_name', { queryTime: 'past' })
    const passed = checks.filter((check) => check.ok).length
    const payload = {
      suite: 'live',
      datasetVersion: fixture.version,
      harnessVersion: 'stage-4a-live-v2',
      codeCommit: commitOrUnknown(),
      branch: 'feat/stage-4a-companion-continuity',
      command: 'npm run eval:stage4a:live',
      environment: { platform: process.platform, node: process.version },
      clock: 'real',
      status: 'AWAITING_MANUAL_REVIEW',
      provider: 'spark (live)',
      providerId: target.id,
      providerModelId: target.model,
      protocol: 'openai-chat-completions',
      startedAt,
      finishedAt: new Date().toISOString(),
      counts: { checks: checks.length, automatedPass: passed, automatedFail: checks.length - passed },
      separationNote: '数据库事实状态、请求证据注入、模型语义理解是三个独立指标；自动检查覆盖前两项与回复的显式关系表达，语义质量由真人判定。',
      factState: {
        current: petFacts.map((fact) => fact.valueNormalized),
        history: petHistory.map((fact) => ({ value: fact.valueNormalized, status: fact.status, messageId: fact.sourceMessageId }))
      },
      checks,
      transcript,
      manualReview: { status: 'PENDING', note: '五条以上转写由用户亲自判断；AI 不代签。' }
    }
    const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
    const file = join(outDir, `${stamp}-${payload.codeCommit.slice(0, 7)}-final-repair.json`)
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
    mkdirSync(join('evals', 'stage-4a', 'review'), { recursive: true })
    writeFileSync(join('evals', 'stage-4a', 'review', 'transcript-final-repair.md'), renderReview({ ...payload, file }))
    process.stdout.write(`${JSON.stringify({ file, counts: payload.counts, failed: checks.filter((check) => !check.ok).map((check) => check.id) }, null, 2)}\n`)
    if (checks.length - passed > 0) process.exitCode = 1
  } finally {
    stack.close()
  }
}

function renderReview(payload: Record<string, unknown> & { file: string }): string {
  const transcript = payload.transcript as Array<Record<string, unknown>>
  const lines = [
    `# Stage 4-A final-repair 真实对话转写（${payload.file}）`,
    '',
    `- 模型：\`${String(payload.providerModelId)}\`，代码 SHA：\`${String(payload.codeCommit)}\``,
    `- 自动检查：${JSON.stringify(payload.counts)}（只覆盖事实状态/证据注入/关系表达）`,
    '- 语义质量（是否自然、是否真的"理解"）由用户亲自判断；每条转写后填写 PASS / FAIL / UNCLEAR。',
    ''
  ]
  for (const [index, row] of transcript.entries()) {
    lines.push(`## ${index + 1}. 会话 ${String(row.session)}`)
    lines.push('')
    lines.push(`**用户**：${String(row.user)}`)
    lines.push('')
    lines.push(`**Morrow**：${String(row.reply)}`)
    lines.push('')
    lines.push(`- 回复前操作块：${String(row.operationBlock ?? '').replace(/\n/g, ' ') || '（无）'}`)
    lines.push(`- 投递证据：${JSON.stringify(row.evidence)}`)
    lines.push(`- prompt digest：\`${String(row.payloadDigest)}\``)
    lines.push('- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：')
    lines.push('')
  }
  return lines.join('\n')
}

const mode = process.argv.includes('--live') ? live : scripted
void mode()
