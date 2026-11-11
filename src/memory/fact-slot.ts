/**
 * Explainable fact slots, derived from text at read time.
 *
 * Nothing is persisted: the memory table already carries source, time, status
 * and revision lineage, so a slot is a *reading* of the current text. A record
 * that is corrected or retracted changes its slot automatically.
 *
 * Phase 2 splits the reading into four independent steps, because the earlier
 * version mixed them and produced contradictions:
 *
 *   1. clause segmentation   - what each part of the sentence says
 *   2. predicate extraction  - which fact, and which value (per predicate)
 *   3. mood / polarity       - asserted, asked, denied, or not decidable
 *   4. time state            - past, present, future, mixed, unspecified
 *
 * Only a clause that is asserted, non-modal and non-reported can become a
 * value. Everything else stays `uncertain` with an empty value: guessing is
 * worse than admitting that the text cannot be read.
 */

export type FactPredicate =
  | 'residence'
  | 'employer'
  | 'job_role'
  | 'study'
  | 'preference'
  | 'goal'
  | 'name'
  | 'age'
  | 'project_code'
  | 'pet_name'
  | 'object_location'
  | 'health'
  | 'schedule'

export type FactStatus = 'active' | 'superseded' | 'unresolved'
export type FactKind = 'assertion' | 'question' | 'negated' | 'uncertain'
/** Time reference of the statement. `mixed` means two states in one sentence. */
export type FactTime = 'past' | 'present' | 'future' | 'mixed' | 'unspecified'
export type ValueRelation = 'equivalent' | 'conflict' | 'uncertain'

export interface FactSlot {
  subject: 'user'
  predicate: FactPredicate
  /** Object text. Empty for questions and for unreadable statements. */
  value: string
  kind: FactKind
  time: FactTime
  /** Kept for callers that only ask "is this a question". */
  question: boolean
  observedAt: string
  status: FactStatus
  sourceId: string
}

interface Extracted {
  value: string
  negated: boolean
  /** True when the sentence asks about the predicate instead of stating it. */
  asks: boolean
}

const VALUE_NOISE = /^[\s，,。.；;：:！!？?、]+|[\s，。；;：:！!？?、]+$/gu
const COPULA = /^\s*(?:是|为|就是|叫|在)/u

/** Predicates that name one value at a time; a different value is a conflict. */
export const SINGLE_VALUED_PREDICATES: ReadonlySet<FactPredicate> = new Set(['residence', 'age', 'name', 'employer', 'job_role', 'project_code'])

function clean(value: string): string {
  // Punctuation first, so a trailing 了 is actually trailing.
  return value.normalize('NFKC').replace(VALUE_NOISE, '').replace(COPULA, '').replace(/^有/u, '').replace(/了$/u, '').replace(VALUE_NOISE, '').replace(/\s+/gu, '')
}

function negatedBefore(text: string, index: number): boolean {
  return /(?:不再|没有|不)$/u.test(text.slice(Math.max(0, index - 2), index))
}

/** Every predicate extracts its own value; a marker never consumes the value. */
const EXTRACTORS: ReadonlyArray<{ predicate: FactPredicate; read: (text: string) => Extracted | null }> = [
  {
    predicate: 'name',
    read: (text) => {
      const match = /(?:我的?名字|我叫|姓名)(?:是|叫)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: false, asks: false }
    }
  },
  {
    predicate: 'age',
    read: (text) => {
      const explicit = /(?:年龄)(?:是|为)?\s*(\d{1,3})?/u.exec(text)
      const counter = /(\d{1,3})\s*岁/u.exec(text)
      const asked = /(?:多少|几)\s*岁/u.test(text)
      if (!explicit && !counter && !asked) return null
      const digits = counter?.[1] ?? explicit?.[1] ?? ''
      return { value: digits, negated: false, asks: digits.length === 0 }
    }
  },
  {
    predicate: 'residence',
    read: (text) => {
      // D-5: interrogative and colloquial shapes ("我现在住哪？", "我搬去苏州了")
      // name the same fact as "我住在杭州". Without them a paraphrased
      // question has zero lexical overlap and no slot, which is exactly the
      // cross-session miss the real-provider run produced.
      const match = /(?:住在|居住在|现居|定居在?|搬到|搬家到|搬去|住址(?:是|为)?|住(?:在)?哪(?:里|儿)?)/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },
  {
    predicate: 'employer',
    read: (text) => {
      const match = /在([^，。；\n]{1,20}?)(?:公司|集团|单位|工作|上班|任职|就职|实习)/u.exec(text)
      if (match) return { value: clean(match[1] ?? ''), negated: negatedBefore(text, match.index), asks: false }
      const own = /我的?公司(?:是|为)?/u.exec(text)
      if (!own) return null
      return { value: clean(text.slice(own.index + own[0].length)), negated: false, asks: false }
    }
  },
  {
    predicate: 'job_role',
    read: (text) => {
      const match = /(?:职业|职位|岗位|职务)(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },
  {
    predicate: 'study',
    read: (text) => {
      // 学习 must win over 在学, otherwise "我在学习 Blender" leaves "习…".
      const match = /(?:学习|学会|课程|专业|在学(?!习))(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },

  {
    predicate: 'health',
    read: (text) => {
      // The object of an allergy sits before the marker: 我对花生严重过敏.
      // The negation sits between object and marker: 我对花生不过敏.
      const allergy = /对([^，。；\n]{1,20}?)(?:严重|比较|有点)?(不)?过敏/u.exec(text)
      if (allergy) return { value: clean(allergy[1] ?? ''), negated: Boolean(allergy[2]), asks: false }
      const absent = /(?:没有|没|无)([^，。；\n]{1,20}?)过敏/u.exec(text)
      if (absent) return { value: clean(absent[1] ?? ''), negated: true, asks: false }
      const marker = /(?:忌口|不能吃|患有|确诊|病史)(?:是|为)?/u.exec(text)
      if (!marker) return null
      return { value: clean(text.slice(marker.index + marker[0].length)), negated: negatedBefore(text, marker.index), asks: false }
    }
  },
  {
    predicate: 'preference',
    read: (text) => {
      const match = /(?:喜欢|偏好|讨厌|习惯|兴趣|爱好)(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },
  {
    predicate: 'goal',
    read: (text) => {
      const match = /(?:计划|打算|目标|准备)(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false }
    }
  },
  {
    predicate: 'schedule',
    read: (text) => {
      // Events and appointments: the marker can sit before or after the value.
      const marker = /(?:安排|日程|行程|会议|出差|预约|复查|截止日期|截止)(?:是|为|在|有)?/u.exec(text)
      if (!marker) return null
      const after = clean(text.slice(marker.index + marker[0].length))
      const before = clean(text.slice(0, marker.index).replace(/^我|(?:今天|明天|后天|昨天|本周|这周|下周|上周|这个月|下个月|今年|明年)/gu, ''))
      return { value: after.length > 0 ? after : before, negated: negatedBefore(text, marker.index), asks: false }
    }
  },
  {
    predicate: 'project_code',
    read: (text) => {
      const match = /(?:项目代号|代号)(?:是|为)?/u.exec(text)
      if (!match) return null
      return { value: clean(text.slice(match.index + match[0].length)), negated: false, asks: false }
    }
  }
]

/**
 * Reported speech and hypothesis are *sentence-level* markers. "听说我喜欢猫"
 * reports what someone else said; "如果我喜欢猫呢" supposes a world. Neither is
 * the user asserting a fact, so both collapse to `uncertain`.
 */
const REPORTED = /(?:听说|据说|有人说|据称|别人说|我听说|他妈说|朋友说|同事说)/u
const HYPOTHETICAL = /(?:如果|假设|假如|要是|万一|「|」|“|”)/u
const MODAL = /(?:可能|也许|或许|好像|似乎|大概|说不定|应该是|不确定|估计)/u
const DOUBLE_NEGATION = /(?:不是不|并非不|未尝不|不无)/u

const PAST = /(?:以前|曾经|过去|去年|前年|之前|小时候|当年|原来|上次|当年)/u
const PRESENT = /(?:现在|如今|目前|当前|眼下|这会儿|此刻)/u
const FUTURE = /(?:以后|将来|未来|明年|后年|下周|下个月|明天|后天|下次|下一年|月底|年底)/u

/** Sentence-final particles that turn a statement into a question. */
const QUESTION_TAIL = /(?:吗|么|呢)$/u
const INTERROGATIVE = /(?:是否|是不是|难道|多少|几岁|什么|谁|哪(?:里|儿|个|些|种|年)?|怎么|为什么|如何)/u

/** Clauses are split on sentence punctuation only. */
const CLAUSE_SEPARATOR = /[，,。.；;！!？?\n]+/u
/** A contrast word may start a clause; it is stripped, never used to split. */
const LEADING_CONNECTIVE = /^(?:但是|但|不过|可是|然而|却|而且|并且|然后)/u

/**
 * Clause-level time. `mixed` is only reported when one clause mentions two
 * incompatible times, which cannot be read as a single state.
 */
export function classifyFactTime(text: string): FactTime {
  const past = PAST.test(text)
  const present = PRESENT.test(text)
  const future = FUTURE.test(text)
  const states = Number(past) + Number(present) + Number(future)
  if (states > 1) return 'mixed'
  if (past) return 'past'
  if (future) return 'future'
  if (present) return 'present'
  return 'unspecified'
}

/**
 * Undated statements are read as current state *only* for comparing them with
 * a current question. The slot itself keeps `unspecified`, so the payload can
 * still tell the model that the user never said when it was true.
 */
export function effectiveFactTime(time: FactTime): 'past' | 'present' | 'future' | 'mixed' {
  return time === 'unspecified' ? 'present' : time
}

/** Two statements can only describe the same state when their times match. */
export function factsTimeCompatible(query: FactTime, memory: FactTime): boolean {
  if (query === 'mixed' || memory === 'mixed') return false
  return effectiveFactTime(query) === effectiveFactTime(memory)
}

interface ClauseRead {
  clause: string
  predicate: FactPredicate
  extracted: Extracted
  time: FactTime
  reported: boolean
  hypothetical: boolean
  modal: boolean
  doubleNegated: boolean
  question: boolean
  /** True when the object was inherited from a sibling clause (ellipsis). */
  inherited?: boolean
}

/**
 * A second clause often omits the object: "我以前对花生过敏，现在不过敏了".
 * The clause still states a *state of the same fact*, so the predicate marker
 * is enough to read its polarity and time. The rule is deliberately narrow:
 * the clause must contain the predicate's own marker, otherwise unrelated
 * clauses would be folded into the fact.
 */
const PREDICATE_MARKERS: Readonly<Record<FactPredicate, RegExp>> = {
  residence: /住/u,
  employer: /工作|公司|单位/u,
  job_role: /职业|职位|岗位|职务/u,
  study: /学习|学会|课程|专业|在学/u,
  preference: /喜欢|偏好|讨厌|习惯|兴趣|爱好/u,
  goal: /计划|打算|目标|准备/u,
  name: /名字|叫|姓名/u,
  age: /岁|年龄/u,
  project_code: /代号/u,
  pet_name: /猫|狗|宠物/u,
  object_location: /护照|身份证|钥匙|证件|放在/u,
  health: /过敏|忌口|病史/u,
  schedule: /安排|日程|行程|会议|出差|预约|复查|截止/u
}

function splitClauses(text: string): string[] {
  return text
    .split(CLAUSE_SEPARATOR)
    .map((part) => part.trim().replace(LEADING_CONNECTIVE, '').trim())
    .filter((part) => part.length > 0)
}

function readClause(clause: string): ClauseRead | null {
  for (const extractor of EXTRACTORS) {
    const extracted = extractor.read(clause)
    if (!extracted) continue
    return {
      clause,
      predicate: extractor.predicate,
      extracted,
      time: classifyFactTime(clause),
      reported: REPORTED.test(clause),
      hypothetical: HYPOTHETICAL.test(clause),
      modal: MODAL.test(clause),
      doubleNegated: DOUBLE_NEGATION.test(clause),
      // `asks` comes from the extractor itself; the particles are additional
      // evidence, never the only evidence.
      question: extracted.asks || QUESTION_TAIL.test(clause) || INTERROGATIVE.test(clause)
    }
  }
  return null
}

/** Most frequent predicate wins; ties fall back to the earliest clause. */
function dominantPredicate(reads: ClauseRead[]): FactPredicate {
  const counts = new Map<FactPredicate, number>()
  for (const read of reads) counts.set(read.predicate, (counts.get(read.predicate) ?? 0) + 1)
  let best = reads[0]!.predicate
  let bestCount = counts.get(best) ?? 0
  for (const read of reads) {
    const count = counts.get(read.predicate) ?? 0
    if (count > bestCount) {
      best = read.predicate
      bestCount = count
    }
  }
  return best
}

/** Reads a clause that only repeats the state (polarity, time) of a sibling. */
function readElliptical(clause: string, predicate: FactPredicate, value: string): ClauseRead | null {
  if (!PREDICATE_MARKERS[predicate].test(clause)) return null
  return {
    clause,
    predicate,
    extracted: { value, negated: /(?:不|没|无|并非|不再)/u.test(clause), asks: false },
    time: classifyFactTime(clause),
    reported: REPORTED.test(clause),
    hypothetical: HYPOTHETICAL.test(clause),
    modal: MODAL.test(clause),
    doubleNegated: DOUBLE_NEGATION.test(clause),
    question: QUESTION_TAIL.test(clause) || INTERROGATIVE.test(clause),
    inherited: true
  }
}

export function readFactSlot(
  text: string,
  context: { observedAt?: string; status?: FactStatus; sourceId?: string } = {}
): FactSlot | null {
  const normalized = text.normalize('NFKC').trim()
  if (normalized.length === 0) return null
  const clauses = splitClauses(normalized)
  const direct = clauses.map(readClause)
  const found = direct.filter((read): read is ClauseRead => read !== null)
  if (found.length === 0) return null
  const predicate = dominantPredicate(found)
  const anchorValue = clean(found.find((read) => read.predicate === predicate)!.extracted.value)
  // Fill ellipsis before selecting, so "…，现在不过敏了" counts as a second state.
  const reads: ClauseRead[] = []
  for (let index = 0; index < clauses.length; index += 1) {
    const read = direct[index]
    if (read) {
      reads.push(read)
      continue
    }
    const elliptical = readElliptical(clauses[index]!, predicate, anchorValue)
    if (elliptical) reads.push(elliptical)
  }
  const selected = reads.filter((read) => read.predicate === predicate)

  const build = (kind: FactKind, time: FactTime, value: string): FactSlot => ({
    subject: 'user',
    predicate,
    value: kind === 'question' || kind === 'uncertain' ? '' : value.slice(0, 120).toLocaleLowerCase(),
    kind,
    time,
    question: kind === 'question',
    observedAt: context.observedAt ?? '',
    status: context.status ?? 'active',
    sourceId: context.sourceId ?? ''
  })

  // Reported, hypothetical, modal or double-negated text is never asserted.
  if (selected.some((read) => read.reported || read.hypothetical || read.modal || read.doubleNegated)) {
    const time = selected.map((read) => read.time).find((value) => value !== 'unspecified') ?? 'unspecified'
    return build('uncertain', selected.some((read) => read.time === 'mixed') ? 'mixed' : time, '')
  }

  const definiteTimes = [...new Set(selected.map((read) => read.time).filter((time) => time !== 'unspecified'))]
  // Two different definite times in one sentence describe two states, not one.
  if (definiteTimes.length > 1 || selected.some((read) => read.time === 'mixed')) {
    return build('uncertain', 'mixed', '')
  }
  const time: FactTime = definiteTimes[0] ?? 'unspecified'

  if (selected.some((read) => read.question)) return build('question', time, '')

  // Clause agreement: the same kind and the same value, or nothing.
  const kinds = new Set(selected.map((read) => (read.extracted.negated ? 'negated' : 'assertion')))
  const values = new Set(selected.map((read) => clean(read.extracted.value)))
  if (kinds.size > 1 || values.size > 1) return build('uncertain', time, '')

  const kind: FactKind = kinds.has('negated') ? 'negated' : 'assertion'
  const value = clean(selected[0]!.extracted.value)
  if (value.length === 0) return build('uncertain', time, '')
  return build(kind, time, value)
}

/** Place suffixes that do not change which place is meant. */
function stripPlaceSuffix(value: string): string {
  return value.replace(/(?:市|省|区|县|镇|街道)$/u, '')
}

function comparable(value: string): string {
  return stripPlaceSuffix(value.normalize('NFKC').replace(/[的了]/gu, '').trim().toLocaleLowerCase())
}

/**
 * Three-state comparison of two values of the same fact.
 *
 * `equivalent` requires an explicit normalisation rule (place suffix, width,
 * particles). Substring containment is *not* equivalence: "喜欢猫" and
 * "喜欢猫狗" are different statements that the current rules cannot order.
 *
 * `conflict` requires proof: the same value with opposite polarity, or a
 * different value for a single-valued fact (a person has one residence). For
 * multi-valued facts (preferences, goals, allergies) two different values can
 * both be true, so they stay `uncertain` rather than being called a
 * contradiction.
 */
export function compareFactValues(left: FactSlot | null, right: FactSlot | null): ValueRelation {
  if (!left || !right) return 'uncertain'
  if (left.subject !== right.subject || left.predicate !== right.predicate) return 'uncertain'
  if (left.kind === 'question' || right.kind === 'question') return 'uncertain'
  if (left.kind === 'uncertain' || right.kind === 'uncertain') return 'uncertain'
  if (left.value.length === 0 || right.value.length === 0) return 'uncertain'
  // A past and a present state can both be true; they are not a contradiction.
  if (!factsTimeCompatible(left.time, right.time)) return 'uncertain'
  const a = comparable(left.value)
  const b = comparable(right.value)
  const polarityDiffers = (left.kind === 'negated') !== (right.kind === 'negated')
  if (a === b) return polarityDiffers ? 'conflict' : 'equivalent'
  // Different objects with opposite polarity ("不喜欢猫" vs "喜欢狗") are not
  // a proven contradiction either.
  if (polarityDiffers) return 'uncertain'
  if (a.includes(b) || b.includes(a)) return 'uncertain'
  return SINGLE_VALUED_PREDICATES.has(left.predicate) ? 'conflict' : 'uncertain'
}

/** True only for a proven contradiction; uncertainty is not a conflict. */
export function slotsConflict(left: FactSlot | null, right: FactSlot | null): boolean {
  return compareFactValues(left, right) === 'conflict'
}

/** Backwards-compatible helper: disagreement means a proven contradiction. */
export function valuesDisagree(left: string, right: string): boolean {
  return compareFactValues(
    { subject: 'user', predicate: 'residence', value: left, kind: 'assertion', time: 'unspecified', question: false, observedAt: '', status: 'active', sourceId: '' },
    { subject: 'user', predicate: 'residence', value: right, kind: 'assertion', time: 'unspecified', question: false, observedAt: '', status: 'active', sourceId: '' }
  ) === 'conflict'
}


/**
 * Multi-fact extraction (final closure, R1).
 *
 * `readFactSlot` answers "what is this sentence mainly about" — one dominant
 * slot per text. The fact ledger needs the opposite guarantee: every
 * assertable personal fact in a memory ("我住在杭州，猫叫豆豆，喜欢科幻电影")
 * becomes its own addressable row. This walker reuses the same extractor
 * rules and the same conservatism: questions, hypotheses, reported speech,
 * modal statements and double negations yield nothing; an unknown shape
 * yields nothing (the memory text stays reachable through lexical retrieval
 * instead of being guessed into a predicate).
 */
export interface FactCandidate {
  /** The clause the fact was extracted from. */
  clause: string
  predicate: FactPredicate
  /** Display value as written. */
  value: string
  /** Normalized for uniqueness/addressing (lowercase, punctuation stripped). */
  valueNormalized: string
  polarity: 'positive' | 'negative'
  time: FactTime
}

function clauseTime(clause: string): FactTime {
  return classifyFactTime(clause)
}

export function extractFactSlots(text: string): FactCandidate[] {
  const normalized = text.normalize('NFKC').trim()
  if (normalized.length === 0) return []
  const out: FactCandidate[] = []
  const seen = new Set<string>()
  // Stage 4-A: the compound introduction shape ("我有一只猫，它叫咪咪") and its
  // correction ("它现在叫豆豆"). The pronoun clause alone has no marker, so
  // the pet mention in the neighbouring clause licenses the extraction.
  const compound = /(?:猫|狗|宠物)[，,]\s*(?:它|这只(?:猫|狗|宠物))(?:现在)?(?:的?名字)?叫([^，。]+)/u.exec(normalized)
  if (compound) {
    const value = clean(compound[1] ?? '')
    if (value.length > 0 && value.length <= 40 && !/^(?:什么|啥)/u.test(value)) {
      const key = ['pet_name', value.normalize('NFKC').trim().toLocaleLowerCase(), 'positive', 'unspecified'].join('|')
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ clause: compound[0], predicate: 'pet_name', value, valueNormalized: value.normalize('NFKC').trim().toLocaleLowerCase(), polarity: 'positive', time: 'unspecified' })
      }
    }
  }
  for (const clause of splitClauses(normalized)) {
    if (REPORTED.test(clause) || HYPOTHETICAL.test(clause) || DOUBLE_NEGATION.test(clause)) continue
    const time = clauseTime(clause)
    if (time === 'mixed') continue
    const question = QUESTION_TAIL.test(clause) || INTERROGATIVE.test(clause)
    // Multi-fact-only predicates: pet names and object locations are too
    // marker-greedy for the dominant-slot reader (猫 appears in opinions,
    // 放在 in prose), so they live here and never in readFactSlot.
    const extraRules: ReadonlyArray<{ predicate: FactPredicate; read: (clause: string) => { value: string; negated: boolean; asks: boolean } | null }> = [
      { predicate: 'pet_name', read: (clause) => {
        const match = /(?:我的?)?(?:猫|狗|宠物)(?:叫|名字是?|名字叫)?/u.exec(clause)
        if (!match) return null
        const value = clean(clause.slice(match.index + match[0].length))
        if (value.length === 0 || /猫|狗|宠物|多大|几岁/u.test(value)) return null
        return { value, negated: negatedBefore(clause, match.index), asks: false }
      } },
      { predicate: 'object_location', read: (clause) => {
        const match = /(?:护照|身份证|钥匙|证件)(?:放在|在|丢了)?/u.exec(clause)
        if (!match) return null
        const value = clean(clause.slice(match.index + match[0].length))
        if (value.length === 0) return null
        return { value, negated: negatedBefore(clause, match.index), asks: false }
      } }
    ]
    for (const extractor of [...EXTRACTORS, ...extraRules]) {
      const extracted = extractor.read(clause)
      if (!extracted) continue
      if (extracted.asks || question) continue
      const value = clean(extracted.value)
      if (value.length === 0 || value.length > 60) continue
      // A bare interrogative or demonstrative object is not a fact value.
      if (/^(?:什么|啥|哪个|哪些|哪里|哪儿|怎么|多少|它|这)/u.test(value)) continue
      const polarity: 'positive' | 'negative' = extracted.negated ? 'negative' : 'positive'
      const valueNormalized = comparable(value)
      if (valueNormalized.length === 0) continue
      const key = [extractor.predicate, valueNormalized, polarity, time].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ clause, predicate: extractor.predicate, value, valueNormalized, polarity, time })
    }
  }
  return out
}
