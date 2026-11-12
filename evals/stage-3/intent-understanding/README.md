# C1 intent understanding — reproducible harness

> **What this proves and what it does not.**
> The provider is a scripted string. This harness therefore proves that the
> mechanism is wired through the production send path, the production database
> and the production prompt assembly, and that decisions *differ* where they
> must. It does **not** measure language understanding, and no result file here
> may be quoted as an accuracy figure.

## Two suites, one directory

The claims made here are two different claims, so they live in two files.

| Suite | Entry point | Provider | What it may be quoted as |
|---|---|---|---|
| mechanism | `run.ts` → `npm run eval:stage3:intent` | scripted string | wiring: the decision reaches the payload and the database |
| semantic | `semantic.ts` → `npm run eval:stage3:intent:semantic` | a real model | nothing automatic — it stops at `AWAITING_MANUAL_REVIEW` |

Both write into `result/`-adjacent directories and both emit a `suite` field
(`'mechanism'` | `'semantic'`), and the blocked-record file names differ
(`-semantic` suffix) so the distinction survives `ls`. This is not decoration.
A scripted provider is a string, so a mechanism run cannot fail for the reason
a model would fail; reading its pass count as intent accuracy is the exact error
the split exists to prevent. **Only `semantic.ts` runs a model, and even its own
output refuses to grade itself** — the rule set that produced a reading cannot
also be the judge of that reading, so the semantic suite reports
`manualReview.status: 'PENDING'` and lists what it did *not* measure (accuracy
included: one model, one example set, no label set means no denominator).

## Run

```bash
MORROW_EVAL_SHA=<code sha> npm run eval:stage3:intent            # mechanism
MORROW_TEST_API_KEY=... MORROW_EVAL_SHA=<sha> npm run eval:stage3:intent:semantic   # semantic
```

Optional: omit `MORROW_EVAL_SHA` and the runner asks git for HEAD; with no git it
records `unknown`.

The semantic suite has exactly one credential path: `MORROW_TEST_API_KEY`. There
is deliberately no file fallback (`../shared/real-provider.ts` explains why).
Without it the suite writes a `BLOCKED_NO_SECRET` record and exits `0` — absence
of a credential is a recorded result, not a failure and not a crash. It is never
substituted with a scripted provider.

Outputs (never overwriting earlier runs):

- `results/<UTC timestamp>-<short sha>.json`
- `traces/<UTC timestamp>-<short sha>.jsonl`
- `../../../evals/real-provider/results/<stamp>-<sha>-semantic.json` (semantic only)

Exit code is `1` when any *mechanism* scenario fails, so CI can gate on it. The
semantic suite exits `1` only when the run itself broke (no reading stored, empty
reply, an unhandled call error). A wrong model understanding is not a broken run.

## Where this tree is not a commit

Stage 3 was developed in a directory copy that carries no `.git`, so
`codeCommit` is literally `unknown` and `workingTree` is `unknown` rather than
`clean` — a failed `git` call is not evidence of a clean tree. That field being
absent is a true statement about this artefact, not a bug to paper over. The
Phase 2 baseline these changes build on is `e252d06` in `morrow v2`; the Stage 3
delta itself has no commit identity yet.

## What is stored

Each trace line is one turn through `sendChat`:

```
scenario, conversationId, messageId            // ids only
inputSha256 (16 hex), inputCharacters          // the user's words are not stored
primaryIntent, intentStatus, speechAct, attributedTo, mayExecute, responseMode
clarificationRequired, clarificationReason
supportingSignals, contradictingSignals, uncertainties, evidenceRefs
assistantOffer, continuationTarget             // which context decided it
payloadSha256, systemCharacters
readingPersisted, algorithmVersion, parameterVersion
```

No provider payload, no reply text, no key material. The reviewer reads the
conversation in the app; the trace says which decision was taken and on what
evidence.

## Scenario families

| Family | What it covers |
|---|---|
| A | the same sentence under different contexts must produce different decisions |
| B | speech act separated from intent (question ≠ request, preference ≠ instruction) |
| C | quotation, hypothesis, negation scope, misread correction |
| D | compound requests, slot filling across turns, change of goal, withdrawal |
| E | unknown stays unknown; "this time only" is not a lasting preference |
| F | mutation: remove the context / add negation / change the subject / inject a tampered reading, and the decision must move |

Every family has at least one **negative** case: a mutation whose whole purpose
is to show that the original assertion is not vacuous.

## Data annotation method

There is no crowdsourced label set. Each scenario carries:

- `requirement` — the sentence in the task that it is accountable to;
- named assertions with a `detail` field that prints the observed value;
- for mutation families, `before` / `after` and `changed`, so a mutation that
  does **not** move the decision is itself a failure.

Because the labels were written by the same person who wrote the rules, the
scenarios are **exploratory examples**, not a benchmark. A rule change that
makes them pass while breaking real conversations would not be detected here.

## Status vocabulary

Mechanism suite: `PASS` / `FAIL` / `BLOCKED` / `NOT_RUN`.

Semantic suite: `AWAITING_MANUAL_REVIEW` (the normal outcome: it ran, it stored
readings, and judgement is still owed) / `FAIL_PRECONDITION` (a mechanical
precondition did not hold, so there is nothing for a human to read) /
`BLOCKED_NO_SECRET` (no credential; nothing was attempted).

`AWAITING_MANUAL_REVIEW` is a status, not a pass. A file in that state that gets
aggregated as a success is a reporting error, not a nuance.
`manualReview.status` is always `PENDING` in this round: grading the output with
the rules that produced it would be self-certification.
