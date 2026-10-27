# Candidate Cognitive Operator Catalog

**Version:** 0.1.0-draft  
**Status:** proposed contracts only; these operators are not currently integrated into Morrow

## 1. What counts as an operator?

An operator is a reusable, bounded operation with an explicit input/output contract, defined failure behavior, and an independent reason to test or replace it. Not every helper function needs to become an operator.

Operators are implementation units. Algorithms decide how and when to compose them. Models are optional dependencies used by some operators, not synonyms for operators.

## 2. Common contract

Each operator should declare:

- `id` and semantic `version`;
- input schema and output schema;
- preconditions and invariants;
- dependencies and whether they are deterministic;
- timeout/resource budget where applicable;
- typed failure/abstention results;
- diagnostics that avoid logging raw private content;
- unit fixtures and expected metrics;
- compatibility and fallback behavior.

Recommended conceptual result envelope:

```ts
type OperatorOutcome<T> =
  | { status: "ok"; value: T; diagnostics?: SafeDiagnostics }
  | { status: "abstain"; reason: string; diagnostics?: SafeDiagnostics }
  | { status: "error"; code: string; retryable: boolean };
```

This is a proposed shape, not a claim that the current repository already exports this type.

## 3. Candidate operators

### O-01: Intent & Query Cue Builder
**Purpose:** Convert the current turn and allowed context into retrieval cues: subject, entities, temporal references, task intent, exact terms, and optional semantic query text.

**Input:** current message, bounded authorized context.  
**Output:** structured cues plus uncertainty.  
**Must not:** create durable memories, infer sensitive attributes, or treat an ambiguous guess as confirmed.  
**Evaluation:** intent-label accuracy, cue recall, false inference rate.

### O-02: Memory Candidate Extractor
**Purpose:** Propose memory candidates from conversational evidence.

**Input:** source message/reference and explicitly allowed surrounding context.  
**Output:** zero or more candidates with provenance, subject, scope, type, confidence/evidence status.  
**Must not:** persist directly, convert speculation into fact, or merge contradictory candidates silently.  
**Evaluation:** precision/recall against annotated candidate memories, unsupported-claim rate.

### O-03: Memory Lifecycle Gate
**Purpose:** Enforce active/revoked/deleted/superseded state, subject, scope, and authorization constraints before ranking.

**Input:** candidate memory plus current request scope and lifecycle metadata.  
**Output:** allow/reject with reason code.  
**Must not:** let semantic or lexical relevance override a hard rejection.  
**Evaluation:** 100% exclusion of revoked/deleted/wrong-scope fixtures.

### O-04: Hybrid Retrieval Candidate Generator
**Purpose:** Retrieve candidate memories through available lexical, structured, and optionally semantic methods.

**Input:** query cues, authorized search scope, retrieval configuration.  
**Output:** candidate set with raw component scores and source method.  
**Must not:** declare candidates true or bypass lifecycle gates.  
**Evaluation:** Recall@k, candidate coverage, latency, resource use.

### O-05: Relevance & Conflict Ranker
**Purpose:** Rank permitted candidates using interpretable signals and flag conflicts.

**Input:** permitted candidates, current intent, temporal context.  
**Output:** ranked candidates, reasons, conflict/uncertainty flags.  
**Must not:** treat lexical zero as automatic rejection without evaluation, or treat semantic similarity as truth.  
**Evaluation:** MRR, nDCG@k where labels support it, conflict detection precision/recall.

### O-06: Context Budget Selector
**Purpose:** Select a coherent subset of evidence within a defined token/character budget.

**Input:** ranked candidates, budget, mandatory safety metadata.  
**Output:** selected/omitted lists and omission reasons.  
**Must not:** drop provenance or uncertainty merely to save space; must not exceed the enforced budget.  
**Evaluation:** budget compliance, relevant-evidence coverage, contradiction rate.

### O-07: Final Payload Auditor
**Purpose:** Validate the exact serialized provider payload immediately before dispatch.

**Input:** final payload, provider destination, current consent/policy snapshot.  
**Output:** allow/block plus reason codes and payload fingerprint.  
**Must not:** inspect a stale pre-serialization object and assume it equals the outgoing payload.  
**Evaluation:** all unauthorized-egress fixtures blocked; permitted fixtures pass; payload mutation invalidates prior approval.

### O-08: Response Grounding Evaluator
**Purpose:** Assess answer consistency with retrieved evidence and explicit corrections.

**Input:** user request, selected evidence, model response, relevant correction history.  
**Output:** grounded / partially grounded / unsupported / conflict / insufficient evidence with explanations.  
**Must not:** use the same unverified model response as sole judge of its own correctness.  
**Evaluation:** agreement with human-labeled grounding set, unsupported assertion rate.

### O-09: Memory Update Proposal Builder
**Purpose:** Turn user corrections or evaluation findings into explicit update proposals.

**Input:** current memory, correction evidence, lifecycle rules.  
**Output:** proposed amend/supersede/revoke action with provenance and rationale.  
**Must not:** perform irreversible persistence or override explicit user deletion without the existing authorized workflow.  
**Evaluation:** correction accuracy, wrong-target update rate, auditability.

### O-10: Internal State Delta Proposer (future)
**Purpose:** Propose changes to interest, mood-like state, or self-model using repeated evidence over time.

**Input:** authorized observations, previous state, decay/stability rules.  
**Output:** bounded proposed delta, evidence, confidence, and expiry/review conditions.  
**Must not:** make a single transient utterance permanently define personality; directly change permissions or system policy.  
**Evaluation:** stability, reversibility, calibration, resistance to prompt injection and transient noise.

### O-11: Evidence Confidence Updater (v0.2)

- **Input:** prior, alpha/beta/gamma, supporting evidence `{id,strength}`, counter evidence, source uncertainty.
- **Output:** new confidence, delta, E/K/U components, accepted ids, duplicate counts, `isCalibratedProbability:false`.
- **Preconditions:** strengths and prior in [0,1]; coefficients non-negative.
- **Error path:** non-finite inputs fall back to safe defaults; duplicate ids are collapsed to max strength.
- **Side effects:** none; pure function.
- **Test:** `test/cognitive-v2.test.js` confidence cases.

### O-12: Multi-Signal Fusion Ranker (v0.2)

- **Input:** optional lexical/phrase/semantic/context/temporal scores, non-negative weights, threshold, hard eligibility.
- **Output:** normalized score, normalized weights, per-signal contributions, available/missing signals, threshold result.
- **Preconditions:** semantic score supplied only when measured; missing remains absent.
- **Error path:** no available signals → score 0 with `no_available_signals`; hard gate failure never returns eligible.
- **Side effects:** none.
- **Test:** missing semantic, zero score, and hard-gate cases.

### O-13: Structured Conflict Detector (v0.2)

- **Input:** new and old memory with subject, attribute, value, validity range.
- **Output:** conflict boolean plus subject/attribute/time/value evidence and `autoSelectWinner:false`.
- **Preconditions:** records may have open-ended time ranges.
- **Error path:** missing object → `missing_memory`; mismatched subject/attribute → no conflict with reason.
- **Side effects:** none.
- **Test:** simultaneous conflict, attribute mismatch, non-overlapping temporal update.

### O-14: Category-Aware Temporal Decay (v0.2)

- **Input:** category, ageDays, optional half-life, status.
- **Output:** decay factor, eligibility, category, half-life.
- **Preconditions:** age and half-life non-negative.
- **Error path:** retracted/deleted → decay 0, eligible false, explicit reason.
- **Side effects:** none; decay never deletes evidence.
- **Test:** identity vs temporary and retraction exclusion.

### O-15: Budgeted Context Selector v2 (v0.2)

- **Input:** items `{id,utility,cost,eligible}`, integer character budget.
- **Output:** exact-DP selected set, used budget, greedy comparison, gap, omitted reasons.
- **Preconditions:** utility non-negative, cost non-negative; costs are characters, not tokens.
- **Error path:** ineligible items hard-excluded; impossible budget → empty selection.
- **Side effects:** none.
- **Test:** exact beats greedy, deterministic replay, hard gate, impossible budget.

### O-16: Metacognitive Pre-Answer Check (v0.2)

- **Input:** evidence ids, claims with support/subject/inference/context-only flags, unresolved conflict, retired ids.
- **Output:** answer/clarify/abstain, reason codes, check counters, `usedModelSelfEvaluation:false`.
- **Preconditions:** claims reference supplied evidence ids.
- **Error path:** missing/unsupported evidence → abstain; unresolved conflict → clarify.
- **Side effects:** none; no model invocation.
- **Test:** supported answer, conflict, inference-as-fact, subject mismatch, context-only, retired.

### O-17: Bounded Personality Updater (v0.2)

- **Input:** current dimensions, user preference observations, eta, max delta, bounds.
- **Output:** next state, per-dimension changes with evidence ids and reasons, accepted ids.
- **Preconditions:** only `kind='preference'`, `subject='user'`; duplicate ids collapsed.
- **Error path:** unknown dimension or non-finite direction ignored; facts never change personality.
- **Side effects:** none; caller must still request user authorization before persistence.
- **Test:** bounded delta, fact exclusion, duplicate evidence.

### O-18: Computed Affective/Interest State Updater (v0.2)

- **Input:** state vector, event targets, rho, eta, bounds.
- **Output:** bounded next vector, per-dimension changes, representation label, `claimsSubjectiveExperience:false`.
- **Preconditions:** dimensions normalized to [0,1].
- **Error path:** missing event target retains current state; non-finite values become current/default.
- **Side effects:** none; not connected to production feeling state.
- **Test:** bounds, decay without event, representation disclaimer.

## 4. Composition rules

- Run hard lifecycle/authorization gates before expensive ranking.
- Candidate extraction returns proposals; persistence is a separate explicit operation.
- Retrieval candidate generation and relevance ranking remain separately measurable.
- Context selection cannot silently override safety gates.
- Final payload auditing occurs after serialization and immediately before dispatch.
- Response grounding evaluation informs feedback and tests; it does not automatically rewrite memories.
- Internal-state proposals remain disabled until a dedicated state model and stability evaluation exist.

## 5. Initial implementation order

1. O-03 lifecycle gate (deterministic safety contract).
2. O-04 retrieval candidate generator and O-05 ranker as an offline comparison harness.
3. O-06 budget selector.
4. O-07 payload auditor using the actual provider serialization path.
5. O-01/O-02 extraction and cue improvements after the retrieval baseline is known.
6. O-08/O-09 after a reliable labeled grounding/correction set exists.
7. O-10 only after memory and state stability tests are mature.

This order is for research-pack evaluation. It does not direct immediate changes to production runtime.
