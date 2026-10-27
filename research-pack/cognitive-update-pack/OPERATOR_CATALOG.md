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
