/**
 * Cognitive Update Pack v0.2 candidate operators.
 *
 * This module is deliberately standalone: it imports neither Morrow's runtime
 * nor persistence. All state is caller-supplied plain data. These functions are
 * research references, not evidence of product quality.
 */

function clip(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function normalized(text) {
  return String(text ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function uniqueById(items) {
  const byId = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = typeof item?.id === "string" ? item.id : null;
    if (!id) continue;
    const previous = byId.get(id);
    const strength = clip(finite(item.strength, 0), 0, 1);
    if (!previous || strength > previous.strength) byId.set(id, { ...item, strength });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * C_new = clip(C_old + alpha*E - beta*K - gamma*U, 0, 1)
 *
 * Repeated observations from one source are one piece of evidence. Evidence is
 * deduplicated by source id, so repeating a sentence cannot inflate confidence.
 */
export function updateEvidenceConfidence(input = {}) {
  const prior = clip(finite(input.prior, 0.5), 0, 1);
  const alpha = Math.max(0, finite(input.alpha, 0.2));
  const beta = Math.max(0, finite(input.beta, 0.25));
  const gamma = Math.max(0, finite(input.gamma, 0.15));
  const evidence = uniqueById(input.supportingEvidence);
  const counter = uniqueById(input.counterEvidence);
  const duplicates = {
    supporting: Math.max(0, (input.supportingEvidence?.length ?? 0) - evidence.length),
    counter: Math.max(0, (input.counterEvidence?.length ?? 0) - counter.length)
  };
  const E = evidence.reduce((sum, item) => sum + item.strength, 0);
  const K = counter.reduce((sum, item) => sum + item.strength, 0);
  const U = clip(finite(input.sourceUncertainty, 0), 0, 1);
  const confidence = clip(prior + alpha * E - beta * K - gamma * U, 0, 1);
  return {
    confidence,
    delta: confidence - prior,
    components: { prior, E, K, U, alpha, beta, gamma },
    acceptedEvidenceIds: evidence.map((item) => item.id),
    counterEvidenceIds: counter.map((item) => item.id),
    duplicates,
    isCalibratedProbability: false
  };
}

const DEFAULT_WEIGHTS = {
  lexical: 0.35,
  phrase: 0.2,
  semantic: 0.25,
  context: 0.1,
  temporal: 0.1
};

/**
 * R = sum(w_i * x_i) / sum(w_i over available signals)
 *
 * A missing signal is removed and its weight is not silently treated as zero.
 * Semantic absence is reported as unavailable, never as semanticScore=0.
 */
export function fuseRelevanceScores(scores = {}, options = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
  const components = {};
  let weightSum = 0;
  for (const [name, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight) || weight < 0) continue;
    const raw = scores[name];
    if (raw === null || raw === undefined) continue;
    if (!Number.isFinite(raw)) continue;
    const value = clip(raw, 0, 1);
    components[name] = { value, weight, contribution: 0 };
    weightSum += weight;
  }
  if (weightSum === 0) {
    return {
      score: 0,
      eligible: false,
      thresholdPassed: false,
      components,
      availableSignals: [],
      missingSignals: Object.keys(weights).filter((name) => !(name in components)),
      reason: "no_available_signals"
    };
  }
  for (const component of Object.values(components)) {
    component.contribution = (component.weight / weightSum) * component.value;
  }
  const normalizedWeights = Object.fromEntries(
    Object.entries(components).map(([name, component]) => [name, component.weight / weightSum])
  );
  const score = Object.values(components).reduce((sum, component) => sum + component.contribution, 0);
  const threshold = clip(finite(options.threshold, 0.35), 0, 1);
  const eligible = options.eligible !== false;
  return {
    score,
    eligible: eligible && score >= threshold,
    thresholdPassed: score >= threshold,
    threshold,
    components,
    normalizedWeights,
    availableSignals: Object.keys(components),
    missingSignals: Object.keys(weights).filter((name) => !(name in components)),
    reason: options.eligible === false ? "hard_gate_failed" : score >= threshold ? "above_threshold" : "below_threshold"
  };
}

function timeRange(memory) {
  const start = Date.parse(memory?.validFrom ?? memory?.observedAt ?? memory?.createdAt ?? "");
  const end = Date.parse(memory?.validTo ?? "");
  return {
    start: Number.isFinite(start) ? start : Number.NEGATIVE_INFINITY,
    end: Number.isFinite(end) ? end : Number.POSITIVE_INFINITY
  };
}

function overlap(left, right) {
  return left.start <= right.end && right.start <= left.end;
}

/**
 * Conflict = SubjectMatch AND AttributeMatch AND TimeOverlap AND incompatible values.
 * Non-overlapping validity ranges are a temporal update, not a conflict.
 */
export function detectFactConflict(newMemory, oldMemory) {
  if (!newMemory || !oldMemory) return { conflict: false, reason: "missing_memory" };
  if (normalized(newMemory.subject) !== normalized(oldMemory.subject)) {
    return { conflict: false, reason: "subject_mismatch" };
  }
  if (!newMemory.attribute || normalized(newMemory.attribute) !== normalized(oldMemory.attribute)) {
    return { conflict: false, reason: "attribute_mismatch" };
  }
  const newRange = timeRange(newMemory);
  const oldRange = timeRange(oldMemory);
  if (!overlap(newRange, oldRange)) {
    return {
      conflict: false,
      reason: "non_overlapping_time_ranges",
      classification: "temporal_update",
      newRange,
      oldRange
    };
  }
  const sameValue = normalized(newMemory.value) === normalized(oldMemory.value);
  if (sameValue) return { conflict: false, reason: "same_value", newRange, oldRange };
  return {
    conflict: true,
    reason: "simultaneous_incompatible_values",
    evidence: {
      newMemoryId: newMemory.id ?? null,
      oldMemoryId: oldMemory.id ?? null,
      subject: newMemory.subject,
      attribute: newMemory.attribute,
      newValue: newMemory.value,
      oldValue: oldMemory.value
    },
    suggestion: "ask_user_or_request_explicit_correction",
    autoSelectWinner: false
  };
}

const DECAY_HALF_LIFE_DAYS = {
  identity: 3650,
  preference: 365,
  project: 90,
  temporary: 3,
  unknown: 180
};

/** T = exp(-ln(2) * ageDays / halfLife). Retracted state is a hard exclusion. */
export function temporalDecay(input = {}) {
  if (input.status === "retracted" || input.status === "deleted") {
    return { decay: 0, eligible: false, reason: "retracted_cannot_be_reactivated_by_time" };
  }
  const category = input.category in DECAY_HALF_LIFE_DAYS ? input.category : "unknown";
  const halfLife = Math.max(0.001, finite(input.halfLifeDays, DECAY_HALF_LIFE_DAYS[category]));
  const age = Math.max(0, finite(input.ageDays, 0));
  return {
    decay: Math.exp(-Math.LN2 * age / halfLife),
    eligible: true,
    category,
    halfLifeDays: halfLife,
    ageDays: age
  };
}

function greedySelection(items, budget) {
  const ordered = [...items].sort((left, right) => {
    const leftRatio = left.cost === 0 ? Number.POSITIVE_INFINITY : left.utility / left.cost;
    const rightRatio = right.cost === 0 ? Number.POSITIVE_INFINITY : right.utility / right.cost;
    return rightRatio - leftRatio || left.index - right.index;
  });
  const selected = [];
  let used = 0;
  for (const item of ordered) {
    if (used + item.cost <= budget) {
      selected.push(item);
      used += item.cost;
    }
  }
  return { selected, used, utility: selected.reduce((sum, item) => sum + item.utility, 0) };
}

/**
 * Exact 0/1 knapsack for small integer costs, with a greedy comparison.
 * Privacy/revocation eligibility is applied before utility is considered.
 */
export function selectContextUnderBudget(items, budget) {
  const maximum = Math.max(0, Math.floor(finite(budget, 0)));
  const eligible = (Array.isArray(items) ? items : []).map((item, index) => ({
    ...item,
    index,
    utility: Math.max(0, finite(item.utility, 0)),
    cost: Math.max(0, Math.ceil(finite(item.cost, 0)))
  })).filter((item) => item.eligible !== false);
  const excluded = (Array.isArray(items) ? items : []).filter((item) => item.eligible === false)
    .map((item) => ({ id: item.id, reason: "hard_gate_failed" }));

  const greedy = greedySelection(eligible, maximum);
  const dp = Array.from({ length: maximum + 1 }, () => ({ utility: 0, indices: [] }));
  for (const item of eligible) {
    for (let b = maximum; b >= item.cost; b -= 1) {
      const candidate = dp[b - item.cost].utility + item.utility;
      if (candidate > dp[b].utility) {
        dp[b] = { utility: candidate, indices: [...dp[b - item.cost].indices, item.index] };
      }
    }
  }
  const best = dp[maximum];
  const byIndex = new Map(eligible.map((item) => [item.index, item]));
  const selected = best.indices.map((index) => byIndex.get(index));
  const used = selected.reduce((sum, item) => sum + item.cost, 0);
  return {
    selected,
    omitted: eligible.filter((item) => !best.indices.includes(item.index))
      .map((item) => ({ id: item.id, reason: "not_in_optimal_subset" }))
      .concat(excluded),
    exactUtility: best.utility,
    greedyUtility: greedy.utility,
    greedySelectedIds: greedy.selected.map((item) => item.id),
    budgetUsed: used,
    budget: maximum,
    withinBudget: used <= maximum,
    method: "exact_dp",
    approximationGap: best.utility - greedy.utility
  };
}

/**
 * Structured pre-answer checks. It returns reason codes and a decision; it does
 * not ask a model to grade its own answer.
 */
export function metacognitiveCheck(input = {}) {
  const claims = Array.isArray(input.claims) ? input.claims : [];
  const evidenceIds = new Set(input.evidenceIds ?? []);
  const contextOnly = new Set(input.contextOnlyIds ?? []);
  const retired = new Set(input.retiredIds ?? []);
  const reasons = [];

  if (input.questionNeedsEvidence === true && evidenceIds.size === 0) reasons.push("no_evidence");
  if (input.unresolvedConflict === true) reasons.push("unresolved_conflict");
  for (const claim of claims) {
    if ((claim.status === "fact" || claim.status === "asserted") && claim.inferred === true) reasons.push(`inference_as_fact:${claim.id}`);
    if (claim.subject === "assistant" && claim.evidenceSubject === "user") reasons.push(`subject_mismatch:${claim.id}`);
    if (!claim.evidenceId || !evidenceIds.has(claim.evidenceId)) reasons.push(`unsupported_claim:${claim.id}`);
    if (contextOnly.has(claim.evidenceId) && claim.usedAsAnswer === true) reasons.push(`context_only_as_answer:${claim.id}`);
    if (retired.has(claim.evidenceId)) reasons.push(`retired_evidence:${claim.id}`);
  }

  const decision = reasons.some((reason) => reason.startsWith("retired_evidence"))
    ? "abstain"
    : reasons.includes("unresolved_conflict")
      ? "clarify"
      : reasons.length > 0 ? "abstain" : "answer";
  return {
    decision,
    answerAllowed: decision === "answer",
    reasons,
    checks: {
      hasEvidence: evidenceIds.size > 0,
      conflictUnresolved: input.unresolvedConflict === true,
      claimCount: claims.length,
      unsupportedClaimCount: reasons.filter((reason) => reason.startsWith("unsupported_claim")).length,
      subjectErrorCount: reasons.filter((reason) => reason.startsWith("subject_mismatch")).length,
      contextOnlyAnswerCount: reasons.filter((reason) => reason.startsWith("context_only_as_answer")).length
    },
    usedModelSelfEvaluation: false
  };
}

/**
 * P_(t+1) = clip(P_t + eta * G(E_t), min, max), bounded per turn.
 * Only independent preference observations participate; factual corrections do
 * not rewrite personality, and a single observation cannot jump the state.
 */
export function updatePersonalityState(state = {}, observations = [], options = {}) {
  const eta = Math.max(0, finite(options.eta, 0.05));
  const maxDelta = Math.max(0, finite(options.maxDeltaPerTurn, 0.1));
  const minimum = finite(options.min, 0);
  const maximum = finite(options.max, 100);
  const range = maximum - minimum;
  const accepted = uniqueById(observations.filter((item) => item.kind === "preference" && item.subject === "user"));
  const byDimension = new Map();
  for (const observation of accepted) {
    if (!observation.dimension || !Number.isFinite(observation.direction)) continue;
    const list = byDimension.get(observation.dimension) ?? [];
    list.push(observation);
    byDimension.set(observation.dimension, list);
  }
  const next = { ...state };
  const changes = [];
  for (const [dimension, list] of [...byDimension.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!Number.isFinite(state[dimension])) continue;
    const direction = clip(list.reduce((sum, item) => sum + clip(item.direction, -1, 1), 0) / list.length, -1, 1);
    const requested = eta * direction * range;
    const delta = clip(requested, -maxDelta * range, maxDelta * range);
    const updated = clip(state[dimension] + delta, minimum, maximum);
    if (updated !== state[dimension]) {
      next[dimension] = updated;
      changes.push({
        dimension,
        from: state[dimension],
        to: updated,
        delta: updated - state[dimension],
        evidenceIds: list.map((item) => item.id),
        reason: "independent_user_preference_evidence"
      });
    }
  }
  return { state: next, changes, acceptedObservationIds: accepted.map((item) => item.id), eta, maxDeltaPerTurn: maxDelta };
}

/**
 * F_(t+1) = clip(rho*F_t + eta*(E_t - F_t), 0, 1), per dimension.
 * This is a computed attention/feeling state, not a claim of subjective feeling.
 */
export function updateAffectiveState(state = {}, event = {}, options = {}) {
  const rho = clip(finite(options.rho, 0.85), 0, 1);
  const eta = clip(finite(options.eta, 0.2), 0, 1);
  const minimum = clip(finite(options.min, 0), 0, 1);
  const maximum = clip(finite(options.max, 1), minimum, 1);
  const next = {};
  const changes = [];
  const dimensions = ["novelty", "goalProgress", "uncertainty", "conflict", "interest", "exploration"];
  for (const dimension of dimensions) {
    const current = clip(finite(state[dimension], 0.5), minimum, maximum);
    const target = event[dimension] === undefined ? current : clip(finite(event[dimension], current), 0, 1);
    const updated = clip(rho * current + eta * (target - current), minimum, maximum);
    next[dimension] = updated;
    changes.push({ dimension, from: current, to: updated, target });
  }
  return {
    state: next,
    changes,
    rho,
    eta,
    representation: "computed_state_vector",
    claimsSubjectiveExperience: false
  };
}
