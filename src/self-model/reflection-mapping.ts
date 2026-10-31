/**
 * Reflection findings → typed effects (B5).
 *
 * Reflection used to write findings and then apply one hard-coded effect inline.
 * That made two things impossible to audit: which finding kinds are allowed to
 * change anything, and whether a re-run double-counts. This module makes the
 * mapping explicit and total:
 *
 *   ReflectionFinding → evidence validation → allowlist mapping → gate → effect
 *
 * Rules:
 *   - every finding needs at least one evidence reference, and every reference
 *     must still be valid (an existing, non-retracted memory; a recorded event; a
 *     live self-model entry);
 *   - only the kinds listed below may have an effect, and each has exactly one;
 *   - a personality proposal never moves the baseline. It becomes a *pending*
 *     candidate with its evidence, confidence and expiry, and only a user
 *     confirmation may consume it;
 *   - anything unmapped is rejected with an audit reason rather than ignored.
 */
import { createHash } from 'node:crypto'
import type { ReflectionFinding, ReflectionFindingKind } from './self-model-domain'

export const PERSONALITY_DIMENSIONS = ['exploration', 'depth', 'pace'] as const
export type PersonalityDimension = typeof PERSONALITY_DIMENSIONS[number]

export type ReflectionRejectReason =
  | 'unmapped_kind'
  | 'no_evidence'
  | 'evidence_invalid'
  | 'ambiguous_personality_dimension'

export type ReflectionEffect =
  /** Recorded for the shell and the audit trail; changes nothing. */
  | { effect: 'descriptive' }
  /** Adds one interest-evidence row, which the promotion gate then judges. */
  | { effect: 'interest_evidence'; memoryId: string }
  /**
   * Adds one observation per cited knowledge gap to a topic Morrow owns.
   *
   * The topic and the event ids travel in the finding's evidence because the
   * effect layer must not re-derive them from prose. One observation per event
   * — not one per finding — is what lets two gaps in two conversations count as
   * two independent supports instead of collapsing into one.
   */
  | { effect: 'morrow_interest'; topic: string; conversationId: string; evidenceEventIds: string[] }
  /** A candidate correction of the assistant's reading; never overrides the user. */
  | { effect: 'intent_correction_candidate' }
  /** A bounded suggestion for the next turn; never executes anything. */
  | { effect: 'bounded_suggestion' }
  /** Parks a personality proposal; the baseline is untouched. */
  | { effect: 'pending_personality'; dimension: PersonalityDimension; direction: 'increase' | 'decrease' }
  | { effect: 'rejected'; reason: ReflectionRejectReason }

/** Evidence refs whose target no longer exists or is no longer usable. */
export interface EvidenceCheck {
  isValid(ref: { kind: string; id: string }): boolean
}

const DESCRIPTIVE_KINDS: ReadonlySet<ReflectionFindingKind> = new Set<ReflectionFindingKind>([
  'memory_gap',
  'open_question',
  'consistency_note'
])

/**
 * Identity of a finding: kind + normalised statement + the evidence set.
 * Sorted refs make the key order-insensitive; the statement is normalised so a
 * whitespace change does not create a second finding.
 */
export function dedupeKeyOf(finding: Pick<ReflectionFinding, 'kind' | 'statement' | 'evidence'>): string {
  const statement = finding.statement.normalize('NFKC').replaceAll(/\s+/gu, ' ').trim().toLowerCase()
  const refs = finding.evidence.map((ref) => `${ref.kind}:${ref.id}`).sort().join(',')
  return createHash('sha256').update(`${finding.kind}|${statement}|${refs}`).digest('hex')
}

function personalityDimensionOf(finding: ReflectionFinding): PersonalityDimension | null {
  const declared = finding.evidence.find((ref) => ref.kind === 'dimension')
  if (!declared) return null
  return (PERSONALITY_DIMENSIONS as readonly string[]).includes(declared.id)
    ? declared.id as PersonalityDimension
    : null
}

export function mapReflectionFinding(finding: ReflectionFinding, check: EvidenceCheck): ReflectionEffect {
  if (finding.evidence.length === 0) return { effect: 'rejected', reason: 'no_evidence' }
  // A `dimension` ref is structural, not a stored source; everything else must
  // still resolve to a live record.
  // `topic` and `conversation` are structural carriers, like `dimension`: they
  // name where the claim belongs, they are not records that can be retracted.
  const stored = finding.evidence.filter((ref) => ref.kind !== 'dimension' && ref.kind !== 'topic' && ref.kind !== 'conversation')
  if (stored.length === 0) return { effect: 'rejected', reason: 'no_evidence' }
  if (!stored.every((ref) => check.isValid(ref))) return { effect: 'rejected', reason: 'evidence_invalid' }

  if (DESCRIPTIVE_KINDS.has(finding.kind)) return { effect: 'descriptive' }

  switch (finding.kind) {
    case 'interest_candidate': {
      const memory = finding.evidence.find((ref) => ref.kind === 'memory')
      // An interest candidate is only meaningful with the memory it came from.
      return memory ? { effect: 'interest_evidence', memoryId: memory.id } : { effect: 'rejected', reason: 'no_evidence' }
    }
    case 'morrow_interest_candidate': {
      const topic = finding.evidence.find((ref) => ref.kind === 'topic')
      const conversation = finding.evidence.find((ref) => ref.kind === 'conversation')
      const evidenceEventIds = finding.evidence.filter((ref) => ref.kind === 'event').map((ref) => ref.id)
      if (!topic) return { effect: 'rejected', reason: 'no_evidence' }
      // A conversation ref is no longer required: the gap ledger knows which
      // conversation each cited event belongs to. It is still accepted when a
      // producer supplies one, and used as the fallback.
      if (!conversation && evidenceEventIds.length === 0) return { effect: 'rejected', reason: 'no_evidence' }
      return {
        effect: 'morrow_interest',
        topic: topic.id,
        conversationId: conversation?.id ?? '',
        evidenceEventIds
      }
    }
    case 'intent_correction':
      return { effect: 'intent_correction_candidate' }
    case 'next_turn_suggestion':
      return { effect: 'bounded_suggestion' }
    case 'bias_hint': {
      const dimension = personalityDimensionOf(finding)
      // A style hint that names no dimension cannot become a proposal; guessing
      // one would be the silent personality edit this pipeline exists to prevent.
      if (!dimension) return { effect: 'descriptive' }
      return { effect: 'pending_personality', dimension, direction: 'increase' }
    }
    default:
      return { effect: 'rejected', reason: 'unmapped_kind' }
  }
}
