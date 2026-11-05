# Morrow V2 Final Independent Review (PR #54, final closure round)

Independent reviewer: separate context; did not write this implementation. No product code, test, migration, CI, doc, or evidence was modified. The only repository writes are this file and `docs/audit/morrow-v2-final-file-review-matrix.md`, both overwritten for the final HEAD. Throwaway probes were created only under `.tmp/probe/` and were not committed.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` (`E:\Hasee\Documents\morrow v2\zcode\stage3-audit\repo`) |
| Branch | `feat/morrow-v2-final-closure` |
| Final candidate HEAD | `771cbaaa3c9b829e95e76a1eee89a2390d44201d` (docs/screenshots only over the code SHA) |
| Final code/test SHA | `019c2c2520ba5e28db9e7a779fa95ad27a1b4009` |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft, `MERGEABLE`, merge state `CLEAN` |
| PR head SHA (live) | `771cbaaa3c9b829e95e76a1eee89a2390d44201d` |
| Final HEAD CI | [41964006554](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41964006554), head `771cbaa`, conclusion `success`, 4/4 jobs pass |
| Code-SHA CI | [41962719371](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41962719371), head `019c2c2`, conclusion `success`, 4/4 jobs pass; Windows product-path step pass |
| Worktree | clean at review start; after writing this review, only the two review files are modified and uncommitted |

Final HEAD CI jobs (`gh pr checks 54`):

| Job | Result | URL |
| --- | --- | --- |
| Typecheck, tests, build and smoke (ubuntu-latest) | pass (3m3s) | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41964006554/job/127036673014 |
| Typecheck, tests, build and smoke (windows-latest) | pass (8m7s) | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41964006554/job/127036672819 |
| Windows package, install and installed-app smoke | pass (3m29s) | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41964006554/job/127036673048 |
| Windows upgrade path (schema migrations under the real app) | pass (1m43s) | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41964006554/job/127036673043 |

The Windows job in both runs executed `Electron product-path acceptance (two profiles, OS secrets, restart continuity)` successfully. The committed product-path evidence (`20261105T034317Z-8dc025dc`, 22 checks, PASS) was produced by run `41962719371` at the code SHA, not by the docs-only HEAD run.

## 1. Verdict

# **PARTIAL**

The UI redesign is real, reference-grounded, and largely preserves existing functions. Fix A and Fix B are substantially correct and independently reproduced. Fix C's snapshot/diff machinery is strong, but the product-path fixture does not populate several required record categories, so the "full-field" evidence is partly vacuous. The chat send gate has a P2 functional regression for local providers and a P2 target-selection mismatch against the service resolver. A new destructive provider-profile delete has no confirmation. Documentation still presents old SHA/CI/product-path runs as final. Those are open P2s, so this cannot be PASS.

External provider quota and the local model service remain blocked; the delivery status therefore stays **PARTIAL** even if the remaining code P2s are fixed. If only the P3 backlog remained, the code verdict would be `PASS_WITH_NON_BLOCKING_BACKLOG`.

## 2. What changed since the prior review (`a845889`)

- `9af9c34` — UI redesign (`style.css`, `companion.css`, `presence-ui.ts`, `self-model-ui.ts`), Fix A (`consent-presentation.ts`), Fix B (`bounded-body.ts`), Fix C (full SQLite snapshot/diff), UI screenshots and docs.
- `019c2c2` — chat send gate changed to the active profile, provider-change event refresh, final screenshots/continuity evidence.
- `771cbaa` — docs and final screenshot set only; no production/test code.

## 3. UI redesign review

### 3.1 Is it a real renderer redesign, grounded in the references?

**PASS.** The implementation modifies the real Electron renderer (`src/renderer/index.html`, `src/renderer/src/main.ts`, `style.css`, `companion.css`, `presence-ui.ts`, `self-model-ui.ts`, `companion-ui.ts`, `provider-profiles-ui.ts`), not a static demo. The screenshots are captured by `scripts/product-path-smoke.mjs` from a real Electron window through CDP.

The visual language is grounded in the provided references, not invented:

| Reference | What the product actually uses |
| --- | --- |
| `E:\open ui\auto ui\spatial.html` / `PROJECT-NOTES.md` (Spatial Lab) | Deep-space `#05070C`, cyan `#7BE7FF`, violet `#A78BFA`, lime `#DDFF4D`; orbit/point-cloud canvas; mono labels; drag-to-orbit; hero grid and outline heading. |
| `E:\open ui\auto ui\agentic-lab.html` / `PROJECT-NOTES.md` (Agent Desk) | Paper theme `#F3F0E8` / ink `#131519` / blue `#2F5BFF` / orange `#FF6B35` / mint `#0FA98C` / violet `#7C5CFF`; hairline cards, pills, paper workbench; used for settings/control surfaces, not the main conversation. |
| `E:\open ui\auto ui\designs-lab.html` | Numbered/indexed card density, editorial mastheads, settings index, compact metadata. |
| `E:\open ui\auto ui\_morrow\memory-vault.src.html` + `zcode-morrow/README.md` | Memory provenance/sensitivity/revision semantics and "do not auto-write" boundary; no three.js runtime copied. |

No external runtime or UI framework was added; `package.json` still has only Electron/Vite/Vitest/TypeScript/esbuild/electron-builder. The canvas is a ~150-line native Canvas 2D projection.

### 3.2 Is the companion/conversation still the center?

**PASS with a P3 usability caveat.** The chat view is the default (`shell-ui.ts:37`), the conversation panel is the main work area, and settings are a separate view. The hero is a landing banner above the conversation; at 1440 it reads as a companion product, not an Agent dashboard. At 1280x800 the composer/send button falls below the viewport (the screenshot shows the textarea but not the send button), and at 390x844 the hero occupies most of the first screen before the conversation begins. Both are reachable by page scroll, but the primary action is not visible at a common desktop size. P3.

### 3.3 Are existing functions preserved?

**PASS.** All four views and existing IDs remain in `index.html`; `shell-ui.ts` still toggles the mounted views by `hidden`/`active` and `aria-current`, so every init path and IPC listener stays alive. The memory, goal, reminder, pending, backup, cognitive, personality, conversation, provider, and consent paths are unchanged in the DOM and still call the same bridge methods. No existing view, button, or form field was deleted. The new self-model panel is additive.

### 3.4 Chat send gate: default/custom profile, not only legacy DeepSeek

**P2 — regression and target mismatch.** The gate no longer reads only the legacy DeepSeek form; it reads `providers.listProfiles()` and selects an active profile at `src/renderer/src/companion-ui.ts:143-151`. However:

1. `src/renderer/src/companion-ui.ts:118-122` requires `provider.apiKeyConfigured` for every profile. The service explicitly allows a local profile with no access token (`src/app/companion-service.ts:892-896`; `saveProfile` allows `enabled: true` for local with no key). The renderer therefore disables `#chat-send` for a perfectly usable local model. The UI's own form copy says the local access token is optional (`src/renderer/index.html:375-377`). Independent probe: a local profile `enabled: true, apiKeyConfigured: false` leaves `#chat-send.disabled === true` (expected false). The previous code used `deepseekReady || localReady`, so this is a regression.
2. The UI selection order is default -> enabled custom-proxy -> enabled local -> any enabled (`companion-ui.ts:144-147`). The service order is explicit default -> local-openai -> spark -> deepseek -> first enabled non-official custom (`companion-service.ts:871-890`). With no default and both local and custom enabled, the UI shows the custom profile and gates on its key, while `requireConfigured()` routes the actual request to local. With a custom profile that has no key and a usable local profile, the UI disables chat even though the service would use local. Independent probes:
   - `provider-priority.test.ts`: service returns `local-openai` with local and custom both enabled and no default.
   - `companion-gate.test.ts`: UI state shows `Relay A` in the same configuration; and with the custom profile keyless, `#chat-send` is disabled while local is usable.
3. The same `apiKeyConfigured` check is repeated in the submit guard (`companion-ui.ts:560`) and the `finally` re-enable (`companion-ui.ts:604`), so the bug survives every path.

This is a P2: the displayed provider can differ from the egress target, and a supported local-model flow is blocked. The consent dialog itself still shows the true request target (Fix A), which limits the damage, but the main chat state is misleading.

### 3.5 Self-model / interest actions

**PASS with P3 polish.** `src/renderer/src/self-model-ui.ts` calls only existing bridge methods: `selfModel.listEntries`, `listInterests`, `correctEntry`, `retractEntry`, `setInterestStatus` (`src/preload/index.ts:95-101`; IPC handlers `src/app/ipc.ts:279-283`). No new IPC channel, no service bypass. Statements and labels are rendered with `textContent`; the panel HTML is static. Retraction uses `window.confirm`; correction uses a native prompt. The service transition matrix allows user transitions except from `dropped` (`src/self-model/self-model-domain.ts:183-188`), so the "pause/restore" actions are safe. P3: the toggle still offers "恢复" for a `dropped` interest (the service then rejects it), the timestamp is raw ISO, and buttons are not disabled during the request.

### 3.6 Accessibility, layout, and screenshots

| Item | Finding | Conclusion |
| --- | --- | --- |
| Navigation semantics | `<button>` nav, `aria-current="page"` toggled by `shell-ui.ts:23-24`; tested in `tests/shell-ui.test.ts`. | PASS |
| Live regions/labels | `role=status`/`aria-live` on chat state, feedback, provider profile feedback, self-model feedback; all form controls have labels or `aria-label`. | PASS |
| Reduced motion | `prefers-reduced-motion` CSS block (`style.css:522-524`) and canvas `reducedMotion()` check (`presence-ui.ts:13,101`). The canvas still redraws a static frame every rAF, but does not rotate. | PASS (P3 performance) |
| Focus visibility | Global `:focus-visible` (`style.css:75`) is overridden for range inputs by `input[type="range"] { outline: none; }` (`style.css:363`), with no replacement focus style. The three personality sliders have no visible keyboard focus. | **P3** — accessibility requirement not met for sliders. |
| Contrast | Dark muted `#8595ae` on `#05070c` = 6.63:1; light muted `#6e6f73` on `#f3f0e8` = 4.41:1, on `#ede9df` = 4.14:1. `docs/ui/design-system.md:70` claims about 4.9:1 for light. | **P3** — light-theme muted text is below WCAG AA 4.5:1 on the page background; doc overstates. |
| Long text | `style.css` has no `overflow-wrap`/`word-break` for `.chat-message-body`, `.memory-content`, `.pending-item-meta`, or provider meta. A long unbroken URL/string can overflow its card. The acceptance matrix claims long-text PASS. | **P3** — not exercised; risk of horizontal overflow. |
| Self-model grid at 390 | `.self-model-grid` stays `repeat(2, minmax(0,1fr))` (`style.css:433`); no 640px override. At 390 the new self-model/interest panel is two very narrow columns. | **P3** — narrow-window adaptation gap. |
| 390 nav | The nav row is horizontally scrollable; the last item ("设置与备份") is cut in the screenshot. It is reachable by horizontal scroll, but there is no visible scroll affordance. | **P3** |
| 1280 composer | Send button below the fold at 1280x800. | **P3** |
| Screenshots | 9 real PNGs at 1440/1280/390 for chat/memory/settings; no secrets visible; no overlap. Memory screenshot shows the empty state even though the fixture created a memory (the memory list loaded before the seed and is not refreshed on view switch). No goals/reminders or self-model screenshots, despite the acceptance matrix claiming screenshot evidence for them. | **P3 evidence gap** |

### 3.7 Danger and consent copy

**P2 — provider profile delete has no confirmation.** `src/renderer/src/provider-profiles-ui.ts:151-157` deletes a profile (and its OS secret) directly on click. Every other destructive path keeps a confirm (`main.ts:222,235,248`, `companion-ui.ts:376,440,488,512`, `goals-ui.ts:252,263`, `reminders-ui.ts:345,355`, `self-model-ui.ts:89`). The UI audit and acceptance matrix claim danger confirmations are preserved, which is false for this new action. The product-path test itself deletes profile B by clicking the danger button with no confirmation.

**P3 — misleading provider copy remains outside the consent dialog.**
- `src/renderer/src/companion-ui.ts:321-322,474` still say cognitive state is sent in the "DeepSeek 请求"; for a custom/local active provider that is false.
- `src/renderer/index.html:395` says "每次 DeepSeek 发送仍需单独确认" in the cognitive settings status.
- `src/app/index.ts:104` always says the key is sent "通过 HTTPS Authorization Bearer 标头" even for a local `http://127.0.0.1` provider.
- `src/app/index.ts:77` still exposes `dataPolicy: 'local-first-consented-deepseek-egress-...'` though multi-source providers are supported.
- `src/renderer/index.html:377` says local is "优先于 DeepSeek"; the service also prioritizes local over Spark/DeepSeek only when no explicit default exists.

None of these re-introduce DeepSeek in the native consent dialog for custom/local (Fix A passes), but they are user-visible provider copy that should be corrected.

## 4. Fix A — consent presentation

| Check | Code / test | Conclusion |
| --- | --- | --- |
| Official/custom/local labels | `src/providers/consent-presentation.ts:46-93`; `src/providers/consent-presentation.test.ts` 6 tests | PASS — official uses its own display name, custom is fixed "自定义服务端", local is "本地模型服务". |
| No DeepSeek name/price for custom/local | Same tests; `presentProviderConsent` branches | PASS — custom/local strings contain no DeepSeek; pricing is self-verify/no-fee. |
| Unknown official price | Official branch `pricing` = "计费信息未验证…" | PASS — no inherited vendor price. |
| Endpoint sanitization | `sanitizeConsentEndpoint` strips userinfo/query/fragment; save-time `normalizeBaseUrl` rejects them (`endpoint-resolver.ts:20-34`) | PASS — test covers `user:pass@host/v1?token=secret#x`. |
| Same target/model/payload hash | `src/app/index.ts:81-127` consumes one `ProviderConsentPreview`; no second target build | PASS — target, model, bytes, hash, memories and exact payload all come from the preview. |
| Consent gate not weakened | `assessProviderRequest` still requires a matching hash, provider id, lifetime and sensitive flag (`provider-policy.ts:91-125`) | PASS — no bypass found. |
| Residual: local HTTP copy | `src/app/index.ts:104` hardcoded HTTPS Bearer sentence | P3 — false for local HTTP loopback. |
| Residual: action binding | `ProviderConsent` has no `action` field; action is bound only through endpoint+body hash | P3 — practical reuse is blocked by the hash, but the record does not carry the action. |

Commands: `npx vitest run src/providers/consent-presentation.test.ts` — 6/6 passed (part of 7-file/38-test targeted run and the full 1148-test run).

## 5. Fix B — bounded response body

| Check | Code / test | Conclusion |
| --- | --- | --- |
| Real byte counting | `src/providers/bounded-body.ts:25-62`; `bounded-body.test.ts` | PASS — sums `Uint8Array.byteLength`, not string length. |
| Cancel on limit | `reader.cancel()` before throw; cancel errors swallowed | PASS — test asserts cancel called; cancel-throws test still yields the limit error. |
| Content-Length not trusted | Early reject only when declared > limit; actual bytes always counted | PASS — missing/understated/overstated tests. |
| Discovery 1 MiB / error hint 4 KiB | `companion-service.ts:442,847`; `openai-compatible.ts:88-90` | **PASS with P3** — discovery uses `1_000_000` bytes, not `1_048_576`; this is stricter but contradicts the task and docs that say 1 MiB. Error hint is 4,096. |
| UTF-8 split | `TextDecoder(..., {stream:true})`; test splits "你" across chunks | PASS |
| Read/cancel errors, no body | Tests cover read error, cancel throw, `new Response(null)` | PASS |
| Error hint does not leak body | `readProviderErrorHint` keeps only numeric/string code and type; discards message | PASS |
| Oversized discovery | `provider-multi-source.integration.test.ts:559-570` uses 1,048,577 bytes without trusting Content-Length | PASS — rejects as `PROVIDER_RESPONSE`; no exact-1,048,576-accept test. |
| Non-stream success body | `openai-compatible.ts:332-337` uses `response.json()` unbounded | P3 residual — not in the task's two required paths; production chat uses streaming. |

Commands: `npx vitest run src/providers/bounded-body.test.ts` — 10/10 passed; discovery tests passed in the 8-file/61-test targeted run and the full suite.

## 6. Fix C — provider-switch continuity

### 6.1 Code

`scripts/product-path-smoke.mjs` now exports a full SQLite snapshot (`snapshotFullDatabase`, `:298-333`) over:

`personality_profiles`, `personality_revisions`, `self_model_entries`, `interests`, `interest_evidence`, `memories`, `memory_revisions`, `memory_evidence`, `goals`, `goal_tasks`, `goal_audit`, `companion_goals`, `companion_goal_progress`, `relationship_threads`, `relationship_thread_evidence`, `conversations`, `messages`, `cognitive_pending_items`, `reflection_findings`, `reflection_finding_routes`, `reflection_runs`, `cognitive_turn_contexts`, `cognitive_turn_observations`, `cognitive_feeling_state`, `cognitive_feeling_events`, `cognitive_core_settings`, `event_journal`.

`diffFullSnapshots` (`:335-367`) fails on any removed row, any changed non-allowlisted field, and any unexpected added row. `TIMESTAMP_FIELDS` allows any `*_at` except `created_at`; `ALLOWED_ADDITION_TABLES` allows table-level growth for interests/evidence/reflection/cognitive/event rows. The artifact records `removed`, `changed`, `added`, `allowedChanges`, `allowedAdditions` for restart, switch and final A.

### 6.2 Evidence

Run `20261105T034317Z-8dc025dc` (`evals/morrow-v2-final/results/...json`, transcript) reports:

| Point | removed | changed | unexpectedAdded | allowedChanges |
| --- | --- | --- | --- | --- |
| restart | 0 | 0 | 0 | 0 |
| switch A→B→A | 0 | 0 | 0 | 0 |
| final A | 0 | 0 | 0 | 0 |

The full snapshot includes personality version/systemRules, memory content/status, goal content/status/progress (all columns), relationship tables, and conversation/message tables. **However, the fixture does not populate several required categories**, so the corresponding comparisons are vacuous:

- `seedScript` (`:385-407`) creates one personality revision, one memory, one goal, and one conversation. It creates **no messages**, **no relationship thread/evidence**, **no self-model entry**, and **no baseline interest**.
- The full snapshot therefore compares zero `messages`, zero `relationship_threads`, zero `self_model_entries`, and zero baseline `interests`. The only interest row is the startup-created one, reported as an allowed addition (`interests: 1`).
- `continuityScript` (`:409-430`) maps self-model kind/statement, interest label, memory currentText, goal intent, conversation title; it does not read messages or relationship threads at all.
- The product-path flow switches the default profile A→B→A (`:638-646`) but never sends a chat request under B. The "controlled request" is covered only by the service-level `src/app/provider-continuity.integration.test.ts` using a mock provider, and that test's snapshot compares message IDs/roles only, not content/order/status. This limitation is honestly recorded in the result/transcript, but the task's required message/relationship/self-model continuity is not proven end-to-end.

### 6.3 Conclusion

**P2 — machinery PASS, fixture/evidence PARTIAL.** The diff code is substantially stronger than the prior count-based check, and removed/unexpected changes would fail. But the evidence does not actually exercise messages, relationship threads/evidence, self-model entries, or a pre-existing interest, which are explicit task requirements. `docs/testing/morrow-v2-final-acceptance-matrix.md:102` claiming C2 PASS for all fields is overstated.

P3: the allowlist is table-level, not per-row with a reason; any `*_at` change except `created_at` is allowed, which could mask a semantic timestamp-only transition in a table without a status column; `FULL_CONTINUITY_TABLES` omits some companion-owned tables (`memory_suggestions`, `reminders`, `deletion_journal`, `turn_states`, `personalization_state`, `user_interaction_profile`); allowed additions are counted, not content-inspected.

## 7. Security / secret verdict

**PASS.** No real API key, Bearer token, Authorization header value, private key, AWS/GitHub/Slack token, or provider response body was found in tracked files or committed evidence.

| Scan | Result |
| --- | --- |
| `sk-` pattern in tracked files | 9 matches, all false positives: 7 are the file-name fragment in `morrow-v2-risk-dependency-register` (`docs/...`, `evals/stage-3/shared/real-provider.ts`), 2 are an evaluation fixture ID (`evaluation/fixtures/...`, `evaluation/reports/...`). 0 real keys. |
| `api[_-]?key = "..."` | 33 matches, all test/offline literals (`offline-*`, `test-only-*`, `test-key-*`, `synthetic-*`, `replacement-*`, `key-0123`). 0 real keys. |
| `Bearer <literal>` | 2 matches, both `test-only-*` in `src/providers/openai-compatible.test.ts`. 0 real tokens. |
| AWS/GitHub/Slack/private-key patterns | 0 matches. |
| Product-path artifact | Only SHA-256 digests of OS secret ciphertext; no key, Authorization header, or response body. Transcript states fake keys. |
| Screenshots | Settings shows "密钥：已保存在本机安全存储" and masked endpoints; no key text. |
| New UI DOM/logging | No key is rendered; provider list uses `apiKeyConfigured` only; `dataset` contains profile IDs, not secrets; no console logging in the new UI modules. |

Endpoint security remains intact: `normalizeBaseUrl` rejects userinfo/query/fragment; custom remote requires HTTPS and DNS policy; local requires loopback; redirects are `error`; request-time policy re-checks custom endpoints. The consent preview/hash path is unchanged in strength.

Residual security P3: the non-stream `response.json()` success path is unbounded (not used by the production chat/test paths); the native consent detail's hardcoded HTTPS sentence is wrong for local HTTP; `ProviderConsent` has no action field.

## 8. Continuity verdict

**PARTIAL.** The code-level snapshot/diff is good; the evidence is not complete for messages, relationship threads/evidence, self-model, or a baseline interest. Provider B's request is service-level (mock provider), not a full Electron request; the docs say so and this review does not upgrade it.

## 9. Product-path / UI screenshot verdict

**PASS for what is shown, PARTIAL for coverage.** The 9 screenshots under `docs/ui/evidence/20261105T034317Z-8dc025dc/` are real Electron window captures from Windows CI, at 1440x900 / 1280x800 / 390x844, for chat/memory/settings. They show no secrets, no overlap, and no unreachable control beyond page scroll. Gaps: no goals/reminders or self-model screenshots; memory shows the empty state despite a seeded memory; the 390 nav's last item is cut (scrollable); the 1280 composer is below the fold. The acceptance matrix overstates screenshot and keyboard coverage.

## 10. Docs and evidence consistency

**PARTIAL.** All 16 fixed deliverables exist (the optional `evals/morrow-v2-final/ui/<run-id>/` was not needed; screenshots live under `docs/ui/evidence/`). The final section of the delivery report and the UI evidence index correctly identify `019c2c2` and run `41962719371`, and the final HEAD run `41964006554` is green. But older sections still present old SHA/CI/product-path runs as final:

| File / location | Problem |
| --- | --- |
| `docs/reports/morrow-v2-final-delivery-report.md:58,77,79,91` | Presents CI `41869931767` (head `92bc4ed`) and product-path `20261104T155831Z-899f5cb0` as the final CI/product-path; also says provider code is unchanged after `c1f4450`, which is no longer true after the A/B changes. |
| `docs/reports/morrow-v2-final-evidence-index.md:66-68,89` | "CI run 41869931767" and "final code SHA d07b3f4" are presented in the main evidence section; the final HEAD run `41964006554` and code SHA `019c2c2` are only in section 8. |
| `docs/testing/morrow-v2-final-acceptance-matrix.md:3-4,21,53,56,67,84` | Header SHAs are `d07b3f4`/`28665df`; rows still cite run `41869931767` and `20261104T155831Z-899f5cb0`; row 4.4 still says message content/relationship are only table counts. |
| `docs/testing/morrow-v2-final-acceptance-matrix.md:96,102` | Says discovery is 1 MiB (code is 1,000,000 bytes) and C2 PASS for all fields (fixture gaps above). |
| `docs/ui/acceptance-matrix.md:14-15,26,33` | Claims goal/self-model screenshots, provider delete confirm, 390 layout and keyboard focus PASS; the screenshots, confirm, and range focus do not support all four. |
| `docs/ui/design-system.md:70` | Claims light muted about 4.9:1; actual is 4.41:1 on `#f3f0e8` and 4.14:1 on `#ede9df`. |
| `docs/ui/current-ui-audit.md:46` | Claims dangerous actions retain confirm; provider-profile delete does not. |
| `docs/reports/morrow-v2-final-work-log.md:148` | Says discovery 1 MiB; code is 1,000,000 bytes. |
| `docs/reports/morrow-v2-final-delivery-report.md:145` | Says discovery 1,048,576; code is 1,000,000. |

The 1,000,000-byte limit is stricter than 1 MiB, so this is a documentation/spec mismatch, not a weakening. The stale "final" evidence is a P2 documentation consistency defect because the task explicitly forbids presenting old SHA evidence as final.

## 11. Commands and exit codes

All commands were run at `771cbaa` with a clean worktree. `TEMP`/`TMP` were set to `<repo>/.tmp/es` for Vitest/evaluation to keep temporary files inside the workspace.

| Command | Result | Exit |
| --- | --- | --- |
| `npx tsc --noEmit` | no output | 0 |
| `TEMP=... TMP=... npx vitest run` | 127 files / 1148 tests passed, 0 skipped, 159.11s | 0 |
| `npm run build` | main 953.78 kB, preload 10.61 kB, renderer JS 119.29 kB, CSS 30.36 kB | 0 |
| `TEMP=... TMP=... npx vitest run src/providers/consent-presentation.test.ts src/providers/bounded-body.test.ts src/providers/endpoint-resolver.test.ts src/providers/endpoint-security.test.ts src/app/provider-continuity.integration.test.ts tests/shell-ui.test.ts tests/provider-profiles-ui.test.ts` | 7 files / 38 tests passed | 0 |
| `TEMP=... TMP=... npx vitest run src/app/stage4-*.test.ts src/persistence/pending-schema-gate.test.ts src/cognition/pending-items.test.ts src/app/provider-multi-source.integration.test.ts` | 8 files / 61 tests passed | 0 |
| `TEMP=... TMP=... npm run evaluate` | M3/M4 offline gates passed | 0 |
| `TEMP=... TMP=... npm run evaluate:cognition` | cognitive/feeling/alpha/intent gates passed | 0 |
| `TEMP=... TMP=... npx vitest run --config .tmp/probe/vitest.config.ts .tmp/probe/companion-gate.test.ts` | negative probe: 5 tests, 4 passed, 1 failed (local no-key chat disabled) | 1 (expected for the bug) |
| `TEMP=... TMP=... npx vitest run --config .tmp/probe/vitest.config.ts .tmp/probe/provider-priority.test.ts` | 1 test passed; service picks local over custom | 0 |
| `gh pr view 54` | OPEN, MERGEABLE, CLEAN, head `771cbaa` | 0 |
| `gh pr checks 54` | 4/4 pass | 0 |
| `git status --porcelain` (before writing) | empty | 0 |
| `git status --porcelain` (after writing) | only the two review files modified, uncommitted | 0 |

Note: `npm run evaluate` / `evaluate:cognition` fail with exit 1 when `TEMP`/`TMP` point at the sandbox's default temp; with the workspace temp they pass. This is an environment/temp-write restriction in the review sandbox, not a product regression; the CI "Offline evaluations" steps passed.

## 12. Residual risks / P3 backlog

1. Range inputs have `outline: none` and no focus replacement (`style.css:363` vs `:75`).
2. Light-theme muted text contrast is 4.41:1 on the page background (4.14:1 on `--bg-soft`); the design-system doc claims 4.9:1.
3. No `overflow-wrap`/`word-break` for chat/memory/provider meta; long unbroken text can overflow.
4. `.self-model-grid` remains two columns at 390.
5. The 390 nav's last item is cut and only reachable by horizontal scroll; the 1280 composer is below the fold.
6. Provider profile delete has no confirmation; local builtin profile delete is enabled but the service returns FORBIDDEN.
7. Provider profile save has no "saving" state; discover has no loading state; reset does not clear old feedback.
8. The provider selection priority in the UI should be the service's `requireConfigured()` result (or the service should expose it) instead of a separate heuristic.
9. Cognitive settings copy and the local provider "priority" copy still name DeepSeek; the consent detail's HTTPS sentence is wrong for local HTTP.
10. Discovery uses 1,000,000 bytes, not 1,048,576; docs are inconsistent.
11. Non-stream success `response.json()` is unbounded (not used by production chat).
12. Continuity allowlist is table-level and timestamp-broad; it does not list per-row reasons; some companion tables are not compared.
13. Continuity fixture lacks messages, relationship threads/evidence, self-model entries, and a baseline interest; Provider B has no full Electron request.
14. Screenshot coverage lacks goals/reminders and self-model; memory screenshot shows a stale empty list.
15. The presence canvas redraws every rAF even under reduced motion and calls `getComputedStyle` per frame; consider throttling/idle draw.
16. The new self-model panel has no loading state and does not disable actions during a request.
17. `dataPolicy` still contains `deepseek-egress` in the app info string.
18. Docs still present old SHA/CI/product-path runs as final; update the historical sections to point to the current evidence.

## 13. Final statement

**PARTIAL.** Do not merge or release. Required before a PASS: fix the local no-key chat gate and make the UI's active provider exactly match `requireConfigured()`; add a confirmation for provider-profile deletion; seed and exercise messages/relationship/self-model/baseline-interest in the continuity run (or explicitly scope the claim); correct the stale "final" SHA/CI sections and the 1 MiB claim. External Provider quota and the local model service remain blocked, so delivery stays PARTIAL regardless.
