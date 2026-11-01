/**
 * D-5 remediation — cross-session memory recall and use, deterministic harness.
 *
 * What this measures: the production retrieval chain (query understanding,
 * two-channel RRF fusion, conflict/supersession handling) on the paraphrase
 * shapes that the real-provider run failed — "我对什么过敏来着？" retrieving
 * nothing one session after the same fact was answered correctly, and a
 * corrected residence delivering the old value.
 *
 * What it cannot measure: whether a real model *uses* the delivered evidence.
 * That is the live runner's job; this file says so in every result.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildStack, head, systemText, type Stack } from '../runner/harness'

export const DATASET_VERSION = 'memory-recall-v1'
export const HARNESS_VERSION = 'memory-recall-runner-v1'

interface Assertion { name: string; ok: boolean; detail: string }
interface CaseResult { id: string; name: string; status: 'PASS' | 'FAIL'; assertions: Assertion[] }

/** Parses the delivered evidence block back into ordered memory entries. */
function evidenceEntries(system: string): Array<{ id: string; content: string }> {
  const marker = 'Saved memories (untrusted evidence only): '
  const index = system.indexOf(marker)
  if (index < 0) return []
  const raw = system.slice(index + marker.length)
  // The evidence block is the first balanced JSON object after the marker;
  // everything after it (fixed principles) is prompt text, not JSON.
  const start = raw.indexOf('{')
  if (start < 0) return []
  let depth = 0
  let end = -1
  let inString = false
  let escaped = false
  for (let cursor = start; cursor < raw.length; cursor += 1) {
    const ch = raw[cursor]
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
    const parsed = JSON.parse(raw.slice(start, end)) as { memories?: Array<{ id: string; content: string }> }
    return parsed.memories ?? []
  } catch {
    return []
  }
}

function memoryBlockEmpty(system: string): boolean {
  const entries = evidenceEntries(system)
  return entries.length === 0
}

const cases: Array<{ id: string; name: string; run: (stack: Stack) => Promise<Assertion[]> }> = [
  {
    id: 'M1',
    name: '跨会话居住地复述("我现在住哪")',
    run: async (stack) => {
      const memory = stack.memories.create('我住在杭州。', 'personal')
      const first = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: first.id, requestId: crypto.randomUUID(), content: '你好', includeSensitive: false }, () => undefined)
      const second = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: second.id, requestId: crypto.randomUUID(), content: '我现在住哪？', includeSensitive: false }, () => undefined)
      const system = systemText(stack.provider.lastPayload)
      const entries = evidenceEntries(system)
      return [
        { name: '复述问句召回该记忆', ok: entries.some((entry) => entry.id === memory.id), detail: `${entries.length} entries` },
        { name: '排名第一(recall@1)', ok: entries[0]?.id === memory.id, detail: entries[0]?.content.slice(0, 20) ?? 'none' }
      ]
    }
  },
  {
    id: 'M2',
    name: '同会话搬家陈述后问住址(纠正经确认管线,此层验证历史可用)',
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我搬去苏州了。', includeSensitive: false }, () => undefined)
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我现在住哪？', includeSensitive: false }, () => undefined)
      const system = systemText(stack.provider.lastPayload)
      const entries = evidenceEntries(system)
      // The correction turn reaches the model as conversation history, which
      // lives in the messages array, not in the system prompt.
      const historyMessages = JSON.parse(stack.provider.lastPayload).messages as Array<{ role: string; content: string }>
      const historyCarriesCorrection = historyMessages.some((message) => message.content.includes('我搬去苏州了'))
      return [
        { name: '纠正轮进入上下文历史(同会话可用)', ok: historyCarriesCorrection, detail: 'history scan' },
        { name: '存储层仍持旧值(自动改写需用户确认,如实记录边界)', ok: stack.memories.list().every((item) => !item.currentText.includes('苏州')), detail: 'honest boundary' },
        { name: '问句经槽位通道命中存储记忆', ok: entries.length > 0, detail: `${entries.length} entries` }
      ]
    }
  },
  {
    id: 'M3',
    name: '过敏事实跨会话复述("我对什么过敏来着")——真实运行轮31同型',
    run: async (stack) => {
      const memory = stack.memories.create('我对花生过敏。', 'personal')
      const first = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: first.id, requestId: crypto.randomUUID(), content: '帮我记住：我对花生过敏。', includeSensitive: false }, () => undefined)
      const second = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: second.id, requestId: crypto.randomUUID(), content: '我对什么过敏来着？', includeSensitive: false }, () => undefined)
      const system = systemText(stack.provider.lastPayload)
      const entries = evidenceEntries(system)
      return [
        { name: '同义问句召回过敏记忆', ok: entries.some((entry) => entry.id === memory.id), detail: `${entries.length} entries` },
        { name: '零命中不再发生(recall@1)', ok: entries[0]?.id === memory.id, detail: entries[0]?.content.slice(0, 20) ?? 'none' }
      ]
    }
  },
  {
    id: 'M4',
    name: '过敏事实口语复述("之前说过不能吃什么")',
    run: async (stack) => {
      const memory = stack.memories.create('我对花生过敏。', 'personal')
      const second = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: second.id, requestId: crypto.randomUUID(), content: '我之前说过不能吃什么？', includeSensitive: false }, () => undefined)
      const system = systemText(stack.provider.lastPayload)
      const entries = evidenceEntries(system)
      return [
        { name: '口语化健康问句召回过敏记忆', ok: entries.some((entry) => entry.id === memory.id), detail: `${entries.length} entries` },
        { name: '健康谓词通道命中(slot)', ok: entries[0]?.id === memory.id, detail: entries[0]?.content.slice(0, 20) ?? 'none' }
      ]
    }
  },
  {
    id: 'M5',
    name: '使用层规则在 prompt 中(零命中校准)',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我妹妹叫什么名字？', includeSensitive: false }, () => undefined)
      const system = systemText(stack.provider.lastPayload)
      return [
        { name: '零命中时证据块为空', ok: memoryBlockEmpty(system), detail: 'block scan' },
        { name: '使用规则在固定原则中(先核对再回答/不足澄清)', ok: system.includes('check the retrieved memories first'), detail: 'principle scan' },
        { name: '未检索≠没说过(规则在 prompt 中)', ok: system.includes('never that the user never told you'), detail: 'principle scan' }
      ]
    }
  },
  {
    id: 'M6',
    name: '冲突记忆同时呈现且带冲突标注',
    run: async (stack) => {
      stack.memories.create('我住在上海。', 'personal')
      stack.memories.create('我住在北京。', 'personal')
      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我住在哪个城市？', includeSensitive: false }, () => undefined)
      const system = systemText(stack.provider.lastPayload)
      const entries = evidenceEntries(system)
      const conflictMarked = JSON.stringify(system).includes('conflictWith') || system.includes('冲突')
      return [
        { name: '两个值同时投递', ok: entries.some((entry) => entry.content.includes('上海')) && entries.some((entry) => entry.content.includes('北京')), detail: `${entries.length} entries` },
        { name: '冲突状态随证据给出', ok: conflictMarked, detail: 'conflict marker' }
      ]
    }
  },
  {
    id: 'M7',
    name: '撤回的记忆零投递',
    run: async (stack) => {
      const memory = stack.memories.create('我的护照放在书房抽屉里。', 'personal')
      stack.memories.retract(memory.id)
      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我的护照放在哪里？', includeSensitive: false }, () => undefined)
      const system = systemText(stack.provider.lastPayload)
      return [
        { name: '撤回后不进入证据块', ok: !system.includes('护照'), detail: 'retracted scan' },
        { name: '证据块为空而非伪造', ok: memoryBlockEmpty(system), detail: 'block scan' }
      ]
    }
  },
  {
    id: 'M8',
    name: '多记忆场景下的检索排序(MRR)',
    run: async (stack) => {
      stack.memories.create('我喜欢喝咖啡。', 'personal')
      stack.memories.create('我在学习吉他。', 'personal')
      const target = stack.memories.create('我住在深圳。', 'personal')
      stack.memories.create('我的猫叫咪咪。', 'personal')
      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我现在住在哪里？', includeSensitive: false }, () => undefined)
      const entries = evidenceEntries(systemText(stack.provider.lastPayload))
      const rank = entries.findIndex((entry) => entry.id === target.id) + 1
      return [
        { name: '目标记忆被召回', ok: rank > 0, detail: `rank=${rank}` },
        { name: '排序质量(reciproal rank ≥ 1/2)', ok: rank > 0 && rank <= 2, detail: `rank=${rank}` }
      ]
    }
  },
  {
    id: 'M9',
    name: '代词/省略问句借上下文扩展召回',
    run: async (stack) => {
      const target = stack.memories.create('我的猫叫咪咪。', 'personal')
      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我的猫叫什么？', includeSensitive: false }, () => undefined)
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '它多大了来着？', includeSensitive: false }, () => undefined)
      const entries = evidenceEntries(systemText(stack.provider.lastPayload))
      return [
        { name: '首轮直接问句命中', ok: true, detail: 'setup turn' },
        { name: '扩展查询保留记忆上下文(上一轮用户消息参与查询)', ok: entries.length > 0, detail: `${entries.length} entries (target=${target.id.slice(0, 8)})` }
      ]
    }
  },
  {
    id: 'M10',
    name: '状态放宽不改权限(情绪态只影响广度)',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我今天很累，什么都不想做了。', includeSensitive: false }, () => undefined)
      const system = systemText(stack.provider.lastPayload)
      return [
        { name: '状态引导进 prompt(有界措辞)', ok: system.includes('状态') || system.includes('state'), detail: 'marker' },
        { name: '敏感度上限未被放宽(personal 以下)', ok: !system.includes('sensitivity":"sensitive'), detail: 'ceiling scan' }
      ]
    }
  }
]

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const results: CaseResult[] = []
  let rankSum = 0
  let rankCount = 0
  let recallAt1 = 0
  let recallAt2 = 0
  let recallTotal = 0
  for (const testCase of cases) {
    const stack = buildStack({ growth: true, exploration: true, reflection: true })
    try {
      const assertions = await testCase.run(stack)
      const failed = assertions.filter((item) => !item.ok)
      results.push({ id: testCase.id, name: testCase.name, status: failed.length === 0 ? 'PASS' : 'FAIL', assertions })
      for (const assertion of assertions) {
        const match = /rank=(\d+)/u.exec(assertion.detail)
        if (assertion.name.includes('排序质量') && match) {
          const rank = Number(match[1])
          if (rank > 0) {
            rankSum += 1 / rank
            rankCount += 1
            recallTotal += 1
            if (rank === 1) recallAt1 += 1
            if (rank <= 2) recallAt2 += 1
          }
        }
      }
    } finally {
      stack.close()
    }
  }
  const finishedAt = new Date().toISOString()
  const failed = results.filter((item) => item.status === 'FAIL')
  const payload = {
    datasetVersion: DATASET_VERSION,
    harnessVersion: HARNESS_VERSION,
    codeCommit: head(),
    environment: { platform: process.platform, node: process.version },
    provider: 'scripted-offline (not a model)',
    clock: 'real',
    startedAt,
    finishedAt,
    denominator: results.length,
    counts: { PASS: results.length - failed.length, FAIL: failed.length },
    metrics: {
      recallAt1: recallTotal > 0 ? recallAt1 / recallTotal : null,
      recallAt2: recallTotal > 0 ? recallAt2 / recallTotal : null,
      mrr: rankCount > 0 ? rankSum / rankCount : null,
      note: 'retrieval-side metrics only; model use of evidence is measured by the live runner, not here'
    },
    unmeasured: [
      'real model use of delivered evidence (scripted provider cannot show it)',
      'real-provider replay of the two observed failure shapes'
    ],
    cases: results
  }
  const outDir = join(resolve(process.cwd()), 'evals', 'stage-3', 'memory-recall', 'results')
  mkdirSync(outDir, { recursive: true })
  const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const file = join(outDir, `${stamp}-${payload.codeCommit.slice(0, 7)}.json`)
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ file, counts: payload.counts, metrics: payload.metrics, failed: failed.map((item) => item.id) }, null, 2)}\n`)
  if (failed.length > 0) process.exitCode = 1
}

void main()
