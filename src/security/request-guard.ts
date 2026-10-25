export interface RequestGuard {
  begin(): number
  isCurrent(token: number): boolean
  current(): number
  invalidate(): void
}

// Serialises async UI refreshes: only the newest begun request is current, so
// a late response can neither overwrite newer state nor clear a newer
// request's loading indicator. invalidate() marks every outstanding request
// stale (used when the underlying data is known to have changed elsewhere).
export function createRequestGuard(): RequestGuard {
  let counter = 0
  return {
    begin(): number {
      counter += 1
      return counter
    },
    isCurrent(token: number): boolean {
      return counter === token
    },
    current(): number {
      return counter
    },
    invalidate(): void {
      counter += 1
    }
  }
}
