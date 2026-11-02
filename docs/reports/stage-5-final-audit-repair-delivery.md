# PR #30 最终定点修复交付报告（Issue #31）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`fix/stage-5-final-closeout`（在 PR #30 上继续提交）
- PR：[#30](https://github.com/ve766/morrow-ai-companion-v2/pull/30)，base `fix/stage-5-review-findings`，OPEN、未合并、无 auto-merge
- 起始 SHA：`5b5b29c902db770fc4b448a0831f86e220b5addc`
- 本轮代码 SHA：`0b9071e40dea5822ac770c3f66a4ce14e39d3b99`
- 文档提交：PR #30 head（本报告不伪造自身所在提交的 SHA）
- 前序 PR #24/#26/#28：保持 OPEN，base/head 未改；未改 main，未发布 Release

## 1. 结论

| 项 | 结果 |
|---|---|
| F1 来源 fail-closed | **FIXED / PASS** |
| F3 distress 语境与 E/C 独立性 | **FIXED / PASS** |
| F6 跨进程并发 | **FIXED / PASS**（4 个真实 OS 进程用例） |
| F5 真人自然度 | **PENDING_HUMAN**（v1 A–G 保留，v2 增补 H–J） |
| F5 第二真实 Provider | **NOT_RUN**（无合法凭据/endpoint） |
| 全量测试 | 107 文件 / **1012 测试通过**（基线 993 + 19） |
| 定向测试 | **48/48** |
| scripted 12 场景 | 12/12 |
| live 12 场景 | 12/12（spark-x2.6） |
| CI（本轮 head） | **success**，run `41403926328`，3 个 job |
| 本机 Electron smoke | BLOCKED（`0xC0000005`） |
| **代码收尾** | **PASS** |
| **整体交付** | **PARTIAL**（F5 外部项未完成） |

## 2. 修复前后

### F1 — 来源校验

修复前：`observe()` 接受调用方 `text`；空消息表跳过校验；查询异常被 catch 后继续；
不校验 conversationId。

修复后：

- `observe({ messageId, conversationId, at })`，在写事务内读取 `messages` 的 body 与
  conversation_id。
- 缺失 → `source_missing`；会话不匹配 → `source_conversation_mismatch`；查询失败 →
  `RelationshipSourceError`（outbox 重试）。三种情况都零写入。
- 投影器只传 id，不传缓存文本。
- 删除与投影并发由 `BEGIN IMMEDIATE` 串行化；删除后不会复活。

### F3 — 语境作用域

修复前：整句任意位置命中即 E；引用/转述/否定/假设未区分；程度词/标点被当作独立 C。

修复后：

- 分句 → 引用/否定/转述/假设语境判定 → 仅中性分句计 E。
- 否定作用域限定同一分句、情绪词之前。
- C 仅来自中性分句的独立躯体/行为线索；程度词/重复/标点不再二次计权。
- D=0.55E+0.25C+0.20T；`distress=E≥0.85 OR (D≥0.65 AND C≥0.40)`。
- 成对否定/引用/转述/假设用例全部通过；直接请求仍最高优先级。
- 额外 live probe：否定/转述/假设 3 句，策略块均未加入“先安慰”指令。

### F6 — 跨进程

- 真实 OS 进程（`spawn` 独立 Node）+ 独立 SQLite 连接；文件屏障协调。
- 两进程争抢：一个 claim，另一个 busy；证据 1、ledger applied 1。
- claim 后崩溃：T+61s 租约接管，恰好投影一次。
- 删除与投影并发：另一连接删除后，投影不写入；证据 0。
- 旧 obligation 重放：新值 active，旧值 superseded。
- 重复 drain：pending=0，证据仍 1。

## 3. 命令与结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | 107 文件 / 1012 测试通过 |
| 定向 4 文件 | 0 | 48/48 |
| `npm run eval:stage5` | 0 | 12/12 |
| `npm run eval:stage5:live` | 0 | 12/12 |
| `npm run eval:stage3` | 0 | 15 PASS + 1 NOT_RUN / 16 |
| `npm run eval:stage4a` | 0 | 7/7 |
| `npm run build` | 0 | 成功 |
| 本机 `npm run smoke` | 1 | BLOCKED（0xC0000005） |

环境：win32 / Node 22.23.2；esbuild 临时目录重定向到仓库 `.tmp/es`；跨进程测试运行
在真实子进程中，详见 `docs/architecture/stage-5-outbox-multiprocess-invariants.md`。

## 4. 真实 Provider

| 项 | 值 |
|---|---|
| Provider/协议 | `spark` / `openai-chat-completions` |
| Model | `spark-x2.6` |
| Stage 5 live | 2026-11-02T06:43:06Z 起；12/12 客观 PASS；代码 SHA `0b9071e` |
| 文件 | `evals/stage-5/results/20261102T064306Z-0b9071e-stage-5.json` |
| 语境 probe | 3 句合成文本；`acknowledgeInstruction=false`；见机器结果 `contextProbe` |
| 凭据 | `MORROW_TEST_API_KEY` 存在；值未写入任何持久化产物 |

## 5. 固定交付文件

| 文件 | 用途 |
|---|---|
| `docs/audit/stage-5-final-audit-repair.md` | F1/F3/F6 复审发现、根因、修复映射 |
| `docs/algorithms/stage-5-distress-context-scope.md` | 语境阶段、E/C/T 独立性、阈值、降级 |
| `docs/architecture/stage-5-outbox-multiprocess-invariants.md` | claim/lease/ack/删除/恢复、时序、不变量 |
| `docs/testing/stage-5-final-audit-repair-acceptance.md` | 每项 finding 的测试与命令证据 |
| `evals/stage-5/final-audit-repair/results/20261102T071434Z-0b9071e40dea5822ac770c3f66a4ce14e39d3b99.json` | 机器结果 |
| `evals/stage-5/final-audit-repair/review/human-review-packet.md` | 盲评包 v2（PENDING_HUMAN） |
| `docs/reports/stage-5-final-audit-repair-delivery.md` | 本报告 |
| `docs/reports/stage-5-final-audit-repair-evidence-index.md` | 单一证据索引 |
| `evals/stage-5/final-audit-repair/worker.ts` | 真实进程 worker 源码 |

PR #30 原有九份收尾文件与历史 machine results 保留，未覆盖。

## 6. 未完成 / BLOCKED / NOT_RUN

| 项 | 状态 | 说明 |
|---|---|---|
| 真人自然度 | PENDING_HUMAN | 需要独立真人按 v1/v2 盲评表评分；Agent 不代填 |
| 第二真实 Provider | NOT_RUN | 无合法第二 Provider 凭据/endpoint；同 Provider 重建不算切换 |
| 本机 Electron smoke | BLOCKED（环境） | `0xC0000005`；CI Windows/Ubuntu 真实 smoke 通过 |
| 跨机器一致性 | 不适用 | 单机本地 SQLite；已验证同库多进程 |
| 规则计划器覆盖 | 剩余风险 | 新模式外句式落到无操作/澄清，方向保守 |

## 7. 回滚

1. `git revert 0b9071e`（以及后续文档提交）。
2. 无新迁移；v46 结构不变。回滚只恢复旧 `observe` 行为（不推荐，来源 fail-open 会回来）。
3. 历史结果/PENDING 状态不删除、不覆盖；回滚后在报告中标明版本。

## 8. 最终状态

**代码收尾 PASS**：F1/F3/F6 的代码、针对性测试、真实进程验证和运行证据完成；
全量 1012 测试、scripted/live 12/12、CI 3 job 全绿。

**整体 PARTIAL**：真人自然度 PENDING_HUMAN、第二 Provider NOT_RUN。未把
PENDING/NOT_RUN 写成 PASS，未合并任何 PR，未宣称六大产品阶段完成。
