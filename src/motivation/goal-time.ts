/**
 * Time expressions in a stated goal (P1-6, P0-2 of the final round).
 *
 * The first version resolved "我打算在明年三月之前完成第一阶段" to the end of
 * March. That is a different commitment from the one the user made: "before
 * March" ends when March begins. Treating the two as one rule silently moved a
 * deadline by a month, and the goal then appeared in prompts with the wrong date.
 *
 * So resolution is two steps, not one:
 *
 *   1. find the *period* the wording names (a day, a month, a week);
 *   2. apply the *boundary* the wording asks for:
 *
 *      | wording             | boundary | resolves to                   |
 *      |---------------------|----------|------------------------------|
 *      | 三月之前 / 以前 / 前 | before   | last second before the period |
 *      | 三月底前 / 之内 / 内 | end      | last second of the period     |
 *      | 三月开始时 / 之初     | start    | first second of the period    |
 *      | 三月以后 / 之后       | after    | first second of the period    |
 *      | 三月（无边界词）      | end      | last second of the period     |
 *
 * Anything that names a horizon we cannot resolve keeps its original wording and
 * is reported as unresolved, so the caller asks instead of inventing a date.
 *
 * Dates are interpreted in a fixed offset (UTC+8 by default) and stored as UTC
 * instants, which keeps comparisons lexicographic.
 */

export interface DueResolution {
  /** Resolved instant, or null when nothing was found or it was ambiguous. */
  dueAt: string | null
  /** The phrase as the user wrote it, kept for the clarification question. */
  expression: string | null
  /** A time phrase was present but could not be turned into a date. */
  unresolved: boolean
  /** Which boundary rule was applied; null when nothing resolved. */
  boundary: DueBoundary | null
}

export type DueBoundary = 'before' | 'end' | 'start' | 'after'

export const DEFAULT_DUE_OFFSET_MINUTES = 480

interface LocalDate {
  year: number
  month: number
  day: number
}

interface Period {
  /** First second of the period, as a UTC instant. */
  start: string
  /** Last second of the period, as a UTC instant. */
  end: string
}

function localDateOf(nowMs: number, offsetMinutes: number): LocalDate {
  const shifted = new Date(nowMs + offsetMinutes * 60_000)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

function startOfDayUtc(date: LocalDate, offsetMinutes: number): string {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0) - offsetMinutes * 60_000).toISOString()
}

function endOfDayUtc(date: LocalDate, offsetMinutes: number): string {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 23, 59, 59) - offsetMinutes * 60_000).toISOString()
}

function dayPeriod(date: LocalDate, offsetMinutes: number): Period {
  return { start: startOfDayUtc(date, offsetMinutes), end: endOfDayUtc(date, offsetMinutes) }
}

function monthPeriod(year: number, month: number, offsetMinutes: number): Period {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    start: startOfDayUtc({ year, month, day: 1 }, offsetMinutes),
    end: endOfDayUtc({ year, month, day: lastDay }, offsetMinutes)
  }
}

function clampDay(year: number, month: number, day: number): LocalDate {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { year, month, day: Math.min(day, lastDay) }
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

const PATTERNS: Array<{ re: RegExp; resolve: (match: RegExpExecArray, now: LocalDate, offset: number) => Period | null }> = [
  // 2027年3月15日 / 2027-03-15 / 2027/3/15
  {
    re: /(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*[日号]?/u,
    resolve: (m, _now, offset) => dayPeriod(clampDay(Number(m[1]), Number(m[2]), Number(m[3])), offset)
  },
  // 2027年3月 / 2028年三月
  {
    re: new RegExp(`(\\d{4})\\s*年\\s*${MONTH_TOKEN}\\s*月`, 'u'),
    resolve: (m, _now, offset) => {
      const month = parseMonth(m[2])
      return month === null ? null : monthPeriod(Number(m[1]), month, offset)
    }
  },
  // 明年三月 / 明年3月 / 明年
  {
    re: new RegExp(`明年\\s*${MONTH_TOKEN}?\\s*月?`, 'u'),
    resolve: (m, now, offset) => monthPeriod(now.year + 1, parseMonth(m[1]) ?? 12, offset)
  },
  // 今年三月 / 今年
  {
    re: new RegExp(`今年\\s*${MONTH_TOKEN}?\\s*月?`, 'u'),
    resolve: (m, now, offset) => monthPeriod(now.year, parseMonth(m[1]) ?? 12, offset)
  },
  // 下个月 / 下月
  {
    re: /下(?:个)?月/u,
    resolve: (_m, now, offset) => {
      const month = now.month === 12 ? 1 : now.month + 1
      const year = now.month === 12 ? now.year + 1 : now.year
      return monthPeriod(year, month, offset)
    }
  },
  // 这个月 / 本月 / 月底 / 月末
  {
    re: /(?:这(?:个)?月|本月|月底|月末)/u,
    resolve: (_m, now, offset) => monthPeriod(now.year, now.month, offset)
  },
  // 下周 / 下个星期
  {
    re: /下(?:个)?(?:周|星期)/u,
    resolve: (_m, now, offset) => {
      const current = new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay()
      const daysToNextSunday = ((7 - current) % 7) + 7
      const target = new Date(Date.UTC(now.year, now.month - 1, now.day + daysToNextSunday))
      return dayPeriod({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, offset)
    }
  },
  // 这周 / 本周
  {
    re: /(?:这(?:个)?|本)(?:周|星期)/u,
    resolve: (_m, now, offset) => {
      const current = new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay()
      const daysToSunday = (7 - current) % 7
      const target = new Date(Date.UTC(now.year, now.month - 1, now.day + daysToSunday))
      return dayPeriod({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, offset)
    }
  },
  // 3天后 / 三天内
  {
    re: /(\d{1,3})\s*天(?:后|以后|之内|内)/u,
    resolve: (m, now, offset) => {
      const target = new Date(Date.UTC(now.year, now.month - 1, now.day + Number(m[1])))
      return dayPeriod({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, offset)
    }
  },
  // 2周后
  {
    re: /(\d{1,2})\s*(?:周|星期)(?:后|以后|之内|内)/u,
    resolve: (m, now, offset) => {
      const target = new Date(Date.UTC(now.year, now.month - 1, now.day + Number(m[1]) * 7))
      return dayPeriod({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, offset)
    }
  },
  // 3月15日 — this year, or next year when the date has already passed
  {
    re: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/u,
    resolve: (m, now, offset) => {
      const month = Number(m[1])
      const day = Number(m[2])
      const candidate = dayPeriod(clampDay(now.year, month, day), offset)
      if (Date.parse(candidate.end) >= Date.UTC(now.year, now.month - 1, now.day)) return candidate
      return dayPeriod(clampDay(now.year + 1, month, day), offset)
    }
  },
  // 三月 / 3月 — bare month, this year or next when it has already passed
  {
    re: new RegExp(`(${MONTH_TOKEN.slice(1, -1)})\\s*月(?!\\s*[日号])`, 'u'),
    resolve: (m, now, offset) => {
      const month = parseMonth(m[1])
      if (month === null) return null
      const candidate = monthPeriod(now.year, month, offset)
      if (Date.parse(candidate.end) >= Date.UTC(now.year, now.month - 1, now.day)) return candidate
      return monthPeriod(now.year + 1, month, offset)
    }
  }
]

/** Boundary words, longest first so 底前 wins over 前. */
const BOUNDARIES: ReadonlyArray<{ pattern: RegExp; boundary: DueBoundary; word: string }> = Object.freeze([
  { pattern: /^\s*(?:底前|月底前|末前)/u, boundary: 'end', word: '底前' },
  { pattern: /^\s*(?:之前|以前|前)/u, boundary: 'before', word: '之前' },
  { pattern: /^\s*(?:开始时|开始的时候|之初|初)/u, boundary: 'start', word: '开始时' },
  { pattern: /^\s*(?:以后|之后)/u, boundary: 'after', word: '以后' },
  { pattern: /^\s*(?:之内|以内|内|期间)/u, boundary: 'end', word: '内' }
])

/** A horizon that exists as a phrase but names no resolvable date. */
const VAGUE_HORIZON = /(?:以后|将来|有空|找时间|某天|过(?:一)?段(?:时间|日子)|改天|有机会)/u
/** A horizon phrase that the resolver is expected to handle. */
const HORIZON_HINT = /(?:明年|今年|下(?:个)?月|这(?:个)?月|本月|月底|月末|下(?:个)?(?:周|星期)|(?:这(?:个)?|本)(?:周|星期)|\d{1,3}\s*天|\d{1,2}\s*(?:周|星期)|\d{1,2}\s*月|\d{4}\s*[年/.-])/u

function boundaryAfter(text: string, endIndex: number): { boundary: DueBoundary; word: string } | null {
  const rest = text.slice(endIndex, endIndex + 8)
  for (const entry of BOUNDARIES) {
    if (entry.pattern.test(rest)) return { boundary: entry.boundary, word: entry.word }
  }
  return null
}

function applyBoundary(period: Period, boundary: DueBoundary | null): string {
  switch (boundary) {
    case 'before':
      // Last second before the period starts. This is the rule that makes
      // "三月之前" February, not March.
      return new Date(Date.parse(period.start) - 1000).toISOString()
    case 'start':
    case 'after':
      return period.start
    case 'end':
    default:
      return period.end
  }
}

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
    const period = pattern.resolve(match, now, offsetMinutes)
    if (!period) continue
    const boundary = boundaryAfter(normalized, (match.index ?? 0) + match[0].length)
    return {
      dueAt: applyBoundary(period, boundary?.boundary ?? null),
      expression: `${match[0]}${boundary?.word ?? ''}`.trim(),
      unresolved: false,
      // The applied rule is reported even when no boundary word was written:
      // "明年三月" is resolved by the default end-of-period rule, and an audit
      // should be able to see that rather than a null.
      boundary: boundary?.boundary ?? 'end'
    }
  }
  if (VAGUE_HORIZON.test(normalized) || HORIZON_HINT.test(normalized)) {
    const vague = VAGUE_HORIZON.exec(normalized)
    return { dueAt: null, expression: vague?.[0] ?? null, unresolved: true, boundary: null }
  }
  return { dueAt: null, expression: null, unresolved: false, boundary: null }
}

/** True when the text names a checkable horizon, resolved or not. */
export function hasHorizon(text: string): boolean {
  return HORIZON_HINT.test(text.normalize('NFKC')) || VAGUE_HORIZON.test(text.normalize('NFKC'))
}

/**
 * Removes the horizon phrase from a clause so the title is the commitment, not
 * the deadline. The boundary word goes with it: "三月之前完成 X" must not leave
 * "之前" in the goal name.
 */
export function stripHorizon(text: string): string {
  let result = text.normalize('NFKC')
  for (const pattern of PATTERNS) {
    result = result.replace(new RegExp(pattern.re.source, 'gu'), ' ')
  }
  result = result.replace(/(?:之前|以前|底前|月底前|末前|之内|以内|开始时|之初|以后|之后|截止)/gu, ' ')
  return result.replaceAll(/\s+/gu, ' ').trim()
}
