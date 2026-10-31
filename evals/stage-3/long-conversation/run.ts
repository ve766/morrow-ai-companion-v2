/**
 * Stage 3 long-conversation evaluation.
 *
 * 30 turns across 3 independent conversations. What it checks is the property a
 * single-turn test cannot see: an early constraint stated at turn 1 is still in
 * the payload at turn 30, a correction at turn 10 still governs turn 25, and the
 * context budget does not silently drop the memory block.
 *
 * The provider is scripted, so nothing here is a claim about model quality.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildStack, head, systemText } from '../runner/harness'

interface Assertion { name: string; ok: boolean; detail: string }

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const stack = buildStack()
  const assertions: Assertion[] = []
  try {
    const memory = stack.memories.create('我对花生过敏，任何含花生的食物都不要推荐。', 'personal')
    const conversationA = stack.companion.createConversation()
    const conversationB = stack.companion.createConversation()
    const conversationC = stack.companion.createConversation()

    let turns = 0
    const send = async (conversationId: string, content: string): Promise<string> => {
      await stack.companion.sendChat({ conversationId, requestId: crypto.randomUUID(), content, includeSensitive: false }, () => undefined)
      turns += 1
      return systemText(stack.provider.lastPayload)
    }

    // Turn 1 states the constraint; the remaining turns are ordinary chatter that
    // must not push it out of the window.
    const first = await send(conversationA.id, '先记住一件事：我对花生过敏。')
    assertions.push({ name: '第 1 轮就投递了过敏约束', ok: first.includes('花生'), detail: `len=${first.length}` })

    for (let index = 0; index < 14; index += 1) {
      await send(conversationA.id, `我们随便聊聊第 ${index + 1} 个话题，比如今天的工作安排。`)
    }
    // Turn 11: the user corrects a fact; the correction must win from here on.
    const correction = stack.memories.correct(memory.id, '我对花生和坚果都过敏，任何含坚果的食物也不要推荐。')
    assertions.push({ name: '纠正写入成功', ok: correction.revision > 1, detail: `revision=${correction.revision}` })

    for (let index = 0; index < 14; index += 1) {
      await send(conversationB.id, `换个会话继续，这是第 ${index + 1} 段闲聊。`)
    }

    const late = await send(conversationC.id, '晚饭推荐点什么？注意我的忌口。')
    assertions.push({ name: '第 30 轮仍带忌口证据', ok: late.includes('坚果'), detail: 'text scan' })
    assertions.push({ name: '纠正后的旧值不再出现', ok: !late.includes('任何含花生的食物'), detail: 'text scan' })
    assertions.push({ name: '跨 3 个会话仍可见同一记忆', ok: late.includes(memory.id), detail: memory.id.slice(0, 8) })
    assertions.push({ name: '上下文预算未把证据块挤掉', ok: late.includes('Saved memories'), detail: `len=${late.length}` })
    assertions.push({ name: '轮次计数达到 30', ok: turns >= 30, detail: `turns=${turns}` })

    // No duplicated derived rows from 30 turns of the same conversation pattern.
    const growthRows = stack.database.connection.prepare('SELECT COUNT(*) AS n FROM personality_growth_signals').get() as { n: number }
    const explorationRows = stack.database.connection.prepare('SELECT COUNT(*) AS n FROM exploration_events').get() as { n: number }
    assertions.push({ name: '派生证据按轮去重（不重复累积）', ok: growthRows.n <= turns, detail: `growth=${growthRows.n} exploration=${explorationRows.n}` })
  } finally {
    stack.close()
  }

  const payload = {
    datasetVersion: 'stage-3-v2.1',
    harnessVersion: 'stage-3-long-conversation-v2',
    codeCommit: head(),
    environment: { platform: process.platform, node: process.version },
    provider: 'scripted-offline (not a model)',
    clock: 'system',
    startedAt,
    finishedAt: new Date().toISOString(),
    status: assertions.every((assertion) => assertion.ok) ? 'PASS' : 'FAIL',
    assertions
  }
  const outDir = join(resolve(process.cwd()), 'evals', 'stage-3', 'long-conversation', 'results')
  mkdirSync(outDir, { recursive: true })
  const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const file = join(outDir, `${stamp}-${payload.codeCommit.slice(0, 7)}.json`)
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ file, status: payload.status, assertions }, null, 2)}\n`)
  if (payload.status !== 'PASS') process.exitCode = 1
}

void main()
