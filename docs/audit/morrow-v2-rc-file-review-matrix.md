# Morrow V2 Windows RC File Review Matrix — Delta Re-review (Issue #55, PR #54, code `fad6a94`, HEAD `e0fbbcf`)

Independent reviewer: separate context; did not write this implementation. Only this file and `docs/audit/morrow-v2-rc-independent-review.md` were updated. No product code, test, migration, CI, existing doc, evidence, or RC binary was modified. The worktree was clean before the review; after the review the only changes are the two updated review documents.

## 0. Scope and method

- Frozen RC HEAD: `e0fbbcff0a9fbfebd6dd50a293d877060de74d75`.
- RC code/test SHA: `fad6a94eef19ce5cfbdca9f4c0e1af0aca08074c`.
- Previous reviewed HEAD: `29d464545d081836c4aa36e76e2b9f950b020f2f` (code `ac00627`).
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`.
- Delta commits:
  - `fad6a94` (7 files): source fixes for smoke, copy, 1280 composer, provider metadata, per-row allowlist, design-system, and the prior audit docs.
  - `e0fbbcf` (19 files): RC docs/result/transcript/screenshots and the rebuilt portable binary.
- Evidence: full `npx vitest run` (129 files / 1156 tests / 0 skipped, exit 0, 174.83s); targeted 4 files / 31 tests (exit 0); `npx tsc --noEmit` (0); `npm run build` (0); `npm run evaluate` / `evaluate:cognition` (0 with `TEMP`/`TMP` set to `<repo>/.tmp/es`); binary hash/size/PE/payload/asar probes; CI API queries for run `42023327920`.

## 1. `fad6a94` source-fix delta (7 files)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 1 | `scripts/smoke.mjs` | `dataPolicy` assertion updated to `local-first-consented-provider-egress-memory-goals-reminders` | **PASS** — matches `src/app/index.ts:77` exactly; the prior blocking CI smoke defect is closed in source. |
| 2 | `src/renderer/index.html` | Local-provider copy now “没有显式默认 Provider 时…”; cognitive copy now “每次模型服务发送…” | **PASS in source** — both residual DeepSeek/local-priority claims fixed; the shipped binary does not contain them. |
| 3 | `src/renderer/src/style.css` | Adds `@media (max-width: 1320px)` chat height/presence padding; `.pending-item-meta { overflow-wrap: anywhere; }` | **PASS in source** — 1280 rule and provider-metadata wrapping present; visual outcome unverified; shipped binary lacks both. |
| 4 | `docs/ui/design-system.md` | Light `--muted` corrected to `#66676d`; contrast wording fixed to “纸面对 `#f3f0e8` 约 4.95:1” | **PASS** — token matches the code; 4.95 is correct for `#f3f0e8` (4.649 for `#ede9df`, still ≥4.5). |
| 5 | `scripts/product-path-smoke.mjs` | `allowedAdditions[table]` now `added.map((key) => ({ key, reason }))` | **PASS structurally; P3** — per-row shape is correct, but the reason is still the table-level constant and the script is not executed on the RC SHA. |
| 6 | `docs/audit/morrow-v2-rc-independent-review.md` | Prior `29d4645` review | Superseded by this delta review; now documents `fad6a94`/`e0fbbcf`. |
| 7 | `docs/audit/morrow-v2-rc-file-review-matrix.md` | Prior `29d4645` matrix | Superseded by this delta matrix; now documents `fad6a94`/`e0fbbcf`. |

## 2. `e0fbbcf` docs/evidence/binary delta (19 files)

| # | File | Change | One-line conclusion |
| --- | --- | --- | --- |
| 8 | `docs/install/windows-installation-guide.md` | New size/hash | **PASS** — 100,541,544 bytes / `fd584ffd…b1da`; NSIS/launch limits remain honest. |
| 9 | `docs/reports/morrow-v2-rc-delivery-report.md` | New SHA/hash/size | **PASS with P3** — PARTIAL and blockers honest; CI cause still generic, no run `42023327920`; the “Portable RC 已构建” claim implies a rebuild that the payload does not support. |
| 10 | `docs/reports/morrow-v2-rc-evidence-index.md` | New SHA/hash/size, billing annotation, new run paths | **PASS with P3** — billing annotation and user action now recorded; build time still `19:05:00Z` (old) and the CI table lacks run `42023327920`. |
| 11 | `docs/reports/morrow-v2-rc-work-log.md` | New SHA/size/run paths | **PASS with P3** — build/test log updated; CI cause still generic, no billing annotation. |
| 12 | `docs/testing/morrow-v2-rc-acceptance-matrix.md` | New code SHA and size | **FAIL (P2)** — row 6 still lists the old SHA256 `cf662590…8e67` while the size is the new 100,541,544; a verifier gets a mismatch. |
| 13 | `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/chat-1440x900.png` | New evidence file | **P3** — byte-identical copy of the parent-code `6f5fe47` screenshot; not new RC-SHA evidence. |
| 14 | `.../chat-1280x800.png` | New evidence file | **P3** — parent-code copy; cannot verify the new 1320px rule. |
| 15 | `.../chat-390x844.png` | New evidence file | **P3** — parent-code copy. |
| 16 | `.../memory-1440x900.png` | New evidence file | **P3** — parent-code copy. |
| 17 | `.../memory-1280x800.png` | New evidence file | **P3** — parent-code copy. |
| 18 | `.../memory-390x844.png` | New evidence file | **P3** — parent-code copy; still shows the pre-fix nav cut. |
| 19 | `.../settings-1440x900.png` | New evidence file | **P3** — parent-code copy. |
| 20 | `.../settings-1280x800.png` | New evidence file | **P3** — parent-code copy. |
| 21 | `.../settings-390x844.png` | New evidence file | **P3** — parent-code copy; still shows the pre-fix nav cut. |
| 22 | `.../manifest.md` | New screenshot manifest | **PASS** — explicitly says parent code `6f5fe47`, not installed-app; the directory name still implies the new RC. |
| 23 | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` | New binary | **FAIL (P1)** — hash/size match the claim (`fd584ffd…b1da`, 100,541,544) and it is a real PE32 NSIS+7z, but its embedded payload/asar are byte-identical to the old `ac00627` build; the `fad6a94` renderer fixes are not shipped. |
| 24 | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe.sha256` | New checksum | **PASS** — matches the new hash, but the file it describes is the stale payload (see #23). |
| 25 | `evals/morrow-v2-rc/results/20261105T195500Z-rc-fad6a94.json` | New machine result | **PASS with P3** — codeSha/hash/size correct; PASS claims for tsc/tests/build/evals are reproducible; the “Windows portable RC PASS” is only hash/size, not content. |
| 26 | `evals/morrow-v2-rc/transcripts/20261105T195500Z-rc-fad6a94.md` | New transcript | **PASS with P3** — status and hash correct; BLOCKED section still says “CI on `ac00627`” instead of `fad6a94`/`e0fbbcf`. |

## 3. Carried-forward RC code delta `ac00627`/`df8f802` (19 files)

These files are unchanged since the prior review; the prior conclusions still hold.

| # | File | One-line conclusion |
| --- | --- | --- |
| 27 | `evals/provider-multi-source/run.ts` | dataPolicy fixture updated; harness-only; PASS. |
| 28 | `src/app/backup-ipc.test.ts` | dataPolicy fixture updated; PASS. |
| 29 | `src/app/companion-service.ts` | discovery limit exactly 1,048,576; PASS. |
| 30 | `src/app/index.ts` | dataPolicy + consent Bearer copy corrected; PASS. |
| 31 | `src/app/ipc.test.ts` | dataPolicy fixture updated; PASS. |
| 32 | `src/app/provider-multi-source-ipc.integration.test.ts` | dataPolicy fixture updated; PASS. |
| 33 | `src/app/provider-multi-source.integration.test.ts` | oversized header 1,048,577; PASS. |
| 34 | `src/app/stage4-goal-candidate-e2e.test.ts` | dataPolicy fixture updated; PASS. |
| 35 | `src/providers/openai-compatible.test.ts` | non-stream oversized + valid; PASS with P3 (missing exact/UTF-8/empty/parse-failure). |
| 36 | `src/providers/openai-compatible.ts` | bounded non-stream 1 MiB; PASS with P3 redundant catch. |
| 37 | `src/renderer/src/companion-ui.ts` | 3 “模型服务请求” copy fixes; PASS. |
| 38 | `src/renderer/src/presence-ui.ts` | reduced-motion static draw; PASS. |
| 39 | `src/renderer/src/provider-profiles-ui.ts` | providerUiReady after load, builtin delete disabled, disarm on edit/card; save not; PASS with P3. |
| 40 | `src/shared/contracts.ts` | dataPolicy union updated; PASS. |
| 41 | `tests/design-tokens.test.ts` | WCAG test for bg/panel both themes; PASS (bg-soft untested but 4.649). |
| 42 | `tests/provider-profiles-ui.test.ts` | builtin local delete disabled test; PASS. |
| 43 | `src/renderer/index.html` (carried) | prior B2 fixes; now also fixed in `fad6a94`; source PASS, binary stale. |
| 44 | `src/renderer/src/style.css` (carried) | prior B1 fixes; now also fixed in `fad6a94`; source PASS, binary stale. |
| 45 | `scripts/product-path-smoke.mjs` (carried) | prior B3 fixes; now per-row; source PASS, unexecuted. |

The prior omission regression (`scripts/smoke.mjs` old dataPolicy) is **CLOSED** by `fad6a94`; it is now a PASS row in section 1.

## 4. Summary

| Category | Files | Verdict |
| --- | --- | --- |
| `fad6a94` source fixes | 7 | 6 PASS / 1 PASS structurally (P3); no new code P1/P2 |
| `e0fbbcf` docs/evidence/binary | 19 | binary **FAIL (P1)**; acceptance matrix hash **FAIL (P2)**; docs P3 |
| Carried-forward RC code delta | 19 | unchanged; PASS with P3 residuals |
| Overall code review | — | **PASS_WITH_NON_BLOCKING_BACKLOG** |
| Overall RC | — | **PARTIAL** (artifact FAIL + NSIS/install/CI/external blockers) |

The delta source fixes are correct and fully tested. The blocking issue is the artifact: the new portable reuses the old `ac00627` app payload byte-for-byte, so the B1/B2 renderer fixes are not in the delivered binary. Rebuild with `npm run build` followed by electron-builder from a clean `out/`/`win-unpacked`, re-hash, then correct `docs/testing/morrow-v2-rc-acceptance-matrix.md:14` and the stale build-time/CI-run references.
