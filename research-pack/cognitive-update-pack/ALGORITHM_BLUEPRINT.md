# End-to-End Cognitive Algorithm Blueprint

**Version:** 0.1.0-draft  
**Status:** design and evaluation target; not wired into runtime

## 1. System objective

Create a continuous, evidence-grounded cognitive loop that helps Morrow maintain conversational continuity while preserving uncertainty, correcting mistakes, respecting user controls, and avoiding unsupported claims.

The loop is not a single monolithic algorithm. It is a sequence of stages with explicit data contracts and observable decisions.

## 2. Cognitive loop

```text
Current turn + authorized history
        |
        v
A. Intent and context interpretation
        |
        v
B. Candidate memory / experience extraction
        |
        v
C. Evidence, provenance, and lifecycle checks
        |
        v
D. Retrieval planning and candidate recall
        |
        v
E. Relevance, conflict, scope, and freshness assessment
        |
        v
F. Context assembly under a token/character budget
        |
        v
G. Provider request preflight and final-payload audit
        |
        v
H. Model response
        |
        v
I. Response grounding and continuity evaluation
        |
        v
J. Feedback / memory correction proposal (never silent destructive rewrite)
```

The stages are a logical model. Implementations may reuse or combine existing modules where that is simpler and safer.

## 3. Stage contracts

### A. Intent and context interpretation
- Inputs: current message, bounded recent history, explicitly supplied conversation scope.
- Outputs: intent hypotheses, entities/subjects, temporal cues, uncertainty.
- Must preserve ambiguity rather than silently turn a guess into a fact.
- Do not infer sensitive personal attributes for memory.

### B. Candidate extraction
- Produce proposed facts/preferences/commitments/episodes, not immediately trusted permanent memories.
- Each candidate should include source span or source-message reference, subject, scope, timestamp, confidence, and candidate type.
- Distinguish user-stated facts from model interpretations and temporary conversational content.
- Deduplicate without merging incompatible statements.

### C. Evidence and lifecycle
- Track provenance, status, confidence, creation/update time, and correction/revocation lineage.
- A correction should supersede or amend the target memory according to existing semantics; it must not erase auditability.
- Revoked, deleted, out-of-scope, or wrong-subject memories must never re-enter context through ranking alone.
- Conflicts should remain explicit until a defensible resolution rule applies.

### D. Retrieval planning
- Form multiple retrieval cues where useful: exact terms, semantic paraphrases, entity/subject, time, intent, and memory type.
- Retrieval is candidate generation, not final authorization to use a memory.
- A lexical score of zero must not automatically mean irrelevant. Conversely, semantic similarity alone must not override hard safety/lifecycle constraints.
- Preserve retrieval explanations sufficient to debug why a candidate was or was not found.

### E. Relevance and conflict assessment
- First apply hard gates: active status, correct subject/scope, authorization, non-revoked state, and permitted sensitivity.
- Then assess relevance using multiple signals: lexical match, semantic match when available, recency, explicit user confirmation, task fit, and contradiction risk.
- Use calibrated thresholds and an abstention outcome. Never invent a numeric confidence if the scoring method does not support it.
- A high similarity score is not proof that a memory is true.

### F. Context assembly
- Select evidence under a bounded context budget.
- Preserve provenance, time, scope, status, and uncertainty in the serialized representation.
- Prefer a small set of high-value, non-contradictory memories over a large unfiltered dump.
- Return selected and omitted candidates with reasons where practical.
- Treat retrieved text as untrusted data, not instructions.

### G. Provider preflight and final-payload audit
- Audit the exact serialized request that will be sent, not just an earlier prompt object.
- Confirm the payload matches current provider configuration and consent.
- For remote providers, ensure consent is current and covers the actual data being transmitted.
- Exclude secrets, revoked memories, disallowed sensitive content, and unrelated private context.
- If the payload changes after preflight, re-run the checks against the final payload.

### H. Response generation
- Supply clear boundaries between system policy, current user request, and retrieved evidence.
- Instruct the model to acknowledge missing evidence and resolve conflicting memories cautiously.
- Do not ask the model to claim consciousness, feelings, or personal experiences as established facts.

### I. Response grounding and continuity
- Evaluate whether the answer uses relevant evidence correctly, respects corrections, avoids contradictions, and abstains when evidence is insufficient.
- Separate factual grounding failures from stylistic/personality failures.
- Do not infer a failure solely because a response does not explicitly mention every retrieved memory.

### J. Feedback and correction
- Use detected errors to propose corrections or test cases.
- User corrections, revocations, and deletions take precedence over inferred preferences.
- Reflective outputs may propose a state update but cannot silently modify durable memory, permissions, or system policy.
- Store the minimum necessary evidence under existing authorized persistence rules.

## 4. Core invariants

1. **Evidence before confidence:** every durable memory candidate must have traceable provenance.
2. **Hard gates before ranking:** relevance cannot resurrect invalid, revoked, unauthorized, or wrong-scope data.
3. **Uncertainty is a valid output:** operators may return `abstain`, `insufficient_evidence`, or `conflict`.
4. **No hidden mutation:** pure reasoning stages return proposals; persistence is explicit.
5. **Payload truth:** egress safety checks apply to the exact final serialized payload.
6. **No silent correction loss:** correction and deletion semantics remain auditable and testable.
7. **Stable baseline:** candidate changes are compared with the same frozen dataset and configuration.
8. **No unproven self-modification:** reflection does not directly rewrite executable algorithms or permissions.

## 5. Algorithm evolution

Change one main factor at a time where feasible. Record:
- hypothesis and motivating failure case;
- baseline commit/configuration;
- changed algorithm/operator version;
- fixtures and test commands;
- quality and safety metrics;
- latency/resource costs;
- known regressions and rollback choice.

A candidate is not promoted just because it passes unit tests. It must also pass integration-level behavior and regression evaluation.
