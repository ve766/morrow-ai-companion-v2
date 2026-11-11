import { normalizedMemoryKey, type MemoryRecord } from '../memory-domain'

// Cross-record correction chain.
//
// `MemoryService.correct()` rewrites a record's text in place, so the replaced
// statement only survives in `memory_revisions`. That means a *different*
// memory created later with the replaced text looks like brand new evidence,
// even though the user explicitly said it was wrong. The self-model module
// already models this explicitly (`superseded` status + `superseded_by`); the
// memory module does not, and no schema change is needed to fix it: the
// revision history already holds the replaced text.
//
// The rule is deliberately a hard exclusion, not a score penalty. A correction
// is a user decision; letting a re-statement win by repetition or freshness is
// exactly what the phase contract forbids. If the user genuinely changes their
// mind back, the supported path is correcting the original memory again — at
// which point that record carries the current truth and nothing is lost.

export interface SupersededStatement {
  /** Id of the still-active memory whose earlier revision was replaced. */
  memoryId: string
  /** Revision number that holds the replaced text. */
  revision: number
  /** The replaced text. Never written to the event journal. */
  text: string
  /** When the replacement happened. */
  supersededAt: string
  /** Last confirmation of the superseding (current) text, if any. */
  supersedingConfirmedAt: string | null
}

export type SupersessionVerdict = 'none' | 'resurrected'

/**
 * Finds the active memories that explicitly replaced this exact statement.
 *
 * Matching is exact after normalization (`NFKC`, case- and whitespace-folding).
 * Keyword overlap is deliberately *not* used: sharing words is not the same as
 * asserting the same fact, and treating it as conflict would delete evidence
 * the user never retracted.
 */
export function findSupersedingStatements(
  candidate: Pick<MemoryRecord, 'id' | 'currentText'>,
  statements: readonly SupersededStatement[]
): SupersededStatement[] {
  if (statements.length === 0) return []
  const key = normalizedMemoryKey(candidate.currentText)
  return statements.filter((statement) =>
    statement.memoryId !== candidate.id && normalizedMemoryKey(statement.text) === key
  )
}

/**
 * `resurrected` means the candidate restates a statement a different active
 * memory already replaced, so it must not be retrieved as current fact.
 */
export function classifySupersession(
  candidate: Pick<MemoryRecord, 'id' | 'currentText'>,
  statements: readonly SupersededStatement[]
): SupersessionVerdict {
  return findSupersedingStatements(candidate, statements).length > 0 ? 'resurrected' : 'none'
}
