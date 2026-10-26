import { HISTORY_POLICY, retainedHistoryTail } from '../app/companion-service'

/**
 * Structural assertions over the provider request that was actually assembled.
 *
 * These exist because the first version of the real-provider verification
 * asserted on `requestBytes` and on substring presence in the whole serialized
 * payload. Both are unsound:
 *
 *   - Two requests can differ in length for reasons that have nothing to do with
 *     conversation isolation (a different user message, a timestamp, the model
 *     echoing something). Length inequality proves nothing about what was left
 *     out.
 *   - A substring match says a string appears *somewhere* in the payload. It
 *     cannot distinguish a match inside the system prompt from a match inside a
 *     foreign conversation turn, and it cannot notice a message that should be
 *     present but is not.
 *
 * Everything here therefore parses the payload into messages and compares
 * roles and contents position by position. Each function returns the exact
 * failures it found so a broken assumption surfaces as a named mismatch rather
 * than a false pass.
 */

export interface ProviderMessage {
  role: string
  content: string
}

export interface ParsedProviderRequest {
  endpoint: string
  model: string
  messages: ProviderMessage[]
  bytes: number
}

export interface CheckOutcome {
  passed: boolean
  failures: string[]
  detail: string
}

export class RequestShapeError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'RequestShapeError'
  }
}

/** Parses the exact payload that was handed to the provider, or throws. */
export function parseProviderRequest(raw: string): ParsedProviderRequest {
  if (typeof raw !== 'string' || raw.length === 0) throw new RequestShapeError('EMPTY_PAYLOAD')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new RequestShapeError('PAYLOAD_NOT_JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestShapeError('PAYLOAD_NOT_OBJECT')
  const record = parsed as Record<string, unknown>
  if (typeof record.endpoint !== 'string') throw new RequestShapeError('MISSING_ENDPOINT')
  const body = record.body
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new RequestShapeError('MISSING_BODY')
  const bodyRecord = body as Record<string, unknown>
  if (typeof bodyRecord.model !== 'string') throw new RequestShapeError('MISSING_MODEL')
  if (!Array.isArray(bodyRecord.messages)) throw new RequestShapeError('MISSING_MESSAGES')
  const messages = bodyRecord.messages.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new RequestShapeError(`MESSAGE_${index}_NOT_OBJECT`)
    const message = entry as Record<string, unknown>
    if (typeof message.role !== 'string' || typeof message.content !== 'string') throw new RequestShapeError(`MESSAGE_${index}_SHAPE`)
    return { role: message.role, content: message.content }
  })
  return {
    endpoint: record.endpoint,
    model: bodyRecord.model,
    messages,
    bytes: Buffer.byteLength(raw, 'utf8')
  }
}

/**
 * Applies the documented history bound to a full message list and reports what
 * the production code is allowed to keep and what it is allowed to drop.
 *
 * This delegates to the function `ChatService.prepare` itself calls. Sharing
 * only `HISTORY_POLICY` would leave the loop free to drift, so the algorithm is
 * shared too and the verifier cannot assert against a window production never
 * produces. `history-bound.test.ts` additionally compares the two against each
 * other on a generated table, so a future edit to one side is caught.
 */
export function selectRetainedHistory(
  history: ProviderMessage[],
  policy: { maxMessages: number; maxCharacters: number } = HISTORY_POLICY
): { retained: ProviderMessage[]; dropped: ProviderMessage[] } {
  const retained = retainedHistoryTail(history, (message) => message.content.length, policy)
  return { retained, dropped: history.slice(0, history.length - retained.length) }
}

function excerpt(value: string, limit = 60): string {
  const flattened = value.replace(/\s+/gu, ' ')
  return flattened.length <= limit ? flattened : `${flattened.slice(0, limit)}…`
}

function describe(message: ProviderMessage): string {
  return `${message.role}:"${excerpt(message.content)}"`
}

/**
 * P0-2: every message the bound says must survive is present, in order, with
 * the right role and content, and nothing else is.
 */
export interface HistoryExpectation {
  /** Ordered messages the documented bound retains, excluding system and the current turn. */
  retained: ProviderMessage[]
  /** Messages the documented bound permits dropping. */
  dropped: ProviderMessage[]
  currentUserMessage: string
}

export function checkHistoryCompleteness(request: ParsedProviderRequest, expectation: HistoryExpectation): CheckOutcome {
  const failures: string[] = []
  const { messages } = request

  if (messages.length === 0) {
    return { passed: false, failures: ['request carries no messages'], detail: 'messages=0' }
  }
  if (messages[0]!.role !== 'system') failures.push(`first message role is ${messages[0]!.role}, expected system`)

  const tail = messages.at(-1)
  if (!tail) failures.push('request carries no final message')
  else if (tail.role !== 'user') failures.push(`final message role is ${tail.role}, expected user`)
  else if (tail.content !== expectation.currentUserMessage) {
    failures.push(`final user message is "${excerpt(tail.content)}", expected "${excerpt(expectation.currentUserMessage)}"`)
  }

  const expectedTotal = expectation.retained.length + 2
  if (messages.length !== expectedTotal) {
    failures.push(`message count is ${messages.length}, expected ${expectedTotal} (1 system + ${expectation.retained.length} retained history + 1 current)`)
  }

  const history = messages.slice(1, -1)
  const compared = Math.max(history.length, expectation.retained.length)
  for (let index = 0; index < compared; index += 1) {
    const actual = history[index]
    const expected = expectation.retained[index]
    if (!expected) {
      failures.push(`unexpected extra history message at index ${index}: ${describe(actual!)}`)
      continue
    }
    if (!actual) {
      failures.push(`missing history message at index ${index}: expected ${describe(expected)}`)
      continue
    }
    if (actual.role !== expected.role || actual.content !== expected.content) {
      failures.push(`history message ${index} is ${describe(actual)}, expected ${describe(expected)}`)
    }
  }

  for (const dropped of expectation.dropped) {
    const stillPresent = messages.some((message) => message.content === dropped.content)
    if (stillPresent) failures.push(`message that the bound should have dropped is still present: ${describe(dropped)}`)
  }

  return {
    passed: failures.length === 0,
    failures,
    detail: `messages=${messages.length} retainedExpected=${expectation.retained.length} droppedAllowed=${expectation.dropped.length}`
  }
}

/**
 * P0-1: a brand new conversation carries the saved memory and nothing from the
 * earlier conversation. Matched per message, so a foreign string cannot hide
 * inside the system prompt unnoticed and a missing memory cannot pass because
 * the payload happened to be a different size.
 */
export interface IsolationExpectation {
  /** Every user message that belongs to the other conversation. */
  foreignUserMessages: string[]
  /** Every assistant reply produced in the other conversation. */
  foreignAssistantMessages: string[]
  /** Substrings that only exist inside the other conversation's turns. */
  foreignSentinels: string[]
  currentUserMessage: string
  /** Substring that must reach the model from saved memory. */
  requiredMemoryFragment: string
}

export function checkCrossSessionIsolation(request: ParsedProviderRequest, expectation: IsolationExpectation): CheckOutcome {
  const failures: string[] = []
  const conversationMessages = request.messages.filter((message) => message.role !== 'system')
  const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n')

  for (const [index, message] of conversationMessages.entries()) {
    for (const foreign of expectation.foreignUserMessages) {
      if (message.content.includes(foreign)) {
        failures.push(`foreign user message leaked into ${message.role} turn ${index}: "${excerpt(foreign)}"`)
      }
    }
    for (const foreign of expectation.foreignAssistantMessages) {
      if (message.content.includes(foreign)) {
        failures.push(`foreign assistant reply leaked into ${message.role} turn ${index}: "${excerpt(foreign)}"`)
      }
    }
    for (const sentinel of expectation.foreignSentinels) {
      if (message.content.includes(sentinel)) {
        failures.push(`foreign sentinel ${sentinel} leaked into ${message.role} turn ${index}`)
      }
    }
  }

  // The system prompt is allowed to carry memory, but not the other
  // conversation's turns: those would mean history crossed conversations
  // through the context block instead of the message list.
  for (const sentinel of expectation.foreignSentinels) {
    if (system.includes(sentinel)) failures.push(`foreign sentinel ${sentinel} leaked into the system prompt`)
  }

  if (conversationMessages.length !== 1) {
    failures.push(`new conversation carries ${conversationMessages.length} non-system messages, expected exactly 1`)
  }
  const tail = request.messages.at(-1)
  if (!tail || tail.role !== 'user' || tail.content !== expectation.currentUserMessage) {
    failures.push(`final message is not the current user turn: ${tail ? describe(tail) : 'none'}`)
  }
  if (!system.includes(expectation.requiredMemoryFragment)) {
    failures.push(`saved memory fragment "${excerpt(expectation.requiredMemoryFragment)}" is absent from the system prompt`)
  }

  return {
    passed: failures.length === 0,
    failures,
    detail: `nonSystemMessages=${conversationMessages.length} foreignUser=${expectation.foreignUserMessages.length} foreignAssistant=${expectation.foreignAssistantMessages.length} memoryPresent=${system.includes(expectation.requiredMemoryFragment)}`
  }
}

/**
 * P0-3: what the store actually contains after a failed dispatch.
 *
 * The production rule, read from `ChatService.send`, is: the user turn is
 * appended before the provider is called and therefore survives any provider
 * failure, while the assistant turn is appended only after a complete response
 * arrives. There is no partial-persistence path — a cancelled stream leaves
 * nothing behind, because `appendMessage` for the assistant is only reached
 * after `dispatchToProvider` resolves and the abort signal is re-checked.
 *
 * This function takes the messages re-read from SQLite. It never consults the
 * object the catch block built, which is what made the previous check
 * self-certifying.
 */
export interface FailureExpectation {
  turnId: string
  userMessage: string
  /** True when the production transaction design stores the user turn. */
  expectUserStored: boolean
}

export function checkFailurePersistence(
  stored: Array<{ role: string; body: string; turnId: string }>,
  expectation: FailureExpectation
): CheckOutcome {
  const failures: string[] = []
  const forTurn = stored.filter((message) => message.turnId === expectation.turnId)
  const assistants = forTurn.filter((message) => message.role === 'assistant')
  const users = forTurn.filter((message) => message.role === 'user')

  if (assistants.length !== 0) {
    failures.push(`stored ${assistants.length} assistant message(s) for a failed turn: "${excerpt(assistants[0]!.body)}"`)
  }
  const expectedUsers = expectation.expectUserStored ? 1 : 0
  if (users.length !== expectedUsers) {
    failures.push(`stored ${users.length} user message(s) for the failed turn, expected ${expectedUsers}`)
  }
  for (const user of users) {
    if (user.body !== expectation.userMessage) {
      failures.push(`stored user message is "${excerpt(user.body)}", expected "${excerpt(expectation.userMessage)}"`)
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    detail: `turn=${expectation.turnId.slice(0, 8)} userStored=${users.length} assistantStored=${assistants.length}`
  }
}
