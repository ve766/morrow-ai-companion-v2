/**
 * Time expressions in a stated goal (P1-6).
 *
 * Two failures this replaces:
 *
 *   1. the horizon was *detected* but never *resolved* — `detectFromTurn` saw
 *      "明年三月之前" and then created the goal with `dueAt: null`, so the date
 *      the user actually said was thrown away;
 *   2. the title was a regex slice of the whole clause, so the time phrase was
 *      pasted into the goal name ("明年三月之前完成 Morrow 的第一阶段" became the
 *      title *and* the deadline).
 *
 * Resolution is explicit and bounded. A phrase that cannot be resolved keeps its
 * original wording and is reported as unresolved, so the caller can ask instead
 * of inventing a date. Dates are interpreted in a fixed offset (UTC+8 by
 * default) and stored as UTC instants, which keeps comparisons lexicographic.
 */

export interface DueResolution {
  /** Resolved instant, or null when nothing was found or it was ambiguous. */
  dueAt: string | null
  /** The phrase as the user wrote it, kept for the clarification question. */
  expression: string | null
  /** A time phrase was present but could not be turned into a date. */
  unresolved: boolean
}

export const DEFAULT_DUE_OFFSET_MINUTES = 480

interface LocalDate {
  year: number
  month: number
  day: number
}

function localDateOf(nowMs: number, offsetMinutes: number): LocalDate {
  const shifted = new Date(nowMs + offsetMinutes * 60_000)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

function endOfDayUtc(date: LocalDate, offsetMinutes: number): string {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 23, 59, 59) - offsetMinutes * 60_000).toISOString()
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function clampDay(year: number, month: number, day: number): LocalDate {
  return { year, month, day: Math.min(day, lastDayOfMonth(year, month)) }
}

const CN_MONTH: Readonly<Record<string, number>> = Object.freeze({
  十一: 11, 十二: 12, 十: 10,
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
})

/** "3" or "三" or "十一" → month number, or null when out of range. */
function parseMonth(token: string | undefined): number | null {
  if (!token) return null
  const numeric = Number(token)
  const month = Number.isFinite(numeric) ? numeric : CN_MONTH[token] ?? null
  return month !== null && month >= 1 && month <= 12 ? month : null
}

/** Month token alternation, longest first so 十一 is not read as 十. */
const MONTH_TOKEN = '(十二|十一|十|1[0-2]|[1-9]|[一二三四五六七八九])'

const PATTERNS: Array<{ re: RegExp; resolve: (match: RegExpExecArray, now: LocalDate, offset: number) => string | null }> = [
  // 2027年3月15日 / 2027-03-15 / 2027/3/15
  {
    re: /(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*[日号]?/u,
    resolve: (m, _now, offset) => endOfDayUtc(clampDay(Number(m[1]), Number(m[2]), Number(m[3])), offset)
  },
  // 2027年3月
  {
    re: /(\d{4})\s*年\s*(\d{1,2})\s*月/u,
    resolve: (m, _now, offset) => {
      const year = Number(m[1])
      const month = Number(m[2])
      return endOfDayUtc({ year, month, day: lastDayOfMonth(year, month) }, offset)
    }
  },
  // 明年三月 / 明年3月 / 明年
  {
    re: new RegExp(`明年\\s*${MONTH_TOKEN}?\\s*月?`, 'u'),
    resolve: (m, now, offset) => {
      const month = parseMonth(m[1]) ?? 12
      return endOfDayUtc({ year: now.year + 1, month, day: lastDayOfMonth(now.year + 1, month) }, offset)
    }
  },
  // 今年三月 / 今年
  {
    re: new RegExp(`今年\\s*${MONTH_TOKEN}?\\s*月?`, 'u'),
    resolve: (m, now, offset) => {
      const month = parseMonth(m[1]) ?? 12
      return endOfDayUtc({ year: now.year, month, day: lastDayOfMonth(now.year, month) }, offset)
    }
  },
  // 下个月 / 下月
  {
    re: /下(?:个)?月/u,
    resolve: (_m, now, offset) => {
      const month = now.month === 12 ? 1 : now.month + 1
      const year = now.month === 12 ? now.year + 1 : now.year
      return endOfDayUtc({ year, month, day: lastDayOfMonth(year, month) }, offset)
    }
  },
  // 这个月 / 本月 / 月底 / 月末
  {
    re: /(?:这(?:个)?月|本月|月底|月末)/u,
    resolve: (_m, now, offset) => endOfDayUtc({ year: now.year, month: now.month, day: lastDayOfMonth(now.year, now.month) }, offset)
  },
  // 下周 / 下个星期
  {
    re: /下(?:个)?(?:周|星期)/u,
    resolve: (_m, now, offset) => {
      const current = new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay()
      const daysToNextSunday = ((7 - current) % 7) + 7
      const target = new Date(Date.UTC(now.year, now.month - 1, now.day + daysToNextSunday))
      return endOfDayUtc({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, offset)
    }
  },
  // 这周 / 本周
  {
    re: /(?:这(?:个)?|本)(?:周|星期)/u,
    resolve: (_m, now, offset) => {
      const current = new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay()
      const daysToSunday = (7 - current) % 7
      const target = new Date(Date.UTC(now.year, now.month - 1, now.day + daysToSunday))
      return endOfDayUtc({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, offset)
    }
  },
  // 3天后 / 三天内
  {
    re: /(\d{1,3})\s*天(?:后|以后|之内|内)/u,
    resolve: (m, now, offset) => {
      const target = new Date(Date.UTC(now.year, now.month - 1, now.day + Number(m[1])))
      return endOfDayUtc({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, offset)
    }
  },
  // 2周后
  {
    re: /(\d{1,2})\s*(?:周|星期)(?:后|以后|之内|内)/u,
    resolve: (m, now, offset) => {
      const target = new Date(Date.UTC(now.year, now.month - 1, now.day + Number(m[1]) * 7))
      return endOfDayUtc({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, offset)
    }
  },
  // 3月15日 — this year, or next year when the date has already passed
  {
    re: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/u,
    resolve: (m, now, offset) => {
      const month = Number(m[1])
      const day = Number(m[2])
      const thisYear = endOfDayUtc(clampDay(now.year, month, day), offset)
      if (Date.parse(thisYear) >= Date.UTC(now.year, now.month - 1, now.day)) return thisYear
      return endOfDayUtc(clampDay(now.year + 1, month, day), offset)
    }
  }
]

/** A horizon that exists as a phrase but names no resolvable date. */
const VAGUE_HORIZON = /(?:以后|将来|有空|找时间|某天|过(?:一)?段(?:时间|日子)|改天|有机会)/u
/** A horizon phrase that the resolver is expected to handle. */
const HORIZON_HINT = /(?:明年|今年|下(?:个)?月|这(?:个)?月|本月|月底|月末|下(?:个)?(?:周|星期)|(?:这(?:个)?|本)(?:周|星期)|\d{1,3}\s*天|\d{1,2}\s*(?:周|星期)|\d{1,2}\s*月|\d{4}\s*[年/.-])/u

/**
 * Resolves the first horizon in the text.
 *
 * Returns `unresolved: true` when a horizon phrase is present but no pattern
 * matched — that is a question to ask, not a date to invent.
 */
export function resolveDueAt(text: string, nowIso: string, offsetMinutes = DEFAULT_DUE_OFFSET_MINUTES): DueResolution {
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(nowMs)) throw new TypeError('Goal time resolution needs a valid clock.')
  const now = localDateOf(nowMs, offsetMinutes)
  const normalized = text.normalize('NFKC')

  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(normalized)
    if (!match) continue
    const dueAt = pattern.resolve(match, now, offsetMinutes)
    if (dueAt) return { dueAt, expression: match[0], unresolved: false }
  }
  if (VAGUE_HORIZON.test(normalized) || HORIZON_HINT.test(normalized)) {
    const vague = VAGUE_HORIZON.exec(normalized)
    return { dueAt: null, expression: vague?.[0] ?? null, unresolved: true }
  }
  return { dueAt: null, expression: null, unresolved: false }
}

/** True when the text names a checkable horizon, resolved or not. */
export function hasHorizon(text: string): boolean {
  return HORIZON_HINT.test(text.normalize('NFKC')) || VAGUE_HORIZON.test(text.normalize('NFKC'))
}

/**
 * Removes the horizon phrase from a clause so the title is the commitment, not
 * the deadline.
 */
export function stripHorizon(text: string): string {
  let result = text.normalize('NFKC')
  for (const pattern of PATTERNS) {
    result = result.replace(new RegExp(pattern.re.source, 'gu'), ' ')
  }
  result = result.replace(/(?:之前|以前|前|底前|之内|以内|截止)/gu, ' ')
  return result.replaceAll(/\s+/gu, ' ').trim()
}
