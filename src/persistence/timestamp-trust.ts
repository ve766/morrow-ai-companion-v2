/**
 * Timestamp trust for migrations.
 *
 * A migration sometimes has to decide whether a row was written by a build that
 * actually recorded the value, or whether it was written by an older build and
 * later backfilled. The only defensible evidence is a *valid, ordered* time:
 *
 * - the text must be a real ISO-8601 instant (no "2026-13-45", no empty string);
 * - it must be strictly later than the boundary (equality proves nothing,
 *   because a row could have been written before the boundary in the same
 *   millisecond);
 * - it must be strictly earlier than the moment the migration runs (a timestamp
 *   in the future means a wrong clock or tampering, not evidence).
 *
 * Anything else is unproven and must be treated conservatively by the caller.
 * Nothing here reads the current clock: the decision is a pure function of the
 * three strings, and the migration passes its own persisted `applied_at` as the
 * upper bound, so the result is auditable after the fact.
 */

const STRICT_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}

/**
 * Parses an ISO-8601 UTC instant and rejects values whose calendar fields are
 * out of range instead of letting `Date` normalise them. Returns epoch
 * milliseconds, or `null` when the value is not a real instant.
 */
export function parseStrictIsoTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = STRICT_ISO.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const millisecond = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'))
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  const check = new Date(epoch)
  // Guards the Date.UTC two-digit-year remapping and any residual normalisation.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null
  }
  return epoch
}

/**
 * True only when `createdAt` is a real instant strictly between the boundary
 * (the migration that introduced the field) and the migration that is running.
 */
export function isProvablyRecordedAfter(
  createdAt: unknown,
  boundaryAppliedAt: unknown,
  migrationAppliedAt: unknown
): boolean {
  const created = parseStrictIsoTimestamp(createdAt)
  const boundary = parseStrictIsoTimestamp(boundaryAppliedAt)
  const migration = parseStrictIsoTimestamp(migrationAppliedAt)
  if (created === null || boundary === null || migration === null) return false
  // Equality is not proof of ordering.
  if (created <= boundary) return false
  // At or after the migration's own instant: unproven, not "probably fine".
  if (created >= migration) return false
  return true
}
