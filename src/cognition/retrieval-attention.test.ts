import { describe, expect, it } from 'vitest'
import { adjustPolicyForState, EXPLORATION_WIDEN_ENTRIES, WIDENED_MAX_CEILING } from './retrieval-attention'
import { policyForIntent, unrestrictedPolicy } from '../memory/retrieval-policy'
import { createDefaultFeelingState } from '../affective-state/feeling'

function stateWithPriority(priority: number) {
  const base = createDefaultFeelingState('2026-01-01T00:00:00.000Z')
  return { ...base, attention: { ...base.attention, explorationPriority: priority } }
}

describe('state -> retrieval adjustment', () => {
  it('leaves the intent cap alone while exploration attention is below the threshold', () => {
    const policy = policyForIntent('exploration')
    const result = adjustPolicyForState(policy, stateWithPriority(0.07))
    expect(result.effectiveMax).toBe(policy.maxMemories)
    expect(result.adjustment).toBeNull()
    expect(result.policy).toBe(policy)
  })

  it('widens the cap by a bounded amount once attention crosses the threshold', () => {
    const policy = policyForIntent('exploration')
    const result = adjustPolicyForState(policy, stateWithPriority(0.09))
    expect(result.baseMax).toBe(policy.maxMemories)
    expect(result.effectiveMax).toBe(policy.maxMemories + EXPLORATION_WIDEN_ENTRIES)
    expect(result.adjustment).toBe('exploration_widened')
  })

  it('never widens past the absolute ceiling', () => {
    const policy = unrestrictedPolicy()
    const result = adjustPolicyForState(policy, stateWithPriority(1))
    expect(result.effectiveMax).toBe(WIDENED_MAX_CEILING)
  })

  it('never turns "recall nothing" into "recall something"', () => {
    // feedback is the one policy that admits no stored fact at all; the state
    // must not be able to override that.
    const policy = policyForIntent('feedback')
    expect(policy.maxMemories).toBe(0)
    const result = adjustPolicyForState(policy, stateWithPriority(1))
    expect(result.effectiveMax).toBe(0)
    expect(result.adjustment).toBeNull()
  })

  it('never touches the filters, the predicate restriction or the reason chain', () => {
    const policy = policyForIntent('preference_expression')
    const result = adjustPolicyForState(policy, stateWithPriority(0.9))
    expect(result.policy.predicateFilter).toEqual(policy.predicateFilter)
    expect(result.policy.requireContentOverlap).toBe(policy.requireContentOverlap)
    expect(result.policy.requireSlotMatch).toBe(policy.requireSlotMatch)
    expect(result.policy.admitConflictingEvidence).toBe(policy.admitConflictingEvidence)
    expect(result.policy.maxMemories).toBeGreaterThanOrEqual(policy.maxMemories)
  })

  it('treats a missing state as no adjustment', () => {
    const policy = policyForIntent('information_query')
    expect(adjustPolicyForState(policy, null).adjustment).toBeNull()
    expect(adjustPolicyForState(policy, undefined).adjustment).toBeNull()
  })
})
