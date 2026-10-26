// Shared lexical primitives for memory retrieval.
//
// These are extracted verbatim from the original context assembler so that the
// baseline (v1) and the multi-signal (v2) algorithms tokenize and score text
// identically. Keeping one implementation is what makes a v1/v2 comparison
// meaningful: any ranking difference must come from the ranking policy, never
// from a different notion of "the same words".

const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'was', 'were', 'will', 'your', 'about', '我', '你', '他', '她', '它', '的', '了', '是', '在', '和', '有', '就', '都', '而', '及', '与', '着', '或', '一个'])

/** Maximum number of distinct query terms kept after tokenization. */
export const MAX_QUERY_TERMS = 64

/** Weight of an exact phrase hit relative to a single token hit. */
export const PHRASE_MATCH_WEIGHT = 4

export function normalizeRetrievalText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

export function retrievalTerms(value: string): string[] {
  const normalized = normalizeRetrievalText(value)
  const terms = new Set<string>()
  for (const token of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (token.length > 1 && !stopWords.has(token)) terms.add(token)
    const characters = Array.from(token)
    if (characters.length >= 2 && /\p{Script=Han}/u.test(token)) {
      for (let index = 0; index < characters.length - 1; index += 1) {
        const pair = characters[index]! + characters[index + 1]!
        if (!stopWords.has(pair)) terms.add(pair)
      }
    }
  }
  return [...terms].slice(0, MAX_QUERY_TERMS)
}

export function lexicalScore(content: string, queryTerms: readonly string[], phrase: string): number {
  const normalized = normalizeRetrievalText(content)
  const phraseMatch = phrase.length >= 2 && normalized.includes(phrase) ? PHRASE_MATCH_WEIGHT : 0
  const overlaps = queryTerms.reduce((count, term) => count + Number(normalized.includes(term)), 0)
  return phraseMatch + overlaps
}

/**
 * Upper bound of {@link lexicalScore} for a given query, used to normalize the
 * lexical signal into 0..1. Returns 1 for an empty query so callers never
 * divide by zero.
 */
export function lexicalScoreCeiling(queryTermCount: number): number {
  return Math.max(1, PHRASE_MATCH_WEIGHT + queryTermCount)
}

/** Jaccard similarity of two term sets; 0 when either side is empty. */
export function termOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const term of left) if (right.has(term)) shared += 1
  return shared / (left.size + right.size - shared)
}
