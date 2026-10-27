import test from "node:test";
import assert from "node:assert/strict";
import {
  detectFactConflict,
  fuseRelevanceScores,
  metacognitiveCheck,
  selectContextUnderBudget,
  temporalDecay,
  updateAffectiveState,
  updateEvidenceConfidence,
  updatePersonalityState
} from "../src/cognitive-v2.js";

test("confidence update deduplicates one source and clips at one", () => {
  const result = updateEvidenceConfidence({
    prior: 0.5,
    alpha: 1,
    beta: 0,
    gamma: 0,
    supportingEvidence: [
      { id: "msg-1", strength: 0.9 },
      { id: "msg-1", strength: 0.4 },
      { id: "msg-2", strength: 0.8 }
    ]
  });
  assert.ok(Math.abs(result.components.E - 1.7) < 1e-9);
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.acceptedEvidenceIds, ["msg-1", "msg-2"]);
  assert.equal(result.duplicates.supporting, 1);
  assert.equal(result.isCalibratedProbability, false);
});

test("counter evidence and source uncertainty lower confidence without going below zero", () => {
  const result = updateEvidenceConfidence({
    prior: 0.2,
    alpha: 0.2,
    beta: 0.5,
    gamma: 0.5,
    supportingEvidence: [],
    counterEvidence: [{ id: "counter-1", strength: 0.8 }],
    sourceUncertainty: 1
  });
  assert.equal(result.confidence, 0);
  assert.ok(result.delta < 0);
});

test("semantic absence is omitted and weights are renormalized", () => {
  const result = fuseRelevanceScores({
    lexical: 1,
    phrase: 1,
    semantic: null,
    context: 0,
    temporal: 1
  }, { threshold: 0.5 });
  assert.deepEqual(result.missingSignals, ["semantic"]);
  assert.equal(result.components.semantic, undefined);
  assert.equal(result.eligible, true);
  const normalizedWeightTotal = Object.values(result.normalizedWeights).reduce((sum, item) => sum + item, 0);
  const contribution = Object.values(result.components).reduce((sum, item) => sum + item.contribution, 0);
  assert.ok(Math.abs(normalizedWeightTotal - 1) < 1e-9);
  assert.ok(Math.abs(contribution - result.score) < 1e-9);
});

test("missing semantic score is not reported as zero similarity", () => {
  const result = fuseRelevanceScores({ lexical: 0, phrase: 0, semantic: undefined, context: 0, temporal: 0 });
  assert.equal(result.score, 0);
  assert.equal(result.reason, "below_threshold");
  assert.ok(result.missingSignals.includes("semantic"));
});

test("hard eligibility cannot be overridden by a high score", () => {
  const result = fuseRelevanceScores({ lexical: 1, phrase: 1, semantic: 1, context: 1, temporal: 1 }, { eligible: false });
  assert.equal(result.score, 1);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "hard_gate_failed");
});

test("same subject and attribute with incompatible simultaneous values is a conflict", () => {
  const result = detectFactConflict(
    { id: "new", subject: "user", attribute: "residence", value: "大阪", validFrom: "2026-01-01" },
    { id: "old", subject: "user", attribute: "residence", value: "杭州", validFrom: "2025-01-01" }
  );
  assert.equal(result.conflict, true);
  assert.equal(result.autoSelectWinner, false);
});

test("different attributes or non-overlapping ranges are not conflicts", () => {
  const attribute = detectFactConflict(
    { subject: "user", attribute: "residence", value: "大阪" },
    { subject: "user", attribute: "favorite_food", value: "寿司" }
  );
  assert.equal(attribute.conflict, false);
  const temporal = detectFactConflict(
    { subject: "user", attribute: "residence", value: "大阪", validFrom: "2026-01-01" },
    { subject: "user", attribute: "residence", value: "杭州", validFrom: "2025-01-01", validTo: "2025-12-31" }
  );
  assert.equal(temporal.conflict, false);
  assert.equal(temporal.classification, "temporal_update");
});

test("temporal decay is category-specific and retraction is a hard exclusion", () => {
  const stable = temporalDecay({ category: "identity", ageDays: 365 });
  const temporary = temporalDecay({ category: "temporary", ageDays: 365 });
  assert.ok(stable.decay > temporary.decay);
  const retracted = temporalDecay({ category: "preference", ageDays: 0, status: "retracted" });
  assert.equal(retracted.eligible, false);
  assert.equal(retracted.decay, 0);
});

test("budget selection is exact, deterministic and respects hard gates", () => {
  const items = [
    { id: "a", utility: 6, cost: 4, eligible: true },
    { id: "b", utility: 5, cost: 3, eligible: true },
    { id: "secret", utility: 100, cost: 1, eligible: false }
  ];
  const first = selectContextUnderBudget(items, 6);
  const second = selectContextUnderBudget(items, 6);
  assert.deepEqual(first.selected.map((item) => item.id), ["a"]);
  assert.equal(first.exactUtility, 6);
  assert.equal(first.greedyUtility, 5);
  assert.ok(first.approximationGap > 0);
  assert.equal(first.withinBudget, true);
  assert.deepEqual(second.selected.map((item) => item.id), ["a"]);
  assert.ok(first.omitted.some((item) => item.id === "secret" && item.reason === "hard_gate_failed"));
});

test("an impossible budget returns an empty context rather than stripping metadata", () => {
  const result = selectContextUnderBudget([{ id: "a", utility: 1, cost: 5, eligible: true }], 4);
  assert.deepEqual(result.selected, []);
  assert.equal(result.exactUtility, 0);
  assert.equal(result.withinBudget, true);
});

test("metacognitive check answers only supported, non-conflicting claims", () => {
  const result = metacognitiveCheck({
    questionNeedsEvidence: true,
    evidenceIds: ["m1"],
    claims: [{ id: "c1", subject: "user", evidenceSubject: "user", evidenceId: "m1", status: "fact" }]
  });
  assert.equal(result.decision, "answer");
  assert.equal(result.usedModelSelfEvaluation, false);
});

test("metacognitive check abstains on no evidence and asks on conflict", () => {
  assert.equal(metacognitiveCheck({ questionNeedsEvidence: true, evidenceIds: [] }).decision, "abstain");
  assert.equal(metacognitiveCheck({
    questionNeedsEvidence: true,
    evidenceIds: ["m1"],
    unresolvedConflict: true,
    claims: [{ id: "c1", subject: "user", evidenceId: "m1", status: "fact" }]
  }).decision, "clarify");
});

test("metacognitive check catches inference-as-fact and subject mismatch", () => {
  const result = metacognitiveCheck({
    evidenceIds: ["m1"],
    claims: [
      { id: "c1", subject: "user", evidenceId: "m1", status: "fact", inferred: true },
      { id: "c2", subject: "assistant", evidenceSubject: "user", evidenceId: "m1", status: "fact" }
    ]
  });
  assert.equal(result.answerAllowed, false);
  assert.ok(result.reasons.includes("inference_as_fact:c1"));
  assert.ok(result.reasons.includes("subject_mismatch:c2"));
});

test("metacognitive check rejects context-only and retired evidence", () => {
  assert.equal(metacognitiveCheck({
    evidenceIds: ["ctx"],
    contextOnlyIds: ["ctx"],
    claims: [{ id: "c1", subject: "user", evidenceId: "ctx", status: "fact", usedAsAnswer: true }]
  }).decision, "abstain");
  assert.equal(metacognitiveCheck({
    evidenceIds: ["old"],
    retiredIds: ["old"],
    claims: [{ id: "c1", subject: "user", evidenceId: "old", status: "fact" }]
  }).decision, "abstain");
});

test("personality update is bounded and ignores factual corrections", () => {
  const result = updatePersonalityState(
    { warmth: 50, directness: 50 },
    [
      { id: "p1", kind: "preference", subject: "user", dimension: "warmth", direction: 1 },
      { id: "f1", kind: "fact", subject: "user", dimension: "directness", direction: -1 }
    ],
    { eta: 0.5, maxDeltaPerTurn: 0.1, min: 0, max: 100 }
  );
  assert.equal(result.state.warmth, 60);
  assert.equal(result.state.directness, 50);
  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.changes[0].evidenceIds, ["p1"]);
});

test("personality update deduplicates the same evidence id", () => {
  const result = updatePersonalityState(
    { warmth: 50 },
    [
      { id: "same", kind: "preference", subject: "user", dimension: "warmth", direction: 1 },
      { id: "same", kind: "preference", subject: "user", dimension: "warmth", direction: 1 }
    ],
    { eta: 1, maxDeltaPerTurn: 0.5, min: 0, max: 100 }
  );
  assert.equal(result.state.warmth, 100);
  assert.deepEqual(result.acceptedObservationIds, ["same"]);
});

test("affective state is bounded and explicitly not subjective experience", () => {
  const result = updateAffectiveState(
    { novelty: 0.5, goalProgress: 0.5, uncertainty: 0.5, conflict: 0.5, interest: 0.5, exploration: 0.5 },
    { novelty: 1, goalProgress: 0, uncertainty: 1, conflict: 0, interest: 1, exploration: 1 },
    { rho: 0.8, eta: 0.2 }
  );
  for (const value of Object.values(result.state)) assert.ok(value >= 0 && value <= 1);
  assert.equal(result.claimsSubjectiveExperience, false);
  assert.equal(result.representation, "computed_state_vector");
});

test("affective state decays toward a neutral target without external events", () => {
  const result = updateAffectiveState({ novelty: 1 }, {}, { rho: 0.5, eta: 0 });
  assert.equal(result.state.novelty, 0.5);
  assert.equal(result.changes[0].target, 1);
});
