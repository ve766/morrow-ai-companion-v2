# Morrow V2 最终证据索引

- 分支：`feat/morrow-v2-final-closure`
- PR：#54 https://github.com/ve766/morrow-ai-companion-v2/pull/54
- 实现 SHA：`d07b3f4b951fab2bd522413c789850055a49fe61`
- 证据/脚本 SHA：`28665dfbcb724749ec56df0b8cfdb80578a3f84c`
- 目标 base：`release/morrow-v2-final-delivery` @ `3812b18`

## 1. 固定交付文件

| 文件 | 内容 |
| --- | --- |
| [`docs/audit/morrow-v2-final-closure-baseline.md`](../audit/morrow-v2-final-closure-baseline.md) | 开工基线、冲突、迁移方案、外部依赖 |
| [`docs/architecture/morrow-v2-final-integrated-architecture.md`](../architecture/morrow-v2-final-integrated-architecture.md) | 集成架构、Provider 身份、consent/secret、Stage 4 保留能力 |
| [`docs/architecture/morrow-v2-final-migration-and-recovery.md`](../architecture/morrow-v2-final-migration-and-recovery.md) | v49 序列、三类数据库路径、事务/恢复、测试 |
| [`docs/testing/morrow-v2-final-acceptance-matrix.md`](../testing/morrow-v2-final-acceptance-matrix.md) | 逐项验收状态与证据 |
| [`docs/reports/morrow-v2-final-delivery-report.md`](morrow-v2-final-delivery-report.md) | 交付范围、验证、阻塞、回滚、最终状态 |
| [`docs/reports/morrow-v2-final-evidence-index.md`](morrow-v2-final-evidence-index.md) | 本索引 |
| [`docs/reports/morrow-v2-final-work-log.md`](morrow-v2-final-work-log.md) | 工作日志与命令 |
| [`docs/audit/morrow-v2-final-independent-review.md`](../audit/morrow-v2-final-independent-review.md) | 独立复审结论 |
| [`docs/audit/morrow-v2-final-file-review-matrix.md`](../audit/morrow-v2-final-file-review-matrix.md) | 逐文件复审矩阵 |
| [`evals/morrow-v2-final/results/`](../../evals/morrow-v2-final/results/) | 产品路径机器结果（CI artifact 回填） |
| [`evals/morrow-v2-final/transcripts/`](../../evals/morrow-v2-final/transcripts/) | 产品路径可读记录 |

## 2. 迁移证据

| 证据 | 位置 |
| --- | --- |
| v48/v49 定义与桥接 | `src/persistence/migrations.ts` |
| v49 六组测试 | `src/persistence/migrations.test.ts` → `v49 provider multi-source profiles final` |
| 外来身份/结构不符 | `src/persistence/migrations.test.ts`、`src/app/provider-multi-source.integration.test.ts` |
| 生产打开路径 | `SqliteDatabase.open` + `SchemaIdentityError` |

## 3. Provider 证据

| 证据 | 位置 |
| --- | --- |
| 配置语义失效 | `src/app/provider-multi-source.integration.test.ts` → `provider profile change semantics` |
| 连接 URL 表驱动 | 同上 → `sends the connection test to the exact chat URL…` |
| 官方 profile 三层拒绝 | service 测试、`provider-multi-source-ipc.integration.test.ts`、`tests/provider-profiles-ui.test.ts` |
| secret 事务补偿 | 同上 → `restores the previous secret…` |
| discovery 授权/0 fetch/大小上限 | 同上 → `model discovery hardening` |
| endpoint 安全边界 | `src/providers/endpoint-security.test.ts` |
| resolver 语义 | `src/providers/endpoint-resolver.test.ts` |
| UI 旧密钥提示 | `tests/provider-profiles-ui.test.ts` → `prompts for a new key…` |

## 4. 真实运行

| 运行 | 文件 | 状态 |
| --- | --- | --- |
| api.supxh.xin | `evals/provider-multi-source/results/20261104T135205Z-75b01260.json` + transcript | **BLOCKED_QUOTA** |
| speed26.toter.me | `evals/provider-multi-source/results/20261104T135210Z-abf69f16.json` + transcript | **BLOCKED_QUOTA** |
| 本地服务 | 两份结果中的 `local` 字段 | **BLOCKED_LOCAL_SERVICE_NOT_RUNNING** |

两份 JSON 均记录 commit、branch、workingTree、endpoint digest、model、错误分类；不含 key/Authorization/正文。

## 5. 产品路径与 CI

- 脚本：`scripts/product-path-smoke.mjs`
- npm：`npm run smoke:product-path`
- CI workflow：`.github/workflows/ci.yml`
  - Ubuntu：`Electron smoke`（Linux CI 无 OS keyring，product-path 仅在 Windows 执行）
  - Windows：`Electron smoke` + `Electron product-path acceptance`
  - Windows：`Windows package, install and installed-app smoke`
  - Windows：`Windows upgrade path (schema migrations under the real app)`
- CI run：https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41859315790（全部 job PASS）
- PASS 证据：`evals/morrow-v2-final/results/20261104T154241Z-1430f856.json` + transcript；Electron 44.9.3，18 项检查，sandbox 启用。
- 本机失败证据：`evals/morrow-v2-final/results/20261104T124142Z-933adad0.json`（FAILED，宿主 Electron 0xC0000005）；不冒充 PASS。
- CI artifact：`morrow-product-path-windows-latest`，包含 JSON + transcript。

## 6. 命令与退出码

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 |
| `npx vitest run` | 0；124 文件 / 1129 测试 |
| `npm run evaluate` | 0 |
| `npm run evaluate:cognition` | 0 |
| `npm run build` | 0 |
| `npm run eval:provider-multi-source`（supuxh） | 0（脚本正常退出；结果 BLOCKED_QUOTA） |
| `npm run eval:provider-multi-source`（speed26） | 0（结果 BLOCKED_QUOTA） |
| `node scripts/product-path-smoke.mjs`（本机） | 1（宿主 Electron 崩溃；已保留 FAILED 证据） |
| `npm run smoke:product-path`（CI Windows） | 0；run `20261104T154241Z-1430f856` PASS |
| CI run 41859315790 | 4/4 job PASS |

## 7. 一致性

- 报告、矩阵、基线中的最终代码 SHA 为 `d07b3f4b951fab2bd522413c789850055a49fe61`；Provider P1/P2 核心修复为 `d9b28ae`；证据脚本起点为 `28665df`。
- PR head 会随文档/复审提交前进；PR 描述与最终评论给出当时 head SHA。
- 历史 PR #40/#51/#52 的 SHA 与报告未被改写。
