# 最终产品证据索引

每条结论 → 代码 / 测试 / 结果 / CI / 安装包。代码提交：
`967f9f22…`（fencing）、`526be275…`（P1 修复）；文档/结果提交 = 本分支 head（见 PR）。

## 1. 代码与修复

| 修复 | 位置 |
|---|---|
| lease_generation fencing | `src/app/effect-ledger.ts`、`src/app/cognitive-outbox.ts`、`src/self-model/reflection-service.ts`、迁移 v47 |
| RRF 归一化 | `src/memory/memory-context-assembler.ts:59-78` |
| 纠正验证绑定 | `src/memory/memory-service.ts`（correct 分支） |
| provenance 清理 | `src/memory/memory-service.ts`（correct finally） |
| G2 读时衰减 | `src/personalization/interaction-profile.ts:69-88` |
| 反思 turn 追踪 | `src/app/companion-service.ts`（promptBlock(turn?.turnId)） |
| 探索直接请求 | `src/self-model/exploration-policy.ts` + `companion-service.ts` |
| Provider IPC 参数 | `src/preload/index.ts`、`src/app/ipc.ts` |
| 降级启动守卫 | `src/app/index.ts`（schema<46 跳过 reconcile） |

## 2. 测试

| 套件 | 结果 |
|---|---|
| `npx vitest run` | 107 文件 / 1014 通过 |
| `tests/correction-round.test.ts`（claim/fencing） | 通过（含接管后旧 owner 拒绝） |
| `src/app/stage5-final-audit-repair.multiprocess.test.ts` | 5/5 真实进程 |
| final-product 套件 | 20 项，0 FAIL（`evals/final-product/run.ts`） |

## 3. 结果文件

| 套件 | 文件 |
|---|---|
| final-product | `evals/final-product/results/20261102T140759Z-526be27589f3b2047f042a77f211281dbeb51ea8.json` |
| Stage 5 scripted（最终 head） | `evals/stage-5/results/20261102T064146Z-0b9071e.json`（代码同链；live 见下） |
| Stage 5 live（最终 head 复跑） | 见本目录追加的结果文件（推送后生成，绑定 head） |
| Stage 3 / Stage 4-A | `evals/stage-3/results/20261102T064209Z-0b9071e*`、`evals/stage-4a/results/20261102T064247Z-0b9071e.json` |
| 历史结果 | 全部保留未改写 |

## 4. CI

最终 PR（base=main）head 上的 Actions run：以 PR 页面为准；
三个 job = ubuntu typecheck/tests/build/smoke、windows 同、Windows 升级路径。

## 5. 安装包

| 项 | 值 |
|---|---|
| 文件 | `release/Morrow-Setup-2.0.0-x64.exe` |
| 大小 | 111,751,536 字节 |
| SHA-256 | `b753df7c31e79f04e024b50c4a0758922f4b8223d3210ec09f94d3830f0a8998` |
| 干净安装/升级 | PENDING_HUMAN（本机无人值守安装挂起） |

## 6. 真实 Provider

spark / spark-x2.6 / openai-chat-completions；Stage 5 live 12/12 客观、
`semanticReview=PENDING_HUMAN`；语境 probe 否定/转述/假设不触发安慰指令。

## 7. 交付文件直链（分支路径）

- docs/audit/final-product-audit.md
- docs/audit/final-product-pr-integration-map.md
- docs/audit/final-product-root-cause-audit.md（#34 路径，指向上文）
- docs/architecture/final-product-runtime-map.md
- docs/architecture/final-product-integration-map.md（#34 路径，指向上文）
- docs/algorithms/final-product-algorithm-index.md
- docs/algorithms/final-product-algorithm-contracts.md（#34 路径，指向上文）
- docs/testing/final-product-acceptance-matrix.md
- docs/testing/known-limitations.md
- evals/final-product/scenarios-v1.json
- evals/final-product/results/…json
- evals/final-product/transcripts/…md
- evals/final-product/review/human-review-packet.md
- evals/final-product/review/real-provider-transcript.md
- docs/reports/final-product-delivery-report.md
- docs/reports/final-product-evidence-index.md（本文件）
- docs/reports/final-product-release-notes.md
- docs/backlog/post-release-backlog.md

## 8. 未完成

真人自然度 PENDING_HUMAN；第二 Provider NOT_RUN；真机安装/升级 PENDING_HUMAN；
本机 Electron smoke BLOCKED（CI 已覆盖）；P2 项见 backlog。
