// Lexical primitives for memory retrieval.
//
// Matching rules differ by script on purpose. A single rule cannot serve both
// space-delimited languages and Chinese, and forcing English word boundaries
// onto Han text would destroy Chinese recall:
//
//  - Latin / numeric / mixed tokens are matched as WHOLE TOKENS. The previous
//    implementation used `content.includes(term)`, so the query term "an" hit
//    inside "analyst" and a memory about data analysis was retrieved for a
//    question about swallows.
//  - Han text has no delimiters, so adjacent character pairs (bigrams) are the
//    matching unit. A multi-character Han term matches when every one of its
//    bigrams is present, which keeps "喜欢素食" matching "我更喜欢素食" without
//    reintroducing arbitrary substring hits.
//  - Normalization is NFKC + lower case, applied before any comparison, so
//    full-width forms, case and compatibility variants do not split matches.
//
// `substring` is retained as an explicit mode so the pre-fix behaviour stays
// reproducible for the frozen benchmark; it is not the default.

const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'was', 'were', 'will', 'your', 'about', '我', '你', '他', '她', '它', '的', '了', '是', '在', '和', '有', '就', '都', '而', '及', '与', '着', '或', '一个'])

/** Maximum number of distinct query terms kept after tokenization. */
export const MAX_QUERY_TERMS = 64

/** Weight of an exact phrase hit relative to a single token hit. */
export const PHRASE_MATCH_WEIGHT = 4

export type LexicalMatching = 'token' | 'substring'

const tokenPattern = /[\p{L}\p{N}]+/gu
const hanPattern = /\p{Script=Han}/u

export function normalizeRetrievalText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function containsHan(value: string): boolean {
  return hanPattern.test(value)
}

function hanBigramsOf(characters: readonly string[]): string[] {
  const pairs: string[] = []
  for (let index = 0; index < characters.length - 1; index += 1) {
    pairs.push(characters[index]! + characters[index + 1]!)
  }
  return pairs
}

export function retrievalTerms(value: string): string[] {
  const normalized = normalizeRetrievalText(value)
  const terms = new Set<string>()
  for (const token of normalized.match(tokenPattern) ?? []) {
    if (token.length > 1 && !stopWords.has(token)) terms.add(token)
    const characters = Array.from(token)
    if (characters.length >= 2 && containsHan(token)) {
      for (const pair of hanBigramsOf(characters)) {
        if (!stopWords.has(pair)) terms.add(pair)
      }
    }
  }
  return [...terms].slice(0, MAX_QUERY_TERMS)
}

export interface LexicalIndex {
  /** Every token in order, including stop words, used for phrase contiguity. */
  sequence: string[]
  /** Distinct content tokens: the matching unit for space-delimited text. */
  tokens: Set<string>
  /** Adjacent Han character pairs: the matching unit for Chinese text. */
  hanBigrams: Set<string>
  normalized: string
}

/**
 * Tokenizes a memory once. Callers that score the same text repeatedly should
 * build the index once and reuse it.
 */
export function buildLexicalIndex(text: string): LexicalIndex {
  const normalized = normalizeRetrievalText(text)
  const sequence: string[] = []
  const tokens = new Set<string>()
  const hanBigrams = new Set<string>()
  for (const token of normalized.match(tokenPattern) ?? []) {
    sequence.push(token)
    if (token.length > 1 && !stopWords.has(token)) tokens.add(token)
    const characters = Array.from(token)
    if (characters.length >= 2 && containsHan(token)) {
      for (const pair of hanBigramsOf(characters)) hanBigrams.add(pair)
    }
  }
  return { sequence, tokens, hanBigrams, normalized }
}

/** True when `needle` appears as a contiguous run inside `haystack`. */
function containsContiguous(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  const limit = haystack.length - needle.length
  for (let start = 0; start <= limit; start += 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) { matched = false; break }
    }
    if (matched) return true
  }
  return false
}

function termMatches(index: LexicalIndex, term: string): boolean {
  if (containsHan(term)) {
    // Han: every adjacent pair must be present. Terms shorter than two
    // characters are filtered out upstream, so there is always at least one
    // pair; the fallback keeps a degenerate single-character term exact.
    const pairs = hanBigramsOf(Array.from(term))
    if (pairs.length === 0) return index.tokens.has(term)
    return pairs.every((pair) => index.hanBigrams.has(pair))
  }
  return index.tokens.has(term)
}

/**
 * Phrase containment, per script run.
 *
 * A mixed query such as "咖啡 coffee" is split into a Han run and a Latin run;
 * each run is checked with the rule that fits it, and every run must match. A
 * phrase of punctuation or stop words alone does not count as a match.
 */
function phraseMatches(index: LexicalIndex, phrase: string): boolean {
  if (phrase.length < 2) return false
  const runs = phrase.match(/\p{Script=Han}+|[^\p{Script=Han}]+/gu) ?? []
  let checked = 0
  for (const run of runs) {
    if (containsHan(run)) {
      const pairs = hanBigramsOf(Array.from(run))
      // A lone Han character carries no adjacency information; skip it rather
      // than let it decide the phrase.
      if (pairs.length === 0) continue
      if (!pairs.every((pair) => index.hanBigrams.has(pair))) return false
      checked += 1
      continue
    }
    const needle = run.match(tokenPattern) ?? []
    if (needle.length === 0) continue
    if (!containsContiguous(index.sequence, needle)) return false
    checked += 1
  }
  return checked > 0
}

/**
 * Scores one memory against a query.
 *
 * `matching` exists so the frozen pre-fix benchmark can still be reproduced;
 * production always uses the default `token` mode.
 */
export function lexicalScoreWithIndex(
  index: LexicalIndex,
  queryTerms: readonly string[],
  phrase: string,
  matching: LexicalMatching = 'token'
): number {
  if (matching === 'substring') {
    const phraseMatch = phrase.length >= 2 && index.normalized.includes(phrase) ? PHRASE_MATCH_WEIGHT : 0
    const overlaps = queryTerms.reduce((count, term) => count + (index.normalized.includes(term) ? 1 : 0), 0)
    return phraseMatch + overlaps
  }
  const phraseMatch = phraseMatches(index, phrase) ? PHRASE_MATCH_WEIGHT : 0
  const overlaps = queryTerms.reduce((count, term) => count + (termMatches(index, term) ? 1 : 0), 0)
  return phraseMatch + overlaps
}

export function lexicalScore(
  content: string,
  queryTerms: readonly string[],
  phrase: string,
  matching: LexicalMatching = 'token'
): number {
  return lexicalScoreWithIndex(buildLexicalIndex(content), queryTerms, phrase, matching)
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
