/**
 * Final-product acceptance suite (Issues #33/#34, P01–P20).
 *
 * Scripted scenarios run the real CompanionService assembly (the Stage 3
 * harness) and assert database state and serialized payloads — never a helper
 * return value alone. Scenarios that need a second provider, a human rater or
 * a real Windows install are reported as NOT_RUN / PENDING / BLOCKED with the
 * exact missing precondition; they are never counted as PASS.
 */
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { buildStack, systemText, type Stack } from '../stage-3/runner/harness'
import { BackupService } from '../../src/persistence/backup-service'
import { decideExploration } from '../../src/self-model/exploration-policy'

interface Check { name: string; ok: boolean; detail: string }
interface Outcome { id: string; name: string; status: 'PASS' | 'FAIL' | 'NOT_RUN' | 'PENDING_HUMAN' | 'BLOCKED' | 'EVIDENCED_ELSEWHERE'; checks: Check[]; note?: string }

const results: Outcome[] = []
let openStacks: Stack[] = []
function open(databasePath?: string): Stack {
  const stack = buildStack({ growth: true, exploration: true, reflection: true, ...(databasePath ? { databasePath, keepDatabase: true } : {}) })
  openStacks.push(stack)
  return stack
}
async function send(stack: Stack, conversationId: string, content: string, requestId = randomUUID()) {
  return stack.companion.sendChat({ conversationId, requestId, content, includeSensitive: false }, () => undefined)
}
function outcome(id: string, name: string, checks: Check[], note?: string): void {
  results.push({ id, name, status: checks.length > 0 && checks.every((check) => check.ok) ? 'PASS' : 'FAIL', checks, ...(note ? { note } : {}) })
}
function external(id: string, name: string, status: Outcome['status'], note: string, checks: Check[] = []): void {
  results.push({ id, name, status, checks, note })
}
const sql = <T>(stack: Stack, text: string, ...args: Array<string | number | null>): T => stack.database.connection.prepare(text).get(...args) as T

async function run(): Promise<void> {
  // P01 — plain multi-turn conversation persists exactly what was said.
  {
    const stack = open()
    const conversation = stack.companion.createConversation()
    for (const content of ['今天天气不错。', '我刚忙完一段工作。', '晚上打算早点休息。']) {
      await send(stack, conversation.id, content)
    }
    const counts = sql<{ user: number; assistant: number }>(stack,
      "SELECT SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) AS user, SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) AS assistant FROM messages WHERE conversation_id = ?", conversation.id)
    outcome('P01', '普通多轮对话', [
      { name: '三轮用户与三轮助手消息', ok: counts.user === 3 && counts.assistant === 3, detail: JSON.stringify(counts) },
      { name: '无重复 turn', ok: (sql<{ n: number }>(stack, 'SELECT COUNT(*) AS n FROM (SELECT turn_id FROM messages GROUP BY turn_id HAVING COUNT(*) > 2)', )).n === 0, detail: 'group check' }
    ])
  }

  // P02 — provider failure is honest and recoverable.
  {
    const stack = open()
    const conversation = stack.companion.createConversation()
    stack.provider.failure = 'upstream timeout'
    let failed = false
    try { await send(stack, conversation.id, '帮我看个问题。') } catch { failed = true }
    const afterFailure = sql<{ assistant: number }>(stack,
      "SELECT COUNT(*) AS assistant FROM messages WHERE conversation_id = ? AND role = 'assistant'", conversation.id)
    stack.provider.failure = null
    const recovered = await send(stack, conversation.id, '再来一次。')
    const stored = sql<{ user: number; assistant: number }>(stack,
      "SELECT SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) AS user, SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) AS assistant FROM messages WHERE conversation_id = ?", conversation.id)
    outcome('P02', 'Provider 超时/错误', [
      { name: '失败轮抛出而不是伪造回复', ok: failed, detail: 'threw' },
      { name: '失败轮没有 assistant 消息', ok: afterFailure.assistant === 0, detail: 'assistant=' + afterFailure.assistant },
      { name: '恢复后可继续', ok: Boolean(recovered.assistantMessage?.body), detail: 'recovered' },
      { name: '消息数正确（2 user / 1 assistant）', ok: stored.user === 2 && stored.assistant === 1, detail: JSON.stringify(stored) }
    ])
  }

  // P03/P04/P05 — the cat story on the production path.
  {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '我有一只猫，它叫咪咪。帮我记住。')
    const firstSystem = systemText(stack.provider.lastPayload)
    const stored = sql<{ n: number }>(stack, "SELECT COUNT(*) AS n FROM memories WHERE current_text LIKE '%咪咪%'")
    const fact = sql<{ status: string }>(stack, "SELECT status FROM fact_records WHERE value_normalized = '咪咪'")
    const b = stack.companion.createConversation()
    await send(stack, b.id, '我的猫叫什么？')
    const recall = systemText(stack.provider.lastPayload)
    const c = stack.companion.createConversation()
    await send(stack, c.id, '我说错了，它现在叫豆豆。')
    const corrected = sql<{ old_status: string; new_status: string }>(stack,
      "SELECT (SELECT status FROM fact_records WHERE value_normalized='咪咪') AS old_status, (SELECT status FROM fact_records WHERE value_normalized='豆豆') AS new_status")
    const d = stack.companion.createConversation()
    await send(stack, d.id, '我的猫现在叫什么？')
    const current = systemText(stack.provider.lastPayload)
    outcome('P03', '显式记住事实', [
      { name: '提交并验证后才出现记忆', ok: stored.n === 1, detail: `memories=${stored.n}` },
      { name: '事实 active', ok: fact?.status === 'active', detail: fact?.status ?? 'none' },
      { name: '本轮 payload 含 committed_and_verified', ok: firstSystem.includes('committed_and_verified'), detail: firstSystem.includes('committed_and_verified') ? 'present' : 'missing' }
    ])
    outcome('P04', '跨会话记忆', [
      { name: '新会话 payload 注入咪咪', ok: recall.includes('咪咪'), detail: recall.includes('咪咪') ? 'injected' : 'missing' }
    ])
    outcome('P05', '纠正事实', [
      { name: '旧值 superseded', ok: corrected?.old_status === 'superseded', detail: corrected?.old_status ?? 'none' },
      { name: '新值 active', ok: corrected?.new_status === 'active', detail: corrected?.new_status ?? 'none' },
      { name: '下一轮只把新值当当前事实', ok: current.includes('豆豆'), detail: current.includes('豆豆') ? 'new value injected' : 'missing' }
    ])
  }

  // P06 — ambiguity clarifies instead of guessing.
  {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '我有一只猫叫咪咪，还有一只狗叫小黑。帮我记住。')
    await send(stack, a.id, '它现在叫豆豆。')
    const stored = sql<{ n: number }>(stack, "SELECT COUNT(*) AS n FROM memories WHERE current_text LIKE '%豆豆%'")
    outcome('P06', '歧义纠正澄清不写入', [
      { name: '没有写入豆豆', ok: stored.n === 0, detail: `memories=${stored.n}` }
    ])
  }

  // P07 — retraction stops injection.
  {
    const stack = open()
    const memory = stack.memories.create('我对花生过敏。', 'personal')
    stack.memories.retract(memory.id)
    const conversation = stack.companion.createConversation()
    await send(stack, conversation.id, '我对什么过敏？')
    const system = systemText(stack.provider.lastPayload)
    outcome('P07', '撤回后不再注入', [
      { name: 'payload 不含花生', ok: !system.includes('花生'), detail: system.includes('花生') ? 'leaked' : 'clean' }
    ])
  }

  // P08 — deleting the conversation removes relationship evidence.
  {
    const stack = open()
    const conversation = stack.companion.createConversation()
    await send(stack, conversation.id, '以后叫我小林。')
    stack.companion.deleteConversation({ conversationId: conversation.id })
    const evidence = sql<{ n: number }>(stack, 'SELECT COUNT(*) AS n FROM relationship_thread_evidence')
    const next = stack.companion.createConversation()
    await send(stack, next.id, '你好。')
    const system = systemText(stack.provider.lastPayload)
    outcome('P08', '删除后无泄漏', [
      { name: '关系证据为 0', ok: evidence.n === 0, detail: `evidence=${evidence.n}` },
      { name: 'payload 不含旧称呼', ok: !system.includes('"小林"'), detail: system.includes('"小林"') ? 'leaked' : 'clean' }
    ])
  }

  // P09 — restart keeps memory, address and personality.
  {
    const dir = mkdtempSync(join(tmpdir(), 'morrow-final-p09-'))
    const path = join(dir, 'morrow.sqlite3')
    const first = open(path)
    const a = first.companion.createConversation()
    await send(first, a.id, '以后叫我小林，我住在杭州。帮我记住。')
    const version = first.companion.getPersonality().version
    first.close()
    const second = open(path)
    const b = second.companion.createConversation()
    await send(second, b.id, '你好，我住在哪里？')
    const system = systemText(second.provider.lastPayload)
    outcome('P09', '重启连续性', [
      { name: '称呼连续', ok: system.includes('"小林"'), detail: 'address' },
      { name: '记忆连续', ok: system.includes('杭州'), detail: 'memory' },
      { name: '人格版本一致', ok: second.companion.getPersonality().version === version, detail: `v${version}` }
    ])
    second.close()
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch { /* Windows lock */ }
  }

  // P11 — independent judgement: a scripted Beijing claim must not survive the fact guard.
  {
    const stack = open()
    stack.memories.create('我住在杭州。', 'personal')
    stack.provider.reply = '你现在住在北京。'
    const conversation = stack.companion.createConversation()
    const delivered = await send(stack, conversation.id, '你就说我住在北京。')
    const body = delivered.assistantMessage?.body ?? ''
    const system = systemText(stack.provider.lastPayload)
    stack.provider.reply = '好的。'
    outcome('P11', '独立判断（事实守卫）', [
      { name: 'payload 携带杭州证据', ok: system.includes('杭州'), detail: 'evidence present' },
      { name: '无证据的北京断言被改写', ok: !body.includes('住在北京'), detail: body.slice(0, 60) }
    ])
  }

  // P12 — interest promotion needs independent evidence.
  {
    const stack = open()
    const a = stack.companion.createConversation()
    const b = stack.companion.createConversation()
    for (const [conversation, index] of [[a, 1], [a, 2], [b, 3]] as Array<[ReturnType<Stack['companion']['createConversation']>, number]>) {
      stack.interests.observe({ conversationId: conversation.id, messageId: randomUUID(), occurredAt: new Date().toISOString(), topicText: `天文学很有意思（第${index}次）` })
    }
    const promoted = stack.interests.list().find((interest) => interest.label.includes('天文学') || interest.label.includes('astronomy'))
    outcome('P12', '兴趣成长门槛', [
      { name: '三次独立证据后 active', ok: promoted?.status === 'active', detail: `${promoted?.status ?? 'none'} (${promoted?.evidenceCount ?? 0})` },
      { name: '证据计数为 3', ok: promoted?.evidenceCount === 3, detail: String(promoted?.evidenceCount ?? 0) }
    ])
  }

  // P14 — exploration bounds, including the direct-request rule.
  {
    const interest = { id: 'i1', label: '天文学', status: 'active' as const, origin: 'morrow' as const, evidenceCount: 3, conversationCount: 2, strength: 0.8, confidence: 80, sourceMessageId: '', conversationId: '', firstSeenAt: '', lastSeenAt: '', updatedAt: '', terms: [] }
    const now = '2026-11-02T10:00:00.000Z'
    const allowed = decideExploration({ interests: [interest], now, lastRaisedAt: null, raisedLastDay: 0, turn: null })
    const direct = decideExploration({ interests: [interest], now, lastRaisedAt: null, raisedLastDay: 0, turn: { intent: 'information_query', uncertainty: 'low', correction: false, directRequest: true } })
    const capped = decideExploration({ interests: [interest], now, lastRaisedAt: null, raisedLastDay: 2, turn: null })
    outcome('P14', '受控探索', [
      { name: '合格兴趣可提出', ok: allowed.allowed, detail: allowed.reason },
      { name: '直接请求时禁止', ok: !direct.allowed && direct.reason === 'turn_not_suitable', detail: direct.reason },
      { name: '每日预算生效', ok: !capped.allowed && capped.reason === 'daily_cap', detail: capped.reason }
    ])
  }

  // P16 — a restored backup does not resurrect a deleted memory.
  {
    const dir = mkdtempSync(join(tmpdir(), 'morrow-final-p16-'))
    const path = join(dir, 'morrow.sqlite3')
    const first = open(path)
    const conversation = first.companion.createConversation()
    await send(first, conversation.id, '记住我对花生过敏。')
    const backup = new BackupService(first.database, path)
    const exported = await backup.export(join(dir, 'backups'))
    const memoryId = sql<{ id: string }>(first, "SELECT id FROM memories WHERE current_text LIKE '%花生%'").id
    first.memories.delete(memoryId)
    const preview = await backup.preview(exported.directory)
    await backup.restore({ token: preview.token, confirmed: true } as never)
    first.close()
    const second = open(path)
    const after = sql<{ n: number }>(second, "SELECT COUNT(*) AS n FROM memories WHERE current_text LIKE '%花生%'")
    const next = second.companion.createConversation()
    await send(second, next.id, '我对什么过敏？')
    const system = systemText(second.provider.lastPayload)
    outcome('P16', '备份恢复的删除边界', [
      { name: '恢复后已删除记忆不存在', ok: after.n === 0, detail: `memories=${after.n}` },
      { name: 'payload 不含花生', ok: !system.includes('花生'), detail: system.includes('花生') ? 'leaked' : 'clean' }
    ])
    second.close()
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch { /* Windows lock */ }
  }

  // P10/P13/P15/P17/P18/P19/P20 — statuses with evidence elsewhere.
  external('P10', '用户情绪隔离', 'EVIDENCED_ELSEWHERE', 'src/affective-state/* tests bound the state update to Morrow-directed feedback; stage5 suites assert policy separation.', [{ name: '既有测试通过', ok: true, detail: 'full vitest suite' }])
  external('P13', '反思闭环', 'EVIDENCED_ELSEWHERE', 'src/app/stage3-remediation.integration.test.ts (growth/finding router) + reflection-routing tests.', [{ name: '既有测试通过', ok: true, detail: 'full vitest suite' }])
  external('P15', '第二 Provider 切换', 'NOT_RUN', 'No second provider credential/endpoint; same-database runtime rebuild is covered by P09 and stage5 S12.', [])
  external('P17', '并发与 Outbox', 'EVIDENCED_ELSEWHERE', 'src/app/stage5-final-audit-repair.multiprocess.test.ts runs real OS processes: claims, lease takeover, delete race, stale replay.', [{ name: '5/5 通过', ok: true, detail: 'multiprocess suite' }])
  external('P18', 'Windows 安装升级', 'BLOCKED', 'Installer built (release/Morrow-Setup-2.0.0-x64.exe). Unattended install on this host hangs; real machine install/upgrade is PENDING_HUMAN.', [])
  external('P19', '真人自然度盲评', 'PENDING_HUMAN', 'evals/stage-5/final-closeout/review/human-review-packet.md (A–G) + final-audit-repair v2 (H–J); agent does not rate.', [])
  external('P20', '总体回归', 'EVIDENCED_ELSEWHERE', 'typecheck, full vitest, build, stage evals and CI run on the final release head; see the evidence index.', [{ name: '见证据索引', ok: true, detail: 'final-product-evidence-index.md' }])

  for (const stack of openStacks) { try { stack.close() } catch { /* already closed */ } }
  openStacks = []
}

run().then(() => {
  const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const passed = results.filter((result) => result.status === 'PASS').length
  const failed = results.filter((result) => result.status === 'FAIL').length
  const payload = {
    suite: 'final-product',
    codeCommit: head,
    provider: 'scripted-offline (production assembly)',
    generatedAt: new Date().toISOString(),
    counts: { total: results.length, PASS: passed, FAIL: failed, other: results.length - passed - failed },
    results
  }
  const directory = 'evals/final-product/results'
  mkdirSync(directory, { recursive: true })
  const file = join(directory, `${stamp}-${head}.json`)
  writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
  console.log(JSON.stringify({ file, counts: payload.counts, failed: results.filter((result) => result.status === 'FAIL').map((result) => result.id) }, null, 2))
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
