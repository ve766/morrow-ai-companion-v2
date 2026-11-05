# Morrow V2 Final File Review Matrix (PR #54, final closure round)

- Reviewed HEAD: `771cbaaa3c9b829e95e76a1eee89a2390d44201d`
- Final code/test SHA: `019c2c2520ba5e28db9e7a779fa95ad27a1b4009`
- Base: `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- PR #54 head: `771cbaaa3c9b829e95e76a1eee89a2390d44201d`
- Final HEAD CI: run `41964006554`, 4/4 PASS, PR `MERGEABLE`/`CLEAN`
- Code-SHA CI: run `41962719371`, 4/4 PASS (Windows product-path step pass)
- Diff vs base: 209 files changed, 23,800 insertions, 1,232 deletions.
- Worktree: clean at review start; after writing, only this file and the independent review are modified and uncommitted.

Legend: **PASS** = reviewed and consistent with the task; **PASS+P3** = reviewed with a non-blocking residual; **P2** = open blocking finding; **HISTORICAL** = prior-stage evidence retained, not final-SHA proof.

## 1. Production files changed vs base

| # | File | Change reviewed | Conclusion |
| --- | --- | --- | --- |
| 1 | `.github/workflows/ci.yml` | Windows product-path only; package/install/upgrade jobs; artifact upload. | PASS — final HEAD run 41964006554 has 4/4 jobs pass, including the Windows product-path step. |
| 2 | `package.json` | `smoke:product-path`, provider evaluation scripts. | PASS — scripts resolve; no new runtime dependency. |
| 3 | `scripts/product-path-smoke.mjs` | Full SQLite snapshot, field diff, allowlist, UI screenshots, restart/switch flow. | **P2** — the fixture creates no messages, relationship thread/evidence, self-model entry, or baseline interest, so those required comparisons are vacuous; P3: allowlist is table-level, `*_at` broad, and some companion tables are not compared. |
| 4 | `src/app/companion-service.ts` | Provider lifecycle, secret transactions, discovery consent/policy, bounded discovery body, `requireConfigured()` priority. | PASS+P3 — discovery uses `1_000_000` bytes, not the task's 1,048,576; no secret/body leak. |
| 5 | `src/app/index.ts` | Production startup composition; consent dialog uses `presentProviderConsent` and one preview. | PASS+P3 — consent target/model/hash are from the preview; the detail still says "HTTPS Authorization Bearer" for local HTTP and `dataPolicy` still names `deepseek-egress`. |
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
| 25 | `src/renderer/src/companion-ui.ts` | Active-profile gate, provider-change refresh, consent-safe copy. | **P2** — requires `apiKeyConfigured` for local profiles, disabling local chat without a token; selection priority (custom before local; any enabled before Spark/DeepSeek) differs from `requireConfigured()`, so the displayed provider can differ from the egress target. P3: DeepSeek-specific cognitive copy remains. |
| 26 | `src/renderer/src/companion.css` | Companion-only refinements; old styles moved to `style.css`. | PASS+P3 — several old classes (`revision-list`, `correction-form`, `reminder-list`, `task-warning`, etc.) have no rule, so some existing details lose their prior visual treatment. |
| 27 | `src/renderer/src/goal-candidates-ui.ts` | Candidate/formal goal rendering, accept/reject through existing bridge. | PASS — textContent only; request guards; no execution. |
| 28 | `src/renderer/src/goals-ui.ts` | Exports `refreshGoalViews` for candidate acceptance. | PASS — no behavior change. |
| 29 | `src/renderer/src/main.ts` | Adds presence/self-model init while keeping memory/create/search/correct/revoke/restore/delete. | PASS — init order after shell; existing IPC paths unchanged. |
| 30 | `src/renderer/src/pending-ui.ts` | Discriminated decision feedback; buttons disabled during request. | PASS — conflict/not-found shown; no silent success. |
| 31 | `src/renderer/src/presence-ui.ts` | Hero, orbital canvas, mastheads, settings index, theme toggle, nav numbering. | PASS+P3 — canvas is decorative and `aria-hidden`; reduced-motion stops rotation but still redraws every rAF; 390 nav last item is cut (scrollable). |
| 32 | `src/renderer/src/provider-profiles-ui.ts` | Profile list/create/edit/test/discover/default/delete; masked endpoint; no key display. | **P2** — delete has no confirmation, although it removes the profile and its OS secret; P3: delete is enabled for the built-in local profile (service returns FORBIDDEN), save/discover have no loading state. |
| 33 | `src/renderer/src/self-model-ui.ts` | Self-model/interest panel; correct/retract/pause/restore. | PASS+P3 — only existing bridge methods; textContent; retract confirm; P3: dropped-interest button still offers restore, raw ISO timestamp, no in-flight disable. |
| 34 | `src/renderer/src/style.css` | Full design-system rewrite: deep space/paper tokens, grid, hero, panels, buttons, responsive, reduced motion. | PASS+P3 — tokens and layout are grounded; P3: range inputs have `outline:none` with no focus replacement, light muted contrast is 4.41:1, no `overflow-wrap` for long text, `.self-model-grid` stays two columns at 390. |
| 35 | `src/self-model/reflection-concern.ts` | Concern normalization/key/digest. | PASS — conservative; no raw user text stored in pending detail. |
| 36 | `src/self-model/reflection-mapping.ts` | Concern dedupe and evidence identity. | PASS — tests cover both branches. |
| 37 | `src/self-model/reflection-service.ts` | `open_question` finding from one-conversation knowledge gaps. | PASS — local-only findings; no external action. |
| 38 | `src/shared/companion.ts` | Provider profile/health/capability/types, discovery result. | PASS — types match DB/IPC/UI. |
| 39 | `src/shared/contracts.ts` | New IPC channels, profile types, pending decision, companion goals. | PASS — `tsc` clean; no removed channel still referenced. |
| 40 | `src/shared/errors.ts` | `ApplicationError` carries `httpStatus`. | PASS — adapter/discovery/health use it. |
| 41 | `src/shared/validation.ts` | Provider profile parsers, self-model/interest parsers, official rejection. | PASS — 40-char id, source-kind, protocol, endpoint path and model checks. |
| 42 | `evals/provider-multi-source/run.ts` | Real-provider evidence: HTTP status, latency, attempts, deltas, exit. | PASS+P3 — no key/body; records are at `c1f4450`, before the A/B code changes, so they are historical evidence, not final-SHA proof. |
| 43 | `evals/stage-2/ablation/run.ts` | Event-log wiring. | PASS — compiles/runs. |
| 44 | `evals/stage-2/runner/cli.ts` | Event-log wiring. | PASS — no behavior change. |
| 45 | `evals/stage-3/runner/harness.ts` | Event-log wiring and git metadata. | PASS — matches production wiring. |
| 46 | `evals/stage-3/shared/real-provider.ts` | Event-log wiring. | PASS — no secret handling change. |
| 47 | `evals/stage-4a/run.ts` | `readGitMetadata` instead of hard-coded branch. | PASS — evidence identity improved. |
| 48 | `evals/stage-5/run.ts` | `readGitMetadata` instead of hard-coded branch. | PASS — evidence identity improved. |
| 49 | `src/renderer/src/shell-ui.ts` (unchanged vs base, reviewed) | Four-view `hidden`/`active` toggle, `aria-current`, mounted views. | PASS — tested by `tests/shell-ui.test.ts`; no rebuild of existing IPC listeners. |

## 2. Test files changed / added

| Group | Files | Conclusion |
| --- | --- | --- |
| New UI tests | `tests/shell-ui.test.ts` (2), `tests/provider-profiles-ui.test.ts` (6), `tests/goal-candidates-ui.test.ts`, `tests/pending-ui.test.ts` | PASS — nav toggle, profile render/edit/test/delete/default, official disabled, key-cleared prompt, candidate/pending decisions. P3: no keyboard test and no provider-delete confirmation test. |
| Fix A tests | `src/providers/consent-presentation.test.ts` (6) | PASS — official/custom/local, no DeepSeek for custom/local, sanitized endpoint, unknown price, missing metadata, action labels. |
| Fix B tests | `src/providers/bounded-body.test.ts` (10) | PASS — exact limit, one byte over, missing/understated/overstated Content-Length, UTF-8 split, read error, cancel throw, no body, 4 KiB. |
| Endpoint tests | `src/providers/endpoint-resolver.test.ts` (5), `src/providers/endpoint-security.test.ts` (8) | PASS — resolver shapes and endpoint boundary table. |
| Provider integration | `src/app/provider-multi-source.integration.test.ts`, `provider-multi-source-ipc.integration.test.ts`, `provider-continuity.integration.test.ts`, `provider-manual-chat.integration.test.ts` | PASS — P1/P2 lifecycle, IPC, consent, discovery; P2/P3: continuity test uses a mock provider and compares message IDs/roles only. |
| Stage 4 tests | `src/app/stage4-*.test.ts` (5 files), `src/persistence/pending-schema-gate.test.ts`, `intent-reading-pending-closure.test.ts`, `src/self-model/reflection-concern.test.ts`, `reflection-mapping.test.ts`, `src/evaluation/git-metadata.test.ts` | PASS — full suite 1148 tests; no skip/weakening. |
| Migration tests | `src/persistence/migrations.test.ts` | PASS — release v47/Stage 4 v48/Provider v48/重复/回滚/40-char id. |
| Existing wiring changes | `src/app/b1-strategy-payload.integration.test.ts`, `b4-recovery.integration.test.ts`, `b5-reflection-safety.integration.test.ts`, `cognitive-continuity-phase24.integration.test.ts`, `interest-payload-invalidation.integration.test.ts`, `turn-context-fidelity.integration.test.ts`, `turn-state-sequence.integration.test.ts`, `src/cognition/pending-items.test.ts`, `reflection-routing.test.ts`, `src/motivation/companion-goal.test.ts`, `goal-lifecycle.test.ts`, `tests/b4-child-crash.test.ts`, `c1-mainchain.test.ts`, `correction-round.test.ts`, `tests/helpers/b4-crash-child.ts`, `companion-stack.ts` | PASS — constructor/wiring only; no assertions relaxed. |
| IPC test changes | `src/app/ipc.test.ts` | PASS — profile/pending/companion-goal handlers and error mapping. |

## 3. Docs and evidence

| Group | Files | Conclusion |
| --- | --- | --- |
| 16 fixed deliverables | `docs/audit/morrow-v2-final-closure-baseline.md`, `docs/ui/reference-inventory.md`, `docs/ui/current-ui-audit.md`, `docs/ui/design-system.md`, `docs/ui/implementation-and-regression-report.md`, `docs/ui/acceptance-matrix.md`, `docs/ui/evidence/`, `docs/testing/morrow-v2-final-acceptance-matrix.md`, `docs/reports/morrow-v2-final-delivery-report.md`, `docs/reports/morrow-v2-final-evidence-index.md`, `docs/reports/morrow-v2-final-work-log.md`, `docs/audit/morrow-v2-final-independent-review.md`, `docs/audit/morrow-v2-final-file-review-matrix.md`, `evals/morrow-v2-final/results/<run>.json`, `evals/morrow-v2-final/transcripts/<run>.md`, optional `evals/morrow-v2-final/ui/` | PARTIAL — all required paths exist; the optional UI machine directory was not needed. Delivery/evidence index and acceptance matrix still present old SHA/CI/product-path runs as final; see the independent review section 10. |
| UI reference/inventory | `docs/ui/reference-inventory.md` | PASS — files, status, purpose and conflict/trade-off recorded; no fabricated reference. |
| UI audit/design system | `docs/ui/current-ui-audit.md`, `docs/ui/design-system.md` | PASS+P3 — audit is accurate; design-system overstates light muted contrast (4.9 vs 4.41), claims every token is used (`--serif`, `--topbar`, `--radius-sm` unused), and says dangerous actions keep confirm (provider delete does not). |
| UI implementation/acceptance | `docs/ui/implementation-and-regression-report.md`, `docs/ui/acceptance-matrix.md` | PASS+P3 — mapping is accurate; acceptance matrix claims goal/self-model screenshots, keyboard focus and provider-delete confirm that are not all supported. |
| Final reports | `docs/reports/morrow-v2-final-delivery-report.md`, `docs/reports/morrow-v2-final-evidence-index.md`, `docs/reports/morrow-v2-final-work-log.md` | **P2** — sections 2/4/5 still cite run `41869931767`, product-path `20261104T155831Z`, and final code `d07b3f4`; section 8/9 correctly cite `019c2c2` and run `41962719371`, but the final HEAD run `41964006554` is not recorded. P3: 1 MiB/1,048,576 vs 1,000,000 inconsistency. |
| Continuity evidence | `evals/morrow-v2-final/results/20261105T034317Z-8dc025dc.json`, `evals/morrow-v2-final/transcripts/20261105T034317Z-8dc025dc.md` | **P2** — restart/switch/final `removed=0 changed=0 unexpectedAdded=0`; but no messages/relationship/self-model/baseline-interest fixtures, and Provider B has no full Electron request. No key/Authorization/body in the artifact. |
| Screenshots | `docs/ui/evidence/20261105T034317Z-8dc025dc/*.png` (9), `docs/ui/evidence/20261105T031237Z-f9c9988e/*.png` (9) | PASS+P3 — real Electron captures; no secret text; chat/memory/settings × 3 sizes; no goals/reminders/self-model screenshots; memory shows a stale empty list; 390 nav last item cut. The older `f9c9988e` set is historical and preserved. |
| Historical docs | `docs/architecture/provider-multi-source-architecture.md`, `provider-security-and-consent.md`, `pr-40-*`, `provider-multi-source-*` reports/tests, `stage-4-*` reports/tests | HISTORICAL — retained with their own SHAs; not final-SHA evidence; no evidence rewritten. |

## 4. Security scan summary

| Scan | Count / result |
| --- | --- |
| `sk-` literals | 9 matches, 0 real keys (7 file-name `morrow-v2-risk-dependency-register` fragments, 2 evaluation fixture IDs) |
| `apiKey = "..."` literals | 33 matches, all offline/test/fake (`offline-*`, `test-only-*`, `test-key-*`, `synthetic-*`, `replacement-*`, `key-0123`) |
| `Bearer <literal>` | 2 matches, both `test-only-*` in a unit test |
| AWS/GitHub/Slack/private-key patterns | 0 |
| Product-path artifact | only SHA-256 digests of OS ciphertext; no key/Authorization/body |
| Screenshots | no key text; settings shows "密钥：已保存在本机安全存储" |
| New UI DOM/logging | no key rendered; `dataset` holds profile IDs only; no console logging |

## 5. Verification commands (summary)

| Command | Result | Exit |
| --- | --- | --- |
| `npx tsc --noEmit` | clean | 0 |
| `TEMP=... TMP=... npx vitest run` | 127 files / 1148 tests pass, 0 skipped | 0 |
| `npm run build` | main/preload/renderer built | 0 |
| `TEMP=... TMP=... npx vitest run <7 targeted A/B/UI/continuity files>` | 7 files / 38 tests pass | 0 |
| `TEMP=... TMP=... npx vitest run <8 Stage 4/provider files>` | 8 files / 61 tests pass | 0 |
| `TEMP=... TMP=... npm run evaluate` | M3/M4 pass | 0 |
| `TEMP=... TMP=... npm run evaluate:cognition` | cognitive/feeling/alpha/intent pass | 0 |
| `.tmp/probe/companion-gate.test.ts` | negative probe: 1 failure (local no-key chat disabled) | 1 (bug reproduced) |
| `.tmp/probe/provider-priority.test.ts` | service selects local over custom | 0 |
| `gh pr checks 54` | 4/4 pass at `771cbaa` | 0 |

## 6. Blocking findings carried into the verdict

1. `src/renderer/src/companion-ui.ts:118-122,560,604` — local provider without a key disables chat; service allows it (`companion-service.ts:892-896`).
2. `src/renderer/src/companion-ui.ts:144-147` vs `companion-service.ts:871-890` — UI active-profile heuristic differs from service `requireConfigured()`, so the displayed provider can differ from the actual egress target and a usable local provider can be blocked.
3. `src/renderer/src/provider-profiles-ui.ts:151-157` — provider profile delete has no confirmation and removes the OS secret.
4. `scripts/product-path-smoke.mjs:385-407` — continuity fixture lacks messages, relationship threads/evidence, self-model entries, and a baseline interest; the required full-field comparisons are partly vacuous, and Provider B has no full Electron request.
5. `docs/reports/morrow-v2-final-delivery-report.md:58,77,79,91`, `docs/reports/morrow-v2-final-evidence-index.md:66-68,89`, `docs/testing/morrow-v2-final-acceptance-matrix.md:3-4,21,53,56,67,84` — old SHA/CI/product-path evidence is still presented as final.

Verdict: **PARTIAL**. No product code, test, migration, CI, doc, or evidence was modified by this review; only the two review files were written.
