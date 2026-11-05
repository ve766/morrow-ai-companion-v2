# Morrow V2 Final Independent Review (PR #54, re-review after P2 fixes)

Independent reviewer: separate context; did not write this implementation. No product code, test, migration, CI, doc, or evidence was modified. The only repository writes are this file and `docs/audit/morrow-v2-final-file-review-matrix.md`, both overwritten for this HEAD. Throwaway probes were created only under `.tmp/probe/` and were not committed.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (`E:\Hasee\Documents\morrow v2\zcode\stage3-audit\repo`) |
| Branch | `feat/morrow-v2-final-closure` |
| Final candidate HEAD | `140fd303f700e8bb4761c653aa6492c4ee9ddb9b` (docs/evidence only over the code SHA) |
| Final code/test SHA | `8797ab9e2dea171a159d92c349babeb4180dbf84` |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft, `MERGEABLE`, merge state `CLEAN` |
| PR head SHA (live) | `140fd303f700e8bb4761c653aa6492c4ee9ddb9b` |
| Final HEAD CI | [41986955154](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41986955154), head `140fd30`, conclusion `success`, 4/4 jobs pass |
| Code-SHA CI | [41984709521](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41984709521), head `8797ab9`, conclusion `success`, 4/4 jobs pass; Windows product-path step pass |
| Worktree | clean at review start; after writing, only the two review files are modified and uncommitted |

Final HEAD CI jobs (`gh pr checks 54`):

| Job | Result | URL |
| --- | --- | --- |
| Typecheck, tests, build and smoke (ubuntu-latest) | pass (3m34s) | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41986955154/job/127109837218 |
| Typecheck, tests, build and smoke (windows-latest) | pass (8m59s) | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41986955154/job/127109837258 |
| Windows package, install and installed-app smoke | pass (3m27s) | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41986955154/job/127109836914 |
| Windows upgrade path (schema migrations under the real app) | pass (1m37s) | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41986955154/job/127109837363 |

The committed product-path evidence (`20261105T071402Z-608ab4c9`, 22 checks, PASS) was produced by run `41984709521` at the code SHA. The final HEAD run `41986955154` also executed the Windows product-path step successfully.

## 1. Verdict

# **PARTIAL** (overall delivery)

**Code review: PASS_WITH_NON_BLOCKING_BACKLOG.** All four code P2 findings from the previous review are closed and independently reproduced. The remaining code issues are P3.

**Overall: PARTIAL.** One P2 documentation-consistency finding remains open: the repository docs still name `8797ab9` as the final HEAD and `41984709521` as the final CI run; the actual final HEAD `140fd30` and its green run `41986955154` are not recorded, and the evidence index still calls `20261104T154241Z` "final code SHA evidence". External provider quota and the local model service also remain blocked. If the docs are corrected to the actual final HEAD/CI, the code verdict is `PASS_WITH_NON_BLOCKING_BACKLOG`; delivery stays PARTIAL only for the external provider/local-service blockers.

## 2. P2 closure status

| Prior P2 | Fix | Reproduction / test | Status |
| --- | --- | --- | --- |
| Local provider without token disabled chat | `src/renderer/src/provider-readiness.ts:4-7` `isProviderUsable` allows `sourceKind === 'local'` without a credential; `companion-ui.ts:119,557,601` use it for readiness, submit guard and re-enable | `tests/provider-readiness.test.ts` 4/4; independent `companion-gate` probe 6/6: local no-key `#chat-send.disabled === false`; local + keyless custom keeps chat usable; explicit default custom wins | **CLOSED** |
| UI selection order differed from `requireConfigured()` | `provider-readiness.ts:13-21` `selectChatProvider`: explicit default → local-openai → spark → deepseek → enabled non-official custom; `companion-ui.ts:145` uses it | `tests/provider-readiness.test.ts:33-50` covers default/local/spark/deepseek/custom/disabled default; independent probe shows Local OpenAI selected over Relay A with no default; service priority probe still returns `local-openai` | **CLOSED** |
| Provider profile delete had no confirmation | `src/renderer/src/provider-profiles-ui.ts:151-168` two-step in-page confirmation: first click changes the button to `确认删除` for 5 s, second click deletes; `dataset.confirm` and timeout reset | `tests/provider-profiles-ui.test.ts:131-144` asserts first click does not call `deleteProfile`, text is `确认删除`, second click deletes; product-path run clicks twice (150 ms apart) and deletes B | **CLOSED** |
| Continuity fixture lacked messages, self-model, interest/evidence, relationship/evidence; Provider B only service-level | `scripts/product-path-smoke.mjs:389-419` seeds two messages, one self-model entry, one interest + evidence, one relationship thread + evidence after the app is stopped and before the baseline snapshot; full-field diff compares restart/switch/final | New result `20261105T071402Z-608ab4c9`: `removed=[] changed=[] unexpectedAdded={}` at all three points; allowed changes are explicit `deterministic_interest_reconciliation` / `deterministic_evidence_recompute` fields and `*_at` maintenance timestamps, listed per field in JSON; `controlledRequest` explicitly says `mode: service-level` | **CLOSED** for the required categories; P3 caveats below |
| Docs presented old SHA/CI as final | Docs were updated to `8797ab9` / `41984709521` / product-path `20261105T071402Z` | Actual final HEAD is `140fd30` and final HEAD CI is `41986955154`; neither appears anywhere in `docs/` or `evals/`. `docs/reports/morrow-v2-final-delivery-report.md:16` calls `8797ab9` the final HEAD; `docs/reports/morrow-v2-final-evidence-index.md:89` does the same; `docs/reports/morrow-v2-final-work-log.md:159` still calls `771cbaa` the final HEAD with run `41984709521`; `docs/reports/morrow-v2-final-evidence-index.md:68` still calls `20261104T154241Z` final code evidence | **OPEN P2** |

## 3. UI review after the fixes

### 3.1 Real renderer, references, and function preservation

**PASS.** The UI remains the real Electron renderer; the new provider-readiness module is renderer-only and does not bypass IPC. The four views, existing IDs, IPC paths, memory/goal/personality/consent/error/danger flows, and the additive self-model panel are preserved. The design is grounded in the supplied Spatial Lab / Agent Desk / Designs Lab / memory-vault references, with the exact token palettes and no external runtime.

### 3.2 Chat send gate

**PASS.** The gate now uses `isProviderUsable` and `selectChatProvider`, matching the service's `requireConfigured()` order. Independent probe results on `140fd30`:

- local `enabled: true, apiKeyConfigured: false` → chat enabled;
- local + custom, no default → Local OpenAI selected, chat enabled;
- local + keyless custom → Local OpenAI selected, chat enabled;
- explicit default custom → Relay A selected, chat enabled;
- keyless remote only → chat disabled.

The service priority probe still returns `local-openai` with local and custom enabled and no default. No target mismatch remains in the tested configurations. P3 edge: `isProviderUsable` does not re-check loopback for a local profile, so a corrupt/pre-existing non-loopback local row could show ready and then fail at request time; normal saves reject it.

### 3.3 Provider delete confirmation

**PASS.** First click arms (`确认删除`, 5 s), second click deletes; the timer disarms the button; the unit test asserts the first click does not call the bridge and the second does. P3: the armed state is not cleared if another profile action is used first; the built-in local profile's delete button is still enabled even though the service returns FORBIDDEN.

### 3.4 Accessibility, layout, screenshots

| Item | Finding | Conclusion |
| --- | --- | --- |
| Navigation semantics | `aria-current="page"` toggled by `shell-ui.ts`; tested. | PASS |
| Live regions/labels | `role=status`/`aria-live` on feedback/state; labels present. | PASS |
| Reduced motion | CSS block plus canvas check; static redraw still runs every rAF. | PASS (P3 performance) |
| Focus visibility | `input[type="range"] { outline: none; }` still overrides global `:focus-visible`; the three personality sliders have no visible keyboard focus. | P3 |
| Contrast | Dark muted 6.63:1; light muted 4.41:1 on `#f3f0e8` (4.14:1 on `#ede9df`), below AA 4.5:1; design-system claims ~4.9:1. | P3 |
| Long text | No `overflow-wrap`/`word-break` for chat/memory/provider meta; unbroken text can overflow. | P3 |
| 390 layout | `.self-model-grid` remains two columns; nav last item is cut (scrollable); 1280 composer is below the fold. | P3 |
| Screenshots | New run `20261105T071402Z-608ab4c9` has 9 real PNGs; all 9 are byte-identical to the prior `20261105T034317Z-8dc025dc` set. They show no secrets and no overlap, but do not capture the new two-step delete state; no goals/reminders or self-model screenshots; memory still shows the empty state despite the seeded memory. | P3 evidence gap |

### 3.5 Consent/provider copy

**PASS for the native consent path.** Fix A still labels official/custom/local correctly and strips userinfo/query/fragment. P3 residuals: `companion-ui.ts:321-322,474` and `index.html:395` still say cognitive state goes in the "DeepSeek 请求"; `app/index.ts:104` still says HTTPS Authorization Bearer for local HTTP; `app/index.ts:77` still exposes `dataPolicy: ...deepseek-egress...`; `index.html:377` says local is "优先于 DeepSeek" without the explicit-default caveat.

## 4. Fix A — consent presentation

| Check | Code / test | Conclusion |
| --- | --- | --- |
| Official/custom/local labels | `src/providers/consent-presentation.ts:46-93`; 6 tests | PASS |
| No DeepSeek/price for custom/local | Same tests | PASS |
| Unknown official price | "计费信息未验证…" | PASS |
| Endpoint sanitization | `sanitizeConsentEndpoint`; save-time `normalizeBaseUrl` rejects userinfo/query/fragment | PASS |
| Same target/model/payload hash | `src/app/index.ts:81-127` consumes one preview | PASS |
| Consent gate not weakened | `provider-policy.ts:91-125` still requires matching hash, provider, lifetime and sensitive flag | PASS |
| Residual action binding | `ProviderConsent` has no `action`; hash binds endpoint+body | P3 |

## 5. Fix B — bounded response body

| Check | Code / test | Conclusion |
| --- | --- | --- |
| Real byte counting / cancel | `bounded-body.ts:25-62`; 10 tests | PASS |
| Content-Length not trusted | Missing/understated/overstated tests | PASS |
| Discovery / error hint | `companion-service.ts:442,847`; `openai-compatible.ts:88-90` | PASS with P3: discovery is `1_000_000` bytes, not `1_048_576`; docs still say 1,048,576/1 MiB |
| UTF-8 split, read/cancel errors, no body | Tests | PASS |
| Error hint no body leak | Only code/type kept; message discarded | PASS |
| Non-stream success | `openai-compatible.ts:332-337` uses unbounded `response.json()` | P3 (not used by production chat) |

## 6. Fix C — continuity

### 6.1 What is now seeded and compared

`seedContinuityRows` (`scripts/product-path-smoke.mjs:389-419`) inserts, after the first app stop and before the baseline snapshot:

- two messages (user + assistant) in the seeded conversation;
- one active self-model fact entry;
- one active interest with one support evidence row;
- one active relationship thread with one support evidence row.

The full snapshot (`snapshotFullDatabase`) still covers personality, self-model, interests, memories, goals, relationship, conversations/messages, pending/reflection, feeling state and event journal. `diffFullSnapshots` fails on removed rows, non-allowlisted changed fields and unexpected additions. The new result `20261105T071402Z-608ab4c9` reports:

| Point | removed | changed | unexpectedAdded |
| --- | --- | --- | --- |
| restart | `[]` | `[]` | `{}` |
| switch A→B→A | `[]` | `[]` | `{}` |
| final A | `[]` | `[]` | `{}` |

Allowed changes are explicit and per field: interest `status`, `strength`, `confidence`, `profile_json` with `deterministic_interest_reconciliation`; relationship thread `strength`, `confidence` with `deterministic_evidence_recompute`; `updated_at` with `normal_maintenance_timestamp`. Allowed additions are startup reflection/interest/event rows. The seeded interest is written as active with one evidence/one conversation; the normal reconciliation demotes it to candidate and recomputes strength/confidence. That is a normal interest update, explicitly allowlisted, so it is not a silent change. The seeded relationship thread's strength/confidence are recomputed from its evidence; status/content are unchanged.

### 6.2 P3 evidence caveats

1. `scripts/product-path-smoke.mjs:604-605` sets `continuityAfterRestart = continuityBefore`; the bridge-level "continuity unchanged across restart" check is tautological. The full-field restart diff is the real check and passes; the bridge hash block (`baselineSha256 == afterRestartSha256`) should not be read as independent restart evidence.
2. The fixture does not create a goal task/progress row; the goal row is compared, but the "progress" part of the task's goals requirement is not exercised.
3. `ALLOWED_ADDITION_TABLES` remains table-level; allowed additions are counted, not content-inspected. The task's explicit per-item allowlist requirement is met for changed fields, less so for added rows.
4. Provider B's controlled request is still service-level (mock provider), not an Electron request. The result now states this explicitly in `limitation` and `controlledRequest`; it is not misrepresented as a full product-path request.

### 6.3 Verdict

**PASS for the required continuity categories, with P3 evidence caveats.** The prior P2 fixture gap is closed: messages, self-model, interest/evidence, and relationship/evidence are now present and survive restart/switch/final. The tautological bridge restart check and missing goal progress are P3.

## 7. Security / secret verdict

**PASS.** No real API key, Bearer token, Authorization header value, private key, AWS/GitHub/Slack token, or provider response body was found in tracked text or committed evidence.

- Provider-key-shaped prefix matches: 11, all false positives (the `morrow-v2-risk-dependency-register` file name and an evaluation fixture ID; two are in the previous review text itself).
- `apiKey = "..."` matches: 33, all test/offline literals (`offline-*`, `test-only-*`, `test-key-*`, `synthetic-*`, `replacement-*`, `key-0123`).
- `Bearer <literal>`: 2, both `test-only-*` in `src/providers/openai-compatible.test.ts`.
- AWS/GitHub/Slack/private-key patterns: 0.
- Product-path artifact: only SHA-256 digests of OS ciphertext; `continuityFixture` IDs are random UUIDs; no key/Authorization/body.
- Screenshots: settings shows "密钥：已保存在本机安全存储"; no key text.
- New UI DOM: `dataset` holds profile IDs and `confirm`, not secrets; no console logging in the new modules.

## 8. Product path / screenshots

**PASS for the shown pages; P3 coverage.** New run `20261105T071402Z-608ab4c9` has 9 real Windows Electron captures at 1440/1280/390 for chat/memory/settings. All 9 are byte-identical to the prior `20261105T034317Z-8dc025dc` set; no secrets; no overlap. The set does not show goals/reminders, self-model, or the two-step delete state; memory shows a stale empty list. The product path itself now deletes B with two clicks and passes; the delete interaction is covered by the unit test and the product-path flow, not by a screenshot.

## 9. Docs and evidence consistency

**OPEN P2.** The new code/evidence SHA and product-path run are correctly cited in many places, but the final HEAD/CI are still wrong or missing:

| File / location | Problem |
| --- | --- |
| `docs/reports/morrow-v2-final-delivery-report.md:16` | Calls `8797ab9` the "最终 HEAD"; actual final HEAD is `140fd30`. |
| `docs/reports/morrow-v2-final-delivery-report.md:58,77,161` | Cites final CI `41984709521` (code SHA); final HEAD run `41986955154` is not mentioned. Line 77 calls `8797ab9` the final HEAD. |
| `docs/reports/morrow-v2-final-delivery-report.md:79` | Says provider code is unchanged after `c1f4450`; false after the A/B and UI fixes. |
| `docs/reports/morrow-v2-final-delivery-report.md:145` | Says discovery is 1,048,576 bytes; code is 1,000,000. |
| `docs/reports/morrow-v2-final-evidence-index.md:66,85,89,103` | Cites CI `41984709521` and calls `8797ab9` the final HEAD; `140fd30`/`41986955154` absent. |
| `docs/reports/morrow-v2-final-evidence-index.md:67-68` | Calls the code-SHA product-path evidence "最终 HEAD PASS 证据"; line 68 still calls `20261104T154241Z` "最终代码 SHA 证据". |
| `docs/reports/morrow-v2-final-work-log.md:159` | Calls `771cbaa` the final HEAD with run `41984709521`; both are wrong for this HEAD. |
| `docs/testing/morrow-v2-final-acceptance-matrix.md:3,21,84` | Header uses code SHA `8797ab9` without final HEAD; CI row uses `41984709521`; line 84 calls product-path run `20261105T071402Z` a final HEAD CI run (it is a product-path run ID). |
| `docs/testing/morrow-v2-final-acceptance-matrix.md:56,96` | Row 4.4 still says personality version/relationship/message content are only table counts; discovery row says 1 MiB (code is 1,000,000). |
| `docs/ui/acceptance-matrix.md:13-15,24-26,33,39` | Claims self-model/goal screenshots, 390 single-column/no-overflow, native dialog for the provider delete, keyboard focus and long-text PASS; the new screenshot set has no goals/self-model, the self-model grid is two columns, the delete is an in-page two-step, range focus is missing, and long text is not tested. |
| `docs/ui/design-system.md:70` | Claims light muted ~4.9:1; actual 4.41:1 on `#f3f0e8` and 4.14:1 on `#ede9df`. |
| `docs/ui/current-ui-audit.md:46` | Says dangerous actions retain confirm; the provider delete now has an in-page two-step (functionally true, but not a native confirm). |

The 16 fixed deliverables exist. The optional `evals/morrow-v2-final/ui/<run-id>/` was not needed. Test counts in the updated sections (128 files / 1153 tests) match the local run. The final HEAD CI `41986955154` is green; the docs must record it.

## 10. Commands and exit codes

All commands were run at `140fd30` with a clean worktree. `TEMP`/`TMP` were set to `<repo>/.tmp/es`.

| Command | Result | Exit |
| --- | --- | --- |
| `npx tsc --noEmit` | no output | 0 |
| `TEMP=... TMP=... npx vitest run` | 128 files / 1153 tests passed, 0 skipped, 159.85s | 0 |
| `npm run build` | main 953.78 kB, preload 10.61 kB, renderer JS 119.90 kB, CSS 30.36 kB | 0 |
| `TEMP=... TMP=... npx vitest run <8 targeted A/B/UI/readiness/continuity files>` | 8 files / 43 tests passed | 0 |
| `TEMP=... TMP=... npx vitest run <8 Stage 4/provider files>` | 8 files / 61 tests passed | 0 |
| `TEMP=... TMP=... npm run evaluate` | M3/M4 pass | 0 |
| `TEMP=... TMP=... npm run evaluate:cognition` | cognitive/feeling/alpha/intent pass | 0 |
| `TEMP=... TMP=... npx vitest run --config .tmp/probe/vitest.config.ts .tmp/probe/companion-gate.test.ts` | 6/6 pass (local no-key, local/custom order, keyless custom, default custom, keyless remote) | 0 |
| `TEMP=... TMP=... npx vitest run --config .tmp/probe/vitest.config.ts .tmp/probe/provider-priority.test.ts` | 1/1 pass; service picks local over custom | 0 |
| `gh pr view 54` | OPEN, MERGEABLE, CLEAN, head `140fd30` | 0 |
| `gh pr checks 54` | 4/4 pass | 0 |
| `git status --porcelain` (before writing) | empty | 0 |
| `git status --porcelain` (after writing) | only the two review files modified, uncommitted | 0 |

## 11. Residual P3 backlog

1. Range inputs have `outline: none` with no focus replacement (`style.css:363` vs `:75`).
2. Light-theme muted text contrast is 4.41:1 on the page background (4.14:1 on `--bg-soft`).
3. No `overflow-wrap`/`word-break` for chat/memory/provider meta.
4. `.self-model-grid` remains two columns at 390; the 390 nav last item is cut; the 1280 composer is below the fold.
5. The two-step delete's armed state is not cleared by other profile actions; the built-in local profile's delete button is enabled but the service returns FORBIDDEN.
6. Provider profile save has no "saving" state; discover has no loading state; reset does not clear old feedback.
7. Cognitive settings copy and local provider "priority" copy still name DeepSeek; the consent detail's HTTPS sentence is wrong for local HTTP; `dataPolicy` still contains `deepseek-egress`.
8. Discovery uses 1,000,000 bytes, not 1,048,576; docs are inconsistent.
9. Non-stream success `response.json()` is unbounded (not used by production chat).
10. Continuity allowlist is table-level for additions and broad for `*_at`; the bridge restart check is tautological; goal progress is not seeded.
11. Screenshots lack goals/reminders and self-model; memory shows a stale empty list; the new two-step delete is not captured.
12. Presence canvas redraws every rAF even under reduced motion and calls `getComputedStyle` per frame.
13. The new self-model panel has no loading state and does not disable actions during a request.
14. `isProviderUsable` does not re-check loopback for a local profile; a corrupt/pre-existing non-loopback row could show ready then fail.

## 12. Final statement

**Overall PARTIAL; code PASS_WITH_NON_BLOCKING_BACKLOG.** All four prior code P2s are closed and independently reproduced: local no-token chat works, selection mirrors `requireConfigured()`, provider delete has a two-step confirmation, and the continuity fixture now seeds messages/self-model/interest/evidence/relationship/evidence with full-field diffs passing and explicit allowed changes. CI is green on both `140fd30` (4/4) and `8797ab9` (4/4); `tsc`, 128 files / 1153 tests, build and evaluations pass; no real secret was found.

The only open P2 is documentation consistency: the repo docs still name `8797ab9` as the final HEAD and `41984709521` as the final CI run, do not mention `140fd30`/`41986955154`, and still call `20261104T154241Z` final code evidence. Correct those references and the delivery can move to PASS_WITH_NON_BLOCKING_BACKLOG for the code; the delivery status remains PARTIAL while the external Provider quota and local model service are unavailable. Do not merge or release until the docs are corrected and the user reviews.
