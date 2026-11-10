/**
 * Cognition consistency lock (Issue #83 P0-A).
 *
 * Deletion replay and self-state revalidation happen before the chat service
 * is exposed. If either cannot complete, the app must not build a Provider
 * payload from stale projections. The app can still open, show the reason and
 * offer a retry; only cognition-backed chat is locked.
 */
import { ApplicationError } from '../shared/errors'

export type CognitionConsistencyState = 'ready' | 'locked'

export interface CognitionConsistencySnapshot {
  state: CognitionConsistencyState
  reasons: string[]
  checkedAt: string
  details: Record<string, number>
}

export class CognitionConsistencyGate {
  private current: CognitionConsistencySnapshot

  constructor(private readonly clock: () => string = () => new Date().toISOString()) {
    this.current = { state: 'ready', reasons: [], checkedAt: this.clock(), details: {} }
  }

  snapshot(): CognitionConsistencySnapshot {
    return { ...this.current, reasons: [...this.current.reasons], details: { ...this.current.details } }
  }

  lock(reasons: string[], details: Record<string, number> = {}): void {
    this.current = {
      state: 'locked',
      reasons: [...new Set(reasons)].sort(),
      checkedAt: this.clock(),
      details: { ...details }
    }
  }

  ready(details: Record<string, number> = {}): void {
    this.current = { state: 'ready', reasons: [], checkedAt: this.clock(), details: { ...details } }
  }

  get locked(): boolean {
    return this.current.state === 'locked'
  }

  /** Called before any memory/reflection/mood/personality Provider payload. */
  assertReady(): void {
    if (this.current.state === 'locked') throw new ApplicationError('COGNITION_LOCKED')
  }
}
