/**
 * Persistent turn state machine (Stage 2, algorithm B4).
 *
 * The turn lifecycle used to be recorded only as a terminal verdict
 * (`succeeded` / `failed` / `cancelled`). That is enough to say how a turn ended
 * and not enough to say where it stopped, so an interrupted turn could not be
 * told apart from one that never started.
 *
 * Two design choices matter:
 *
 *   1. **The transition table is the contract.** A state can only be entered
 *      from an allowed predecessor. An illegal move throws instead of silently
 *      overwriting history.
 *   2. **Re-entering the same state is a no-op, not an error.** Recovery and
 *      retries replay transitions; idempotence is what makes that safe.
 */
export const TURN_STATES = [
  'received',
  'analyzed',
  'context_ready',
  'awaiting_consent',
  'requesting',
  'response_received',
  'committed',
  'failed',
  'cancelled',
  'recovery_required',
  // A recovery attempt in progress. Separate from `recovery_required` so the
  // trace can tell "this turn is known-broken" from "something is repairing it".
  'recovering'
] as const

export type TurnState = typeof TURN_STATES[number]

/** Allowed predecessors for each state. `null` means "initial state". */
const PREDECESSORS: Readonly<Record<TurnState, readonly (TurnState | null)[]>> = {
  received: [null],
  analyzed: ['received'],
  context_ready: ['analyzed', 'received'],
  awaiting_consent: ['context_ready'],
  requesting: ['awaiting_consent', 'context_ready'],
  response_received: ['requesting'],
  committed: ['response_received', 'recovering'],
  failed: ['received', 'analyzed', 'context_ready', 'awaiting_consent', 'requesting', 'response_received', 'recovering'],
  cancelled: ['awaiting_consent', 'requesting', 'context_ready', 'recovering'],
  // A turn can be interrupted at any non-terminal step, not only while a request
  // is in flight: the state at the moment of the crash is the evidence.
  recovery_required: ['received', 'analyzed', 'context_ready', 'awaiting_consent', 'requesting', 'response_received'],
  recovering: ['recovery_required'],
}

export const TERMINAL_TURN_STATES: readonly TurnState[] = ['committed', 'failed', 'cancelled']

export function isTurnState(value: unknown): value is TurnState {
  return typeof value === 'string' && (TURN_STATES as readonly string[]).includes(value)
}

export function isTerminalTurnState(state: TurnState): boolean {
  return TERMINAL_TURN_STATES.includes(state)
}

/**
 * A move is allowed when `to` lists `from` as a predecessor, or when it is the
 * same state (idempotent replay). Everything else is a programming error.
 */
export function canTransition(from: TurnState | null, to: TurnState): boolean {
  if (!isTurnState(to)) return false
  if (from !== null && !isTurnState(from)) return false
  if (from === to) return true
  return PREDECESSORS[to].includes(from)
}

export interface TurnStateRecord {
  turnId: string
  conversationId: string
  state: TurnState
  updatedAt: string
  /** Sanitized reason code; never message text. */
  reason: string | null
}

export interface TurnStatePort {
  /** Non-terminal turns; optional so older callers/tests keep working. */
  listUnsettled?(limit?: number): TurnStateRecord[]
  enter(record: TurnStateRecord): void
  get(turnId: string): TurnStateRecord | null
}

export class IllegalTurnTransition extends Error {
  constructor(readonly from: TurnState | null, readonly to: TurnState) {
    super(`Illegal turn transition: ${from ?? 'start'} -> ${to}`)
    this.name = 'IllegalTurnTransition'
  }
}
