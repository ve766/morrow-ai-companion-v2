/**
 * C1 — intent and context understanding, deterministic harness.
 *
 * What this measures, exactly:
 *
 *   the production send path, the production database, the production analyzer
 *   and the production prompt assembly, driven by a **scripted provider**.
 *
 * So it can establish that the mechanism is wired and that the decisions differ
 * where they must. It cannot establish language understanding, because the
 * provider is a string. Every result file says so, and the manual review of real
 * conversations is recorded as `PENDING` rather than filled in by the same rules
 * that produced the output.
 *
 * Scenario families follow the task's §5: A same-sentence-different-context,
 * B speech-act vs intent, C quotation/hypothesis/negation, D compound/correction/
 * withdrawal, E unknown and conflict, F mutation.
 */
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildStack, systemText } from '../runner/harness'
import type { IntentReading } from '../../../src/cognition/intent-reading'

export const DATASET_VERSION = 'c1-intent-v1'
export const HARNESS_VERSION = 'c1-intent-runner-v1'
export const PARAMS_VERSION = 'c1-params-v1'

type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN'

interface Assertion {
  name: string
  ok: boolean
  detail: string
}

interface MutationResult {
  name: string
  /** What changed between the original and the mutated turn. */
  before: string
  after: string
  /** True when the decision really moved, which is what a mutation must show. */
  changed: boolean
}

interface ScenarioResult {
  id: string
  family: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  name: string
  requirement: string
  status: Status
  assertions: Assertion[]
  mutations: MutationResult[]
  notRunReason?: string
}

interface TurnRecord {
  scenario: string
  conversationId: string
  messageId: string
  inputSha256: string
  inputCharacters: number
  primaryIntent: string
  intentStatus: string
  speechAct: string
  attributedTo: string
  mayExecute: boolean
  responseMode: string
  clarificationRequired: boolean
  clarificationReason: string | null
  supportingSignals: string[]
  contradictingSignals: string[]
  uncertainties: string[]
  evidenceRefs: string[]
  assistantOffer: string
  continuationTarget: string
  payloadSha256: string
  systemCharacters: number
  readingPersisted: boolean
  algorithmVersion: string
  parameterVersion: string
}

const sha = (value: string): string => createHash('sha256').update(value).digest('hex')

function head(): string {
  if (process.env.MORROW_EVAL_SHA) return process.env.MORROW_EVAL_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const turns: TurnRecord[] = []

interface Turn {
  messageId: string
  reading: IntentReading | null
  system: string
  reply: string
}

/**
 * Sends one turn through the real chat path and records what it decided.
 *
 * The record keeps ids, labels and hashes; the user's words appear only as a
 * digest and a length, so the trace can be handed to a reviewer without
 * republishing the conversation.
 */
async function say(
  stack: ReturnType<typeof buildStack>,
  scenario: string,
  conversationId: string,
  content: string
): Promise<Turn> {
  const result = await stack.companion.sendChat(
    { conversationId, requestId: randomUUID(), content, includeSensitive: false },
    () => undefined
  )
  const messageId = result.userMessage.id
  const record = stack.readings.forMessage(messageId)
  const reading = record?.reading ?? null
  const system = systemText(stack.provider.lastPayload)
  turns.push({
    scenario,
    conversationId,
    messageId,
    inputSha256: sha(content).slice(0, 16),
    inputCharacters: content.length,
    primaryIntent: reading?.primaryIntent ?? 'unavailable',
    intentStatus: reading?.intentStatus ?? 'unavailable',
    speechAct: reading?.speechAct.act ?? 'unavailable',
    attributedTo: reading?.speechAct.attributedTo ?? 'none',
    mayExecute: reading?.mayExecute ?? false,
    responseMode: reading?.responseMode ?? 'unavailable',
    clarificationRequired: reading?.clarificationRequired ?? false,
    clarificationReason: reading?.clarificationReason ?? null,
    supportingSignals: reading?.supportingSignals ?? [],
    contradictingSignals: reading?.contradictingSignals ?? [],
    uncertainties: reading?.uncertainties ?? [],
    evidenceRefs: reading?.evidenceRefs ?? [],
    assistantOffer: reading?.context.assistantOffer ?? 'none',
    continuationTarget: reading?.context.continuationTarget ?? 'none',
    payloadSha256: sha(stack.provider.lastPayload).slice(0, 16),
    systemCharacters: system.length,
    readingPersisted: record !== null,
    algorithmVersion: reading?.algorithmVersion ?? 'unavailable',
    parameterVersion: reading?.parameterVersion ?? 'unavailable'
  })
  return { messageId, reading, system, reply: stack.provider.lastPayload }
}

function outcome(id: string, family: ScenarioResult['family'], name: string, requirement: string, assertions: Assertion[], mutations: MutationResult[] = []): ScenarioResult {
  const status: Status = assertions.length > 0 && assertions.every((item) => item.ok) ? 'PASS' : 'FAIL'
  return { id, family, name, requirement, status, assertions, mutations }
}

const check = (name: string, ok: boolean, detail: string): Assertion => ({ name, ok, detail })

/**
 * A slot value shaped like classifier + noun (`个函数`, `张图`) names a class,
 * not a thing, while still reading as `stated`.
 *
 * The C1-A3 assertion used to test `status === 'stated'` and nothing else, so it
 * passed on exactly those values. Checking only "the value occurs in the
 * utterance" would not have caught them either: `帮我看看这个函数。` does contain
 * `个函数`. The two classifiers below are the ones actually observed in the
 * stored artefact — this is a regression guard for a known shape, not a grammar
 * rule. It has known false-positive shapes (`个人`, a surname `张`), which will
 * show up as a red assertion for a human to read rather than as a silent pass.
 */
const CLASSIFIER_PREFIX = /^[个张](?=.)/u

/** The target is a noun phrase the user actually said this turn, and not one of those. */
function nounFromTurn(turn: Turn | undefined, content: string): boolean {
  const slot = turn?.reading?.entitiesAndSlots.find((item) => item.name === 'target')
  if (!slot || slot.status !== 'stated') return false
  if (!content.includes(slot.value)) return false
  return !CLASSIFIER_PREFIX.test(slot.value)
}

/**
 * The deictic reference resolved to the message it points at.
 *
 * `target` holds the noun phrase; the resolved referent lives on `topic` as
 * `inferred` with the evidence message id. Checking the id — not merely
 * `inferred` — is what makes "the context decided it" a falsifiable claim.
 */
function boundTo(turn: Turn | undefined, messageId: string): boolean {
  const slot = turn?.reading?.entitiesAndSlots.find((item) => item.name === 'topic')
  return slot?.status === 'inferred' && slot.evidenceMessageId === messageId
}

/** One contrast: two conversations, same sentence, different prior assistant turn. */
async function continuationContext(scenario: string, prior: string, reply: string, text: string): Promise<IntentReading | null> {
  const stack = buildStack()
  try {
    const conversation = stack.companion.createConversation()
    stack.provider.reply = prior
    await say(stack, scenario, conversation.id, reply)
    const turn = await say(stack, scenario, conversation.id, text)
    return turn.reading
  } finally {
    stack.close()
  }
}

export async function run(): Promise<{ results: ScenarioResult[]; traces: TurnRecord[] }> {
  const results: ScenarioResult[] = []

  // ---------------------------------------------------------------- A
  {
    const executing = await continuationContext('C1-A1', '要我继续把这个模块的代码写完吗？', '帮我把这个模块补完。', '可以，继续。')
    const explaining = await continuationContext('C1-A1', '要我继续讲中间件的原理吗？', '中间件是怎么工作的？', '可以，继续。')
    const discussing = await continuationContext('C1-A1', '你还想聊点什么？', '随便聊聊。', '可以，继续。')
    results.push(outcome('C1-A1', 'A', '同一句"可以，继续。"在三种承接下不同', '上下文决定承接对象：执行 / 讲解 / 讨论', [
      check('执行语境承接为 execution', executing?.context.continuationTarget === 'execution', String(executing?.context.continuationTarget)),
      check('讲解语境承接为 explanation', explaining?.context.continuationTarget === 'explanation', String(explaining?.context.continuationTarget)),
      check('讨论语境承接为 discussion', discussing?.context.continuationTarget === 'discussion', String(discussing?.context.continuationTarget)),
      check('执行语境进入 execute_pending', executing?.responseMode === 'execute_pending', String(executing?.responseMode)),
      check('讲解语境是回答而不是执行', explaining?.responseMode === 'answer', String(explaining?.responseMode)),
      check('执行语境允许执行动作', executing?.mayExecute === true, String(executing?.mayExecute)),
      check('三种承接的证据不同', new Set([executing?.context.evidence.join(','), explaining?.context.evidence.join(','), discussing?.context.evidence.join(',')]).size === 3, [
        executing?.context.evidence.join(','), explaining?.context.evidence.join(','), discussing?.context.evidence.join(',')
      ].join(' | '))
    ]))
  }

  {
    const returned = await continuationContext('C1-A2', '你觉得这两个方案哪个更好？', '我们在选方案。', '那你觉得呢？')
    const fresh = await continuationContext('C1-A2', '听起来确实很累。', '最近工作压力好大。', '那你觉得呢？')
    results.push(outcome('C1-A2', 'A', '同一句"那你觉得呢？"：回抛问题 vs 新提问', '助手刚问过问题时，用户是把问题抛回来；否则是新提问', [
      check('回抛时状态为 continuing', returned?.intentStatus === 'continuing', String(returned?.intentStatus)),
      check('回抛证据含 assistant_asked_question', Boolean(returned?.context.evidence.includes('assistant_asked_question')), (returned?.context.evidence ?? []).join(',')),
      check('新提问状态为 inferred', fresh?.intentStatus === 'inferred', String(fresh?.intentStatus)),
      check('新提问不含回抛证据', !fresh?.context.evidence.includes('assistant_asked_question'), (fresh?.context.evidence ?? []).join(',')),
      check('两者都不追问', returned?.responseMode === 'answer' && fresh?.responseMode === 'answer', `${returned?.responseMode}/${fresh?.responseMode}`)
    ]))
  }

  {
    const stack = buildStack()
    const code = stack.companion.createConversation()
    const codeIntro = await say(stack, 'C1-A3', code.id, '我的函数 parseConfig 总是返回 undefined。')
    const codeTurn = await say(stack, 'C1-A3', code.id, '帮我看看这个函数。')
    const image = stack.companion.createConversation()
    const imageIntro = await say(stack, 'C1-A3', image.id, '我截了报错弹窗的图。')
    const imageTurn = await say(stack, 'C1-A3', image.id, '帮我看看这张图。')
    const venting = stack.companion.createConversation()
    await say(stack, 'C1-A3', venting.id, '最近工作压力好大，天天加班。')
    const ventingTurn = await say(stack, 'C1-A3', venting.id, '帮我看看。')
    const bare = stack.companion.createConversation()
    const bareTurn = await say(stack, 'C1-A3', bare.id, '帮我看看。')
    stack.close()
    results.push(outcome('C1-A3', 'A', '同一句"帮我看看"在四种语境下不同',
      '代码 / 图片 / 情绪 / 无上下文的目标槽位与决策不同。目标槽位是本轮措辞里的名词短语，指代由 topic 绑定到来源消息；把"这个函数"解析成 parseConfig 这样的实体链接不在本轮实现内，本条不作此主张。', [
      check('代码语境目标取自本轮措辞', nounFromTurn(codeTurn, '帮我看看这个函数。'), JSON.stringify(codeTurn.reading?.entitiesAndSlots ?? [])),
      check('代码语境指代绑定到上一轮那条消息', boundTo(codeTurn, codeIntro.messageId), JSON.stringify(codeTurn.reading?.entitiesAndSlots ?? [])),
      check('图片语境目标取自本轮措辞', nounFromTurn(imageTurn, '帮我看看这张图。'), JSON.stringify(imageTurn.reading?.entitiesAndSlots ?? [])),
      check('图片语境指代绑定到上一轮那条消息', boundTo(imageTurn, imageIntro.messageId), JSON.stringify(imageTurn.reading?.entitiesAndSlots ?? [])),
      check('情绪语境下追问目标而不是臆测', ventingTurn.reading?.responseMode === 'clarify', String(ventingTurn.reading?.responseMode)),
      check('完全无上下文时追问目标', bareTurn.reading?.clarificationReason === 'missing_target', String(bareTurn.reading?.clarificationReason)),
      check('四种语境的承接主题不同', new Set([codeTurn.reading?.entitiesAndSlots.find((slot) => slot.name === 'topic')?.value ?? '', imageTurn.reading?.entitiesAndSlots.find((slot) => slot.name === 'topic')?.value ?? '', ventingTurn.reading?.entitiesAndSlots.find((slot) => slot.name === 'topic')?.value ?? '', bareTurn.reading?.entitiesAndSlots.find((slot) => slot.name === 'topic')?.value ?? '']).size >= 3, 'topic slots')
    ]))
  }

  // ---------------------------------------------------------------- B
  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    const question = await say(stack, 'C1-B1', conversation.id, '你确定这个方案没问题吗？')
    const request = await say(stack, 'C1-B1', conversation.id, '帮我把这个方案改一下，写清楚风险。')
    stack.close()
    results.push(outcome('C1-B1', 'B', '疑问句不是请求', 'speech act 与 intent 分离：质疑用疑问句表达，不等于要求执行', [
      check('质疑被读为 question', question.reading?.speechAct.act === 'question', String(question.reading?.speechAct.act)),
      check('质疑不授权执行', question.reading?.mayExecute === false, String(question.reading?.mayExecute)),
      check('请求被读为 request', request.reading?.speechAct.act === 'request', String(request.reading?.speechAct.act)),
      check('请求授权执行', request.reading?.mayExecute === true, String(request.reading?.mayExecute)),
      check('两者的 intent 不同', question.reading?.primaryIntent !== request.reading?.primaryIntent, `${question.reading?.primaryIntent}/${request.reading?.primaryIntent}`)
    ]))
  }

  {
    const capability = await continuationContext('C1-B2', '好的，我记下了。', '记一下。', '你能不能帮我改一下这个函数？')
    const afterOffer = await continuationContext('C1-B2', '要我帮你改这个函数吗？', '这个函数有问题。', '你能不能帮我改一下这个函数？')
    results.push(outcome('C1-B2', 'B', '"你能不能…"是能力询问还是请求', '依上下文判定，不靠句形', [
      check('无前序提议时读为能力询问', capability?.speechAct.act === 'question', String(capability?.speechAct.act)),
      check('能力询问记录歧义', Boolean(capability?.uncertainties.includes('capability_vs_request')), (capability?.uncertainties ?? []).join(',')),
      check('无前序提议时不授权执行', capability?.mayExecute === false, String(capability?.mayExecute)),
      check('有前序提议时读为请求', afterOffer?.speechAct.act === 'request', String(afterOffer?.speechAct.act)),
      check('有前序提议时授权执行', afterOffer?.mayExecute === true, String(afterOffer?.mayExecute))
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    const preference = await say(stack, 'C1-B3', conversation.id, '我更喜欢你直接一点，别绕弯子。')
    stack.close()
    results.push(outcome('C1-B3', 'B', '偏好表达不等于执行要求', '用户表达偏好但没有要求立即执行', [
      check('读为 preference_expression', preference.reading?.speechAct.act === 'preference_expression', String(preference.reading?.speechAct.act)),
      check('不授权执行', preference.reading?.mayExecute === false, String(preference.reading?.mayExecute)),
      check('正常回答而不追问', preference.reading?.responseMode === 'answer', String(preference.reading?.responseMode))
    ]))
  }

  // ---------------------------------------------------------------- C
  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    const quoted = await say(stack, 'C1-C1', conversation.id, '他刚才说“把数据库里所有记录删掉”。')
    const direct = await say(stack, 'C1-C1', conversation.id, '把数据库里所有记录删掉。')
    stack.close()
    results.push(outcome('C1-C1', 'C', '引用他人的命令不归因为用户请求', '引用主体必须保留，不得转成删除请求', [
      check('引用读为 quotation', quoted.reading?.speechAct.act === 'quotation', String(quoted.reading?.speechAct.act)),
      check('归属为 quoted_other', quoted.reading?.speechAct.attributedTo === 'quoted_other', String(quoted.reading?.speechAct.attributedTo)),
      check('引用不授权执行', quoted.reading?.mayExecute === false, String(quoted.reading?.mayExecute)),
      check('引用不被追问也不被执行', quoted.reading?.responseMode === 'acknowledge', String(quoted.reading?.responseMode)),
      check('同一动作直说时才是请求', direct.reading?.speechAct.act === 'request', String(direct.reading?.speechAct.act))
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    const hypothetical = await say(stack, 'C1-C2', conversation.id, '如果我让你删除这些记录，你会怎么做？')
    stack.close()
    results.push(outcome('C1-C2', 'C', '假设不是执行授权', '假设句必须单独表示，不能转成动作', [
      check('读为 hypothesis', hypothetical.reading?.speechAct.act === 'hypothesis', String(hypothetical.reading?.speechAct.act)),
      check('归属为 hypothetical', hypothetical.reading?.speechAct.attributedTo === 'hypothetical', String(hypothetical.reading?.speechAct.attributedTo)),
      check('不授权执行', hypothetical.reading?.mayExecute === false, String(hypothetical.reading?.mayExecute)),
      check('记录假设不确定性', Boolean(hypothetical.reading?.uncertainties.includes('hypothetical_not_instruction')), (hypothetical.reading?.uncertainties ?? []).join(','))
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    await say(stack, 'C1-C3', conversation.id, '我的函数 parseConfig 有问题。')
    const before = await say(stack, 'C1-C3', conversation.id, '把这段代码删掉。')
    const retract = await say(stack, 'C1-C3', conversation.id, '不要删除刚才那条。')
    stack.close()
    results.push(outcome('C1-C3', 'C', '否定范围：撤回一个待执行动作', '“不要删除刚才那条”必须阻止旧动作', [
      check('先前的删除是请求', before.reading?.speechAct.act === 'request', String(before.reading?.speechAct.act)),
      check('撤回读为 retraction', retract.reading?.speechAct.act === 'retraction', String(retract.reading?.speechAct.act)),
      check('否定作用于动词短语', retract.reading?.speechAct.negation.scope === 'verb_phrase', String(retract.reading?.speechAct.negation.scope)),
      check('命中的动作是 delete', retract.reading?.speechAct.action === 'delete', String(retract.reading?.speechAct.action)),
      check('决策为 stop_previous', retract.reading?.responseMode === 'stop_previous', String(retract.reading?.responseMode)),
      check('撤回不授权执行', retract.reading?.mayExecute === false, String(retract.reading?.mayExecute))
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    await say(stack, 'C1-C4', conversation.id, '我明天上午处理这件事。')
    const correction = await say(stack, 'C1-C4', conversation.id, '我不是说要你现在做，我是说明天。')
    stack.close()
    results.push(outcome('C1-C4', 'C', '纠正理解而不是撤回动作', '“我不是说…”应撤销错误推断，不当作新请求', [
      check('读为 correction', correction.reading?.speechAct.act === 'correction', String(correction.reading?.speechAct.act)),
      check('状态为 changed', correction.reading?.intentStatus === 'changed', String(correction.reading?.intentStatus)),
      check('记录被纠正的消息', correction.reading?.supersedesMessageId !== null, String(correction.reading?.supersedesMessageId)),
      check('不授权执行', correction.reading?.mayExecute === false, String(correction.reading?.mayExecute))
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    stack.provider.reply = '我的建议是先加索引。'
    await say(stack, 'C1-C5', conversation.id, '这个查询很慢。')
    const quoting = await say(stack, 'C1-C5', conversation.id, '你刚才说“把表结构改掉”，但我已经改过了没用。')
    stack.close()
    results.push(outcome('C1-C5', 'C', '引用助手先前的话不归因为用户立场', '被引用的方案不得变成用户的请求或执行授权', [
      // The user is reporting a past suggestion and disagreeing with it, so the
      // act is the user's own statement — but the quoted action must not become
      // a request to perform it now.
      check('引用不产生用户请求', quoting.reading?.speechAct.act !== 'request', String(quoting.reading?.speechAct.act)),
      check('不授权执行', quoting.reading?.mayExecute === false, String(quoting.reading?.mayExecute)),
      check('payload 不要求执行被引用的动作', !quoting.system.includes('agreed to an action you offered'), 'guidance'),
      check('引用内容没有被当作待办', quoting.reading?.responseMode !== 'execute_pending', String(quoting.reading?.responseMode))
    ]))
  }

  // ---------------------------------------------------------------- D
  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    await say(stack, 'C1-D1', conversation.id, '我的函数 parseConfig 返回 undefined。')
    const compound = await say(stack, 'C1-D1', conversation.id, '帮我看看这个函数，然后解释一下为什么报错。')
    stack.close()
    results.push(outcome('C1-D1', 'D', '复合请求拆分且保留次级意图', '一轮两个要求，按用户顺序处理', [
      check('决策为 split', compound.reading?.responseMode === 'split', String(compound.reading?.responseMode)),
      check('主意图是请求', compound.reading?.primaryIntent === 'request', String(compound.reading?.primaryIntent)),
      check('保留次级意图', (compound.reading?.secondaryIntents.length ?? 0) > 0, JSON.stringify(compound.reading?.secondaryIntents ?? [])),
      check('payload 说明按顺序处理', compound.system.includes('Two sub-requests'), 'guidance')
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    await say(stack, 'C1-D2', conversation.id, '我想整理一下这个项目的文档。')
    const first = await say(stack, 'C1-D2', conversation.id, '先从 README 开始，这周内弄完。')
    stack.close()
    results.push(outcome('C1-D2', 'D', '多轮补充槽位', '对象与期限在不同轮补充，后者不得覆盖前者', [
      check('补充轮带出时间槽位', first.reading?.entitiesAndSlots.some((slot) => slot.name === 'time_horizon') === true, JSON.stringify(first.reading?.entitiesAndSlots ?? [])),
      check('不为本轮没说的对象编造槽位', first.reading?.entitiesAndSlots.every((slot) => slot.name !== 'target') === true, JSON.stringify(first.reading?.entitiesAndSlots ?? [])),
      check('状态为 continuing', first.reading?.intentStatus === 'continuing', String(first.reading?.intentStatus)),
      check('证据含承接上一轮', Boolean(first.reading?.context.evidence.includes('sequences_prior_turn')), (first.reading?.context.evidence ?? []).join(','))
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    await say(stack, 'C1-D3', conversation.id, '帮我按季度总结这份报告。')
    const changed = await say(stack, 'C1-D3', conversation.id, '算了，改成按周总结。')
    const activeAfterChange = stack.readings.active(conversation.id).length
    stack.close()
    results.push(outcome('C1-D3', 'D', '改变目标后旧意图失效', '改变目标必须 supersede 旧分析', [
      check('状态为 changed', changed.reading?.intentStatus === 'changed', String(changed.reading?.intentStatus)),
      check('记录被替换的消息', changed.reading?.supersedesMessageId !== null, String(changed.reading?.supersedesMessageId)),
      check('旧分析被撤回', activeAfterChange === 1, String(activeAfterChange))
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    await say(stack, 'C1-D4', conversation.id, '按季度总结这份报告。')
    const withdrawn = await say(stack, 'C1-D4', conversation.id, '算了，不用了。')
    const after = await say(stack, 'C1-D4', conversation.id, '今天几号？')
    const activeIds = stack.readings.active(conversation.id).map((row) => row.messageId)
    const openItems = Number((stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM cognitive_pending_items WHERE conversation_id = ? AND status = 'open'"
    ).get(conversation.id) as { n: number }).n)
    stack.close()
    results.push(outcome('C1-D4', 'D', '撤回后下一轮不携带旧待办', '撤回必须关闭旧意图与未决项', [
      check('撤回决策为 stop_previous', withdrawn.reading?.responseMode === 'stop_previous', String(withdrawn.reading?.responseMode)),
      check('旧分析已撤回', activeIds.every((id) => id === after.messageId || id === withdrawn.messageId), activeIds.join(',')),
      check('下一轮 payload 不再引用旧任务', !after.system.includes('按季度总结'), 'guidance clean'),
      check('未决项全部关闭', openItems === 0, String(openItems))
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    await say(stack, 'C1-D5', conversation.id, '我住在杭州。')
    const corrected = await say(stack, 'C1-D5', conversation.id, '不对，我住在苏州。')
    const activeCorrected = stack.readings.active(conversation.id).length
    stack.close()
    results.push(outcome('C1-D5', 'D', '纠正实体后只使用新值并保留来源', '纠正优先，旧分析标记失效', [
      check('状态为 changed', corrected.reading?.intentStatus === 'changed', String(corrected.reading?.intentStatus)),
      check('旧分析被 supersede', corrected.reading?.supersedesMessageId !== null, String(corrected.reading?.supersedesMessageId)),
      check('payload 要求以纠正为准', corrected.system.includes('newest statement'), 'guidance'),
      check('仅剩一条有效分析', activeCorrected === 1, String(activeCorrected))
    ]))
  }

  // ---------------------------------------------------------------- E
  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    const unknown = await say(stack, 'C1-E1', conversation.id, '你觉得我适合养什么宠物？')
    stack.close()
    results.push(outcome('C1-E1', 'E', '没有相关记忆时返回 unknown 而不是猜测', '未知是合法结果', [
      check('不编造用户偏好', !/你的(?:偏好|习惯)是/.test(unknown.system), 'guidance'),
      check('决策可回答', unknown.reading?.responseMode === 'answer', String(unknown.reading?.responseMode))
    ]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    const first = await say(stack, 'C1-E2', conversation.id, '这次例外，周末可以熬夜。')
    const memoryRows = Number((stack.database.connection.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n)
    stack.close()
    results.push(outcome('C1-E2', 'E', '“这次例外”不被写成长期偏好', '例外表达不得改变稳定偏好', [
      check('不产生长期偏好写入', memoryRows === 0, String(memoryRows)),
      check('分析存在且可回答', first.reading !== null, 'reading')
    ]))
  }

  // ---------------------------------------------------------------- F (mutations)
  {
    const withContext = await continuationContext('C1-F1', '要我继续把这个模块的代码写完吗？', '帮我把这个模块补完。', '可以，继续。')
    const withoutContext = await continuationContext('C1-F1', '好的，我记下了。', '帮我把这个模块补完。', '可以，继续。')
    const changed = withContext?.context.continuationTarget !== withoutContext?.context.continuationTarget ||
      withContext?.responseMode !== withoutContext?.responseMode
    results.push(outcome('C1-F1', 'F', '变异：移除上下文', '去掉助手提议后，同一句的决策必须改变', [
      check('原句承接 execution', withContext?.context.continuationTarget === 'execution', String(withContext?.context.continuationTarget)),
      check('移除上下文后承接消失', withoutContext?.context.continuationTarget === 'none', String(withoutContext?.context.continuationTarget)),
      check('决策确实改变', changed, `${withContext?.responseMode}/${withoutContext?.responseMode}`)
    ], [{ name: 'remove_assistant_offer', before: String(withContext?.context.continuationTarget), after: String(withoutContext?.context.continuationTarget), changed }]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    await say(stack, 'C1-F2', conversation.id, '我的函数 parseConfig 有问题。')
    const direct = await say(stack, 'C1-F2', conversation.id, '把这段代码删掉。')
    const negated = await say(stack, 'C1-F2', conversation.id, '不要把这段代码删掉。')
    stack.close()
    const changed = direct.reading?.speechAct.act !== negated.reading?.speechAct.act && direct.reading?.mayExecute !== negated.reading?.mayExecute
    results.push(outcome('C1-F2', 'F', '变异：加入否定词', '同一句加否定后必须从请求变成撤回', [
      check('原句是请求', direct.reading?.speechAct.act === 'request', String(direct.reading?.speechAct.act)),
      check('加否定后是撤回', negated.reading?.speechAct.act === 'retraction', String(negated.reading?.speechAct.act)),
      check('授权状态改变', changed, `${direct.reading?.mayExecute}/${negated.reading?.mayExecute}`)
    ], [{ name: 'add_negation', before: String(direct.reading?.speechAct.act), after: String(negated.reading?.speechAct.act), changed }]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    const quoted = await say(stack, 'C1-F3', conversation.id, '他说“把这段代码改掉”。')
    const direct = await say(stack, 'C1-F3', conversation.id, '把这段代码改掉。')
    stack.close()
    const changed = quoted.reading?.speechAct.attributedTo !== direct.reading?.speechAct.attributedTo
    results.push(outcome('C1-F3', 'F', '变异：打乱话语主体', '去掉引用框架后，同一句必须变成用户请求', [
      check('引用时不归因用户', quoted.reading?.speechAct.attributedTo === 'quoted_other', String(quoted.reading?.speechAct.attributedTo)),
      check('直说时归因用户', direct.reading?.speechAct.attributedTo === 'user', String(direct.reading?.speechAct.attributedTo)),
      check('归属确实改变', changed, `${quoted.reading?.speechAct.attributedTo}/${direct.reading?.speechAct.attributedTo}`)
    ], [{ name: 'remove_quotation_frame', before: String(quoted.reading?.speechAct.attributedTo), after: String(direct.reading?.speechAct.attributedTo), changed }]))
  }

  {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    const turn = await say(stack, 'C1-F4', conversation.id, '帮我把这段代码改一下。')
    // Inject a tampered reading: a quotation that claims to authorise execution.
    let rejected = false
    try {
      const tampered = {
        ...turn.reading!,
        messageId: randomUUID(),
        mayExecute: true,
        speechAct: { ...turn.reading!.speechAct, act: 'quotation' as const, attributedTo: 'quoted_other' as const }
      }
      const messageId = randomUUID()
      stack.database.connection.prepare(
        'INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(messageId, conversation.id, 'user', 'x', '2026-10-31T00:00:00.000Z', 99, randomUUID())
      stack.readings.save({ conversationId: conversation.id, messageId, reading: { ...tampered, messageId } })
    } catch {
      rejected = true
    }
    stack.close()
    results.push(outcome('C1-F4', 'F', '变异：错误候选注入', '下游不得盲信被篡改的分析：引用不得授权执行', [
      check('篡改的分析被拒绝', rejected, String(rejected))
    ], [{ name: 'inject_quotation_with_binds', before: 'valid reading', after: 'tampered reading', changed: rejected }]))
  }

  return { results, traces: turns }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const commit = head()
  const { results, traces } = await run()
  const finishedAt = new Date().toISOString()
  const counts = {
    PASS: results.filter((item) => item.status === 'PASS').length,
    FAIL: results.filter((item) => item.status === 'FAIL').length,
    BLOCKED: results.filter((item) => item.status === 'BLOCKED').length,
    NOT_RUN: results.filter((item) => item.status === 'NOT_RUN').length
  }
  const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const short = commit.slice(0, 7)
  const root = resolve(process.cwd(), 'evals', 'stage-3', 'intent-understanding')
  mkdirSync(join(root, 'results'), { recursive: true })
  mkdirSync(join(root, 'traces'), { recursive: true })

  const payload = {
    // Which suite produced this file. The two C1 suites are labelled so that a
    // mechanism result (scripted provider) can never be filed, quoted or
    // aggregated as semantic evidence; the semantic suite says `semantic` and
    // is the only one that runs a model.
    suite: 'mechanism' as const,
    datasetVersion: DATASET_VERSION,
    harnessVersion: HARNESS_VERSION,
    paramsVersion: PARAMS_VERSION,
    codeCommit: commit,
    environment: { platform: process.platform, node: process.version },
    clock: 'real',
    provider: 'scripted (not a model)',
    startedAt,
    finishedAt,
    denominator: results.length,
    counts,
    scenarios: results,
    manualReview: {
      status: 'PENDING',
      reason: 'Real-model language understanding needs a human reviewer reading the replies. The same rule set that produced the output cannot grade it.'
    },
    notMeasured: [
      'real-provider intent accuracy',
      'calibrated probability (no calibration set exists; every score is a heuristic)',
      'Chinese/English open-domain intent coverage beyond the listed scenarios'
    ]
  }
  const resultsFile = join(root, 'results', `${stamp}-${short}.json`)
  writeFileSync(resultsFile, `${JSON.stringify(payload, null, 2)}\n`)
  const tracesFile = join(root, 'traces', `${stamp}-${short}.jsonl`)
  writeFileSync(tracesFile, `${traces.map((trace) => JSON.stringify(trace)).join('\n')}\n`)
  process.stdout.write(`${JSON.stringify({ resultsFile, tracesFile, counts, denominator: results.length }, null, 2)}\n`)
  if (counts.FAIL > 0) process.exitCode = 1
}

void main()
