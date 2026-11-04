/**
 * Concern identity for reflection findings (AUD45-P1-01).
 *
 * A finding's *evidence set* changes every time the same concern is observed
 * again (a second correction event, a second knowledge gap for the same label).
 * Treating that as a different finding made the router reject the new row as a
 * link mismatch, even though the concern — and therefore the pending item the
 * user must decide — was already known.
 *
 * The concern key is the stable identity of "what is still open", independent
 * of which evidence happened to be in the batch:
 *
 *   concernKey = SHA-256("concern:v1|<kind>|<normalise(statement)>")
 *
 * Normalisation is deliberately conservative: it removes differences that carry
 * no meaning (Unicode compatibility forms, whitespace, a small set of
 * full-width punctuation, zero-width characters, ASCII case) and preserves
 * negation, time, entities, numbers, subject and predicate. Statements that
 * differ in any of those are different concerns and must not be merged.
 */
import { createHash } from 'node:crypto'

/** Bump when normalisation changes meaning; old keys stay readable. */
export const CONCERN_IDENTITY_VERSION = 1

/** Kinds whose evidence is a re-observation of one ongoing concern. */
export const CONCERN_KINDS = [
  'memory_gap',
  'open_question',
  'intent_correction',
  'consistency_note'
] as const

export type ConcernKind = typeof CONCERN_KINDS[number]

export function isConcernKind(kind: string): kind is ConcernKind {
  return (CONCERN_KINDS as readonly string[]).includes(kind)
}

const PUNCTUATION: Readonly<Record<string, string>> = Object.freeze({
  '，': ',', '。': '.', '！': '!', '？': '?', '；': ';', '：': ':',
  '（': '(', '）': ')', '【': '[', '】': ']', '、': ',',
  '“': '"', '”': '"', '‘': "'", '’': "'"
})

/** Invisible characters that must not fork an otherwise identical concern. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu

export function normalizeConcern(statement: string): string {
  let value = statement.normalize('NFKC')
  value = value.replaceAll(ZERO_WIDTH, '')
  value = value.replaceAll(/\s+/gu, ' ').trim()
  value = value.replace(/[\u3000-\u303F\uFF00-\uFFEF]/gu, (character) => PUNCTUATION[character] ?? character)
  // Whitespace next to punctuation is not meaning: "a； b" and "a;b" are one
  // concern. The punctuation itself is preserved.
  value = value.replace(/\s*([,.;:!?()[\]"'])\s*/gu, '$1')
  return value.toLowerCase()
}

/** The stable concern identity; 64 hex characters. */
export function concernKeyOf(kind: string, statement: string): string {
  return createHash('sha256')
    .update(`concern:v${CONCERN_IDENTITY_VERSION}|${kind}|${normalizeConcern(statement)}`)
    .digest('hex')
}

/** Pending-item digest of the normalised statement: 16 hex characters. */
export function concernDigestOf(statement: string): string {
  return createHash('sha256').update(normalizeConcern(statement)).digest('hex').slice(0, 16)
}

/**
 * Pending items stored before concern identity existed hashed the raw statement.
 * Reading both keys is what lets a post-fix observation reuse an old item
 * instead of creating a second one for the same concern.
 */
export function legacyConcernDigestOf(statement: string): string {
  return createHash('sha256').update(statement).digest('hex').slice(0, 16)
}

/** Dedupe keys to look up, newest scheme first. */
export function reflectionPendingKeys(kind: string, statement: string): string[] {
  const keys = [`reflection:${kind}:${concernDigestOf(statement)}`]
  const legacy = `reflection:${kind}:${legacyConcernDigestOf(statement)}`
  if (!keys.includes(legacy)) keys.push(legacy)
  return keys
}
