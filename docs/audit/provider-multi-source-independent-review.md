# Independent review — Provider multi-source foundation (Issue #50, PR #51) — round 2

- Reviewer: independent review context (did not implement this work; conclusions are from GitHub, the checked-out code, the PR diff and independent executions)
- Reviewed SHA: `15c25aa57cd4dda2157a68370e0f25a5d5861779` (PR #51 head)
- Code SHA under test: `34098fb6698fad5a8674e8ceb2b2a4f5be819310` (`15c25aa` records the CI run; `f92d9a0` rebinds the evidence)
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- Review branch: `audit/provider-multi-source-independent-review`
- Reviewed at: 2026-11-04T11:21:09Z
- Environment: Windows 10.0.26200 x64, Node v22.23.2, npm 10.9.8; `TEMP`/`TMP` under `.tmp/es`
- Implementer's status: **PARTIAL** (external real-provider and local-service blockers remain)
- Round-2 verdict: **PASS_WITH_NON_BLOCKING_BACKLOG** — the four round-1 blockers are independently verified fixed; no P1 security blocker remains. The PR is still PARTIAL and must stay OPEN until the external blockers and the backlog are addressed.

## 1. Round-1 blockers: independent re-verification

### B1 — built-in profile repurpose — FIXED

`ProviderConfigService.saveProfile()` (`src/app/companion-service.ts:514-533`) now rejects a built-in id unless it matches the built-in shape:

- `deepseek`/`spark`: `sourceKind === 'official'`, exact spec base URL, model matching the spec pattern;
- `local-openai`: `sourceKind === 'local'` (loopback is then enforced by `validateProviderConfig`);
- the new panel disables **编辑** for `sourceKind === 'official'` (`src/renderer/src/provider-profiles-ui.ts:101,124`).

Independent reproductions:

- Service: save the official DeepSeek profile with a key, then `saveProfile({profileId:'deepseek', sourceKind:'custom-proxy', endpoint:'https://relay-attacker.example.com', ...})` → `INVALID_INPUT`; the row remains `sourceKind: official`, endpoint `https://api.deepseek.com`, key still configured. The real IPC `providerProfileSave` handler returns the same rejection.
- `local-openai` and `spark` custom-proxy conversion → `INVALID_INPUT`; an official Spark save with the audited endpoint/model still succeeds.

Residual (non-blocking): a direct service call can still set `endpointPath: '/evil'` on an official profile (the IPC parser does not accept `sourceKind: 'official'`, and the UI edit is disabled, so this is not product-reachable); changing a **custom** profile's endpoint keeps its stored key (consent still binds the actual endpoint/model for chat, test and discovery).

### B2 — discovery consent — FIXED

`discoverModels()` (`src/app/companion-service.ts:724-758`) now builds a discovery input for the exact `GET /models` URL, calls `consentPreview('connection-test', config, discoveryInput)`, awaits `authorize`, rejects `FORBIDDEN` when denied, re-checks the payload hash, and only then reads the key and fetches.

Independent reproductions (service and real IPC handler):

- Approval: exactly one `authorize` call; preview endpoint is the models URL; payload hash is 64 hex chars; the GET carries the Authorization header.
- Denial: `FORBIDDEN`; **zero** HTTP requests; no key is sent.
- After the B1 fix, the round-1 chain (repurpose deepseek → discover) is dead: the repurpose is `INVALID_INPUT`, and discovery on `deepseek` goes to `https://api.deepseek.com/models` with consent.

Residual (non-blocking): the consent action is labelled `connection-test` rather than a discovery-specific action; the code checks the consent hash but not `providerId`/expiry via `assessProviderRequest`; `discoverModels` does not re-validate the profile shape (a tampered DB row with `private-network`/a non-official endpoint would be consent-gated but not shape-rejected). These are defense-in-depth items, not silent egress paths.

### B3 — v48 collision / fail-closed — FIXED for this branch

`applyMigrations()` now throws `SchemaIdentityError` for a version/name identity mismatch (`src/persistence/migrations.ts:2634-2670`), and `SqliteDatabase.open()` rethrows and closes the connection instead of degrading (`src/persistence/database.ts:106-111`).

Independent reproductions:

- A v48 database carrying Stage-4's migration name `pending-decision-terminal-state` (built from the v1–v47 schema plus a Stage-4 probe table) opened by this branch → `Local storage could not be opened.`; no degraded open, no provider query.
- The reverse direction (`applyMigrations` with the Stage-4 migration set over a provider-v48 database) → `Unsupported database schema version.`
- A normal v47→v48 upgrade still applies and preserves the three legacy profiles/secrets.

Residual (non-blocking process): the reverse direction (Stage-4 code opening a provider-v48 database) still depends on PR #40 being renumbered/updated; the delivery report's merge-order coordination requirement remains.

### B4 — acceptance wording — FIXED

`docs/testing/provider-multi-source-acceptance-matrix.md:11` now says "IPC save/list 通过；IPC test 到达 ... 后返回 provider 403 ... 分类为 PROVIDER_QUOTA"; the delivery report says the same. The committed result still has `test:false`, which is consistent with "test reached the provider and returned quota". The original overstatement is gone.

Residual documentation defects (non-blocking): the work log still says the security fix happened at 10:01–10:03Z and the final run at 10:06Z, but `34098fb` is 10:52Z and the run is 10:53Z; the commit table omits `493e125`/`f92d9a0`/`15c25aa`; the evidence index still says "provider 定向 10 files / 65 tests" (the provider suite is 91 tests); the acceptance matrix row 12 still says "CI 待 PR" and row 13 still says PENDING. The implementer's real run `20261104T105300Z-987ad9c2` records `workingTree: dirty` (honest, but the dirty files are not identified).

## 2. Independent verification performed

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | 0 | no diagnostics |
| `npx vitest run` | 0 | **113 files / 1044 tests passed** (173.38 s) |
| provider-focused suite (13 files) | 0 | **91 tests passed** (multi-source 10, IPC 2, continuity 1, manual-chat 8, local 4, UI 4, resolver 5, security 8, openai-compatible 11, policy 7, registry 6, retry 13, companion-service 12) |
| `npm run build` | 0 | main/preload/renderer bundles built |
| `npm run eval:provider-multi-source` with `MORROW_TEST_API_KEY` from the gitignored file | 0 | **BLOCKED_QUOTA**, run `20261104T111750Z-4a5aa1bf`, tree clean |

CI on the new head:

- Latest run: https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41818784423, head `15c25aa`, conclusion **success**; Ubuntu, Windows and Windows upgrade path all success; 113 test files on both OS jobs; Electron smoke passed on both; upgrade path 7 test files.
- The run cited in the evidence index (`41817829775`, head `f92d9a0`) is also success; it is one commit behind the current head but not false.

Independent real run (clean tree, review branch at `15c25aa`):

- Run `20261104T111750Z-4a5aa1bf`; `codeCommit 15c25aa`; `workingTree clean`; endpoint `https://api.supxh.xin/v1` (digest `81f2def21ea9d6eb`); model `gemini-3-flash`.
- Status **BLOCKED_QUOTA**; `ipc.save=true`, `ipc.list=true`, `ipc.test=false`; the IPC test reached the provider and returned `PROVIDER_QUOTA`; local `BLOCKED_LOCAL_SERVICE_NOT_RUNNING`.
- No key, Authorization header or response text is recorded.

Secret scan (round 2):

- 840 tracked files: 0 key occurrences.
- 174 result/transcript/review/doc files: 0.
- Latest CI logs (416,284 chars): 0 key, 0 `Authorization: Bearer`.
- PR diff `3812b18...15c25aa` (185,226 chars): 0.

## 3. Acceptance matrix (independent, round 2)

| # | Acceptance item | Status | Evidence |
|---|---|---|---|
| 1 | DeepSeek/Spark legacy upgrade keeps profiles/secrets | **PASS** | Real v47→v48 DB: 3 rows, fields preserved, secrets readable, unique default index. |
| 2 | UI can create two independent custom profiles with isolated endpoint/model/secret | **PASS** | Distinct fake keys; isolated read-back/update/delete; IPC save/list. |
| 3 | Custom remote OpenAI-compatible relay via the product path | **BLOCKED_QUOTA** | Independent run `20261104T111750Z-4a5aa1bf`; IPC save/list true, test reaches provider and returns quota; not PASS. |
| 4 | Local loopback OpenAI-compatible service via the product path | **BLOCKED_LOCAL_SERVICE_NOT_RUNNING** | No OpenAI-compatible local service; port 8000 returns 404 for `/v1/models`, `/models`, `/health`; no mock. |
| 5 | SSE/non-stream, retry, cancel, error classification regression | **PASS (mock HTTP)** | Full suite + independent adapter checks; real SSE blocked by item 3. |
| 6 | Provider/endpoint/model switch does not reset Morrow state | **PASS** | Independent A→reopen→B→A on real SQLite; core state and counts unchanged; derived counts not reset. |
| 7 | Consent binding to endpoint/model/payload; old consent unusable after switch | **PASS** | Endpoint/model/provider/expiry/sensitivity binding; discovery now requires consent (approval sends the key, denial sends nothing). |
| 8 | SSRF/redirect/private-network safety | **PASS at request time** | HTTP/userinfo/query/fragment/loopback/private/link-local/metadata/DNS-private/redirect blocked; private-network NOT_SUPPORTED; save-time bracket/trailing-dot gaps remain non-egress. |
| 9 | No secret leakage; tracked/log/report scans 0 | **PASS** | 840 tracked, 174 artifacts, 416,284 CI-log chars, 185,226 diff chars: 0. |
| 10 | Real relay test with credentials; otherwise BLOCKED | **BLOCKED_QUOTA** | Credential used only via `MORROW_TEST_API_KEY`; provider quota; no real-provider PASS claimed. |
| 11 | Local service not running is explicitly BLOCKED, not mocked | **PASS (BLOCKED)** | `BLOCKED_LOCAL_SERVICE_NOT_RUNNING`; no mock. |
| 12 | Typecheck/tests/build/CI pass, no test deletion | **PASS** | tsc 0; 113/1044; build 0; latest CI `41818784423` all jobs success. |
| 13 | Independent reviewer reviews code and real call path | **COMPLETED** | Round 2; verdict PASS_WITH_NON_BLOCKING_BACKLOG. |
| 14 | PR not auto-merged, not merged to main/release | **PASS** | PR #51 OPEN, base release; release/main untouched. |
| 15 | Round-1 blockers B1/B2/B3/B4 fixed | **PASS** | Independent reproductions above; new tests in `provider-multi-source.integration.test.ts`. |

## 4. Remaining non-blocking backlog (prioritized)

1. **Stale health/capabilities after endpoint/model change (new regression).** `saveProfile` now preserves `lastTest`/`capabilities` unconditionally. Reproduced: test a profile (connected, streaming verified), then save it with a different endpoint/model; the old `lastTest` (old endpoint digest/model) and `streaming.verified: true` remain, and the UI shows "连接成功" for the untested configuration. Preserve only when endpoint/model are unchanged; otherwise reset to `null`/declared-only. This is display/diagnostic correctness, not a security gate, but it conflicts with "未测试不能标 verified".
2. **`testConnection` ignores `endpointPath` and a full chat URL base.** `connectionInput()` builds `${endpoint}/chat/completions`; a profile with `endpointPath: '/api/chat/completions'` or a base of the full `.../v1/chat/completions` throws `INVALID_INPUT` on test, while chat works through the resolver. Fix `connectionInput` to use `resolveChatEndpoint`.
3. **Official `endpointPath` guard.** A direct service call can set a path on an official profile (`deepseek` + `/evil`); the IPC/UI cannot, but the service should reject a non-null `endpointPath` for built-in official ids.
4. **Custom-profile credential binding.** Changing a custom profile's endpoint keeps its stored key. Consent still binds the new endpoint for every chat/test/discovery, but clearing the secret on endpoint change (or requiring re-entry) would close the residual credential-reuse path.
5. **Discovery consent hardening.** Use a `model-discovery` action label instead of `connection-test`; validate the consent through `assessProviderRequest` (providerId/expiry/hash) and validate the profile shape before sending the key.
6. **Documentation corrections.** Work-log timestamps (security fix 10:52Z, run 10:53Z, not 10:01–10:03/10:06Z); commit table missing `493e125`/`f92d9a0`/`15c25aa`; evidence index provider suite 91 (not 10/65); acceptance row 12 "CI 待 PR" → latest CI success; row 13 PENDING → round-2 review completed.
7. **Real-run evidence completeness.** The implementer's `20261104T105300Z-987ad9c2` was on a dirty tree; record which files were dirty or re-run clean. Add HTTP status/latency/attempts/exit code to the BLOCKED_QUOTA failure path (never the body).
8. **`speed26.toter.me` compatibility regression** was not run; record `BLOCKED_NO_SECRET` if no credential.
9. **Real-run fidelity.** The eval uses `MemorySecretStore` and calls IPC handlers directly, not the Electron `SafeStorageSecretStore` or the actual renderer form; state the limitation or add an Electron smoke with a local custom profile.
10. **Continuity coverage.** The product test does not cover self-model entries/interests (my independent test compared counts).
11. **Test key isolation.** The two-profile test still uses the same fake key for A and B; use distinct keys.
12. **Profile id length.** App/DB allow 1–64 chars, `SafeStorageSecretStore` allows at most 40; long user-supplied ids cannot store a key in production.
13. **Save-time endpoint validation** accepts `https://[::1]`, `https://[::ffff:127.0.0.1]`, `https://localhost.`; request-time policy blocks them with zero fetches, but reject earlier. Bracket IPv6 is handled at request time (public literals pass, private literals are blocked).
14. **`endpointPath: '/v1'`** with a bare base resolves to `/v1` without `/chat/completions`; document that `endpointPath` is a full path or normalize version-only paths.
15. **Residual SSRF ranges** `100.64.0.0/10` (CGNAT), `64:ff9b::/96` (NAT64) and `2002::/16` (6to4) are not classified private.
16. **Provider error messages** are DeepSeek-specific for custom profiles; make them provider-neutral.

## 5. Honesty notes

- The four round-1 blockers are fixed and independently reproduced; the new tests cover the built-in guard, discovery denial, schema identity and default/health preservation.
- The acceptance/delivery wording for item 3 is now accurate: save/list pass, test reaches the provider and returns quota; `test:false` is not misreported as a pass.
- The v48 renumbering requirement remains honestly stated; the branch now fails closed for a foreign v48 identity. The reverse direction still depends on PR #40/merge order.
- The evidence index CI run is one commit behind the current head but true; the work-log timestamps and provider-suite count are stale and should be corrected.
- The implementer's new real run is on a dirty tree; my clean run at `15c25aa` reproduces the same BLOCKED_QUOTA classification.
- No key appears in tracked files, results, transcripts, docs, CI logs or the PR diff.

## 6. Recommendation

Keep PR #51 OPEN and unmerged. The round-1 security blockers are closed; the code foundation is acceptable with the backlog above. Fix the stale health/capabilities regression and the documentation corrections before final delivery, re-run CI and the real-run evidence when the provider quota/local service allow it, then request a final review. The status remains **PARTIAL**, not COMPLETE.
