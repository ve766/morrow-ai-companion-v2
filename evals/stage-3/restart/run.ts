/**
 * Stage 3 restart evaluation.
 *
 * The point is not "SQLite can persist rows". It is that the *whole runtime* —
 * database, migrations, repositories, services and the companion — can be torn
 * down and rebuilt on the same file, and the next turn reads what the previous
 * process wrote into the final provider payload.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildStack, head, systemText } from '../runner/harness'

interface Assertion { name: string; ok: boolean; detail: string }

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const directory = mkdtempSync(join(tmpdir(), 'morrow-stage3-restart-run-'))
  const path = join(directory, 'morrow.sqlite3')
  const assertions: Assertion[] = []
  let firstOffsets: Record<string, number> = {}
  let firstInterestId = ''

  const first = buildStack({ growth: true, exploration: true, reflection: true, databasePath: path, keepDatabase: true })
  try {
    const memory = first.memories.create('我的项目代号是 Morrow，正在做长期陪伴。', 'personal')
    const conversation = first.companion.createConversation()
    for (let index = 0; index < 3; index += 1) {
      await first.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '以后直接说重点，别铺垫。', includeSensitive: false }, () => undefined)
    }
    for (let index = 0; index < 3; index += 1) {
      first.interests.observeMorrow({
        conversationId: index === 2 ? first.companion.createConversation().id : conversation.id,
        findingId: crypto.randomUUID(),
        occurredAt: new Date(Date.now() + index * 1000).toISOString(),
        topicText: '长期记忆里证据与遗忘的边界'
      })
    }
    firstOffsets = Object.fromEntries(first.growth.list().map((entry) => [entry.dimension, entry.offset]))
    firstInterestId = first.interests.activeForContext(10).find((interest) => interest.origin !== 'user')?.id ?? ''
    assertions.push({ name: '重启前写入记忆与漂移', ok: Boolean(memory.id) && Object.values(firstOffsets).some((offset) => offset !== 0), detail: JSON.stringify(firstOffsets) })
  } finally {
    first.close()
  }

  const second = buildStack({ growth: true, exploration: true, reflection: true, databasePath: path, keepDatabase: true })
  try {
    const conversation = second.companion.createConversation()
    await second.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我们继续之前那个项目。', includeSensitive: false }, () => undefined)
    const payload = systemText(second.provider.lastPayload)
    const secondOffsets = Object.fromEntries(second.growth.list().map((entry) => [entry.dimension, entry.offset]))
    const secondInterest = second.interests.activeForContext(10).find((interest) => interest.origin !== 'user')

    assertions.push({ name: '重启后记忆进入最终 payload', ok: payload.includes('Morrow'), detail: 'text scan' })
    assertions.push({ name: '重启后人格漂移连续', ok: JSON.stringify(firstOffsets) === JSON.stringify(secondOffsets), detail: JSON.stringify(secondOffsets) })
    assertions.push({ name: '重启后自身兴趣仍带独立来源', ok: Boolean(secondInterest) && secondInterest!.id === firstInterestId && secondInterest!.origin !== 'user', detail: secondInterest ? `${secondInterest.label}:${secondInterest.origin}` : 'none' })
    assertions.push({ name: '重启后基线未被改写', ok: second.companion.getPersonality().version >= 1, detail: `v${second.companion.getPersonality().version}` })

    // Deletion after the restart must still cascade to derived evidence.
    const memory = second.memories.list().find((item) => item.currentText.includes('Morrow'))
    if (memory) second.memories.retract(memory.id)
    await second.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我们继续之前那个项目。', includeSensitive: false }, () => undefined)
    const afterRetract = systemText(second.provider.lastPayload)
    assertions.push({ name: '重启后撤回仍使内容退出 payload', ok: !afterRetract.includes('正在做长期陪伴'), detail: 'text scan' })
  } finally {
    second.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }

  const payload = {
    datasetVersion: 'stage-3-v1',
    harnessVersion: 'stage-3-restart-v1',
    codeCommit: head(),
    environment: { platform: process.platform, node: process.version },
    provider: 'scripted-offline (not a model)',
    clock: 'system',
    startedAt,
    finishedAt: new Date().toISOString(),
    status: assertions.every((assertion) => assertion.ok) ? 'PASS' : 'FAIL',
    assertions
  }
  const outDir = join(resolve(process.cwd()), 'evals', 'stage-3', 'restart', 'results')
  mkdirSync(outDir, { recursive: true })
  const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const file = join(outDir, `${stamp}-${payload.codeCommit.slice(0, 7)}.json`)
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ file, status: payload.status, assertions }, null, 2)}\n`)
  if (payload.status !== 'PASS') process.exitCode = 1
}

void main()
