/**
 * Retrieval policy, Phase 2.
 *
 * The intent decides *whether* and *how narrowly* saved memories are searched;
 * the assembler still decides relevance, and the security layer still decides
 * permission. Keeping the three apart is the point: a policy can only narrow
 * the candidate set, it can never admit a record that the assembler or the
 * sensitivity ceiling would reject.
 *
 * Nothing here loosens a boundary:
 *   - `maximumSensitivity` is applied by the assembler, not by the policy
 *   - retracted / superseded records are excluded before scoring
 *   - a policy that restricts recall is allowed; none can widen it
 */
import type { IntentLabel } from '../cognition/intent-decision'
import type { FactPredicate } from './fact-slot'

export interface RetrievalPolicy {
  intent: IntentLabel
  /** Hard cap on delivered memories for this intent. */
  maxMemories: number
  /** Only records whose fact predicate is in this list may be delivered. */
  predicateFilter: readonly FactPredicate[] | null
  /** Require a shared content word; a predicate match alone is not enough. */
  requireContentOverlap: boolean
  /** Require a predicate match; lexical overlap alone is not enough. */
  requireSlotMatch: boolean
  /** Keep records that contradict the current statement (correction needs them). */
  admitConflictingEvidence: boolean
  reason: string
}

const DEFAULT_MAX = 25

const POLICIES: Readonly<Record<IntentLabel, Omit<RetrievalPolicy, 'intent'>>> = {
  information_query: {
    maxMemories: DEFAULT_MAX, predicateFilter: null, requireContentOverlap: false, requireSlotMatch: false,
    admitConflictingEvidence: true, reason: 'answer a question about the user from matching facts'
  },
  continuation: {
    maxMemories: DEFAULT_MAX, predicateFilter: null, requireContentOverlap: false, requireSlotMatch: false,
    admitConflictingEvidence: true, reason: 'resolve the reference first, then fetch what it points at'
  },
  correction: {
    // The old fact must be delivered, otherwise the model cannot acknowledge
    // the difference between what was stored and what the user now says.
    maxMemories: DEFAULT_MAX, predicateFilter: null, requireContentOverlap: false, requireSlotMatch: false,
    admitConflictingEvidence: true, reason: 'keep the corrected fact and the correction in view'
  },
  preference_expression: {
    // A stated preference may look up related history, but unrelated private
    // facts must not be dragged in, and it never becomes a personality trait.
    maxMemories: 10, predicateFilter: ['preference'], requireContentOverlap: true, requireSlotMatch: false,
    admitConflictingEvidence: true, reason: 'related preference history only'
  },
  emotion_expression: {
    // Emotional turns get continuity, not a memory dump.
    maxMemories: 3, predicateFilter: null, requireContentOverlap: true, requireSlotMatch: false,
    admitConflictingEvidence: false, reason: 'continuity only; no unrelated private memory'
  },
  goal_or_plan: {
    maxMemories: 10, predicateFilter: ['goal', 'schedule'], requireContentOverlap: false, requireSlotMatch: false,
    admitConflictingEvidence: true, reason: 'distinguish plans from completed facts'
  },
  new_topic: {
    maxMemories: 10, predicateFilter: null, requireContentOverlap: true, requireSlotMatch: false,
    admitConflictingEvidence: false, reason: 'new topic: nothing from the old topic is pulled in'
  },
  ambiguous: {
    maxMemories: 3, predicateFilter: null, requireContentOverlap: true, requireSlotMatch: false,
    admitConflictingEvidence: false, reason: 'too little context: stay with the recent thread'
  },
  self_fact: {
    // A statement, not a question: attach only what shares content, but allow a
    // contradicting entry so the conflict can be disclosed instead of hidden.
    maxMemories: 5, predicateFilter: null, requireContentOverlap: true, requireSlotMatch: false,
    admitConflictingEvidence: true, reason: 'a new self-statement may contradict a stored one'
  },
  explanation: {
    maxMemories: 3, predicateFilter: null, requireContentOverlap: true, requireSlotMatch: false,
    admitConflictingEvidence: false, reason: 'a general explanation rarely needs saved personal facts'
  },
  exploration: {
    maxMemories: 5, predicateFilter: null, requireContentOverlap: true, requireSlotMatch: false,
    admitConflictingEvidence: false, reason: 'exploration needs topic continuity, not private detail'
  },
  feedback: {
    maxMemories: 0, predicateFilter: null, requireContentOverlap: true, requireSlotMatch: false,
    admitConflictingEvidence: false, reason: 'feedback is about the interaction, not about stored facts'
  }
}

export function policyForIntent(intent: IntentLabel): RetrievalPolicy {
  const base = POLICIES[intent] ?? POLICIES.ambiguous
  return { intent, ...base }
}

/** The default used by callers that have no intent (explicit memory search). */
export function unrestrictedPolicy(): RetrievalPolicy {
  return { intent: 'information_query', ...POLICIES.information_query, reason: 'no intent available: relevance only' }
}
