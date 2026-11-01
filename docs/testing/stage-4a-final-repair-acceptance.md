# Stage 4-A 最终修复验收

- 分支 `feat/stage-4a-companion-continuity` · PR [#24](https://github.com/ve766/morrow-ai-companion-v2/pull/24)
- 真实模型结果：`evals/stage-4a/results/20261101T143828Z-75bb1a3-final-repair.json`（代码 SHA `75bb1a3`）
- 证据来源标注：**[源码]** 源码检查、**[自动]** 生产链自动测试/评测、**[真实]** 真实 provider、**[人工]** 由用户判定

## 1. 任务 §4 的五会话（真实 provider，[真实]）

| 用例 | 要求 | 结果 |
|---|---|---|
| A 保存 | provider 收到请求前，持久层已有来源=本轮 message 的 active pet_name=咪咪 | **PASS**：操作块 `operation=create status=committed_and_verified current_value=咪咪`（回复之前生成）；记忆文本「我的猫叫咪咪。」 |
| B 跨会话 | 证据注入咪咪 | **PASS**：[自动] 证据块含「我的猫叫咪咪。」；[真实] 回复「记得，你的猫叫咪咪。」 |
| C 纠正 | provider 收到请求前已原子提交 咪咪=superseded、豆豆=active；上下文含纠正结果；回复体现旧值→新值 | **PASS**：操作块 `operation=correct ... previous_value=咪咪 current_value=豆豆 memory_revision=2`；回复「已经更新好了：之前是咪咪，现在是豆豆」 |
| D 当前值 | 只把 active 作为当前值 | **PASS**：证据「我的猫叫豆豆。」且不含咪咪；回复「你的猫叫豆豆。」 |
| E 历史值 | 能说明旧值且明确是历史 | **PASS**：「根据更早的记录，它之前叫咪咪。目前保存的信息是它叫豆豆」 |

## 2. 附加用例（[自动] + [真实]）

| 用例 | 结果 |
|---|---|
| 两宠物下的代词歧义 → clarify，不写入 | **PASS**：操作块 `status=clarify`；ledger 保持 [咪咪, 小黑]；回复询问指哪一只并声明未改动 |
| 显式保存产生唯一当前事实 | **PASS**：residence [杭州] |
| 重复同一句话不产生第二条事实 | **PASS**：仍为 1 条 active（planner `already_current` → not_applied） |
| 事务/验证失败不声称成功 | **[自动]** `executeOperation` 验证失败 → `status=failed` + `memory.operation.failed(stage=verification)` 事件；验收测试覆盖 |
| 索引故障不伪装零命中 | **[自动]** 降级扫描（`stage4a-continuity.integration.test.ts` #9） |
| 撤回/删除后不得重新进入 prompt | **[自动]** #6 |
| 重启后 active/superseded 区分 | **[自动]** #4/#5 |
| 人格基线在重启与 Provider 切换前后不变 | **[自动]** #7 |
| 来源链 message→revision→fact | **[自动]** #1 |

## 3. 十二项生产链验收（[自动]，`stage4a-continuity.integration.test.ts`）

1 来源链 · 2 跨会话 · 3 原子纠正 · 4 重启 · 5 历史 vs 当前 · 6 撤回 · 7 Provider 切换下基线不变 · 8 重复纠正单当前值 · 9 降级扫描 · 10 预算遗漏 · 11 SQLite 侧持久化 · 12 无事实候选时文本回退 —— **12/12 PASS**

## 4. 评测口径（§5）

- 纠正理解不再用单一 `includes("豆豆")`：分别判定 **识别新值**、**未否认已有旧记录**、**表达旧→新关系**（本机实测：三项均 PASS，回复为「之前是咪咪，现在是豆豆」）；
- 数据库事实状态、请求证据注入、模型语义理解三项分列（`separationNote` 字段）；
- 人工体验评分 **PENDING**：`evals/stage-4a/review/transcript-final-repair.md`，AI 不代签。

## 5. 命令与结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run --no-file-parallelism` | 0 | 全量测试（含 12 项 4-A 验收）全部通过 |
| `npx electron-vite build` | 0 | 构建成功 |
| `npm run eval:stage4a` | 0 | scripted 断言全部通过 |
| `npm run eval:stage4a:live` | 0 | 11/11 自动检查通过，`AWAITING_MANUAL_REVIEW` |

## 6. 阻塞（外部条件，如实）

- **Electron 应用级重启/渲染冒烟：BLOCKED**（本机渲染进程 0x80000003 环境问题，历史同签名）；装配级重启已通过（验收 #4）。CI 双平台为准。
- **第二真实 Provider：BLOCKED**（无第二凭据）；应用侧身份与事实持久化已验证（#7/#11）。
- **人工体验评分：PENDING**（须用户亲自判定）。
