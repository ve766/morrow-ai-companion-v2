# Memory retrieval benchmark

Script: `scripts/memory-retrieval-benchmark.ts`.
Raw JSON: `evals/memory-retrieval/benchmark/2026-11-10T06-31-17-730Z-60ae6fe11e751bd7e5b80df942d231eade98b8eb.json`.
Code SHA: `60ae6fe11e751bd7e5b80df942d231eade98b8eb`.
Environment: Windows 10.0.26200, Intel i5-11260H, 16 GB RAM, Node 22.23.2.

## 1. What ran

The benchmark drives the **production** `MemoryService.assembleContext` path:
SQLite FTS/lexical scoring, fact-slot/value/time channels, RRF fusion,
context-utility rerank, sensitivity/retraction/conflict filters, and the
production `listActiveForContext(1000)` candidate window.

Dataset: 20 labelled queries (`Q00`…`Q19`, each with a unique astronomy topic),
plus fillers. At each size the targets are inserted last so they fall inside
the 1000-row window. Query 00 is a correction (old value removed, new value
present), query 01 is `sensitive`, query 02 is retracted, the rest are ordinary
lexical queries.

## 2. Semantic channel status

`semanticStatus = UNAVAILABLE_NO_ONNX_MODEL`.

Code evidence: this runtime has no ONNX model file, no `onnxruntime`
dependency, no semantic module under `src/memory/`, and no call site. The
historical PR #1 implementation cannot run in the installed app without a
model and runtime, so no lexical+semantic comparison is claimed. The lexical
numbers below are the safe current path; the historical code is neither
silently deleted nor falsely presented as integrated.

## 3. Results

| Size | Recall@5 | MRR | Misrecall | Retraction leak | Sensitivity leak | Correction accuracy | p50 ms | p95 ms | Context chars | Fixture ms | Cold start ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1.000 | 1.000 | 0.100 | 0 | 0 | 1.000 | 10.87 | 13.28 | 214 | 1,912 | 40.43 |
| 500 | 1.000 | 1.000 | 0.100 | 0 | 0 | 1.000 | 136.77 | 212.76 | 214 | 12,708 | 116.79 |
| 1000 | 1.000 | 1.000 | 0.100 | 0 | 0 | 1.000 | 409.47 | 819.11 | 214 | 28,125 | 1,179.47 |
| 5000 | 1.000 | 1.000 | 0.100 | 0 | 0 | 1.000 | 406.71 | 421.72 | 214 | 28,415 | 403.47 |

Misrecall is `selected entries without the query marker / selected entries`.
The 0.10 is the same deterministic lexical near-miss in both directions:
`Q05 系外行星` admits `Q13 小行星`, and `Q13 小行星` admits `Q05 系外行星`,
because both share the bigram `行星`. This is a real lexical limitation, not a
fixture error. It is the concrete case a semantic channel would need to fix,
and it does not bypass correction/retraction/sensitivity (those leak counts are
zero).

Cold start is the first query after closing and reopening the database. The
1000-row case is noisy (1.18s in this run, 0.30–0.40s in earlier runs on the
same machine); it is reported as measured, not smoothed.

## 4. Interpretation limits

- 20 queries is a smoke-scale labelled set, not a 5000-query corpus. Scaling
  the corpus to 5000 measures candidate-window cost, not annotation coverage.
- The production candidate window caps at 1000 rows, so 5000 memories do not
  all compete; that is the real behaviour being measured.
- There is no semantic arm, so no quality lift can be claimed.
- The fixture uses synthetic Chinese sentences with unique topics; it is not
  user data and contains no personal content.
- Query latency is single-process, warm-page-cache after the first query;
  p50/p95 are across 20 queries × 5 iterations.

## 5. Reproduce

```
node node_modules/esbuild/bin/esbuild scripts/memory-retrieval-benchmark.ts \
  --bundle --platform=node --format=cjs --external:electron \
  --outfile=node_modules/.cache/memory-benchmark.cjs --log-level=warning
MORROW_CODE_SHA=$(git rev-parse HEAD) node node_modules/.cache/memory-benchmark.cjs
```

The run writes a new timestamped JSON; it never overwrites an earlier result.
