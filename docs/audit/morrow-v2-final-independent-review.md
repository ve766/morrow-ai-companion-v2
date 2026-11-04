# Morrow V2 Final Independent Review (Issue #53)

Independent reviewer: separate context, did not write the implementation. No product code, test, migration, CI, or existing doc was modified. Only this file and `docs/audit/morrow-v2-final-file-review-matrix.md` were rewritten.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` |
| Branch | `feat/morrow-v2-final-closure` |
| Reviewed HEAD | `a8458898ab8936c122aed3ba76030339fbfd94e5` (pushed; docs-only over `d07b3f4`) |
| Final code SHA | `d07b3f4b951fab2bd522413c789850055a49fe61` |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft |
| PR base/head | `release/morrow-v2-final-delivery` / `feat/morrow-v2-final-closure` |
| PR head SHA | `a8458898ab8936c122aed3ba76030339fbfd94e5` |
| Mergeability | `MERGEABLE`, merge state `CLEAN` |
| Current CI run | [41862065143](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41862065143), head `a845889`, conclusion `success`, 4/4 jobs pass |
| Prior code-SHA CI run | [41859315790](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41859315790), head `d07b3f4`, conclusion `success`, 4/4 jobs pass |

CI job detail for the final HEAD run:

| Job | Result | URL |
| --- | --- | --- |
| Typecheck, tests, build and smoke (ubuntu-latest) | pass | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41862065143/job/126686261601 |
| Typecheck, tests, build and smoke (windows-latest) | pass | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41862065143/job/126686261958 |
| Windows package, install and installed-app smoke | pass | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41862065143/job/126686261128 |
| Windows upgrade path (schema migrations under the real app) | pass | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41862065143/job/126686261798 |

The Windows product-path step in the final HEAD run also passed, and the artifact contains a new PASS JSON (`20261104T155831Z-899f5cb0`, 18 checks). The committed PASS evidence (`20261104T154241Z-1430f856`) matches the prior code-SHA artifact from run `41859315790`.

## 1. Verdict

# **PASS_WITH_NON_BLOCKING_BACKLOG**

All Issue #53 §三 P1/P2 items are closed at this HEAD. The final code SHA has a 4/4 green CI run, the final docs-only HEAD has a 4/4 green CI run, PR #54 is `CLEAN`, and the product-path acceptance now passes on Windows CI with real OS SafeStorage evidence. The remaining backlog is P3 documentation/evidence polish and external provider availability; no open P1/P2, secret leak, migration data-loss risk, or failing critical test was found.

## 2. What changed since the previous review

- `scripts/product-path-smoke.mjs`: `seedScript` is now an async IIFE (`:273`); the final continuity snapshot is awaited (`:538`); the provider panel is awaited via `#provider-profile-list[aria-busy=false]` (`:174`); Electron is closed with `window.close()` before restart (`:187-191`); continuity uses baseline identity/content preservation and allows normal growth (`:52-66`) instead of exact array equality; database continuity checks counts (`:48`, `:250`).
- `.github/workflows/ci.yml`: product-path runs only on Windows (`:62-63`), where the OS keyring exists; the Windows package job no longer forces `MORROW_SMOKE_DISABLE_SANDBOX=1`; package/install smoke passes.
- `src/shared/errors.ts`: `ApplicationError` carries `httpStatus` (`:27-33`); adapter/discovery populate it; `healthForError` uses it (`src/app/companion-service.ts:980-991`).
- `evals/provider-multi-source/run.ts`: blocked runs now record `failure.httpStatus`, latency, attempts, `streamDeltaCount`, and `exitCode`.
- `tests/provider-profiles-ui.test.ts`: new official-profile edit/delete disabled test (`:143`).
- Docs: test count 1129/0 skipped, schema v49, regenerated provider runs, product-path PASS evidence, CI 4/4 PASS.

## 3. P1/P2 findings (Issue #53 §三)

Legend: CLOSED = fixed and independently reproduced; OPEN = still defective; PARTIAL = a required layer/evidence is missing.

| ID | Finding | Code location at HEAD | Reproduction / attack path | Tests / probe | Conclusion |
| --- | --- | --- | --- | --- | --- |
| P1-1 | Stale health/capabilities after config change | `src/app/companion-service.ts:580-617` (`destinationChanged`, `modelChanged`, `credentialChanged`, `connectionSemanticsChanged`), `:616-617` | Change endpoint/path/protocol/model/sourceKind or credential, then read the profile: `lastTest` must be `null`, `capabilities.streaming.verified` false; only displayName/enabled/isDefault may preserve | `src/app/provider-multi-source.integration.test.ts:352-432`; independent probe: endpoint change → `lastTest=null`, verified=false, secret cleared | **CLOSED** |
| P1-2 | Connection-test URL differs from chat URL | `src/app/companion-service.ts:416-429` (`connectionInput` → `resolveChatEndpoint`), `src/providers/endpoint-resolver.ts:50-70`, `src/providers/openai-compatible.ts:263-270` (adapter equality check) | Save base, `/v1`, full chat URL, custom path and trailing-slash shapes; test URL must equal the chat URL and must not duplicate `/v1`/`/chat/completions` | `provider-multi-source.integration.test.ts:434-454` (6 shapes); `endpoint-resolver.test.ts`; independent probe: test URL `https://relay.example.com/v1/chat/completions` | **CLOSED** |
| P1-3 | Official profile override | `src/app/companion-service.ts:542-557` (built-in id/sourceKind/endpoint/model/path checks), `src/shared/validation.ts:235-258` (IPC rejects `official`), `src/renderer/src/provider-profiles-ui.ts:101,111,123-124` (edit/delete disabled) | Direct service call with `deepseek`/`spark`/`local-openai` + foreign endpoint/path/sourceKind must throw; IPC `providerProfileSave` with `sourceKind:'official'` must return `INVALID_INPUT`; UI must not expose edit/delete for official | `provider-multi-source.integration.test.ts:456-485`; `provider-multi-source-ipc.integration.test.ts:86-98`; new UI test `tests/provider-profiles-ui.test.ts:143` (edit/delete disabled) | **CLOSED** — service, IPC and UI layers are now covered. |
| P1-4 | Custom profile secret binding | `src/app/companion-service.ts:580-700` (`willClearCredential`, secret-first/row-second, compensation), `:639-649`, `:689-700` | Change endpoint/path/sourceKind without a new key: old secret must be deleted, remote profile disabled, `apiKeyConfigured=false`; new-key write failure must restore the old secret and old row; restart must read the OS secret back | `provider-multi-source.integration.test.ts:373-430`, `:487-521`; product-path PASS `20261104T154241Z-1430f856`: distinct OS ciphertext files, restart readback, endpoint-change clearing, rekey rotation, delete isolation; current HEAD CI also PASS (`20261104T155831Z-899f5cb0`) | **CLOSED** — real OS SafeStorage path is now verified on Windows CI. |
| P1-5 | Model-discovery consent path | `src/app/companion-service.ts:785-865`; `src/providers/provider-policy.ts:6` (`model-discovery` action); `src/app/index.ts:80-140` (dialog action label) | Deny consent or make endpoint policy reject: authenticated GET must not be sent (fetch count 0); discovery must validate profile/resolver/policy before fetch; 1 MB response limit | `provider-multi-source.integration.test.ts:524-568`; independent probe: denial fetch 0, policy rejection fetch 0/previews 0, action `model-discovery`, models parsed; 1 MB content-length test | **CLOSED** (service/IPC). P3: `ProviderConsent` still has no `action` field; action binding is via the preview and endpoint+body hash, which prevents practical reuse. |
| P2-1 | Profile id 40 vs SecretStore 40 | `src/providers/provider-registry.ts:37-38`; `src/shared/validation.ts:206-210`; `src/persistence/migrations.ts:2591-2593`; `src/security/secrets.ts:24-25` | 40-char id accepted at service/IPC/DB/OS store; 41-char rejected; existing Provider v48 41–64-char row must not be silently truncated | `migrations.test.ts:797-804`; IPC test `:100-109`; independent probe: 40 accepted, 41 `INVALID_INPUT`; OS-store probe: 40 set/get succeeds, 41 rejected; migration probe: 41-char Provider v48 row fails closed and is preserved | **CLOSED** for the application/DB/OS constraint. P3: a legal Provider v48 41–64-char row blocks v49 upgrade until manually renamed; no data loss and the docs record recovery. |
| P2-2 | Endpoint security boundaries | `src/providers/endpoint-security.ts:35-168`; `src/providers/endpoint-resolver.ts:20-34`; `src/providers/openai-compatible.ts:292-307` (`redirect:'error'`) | IPv6 loopback, IPv4-mapped hex/dotted, IPv4-compatible, CGNAT, NAT64, 6to4, link-local/ULA/multicast/unspecified, localhost trailing dot, metadata, userinfo/query/fragment, decimal/octal/short IPv4, HTTP remote, private-network, redirect | `endpoint-security.test.ts`; independent probe: 30/30 endpoint classifications, 10/10 `isPrivateAddress`, 8/8 resolver, 3/3 DNS policy; redirect probe: redirect rejected, target fetch count 0 | **CLOSED** |
| P2-3 | Error classification and endpointPath semantics | `src/providers/openai-compatible.ts:308-324` (quota/auth/model/429/5xx mapping); `src/app/ipc.ts:176-200` (generic “模型服务/该 Provider” messages); `src/providers/endpoint-resolver.ts:50-93`; `src/renderer/index.html` provider-path help; `src/app/companion-service.ts:844-849` (1 MB check) | Custom profile must not show DeepSeek-specific errors; `/v1` vs `/v1/chat/completions` must resolve unambiguously; discovery body/error must be bounded and sanitized | `openai-compatible.test.ts`, `provider-retry.test.ts`, resolver tests, discovery oversized-body test; independent probes | **CLOSED** for errors/path/limit. P3: the native consent dialog still says “DeepSeek” and links DeepSeek pricing for custom relays; discovery enforces the 1 MB limit after `response.text()` buffers the body, not while streaming. |

## 4. Migration verdict

**PASS.** Independent migration probe: 17/17 checks, 0 failures.

| Probe | Result |
| --- | --- |
| release v47 → 49 with legacy `deepseek`/`spark`/`local-openai` rows and pending data | PASS — rows, pending item, v48 columns and v49 version preserved |
| Stage 4 v48 → 49 | PASS — pending/provider rows preserved |
| Provider v48 identity `provider-multi-source-profiles` → 49 through bridge | PASS — pending columns added, v48 name relabeled, custom row preserved |
| Repeated startup and bridge retry after committed column add but uncommitted label | PASS — relabel only, no duplicate `ALTER` |
| v49 failure rollback and retry | PASS — duplicate-default failure rolls back to v48 shape; retry succeeds after fix |
| Foreign v48 name | PASS — `SchemaIdentityError`, no open/write |
| Known name with wrong structure (Stage 4 and Provider names) | PASS — `SchemaIdentityError` |
| 40/41-char id boundary | PASS — 40 migrates; 41 fails closed, v48 row preserved, rename to 40 then migrates |

`npx vitest run src/persistence/migrations.test.ts src/app/provider-multi-source.integration.test.ts`: **2 files / 41 tests passed, exit 0**.

Residual migration notes (P3, not data loss):

- A legal Provider v48 profile id of 41–64 characters cannot pass the v49 CHECK. Migration fails closed and rolls back; the row is preserved. The docs describe renaming the id, but not that the OS secret file is keyed by the old id, so the user must re-enter the key. No released Provider v48 database exists.
- `SqliteDatabase.open` catches a non-identity v49 failure and opens degraded at v48. For a Provider v48 database the provider table is the extended shape and the app remains usable; for a release v47 database a v49 failure is unlikely with valid release data, but the degraded-open path is not covered by a test. Observability/hardening gap, not a demonstrated data-loss path.

## 5. Security / consent / secret verdict

**PASS.** Independent security probe: 73/73 assertions, 0 failures.

- Endpoint classification: 30/30 required boundary cases blocked/allowed as expected (IPv6 loopback, mapped hex/dotted, IPv4-compatible, CGNAT edges, NAT64 public/private, 6to4 public/private, link-local/ULA/multicast/unspecified, localhost and metadata trailing dot, decimal/octal/short IPv4, userinfo/query/fragment, HTTP remote, private-network, local loopback/private).
- `isPrivateAddress`: 10/10; DNS policy: public allowed, private blocked, lookup failure blocked.
- Resolver: 8/8 (bare base, `/v1`, full chat URL, custom prefix, trailing slash, models path, normalization).
- Service: 18/18 (40/41 id, official and `local-openai` override rejection, endpoint change clears secret and disables, health/capabilities cleared, discovery denial fetch 0, policy rejection fetch 0 and previews 0, discovery action, connection URL equality, replacement-secret failure restores old secret/row).
- OS store: 40-char set/get succeeds; 41-char rejected.
- Redirect: adapter rejects the redirect (`PROVIDER_NETWORK`) and the redirect target receives 0 requests; no Authorization follows a redirect.

Secret scan (tracked blobs; counts only, no values):

| Pattern | Result |
| --- | --- |
| `sk-[A-Za-z0-9_-]{16,}` | 11 matches in 9 files; all confirmed false positives (`risk-dependency` filename fragments, `task-status` CSS/fixture ids), no token |
| `Bearer <20+ token>` | 0 matches |
| Test `apiKey` literals | 16 literals in provider tests; all fake descriptive shapes, no `sk-`, no real-looking provider key |
| Evidence JSON/transcripts | No key, no Authorization header, no response body; only statements that none are recorded |
| Real provider results | `BLOCKED_QUOTA` both; HTTP 403/latency/attempts/deltas/exit recorded; no key/body |

Residual security/consent P3:

- Native consent copy is still DeepSeek-specific for custom remote profiles (`src/app/index.ts:98-124`): the dialog title/message says “发送到 DeepSeek” and shows DeepSeek pricing even when the endpoint is a custom relay. The exact endpoint, model and payload are shown, so informed consent is not completely defeated, but the copy is factually wrong and should be generic.
- Discovery enforces the 1 MB limit after `response.text()` has buffered the whole body (`src/app/companion-service.ts:844-849`); a malicious endpoint can force memory use before rejection. Error-body reading in the adapter similarly reads the full body before slicing to 4 KB (`src/providers/openai-compatible.ts:87-103`).
- `ProviderConsent` has no `action` field; action binding is only in the preview and in the endpoint+body hash. No practical cross-action reuse was found.
- DNS rebinding between lookup and connect remains a documented residual risk; redirects are refused and every attempt re-checks.

## 6. Product real-path verdict

**PASS on Windows CI; local host remains blocked and is honestly recorded.**

- The script drives the real renderer provider form through DOM events → preload bridge → IPC → SQLite, then reads/writes the OS SafeStorage secret files under the isolated profile and restarts the app.
- Final HEAD CI run `41862065143` (Windows main job `126686261958`) passed the `Electron product-path acceptance` step. The artifact contains `20261104T155831Z-899f5cb0.json`: `PASS`, 18/18 checks, Electron 44.9.3, sandbox enabled, OS secret ciphertext digests distinct, restart readback, endpoint-change clearing, rekey rotation, delete isolation.
- The committed evidence `evals/morrow-v2-final/results/20261104T154241Z-1430f856.json` is `PASS`, 18/18 checks, and is byte-identical to the prior code-SHA artifact from run `41859315790` (`d07b3f4`). It is the final code-SHA evidence; the current HEAD artifact adds a second PASS run.
- Local host: the committed `20261104T124128Z-125af6f6.json` (`2147483651`) and `20261104T124142Z-933adad0.json` (`3221225477`, 0xC0000005) remain FAILED; the local Electron host crash is not hidden.
- The script explicitly records that native consent dialogs are not automatable through CDP and that connection tests were not triggered to avoid an unattended native dialog. It does not claim consent-dialog automation; consent denial/fetch-zero is proven by service integration tests at the same SHA.
- Continuity: baseline IDs/content for personality `systemRules`, self-model, interests, memories, goals and conversations are preserved; the normal startup growth of one interest is allowed. Database table counts are preserved. P3: the script does not compare personality `version`, relationship thread content, message content, or mutable status fields; it checks selected content and table counts. The provider-switch code does not touch those stores, and Stage 5 tests cover relationship service behavior, so this is an evidence-depth gap rather than a demonstrated regression.

## 7. Real-provider verdict

**BLOCKED_QUOTA (honest), not PASS; no secret leak.**

| Run | Endpoint | Status | Evidence |
| --- | --- | --- | --- |
| `20261104T135205Z-75b01260` | `https://api.supxh.xin/` | `BLOCKED_QUOTA` | `evals/provider-multi-source/results/20261104T135205Z-75b01260.json`, transcript; HTTP 403, latency 586ms, attempts 1, deltas 0, exit 0 |
| `20261104T135210Z-abf69f16` | `https://speed26.toter.me/` | `BLOCKED_QUOTA` | same directory, transcript; HTTP 403, latency 318ms, attempts 1, deltas 0, exit 0 |
| local OpenAI-compatible | none | `BLOCKED_LOCAL_SERVICE_NOT_RUNNING` | both JSONs’ `local` field |

The JSONs record run id, commit, branch, working tree, endpoint digest, model, profile id (not key), HTTP status, latency, attempts, stream delta count, exit code, and error classification. They do not present quota as PASS and contain no key, Authorization header or response body.

P3 evidence consistency: the two real-provider runs record `codeCommit` `c1f4450`, not the final code SHA `d07b3f4`. Provider code is unchanged between `c1f4450` and `d07b3f4` (the later commits are product-path/CI/docs only), so the evidence is functionally valid for the provider code, but the docs should state the exact commit. The baseline’s claim of a provider 403 `pre_consume_token_quota_failed` string is not present in the committed JSON/transcript; the JSON records HTTP 403 and the app-level `PROVIDER_QUOTA` classification.

## 8. Docs / evidence consistency

| Claim | Evidence | Finding |
| --- | --- | --- |
| Implementation `d07b3f4`; base `3812b18`; PR head `a845889` | Git history; PR | Consistent |
| Test count 124 files / 1129 tests, 0 skipped | Independent run: 124/1129, exit 0 | Consistent |
| `tsc --noEmit` and `npm run build` | Independent runs: both exit 0 | Consistent |
| Migration version 49 | Code and probes | Consistent |
| Final status `PARTIAL` | External providers/local service blocked; code/CI/product path pass | Consistent with Issue #53’s PARTIAL definition |
| CI 4/4 PASS | Final HEAD run 41862065143 4/4 PASS; prior code-SHA run 41859315790 4/4 PASS | Consistent; docs link the prior code-SHA run, not the final HEAD run |
| Product-path PASS evidence `154241` | Matches prior code-SHA artifact; current HEAD artifact `155831` also PASS | Consistent; docs cite the committed final-code-SHA run, not the newer docs-only HEAD run |
| Real-provider runs record SHA | JSONs record `c1f4450`, not `d07b3f4` | P3: provider code unchanged after `c1f4450`; docs should state the exact commit |
| `docs/architecture/database-schema.md` current schema | Header v49, v49 row present | Consistent |
| Acceptance matrix 1.9 Windows upgrade CI `PARTIAL`; 5.3 “产品路径脚本等待 CI” | Final CI 4/4 PASS; product-path passed | **Outdated**; should be PASS or link the final run |
| Acceptance matrix 4.4 “人格 systemRules/version” | Script compares `systemRules` only; version is read but not compared | P3 overstatement |
| Baseline 403 `pre_consume_token_quota_failed` | JSONs have HTTP 403 and app-level `PROVIDER_QUOTA`; no such string | P3 unsupported detail |
| Delivery report attributes HTTP status fix to `d07b3f4` | HTTP status fix is in `c1f4450`; `d07b3f4` is the final code SHA including it | P3 attribution imprecision |

Historical PR #40/#51/#52 documents and the provider v48 docs are retained and labeled with their own SHAs; they were not treated as final-SHA evidence. No historical evidence was rewritten.

## 9. Residual risks / P3 backlog

External blockers (status PARTIAL, not P3 defects):

1. `https://api.supxh.xin` and `https://speed26.toter.me` return HTTP 403 quota; no real non-stream/SSE PASS is possible. The run is honestly BLOCKED_QUOTA.
2. No local OpenAI-compatible service was running; BLOCKED_LOCAL_SERVICE_NOT_RUNNING. No mock was substituted.

P3 backlog (each is non-blocking for safety, data integrity or core companion experience):

1. **Consent dialog copy is DeepSeek-specific for custom remote profiles.** The target endpoint/model/payload are shown, so this is a misleading-consent UX defect, not a bypass.
2. **Discovery/error body limits are post-read, not streaming.** User-triggered; bounded by the 1 MB check; DoS hardening only.
3. **`ProviderConsent` lacks an `action` field.** The endpoint+body hash prevents practical cross-action reuse; defense-in-depth.
4. **Provider v48 41–64-char id migration fails closed.** No released Provider v48 database exists; no data loss; manual rename required; docs should mention the secret file.
5. **`validateProviderConfig` does not reject `endpointPath` on an official profile at request time.** Unreachable through current service/IPC/UI; defense-in-depth.
6. **Continuity evidence depth.** Product path checks selected baseline content and table counts, not personality version, relationship content, message content, or mutable statuses. Provider switching does not touch those stores; Stage 5 tests cover relationship service; evidence-depth gap only.
7. **Docs/evidence polish.** CI link/run IDs point to the prior code-SHA run; real-provider commit is `c1f4450`; acceptance matrix 1.9/5.3 and 4.4 need updates; baseline 403 string is unsupported. No product behavior impact.
8. **`MORROW_EVAL_SHA` can override the recorded commit.** Evidence-integrity risk for future eval runs; the current runs used the actual checkout.
9. **`setDefaultProfile` does not verify credential presence.** Chat still fails closed in `assertUsable`; profile selection only.
10. **`getProvider` ignores an explicit custom default** and falls back to local/DeepSeek for the legacy settings card; settings display only.
11. **Some special-use IPv4 ranges (198.18.0.0/15, 192.0.0.0/24) are not classified private.** Not in the required boundary list; low SSRF relevance.
12. **DNS rebinding residual risk.** Documented; redirects refused and each attempt re-checked.

Additional residual risk (not classified P3, because it can require key re-entry): `SafeStorageSecretStore.delete` does not check availability, while the following `get` verification does. If OS storage availability flips between the read and the delete, the old secret file can be deleted while the compensation cannot rewrite it. The profile row stays unchanged and chat fails closed; the user must re-enter the key. No normal-path reproduction was found; if reproduced it should be treated as P2, though it is not a secret disclosure and the profile/companion data remain intact.

## 10. Exact commands and exit codes

All commands were run from the repository root. `TEMP`/`TMP`/`TMPDIR` were set to `<repo>/.tmp/es` for esbuild/vitest on this host.

| Command | Exit | Result |
| --- | --- | --- |
| `gh pr view 54 --json ...` | 0 | OPEN, head `a845889`, `MERGEABLE`, `CLEAN` |
| `gh pr checks 54` | 0 | 4/4 jobs pass on run `41862065143` |
| `gh run view 41862065143 --json ...` | 0 | head `a845889`, conclusion `success`, 4 jobs |
| `gh run view 41859315790 --json ...` | 0 | head `d07b3f4`, conclusion `success`, 4 jobs |
| `gh api repos/.../actions/runs/41862065143/artifacts` | 0 | Product-path artifact contains PASS `20261104T155831Z-899f5cb0` (18 checks) |
| `gh api repos/.../actions/runs/41859315790/artifacts` | 0 | Product-path artifact contains PASS `20261104T154241Z-1430f856` (18 checks), byte-identical to committed evidence |
| `git diff --stat 3812b18...HEAD` | 0 | 169 files, 21080 insertions, 493 deletions |
| `npx tsc --noEmit` | 0 | Clean |
| `npx vitest run src/persistence/migrations.test.ts src/app/provider-multi-source.integration.test.ts src/app/provider-multi-source-ipc.integration.test.ts tests/provider-profiles-ui.test.ts` | 0 | 4 files / 49 tests passed |
| `npx vitest run` | 0 | 124 files / 1129 tests passed, 0 skipped |
| `npm run build` | 0 | main/preload/renderer bundles built |
| `.tmp/migration-probe2.mjs` | 0 | 17 checks, 0 failures |
| `.tmp/security-probe2.mjs` | 0 | 73 assertions, 0 failures (includes OS-store 40/41 and redirect) |
| Secret scan `git grep`/node over tracked blobs | 0 | `sk-` 11 false positives, `Bearer` tokens 0, test keys fake, evidence clean |
| `git status --porcelain` after review-doc rewrite | 0 | Only the two review docs are modified; no code/test change |

Probe files were placed under `.tmp/` and deleted after use. The current CI artifact was downloaded to `.tmp/` and deleted. No historical evidence was modified.

## 11. Conclusion

The blocking findings from the previous review are resolved:

- The product-path harness runs on both the code SHA and the final docs-only HEAD; Windows CI product-path passes with real OS SafeStorage, restart, endpoint-change, rekey and delete checks.
- CI on the final HEAD is 4/4 PASS and PR #54 is `CLEAN`.
- The P1-3 UI layer test exists; the P1-4 real OS path evidence exists; migration and security probes still pass.
- The remaining open items are P3 documentation/evidence polish, external provider quota/local-service blocks, and hardening items that do not affect safety, data integrity or the core companion experience.

**Verdict: PASS_WITH_NON_BLOCKING_BACKLOG.** The final status remains `PARTIAL` because real remote providers and a local OpenAI-compatible service are externally blocked; V2 should not be released until the user makes the release decision.
