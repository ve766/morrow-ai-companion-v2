# Autonomous investigation lifecycle

Implementation: `src/self-model/investigation.ts`, schema v59
(`morrow_investigations`, `morrow_investigation_steps`), scheduler wiring in
`src/app/index.ts`.

This is a **local, bounded** investigation workflow. It does not browse the
web, write files or call tools. It records and constrains what Morrow does with
its own uncertainty so the process can survive a restart and be reviewed.

## 1. States and transitions

```
discovered -> selected -> hypothesized -> investigating -> reviewing
                                                        -> concluded
                                                        -> inconclusive
                                                        -> rejected
                                                        -> suspended
suspended  -> selected | investigating | rejected
```

Terminal states (`concluded`, `inconclusive`, `rejected`) accept no further
transitions. Every transition increments `state_version` with an optimistic
`WHERE state_version = ?` guard and appends a step row. A concurrent writer
that lost the version race gets a storage error instead of overwriting.

`begin()` walks `discovered → selected → hypothesized` in one transaction and
persists:

- the thought id (unique; one investigation per thought),
- trigger and question,
- primary hypothesis (the thought's own hypothesis),
- at least one alternative hypothesis (default: same-source repetition; a
  user-adaptation explanation),
- the full priority component vector and score,
- a budget (`maxSteps` 1–20, default 6; deadline default +24h).

## 2. Priority

The agreed formula is unchanged:

```
P = clamp(0.20·I + 0.20·G + 0.20·U + 0.15·N + 0.15·R − 0.10·C, 0, 1)
```

| Symbol | Meaning | Source |
| --- | --- | --- |
| I | information gap | thought trigger (0.55 interest, 0.70 stalled goal, 0.60 reflection) |
| G | goal-stall pressure | real `CompanionGoal` days since last progress / 14, capped at 1 |
| U | Morrow-owned interest relevance | `interests.activeForContext` filtered to `origin='morrow'`, strength |
| N | reflection novelty | 0.7 when the trigger is a reflection finding |
| R | executability / local resource availability | `max(0, 1 − openInvestigations/10)` in the scheduler |
| C | repetition and cost penalty | thoughts created in the last 24h / 3, capped at 1 |

Each input is clamped to [0,1]. The vector is stored in
`components_json`; nothing in the UI or report presents the score as a
probability.

## 3. Evidence and contradictions

`recordEvidence()` only accepts a step in `hypothesized` or `investigating`.

- A non-synthetic source id must exist in `event_journal`, `memories` or
  `self_model_entries`; otherwise it is counted as rejected and the step is
  marked `source_valid=0`, `failure_reason=source_invalid`.
- A synthetic discovery is accepted as a marker but carries `synthetic=true`.
  It never counts as an independent experience.
- Evidence/contradiction lists are capped at 40 each; confidence is a bounded
  heuristic `0.5 + 0.1·min(2, nonSynthetic) − 0.15·contradictions`, clamped to
  [0,1], not a calibrated probability.

## 4. Review, stop and recovery

- `reviewFromState()` matches an open investigation by question overlap and
  walks it to `reviewing`, then maps the self-state outcome:
  `active → concluded`, `candidate → inconclusive`,
  `weakened/conflict_pending → rejected`.
- `reviewDue()` in `InnerCognitionService` is the existing thought review; the
  scheduler calls both in the same pass.
- `recover()` suspends any non-terminal record whose deadline passed with
  `failure_reason=deadline_exceeded`; a suspended record can be resumed to
  `selected`.
- Failure experience is a step and an event; it is not written into
  personality or a self-fact.

## 5. Ownership rules

- Only `origin='morrow'` interests enter synthesis; user/shared interests are
  filtered before the question is formed.
- `begin()` refuses a thought whose evidence refs contain a non-Morrow origin.
- Goal stalls come from `CompanionGoalService.list({status:'active'})` and the
  last progress row; the scheduler does not pass an empty placeholder.

## 6. What is still missing

The state machine is durable and wired, but it has no autonomous evidence
collector inside this task's scope: there is no web/file tool, so evidence is
entered by a local caller. `reviewFromState` closes records from thought
review. This is why F5 is PARTIAL rather than a claim of an autonomous
researcher.
