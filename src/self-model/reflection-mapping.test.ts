/**
 * B5 mapping pipeline — the allowlist, in isolation.
 *
 * These tests exist because the pipeline's job is to *refuse*: an unmapped kind
 * must not quietly do something, a finding without live evidence must not become
 * an effect, and a personality proposal must never be applied. Each refusal has
 * a reason code so the audit trail can explain it.
 */
import { describe, expect, it } from 'vitest'
import { dedupeKeyOf, mapReflectionFinding, type EvidenceCheck } from './reflection-mapping'
import type { ReflectionFinding, ReflectionFindingKind } from './self-model-domain'

const ALL_VALID: EvidenceCheck = { isValid: () => true }
const ALL_INVALID: EvidenceCheck = { isValid: () => false }

function finding(kind: ReflectionFindingKind, evidence: Array<{ kind: string; id: string }> = [{ kind: 'event', id: 'e1' }], statement = 'x'): ReflectionFinding {
  return { id: 'f1', runId: 'r1', kind, statement, confidence: 50, evidence, createdAt: '2026-10-30T00:00:00.000Z' }
}

describe('reflection mapping allowlist', () => {
  it('maps each kind to exactly one effect', () => {
    expect(mapReflectionFinding(finding('memory_gap'), ALL_VALID)).toEqual({ effect: 'descriptive' })
    expect(mapReflectionFinding(finding('open_question'), ALL_VALID)).toEqual({ effect: 'descriptive' })
    expect(mapReflectionFinding(finding('consistency_note'), ALL_VALID)).toEqual({ effect: 'descriptive' })
    expect(mapReflectionFinding(finding('intent_correction'), ALL_VALID)).toEqual({ effect: 'intent_correction_candidate' })
    expect(mapReflectionFinding(finding('next_turn_suggestion'), ALL_VALID)).toEqual({ effect: 'bounded_suggestion' })
    expect(mapReflectionFinding(finding('interest_candidate', [{ kind: 'memory', id: 'm1' }]), ALL_VALID))
      .toEqual({ effect: 'interest_evidence', memoryId: 'm1' })
  })

  it('parks a personality proposal instead of applying it', () => {
    const withDimension = finding('bias_hint', [
      { kind: 'event', id: 'e1' },
      { kind: 'dimension', id: 'depth' }
    ])
    expect(mapReflectionFinding(withDimension, ALL_VALID)).toEqual({ effect: 'pending_personality', dimension: 'depth', direction: 'increase' })
    // A style hint that names no dimension cannot become a proposal: guessing one
    // is exactly the silent personality edit this pipeline prevents.
    expect(mapReflectionFinding(finding('bias_hint'), ALL_VALID)).toEqual({ effect: 'descriptive' })
  })

  it('rejects a finding with no stored evidence, even if it declares a dimension', () => {
    expect(mapReflectionFinding(finding('bias_hint', [{ kind: 'dimension', id: 'depth' }]), ALL_VALID))
      .toEqual({ effect: 'rejected', reason: 'no_evidence' })
    expect(mapReflectionFinding(finding('memory_gap', []), ALL_VALID))
      .toEqual({ effect: 'rejected', reason: 'no_evidence' })
  })

  it('rejects a finding whose evidence no longer resolves', () => {
    expect(mapReflectionFinding(finding('memory_gap'), ALL_INVALID)).toEqual({ effect: 'rejected', reason: 'evidence_invalid' })
    expect(mapReflectionFinding(finding('interest_candidate', [{ kind: 'memory', id: 'm1' }]), ALL_INVALID))
      .toEqual({ effect: 'rejected', reason: 'evidence_invalid' })
  })

  it('rejects an interest candidate that names no memory', () => {
    expect(mapReflectionFinding(finding('interest_candidate', [{ kind: 'event', id: 'e1' }]), ALL_VALID))
      .toEqual({ effect: 'rejected', reason: 'no_evidence' })
  })

  it('rejects an unknown kind rather than ignoring it', () => {
    const unknown = { ...finding('memory_gap'), kind: 'made_up' as ReflectionFindingKind }
    expect(mapReflectionFinding(unknown, ALL_VALID)).toEqual({ effect: 'rejected', reason: 'unmapped_kind' })
  })
})

describe('reflection dedupe key', () => {
  it('is stable across whitespace and evidence order, and differs across kinds', () => {
    const a = dedupeKeyOf({ kind: 'memory_gap', statement: '存在 2 次纠正', evidence: [{ kind: 'event', id: 'e1' }, { kind: 'event', id: 'e2' }] })
    const b = dedupeKeyOf({ kind: 'memory_gap', statement: '  存在 2 次纠正 ', evidence: [{ kind: 'event', id: 'e2' }, { kind: 'event', id: 'e1' }] })
    const c = dedupeKeyOf({ kind: 'open_question', statement: '存在 2 次纠正', evidence: [{ kind: 'event', id: 'e1' }, { kind: 'event', id: 'e2' }] })
    const d = dedupeKeyOf({ kind: 'memory_gap', statement: '存在 3 次纠正', evidence: [{ kind: 'event', id: 'e1' }] })
    // A concern is the statement, not the batch that happened to produce it.
    const reobserved = dedupeKeyOf({ kind: 'memory_gap', statement: '存在 2 次纠正', evidence: [{ kind: 'event', id: 'e9' }] })
    expect(a).toBe(b)
    expect(a).toBe(reobserved)
    expect(a).not.toBe(c)
    expect(a).not.toBe(d)
    expect(a).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('keeps evidence in the identity of kinds whose effect consumes it', () => {
    const first = dedupeKeyOf({ kind: 'interest_candidate', statement: '同一陈述', evidence: [{ kind: 'memory', id: 'm1' }] })
    const second = dedupeKeyOf({ kind: 'interest_candidate', statement: '同一陈述', evidence: [{ kind: 'memory', id: 'm2' }] })
    expect(first).not.toBe(second)
  })
})
