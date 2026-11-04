# PR #40 审计发现修复工作日志（Issue #47）

## 1. 身份与环境

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 实现分支 | `fix/pr-40-audit-findings` |
| 实现基线 | `052bcaa9c0320ef5e726c7bf66df85a49055628d`（PR #40 head） |
| 代码提交 | `dd9f59b10c7c812c3af36684a32d15193bda7d50` |
| 执行者 | ZCode（magpie/workbuddy/deepseek-v4.1-flash） |
| OS | Windows 10.0.26200 x64 |
| Node / npm | v22.23.2 / 10.9.8 |
| 关键依赖 | vitest 5.0.5、electron 44.9.3、node:sqlite（Node 内置） |
| 工作方式 | 单 Agent 实现；独立复审由另行启动的独立上下文/Agent 完成，不参与实现 |

## 2. 时间线（UTC）

| 时间 | 事件 |
|---|---|
| 2026-11-04T04:37:48Z | Issue #47 创建 |
| 2026-11-04T04:44Z | 读取 Issue #47、审计证据、PR/Issue 状态；核实 PR #40 head 仍为 `052bcaa`，`fix/pr-40-audit-findings` 不存在 |
| 2026-11-04T04:45Z | 从 `052bcaa` 创建修复分支 |
| 04:45–05:07Z | 实现 P1-01、P2-02～05、P3-06～12；边写边跑定向测试 |
| 2026-11-04T05:07:43Z | 代码提交 `dd9f59b` |
| 05:07–05:09Z | 干净工作树运行 `eval:stage5`、`eval:stage4a`、`eval:stage3` |
| 05:10–05:20Z | 最终全量测试、定向测试、persistence、build；写六份交付物 |
| 待定 | 推送、实现 PR、CI、独立复审、合并到 PR #40 分支、PR #40 CI、PR #40 head 最终复核 |

## 3. 命令与结果

| 命令 | 退出码 | 结果 | 日志 |
|---|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 | 终端 |
| `npx vitest run` | 0 | 116 files / 1073 tests | `.tmp/audit/fix-final-full.log` |
| `npx vitest run`（Stage 4 11 文件） | 0 | 116/116 | 终端 |
| `npx vitest run src/persistence` | 0 | 8 files / 61 tests | 终端 |
| `npm run build` | 0 | electron-vite build 成功 | 终端 |
| `npm run eval:stage5` | 0 | 12/12 | `evals/stage-5/results/20261104T050753Z-dd9f59b.json` |
| `npm run eval:stage4a` | 0 | 7/7 | `evals/stage-4a/results/20261104T050814Z-dd9f59b.json` |
| `npm run eval:stage3` | 0 | 15+1NOT_RUN/16 | `evals/stage-3/results/20261104T050848Z-dd9f59b*.json` |
| `npm ci` | NOT_RUN | 未执行完整重装；安装树与 lockfile 一致 | 见 §5 |

## 4. 设计决策与取舍

1. **concern identity 不改 schema**：v48 已有 `dedupe_key`/`finding_id`，concern key 直接写入
   `reflection_findings.dedupe_key`；避免 v49 迁移和不可逆 backfill。
2. **历史重复 finding 采用“显式归档”而非合并**：新 finding 保留（审计可追溯），
   写 `reflection.finding_reobserved`，不插 route；`recoverUnrouted` 排除已归档项，
   避免重复处理。
3. **legacy route 按 digest 证明**：item 的 dedupe key 已含 statement digest；对同 kind
   可变 route 计算当前/legacy digest，精确匹配才收敛。无法证明时不猜测并写
   `routeStatus:null / unresolved`。
4. **cursor 不回退**：reflection.run 的 cursor 与 effect 粒度不变；用失败审计 +
   recovery 扫描保证可恢复，避免重复 effect。
5. **schema 降级**：主聊天继续；Stage 4 写入 fail-closed 为
   `SCHEMA_UPGRADE_REQUIRED`；pending 草稿跳过并记录 degradation，升级后 recovery。
6. **eval branch**：不改历史结果；生成器动态读取，测试覆盖 detached/missing/failed。

## 5. 限制与未执行

- `npm ci` 完整重装未执行（环境/时间）；`npm ci --dry-run` 在审计阶段通过，安装树与
  lockfile 的 403 个条目一致；CI 会执行 `npm ci`。
- Stage 5 live 未重跑（真实 provider 成本/时延）；旧 live 结果保留，未改写。
- 本机 Electron smoke 未跑；CI 双平台 smoke 覆盖。
- 独立复审由独立 Agent/上下文完成并另行提交，不由本实现者代写结论。
