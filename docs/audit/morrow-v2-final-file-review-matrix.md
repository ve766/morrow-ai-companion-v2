# Morrow V2 Final File Review Matrix (PR #54, code SHA df8f802)

- Final code/test SHA: `df8f8020d3a9f90b17ed43796a72b99cc497a512`
- Final docs HEAD: the commit containing this review (docs/evidence over the code SHA)
- Base: `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- PR #54 head at review: `df8f8020d3a9f90b17ed43796a72b99cc497a512`, `OPEN`, `MERGEABLE`, `UNSTABLE`
- Last green code-SHA CI: run `41995422882` (head `6f5fe47`, parent code), 4/4 PASS (Windows product-path step pass)
- New code-SHA CI: run `42005665855` (head `df8f802`), **failure**: all 4 jobs failed in 2 s with 0 steps and no job log (Actions infrastructure/startup failure; workflow unchanged; GitHub status operational)
- Prior docs-HEAD CI: run `41997137337` (head `9215cc4`), 4/4 PASS
- Diff vs base: 233 files changed, 24,825 insertions, 1,234 deletions.
- Worktree: code/tests clean; three final report/testing docs have uncommitted external edits; this review writes only the two review files.

Legend: **PASS** = reviewed and consistent with the task; **PASS+P3** = reviewed with a non-blocking residual; **P2** = open code/data blocking finding; **HISTORICAL** = prior-stage evidence retained, not final-SHA proof. Documentation stale lines are **P3 only** for this final HEAD because the key headers reference “PR #54 head” and the code SHA / parent code-SHA CI / product-path evidence are cited.

## 1. Production files changed vs base

| # | File | Change reviewed | Conclusion |
| --- | --- | --- | --- |
| 1 | `.github/workflows/ci.yml` | Windows product-path only; package/install/upgrade jobs; artifact upload. | PASS — parent code-SHA run `41995422882` and prior docs-HEAD run `41997137337` are 4/4; new `df8f802` run `42005665855` failed at startup with 0 steps (infrastructure, workflow unchanged). |
| 2 | `package.json` | `smoke:product-path`, provider evaluation scripts. | PASS — scripts resolve; no new runtime dependency. |
| 3 | `scripts/product-path-smoke.mjs` | Full SQLite snapshot/diff; seeded messages, self-model, interest/evidence, relationship/evidence; two-step delete; readiness-marker wait; explicit `controlledRequest`. | PASS+P3 — full-field restart/switch/final `removed=[] changed=[] unexpectedAdded={}`; allowed changes per field with reasons; P3: `continuityAfterRestart = continuityBefore` makes the bridge restart check tautological, goal progress is not seeded, allowed additions are table-level, Provider B is service-level only (explicitly stated). |
| 4 | `src/app/companion-service.ts` | Provider lifecycle, secret transactions, discovery consent/policy, exact 1 MiB discovery body, `requireConfigured()` priority. | PASS — `MAX_DISCOVERY_BODY_BYTES = 1_048_576` at `:442`; oversized test header `1048577`; targeted oversized tests 2/2; no secret/body leak. |
| 5 | `src/app/index.ts` | Production startup composition; consent dialog uses `presentProviderConsent` and one preview. | PASS+P3 — consent target/model/hash from one preview; detail still says HTTPS Bearer for local HTTP; `dataPolicy` still names `deepseek-egress`. |
| 6 | `src/app/ipc.ts` | Profile CRUD/discovery handlers, trusted-sender gate, validation, pending decisions. | PASS — parsers reject official/private-network overrides; no secret in results. |
| 7 | `src/app/startup-composition.ts` | Production reflection graph; bounded startup outcome. | PASS — same composition used by startup and tests; no auto-executed actions. |
| 8 | `src/cognition/pending-items.ts` | Stage 4 decision API, concern identity, `runBounded`. | PASS — transaction-backed decisions; full suite passes. |
| 9 | `src/cognition/reflection-routing.ts` | Transactional finding ingestion, recovery, failure isolation. | PASS — tests cover routing/recovery; no external egress. |
| 10 | `src/evaluation/git-metadata.ts` | Real git identity for evidence. | PASS — branch/commit/tree recorded; no secret. |
| 11 | `src/motivation/companion-goal.ts` | Candidate accept/reject transaction, source check, required audit. | PASS — goal only on explicit accept; audit failure rolls back. |
| 12 | `src/persistence/cognitive-context-repository.ts` | Pending decision transaction, route terminal state. | PASS — item/route/audit commit together. |
| 13 | `src/persistence/database.ts` | `SchemaIdentityError` fail-closed open. | PASS — foreign identity fails closed; migration tests pass. |
| 14 | `src/persistence/intent-reading-repository.ts` | Intent withdrawal closes open questions. | PASS — failure leaves items open. |
| 15 | `src/persistence/migrations.ts` | v49 provider profiles, v48 bridge, structure checks, 40-char id. | PASS — migration suite passes; no data-loss finding. |
| 16 | `src/preload/index.ts` | Typed bridge additions: provider profiles, self-model, companion goals, pending decision. | PASS — channel names/types match; no secret exposure. |
| 17 | `src/providers/bounded-body.ts` | New streaming byte-limited reader. | PASS — byte counting, cancel, Content-Length early reject, UTF-8, read/cancel/no-body tests. |
| 18 | `src/providers/consent-presentation.ts` | New pure consent presentation for official/custom/local. | PASS — no DeepSeek/price for custom/local; sanitized target; unknown-price wording. |
| 19 | `src/providers/endpoint-resolver.ts` | Chat/models URL resolver, path/trailing-slash normalization. | PASS — tests cover base, `/v1`, full URL, custom path. |
| 20 | `src/providers/endpoint-security.ts` | Endpoint classification, private-address parsing, DNS policy, mask/digest. | PASS — IPv6/CGNAT/NAT64/6to4/metadata/userinfo/query/fragment tests. |
| 21 | `src/providers/openai-compatible.ts` | Bounded error hint, resolver equality, request-time policy, retry/health. | PASS+P3 — error hint is bounded at 4 KiB; non-stream success still uses unbounded `response.json()` (not used by production chat). |
| 22 | `src/providers/provider-policy.ts` | Consent preview/assessment, `model-discovery` action. | PASS+P3 — action is in the preview, not the consent record; endpoint+body hash blocks practical reuse. |
| 23 | `src/providers/provider-registry.ts` | Profile validation, official/local/custom rules, private-network rejection. | PASS — save/IPC/UI reject official overrides. |
| 24 | `src/renderer/index.html` | Four-view shell, provider profile form, official/local cards, settings index anchors. | PASS+P3 — existing IDs/flows retained; local "优先于 DeepSeek" and cognitive "DeepSeek 请求" copy is misleading for non-DeepSeek active providers. |
| 25 | `src/renderer/src/companion-ui.ts` | Active-profile readiness/selection, provider-change refresh, consent-safe copy. | PASS — prior P2s closed: `isProviderUsable` allows local without token; `selectChatProvider` mirrors `requireConfigured()`; submit guard and re-enable use the same helper. P3: DeepSeek-specific cognitive copy remains. |
| 26 | `src/renderer/src/provider-readiness.ts` | New pure readiness/selection helper. | PASS — local loopback usable without credential; remote requires key; order default → local → spark → deepseek → custom; 4 unit tests and independent probe. |
| 27 | `src/renderer/src/provider-profiles-ui.ts` | Profile list/create/edit/test/discover/default/delete; masked endpoint; no key display; two-step delete; readiness marker. | PASS — prior P2 closed: first click arms `确认删除` for 5 s, second deletes; unit test asserts no bridge call on first click. P3: armed state not cleared by other actions; built-in local delete enabled but service returns FORBIDDEN; test-only `data-provider-ui-ready` marker set before `loadProfiles()` completes. |
| 28 | `src/renderer/src/companion.css` | Companion-only refinements; old styles moved to `style.css`. | PASS+P3 — several old classes (`revision-list`, `correction-form`, `reminder-list`, `task-warning`, etc.) have no rule, so some existing details lose their prior visual treatment. |
| 29 | `src/renderer/src/goal-candidates-ui.ts` | Candidate/formal goal rendering, accept/reject through existing bridge. | PASS — textContent only; request guards; no execution. |
| 30 | `src/renderer/src/goals-ui.ts` | Exports `refreshGoalViews` for candidate acceptance. | PASS — no behavior change. |
| 31 | `src/renderer/src/main.ts` | Adds presence/self-model init while keeping memory/create/search/correct/revoke/restore/delete. | PASS — init order after shell; existing IPC paths unchanged. |
| 32 | `src/renderer/src/pending-ui.ts` | Discriminated decision feedback; buttons disabled during request. | PASS — conflict/not-found shown; no silent success. |
| 33 | `src/renderer/src/presence-ui.ts` | Hero, orbital canvas, mastheads, settings index, theme toggle, nav numbering. | PASS+P3 — canvas is decorative and `aria-hidden`; reduced-motion stops rotation but still redraws every rAF; 390 nav last item is cut (scrollable). |
| 34 | `src/renderer/src/self-model-ui.ts` | Self-model/interest panel; correct/retract/pause/restore. | PASS+P3 — only existing bridge methods; textContent; retract confirm; P3: dropped-interest button still offers restore, raw ISO timestamp, no in-flight disable. |
| 35 | `src/renderer/src/style.css` | Full design-system rewrite: deep space/paper tokens, grid, hero, panels, buttons, responsive, reduced motion. | PASS+P3 — tokens and layout grounded; P3: range inputs have `outline:none` with no focus replacement, light muted contrast is 4.41:1, no `overflow-wrap` for long text, `.self-model-grid` stays two columns at 390. |
| 36 | `src/self-model/reflection-concern.ts` | Concern normalization/key/digest. | PASS — conservative; no raw user text stored in pending detail. |
| 37 | `src/self-model/reflection-mapping.ts` | Concern dedupe and evidence identity. | PASS — tests cover both branches. |
| 38 | `src/self-model/reflection-service.ts` | `open_question` finding from one-conversation knowledge gaps. | PASS — local-only findings; no external action. |
| 39 | `src/shared/companion.ts` | Provider profile/health/capability/types, discovery result. | PASS — types match DB/IPC/UI. |
| 40 | `src/shared/contracts.ts` | New IPC channels, profile types, pending decision, companion goals. | PASS — `tsc` clean; no removed channel still referenced. |
| 41 | `src/shared/errors.ts` | `ApplicationError` carries `httpStatus`. | PASS — adapter/discovery/health use it. |
| 42 | `src/shared/validation.ts` | Provider profile parsers, self-model/interest parsers, official rejection. | PASS — 40-char id, source-kind, protocol, endpoint path and model checks. |
| 43 | `evals/provider-multi-source/run.ts` | Real-provider evidence: HTTP status, latency, attempts, deltas, exit. | PASS+P3 — no key/body; records are historical, before the A/B/UI code changes. |
| 44 | `evals/stage-2/ablation/run.ts` | Event-log wiring. | PASS — compiles/runs. |
| 45 | `evals/stage-2/runner/cli.ts` | Event-log wiring. | PASS — no behavior change. |
| 46 | `evals/stage-3/runner/harness.ts` | Event-log wiring and git metadata. | PASS — matches production wiring. |
| 47 | `evals/stage-3/shared/real-provider.ts` | Event-log wiring. | PASS — no secret handling change. |
| 48 | `evals/stage-4a/run.ts` | `readGitMetadata` instead of hard-coded branch. | PASS — evidence identity improved. |
| 49 | `evals/stage-5/run.ts` | `readGitMetadata` instead of hard-coded branch. | PASS — evidence identity improved. |
| 50 | `src/renderer/src/shell-ui.ts` (unchanged vs base, reviewed) | Four-view `hidden`/`active` toggle, `aria-current`, mounted views. | PASS — tested by `tests/shell-ui.test.ts`; no rebuild of existing IPC listeners. |

## 2. Test files changed / added

| Group | Files | Conclusion |
| --- | --- | --- |
| New readiness/UI tests | `tests/provider-readiness.test.ts` (4), `tests/provider-profiles-ui.test.ts` (7), `tests/shell-ui.test.ts` (2), `tests/goal-candidates-ui.test.ts`, `tests/pending-ui.test.ts` | PASS — local no-token, selection order, default/disabled default, two-step delete, official disabled, key-cleared prompt, nav toggle, candidate/pending decisions. P3: no keyboard test. |
| Fix A tests | `src/providers/consent-presentation.test.ts` (6) | PASS — official/custom/local, no DeepSeek for custom/local, sanitized endpoint, unknown price, missing metadata, action labels. |
| Fix B tests | `src/providers/bounded-body.test.ts` (10) | PASS — exact limit, one byte over, missing/understated/overstated Content-Length, UTF-8 split, read error, cancel throw, no body, 4 KiB. |
| Endpoint tests | `src/providers/endpoint-resolver.test.ts` (5), `src/providers/endpoint-security.test.ts` (8) | PASS — resolver shapes and endpoint boundary table. |
| Provider integration | `src/app/provider-multi-source.integration.test.ts`, `provider-multi-source-ipc.integration.test.ts`, `provider-continuity.integration.test.ts`, `provider-manual-chat.integration.test.ts` | PASS — P1/P2 lifecycle, IPC, consent, discovery; exact 1 MiB oversized tests 2/2; P3: continuity test uses a mock provider and compares message IDs/roles only. |
| Stage 4 tests | `src/app/stage4-*.test.ts` (5 files), `src/persistence/pending-schema-gate.test.ts`, `intent-reading-pending-closure.test.ts`, `src/self-model/reflection-concern.test.ts`, `reflection-mapping.test.ts`, `src/evaluation/git-metadata.test.ts` | PASS — full suite 1153 tests; no skip/weakening. |
| Migration tests | `src/persistence/migrations.test.ts` | PASS — release v47/Stage 4 v48/Provider v48/重复/回滚/40-char id. |
| Existing wiring changes | `src/app/b1-strategy-payload.integration.test.ts`, `b4-recovery.integration.test.ts`, `b5-reflection-safety.integration.test.ts`, `cognitive-continuity-phase24.integration.test.ts`, `interest-payload-invalidation.integration.test.ts`, `turn-context-fidelity.integration.test.ts`, `turn-state-sequence.integration.test.ts`, `src/cognition/pending-items.test.ts`, `reflection-routing.test.ts`, `src/motivation/companion-goal.test.ts`, `goal-lifecycle.test.ts`, `tests/b4-child-crash.test.ts`, `c1-mainchain.test.ts`, `correction-round.test.ts`, `tests/helpers/b4-crash-child.ts`, `companion-stack.ts` | PASS — constructor/wiring only; no assertions relaxed. |
| IPC test changes | `src/app/ipc.test.ts` | PASS — profile/pending/companion-goal handlers and error mapping. |

## 3. Docs and evidence

| Group | Files | Conclusion |
| --- | --- | --- |
| 16 fixed deliverables | `docs/audit/morrow-v2-final-closure-baseline.md`, `docs/ui/reference-inventory.md`, `docs/ui/current-ui-audit.md`, `docs/ui/design-system.md`, `docs/ui/implementation-and-regression-report.md`, `docs/ui/acceptance-matrix.md`, `docs/ui/evidence/`, `docs/testing/morrow-v2-final-acceptance-matrix.md`, `docs/reports/morrow-v2-final-delivery-report.md`, `docs/reports/morrow-v2-final-evidence-index.md`, `docs/reports/morrow-v2-final-work-log.md`, `docs/audit/morrow-v2-final-independent-review.md`, `docs/audit/morrow-v2-final-file-review-matrix.md`, `evals/morrow-v2-final/results/<run>.json`, `evals/morrow-v2-final/transcripts/<run>.md`, optional `evals/morrow-v2-final/ui/` | PASS+P3 — all required paths exist; the docs now reference “PR #54 head”, code `df8f802`, parent code-SHA CI `41995422882`, product-path `20261105T084141Z-45483dd6`, and 1 MiB exact. P3 stale lines: work log `:159` (`eede520`/4/4 claim), evidence index `:89` empty “最终 HEAD”, acceptance matrix `:4` empty “最终 HEAD”, delivery report `:161` final HEAD CI 4/4, `:77` `6f5fe47` as final HEAD, `:79` provider core code unchanged, evidence index `:85,103` parent CI unlabeled, acceptance `:22,85` ambiguous final CI. No code impact. |
| UI reference/inventory | `docs/ui/reference-inventory.md` | PASS — files, status, purpose and conflict/trade-off recorded; no fabricated reference. |
| UI audit/design system | `docs/ui/current-ui-audit.md`, `docs/ui/design-system.md` | PASS+P3 — audit accurate; design-system overstates light muted contrast (4.9 vs 4.41), claims every token is used (`--serif`, `--topbar`, `--radius-sm` unused), and says dangerous actions keep a native confirm (provider delete is now an in-page two-step). |
| UI implementation/acceptance | `docs/ui/implementation-and-regression-report.md`, `docs/ui/acceptance-matrix.md` | PASS+P3 — mapping accurate; acceptance matrix claims self-model/goal screenshots, 390 single-column/no-overflow, keyboard focus and long-text PASS that are not all supported. |
| Final reports | `docs/reports/morrow-v2-final-delivery-report.md`, `docs/reports/morrow-v2-final-evidence-index.md`, `docs/reports/morrow-v2-final-work-log.md` | PASS+P3 — key headers use “PR #54 head”; code SHA `df8f802`, parent CI `41995422882`, and 1 MiB exact are cited. P3 stale lines listed above; no code impact. |
| Continuity evidence | `evals/morrow-v2-final/results/20261105T084141Z-45483dd6.json`, `evals/morrow-v2-final/transcripts/20261105T084141Z-45483dd6.md` | PASS+P3 — seeded messages/self-model/interest/evidence/relationship/evidence; restart/switch/final `removed=[] changed=[] unexpectedAdded={}`; allowedChanges per field with reasons; `controlledRequest` explicitly service-level. P3: bridge restart check tautological; goal progress not seeded; allowed additions table-level. No key/Authorization/body. |
| Screenshots | `docs/ui/evidence/20261105T084141Z-45483dd6/*.png` (9), prior sets | PASS+P3 — real Electron captures; no secret text; chat/memory/settings × 3 sizes; no goals/reminders/self-model screenshots; memory shows a stale empty list; 390 nav last item cut; two-step delete state not captured. |
| Historical docs | `docs/architecture/provider-multi-source-architecture.md`, `provider-security-and-consent.md`, `pr-40-*`, `provider-multi-source-*` reports/tests, `stage-4-*` reports/tests | HISTORICAL — retained with their own SHAs; not final-SHA evidence; no evidence rewritten. |

## 4. Security scan summary

| Scan | Count / result |
| --- | --- |
| Provider-key-shaped prefix | 11 matches, 0 real keys (the `morrow-v2-risk-dependency-register` file name and an evaluation fixture ID; two are in the previous review text) |
| `apiKey = "..."` literals | 33 matches, all offline/test/fake |
| `Bearer <literal>` | 2 matches, both `test-only-*` in a unit test |
| AWS/GitHub/Slack/private-key patterns | 0 |
| Product-path artifact | only SHA-256 digests of OS ciphertext; fixture IDs are random UUIDs; no key/Authorization/body |
| Screenshots | no key text; settings shows "密钥：已保存在本机安全存储" |
| New UI DOM/logging | no key rendered; `dataset` holds profile IDs, `confirm`, and the non-sensitive `providerUiReady` marker; no console logging |

## 5. Verification commands (summary)

| Command | Result | Exit |
| --- | --- | --- |
| `npx tsc --noEmit` | clean | 0 |
| `TEMP=... TMP=... npx vitest run` | 128 files / 1153 tests pass, 0 skipped | 0 |
| `npm run build` | main/preload/renderer built | 0 |
| `TEMP=... TMP=... npx vitest run src/app/provider-multi-source.integration.test.ts -t "oversized discovery"` | 2/2 pass (17 filtered) | 0 |
| `TEMP=... TMP=... npx vitest run <8 targeted A/B/UI/readiness/continuity files>` | 8 files / 43 tests pass | 0 |
| `TEMP=... TMP=... npm run evaluate` | M3/M4 pass | 0 |
| `TEMP=... TMP=... npm run evaluate:cognition` | cognitive/feeling/alpha/intent pass | 0 |
| `.tmp/probe/companion-gate.test.ts` + `.tmp/probe/provider-priority.test.ts` | 2 files / 7 tests pass | 0 |
| `gh pr checks 54` | `df8f802` run `42005665855`: 4/4 fail (0 steps, 2 s); parent `6f5fe47` run `41995422882`: 4/4 pass; prior docs `9215cc4` run `41997137337`: 4/4 pass | 0 |

## 6. Blocking findings carried into the verdict

1. **External Provider quota/local model service** — `api.supxh.xin` and `speed26.toter.me` are `BLOCKED_QUOTA`; the local OpenAI-compatible service is `BLOCKED_LOCAL_SERVICE_NOT_RUNNING`. Not code defects.
2. **Final docs-HEAD CI infrastructure failure** — run `42005665855` on `df8f802` failed all four jobs in 2 s with 0 steps and no logs; the prior docs HEADs `bb97c9b`/`13ce2a6` failed the same way; the workflow is unchanged since the green `9215cc4` run; parent code-SHA CI `41995422882` is 4/4 PASS. This is an Actions infrastructure/startup failure, not a code/test failure, but it is still a red required check.

No open code P1/P2 remains. The 1 MiB exact fix is verified. Documentation stale lines are P3 only and have no code impact. Code verdict: **PASS_WITH_NON_BLOCKING_BACKLOG**; overall delivery: **PARTIAL** for the two blockers above.
