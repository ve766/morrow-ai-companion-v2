/**
 * Topic identity for the long-term interest layer (Stage 2, B5 fix).
 *
 * The previous rule was "two or more shared extracted terms means the same
 * topic". It split one topic into several candidates whenever the wording
 * changed ("我最近在学咖啡拉花" vs "还在练咖啡拉花" share the entity but not the
 * verb), and each fragment then failed the promotion threshold on its own.
 *
 * This module replaces that single rule with a deterministic, auditable score
 * built from character/word n-grams. It uses no network, no embedding service
 * and no random seed: the same two texts always produce the same number, so a
 * decision can be reproduced from a stored profile.
 *
 * The score is **not** a calibrated probability. It is a heuristic similarity
 * in [0,1]; thresholds were picked on a hand-labelled development set and the
 * numbers are reported as development-set results, not as general accuracy.
 */
import { extractInterestTerms } from './self-model-domain'

export const TOPIC_IDENTITY_VERSION = 'topic-identity-v1'

/**
 * Decisions are three-way on purpose. A score in the ambiguous band must not be
 * silently resolved: merging is irreversible (evidence from two topics would be
 * added together), so the conservative behaviour is to keep both candidates and
 * let more evidence decide.
 */
export type TopicDecision = 'same' | 'ambiguous' | 'different'

/**
 * At or above this, two texts are the same topic.
 *
 * Picked on the labelled development set (23 pairs) as the highest threshold
 * that still reaches recall >= 0.8 with zero false merges; see
 * `evals/stage-2/topic-identity-devset.json` and the report script. It is a
 * development-set choice, not a calibrated cut-off.
 */
export const TOPIC_SAME_THRESHOLD = 0.45
/** From this up to SAME, the pair is too close to call; keep both candidates. */
export const TOPIC_AMBIGUOUS_THRESHOLD = 0.35

export interface TopicProfile {
  /** Character-level units: Han characters and latin words. */
  unigrams: string[]
  /** Adjacent units: Han bigrams and latin word pairs. */
  bigrams: string[]
  /** Bigrams/words that carry content (no stop character touches them). */
  preferred: string[]
  /** True when the text contains a negation marker. */
  negated: boolean
  /**
   * Normalized text used only to measure the longest shared run. It is the
   * user's own wording with punctuation removed, so it is capped and never
   * logged; without it a shared 3+ character subject could not be told apart
   * from a shared filler phrase.
   */
  text?: string
}

export interface TopicSignals {
  bigramJaccard: number
  unigramJaccard: number
  preferredContainment: number
  sharedPreferred: number
  /** Length of the longest identical Han-character or latin-word run. */
  sharedRun: number
  polarityConflict: boolean
  /**
   * True when each text ends with content the other never mentions
   * ("我喜欢猫" / "我喜欢狗", "learning guitar" / "learning piano"). String
   * similarity is high in exactly these cases, so this is the signal that stops
   * a shared frame from being mistaken for a shared subject.
   */
  objectSubstitution: boolean
}

export interface TopicMatch {
  score: number
  decision: TopicDecision
  /** Stable code for audits: same_topic / ambiguous_overlap / polarity_conflict / ... */
  reason: string
  signals: TopicSignals
}

const MAX_UNIGRAMS = 64
const MAX_BIGRAMS = 96
const MAX_PREFERRED = 48
const MAX_TEXT = 240

// Same stop characters the term extractor already uses. Kept local so the two
// can diverge without one silently changing the meaning of the other.
const STOP_CHARACTERS = new Set(['我', '的', '了', '着', '很', '真', '在', '是', '有', '和', '就', '都', '也', '不', '这', '那', '你', '他', '她', '它', '吧', '呢', '吗', '啊', '想', '下', '对', '又', '还', '再', '上', '中', '得', '过', '会', '要'])

// Negation is meaning-changing, so it must survive normalization. These are
// matched on the normalized text; the list is deliberately short and literal
// instead of clever, because a wrong negation flag causes false "different".
const NEGATION_MARKERS = ['不', '没', '别', '未', '无', '非', 'not', 'never', "n't", 'dislike', 'hate']

// Words that contain a negation character without negating anything. They are
// removed before scanning: "特别着迷" is enthusiastic, not a reversal, and a
// false negation would silently discard a genuine interest observation.
const NON_NEGATING_WORDS = [
  '特别', '别的', '别人', '分别', '告别', '区别', '级别', '类别', '个别', '道别', '识别',
  '不错', '没错', '没问题', '没关系', '无论', '非常', '未来', '无线', '无数'
]

export function normalizeTopicText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u3000-\u303f\uff00-\uff5e]/gu, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function detectNegation(text: string): boolean {
  let normalized = normalizeTopicText(text)
  for (const word of NON_NEGATING_WORDS) {
    if (normalized.includes(word)) normalized = normalized.split(word).join(' ')
  }
  return NEGATION_MARKERS.some((marker) => normalized.includes(marker))
}

function uniqueCapped(values: Iterable<string>, cap: number): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    output.push(value)
    if (output.length >= cap) break
  }
  return output
}

/**
 * Builds the stored, comparable representation of one text.
 *
 * Latin text is tokenized into words (so "latte art" and "art latte" share
 * units) and Han text into characters plus adjacent bigrams. Everything is
 * derived from the normalized string, so punctuation and spacing differences
 * cannot change the profile.
 */
export function buildTopicProfile(text: string): TopicProfile {
  const normalized = normalizeTopicText(text)
  const unigrams: string[] = []
  const bigrams: string[] = []

  // Han characters are the unit; latin is represented by words below, never by
  // individual letters (single letters made every English pair look similar).
  for (const character of Array.from(normalized.replace(/\s+/gu, ''))) {
    if (/\p{Script=Han}/u.test(character)) unigrams.push(character)
  }

  for (const run of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    const characters = Array.from(run)
    for (let index = 0; index < characters.length - 1; index += 1) {
      bigrams.push(characters[index]! + characters[index + 1]!)
    }
  }

  const words = (normalized.match(/[a-z][a-z0-9'-]*/gu) ?? []).filter((word) => word.length >= 2)
  unigrams.push(...words)
  for (let index = 0; index < words.length - 1; index += 1) {
    bigrams.push(`${words[index]!} ${words[index + 1]!}`)
  }
  // A single latin word must still be comparable to a longer phrase.
  if (words.length === 1) bigrams.push(words[0]!)

  // `extractInterestTerms` is the pre-existing deterministic extractor; reusing
  // it keeps the label and the match profile consistent with each other.
  // Only its *content* units are kept: the extractor also returns filler
  // bigrams as a fallback, and those diluted containment enough to make two
  // phrasings of one topic look unrelated.
  const legacyTerms = extractInterestTerms(text)
  const preferred = uniqueCapped(
    [
      ...bigrams.filter((unit) => !Array.from(unit).some((character) => STOP_CHARACTERS.has(character))),
      ...words.filter((word) => word.length >= 3),
      ...legacyTerms.filter((unit) => !Array.from(unit).some((character) => STOP_CHARACTERS.has(character)))
    ],
    MAX_PREFERRED
  )

  return {
    unigrams: uniqueCapped(unigrams, MAX_UNIGRAMS),
    bigrams: uniqueCapped(bigrams, MAX_BIGRAMS),
    preferred,
    negated: detectNegation(text),
    text: normalized.slice(0, MAX_TEXT)
  }
}

/** Union used when an observation joins an existing interest. */
export function mergeTopicProfiles(left: TopicProfile, right: TopicProfile): TopicProfile {
  return {
    unigrams: uniqueCapped([...left.unigrams, ...right.unigrams], MAX_UNIGRAMS),
    bigrams: uniqueCapped([...left.bigrams, ...right.bigrams], MAX_BIGRAMS),
    preferred: uniqueCapped([...left.preferred, ...right.preferred], MAX_PREFERRED),
    negated: left.negated && right.negated,
    text: (left.text ?? '').slice(0, MAX_TEXT)
  }
}

function intersectionSize(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right)
  let shared = 0
  for (const value of new Set(left)) if (rightSet.has(value)) shared += 1
  return shared
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size === 0 || rightSet.size === 0) return 0
  let shared = 0
  for (const value of leftSet) if (rightSet.has(value)) shared += 1
  return shared / (leftSet.size + rightSet.size - shared)
}

/**
 * Share of the smaller content set that the other set also contains.
 *
 * Containment (not Jaccard) is what makes short follow-ups work: "还在练咖啡
 * 拉花" carries fewer units than "我最近在学咖啡拉花", so Jaccard stays low even
 * though every content unit of the short turn is present in the long one.
 */
function containment(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const smaller = leftSet.size <= rightSet.size ? leftSet : rightSet
  if (smaller.size === 0) return 0
  let shared = 0
  for (const value of smaller) if (leftSet.has(value) && rightSet.has(value)) shared += 1
  return shared / smaller.size
}

/**
 * A frame with one substituted slot ("我喜欢猫" / "我喜欢狗", "learning guitar" /
 * "learning piano"). String similarity is highest exactly here, so this is the
 * signal that stops a shared template from being read as a shared subject.
 *
 * It is computed from the unit sets rather than the texts: a single substituted
 * slot leaves the symmetric difference tiny while Jaccard stays below 1.
 */
function isSlotSubstitution(left: TopicProfile, right: TopicProfile, unigramJaccard: number): boolean {
  const leftSet = new Set(left.unigrams)
  const rightSet = new Set(right.unigrams)
  if (leftSet.size < 3 || rightSet.size < 3) return false
  let differing = 0
  for (const value of leftSet) if (!rightSet.has(value)) differing += 1
  for (const value of rightSet) if (!leftSet.has(value)) differing += 1
  return differing <= 2 && unigramJaccard >= 0.5 && unigramJaccard < 1
}

/** Longest run of identical characters (Han only) shared by two strings. */
function longestHanRun(left: string, right: string): number {
  const a = Array.from(left.replace(/[^\p{Script=Han}]/gu, ''))
  const b = Array.from(right.replace(/[^\p{Script=Han}]/gu, ''))
  if (a.length === 0 || b.length === 0) return 0
  let best = 0
  let previous = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1]! + 1
        if (current[j]! > best) best = current[j]!
      }
    }
    previous = current
  }
  return best
}

/** Longest run of identical words shared by two latin token lists. */
function longestWordRun(left: string, right: string): number {
  const a = normalizeTopicText(left).match(/[a-z][a-z0-9'-]*/gu) ?? []
  const b = normalizeTopicText(right).match(/[a-z][a-z0-9'-]*/gu) ?? []
  if (a.length === 0 || b.length === 0) return 0
  let best = 0
  let previous = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1]! + 1
        if (current[j]! > best) best = current[j]!
      }
    }
    previous = current
  }
  return best
}

export function scoreTopicProfiles(left: TopicProfile, right: TopicProfile): TopicMatch {
  const bigramJaccard = jaccard(left.bigrams, right.bigrams)
  const unigramJaccard = jaccard(left.unigrams, right.unigrams)
  const preferredContainment = containment(left.preferred, right.preferred)
  const sharedPreferred = intersectionSize(left.preferred, right.preferred)

  // The strongest single signal is "how much of the smaller content set is
  // present in the other", so it carries the largest weight. The two Jaccard
  // terms keep a shared one-word overlap from looking like a full match.
  // A long shared run is the strongest lexical evidence there is: three or
  // more identical Han characters ("天文学") or two or more identical latin
  // words ("latte art") almost always means one subject. Shorter overlaps
  // ("咖啡", "i love") stay unboosted, which is what keeps a shared category or
  // a shared template from being read as a shared topic.
  const hanRun = left.text && right.text ? longestHanRun(left.text, right.text) : 0
  const wordRun = left.text && right.text ? longestWordRun(left.text, right.text) : 0
  const runBonus = Math.max(
    hanRun >= 4 || wordRun >= 3 ? 0.3 : 0,
    hanRun === 3 || wordRun === 2 ? 0.2 : 0
  )

  const raw = 0.3 * bigramJaccard +
    0.1 * unigramJaccard +
    0.45 * preferredContainment +
    (sharedPreferred >= 2 ? 0.15 : 0) +
    runBonus

  const score = Math.round(Math.min(1, Math.max(0, raw)) * 10000) / 10000
  const signals: TopicSignals = {
    bigramJaccard: Math.round(bigramJaccard * 10000) / 10000,
    unigramJaccard: Math.round(unigramJaccard * 10000) / 10000,
    preferredContainment: Math.round(preferredContainment * 10000) / 10000,
    sharedPreferred,
    sharedRun: Math.max(hanRun, wordRun),
    polarityConflict: left.negated !== right.negated,
    objectSubstitution: isSlotSubstitution(left, right, unigramJaccard)
  }

  // A hypernym ("咖啡") is not evidence for a specific interest ("咖啡拉花").
  // Merging them would let a vague mention feed a specific topic's evidence, so
  // this is a hard "different" regardless of how high containment looks.
  const smallerSize = Math.min(left.preferred.length, right.preferred.length)
  const largerSize = Math.max(left.preferred.length, right.preferred.length)
  if (smallerSize > 0 && smallerSize <= 1 && largerSize >= 2) {
    return { score, decision: 'different', reason: 'hypernym_or_too_short', signals }
  }
  if (smallerSize === 0) {
    return { score, decision: 'different', reason: 'no_topic_content', signals }
  }

  // Opposite polarity is a reversal, not corroboration. The score is still
  // reported so the caller can attach a counter-observation to the same topic.
  if (signals.polarityConflict && score >= TOPIC_AMBIGUOUS_THRESHOLD) {
    return { score, decision: 'different', reason: 'polarity_conflict', signals }
  }

  // A shared frame with a substituted subject is the one case where high string
  // similarity is actively misleading. It is downgraded to 'ambiguous' rather
  // than 'different' because the caller may still want to ask, but it must
  // never merge evidence.
  if (signals.objectSubstitution && score >= TOPIC_AMBIGUOUS_THRESHOLD) {
    return { score, decision: 'ambiguous', reason: 'object_substitution_suspected', signals }
  }

  if (score >= TOPIC_SAME_THRESHOLD) return { score, decision: 'same', reason: 'same_topic', signals }
  if (score >= TOPIC_AMBIGUOUS_THRESHOLD) return { score, decision: 'ambiguous', reason: 'ambiguous_overlap', signals }
  return { score, decision: 'different', reason: 'below_threshold', signals }
}

/**
 * The most specific contiguous content phrase in a profile.
 *
 * Used as the human-visible interest label. The previous rule took the first
 * content bigram, which produced labels like "最近" for "我最近在学咖啡拉花" and
 * made two different topics collide on the unique label index. Overlapping
 * adjacent bigrams are merged back into the phrase they came from.
 */
export function longestContentPhrase(profile: TopicProfile): string | null {
  const han = profile.preferred.filter((unit) => /^[\p{Script=Han}]{2}$/u.test(unit))
  let best = ''
  let current = ''
  for (const unit of han) {
    if (!current) {
      current = unit
      continue
    }
    if (current.endsWith(unit[0]!)) current += unit.slice(1)
    else {
      if (current.length > best.length) best = current
      current = unit
    }
  }
  if (current.length > best.length) best = current
  return best.length >= 2 ? best : (han[0] ?? null)
}

export function matchTopicTexts(left: string, right: string): TopicMatch {
  return scoreTopicProfiles(buildTopicProfile(left), buildTopicProfile(right))
}

/** Defensive reader for profiles persisted by an older build. */
export function parseTopicProfile(value: unknown): TopicProfile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const strings = (input: unknown): string[] | null =>
    Array.isArray(input) && input.every((item) => typeof item === 'string') ? (input as string[]) : null
  const unigrams = strings(record.unigrams)
  const bigrams = strings(record.bigrams)
  const preferred = strings(record.preferred)
  if (!unigrams || !bigrams || !preferred) return null
  return {
    unigrams,
    bigrams,
    preferred,
    negated: record.negated === true,
    ...(typeof record.text === 'string' ? { text: record.text.slice(0, MAX_TEXT) } : {})
  }
}
