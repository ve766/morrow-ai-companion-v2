/**
 * Pre-delivery fact guard (Phase 2.3 reliability).
 *
 * The cloud run invented a plate number and a car model while no memory
 * mentioned either. A prompt instruction is not a guarantee, so the reply is
 * checked after generation and before it is shown or stored: every specific
 * personal fact it states must be supported by a delivered, active entry.
 *
 * Matching is deliberately strict. The first version accepted any two-way
 * substring, which let "杭州" support "杭州市西湖区文三路 100 号" and let a
 * short value support a longer invented one. Support is now an equality test
 * under an explicit, auditable normalisation:
 *
 *   exact kinds (plate, phone, document)
 *     NFKC, drop separators (`space - _ . · • / \`), lower-case, then EQUAL.
 *     Nothing else counts: 京A12345 ≠ 京A123456.
 *
 *   text kinds (address, name, age, birthday)
 *     NFKC, drop spaces, lower-case, strip one trailing administrative suffix
 *     (省/市/区/县/镇/乡/街道/特别行政区/自治区), then EQUAL. This is the only
 *     equivalence rule, and it is symmetric: 杭州 = 杭州市, but 杭州 ≠ 杭州市西湖区.
 *
 * An unresolved entry is never support. Conflict disclosure is limited to the
 * conflict group that concerns the intercepted fact; if no group can be tied
 * to it, the guard answers with a value-free clarification instead of borrowing
 * an unrelated conflict.
 */
import { readFactSlot } from '../memory/fact-slot'

export interface FactGuardMemory {
  id: string
  content: string
  status?: 'active' | 'unresolved'
  conflictWith?: string[]
}

export interface FactGuardInput {
  reply: string
  question: string
  memories: readonly FactGuardMemory[]
}

export interface UnsupportedClaim {
  /** The matched text, truncated: enough to audit, never a whole answer. */
  text: string
  kind: ClaimKind
  value: string
  predicate: string | null
}

export interface FactGuardResult {
  /** The text that may be delivered. */
  reply: string
  verdict: 'allow' | 'rewrite'
  unsupportedClaims: UnsupportedClaim[]
  reason: string
}

export type ClaimKind = 'vehicle_plate' | 'phone' | 'document' | 'address' | 'age' | 'birthday' | 'name'

interface ClaimPattern {
  kind: ClaimKind
  /** `§` is replaced by the allowed subject alternation. */
  body: string
  group: number
}

/**
 * Only high-risk personal facts get a pattern. A miss is a false negative, not
 * a false positive, which is the right trade-off for a delivery gate.
 */
const CLAIM_PATTERNS: ClaimPattern[] = [
  { kind: 'vehicle_plate', body: '(?:§)(?:的)?(?:车牌号?|牌照号?)\\s*(?:是|为|：|:)\\s*([A-Za-z\\u4e00-\\u9fa5][A-Za-z0-9·\\-\\u4e00-\\u9fa5]{3,12})', group: 1 },
  { kind: 'phone', body: '(?:§)(?:的)?(?:手机号?|电话|联系方式)\\s*(?:可能|应该|大概)?\\s*(?:是|为|：|:)\\s*(\\d[\\d\\s-]{5,})', group: 1 },
  { kind: 'document', body: '(?:§)(?:的)?(?:身份证|护照|银行卡|驾照)(?:号)?\\s*(?:是|为|：|:)\\s*([A-Za-z0-9]{6,20})', group: 1 },
  { kind: 'address', body: '(?:§)(?:现在|目前)?住在\\s*([^。！？，,\\n]{2,20})', group: 1 },
  { kind: 'age', body: '(?:§)(?:今年)?\\s*(\\d{1,3})\\s*岁', group: 1 },
  { kind: 'birthday', body: '(?:§)(?:的)?生日\\s*(?:是|为|：|:)\\s*([\\d年月日\\-/]{4,12})', group: 1 },
  // The captured name stops at 的/了, otherwise "叫咪咪的猫" would be a name.
  { kind: 'name', body: '(?:§)(?:的)?[^，。！？\\n]{0,6}?(?:叫|名叫|名字是)\\s*([^\\s，。！？的了]{1,8})', group: 1 }
]

/** Second person for the reply, first or second for the stored entry. */
const REPLY_SUBJECT = '你|您'
const MEMORY_SUBJECT = '我|你|您'

const EXACT_KINDS: ReadonlySet<ClaimKind> = new Set(['vehicle_plate', 'phone', 'document'])
/** Only these are normalised away; no other character may be dropped. */
const SEPARATORS = /[\s\-_.·•/\\]/gu
const ADMIN_SUFFIX = /(?:特别行政区|自治区|省|市|区|县|镇|乡|街道)$/u

/**
 * Which structured predicates may support which claim. A slot of another type is
 * not evidence for this fact, even when the strings are equal: 职业=杭州 must
 * never support 住在杭州. Exact kinds have no structured predicate at all, so a
 * slot never supports them — only the sentence patterns and an exact bare value.
 */
const SLOT_PREDICATES_BY_KIND: Readonly<Record<ClaimKind, readonly string[]>> = {
  vehicle_plate: [],
  phone: [],
  document: [],
  address: ['residence'],
  age: ['age'],
  birthday: ['age'],
  name: ['name']
}

const PREDICATE_BY_KIND: Readonly<Record<ClaimKind, string | null>> = {
  vehicle_plate: null,
  phone: null,
  document: null,
  address: 'residence',
  age: 'age',
  birthday: 'age',
  name: 'name'
}

const LABEL_BY_KIND: Readonly<Record<ClaimKind, string>> = {
  vehicle_plate: '车牌号',
  phone: '联系方式',
  document: '证件号码',
  address: '住址',
  age: '年龄',
  birthday: '生日',
  name: '名字'
}

function build(pattern: ClaimPattern, subjects: string): RegExp {
  return new RegExp(pattern.body.replace('§', subjects), 'gu')
}

export function normalizeExact(value: string): string {
  return value.normalize('NFKC').replace(SEPARATORS, '').toLocaleLowerCase()
}

export function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase().replace(ADMIN_SUFFIX, '')
}

function normalizeFor(kind: ClaimKind, value: string): string {
  return EXACT_KINDS.has(kind) ? normalizeExact(value) : normalizeText(value)
}

function strip(value: string): string {
  return value.replace(/[。！？.!?,，、\s]+$/u, '').trim()
}

/** Value candidates a stored entry states, for one claim kind. */
function memoryValues(memory: FactGuardMemory, kind: ClaimKind, now: string[] = []): string[] {
  const values: string[] = [...now]
  const slot = readFactSlot(memory.content)
  // Only a slot of a compatible type may contribute its value.
  if (slot && slot.value.length > 0 && SLOT_PREDICATES_BY_KIND[kind].includes(slot.predicate)) values.push(slot.value)
  const pattern = CLAIM_PATTERNS.find((item) => item.kind === kind)
  if (pattern) {
    for (const match of memory.content.matchAll(build(pattern, MEMORY_SUBJECT))) {
      const value = strip(match[pattern.group] ?? '')
      if (value.length > 0) values.push(value)
    }
  }
  // An entry that is just the value ("京A12345") counts by equality only.
  const bare = strip(memory.content.replace(/^(?:我的?|你的?|您的?)/u, ''))
  if (bare.length > 0) values.push(bare)
  return values
}

/** Strict, kind-aware support test: equality under the documented rules. */
export function isSupportedByMemory(kind: ClaimKind, value: string, memories: readonly FactGuardMemory[]): boolean {
  const wanted = normalizeFor(kind, strip(value))
  if (wanted.length === 0) return false
  for (const memory of memories) {
    // An unresolved entry is a claim, not support; a retracted entry never
    // reaches this list because the assembler drops it.
    if (memory.status === 'unresolved') continue
    for (const candidate of memoryValues(memory, kind)) {
      const normalized = normalizeFor(kind, strip(candidate))
      if (normalized.length > 0 && normalized === wanted) return true
    }
  }
  return false
}

interface ConflictGroup {
  ids: string[]
  values: string[]
  predicate: string
}

function conflictGroups(memories: readonly FactGuardMemory[]): ConflictGroup[] {
  const groups: ConflictGroup[] = []
  const seen = new Set<string>()
  // Unresolved entries that state the same predicate are a conflict even when
  // the assembler did not link them (an offline caller may not set the links).
  const byPredicate = new Map<string, FactGuardMemory[]>()
  for (const memory of memories) {
    if (memory.status !== 'unresolved') continue
    const predicate = readFactSlot(memory.content)?.predicate
    if (!predicate) continue
    const list = byPredicate.get(predicate) ?? []
    list.push(memory)
    byPredicate.set(predicate, list)
  }
  for (const [predicate, entries] of byPredicate) {
    if (entries.length < 2) continue
    const values = entries.map((item) => strip(readFactSlot(item.content)?.value ?? '')).filter((value) => value.length > 0)
    if (values.length < 2) continue
    const ids = entries.map((item) => item.id).sort()
    seen.add(ids.join('|'))
    groups.push({ ids, values, predicate })
  }
  for (const memory of memories) {
    if (memory.status !== 'unresolved' || (memory.conflictWith?.length ?? 0) === 0) continue
    const ids = [memory.id, ...memory.conflictWith!]
    const key = [...ids].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const entries = ids
      .map((id) => memories.find((item) => item.id === id))
      .filter((item): item is FactGuardMemory => Boolean(item))
    const values = entries.map((item) => strip(readFactSlot(item.content)?.value ?? '')).filter((value) => value.length > 0)
    if (values.length < 2) continue
    const predicates = [...new Set(entries.map((item) => readFactSlot(item.content)?.predicate).filter((item): item is NonNullable<typeof item> => Boolean(item)))]
    groups.push({ ids, values, predicate: predicates[0] ?? 'unknown' })
  }
  return groups
}

/**
 * A conflict may only be disclosed when it concerns the intercepted fact:
 * same predicate, same claim shape, or a value the claim overlaps after
 * normalisation. Everything else stays out of this answer.
 */
function relatedConflictValues(claim: UnsupportedClaim, memories: readonly FactGuardMemory[]): string[] {
  const predicate = PREDICATE_BY_KIND[claim.kind]
  const related = conflictGroups(memories).filter((group) => {
    if (predicate && group.predicate === predicate) return true
    const pattern = CLAIM_PATTERNS.find((item) => item.kind === claim.kind)
    if (pattern && group.values.some((value) => build(pattern, MEMORY_SUBJECT).test(value))) return true
    const wanted = normalizeFor(claim.kind, claim.value)
    return group.values.some((value) => normalizeFor(claim.kind, value) === wanted)
  })
  const values = related.flatMap((group) => group.values)
  return [...new Set(values)]
}

/** True when the question is about the user, so a personal claim is checkable. */
function asksAboutUser(question: string): boolean {
  return /(?:我|我的)|\b(?:my|mine|i|i'm)\b/iu.test(question)
}

export function guardAnswerFacts(input: FactGuardInput): FactGuardResult {
  if (!asksAboutUser(input.question)) return { reply: input.reply, verdict: 'allow', unsupportedClaims: [], reason: 'question_not_about_user' }

  const claims: UnsupportedClaim[] = []
  for (const pattern of CLAIM_PATTERNS) {
    for (const match of input.reply.matchAll(build(pattern, REPLY_SUBJECT))) {
      const value = strip(match[pattern.group] ?? '')
      if (value.length === 0) continue
      if (isSupportedByMemory(pattern.kind, value, input.memories)) continue
      claims.push({ text: match[0].slice(0, 60), kind: pattern.kind, value: value.slice(0, 40), predicate: PREDICATE_BY_KIND[pattern.kind] })
    }
  }
  if (claims.length === 0) return { reply: input.reply, verdict: 'allow', unsupportedClaims: [], reason: 'no_unsupported_claim' }

  const first = claims[0]!
  const conflictValues = relatedConflictValues(first, input.memories)
  if (conflictValues.length >= 2) {
    const reply = `保存的记录里有两种不一致的说法：${conflictValues.slice(0, 2).join(' 和 ')}，我无法判断哪个才是现在的。你能告诉我吗？`
    return { reply, verdict: 'rewrite', unsupportedClaims: claims, reason: 'conflicting_evidence' }
  }

  // Nothing linkable: a value-free clarification, never a borrowed conflict.
  const reply = `关于${LABEL_BY_KIND[first.kind]}，我这边没有可用的记录，不能给你一个确定的说法。如果你愿意告诉我，我可以记下来；也可以直接查看相关证件确认。`
  return { reply, verdict: 'rewrite', unsupportedClaims: claims, reason: 'unsupported_personal_fact' }
}
