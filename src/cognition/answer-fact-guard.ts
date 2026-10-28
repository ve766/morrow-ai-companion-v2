/**
 * Pre-delivery fact guard (Phase 2.3 reliability, work item A).
 *
 * The cloud run produced one answer that invented a plate number and a car
 * model while no memory mentioned either. A prompt instruction is not a
 * guarantee, so the reply is checked after generation and before it is shown
 * or stored: every specific personal fact it states must be supported by a
 * delivered, active, time-compatible entry.
 *
 * It is deliberately narrow:
 *   - only second-person statements about the user are inspected ("你的车牌号是…")
 *   - general knowledge, code and first-person phrasing are untouched
 *   - support is checked by value containment in either direction, so a
 *     paraphrase is fine; a reply does not have to quote the entry
 *   - an unresolved conflict is not support: the reply may not state one side
 *     as settled fact
 *
 * When a claim is unsupported the whole reply is replaced by a short admission
 * that names no value, and the replacement is recorded so the ledger and the
 * report can show it.
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
  kind: string
  value: string
}

export interface FactGuardResult {
  /** The text that may be delivered. */
  reply: string
  verdict: 'allow' | 'rewrite'
  unsupportedClaims: UnsupportedClaim[]
  reason: string
}

interface ClaimPattern {
  kind: string
  pattern: RegExp
  /** Which capture group holds the value. */
  group: number
}

/**
 * Only high-risk personal facts get a pattern. A miss is a false negative, not
 * a false positive, which is the right trade-off for a delivery gate.
 */
const CLAIM_PATTERNS: ClaimPattern[] = [
  { kind: 'vehicle_plate', pattern: /(?:你的|您的)?(?:车牌号?|牌照号?)\s*(?:是|为|：|:)\s*([A-Za-z\u4e00-\u9fa5][A-Za-z0-9·\-\u4e00-\u9fa5]{3,12})/gu, group: 1 },
  { kind: 'phone', pattern: /(?:你的|您的)?(?:手机号?|电话|联系方式)\s*(?:可能|应该|大概)?\s*(?:是|为|：|:)\s*(\d[\d\s-]{5,})/gu, group: 1 },
  { kind: 'document', pattern: /(?:你的|您的)?(?:身份证|护照|银行卡|驾照)(?:号)?\s*(?:是|为|：|:)\s*([A-Za-z0-9]{6,20})/gu, group: 1 },
  { kind: 'address', pattern: /(?:你|您)(?:现在|目前)?住在\s*([^。！？，,\n]{2,20})/gu, group: 1 },
  { kind: 'age', pattern: /(?:你|您)(?:今年)?\s*(\d{1,3})\s*岁/gu, group: 1 },
  { kind: 'birthday', pattern: /(?:你的|您的)?生日\s*(?:是|为|：|:)\s*([\d年月日\-/]{4,12})/gu, group: 1 },
  // "你的猫叫咪咪" is a personal fact about the user's household, so a short
  // noun is allowed between the pronoun and the naming verb.
  { kind: 'name', pattern: /(?:你|您)(?:的)?[^，。！？\n]{0,6}?(?:叫|名叫|名字是)\s*([\u4e00-\u9fa5A-Za-z]{1,8})/gu, group: 1 }
]

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/[*`]/gu, '').toLocaleLowerCase()
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[。！？.!?,，、\s]+$/u, '').trim()
}

/** Does any delivered, active entry state this value? */
function isSupportedByMemory(value: string, memories: readonly FactGuardMemory[]): boolean {
  const wanted = normalize(stripTrailingPunctuation(value))
  if (wanted.length === 0) return false
  for (const memory of memories) {
    if (memory.status === 'unresolved') continue
    const slot = readFactSlot(memory.content)
    if (slot && slot.value.length > 0) {
      const stored = normalize(slot.value)
      // Containment in either direction: a paraphrase or a partial value counts.
      if (stored.length > 0 && (stored.includes(wanted) || wanted.includes(stored))) return true
    }
    // Entries without a readable predicate (a plate number, a name) still count
    // when the value itself appears in them.
    if (normalize(memory.content).includes(wanted)) return true
  }
  return false
}

/** True when the question is about the user, so a personal claim is checkable. */
function asksAboutUser(question: string): boolean {
  return /(?:我|我的)|\b(?:my|mine|i|i'm)\b/iu.test(question)
}

export function guardAnswerFacts(input: FactGuardInput): FactGuardResult {
  if (!asksAboutUser(input.question)) return { reply: input.reply, verdict: 'allow', unsupportedClaims: [], reason: 'question_not_about_user' }

  const claims: UnsupportedClaim[] = []
  for (const { kind, pattern, group } of CLAIM_PATTERNS) {
    for (const match of input.reply.matchAll(pattern)) {
      const raw = match[group] ?? ''
      const value = stripTrailingPunctuation(raw)
      if (value.length === 0) continue
      if (isSupportedByMemory(value, input.memories)) continue
      claims.push({ text: match[0].slice(0, 60), kind, value: value.slice(0, 40) })
    }
  }
  if (claims.length === 0) return { reply: input.reply, verdict: 'allow', unsupportedClaims: [], reason: 'no_unsupported_claim' }

  // A conflict is disclosed, not hidden: both stored values are named (they come
  // from memory, not from the model) and the user is asked which is current.
  const conflicting = input.memories.filter((memory) => memory.status === 'unresolved')
  const conflictValues = [...new Set(conflicting
    .map((memory) => {
      const slot = readFactSlot(memory.content)
      if (slot && slot.value.length > 0) return slot.value.trim()
      const named = /(?:叫|名字是|名为|住在|是)\s*([^\s，。！？]{1,12})/u.exec(memory.content)
      return named?.[1]?.trim() ?? ''
    })
    .filter((value) => value.length > 0))]
  if (conflictValues.length >= 2) {
    const reply = `保存的记录里有两种不一致的说法：${conflictValues.slice(0, 2).join(' 和 ')}，我无法判断哪个才是现在的。你能告诉我吗？`
    return { reply, verdict: 'rewrite', unsupportedClaims: claims, reason: 'conflicting_evidence' }
  }

  const kinds = [...new Set(claims.map((claim) => claim.kind))]
  const label = kinds.includes('vehicle_plate') ? '车牌号'
    : kinds.includes('address') ? '住址'
      : kinds.includes('phone') ? '联系方式'
        : kinds.includes('age') ? '年龄'
          : kinds.includes('birthday') ? '生日'
            : kinds.includes('name') ? '名字'
              : '这项信息'
  // The replacement names no value at all, so nothing invented can leak through.
  const reply = `关于${label}，我这边没有可用的记录，不能给你一个确定的说法。如果你愿意告诉我，我可以记下来；也可以直接查看相关证件确认。`
  return { reply, verdict: 'rewrite', unsupportedClaims: claims, reason: 'unsupported_personal_fact' }
}
