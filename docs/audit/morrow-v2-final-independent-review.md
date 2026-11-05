# Morrow V2 Final Independent Review (PR #54, final HEAD 13ce2a6)

Independent reviewer: separate context; did not write this implementation. No product code, test, migration, CI, doc, or evidence was modified. The only repository writes are this file and `docs/audit/morrow-v2-final-file-review-matrix.md`, both overwritten for this HEAD. Throwaway probes were created only under `.tmp/probe/` and were not committed.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (`E:\Hasee\Documents\morrow v2\zcode\stage3-audit\repo`) |
| Branch | `feat/morrow-v2-final-closure` |
| Frozen final HEAD | `13ce2a6f90d18742d9accc6f55cfd20cf4acd55a` (docs/evidence over the code SHA) |
| Final code/test SHA | `6f5fe47a897fe63b00ec474812abde7cb9ec8f79` |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft, `MERGEABLE`, merge state `UNSTABLE` (final docs-HEAD checks red) |
| PR head SHA (live) | `13ce2a6f90d18742d9accc6f55cfd20cf4acd55a` |
| Code-SHA CI | [41995422882](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41995422882), head `6f5fe47`, conclusion `success`, 4/4 jobs pass; Windows product-path step pass |
| Prior docs-HEAD CI | [41997137337](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41997137337), head `9215cc4`, conclusion `success`, 4/4 jobs pass |
| Frozen-HEAD CI | [42001850336](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/42001850336), head `13ce2a6`, conclusion `failure`: all 4 jobs failed in 2–3 s with 0 steps and no job log. The previous docs HEAD `bb97c9b` run `41999916963` failed the same way. The commit is docs/evidence-only and does not touch `.github/`; the workflow is unchanged since the green run. GitHub status is operational. This is an Actions infrastructure/startup failure, not a code/test failure; reruns reproduce it. |
| Worktree | clean at review start; after writing, only the two review files are modified and uncommitted |

The committed product-path evidence (`20261105T084141Z-45483dd6`, 22 checks, PASS) was produced by code-SHA run `41995422882`. The code-SHA CI is green; the final docs-HEAD CI is red for the infrastructure/startup reason above.

## 1. Verdict

# **PASS_WITH_NON_BLOCKING_BACKLOG** (code review)

**Overall delivery: PARTIAL.** All code P2 findings are closed, the full tests/tsc/build/evaluations pass, no real secret leak was found, and the code-SHA CI `41995422882` is 4/4 green. The delivery is PARTIAL for exactly two blockers:

1. The external Provider quota (`BLOCKED_QUOTA`) and local model service (`BLOCKED_LOCAL_SERVICE_NOT_RUNNING`) remain unavailable.
2. The final docs-HEAD CI is red: run `42001850336` on `13ce2a6` failed all four jobs in 2–3 s with 0 steps and no logs, and the previous docs HEAD `bb97c9b` failed the same way. The workflow is unchanged since the green `9215cc4` run, so this is an Actions infrastructure/startup failure, not a code/test failure. It is still a red required check.

Documentation consistency is **P3 only**: the delivery report header and validation section now reference “PR #54 head” instead of a self-referential docs SHA, and the code SHA / code-SHA CI / product-path evidence are correctly cited. The acceptance matrix header is empty (`最终 HEAD：（docs/evidence）`) and a few other stale lines remain (section 9); they have no code impact.

## 2. P2 closure status

| Prior P2 | Fix | Reproduction / test | Status |
| --- | --- | --- | --- |
| Local provider without token disabled chat | `src/renderer/src/provider-readiness.ts:4-7` `isProviderUsable` allows `sourceKind === 'local'` without a credential; `companion-ui.ts:119,557,601` use it | `tests/provider-readiness.test.ts` 4/4; independent probe 6/6: local no-key `#chat-send.disabled === false`; local + keyless custom keeps chat usable; explicit default custom wins | **CLOSED** |
| UI selection order differed from `requireConfigured()` | `provider-readiness.ts:13-21` `selectChatProvider`: explicit default → local-openai → spark → deepseek → enabled non-official custom; `companion-ui.ts:145` uses it | `tests/provider-readiness.test.ts:33-50`; independent probe shows Local OpenAI selected over Relay A with no default; service priority probe returns `local-openai` | **CLOSED** |
| Provider profile delete had no confirmation | `provider-profiles-ui.ts:151-168` two-step in-page confirmation: first click changes to `确认删除` for 5 s, second deletes | `tests/provider-profiles-ui.test.ts:131-144`; product-path run clicks twice and deletes B | **CLOSED** |
| Continuity fixture lacked messages, self-model, interest/evidence, relationship/evidence | `scripts/product-path-smoke.mjs:389-419` seeds two messages, one self-model entry, one interest + evidence, one relationship thread + evidence after the app stops and before the baseline snapshot | New result `20261105T084141Z-45483dd6`: restart/switch/final `removed=[] changed=[] unexpectedAdded={}`; allowed changes are explicit per-field `deterministic_interest_reconciliation` / `deterministic_evidence_recompute` and `*_at` timestamps; `controlledRequest` says service-level | **CLOSED** for required categories; P3 caveats below |
| Docs presented old SHA/CI as final | Key headers now use “PR #54 head”; code SHA `6f5fe47`, code-SHA CI `41995422882`, and product-path `20261105T084141Z-45483dd6` are cited | Remaining stale lines are P3 only (section 9) | **CLOSED as P2**; P3 cleanup remains |

## 3. UI review after the fixes

### 3.1 Real renderer, references, function preservation

**PASS.** The UI remains the real Electron renderer; the provider-readiness module is renderer-only and does not bypass IPC. The four views, existing IDs, IPC paths, memory/goal/personality/consent/error/danger flows, and the additive self-model panel are preserved. The design is grounded in the supplied Spatial Lab / Agent Desk / Designs Lab / memory-vault references.

### 3.2 Chat send gate

**PASS.** `isProviderUsable` and `selectChatProvider` match the service's `requireConfigured()` order. Independent probes on `6f5fe47`:

- local `enabled: true, apiKeyConfigured: false` → chat enabled;
- local + custom, no default → Local OpenAI selected, chat enabled;
- local + keyless custom → Local OpenAI selected, chat enabled;
- explicit default custom → Relay A selected, chat enabled;
- keyless remote only → chat disabled.

P3 edge: `isProviderUsable` does not re-check loopback for a local profile, so a corrupt/pre-existing non-loopback local row could show ready and fail at request time; normal saves reject it.

### 3.3 Provider delete confirmation

**PASS.** First click arms (`确认删除`, 5 s), second click deletes; the timer disarms; the unit test asserts no bridge call on the first click and a delete on the second. The product path uses two clicks. P3: the armed state is not cleared by other profile actions; the built-in local profile's delete button is enabled even though the service returns FORBIDDEN.

### 3.4 Test readiness marker

`src/renderer/src/provider-profiles-ui.ts:262` sets `document.body.dataset.providerUiReady = 'true'` at module init, and `scripts/product-path-smoke.mjs:182` waits for it instead of the static `aria-busy="false"` attribute. This fixes the product-path race where the static HTML attribute made the wait pass before the module initialized. The marker is not a secret and does not affect the UI. P3: it is a test-only marker exposed in the production DOM and is set before `loadProfiles()` finishes.

### 3.5 Accessibility, layout, screenshots

| Item | Finding | Conclusion |
| --- | --- | --- |
| Navigation semantics | `aria-current="page"` toggled by `shell-ui.ts`; tested. | PASS |
| Live regions/labels | `role=status`/`aria-live` on feedback/state; labels present. | PASS |
| Reduced motion | CSS block plus canvas check; static redraw still runs every rAF. | PASS (P3 performance) |
| Focus visibility | `input[type="range"] { outline: none; }` still overrides global `:focus-visible`; personality sliders have no visible keyboard focus. | P3 |
| Contrast | Dark muted 6.63:1; light muted 4.41:1 on `#f3f0e8` (4.14:1 on `#ede9df`), below AA 4.5:1; design-system claims ~4.9:1. | P3 |
| Long text | No `overflow-wrap`/`word-break` for chat/memory/provider meta; unbroken text can overflow. | P3 |
| 390 layout | `.self-model-grid` remains two columns; nav last item is cut (scrollable); 1280 composer is below the fold. | P3 |
| Screenshots | New run `20261105T084141Z-45483dd6` has 9 real PNGs at 1440/1280/390 for chat/memory/settings; no secrets; no overlap. The set does not show goals/reminders, self-model, or the two-step delete state; memory shows a stale empty list; chat PNG sizes differ slightly from the prior run, settings/memory are byte-identical. | P3 evidence gap |

### 3.6 Consent/provider copy

**PASS for the native consent path.** Fix A still labels official/custom/local correctly and strips userinfo/query/fragment. P3 residuals: `companion-ui.ts:321-322,474` and `index.html:395` still say cognitive state goes in the "DeepSeek 请求"; `app/index.ts:104` still says HTTPS Authorization Bearer for local HTTP; `app/index.ts:77` still exposes `dataPolicy: ...deepseek-egress...`; `index.html:377` says local is "优先于 DeepSeek" without the explicit-default caveat.

## 4. Fix A — consent presentation

| Check | Code / test | Conclusion |
| --- | --- | --- |
| Official/custom/local labels | `src/providers/consent-presentation.ts:46-93`; 6 tests | PASS |
| No DeepSeek/price for custom/local | Same tests | PASS |
| Unknown official price | "计费信息未验证…" | PASS |
| Endpoint sanitization | `sanitizeConsentEndpoint`; save-time `normalizeBaseUrl` rejects userinfo/query/fragment | PASS |
| Same target/model/payload hash | `src/app/index.ts:81-127` consumes one preview | PASS |
| Consent gate not weakened | `provider-policy.ts:91-125` | PASS |
| Residual action binding | `ProviderConsent` has no `action`; hash binds endpoint+body | P3 |

## 5. Fix B — bounded response body

| Check | Code / test | Conclusion |
| --- | --- | --- |
| Real byte counting / cancel | `bounded-body.ts:25-62`; 10 tests | PASS |
| Content-Length not trusted | Missing/understated/overstated tests | PASS |
| Discovery / error hint | `companion-service.ts:442,847`; `openai-compatible.ts:88-90` | PASS with P3: discovery is `1_000_000` bytes, not `1_048_576`; docs still say 1 MiB/1,048,576 |
| UTF-8 split, read/cancel errors, no body | Tests | PASS |
| Error hint no body leak | Only code/type kept; message discarded | PASS |
| Non-stream success | `openai-compatible.ts:332-337` uses unbounded `response.json()` | P3 (not used by production chat) |

## 6. Fix C — continuity

### 6.1 What is seeded and compared

`seedContinuityRows` (`scripts/product-path-smoke.mjs:389-419`) inserts, after the first app stop and before the baseline snapshot:

- two messages (user + assistant) in the seeded conversation;
- one active self-model fact entry;
- one active interest with one support evidence row;
- one active relationship thread with one support evidence row.

The full snapshot covers personality, self-model, interests, memories, goals, relationship, conversations/messages, pending/reflection, feeling state and event journal. `diffFullSnapshots` fails on removed rows, non-allowlisted changed fields and unexpected additions. New result `20261105T084141Z-45483dd6` reports:

| Point | removed | changed | unexpectedAdded |
| --- | --- | --- | --- |
| restart | `[]` | `[]` | `{}` |
| switch A→B→A | `[]` | `[]` | `{}` |
| final A | `[]` | `[]` | `{}` |

Allowed changes are explicit per field: interest `status`, `strength`, `confidence`, `profile_json` with `deterministic_interest_reconciliation`; relationship `strength`, `confidence` with `deterministic_evidence_recompute`; `updated_at` with `normal_maintenance_timestamp`. The seeded interest is written active with one evidence/one conversation; normal reconciliation demotes it to candidate and recomputes strength/confidence. That is an explicit normal interest update, not a silent change. The relationship strength/confidence are recomputed from evidence; status/content are unchanged.

### 6.2 P3 evidence caveats

1. `scripts/product-path-smoke.mjs:604-605` sets `continuityAfterRestart = continuityBefore`; the bridge-level "continuity unchanged across restart" check is tautological. The full-field restart diff is the real check and passes.
2. The fixture does not create a goal task/progress row; the goal row is compared, but the "progress" part of the goals requirement is not exercised.
3. `ALLOWED_ADDITION_TABLES` remains table-level; allowed additions are counted, not content-inspected.
4. Provider B's controlled request is service-level (mock provider), not an Electron request. The result states this explicitly in `limitation` and `controlledRequest`.

### 6.3 Verdict

**PASS for the required continuity categories, with P3 evidence caveats.** Messages, self-model, interest/evidence, and relationship/evidence are present and survive restart/switch/final; removed/changed/unexpected are zero with explicit allowed changes.

## 7. Security / secret verdict

**PASS.** No real API key, Bearer token, Authorization header value, private key, AWS/GitHub/Slack token, or provider response body was found in tracked text or committed evidence.

- Provider-key-shaped prefix matches: 11, all false positives (the `morrow-v2-risk-dependency-register` file name and an evaluation fixture ID; two are in the previous review text).
- `apiKey = "..."` matches: 33, all test/offline literals.
- `Bearer <literal>`: 2, both `test-only-*` in a unit test.
- AWS/GitHub/Slack/private-key patterns: 0.
- Product-path artifact: only SHA-256 digests of OS ciphertext; fixture IDs are random UUIDs; no key/Authorization/body.
- Screenshots: settings shows "密钥：已保存在本机安全存储"; no key text.
- New UI DOM: `dataset` holds profile IDs, `confirm`, and the non-sensitive `providerUiReady` marker; no console logging.

## 8. Product path / screenshots

**PASS for the shown pages; P3 coverage.** New run `20261105T084141Z-45483dd6` has 9 real Windows Electron captures at 1440/1280/390 for chat/memory/settings. They show no secrets and no overlap. The set does not show goals/reminders, self-model, or the two-step delete state; memory shows a stale empty list. Chat PNGs differ slightly from the prior run; settings/memory are byte-identical. The product path deletes B with two clicks and passes; the delete interaction is covered by the unit test and the product-path flow, not by a screenshot.

## 9. Docs and evidence consistency — P3 only

The docs now use “PR #54 head” in the delivery report header and validation section (`docs/reports/morrow-v2-final-delivery-report.md:16` and `:161`) instead of a self-referential docs SHA, and they cite code SHA `6f5fe47`, code-SHA CI `41995422882`, and product-path `20261105T084141Z-45483dd6`. That closes the prior P2 documentation issue. The acceptance matrix header is empty (`最终 HEAD：（docs/evidence）`), which is a P3 cleanup.

A few stale lines remain. They are **P3 only** and have no code impact:

| File / location | Stale line |
| --- | --- |
| `docs/reports/morrow-v2-final-work-log.md:159` | Says `最终 HEAD eede520 CI run PR #54 最新 CI：4/4 PASS`; `eede520` is an old docs commit, and the final docs-HEAD CI is currently red. |
| `docs/reports/morrow-v2-final-evidence-index.md:89` | Says `最终 HEAD 为 （docs/evidence）` with an empty value. |
| `docs/testing/morrow-v2-final-acceptance-matrix.md:4` | Says `最终 HEAD：（docs/evidence）` with an empty value. |
| `docs/reports/morrow-v2-final-delivery-report.md:77` | Says `最终 HEAD 6f5fe47 的 CI 4/4 PASS`; `6f5fe47` is the code SHA, not the final docs HEAD. |
| `docs/reports/morrow-v2-final-delivery-report.md:58` | Calls `41995422882` the "最终运行"; it is the code-SHA CI, not the final docs-HEAD CI. |
| `docs/reports/morrow-v2-final-delivery-report.md:79` | Says `Provider 核心代码此后未变`; false after the A/B provider changes. |
| `docs/reports/morrow-v2-final-delivery-report.md:145` and `docs/testing/morrow-v2-final-acceptance-matrix.md:97` | Say discovery is 1 MiB / 1,048,576 bytes; code uses 1,000,000. |
| `docs/reports/morrow-v2-final-evidence-index.md:66,85,103` | Cite `41995422882` as "CI run" without the code-SHA label; the code-SHA CI is correct, but the final docs-HEAD CI is red. |
| `docs/testing/morrow-v2-final-acceptance-matrix.md:85` | Calls product-path run `20261105T084141Z-45483dd6` a final HEAD CI run; it is a product-path run ID. |
| `docs/ui/acceptance-matrix.md:13-15,24-26,33,39` | Claims self-model/goal screenshots, 390 single-column/no-overflow, keyboard focus and long-text PASS; the new set has no goals/self-model, the self-model grid is two columns, range focus is missing, and long text is not tested. |
| `docs/ui/design-system.md:70` | Claims light muted ~4.9:1; actual 4.41:1 on `#f3f0e8` and 4.14:1 on `#ede9df`. |

The 16 fixed deliverables exist; the optional `evals/morrow-v2-final/ui/<run-id>/` was not needed. Test counts (128 files / 1153 tests) match the local run.

## 10. Commands and exit codes

All commands were run at `6f5fe47` (the final code SHA; `13ce2a6` is docs/evidence-only over it). `TEMP`/`TMP` were set to `<repo>/.tmp/es`.

| Command | Result | Exit |
| --- | --- | --- |
| `npx tsc --noEmit` | no output | 0 |
| `TEMP=... TMP=... npx vitest run` | 128 files / 1153 tests passed, 0 skipped, 158.61s | 0 |
| `npm run build` | main 953.78 kB, preload 10.61 kB, renderer JS 119.97 kB, CSS 30.36 kB | 0 |
| `TEMP=... TMP=... npx vitest run <8 targeted A/B/UI/readiness/continuity files>` | 8 files / 43 tests passed | 0 |
| `TEMP=... TMP=... npx vitest run <8 Stage 4/provider files>` | 8 files / 61 tests passed | 0 |
| `TEMP=... TMP=... npm run evaluate` | M3/M4 pass | 0 |
| `TEMP=... TMP=... npm run evaluate:cognition` | cognitive/feeling/alpha/intent pass | 0 |
| `TEMP=... TMP=... npx vitest run --config .tmp/probe/vitest.config.ts .tmp/probe/companion-gate.test.ts .tmp/probe/provider-priority.test.ts` | 2 files / 7 tests passed | 0 |
| `gh pr view 54` | OPEN, MERGEABLE, UNSTABLE, head `13ce2a6` | 0 |
| `gh pr checks 54` | final docs HEAD `13ce2a6` run `42001850336`: 4/4 fail (0 steps, 2–3 s); prior docs HEAD `9215cc4` run `41997137337`: 4/4 pass; code SHA `6f5fe47` run `41995422882`: 4/4 pass | 0 |
| `git status --porcelain` (before writing) | empty | 0 |
| `git status --porcelain` (after writing) | only the two review files modified, uncommitted | 0 |

## 11. Residual P3 backlog

1. Final docs-HEAD CI infrastructure/startup failure: runs `42001850336` (`13ce2a6`) and `41999916963` (`bb97c9b`) fail all jobs in 2–3 s with 0 steps and no logs; workflow unchanged since the green `9215cc4` run; code-SHA CI `41995422882` is green. This is a delivery blocker (section 1) and a P3 documentation note for the evidence index.
2. Stale docs lines in section 9 (P3 only).
3. Range inputs have `outline: none` with no focus replacement (`style.css:363` vs `:75`).
4. Light-theme muted text contrast is 4.41:1 on the page background (4.14:1 on `--bg-soft`).
5. No `overflow-wrap`/`word-break` for chat/memory/provider meta.
6. `.self-model-grid` remains two columns at 390; the 390 nav last item is cut; the 1280 composer is below the fold.
7. The two-step delete's armed state is not cleared by other profile actions; the built-in local profile's delete button is enabled but the service returns FORBIDDEN.
8. Provider profile save has no "saving" state; discover has no loading state; reset does not clear old feedback.
9. Cognitive settings copy and local provider "priority" copy still name DeepSeek; the consent detail's HTTPS sentence is wrong for local HTTP; `dataPolicy` still contains `deepseek-egress`.
10. Discovery uses 1,000,000 bytes, not 1,048,576; docs are inconsistent.
11. Non-stream success `response.json()` is unbounded (not used by production chat).
12. Continuity allowlist is table-level for additions and broad for `*_at`; the bridge restart check is tautological; goal progress is not seeded.
13. Screenshots lack goals/reminders and self-model; memory shows a stale empty list; the new two-step delete is not captured.
14. Presence canvas redraws every rAF even under reduced motion and calls `getComputedStyle` per frame.
15. The new self-model panel has no loading state and does not disable actions during a request.
16. `isProviderUsable` does not re-check loopback for a local profile; a corrupt/pre-existing non-loopback row could show ready then fail.
17. `provider-profiles-ui.ts:262` exposes a test-only `data-provider-ui-ready` marker in the production DOM and sets it before `loadProfiles()` completes.

## 12. Final statement

**Code review: PASS_WITH_NON_BLOCKING_BACKLOG. Overall delivery: PARTIAL.** All code P2s are closed and independently reproduced: local no-token chat works, selection mirrors `requireConfigured()`, provider delete has a two-step confirmation, and the continuity fixture now seeds messages/self-model/interest/evidence/relationship/evidence with full-field diffs passing and explicit allowed changes. `tsc`, 128 files / 1153 tests, build and evaluations pass; no real secret was found. The code-SHA CI `41995422882` is 4/4 green.

The delivery is PARTIAL for exactly two blockers: the external Provider quota/local model service, and the final docs-HEAD CI infrastructure failure (`42001850336` on `13ce2a6`, `41999916963` on `bb97c9b`: all jobs fail in 2–3 s with 0 steps and no logs; the workflow is unchanged since the green `9215cc4` run). Docs consistency is P3 only: the delivery report header uses “PR #54 head” and cites code `6f5fe47`, code-SHA CI `41995422882`, and product-path `20261105T084141Z-45483dd6`; the acceptance matrix header is empty and the remaining stale lines are listed in section 9, with no code impact. Do not merge or release until the docs-HEAD CI infrastructure issue is resolved or explicitly accepted by the user and the P3 docs lines are cleaned up.
