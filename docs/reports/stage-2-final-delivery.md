# Stage 2 交付报告

> **历史快照（2026-10-30 标记）**：本文件记录的是当时（HEAD `e7efb4c`）的判断，不再是当前口径。
> 当前状态请看 [`docs/reports/stage-2-final-delivery-current.md`](stage-2-final-delivery-current.md)
> 与 [`docs/audit/stage-2-final-delivery-audit.md`](stage-2-final-delivery-audit.md)。原文保留不改写。

---

> **更正（2026-10-30，PR #15 HEAD `2c90163`）**：本文件写下时把两件事记为"不可用"，后续实测推翻了它们，
> 请以 `docs/reports/stage-2-next-delivery.md` 为准：
>
> 1. **桌面/Electron 不是不可用**。`npm run smoke` 在**默认沙箱**（未设 `MORROW_SMOKE_DISABLE_SANDBOX`）下
>    连跑两次 exit 0，覆盖 built app、凭据加密保存/重启/删除、认知开关、记忆/目标/提醒、删除与重启校验。
>    当初的"最小复现"只测了 `--no-sandbox` 崩溃路径，就推断整个渲染沙箱不可用——那个推断是错的。
> 2. **真实 Provider 不是缺凭据**。`scripts/phase24-real-model.ts` 用 `spark-x2.6` 实测：
>    S1–S6 中 5 个可运行场景 PASS，客观断言 13/13，errors 0（S4 因只有单一模型 SKIPPED）。
>
> 仍然成立的部分：CI 三个 job 因**账号计费**拿不到 runner（`runner_id=0`/`steps=0`），
> 以及 Windows 安装器升级路径未验证。原文保留不改，作为当时的判断记录。

---

写作时间：2026-10-29 16:38 (+08:00)
分支：`feat/stage-2-delivery-hardening`（PR #15 head）
本报告写作时 HEAD：`e7efb4c` + 本次提交（见 PR #15 最新 HEAD）

---

## A. 最终状态

**PARTIAL / BLOCKED**。

- **PARTIAL**：A1/A2/A3 三项高危缺陷已修复并有回归测试；B1–B5 与 D/E 未完成。
- **BLOCKED**：真实 Provider 凭据缺失、Electron 渲染沙箱无法启动、CI 三个 job 未分配 runner。

不满足 §12 的 `STAGE_2_DELIVERED`：真实模型 S1–S6 与桌面关键路径均无执行证据。

## B. 代码交付

| 项 | 值 |
|---|---|
| 分支 | `feat/stage-2-delivery-hardening` |
| 基线（认知基础） | `d858cd91a24afa4fc27086bdc84bb54c14eaa3c5` |
| 审计提交 | `b6ea4a6` |
| A1（隐私） | `d3c2865` |
| A2 + A3（删除边界、schema 读适配器） | `e7efb4c` |
| 本批（A3 夹具修正 + 交付文档） | 见 PR #15 最新 HEAD |
| `main` | `8b207b7`，未改动、未合并、未发布 |

变更文件（本批）：

- `src/self-model/self-fact-statement.ts`（新增）+ `.test.ts`（新增）
- `src/persistence/derived-deletion-boundary.test.ts`（新增）
- `src/persistence/migrations.ts`（迁移 20、21）
- `src/cognition/turn-context.ts`（读适配器）、`turn-context.test.ts`（历史 payload 夹具）
- `src/persistence/cognitive-context-repository.ts`（读路径走适配器）
- `src/app/companion-service.ts`（自我事实派生接线）

## C. 能力交付

| 能力 | 实际调用位置 | 持久化位置 | 真实行为证据 |
|---|---|---|---|
| 意图判断 | `ChatService.prepare` → `decideIntent` | 随用户消息 `cognitiveObservations` | 单元 + 集成测试；**无真实模型证据** |
| 记忆检索与装配 | `prepare` → `retrieval-policy` / `memory-context-assembler` | 轮次上下文 `retrieval.selected` | 集成测试断言序列化载荷 |
| 自我模型事实派生 | `onTurnCompleted` | `self_model_entries` | 本次新增测试（结构化、不复制原文） |
| 内在状态 | `send` 成功/重放路径 | `cognitive_feeling_state` | 单元 + 幂等测试 |
| 兴趣 / 反思 | `onTurnCompleted` | `interests` / `reflection_runs` | 接线测试；**端到端证据缺** |
| 轮次上下文 | `recordTurnContext` | `cognitive_turn_contexts` | 读写 + v1 兼容测试 |

## D. 缺陷处理

| 缺陷 | 根因 | 修复 | 回归 |
|---|---|---|---|
| 自我模型复制原文 | `statement: content.slice(0,2000)` | 结构化派生 `谓词：值`，不可派生则不写并记降级；迁移 20 只撤回顾副本 | 4 tests |
| 收尾意图孤儿 | `cognitive_turn_finalizations` 无外键，迁移 19 只删会话维度 | 迁移 21：消息删除时清理两侧 id | 先失败后通过 |
| 旧 schema 仅有假读取 | 断言只测 validator | 读适配器 + 直接 INSERT 的历史 payload 夹具 | 11 tests |

## E. 测试证据（本地实跑）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | — |
| `npx vitest run src/self-model/self-fact-statement.test.ts` | 0 | 4 passed |
| `npx vitest run src/persistence/derived-deletion-boundary.test.ts` | 0 | 4 passed |
| `npx vitest run src/cognition/turn-context.test.ts` | 0 | 11 passed |
| `npx vitest run --maxWorkers=2` | 0 | **580 passed / 65 files** |
| `npm run build` | 0 | renderer 79.73 kB |

**CI：BLOCKED。** run `40840918994`（attempt 2）三个 job 均 `conclusion=failure`、`runner_id=0`、`steps=[]`。
rerun 后签名不变，说明 runner 从未分配，无步骤日志可取；不据此判断代码通过或失败。

**真实模型：BLOCKED。** `MORROW_SPARK_API_KEY` / `SPARK_API_KEY` / `DEEPSEEK_API_KEY` / `MORROW_DEEPSEEK_API_KEY` 全 absent；
`https://maas-api.cn-huabei-1.xf-yun.com/v1/models` 返回 401（可达，缺凭据）。

**桌面：BLOCKED。** 六行最小 Electron 应用加载 `data:` URL 即 `render-process-gone 0x80000003`；
加 `--no-sandbox` 后 Morrow 主进程 `0xC0000005`。

## F. 安全与数据

- 迁移 20 只对"statement 等于来源消息原文"的行生效；非副本行不动；`source_message_id` 保留；原文仍在 `messages`，可恢复。
  **注意语义区分**：这是"撤回派生副本"，不是"删除源消息"。
- 迁移 21 消除收尾意图孤儿。
- 读适配器不回写历史 JSON（测试断言库内仍是 `schemaVersion: 1`）。
- 未新增外部能力、未扩展 IPC 权限、未改动同意门禁与载荷哈希校验。

## G. 未完成项

| 项 | 阻塞/原因 | 是否阻止交付 |
|---|---|---|
| B1 多信号意图置信度 | 未实现 | 是 |
| B2 渐进式个性化 | 未实现 | 是 |
| B3 `U(c)` | 未实现 | 是 |
| B4 轮次状态机 | 未实现 | 是 |
| B5 端到端连续性证据 | 部分接线，缺"写入→下一轮→载荷"证据 | 是 |
| D A–L 与消融 | harness 未实现，见 `evals/stage-2/` | 是 |
| E.8 真实模型 | 无凭据 | 是 |
| E.6/E.9 桌面与安装 | 本机渲染沙箱崩 | 是 |
| CI | runner 未分配 | 是 |

## H. 回滚与交付操作

```bash
git fetch ssh
git checkout e7efb4c        # 或 PR #15 最新 HEAD
npm ci
npx tsc --noEmit && npx vitest run && npm run build
```

数据回滚：迁移 20/21 只做 UPDATE/DELETE + 建触发器，未改表结构。
恢复历史副本可用 `VACUUM INTO` 备份文件；迁移 20 影响的 statement 原文仍可从 `messages` 重建，`source_message_id` 保留了映射。

## I. 最终建议

**不建议合并。** 理由不是"测试没过"（本地 580 项通过），而是：

1. 阶段二的核心算法 B1–B4 尚未实现，产品行为没有变化；
2. A–L 评测与消融不存在，无法证明模块贡献；
3. 真实模型与桌面两条必经验收均为 BLOCKED。

可以合并的时机：B1–B4 落地、harness 可复算、凭据与桌面至少各取得一次真实证据。
