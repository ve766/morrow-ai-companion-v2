# Independent file review matrix — PR #51 (round 2)

- Reviewed SHA: `15c25aa57cd4dda2157a68370e0f25a5d5861779`
- Code SHA under test: `34098fb6698fad5a8674e8ceb2b2a4f5be819310`
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- Diff: `3812b18...15c25aa`, **36 files**, +3057/−204
- Every changed file was read in the new PR diff and in the checked-out tree. The conclusion column is the reviewer's, not the implementer's.

| # | File | Change | Review conclusion |
|---|---|---|---|
| 1 | `docs/architecture/provider-multi-source-architecture.md` | new | **Reviewed — code SHA updated; one inaccurate claim remains.** The domain model, resolver, migration and state machine are accurate. Line 50 still says `dispatchToProvider` is the only real-request exit; discovery now requires consent but still performs its own GET (non-blocking wording issue). |
| 2 | `docs/architecture/provider-security-and-consent.md` | new | **Reviewed — accurate for chat/test/discovery consent.** SSRF, secret rollback, consent binding, error masking and local/private-network rules match the code. The discovery consent action is labelled `connection-test`; the doc does not mention that nuance. |
| 3 | `docs/audit/provider-multi-source-baseline-audit.md` | new | **Reviewed — accurate baseline; code SHA updated.** The v48/PR #40 renumbering requirement is stated honestly (line 55). |
| 4 | `docs/reports/provider-multi-source-delivery-report.md` | new | **Reviewed — status honest (PARTIAL); B4 wording fixed.** It now says IPC save/list passed and IPC test reached the provider and returned quota; it adds section 7 on the security fixes. The real run is BLOCKED_QUOTA and not claimed as PASS. |
| 5 | `docs/reports/provider-multi-source-evidence-index.md` | new | **Reviewed — links accurate; two stale values.** CI run `41817829775` at `f92d9a0` is true but one commit behind the latest `41818784423` at `15c25aa`. It still says "provider 定向 10 files / 65 tests" (the suite is 91 tests) and "独立复审 PENDING". |
| 6 | `docs/reports/provider-multi-source-work-log.md` | new | **Reviewed — timeline timestamps are stale/wrong.** It attributes `34098fb` to 10:01–10:03Z (actual 10:52Z) and the final run to 10:06Z (actual 10:53Z); the commit table omits `493e125`/`f92d9a0`/`15c25aa`. The 113/1044 count matches my run. |
| 7 | `docs/testing/provider-multi-source-acceptance-matrix.md` | new | **Reviewed — B4 fixed; two stale rows.** Row 3 now correctly says save/list passed and test reached the provider and returned quota. Row 12 still says "CI 待 PR" and row 13 still says PENDING; row 15 records the B1/B2/B3 fixes as PASS (verified). |
| 8 | `evals/provider-multi-source/results/20261104T105300Z-987ad9c2.json` | new (renamed) | **Reviewed — machine evidence honest.** `status: BLOCKED_QUOTA`, `ipc.test: false`, `workingTree: dirty`, `codeCommit: 34098fb`; no key/Authorization/response text. The failure path lacks HTTP status/latency/attempts/exit code. |
| 9 | `evals/provider-multi-source/run.ts` | new | **Reviewed — safe key handling and sanitized output.** Key only from `MORROW_TEST_API_KEY`; no file fallback; no key/response text. Gaps: handler-level IPC only, `MemorySecretStore` only, no speed26 run, failure path lacks HTTP status/attempts/exit code, discovery not exercised. |
| 10 | `evals/provider-multi-source/transcripts/20261104T105300Z-987ad9c2.md` | new (renamed) | **Reviewed — consistent with the JSON.** BLOCKED_QUOTA, `test:false`, dirty tree, local BLOCKED; no secret or response text. |
| 11 | `package.json` | modified | **Reviewed — correct.** Adds `eval:provider-multi-source`; no secret, no dependency change. |
| 12 | `src/app/companion-service.ts` | modified | **Reviewed — B1/B2 fixed; residual health regression.** The built-in guard rejects deepseek/spark/local-openai conversion (verified service + IPC); discovery now requires consent and denies before fetch (verified approval/denial). Residual: preserving `lastTest`/`capabilities` unconditionally leaves stale health after an endpoint/model change; `connectionInput` still ignores `endpointPath`/full chat URL. Secret rollback, consent hash re-check and resolver use in chat/memory-proposal are correct. |
| 13 | `src/app/ipc.ts` | modified | **Reviewed — correct wiring.** Five new channels use the trusted-sender gate and strict parsers; discovery denial propagates `FORBIDDEN`; no new bypass. |
| 14 | `src/app/provider-continuity.integration.test.ts` | new | **Reviewed — good state test, narrow coverage.** Real SQLite A→reopen→B→A; personality/memory/goals/messages; does not cover self-model/interests. Uses the mock provider, appropriate for state continuity. |
| 15 | `src/app/provider-manual-chat.integration.test.ts` | modified | **Reviewed — no regression.** Only the connection-result assertion changes to include `status: 'connected'`. |
| 16 | `src/app/provider-multi-source-ipc.integration.test.ts` | new | **Reviewed — good IPC coverage, incomplete surface.** Save/list/test and untrusted/unsafe rejection; no discover/delete/setDefault IPC or real HTTP path. My independent harness covers discover through IPC. |
| 17 | `src/app/provider-multi-source.integration.test.ts` | new | **Reviewed — new tests cover B1/B2/B3.** Built-in deepseek/spark conversion rejection, discovery consent denial (no fetch), schema identity fail-closed, and default/health preservation. Gaps: same fake key for A/B, no endpointPath/full-URL test, no official endpointPath test, no custom-endpoint key-reuse test. |
| 18 | `src/evaluation/git-metadata.ts` | new | **Reviewed — correct.** Reads commit/branch/working-tree independently; handles detached HEAD/git unavailable; no secrets. |
| 19 | `src/persistence/migrations.ts` | modified | **Reviewed — v48 rebuild correct; B3 fail-closed.** Copies legacy rows, fills defaults/capabilities, creates the unique partial default index, keeps old ids for secrets. Adds `SchemaIdentityError` for version/name identity mismatch. `id` CHECK allows a leading `-` while the app regex does not (minor). The v48/PR #40 renumbering note remains. |
| 20 | `src/persistence/database.ts` | modified | **Reviewed — B3 fix correct.** `SqliteDatabase.open` rethrows `SchemaIdentityError` and closes the connection instead of opening degraded; normal v47→v48 and degraded migration-failure paths still work. The reverse direction (Stage-4 code opening a provider-v48 DB) depends on PR #40/merge order. |
| 21 | `src/preload/index.ts` | modified | **Reviewed — correct.** Exposes the five new typed methods inside the frozen bridge; no raw IPC access. |
| 22 | `src/providers/endpoint-resolver.test.ts` | new | **Reviewed — good core coverage.** Base, `/v1` base, full chat URL, custom path, models sibling, userinfo/query/fragment/scheme rejection. Missing the `endpointPath: '/v1'` edge and trailing-slash normalization. |
| 23 | `src/providers/endpoint-resolver.ts` | new | **Reviewed — correct for documented cases; one ambiguity.** Prevents duplicate `/v1`/`/chat/completions`; rejects userinfo/query/fragment/non-HTTP(S). `endpointPath: '/v1'` with a bare base resolves to `/v1` without `/chat/completions` (backlog). |
| 24 | `src/providers/endpoint-security.test.ts` | new | **Reviewed — good core SSRF coverage.** HTTPS, userinfo/query/fragment, loopback/RFC1918/link-local/metadata, DNS private/failure, IPv4/IPv6 ranges. Missing bracket-IPv6/trailing-dot save-time cases (request-time policy blocks them). |
| 25 | `src/providers/endpoint-security.ts` | new | **Reviewed — request-time policy is sound.** Sync classify rejects the main dangerous forms; request-time DNS checks all answers and fails closed; adapter uses `redirect:'error'`; errors do not leak DNS details. Gaps: save-time accepts bracket IPv6/trailing-dot; CGNAT/NAT64/6to4 not classified. |
| 26 | `src/providers/openai-compatible.ts` | modified | **Reviewed — good.** Reuses payload/SSE/retry/timeout/error classification; adds profile-aware endpoint check, custom-proxy request-time policy, `redirect:'error'`, quota 403 code mapping, bounded error hints, no response body echo. The endpoint equality check exposes the `connectionInput` bug. |
| 27 | `src/providers/provider-registry.ts` | modified | **Reviewed — correct official specs; the built-in guard lives in the service.** Official endpoint/model pinning preserved; custom profiles validated by endpoint shape/protocol; private-network rejected. `validateProviderConfig` alone still allows a built-in id with a non-matching sourceKind, but `saveProfile` now rejects it. |
| 28 | `src/renderer/index.html` | modified | **Reviewed — correct panel markup.** Source options include custom/local, private-network disabled with explanation; Anthropic/Ollama disabled; key field password/cleared; endpoint/model/path/default/enabled inputs present. No copy button. |
| 29 | `src/renderer/src/main.ts` | modified | **Reviewed — correct.** Initializes the provider profile panel; no other change. |
| 30 | `src/renderer/src/provider-profiles-ui.ts` | modified | **Reviewed — B1 UI fix correct.** The **编辑** button is disabled for official profiles (initial render and after actions); list/create/test/discover/default/delete remain. Endpoint masked; status/latency shown; key never rendered. No duplicate action; `fillForm` still maps official→custom-proxy but the button is disabled and the service rejects it. |
| 31 | `src/shared/companion.ts` | modified | **Reviewed — types match the domain model.** Profile id opaque, source/protocol/endpoint/model separated, capabilities/health types, no secret field. `apiKeyConfigured` is a boolean only. |
| 32 | `src/shared/contracts.ts` | modified | **Reviewed — correct.** Adds the five channels and bridge types; `ProviderGetRequest.providerId` becomes a string. No secret type added. |
| 33 | `src/shared/errors.ts` | modified | **Reviewed — correct.** Adds `PROVIDER_ENDPOINT_BLOCKED`; no new leaky error data. |
| 34 | `src/shared/validation.ts` | modified | **Reviewed — strict profile parser.** Allowed-key/plain-object checks, sourceKind restricted to custom-proxy/local, protocol restricted to OpenAI-compatible, endpoint/model/name/enabled/default/key validation, profile-id regex. `endpointPath` allows `?`/`#` at the parser but the service rejects them; no control-char check for displayName/path (minor). |
| 35 | `tests/helpers/companion-stack.ts` | modified | **Reviewed — test-only change.** The provider factory returns a `providerClass:'mock'` profile for every config, so the continuity test exercises state continuity without the real adapter/consent gates. Appropriate for its purpose; the multi-source tests cover the real service. |
| 36 | `tests/provider-profiles-ui.test.ts` | new | **Reviewed — good DOM-stub coverage.** Render/edit/save/test/delete/default through the bridge; endpoint masking and health text asserted. Missing discover/error-state coverage and no official-profile edit test (which would have exposed B1 before the fix). |

## Summary

- Files reviewed: **36 / 36** (100%).
- Round-1 blocking findings **B1/B2/B3/B4 are independently verified fixed**.
- No P1 security blocker remains. The remaining items are non-blocking correctness, hardening and documentation backlog:
  - stale health/capabilities after endpoint/model change (new regression from the B4 health-preservation fix);
  - `testConnection` ignores `endpointPath`/full chat URL;
  - official `endpointPath` accepted only via direct service (not IPC/UI);
  - custom-profile endpoint change keeps the stored key (consent-gated);
  - discovery consent action/validation/config-shape hardening;
  - work-log timestamps, evidence-index provider-suite count and acceptance rows 12/13 are stale;
  - implementer's real run is on a dirty tree; add HTTP status/latency/attempts/exit code to the failure path;
  - speed26 regression not run; eval is handler-level/MemorySecretStore; continuity lacks self-model/interests; same fake key for A/B; long profile id vs secret-store limit; save-time bracket IPv6/trailing-dot; `endpointPath: '/v1'` ambiguity; residual CGNAT/NAT64/6to4 ranges; DeepSeek-specific error text.
- No file contains a real key or an Authorization header.
