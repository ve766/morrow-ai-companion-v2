# Mathematical Specification for Cognitive Algorithms

**Status:** proposed research specification, not production behavior.
**Version:** 0.1.0-draft.

Equations below define candidates that must be tested. They are not evidence of quality improvement. Parameters, data versions, and evaluation results must be recorded for every experiment.

## 1. Notation

- q: current query and explicitly selected conversational context.
- m_i: candidate memory with content, subject, scope, status, provenance, timestamp, sensitivity, and uncertainty.
- A(q,m_i) in {0,1}: hard eligibility gate.
- s(q,m_i): ranking score, applied only after eligibility.
- B: context budget. The current code uses serialized JSON character count, not tokenizer tokens.
- C: selected context memories.

## 2. O-03 — lifecycle and permission gate

Define each indicator as 1 only when the check explicitly passes:

\[
A(q,m_i)=I_{status}I_{notDeleted}I_{notRevoked}I_{subject}I_{scope}I_{sensitivity}I_{provenanceValid}
\]

Then:

\[
M_{eligible}=\{m_i\in M\mid A(q,m_i)=1\}
\]

**Invariant:** no ranking score may override the gate. A deleted, revoked, out-of-scope, or otherwise inadmissible memory must never re-enter the eligible set because it scores highly. Missing safety-critical fields must fail closed or produce a structured error. Exact statuses and sensitivity rules must eventually map to the existing product schema; this pack must not invent a second production schema.

## 3. Multilingual lexical retrieval

Whitespace tokenization is insufficient for Chinese. Candidate implementations should compare normalized word tokens with CJK character n-grams. Let T_n(x) be the multiset of normalized character n-grams for configured lengths n in N. A weighted Jaccard baseline is:

\[
J_w(q,m)=\frac{\sum_{t\in T(q)\cap T(m)}w_t}{\sum_{t\in T(q)\cup T(m)}w_t}
\]

with positive feature weights w_t. Optional inverse-document-frequency weighting is:

\[
idf(t)=\log\left(1+\frac{N_d}{1+df(t)}\right)
\]

where N_d is the number of documents and df(t) is the number containing feature t in a frozen, authorized corpus. Corpus identity/version must be recorded, and held-out test data must not be used to estimate these weights.

Lexical similarity is candidate-generation evidence, not proof of semantic relevance. A zero lexical score should not discard a candidate if another authorized semantic or explicit-cue retrieval path exists. The current code does not implement this n-gram formula yet.

## 4. O-05 — transparent ranking

A candidate score can be defined as:

\[
s_i=\alpha L_i+\beta S_i+\gamma R_i+\delta P_i-\lambda U_i-\mu X_i
\]

where all components are normalized to [0,1]: L lexical match, S optional semantic similarity, R recency, P provenance reliability, U uncertainty penalty, and X unresolved contradiction penalty. Coefficients are non-negative, documented, and versioned. If a component is unavailable, do not pretend it was measured; explicitly omit it or use a documented neutral policy.

One recency candidate is exponential half-life decay:

\[
R_i=2^{-\Delta t_i/h}
\]

where elapsed time Δt_i is non-negative and h is the half-life. Recency should be role-specific: age alone must not make stable preferences or historical events irrelevant. Tune coefficients on development fixtures, freeze them before held-out evaluation, and report ablations. Tie-breaking must be deterministic. Ranking must never change eligibility.

For conflicting claims sharing a fact key k:

\[
F_k=\{m_i\in M_{eligible}: key(m_i)=k\}
\]

A conservative policy honors valid explicit corrections and retractions, preserves provenance and temporal scope, flags unresolved incompatibilities, and asks or abstains when a conflict materially affects the answer. An optional penalty is:

\[
X_i=\max_{j\ne i}\left(I_{conflict}(m_i,m_j)c_{ij}\right)
\]

where conflict confidence c_ij is in [0,1]. This is a proposed formula; conflict detection is not implemented in the current reference code.

## 5. O-06 — context selection under budget

Let x_i in {0,1} indicate inclusion, cost_i be serialized size, and u_i be utility. The idealized optimization is:

\[
\max_{x_1,\ldots,x_n}\sum_i u_i x_i
\quad\text{subject to}\quad
\sum_i cost_i x_i\le B,\quad x_i\le A(q,m_i)
\]

The exact knapsack optimum may be expensive; a greedy approximation is acceptable only if benchmarked and labeled as approximate. Current code counts serialized JSON characters, not model tokens:

\[
cost_i=|serialize(m_i)|,\qquad cost(C)=|serialize(envelope(C))|
\]

Envelope and metadata overhead count toward B. If even the empty envelope exceeds B, return a structured failure or withinBudget=false. Never silently strip provenance, uncertainty, or lifecycle markers to fit.

## 6. Abstention and calibrated confidence

Let p* be a calibrated probability that selected evidence supports the intended answer and τ a threshold chosen on development data:

\[
decision=\begin{cases}
answer,&p^*\ge\tau\land safetyChecksPass\\
clarify,&ambiguityIsResolvable\\
abstain,&otherwise
\end{cases}
\]

A lexical score is not a probability. Do not label a score as confidence until calibrated against labeled examples. Report both unsupported-assertion rate and answer coverage; abstaining on every query can otherwise appear deceptively safe. This decision rule is not implemented yet.

## 7. O-07 — final serialized payload audit

Let P be the exact serialized payload after all context assembly and transformations:

\[
SafePayload(P)=ConsentValid(P)\land ScopeAllowed(P)\land NoRevokedData(P)\land ProvenancePresent(P)\land DestinationAllowed(P)\land SerializationMatchesReviewed(P)
\]

\[
Dispatch(P)\iff SafePayload(P)=true
\]

Audit the exact object/bytes that will be dispatched, not merely UI inputs or an earlier draft. Where appropriate, record a cryptographic digest H(P), destination/provider identifier, consent decision, and audit result without unnecessarily logging sensitive content. A hash proves byte identity, not semantic safety. Consent failure, revoked-data leakage, unauthorized destination, or reviewed-vs-dispatched mismatch is release-blocking. This is a proposed contract; no provider dispatch or payload auditor is implemented in this pack yet.

## 8. O-09 — memory update proposal

An update candidate u should carry evidence, provenance, confidence, scope, lifecycle suggestion, and reason. A review-priority score may be:

\[
U(u)=aI(u)+bN(u)+cD(u)-dR(u)-eS(u)
\]

where I is expected future usefulness, N novelty, D durability, R redundancy, and S sensitivity/risk, all normalized and documented. This score can prioritize review only; it must not directly mutate or delete production memory. It is not implemented in current code.

Extraction metrics:

\[
Precision=\frac{TP}{TP+FP},\qquad Recall=\frac{TP}{TP+FN}
\]

## 9. Evaluation metrics

For query q, relevant items Rel_q, and retrieved top-k items TopK_q:

\[
Recall@k=\frac{|TopK_q\cap Rel_q|}{|Rel_q|}
\]

\[
MRR=\frac{1}{|Q|}\sum_{q\in Q}\frac{1}{rank_q}
\]

If no relevant item is found, reciprocal rank is 0. For binary relevance:

\[
DCG@k=\sum_{i=1}^{k}\frac{2^{rel_i}-1}{\log_2(i+1)},\qquad nDCG@k=\frac{DCG@k}{IDCG@k}
\]

Unsupported assertion rate:

\[
UAR=\frac{unsupported\ factual\ claims}{all\ evaluated\ factual\ claims}
\]

Correction-respect rate:

\[
CRR=\frac{cases\ correctly\ honoring\ valid\ corrections}{cases\ with\ valid\ corrections}
\]

Report denominators, per-case failures, p50/p95 latency, and confidence intervals where sample size permits. Aggregates must not hide a single critical privacy/lifecycle regression.

## 10. Reproducibility protocol

Freeze pack commit, algorithm/config version, fixture/corpus version, model/provider version if applicable, and random seed. Run baseline and candidate on identical cases. Tune only on development fixtures; keep held-out fixtures untouched until final comparison. Include ablations (for example, without recency or conflict penalty). Record failures at case level. Any unauthorized disclosure or revoked-memory leak blocks promotion regardless of average score.

## 11. Formula-to-code coverage

| Area | Specification | Current code status |
|---|---|---|
| Lifecycle gate | Hard eligibility equation | Partial deterministic rules; schema mapping incomplete |
| Lexical retrieval | Weighted CJK n-gram/Jaccard | Not implemented; current tokenization is whitespace-based |
| Ranking | Weighted relevance/reliability/uncertainty/conflict score | Not implemented; current code uses lexical score, timestamp, and stable order |
| Context budget | Constrained utility maximization | Character-count selection exists; no tokenizer budget or optimal knapsack |
| Abstention/calibration | Threshold decision rule | Not implemented |
| Final payload audit | Consent/scope/revocation/destination predicate | Not implemented |
| Memory proposal | Review utility score | Not implemented |
| Evaluation | Recall@k, MRR, nDCG, UAR, CRR | Definitions only; no recorded benchmark results |

**Important:** equations are hypotheses and contracts, not proof of effectiveness. The next steps are unit tests for the formulas, CJK-aware retrieval, and comparative evaluation. Do not claim any quality gain until results are run and recorded.
