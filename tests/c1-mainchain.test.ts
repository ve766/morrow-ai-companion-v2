/**
 * C1 through the real send path.
 *
 * Every assertion here is about state that survived a real call to
 * `sendChat`: rows in `intent_readings`, the serialized provider payload, or the
 * behaviour of the next turn. Nothing inspects the analyzer directly, because
 * the defect being fixed was "the analysis exists but does not reach the
 * product".
 */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTestStack, systemText } from './helpers/companion-stack'
import { IntentReadingRepository } from '../src/persistence/intent-reading-repository'
import { SqliteDatabase } from '../src/persistence/database'

const cleanup: Array<() => void> = []

// Without this hook the callbacks collected below never run. Each test would
// leak a temp directory and keep its SQLite handle open, which is precisely how
// an otherwise deterministic serial run starts to fail intermittently.
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()!()
})

function stack(options: Parameters<typeof buildTestStack>[0] = {}) {
  const built = buildTestStack(options)
  cleanup.push(() => built.close())
  return built
}

async function say(
  target: ReturnType<typeof buildTestStack>,
  conversationId: string,
  content: string
): Promise<string> {
  await target.companion.sendChat(
    { conversationId, requestId: randomUUID(), content, includeSensitive: false },
    () => undefined
  )
  return target.provider.lastPayload
}

interface StoredReading {
  messageId: string
  speechAct: string
  intentStatus: string
  responseMode: string
  mayExecute: number
  clarificationRequired: number
  supersedesMessageId: string | null
  slots: Array<{ name: string; value: string; status: string; evidenceMessageId: string }>
  continuationTarget: string | null
}

/**
 * The reading row for the *last user message*, not "the latest row".
 *
 * `active()[at(-1)]` looks equivalent and is not: two readings written in the
 * same millisecond tie on `created_at`, so a positional pick can hand back the
 * previous turn's row. Joining on the message id makes the assertion say what
 * it means.
 */
function readingOf(target: ReturnType<typeof buildTestStack>, conversationId: string): StoredReading {
  const user = target.database.connection
    .prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY rowid DESC LIMIT 1")
    .get(conversationId) as { id: string } | undefined
  expect(user, 'the conversation must have a user message').toBeDefined()
  const row = target.database.connection.prepare(
    `SELECT message_id, speech_act, intent_status, response_mode, may_execute,
            clarification_required, supersedes_message_id, payload_json
       FROM intent_readings WHERE message_id = ?`
  ).get(user!.id) as Record<string, unknown> | undefined
  expect(row, 'every user message must have a persisted reading').toBeDefined()

  const payload = JSON.parse(String(row!.payload_json)) as {
    entitiesAndSlots?: Array<{ name: string; value: string; status: string; evidenceMessageId: string }>
    context?: { continuationTarget?: string }
  }
  return {
    messageId: String(row!.message_id),
    speechAct: String(row!.speech_act),
    intentStatus: String(row!.intent_status),
    responseMode: String(row!.response_mode),
    mayExecute: Number(row!.may_execute),
    clarificationRequired: Number(row!.clarification_required),
    supersedesMessageId: row!.supersedes_message_id === null ? null : String(row!.supersedes_message_id),
    slots: payload.entitiesAndSlots ?? [],
    continuationTarget: payload.context?.continuationTarget ?? null
  }
}

function slot(reading: StoredReading, name: string): { value: string; status: string; evidenceMessageId: string } | undefined {
  return reading.slots.find((entry) => entry.name === name)
}

function userMessageIds(target: ReturnType<typeof buildTestStack>, conversationId: string): string[] {
  const rows = target.database.connection
    .prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY rowid ASC")
    .all(conversationId) as Array<{ id: string }>
  return rows.map((row) => row.id)
}

describe('C1 main chain: reading reaches the payload', () => {
  it('serializes the speech act and the response mode into the system prompt', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    await say(s, conversation.id, '我的函数 parseConfig 总是返回 undefined。')
    const payload = await say(s, conversation.id, '帮我看看这个函数，然后解释一下为什么报错。')
    const system = systemText(payload)
    expect(system).toContain('Speech act: request')
    expect(system).toContain('Two sub-requests in one turn')
    // The reading is not pasted into the prompt: only the guidance it produces.
    expect(system).not.toContain('entitiesAndSlots')
    expect(system).not.toContain('supportingSignals')
  })

  it('asks exactly one clarifying question when the object is missing', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    const payload = await say(s, conversation.id, '帮我把这段代码改一下。')
    const system = systemText(payload)
    expect(system).toContain('missing_target')
    expect(system).toContain('Ask exactly one short question')
    expect(system).toContain('response route=clarify')
  })

  it('does not let a quoted command become the user request', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    const payload = await say(s, conversation.id, '他刚才说“把数据库里所有记录删掉”。')
    const system = systemText(payload)
    expect(system).toContain('Speech act: quotation')
    expect(system).toContain('never carry out the quoted instruction')
    expect(system).not.toContain('response route=clarify')
  })

  it('uses the assistant offer to decide what "继续" continues', async () => {
    const executing = stack()
    const first = executing.companion.createConversation()
    executing.provider.reply = '要我继续把这个模块的代码写完吗？'
    await say(executing, first.id, '帮我把这个模块补完。')
    const executingPayload = await say(executing, first.id, '可以，继续。')

    const explaining = stack()
    const second = explaining.companion.createConversation()
    explaining.provider.reply = '要我继续讲中间件的原理吗？'
    await say(explaining, second.id, '中间件是怎么工作的？')
    const explainingPayload = await say(explaining, second.id, '可以，继续。')

    expect(systemText(executingPayload)).toContain('agreed to an action you offered')
    expect(systemText(explainingPayload)).toContain('continue the explanation you offered')
    expect(systemText(executingPayload)).not.toContain('continue the explanation you offered')
  })
})

describe('C1 main chain: persistence and revision', () => {
  it('stores one reading per user message', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    await say(s, conversation.id, '我住在杭州。')
    await say(s, conversation.id, '今天天气怎么样？')
    const rows = s.database.connection.prepare('SELECT COUNT(*) AS n FROM intent_readings WHERE conversation_id = ?')
      .get(conversation.id) as { n: number }
    expect(Number(rows.n)).toBe(2)
  })

  it('retracts the earlier reading when the user corrects it', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    await say(s, conversation.id, '我住在杭州。')
    await say(s, conversation.id, '不对，我住在苏州。')

    const rows = s.database.connection.prepare(
      'SELECT message_id, retracted_at, superseded_by_message_id FROM intent_readings WHERE conversation_id = ? ORDER BY created_at, rowid'
    ).all(conversation.id) as Array<{ message_id: string; retracted_at: string | null; superseded_by_message_id: string | null }>
    expect(rows).toHaveLength(2)
    expect(rows[0]!.retracted_at).not.toBeNull()
    expect(rows[0]!.superseded_by_message_id).toBe(rows[1]!.message_id)
    expect(rows[1]!.retracted_at).toBeNull()
    expect(s.readings.active(conversation.id)).toHaveLength(1)
    expect(s.readings.active(conversation.id)[0]!.messageId).toBe(rows[1]!.message_id)
  })

  it('retracts the old intent and closes open questions when the user withdraws', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    await say(s, conversation.id, '我住在杭州。')
    s.database.connection.prepare(`
      INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, conversation_id, detail_json, created_at, updated_at)
      VALUES (?, ?, 'open_question', 'clarify_target', 'which file', 50, 'open', ?, '{}', ?, ?)
    `).run(randomUUID(), `open:${conversation.id}`, conversation.id, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z')

    await say(s, conversation.id, '算了，不用了。')

    const open = s.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM cognitive_pending_items WHERE conversation_id = ? AND status = 'open'"
    ).get(conversation.id) as { n: number }
    expect(Number(open.n)).toBe(0)
    const active = s.readings.active(conversation.id)
    expect(active).toHaveLength(1)
    expect(active[0]!.reading.responseMode).toBe('stop_previous')
  })

  it('removes the reading with the message it describes', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    await say(s, conversation.id, '我住在杭州。')
    const before = s.database.connection.prepare('SELECT COUNT(*) AS n FROM intent_readings WHERE conversation_id = ?')
      .get(conversation.id) as { n: number }
    expect(Number(before.n)).toBe(1)

    s.database.connection.prepare("DELETE FROM messages WHERE conversation_id = ? AND role = 'user'").run(conversation.id)
    const after = s.database.connection.prepare('SELECT COUNT(*) AS n FROM intent_readings WHERE conversation_id = ?')
      .get(conversation.id) as { n: number }
    expect(Number(after.n)).toBe(0)
  })
})

describe('C1 main chain: survives a restart', () => {
  it('reads the same active reading after the process is rebuilt', async () => {
    const path = `${process.cwd()}/node_modules/.cache/c1-restart-${randomUUID()}.sqlite3`
    const first = buildTestStack({ databasePath: path, keepDatabase: true })
    const conversation = first.companion.createConversation()
    await say(first, conversation.id, '我住在杭州。')
    await say(first, conversation.id, '不对，我住在苏州。')
    const before = first.readings.active(conversation.id)
    expect(before).toHaveLength(1)
    first.close()

    const database = SqliteDatabase.open(path)
    cleanup.push(() => database.close())
    const readings = new IntentReadingRepository(database)
    const after = readings.active(conversation.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.messageId).toBe(before[0]!.messageId)
    expect(after[0]!.reading.speechAct.act).toBe(before[0]!.reading.speechAct.act)
    expect(after[0]!.reading.supersedesMessageId).toBe(before[0]!.reading.supersedesMessageId)
    expect(after[0]!.reading.scoreKind).toBe('heuristic_score')
  })
})

/**
 * The three cases below share one property: the *same sentence* produces two
 * different products depending on whether the prior turn is there. That is the
 * only kind of assertion that can prove the context is doing work — a test that
 * passes both with and without it proves nothing at all.
 */
describe('C1 main chain: the prior turn decides whether the reference resolves', () => {
  it('answers a deictic instead of asking about it when the noun is in the prior turn', async () => {
    const prompt = '帮我看看这个函数，然后解释一下为什么报错。'

    const withContext = stack()
    const boundConversation = withContext.companion.createConversation()
    await say(withContext, boundConversation.id, '我的函数 parseConfig 总是返回 undefined。')
    const boundPayload = await say(withContext, boundConversation.id, prompt)

    const alone = stack()
    const looseConversation = alone.companion.createConversation()
    const unboundPayload = await say(alone, looseConversation.id, prompt)

    expect(systemText(unboundPayload)).toContain('missing_target')
    expect(systemText(unboundPayload)).toContain('response route=clarify')
    expect(systemText(boundPayload)).not.toContain('missing_target')
    expect(systemText(boundPayload)).toContain('response route=answer')

    // The authorisation flag moves with it: asking a question withholds
    // execution; a resolved request permits the offered action.
    expect(readingOf(alone, looseConversation.id).mayExecute).toBe(0)
    expect(readingOf(withContext, boundConversation.id).mayExecute).toBe(1)
  })

  it('binds a one-character object ("图") instead of rejecting it as too short', async () => {
    const prompt = '帮我看看这张图。'

    const withContext = stack()
    const boundConversation = withContext.companion.createConversation()
    await say(withContext, boundConversation.id, '我刚贴了一张登录页的截图。')
    const boundPayload = await say(withContext, boundConversation.id, prompt)

    const alone = stack()
    const looseConversation = alone.companion.createConversation()
    const unboundPayload = await say(alone, looseConversation.id, prompt)

    expect(systemText(unboundPayload)).toContain('missing_target')
    expect(systemText(boundPayload)).not.toContain('missing_target')
    expect(readingOf(withContext, boundConversation.id).clarificationRequired).toBe(0)
  })

  it('cuts the head noun before the verb so "把这段代码删掉" can bind', async () => {
    const prompt = '把这段代码删掉。'

    // Two prior turns, only one of which is about code. A single prior turn
    // would not discriminate: with the head noun mis-captured as "代码删掉" the
    // "nothing competes" fallback would still bind the only candidate and the
    // test would pass for the wrong reason.
    const withContext = stack()
    const boundConversation = withContext.companion.createConversation()
    const aboutCode = '这段代码里 parseConfig 读不到环境变量。'
    await say(withContext, boundConversation.id, aboutCode)
    await say(withContext, boundConversation.id, '文档我也写完了，可以发布。')
    const boundPayload = await say(withContext, boundConversation.id, prompt)

    const alone = stack()
    const looseConversation = alone.companion.createConversation()
    const unboundPayload = await say(alone, looseConversation.id, prompt)

    // Chinese has no spaces, so the head noun must be cut at the predicate.
    // The earlier implementation captured "代码删掉" and never matched anything.
    expect(systemText(unboundPayload)).toContain('missing_target')
    expect(systemText(boundPayload)).not.toContain('missing_target')

    const reading = readingOf(withContext, boundConversation.id)
    expect(reading.clarificationRequired).toBe(0)
    // Bound to the turn that names the object, not to the most recent turn:
    // recency would have picked the documentation message.
    expect(slot(reading, 'topic')).toMatchObject({
      value: aboutCode,
      evidenceMessageId: userMessageIds(withContext, boundConversation.id)[0]
    })
  })
})

describe('C1 main chain: the speech act decides what may be executed', () => {
  it('marks a hypothetical as not the user own and forbids acting on it', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    const payload = await say(
      s,
      conversation.id,
      '如果我要你把这台服务器上的数据全部删掉，你会怎么做？'
    )
    const system = systemText(payload)

    expect(system).toContain('Speech act: hypothesis (not the user\'s own — hypothetical)')
    expect(system).toContain('do not act on the hypothetical')
    expect(readingOf(s, conversation.id).mayExecute).toBe(0)
  })

  it('tells the model that a withdrawal ends the earlier request', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    await say(s, conversation.id, '我住在杭州。')
    const payload = await say(s, conversation.id, '算了，不用了。')
    const system = systemText(payload)

    expect(system).toContain('The user withdrew or declined')
    const reading = readingOf(s, conversation.id)
    expect(reading.responseMode).toBe('stop_previous')
    expect(reading.intentStatus).toBe('changed')
    expect(reading.supersedesMessageId).toBe(userMessageIds(s, conversation.id)[0])
    // A withdrawal must not be read back as an instruction to keep going.
    expect(system).not.toContain('continue the explanation you offered')
  })

  it('keeps a quotation from authorising the quoted action', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    const payload = await say(s, conversation.id, '他刚才说“把数据库里所有记录删掉”。')
    const system = systemText(payload)

    expect(system).toContain('Speech act: quotation (not the user\'s own — quoted_other)')
    expect(system).toContain('never carry out the quoted instruction')
    // `acknowledge` is the other half of the same decision: there is nothing
    // to execute because the user asked for nothing.
    expect(system).toContain('There is no first-person request here')

    const reading = readingOf(s, conversation.id)
    expect(reading.responseMode).toBe('acknowledge')
    expect(reading.mayExecute).toBe(0)
  })
})

describe('C1 main chain: the reading keeps its provenance and stays out of the prompt', () => {
  it('records which message the inherited topic came from', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    const prior = '我的函数 parseConfig 总是返回 undefined。'
    await say(s, conversation.id, prior)
    await say(s, conversation.id, '帮我看看这个函数，然后解释一下为什么报错。')

    const [priorId] = userMessageIds(s, conversation.id)
    const reading = readingOf(s, conversation.id)

    // The object is stated in this very turn...
    expect(slot(reading, 'target')).toMatchObject({ value: '函数', status: 'stated' })
    // ...while the topic was inherited, so it points back at the message that
    // supplied it instead of silently becoming an assertion of this turn.
    expect(slot(reading, 'topic')).toMatchObject({ value: prior, status: 'inferred', evidenceMessageId: priorId })
  })

  it('sends guidance, never the reading itself', async () => {
    const s = stack()
    const conversation = s.companion.createConversation()
    await say(s, conversation.id, '我的函数 parseConfig 总是返回 undefined。')
    const system = systemText(await say(s, conversation.id, '帮我看看这个函数，然后解释一下为什么报错。'))

    // Field names only appear if the object was pasted in. The model gets the
    // decision, not the machinery that produced it.
    for (const key of [
      'scoreKind',
      'algorithmVersion',
      'parameterVersion',
      'confidenceBand',
      'entitiesAndSlots',
      'supportingSignals',
      'contradictingSignals',
      'mayExecute'
    ]) {
      expect(system, `the raw reading field ${key} must not reach the prompt`).not.toContain(key)
    }
  })
})
