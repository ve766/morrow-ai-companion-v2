# C1 intent understanding — reproducible harness

> **What this proves and what it does not.**
> The provider is a scripted string. This harness therefore proves that the
> mechanism is wired through the production send path, the production database
> and the production prompt assembly, and that decisions *differ* where they
> must. It does **not** measure language understanding, and no result file here
> may be quoted as an accuracy figure.

## Run

```bash
MORROW_EVAL_SHA=<code sha> npm run eval:stage3:intent
```

Optional: omit `MORROW_EVAL_SHA` and the runner asks git for HEAD; with no git it
records `unknown`.

Outputs (never overwriting earlier runs):

- `results/<UTC timestamp>-<short sha>.json`
- `traces/<UTC timestamp>-<short sha>.jsonl`

Exit code is `1` when any scenario fails, so CI can gate on it.

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

`PASS` / `FAIL` / `BLOCKED` / `NOT_RUN`. `manualReview.status` is always
`PENDING` in this round: grading the output with the rules that produced it would
be self-certification.
