# Stage 2 hardening delivery record

Date: 2026-10-29 (UTC)

## Scope

This change set is an isolated hardening layer on top of `feat/cognitive-loop-v1-phase2-4-continuity`. It does not change `main`, merge any existing stacked PR, or publish a release.

## Changes implemented

1. **Turn-context compatibility**
   - New turn-context records are written with schema version 2.
   - The read validator accepts both the existing version 1 shape and version 2, and rejects unknown versions.
   - Regression test covers v1 compatibility and unknown-version rejection.

2. **Deletion boundary for derived cognition**
   - Migration 19 installs database triggers.
   - Deleting a source message deletes self-model entries and interest records tied to that source message.
   - Deleting a conversation removes its turn-context records, pending cognition items, and persisted turn-finalization intents.
   - Regression test creates linked records and verifies they are removed when the source conversation is deleted.

3. **Bounded reflection in the completed-turn path**
   - The app now passes the existing ReflectionService into the self-model loop.
   - Reflection is invoked only after an assistant turn has been persisted.
   - The service's existing hourly run limit remains the guard; reflection errors are contained and do not invalidate a delivered reply.
   - Regression test verifies the hook runs after a successful turn.

4. **Sanitized degradation telemetry**
   - Cognitive adjunct failures are recorded as `cognition.degraded` events with a component name and stable reason code.
   - No exception text, prompt, provider payload, or user content is added to the event.
   - Telemetry failure is itself contained and cannot break chat.

## Validation status

- Source and regression tests are committed on the isolated branch.
- GitHub Actions run for the first PR head failed before any job steps were reported; the connector returned no job logs. A rerun was requested. Do not interpret this as a code-level test failure or as a passing run until the workflow produces actual step output.
- This record does **not** claim local typecheck/test/build/smoke success; this environment has not executed the repository test suite.
- Real-provider S1–S6 and Electron desktop smoke remain external release gates. The previously audited Stage 1 status remains **BLOCKED** until those checks run with valid credentials and a functioning desktop runtime.

## Review checklist before merge

- [ ] CI typecheck passes.
- [ ] All unit and integration tests pass, including migration and turn-context compatibility tests.
- [ ] Build and smoke pass on Linux and Windows.
- [ ] Windows upgrade-path test confirms migration 19 is applied safely.
- [ ] Review migration 19 on a copy of a real v18 database.
- [ ] Run real-provider S1–S6 and Electron desktop smoke with actual credentials.
- [ ] Review PR diff and merge only after all required gates pass.

## Remaining known boundaries

- Reflection is rule/event-based and rate-limited; it is not model-based introspection and does not autonomously rewrite personality.
- This hardening change does not resolve the previously observed Electron renderer/main-process startup failure or supply real-provider credentials.
- No release or merge has been performed.
