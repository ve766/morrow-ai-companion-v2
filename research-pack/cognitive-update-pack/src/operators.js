/**
 * Standalone reference operators for research-pack evaluation.
 * These are NOT imported by Morrow's production runtime.
 *
 * All functions are deterministic and dependency-free. They operate on plain
 * data supplied by the caller and never read or mutate persistent storage.
 */

const ACTIVE_STATUSES = new Set(["active", "confirmed"]);

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

function safeReason(code, details = {}) {
  return { code, details };
}

/**
 * O-03: hard lifecycle/scope gate.
 * Hard exclusions happen before relevance ranking.
 */
export function lifecycleGate(memory, request = {}) {
  if (!memory || typeof memory !== "object") {
    return { allowed: false, reason: safeReason("invalid_memory") };
  }
  if (!ACTIVE_STATUSES.has(memory.status)) {
    return { allowed: false, reason: safeReason("inactive_status", { status: memory.status ?? null }) };
  }
  if (memory.deleted === true || memory.revoked === true) {
    return { allowed: false, reason: safeReason("revoked_or_deleted") };
  }
  if (request.subject && memory.subject && request.subject !== memory.subject) {
    return { allowed: false, reason: safeReason("subject_mismatch") };
  }
  if (request.scope && memory.scope && request.scope !== memory.scope) {
    return { allowed: false, reason: safeReason("scope_mismatch") };
  }
  if (request.allowedSensitivity && memory.sensitivity &&
      !request.allowedSensitivity.includes(memory.sensitivity)) {
    return { allowed: false, reason: safeReason("sensitivity_not_allowed") };
  }
  return { allowed: true, reason: safeReason("passed_hard_gates") };
}

/**
 * O-04: simple lexical candidate generator.
 * This is a baseline, not semantic retrieval. A zero score is retained in
 * diagnostics and must not be interpreted as proof of irrelevance.
 */
export function lexicalCandidateGenerator(query, memories, request = {}) {
  const queryTokens = tokenSet(query);
  return (Array.isArray(memories) ? memories : [])
    .map((memory, index) => {
      const gate = lifecycleGate(memory, request);
      const memoryTokens = tokenSet([
        memory?.content,
        memory?.summary,
        ...(Array.isArray(memory?.keywords) ? memory.keywords : [])
      ].filter(Boolean).join(" "));
      const overlap = [...queryTokens].filter(token => memoryTokens.has(token));
      const score = queryTokens.size === 0 ? 0 : overlap.length / queryTokens.size;
      return {
        memory,
        index,
        allowed: gate.allowed,
        gateReason: gate.reason,
        lexicalScore: score,
        matchedTerms: overlap
      };
    })
    .filter(item => item.allowed)
    .sort((a, b) => b.lexicalScore - a.lexicalScore || a.index - b.index);
}

/**
 * O-05: transparent baseline ranker.
 * It preserves zero-overlap candidates so downstream evaluation can reveal
 * whether the lexical-only baseline misses paraphrases. Production callers
 * must set a candidate cap and should add semantic retrieval where justified.
 */
export function rankCandidates(candidates, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit >= 0
    ? options.limit
    : candidates.length;
  return [...candidates]
    .sort((a, b) => {
      const scoreDiff = (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const aTime = Date.parse(a.memory?.updatedAt ?? a.memory?.createdAt ?? "") || 0;
      const bTime = Date.parse(b.memory?.updatedAt ?? b.memory?.createdAt ?? "") || 0;
      return bTime - aTime || a.index - b.index;
    })
    .slice(0, limit);
}

/**
 * O-06: budget-based context selector.
 * Estimates JSON character length, not tokenizer tokens. Callers must label
 * the budget accordingly. Metadata is preserved for selected records.
 */
export function selectContextWithinCharacterBudget(candidates, maxCharacters = 4000, envelope = {}) {
  const maximum = Number.isFinite(maxCharacters) && maxCharacters >= 0
    ? Math.floor(maxCharacters)
    : 4000;
  const selected = [];
  const omitted = [];

  const encode = (items) => JSON.stringify({
    scope: envelope.scope ?? null,
    subject: envelope.subject ?? null,
    memories: items.map(item => ({
      id: item.memory?.id ?? null,
      subject: item.memory?.subject ?? null,
      scope: item.memory?.scope ?? null,
      status: item.memory?.status ?? null,
      content: item.memory?.content ?? item.memory?.summary ?? "",
      updatedAt: item.memory?.updatedAt ?? item.memory?.createdAt ?? null,
      provenance: item.memory?.provenance ?? null,
      uncertainty: item.memory?.uncertainty ?? null
    }))
  }, null, 2);

  for (const candidate of candidates) {
    const next = [...selected, candidate];
    if (encode(next).length <= maximum) selected.push(candidate);
    else omitted.push({ candidate, reason: "character_budget_exceeded" });
  }

  return {
    text: encode(selected),
    selected,
    omitted,
    characterCount: encode(selected).length,
    maxCharacters: maximum,
    withinBudget: encode(selected).length <= maximum
  };
}
