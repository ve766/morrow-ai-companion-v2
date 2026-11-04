# Morrow V2 Final Independent Review (Issue #53)

Independent reviewer: separate context, did not write the implementation. No product code, test, migration, CI, or existing doc was modified. Only this file and `docs/audit/morrow-v2-final-file-review-matrix.md` were written.

## 0. Reviewed identity

| Item | Value |
| --- | --- |
| Repository | `ve766/morrow-ai-companion-v2` |
| Branch | `feat/morrow-v2-final-closure` |
| Working-tree HEAD reviewed | `bebfde60fcabc0f9d22cf5be5752c24da4129356` (docs/evidence commit) |
| Implementation SHA | `d9b28aecb47ff136bbdbda492c5be20ffc53bbd4` |
| Acceptance/evidence commit | `28665dfbcb724749ec56df0b8cfdb80578a3f84c` |
| Base | `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| PR | [#54](https://github.com/ve766/morrow-ai-companion-v2/pull/54), `OPEN`, not draft |
| PR base/head | `release/morrow-v2-final-delivery` / `feat/morrow-v2-final-closure` |
| PR head SHA | `28665dfbcb724749ec56df0b8cfdb80578a3f84c` |
| Mergeability | `MERGEABLE`, merge state `UNSTABLE` |
| CI run | [41834663403](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41834663403), head `28665df`, conclusion `failure` |

CI job detail at that run:

| Job | Result | URL |
| --- | --- | --- |
| Typecheck, tests, build and smoke (ubuntu-latest) | fail | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41834663403/job/126590373731 |
| Typecheck, tests, build and smoke (windows-latest) | fail | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41834663403/job/126590373813 |
| Windows package, install and installed-app smoke | fail | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41834663403/job/126590373757 |
| Windows upgrade path (schema migrations under the real app) | pass | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41834663403/job/126590373310 |

**The local HEAD `bebfde6` is one commit ahead of PR #54.** The commit adds the seven final delivery docs but is not on the PR head, so the PR does not yet contain the required delivery docs and CI has not run on that commit.

## 1. Verdict

# **DO_NOT_MERGE**

The provider P1/P2 code fixes are largely present and the migration/security probes pass, but the required product-path acceptance fails on both CI platforms, CI is red at the PR head, and the final delivery docs claim a status (`PARTIAL`) whose own definition requires CI/independent review to pass. Per Issue #53 §七, a failing critical test is a merge blocker.

### Blocking findings

1. **Product-path acceptance script cannot run (P1 acceptance blocker).** `scripts/product-path-smoke.mjs:230` defines `seedScript` as a bare expression containing top-level `await`; `scripts/product-path-smoke.mjs:352` evaluates it with CDP `Runtime.evaluate` without an async wrapper. Both Ubuntu and Windows CI fail with:
   `Renderer evaluation failed: SyntaxError: await is only valid in async functions and the top level bodies of modules.`
   CI artifacts `morrow-product-path-ubuntu-latest` (run `20261104T130546Z-3935d1df`) and `morrow-product-path-windows-latest` (run `20261104T131238Z-d673030f`) both record `status: FAILED` with zero checks. No product-path evidence exists.
2. **CI is red at the PR head.** Run `41834663403` at `28665df` has 3 failing jobs and 1 passing job:
   - Ubuntu `Typecheck, tests, build and smoke`: fail at the product-path step (above).
   - Windows `Typecheck, tests, build and smoke`: fail at the product-path step (above).
   - Windows `Windows package, install and installed-app smoke`: fail at the seed step; the built app exits `3221225477` (`0xC0000005`) during `npm run smoke`, so the install/startup step is never reached.
   - Windows `Windows upgrade path (schema migrations under the real app)`: pass, but it only runs `npx vitest run src/persistence` (9 files / 69 tests); it does not drive the real installed app through an upgrade.
3. **No real OS SafeStorage / restart-continuity evidence.** The product-path script is the only acceptance that exercises renderer DOM → preload → IPC → SQLite → OS SafeStorage and restart continuity. It fails before the first check, so Issue #53 §四.2, §四.4 and the P1 secret-binding product path remain unverified. Service-level tests use `MemorySecretStore` and a fault-injecting wrapper, not the OS store.
4. **Docs/evidence are inconsistent with the red CI.** See §7. In particular, the reported overall `PARTIAL` is not supported while CI is red, and the docs attribute the product-path block to the local Electron host crash without recording the script's own SyntaxError.
5. **Final delivery docs are not in PR #54.** The PR head is `28665df`; the required final docs (`baseline`, `integrated architecture`, `migration/recovery`, `acceptance matrix`, `delivery report`, `evidence index`, `work log`) are in local commit `bebfde6`, not on the PR. The PR also lacks the two review files written here.
6. **Two P1 items remain PARTIAL in §2.** P1-3 has no automated UI-layer rejection assertion (service/IPC enforcement prevents a bypass); P1-4 lacks real OS SafeStorage evidence because the product-path script fails. Under Issue #53's rule, an open P1/P2 is itself a merge blocker.

## 2. P1/P2 findings (Issue #53 §三)

Legend: CLOSED = the stated defect is fixed and independently reproduced; PARTIAL = the code path is fixed but a required layer/evidence is missing.

| ID | Finding | Code location at HEAD | Reproduction / attack path | Tests / probe | Conclusion |
| --- | --- | --- | --- | --- | --- |
| P1-1 | Stale health/capabilities after config change | `src/app/companion-service.ts:580-617` (`destinationChanged`, `modelChanged`, `credentialChanged`, `connectionSemanticsChanged`), `:616-617` | Change endpoint/path/protocol/model/sourceKind or credential, then read the profile: `lastTest` must be `null`, `capabilities.streaming.verified` false; only displayName/enabled/isDefault may preserve | `src/app/provider-multi-source.integration.test.ts:352-432`; independent probe: endpoint change → `lastTest=null`, verified=false, secret cleared | **CLOSED** |
| P1-2 | Connection-test URL differs from chat URL | `src/app/companion-service.ts:416-429` (`connectionInput` → `resolveChatEndpoint`), `src/providers/endpoint-resolver.ts:50-70`, `src/providers/openai-compatible.ts:263-270` (adapter equality check) | Save base, `/v1`, full chat URL, custom path and trailing-slash shapes; test URL must equal the chat URL and must not duplicate `/v1`/`/chat/completions` | `provider-multi-source.integration.test.ts:434-454` (6 shapes); `endpoint-resolver.test.ts`; independent probe: test URL `https://relay.example.com/v1/chat/completions` | **CLOSED** |
| P1-3 | Official profile override | `src/app/companion-service.ts:542-557` (built-in id/sourceKind/endpoint/model/path checks), `src/shared/validation.ts:235-258` (IPC rejects `official`), `src/renderer/src/provider-profiles-ui.ts:101,111,123-124` (edit/delete disabled) | Direct service call with `deepseek`/`spark`/`local-openai` + foreign endpoint/path/sourceKind must throw; IPC `providerProfileSave` with `sourceKind:'official'` must return `INVALID_INPUT`; UI must not expose edit/delete for official | `provider-multi-source.integration.test.ts:456-485`; `provider-multi-source-ipc.integration.test.ts:86-98`; UI code inspection only | **PARTIAL** — service and IPC reject official overrides; the UI disables edit/delete by code but has no automated UI rejection assertion. No bypass was found because IPC rejects even if a renderer calls the channel directly. |
| P1-4 | Custom profile secret binding | `src/app/companion-service.ts:580-700` (`willClearCredential`, secret-first/row-second, compensation), `:639-649`, `:689-700` | Change endpoint/path/sourceKind without a new key: old secret must be deleted, remote profile disabled, `apiKeyConfigured=false`; new-key write failure must restore the old secret and old row | `provider-multi-source.integration.test.ts:373-430` and `:487-521`; independent probe: endpoint change cleared secret and disabled; injected `set` failure restored old secret and old row | **PARTIAL** — service transaction and tested compensation are closed; the real OS SafeStorage save/read/restart path is unverified because the product-path script fails before its first check; a rare OS-availability-flip compensation edge is listed in §8. |
| P1-5 | Model-discovery consent path | `src/app/companion-service.ts:785-865`; `src/providers/provider-policy.ts:6` (`model-discovery` action); `src/app/index.ts:80-140` (dialog action label) | Deny consent or make endpoint policy reject: authenticated GET must not be sent (fetch count 0); discovery must validate profile/resolver/policy before fetch; 1 MB response limit | `provider-multi-source.integration.test.ts:524-568`; independent probe: denial fetch 0, policy rejection fetch 0/previews 0, action `model-discovery`, models parsed; 1 MB content-length test | **CLOSED** (service/IPC). P3: `ProviderConsent` carries provider/hash/times/sensitivity but no `action`; action binding is via the preview and endpoint+body hash, which prevents practical reuse but is weaker than the stated requirement. |
| P2-1 | Profile id 40 vs SecretStore 40 | `src/providers/provider-registry.ts:37-38`; `src/shared/validation.ts:206-210`; `src/persistence/migrations.ts:2591-2593`; `src/security/secrets.ts:24-25` | 40-char id accepted at service/IPC/DB/OS store; 41-char rejected; existing Provider v48 41–64-char row must not be silently truncated | `migrations.test.ts:797-804`; IPC test `:100-109`; independent probe: 40 accepted, 41 `INVALID_INPUT`; OS-store probe: 40 set/get succeeds, 41 rejected; migration probe: 41-char Provider v48 row fails closed and is preserved | **CLOSED** for the application/DB/OS constraint. P3: a legal Provider v48 41–64-char row blocks v49 upgrade until manually renamed; no data loss and the docs record recovery. |
| P2-2 | Endpoint security boundaries | `src/providers/endpoint-security.ts:35-168`; `src/providers/endpoint-resolver.ts:20-34`; `src/providers/openai-compatible.ts:292-307` (`redirect:'error'`) | IPv6 loopback, IPv4-mapped hex/dotted, IPv4-compatible, CGNAT, NAT64, 6to4, link-local/ULA/multicast/unspecified, localhost trailing dot, metadata, userinfo/query/fragment, decimal/octal/short IPv4, HTTP remote, private-network, redirect | `endpoint-security.test.ts`; independent probe: 32/32 endpoint classifications, 12/12 `isPrivateAddress`, 3/3 DNS policy; redirect probe: redirect rejected, target fetch count 0 | **CLOSED** |
| P2-3 | Error classification and endpointPath semantics | `src/providers/openai-compatible.ts:308-324` (quota/auth/model/429/5xx mapping); `src/app/ipc.ts:176-200` (generic “模型服务/该 Provider” messages); `src/providers/endpoint-resolver.ts:50-93`; `src/renderer/index.html` provider-path help; `src/app/companion-service.ts:844-849` (1 MB check) | Custom profile must not show DeepSeek-specific errors; `/v1` vs `/v1/chat/completions` must resolve unambiguously; discovery body/error must be bounded and sanitized | `openai-compatible.test.ts`, `provider-retry.test.ts`, resolver tests, discovery oversized-body test; independent probes | **CLOSED** for errors/path/limit. P3: the native consent dialog still says “DeepSeek” and links DeepSeek pricing for any non-`local-openai` profile, including custom relays; discovery enforces the 1 MB limit after `response.text()` buffers the body, not while streaming. |

## 3. Migration verdict

**PASS for the code paths required by Issue #53; Windows real-app upgrade remains UNVERIFIED.**

Independent probe (`31` checks, `0` failures) covered:

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

- A legal Provider v48 profile id of 41–64 characters cannot pass the v49 CHECK. Migration fails closed and rolls back; the row is preserved. The docs describe renaming the id, but not that the OS secret file is keyed by the old id, so the user must re-enter the key. No released Provider v48 database exists, so this is a bounded internal-branch edge.
- `SqliteDatabase.open` catches a non-identity v49 failure and opens degraded at v48. For a Provider v48 database the provider table is the extended shape and the app remains usable; for a release v47 database a v49 failure is unlikely with valid release data, but the degraded-open path is not covered by a test. This is an observability/hardening gap, not a demonstrated data-loss path.
- The `windows-install-path` job passes only persistence tests. The new `windows-package-smoke` job, which was intended to verify a real installed-app upgrade, fails before install. Therefore Windows upgrade under the real app is not verified.

## 4. Security / consent / secret verdict

**PASS for the implemented code and probes; no secret leak found.**

Independent probes (all exit 0, `0` failures):

- Endpoint classification: 32/32 required boundary cases blocked/allowed as expected (IPv6 loopback, mapped hex/dotted, IPv4-compatible, CGNAT edges, NAT64 public/private, 6to4 public/private, link-local/ULA/multicast/unspecified, localhost and metadata trailing dot, decimal/octal/short IPv4, userinfo/query/fragment, HTTP remote, private-network, local loopback/private).
- `isPrivateAddress`: 12/12; DNS policy: public allowed, private blocked, lookup failure blocked.
- Resolver: 13/13 (bare base, `/v1`, full chat URL, custom prefix, trailing slash, models path, userinfo/query/fragment/scheme rejection).
- Service probes: 17/17 (40/41 id, official and `local-openai` override rejection, endpoint change clears secret and disables, health/capabilities cleared, discovery denial fetch 0, policy rejection fetch 0 and previews 0, discovery action, connection URL equality, replacement-secret failure restores old secret/row).
- Redirect probe: adapter rejects the redirect (`PROVIDER_NETWORK`) and the redirect target receives 0 requests; no Authorization follows a redirect.

Secret scan (tracked blobs; counts only, no values):

| Pattern | Result |
| --- | --- |
| `sk-[A-Za-z0-9_-]{16,}` | 12 matches in 9 files; all confirmed false positives (`risk-dependency` filename fragments, `task-status` CSS/fixture ids), no token |
| `Bearer <20+ token>` | 0 matches |
| Test `apiKey` literals | 16 literals in provider tests; all fake descriptive shapes (`aaaa-aaa-a`, `key-…`, etc.), no `sk-`, no real-looking provider key |
| Evidence JSON/transcripts | No key, no Authorization header, no response body; only statements that none are recorded |
| Real provider results | `BLOCKED_QUOTA` both; no key/body; endpoint digest/model/profile id only |

Residual security/consent P3:

- Native consent copy is still DeepSeek-specific for custom remote profiles (`src/app/index.ts:98-124`): the dialog title/message says “发送到 DeepSeek” and shows DeepSeek pricing even when the endpoint is a custom relay. The exact endpoint, model and payload are shown, so informed consent is not completely defeated, but the copy is factually wrong and should be generic.
- Discovery enforces the 1 MB limit after `response.text()` has buffered the whole body (`src/app/companion-service.ts:844-849`); a malicious endpoint can force memory use before rejection. Error-body reading in the adapter similarly reads the full body before slicing to 4 KB (`src/providers/openai-compatible.ts:87-103`).
- `ProviderConsent` has no `action` field; action binding is only in the preview and in the endpoint+body hash. No practical cross-action reuse was found, but the stated “bind the action” requirement is only partially represented in the consent record.
- DNS rebinding between lookup and connect remains a documented residual risk; redirects are refused and every attempt re-checks, which is the expected mitigation for this build.

## 5. Product real-path verdict

**FAILED / UNVERIFIED.**

What the script actually does (`scripts/product-path-smoke.mjs`):

- Launches the built Electron app with an isolated profile and CDP.
- Drives the real renderer provider form (`#provider-profile-form`) through DOM events → preload bridge → IPC → `ProviderConfigService` → SQLite.
- Reads/writes the OS SafeStorage secret files under the profile (`secrets/<id>.bin`), checks distinct ciphertext digests per profile, restart readback, endpoint-change clearing, re-key rotation, delete isolation.
- Snapshots personality/self-model/interests/memories/goals/relationship/conversations/pending/reflection tables and bridge-visible state across A → restart → B → A, comparing hashes.
- Explicitly records that native consent dialogs are not automatable through CDP and that connection tests were not triggered to avoid an unattended native dialog. It does not claim consent-dialog automation. Consent-denial/fetch-zero is delegated to the service integration suite at the same SHA.

Why it fails:

- Local host: `node scripts/product-path-smoke.mjs` exits 1 with `Application exited during launch (2147483651)` (0x80000003). The committed local evidence records `2147483651` and `3221225477` (0xC0000005). The host Electron crash is real and honestly recorded.
- CI: both platforms launch Electron but fail at the first renderer evaluation with the top-level-await SyntaxError described in §1. The CI artifacts contain FAILED JSONs, not product-path PASS evidence.
- Windows package/install smoke: fails at the seed `npm run smoke` step with `3221225477` (0xC0000005), so the NSIS install and installed-app start are never exercised.

Conclusion: the script's design matches the required path, and the local FAILED result is honestly recorded, but there is no successful product-path execution on any platform. Issue #53 §四.1/§四.2/§四.4/§四.7 are not satisfied.

## 6. Real-provider verdict

**BLOCKED_QUOTA (honest), not PASS; no secret leak.**

| Run | Endpoint | Status | Evidence |
| --- | --- | --- | --- |
| `20261104T123748Z-5fc34109` | `https://api.supxh.xin/` | `BLOCKED_QUOTA` | `evals/provider-multi-source/results/20261104T123748Z-5fc34109.json`, transcript |
| `20261104T123809Z-02e942cb` | `https://speed26.toter.me/` | `BLOCKED_QUOTA` | same directory, transcript; working tree `dirty` (previous evidence file), recorded honestly |
| local OpenAI-compatible | none | `BLOCKED_LOCAL_SERVICE_NOT_RUNNING` | both JSONs’ `local` field |

The JSONs record run id, commit `d9b28ae`, branch, working tree, endpoint digest, model, profile id (not key), checks and error classification. They do **not** present quota as PASS, and they contain no key, Authorization header or response body.

P3 evidence gap: for the blocked runs the JSONs do not contain the HTTP status (403), latency, attempts, stream delta count, or process exit code that the delivery report says every run records. The baseline’s claim of a provider 403 `pre_consume_token_quota_failed` is not present in the committed JSON/transcript; only the app-level `PROVIDER_QUOTA` message is recorded.

## 7. Docs / evidence consistency

| Claim | Evidence | Finding |
| --- | --- | --- |
| Implementation `d9b28ae`; evidence `28665df`; base `3812b18` | Git history; PR body | Consistent |
| PR #54 head | PR head is `28665df`, local HEAD `bebfde6` | Final delivery docs are not in the PR; CI has not run on the final HEAD |
| `vitest run` 124 files / 1128 tests | Independent run: 124/1128, exit 0 | Consistent |
| `tsc --noEmit` and `npm run build` | Independent runs: both exit 0 | Consistent |
| Migration version 49 | Code and probes | Consistent |
| Overall status `PARTIAL` | CI is red and product path unverified | **Not supported** by Issue #53’s definition of PARTIAL (code/CI/independent review pass); should be `FAILED`/`BLOCKED` until CI is green |
| CI includes product-path / Windows package-install / upgrade | Run 41834663403 exists; product-path and package jobs fail; upgrade job passes only persistence tests | **Inconsistent**: presence is true, success is not |
| “5 historical skips preserved” (`delivery-report.md:48`, acceptance matrix 5.4) | Full suite reports 1128 passed, 0 skipped; no `.skip`/`skipIf` in `src`/`tests` | **False**; no skipped tests exist |
| Real-provider runs record HTTP status/latency/attempts/exit code (`delivery-report.md:74`) | Blocked JSONs contain none of those fields | **False** for the blocked runs |
| CI artifacts contain final-SHA JSON + transcript (`evidence-index.md:66`) | Artifacts contain `28665df` FAILED JSONs (run IDs above) | True but FAILED; not product-path evidence |
| Local Electron crash 0xC0000005 (`baseline.md:63`, `delivery-report.md:72`) | Local JSONs: `2147483651` (0x80000003) and `3221225477` (0xC0000005); our rerun: `2147483651` | Partially accurate; the first run is 0x80000003 |
| `docs/architecture/database-schema.md` current schema | Header says “当前 v48” and lists v48 only | **Stale**: final schema is v49; should be updated or marked historical |
| Acceptance matrix 4.1/4.2/4.4/4.7 `PARTIAL` waiting for CI | CI has executed and failed; no OS SafeStorage evidence | **Outdated**; should record FAILED/UNVERIFIED and the script bug |
| Windows upgrade under real app | `windows-install-path` runs only `npx vitest run src/persistence`; `windows-package-smoke` fails at seed | **Not verified** |

Historical PR #40/#51/#52 documents and the provider v48 docs are retained and labeled with their own SHAs; they were not treated as final-SHA evidence. No historical evidence was rewritten.

## 8. Residual risks / P3 backlog

Each P3 below is non-blocking for safety/data integrity/core companion experience on its own; the blocking items are in §1.

1. **Provider v48 41–64-char id migration fails closed.** No data loss; manual id rename is required, and the OS secret file must also be renamed or the key re-entered. No released Provider v48 database exists; documented recovery is incomplete about the secret file.
2. **`validateProviderConfig` does not reject `endpointPath` on an official profile at request time.** `saveProfile` rejects it, and IPC/UI cannot create it; a pre-existing Provider v48 row created by a direct service call could retain it. Defense-in-depth hardening.
3. **Consent dialog copy is DeepSeek-specific for custom remote profiles.** The target endpoint/model/payload are shown, so this is a misleading-consent UX defect, not a bypass.
4. **Discovery/error body limits are post-read, not streaming.** A malicious user-selected endpoint can force memory use before rejection; user-triggered and bounded by the 1 MB check.
5. **`ProviderConsent` lacks an `action` field.** The endpoint+body hash prevents practical cross-action reuse; adding the action would match the requirement more literally.
6. **`setDefaultProfile` does not verify credential presence.** Chat still fails closed in `assertUsable`; the profile can be selected but cannot send.
7. **`getProvider` ignores an explicit custom default** and falls back to local/DeepSeek for the legacy settings card; settings display only.
8. **No automated UI test for official edit/delete disabled.** Service and IPC enforcement are tested; the UI is disabled by code inspection.
9. **Windows upgrade job name overstates coverage.** It runs persistence tests, not the real installed app; the new package smoke is the real test and fails.
10. **Eval evidence commit can be overridden by `MORROW_EVAL_SHA`.** The real-provider runs used `d9b28ae`; the override is an evidence-integrity risk for future runs.
11. **Real-provider blocked runs lack HTTP status/latency/attempts/exit code.** Evidence quality only; the status is honestly BLOCKED_QUOTA.
12. **`docs/architecture/database-schema.md` is stale at v48.** Documentation only.
13. **Some special-use IPv4 ranges (198.18.0.0/15, 192.0.0.0/24) are not classified private.** Not in the required boundary list; low SSRF relevance.
14. **DNS rebinding residual risk.** Documented; redirects refused and each attempt re-checked.

Additional residual risk (not classified P3, because it can require key re-entry): `SafeStorageSecretStore.delete` does not check availability, while the following `get` verification does. If OS storage availability flips between the read and the delete, the old secret file can be deleted while the compensation cannot rewrite it. The profile row stays unchanged and chat fails closed; the user must re-enter the key. No normal-path reproduction was found; if reproduced it should be treated as P2, though it is not a secret disclosure and the profile/companion data remain intact.

## 9. Exact commands and exit codes

All commands were run from the repository root. `TEMP`/`TMP`/`TMPDIR` were set to `<repo>/.tmp/es` for esbuild/vitest on this host.

| Command | Exit | Result |
| --- | --- | --- |
| `gh pr view 54 --json ...` | 0 | OPEN, base/head as above, `MERGEABLE`, `UNSTABLE`, head `28665df` |
| `gh pr checks 54` | 1 | 3 failing checks, 1 passing (exit 1 because checks fail) |
| `gh run view 41834663403 --json headSha,status,conclusion,...` | 0 | head `28665df`, conclusion `failure` |
| `gh run view --job 126590373731 --log-failed` | 0 | Ubuntu product-path: `SyntaxError: await is only valid in async functions...` |
| `gh run view --job 126590373813 --log-failed` | 0 | Windows product-path: same SyntaxError |
| `gh run view --job 126590373757 --log-failed` | 0 | Windows package smoke: seed smoke exits `3221225477` |
| `gh run view --job 126590373310 --log` | 0 | Windows upgrade: 9 files / 69 tests passed (persistence only) |
| `gh api repos/ve766/morrow-ai-companion-v2/actions/runs/41834663403/artifacts` | 0 | Both product-path artifacts exist; both contain FAILED JSONs |
| `git diff --stat 3812b18...HEAD` | 0 | 157 files, 20130 insertions, 484 deletions |
| `git diff --stat 3812b18...28665df` | 0 | 150 files, 19492 insertions, 484 deletions (PR head excludes the 7 final docs) |
| `npx tsc --noEmit` | 0 | Clean |
| `npx vitest run src/persistence/migrations.test.ts src/app/provider-multi-source.integration.test.ts` | 0 | 2 files / 41 tests passed |
| `npx vitest run` | 0 | 124 files / 1128 tests passed, 0 skipped |
| `npm run build` | 0 | main/preload/renderer bundles built |
| `.tmp/migration-probe.mjs` (esbuild bundle of independent migration probe) | 0 | 31 checks, 0 failures |
| `.tmp/audit-probe.mjs` (esbuild bundle of endpoint/resolver/service probe) | 0 | 77 assertions, 0 failures |
| `.tmp/redirect-probe.mjs` | 0 | Redirect rejected; redirect target fetch count 0 |
| `.tmp/secret-probe.mjs` (OS-store stub) | 0 | 40-char id set/get succeeds; 41-char id rejected |
| `node scripts/product-path-smoke.mjs` (local, temporary profile) | 1 | FAILED, `Application exited during launch (2147483651)`; temporary evidence deleted |
| Secret scan `git grep`/node over tracked blobs | 0 | `sk-` 12 false positives, `Bearer` tokens 0, test keys fake, evidence clean |
| `git status --porcelain` after probes | 0 | Clean before the two review docs were written |

Probe files were placed under `.tmp/` and deleted after use; the temporary product-path run's JSON/transcript were deleted and no historical evidence was modified.

## 10. Conclusion

The provider P1/P2 code fixes are substantially correct: health invalidation, shared endpoint resolution, official-profile locking, secret clearing/compensation, discovery consent/policy, 40-char id, and the required SSRF boundaries all reproduce. The v49 migration and bridge pass independent probes, including fail-closed identity checks and rollback.

However, the final acceptance is not closed:

- The product-path acceptance script has a real top-level-await bug and fails on both CI platforms.
- CI run `41834663403` is red (3/4 jobs fail), the PR is `UNSTABLE`, and the Windows package/install/startup path is not verified.
- No real OS SafeStorage/restart-continuity evidence exists.
- The final delivery docs are not in PR #54, and several docs claims (PARTIAL status, 5 skips, real-provider metadata, Windows real-app upgrade) are unsupported.

**Verdict: DO_NOT_MERGE.** Re-review is required after the product-path script is fixed, CI is green on the final HEAD, the Windows package smoke is diagnosed, and the docs/evidence are updated to the actual CI result.
