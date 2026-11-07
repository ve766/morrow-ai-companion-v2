/**
 * Explicit desktop-window lifecycle. The app used to rely on implicit
 * `isMinimized`/`isVisible` checks, which made startup, taskbar restore and
 * second-instance focus race each other. This machine is intentionally small:
 * it only says which transitions are legal and rejects everything else.
 */
export const WINDOW_STATES = ['CREATED', 'READY', 'VISIBLE', 'MINIMIZED', 'HIDDEN', 'CLOSING', 'CLOSED'] as const
export type WindowLifecycleState = typeof WINDOW_STATES[number]
export type WindowLifecycleEvent = 'ready' | 'show' | 'minimize' | 'restore' | 'hide' | 'close' | 'closed'

const TRANSITIONS: Readonly<Record<WindowLifecycleState, Partial<Record<WindowLifecycleEvent, WindowLifecycleState>>>> = {
  CREATED: { ready: 'READY', close: 'CLOSING' },
  READY: { show: 'VISIBLE', hide: 'HIDDEN', close: 'CLOSING' },
  VISIBLE: { minimize: 'MINIMIZED', hide: 'HIDDEN', close: 'CLOSING' },
  MINIMIZED: { restore: 'VISIBLE', show: 'VISIBLE', close: 'CLOSING' },
  HIDDEN: { show: 'VISIBLE', close: 'CLOSING' },
  CLOSING: { closed: 'CLOSED' },
  CLOSED: {}
}

export class IllegalWindowTransition extends Error {
  constructor(readonly from: WindowLifecycleState, readonly event: WindowLifecycleEvent) {
    super(`Illegal window transition: ${from} --${event}-->`)
    this.name = 'IllegalWindowTransition'
  }
}

export class WindowLifecycle {
  private current: WindowLifecycleState = 'CREATED'

  get state(): WindowLifecycleState { return this.current }

  apply(event: WindowLifecycleEvent): WindowLifecycleState {
    const next = TRANSITIONS[this.current][event]
    if (!next) throw new IllegalWindowTransition(this.current, event)
    this.current = next
    return next
  }

  can(event: WindowLifecycleEvent): boolean {
    return Boolean(TRANSITIONS[this.current][event])
  }
}
