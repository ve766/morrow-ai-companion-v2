# Stage 4-A 最终修复交付

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/stage-4a-companion-continuity` · PR [#24](https://github.com/ve766/morrow-ai-companion-v2/pull/24)（base `feat/stage-3-long-term-companion`，**不自动合并**）
- 起始 SHA：`29c2c9c001e6500f0af7894560d0dec0123d1d9a`
- 最终 SHA：本次提交（含后续结果/文档提交；代码 SHA 见 live 结果文件的 `codeCommit`）

## 1. 根因与修复（R1–R4）

| 根因 | 处置 | 证据 |
|---|---|---|
| R1 明确写入在回复之后 | 新增**回复前** Planner+Executor：`prepare()` 内提交并验证，操作块进入本轮 prompt；回复后的显式创建移除 | `memory-operation-planner.ts`、`MemoryService.executeOperation`、源码 + `stage4a` live 的操作块 |
| R2 代词/纠正识别不足 | 规划器解析 predicate/旧值/新值/来源/纠正关系；代词仅在唯一 active pet 事实时解析，多候选→clarify | 规划器 + live X1（clarify，不写入） |
| R3 Prompt 契约与时序矛盾 | 固定原则改写：只有 `committed_and_verified` 操作块授权“已记住/已更新”；superseded 仅历史 | 源码 + live C（回复体现旧→新） |
| R4 失败路径不透明 | 操作失败写 `memory.operation.failed`（stage + errorCode，无原文/密钥）；操作块显式 failed；验证失败不声称成功 | 源码 + 故障注入测试 |

## 2. 命令与结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run --no-file-parallelism` | 0 | **101 文件 / 936 测试全部通过** |
| `npx electron-vite build` | 0 | 构建成功 |
| `npm run eval:stage4a` | 0 | scripted 断言全部通过 |
| `npm run eval:stage4a:live` | 0 | **11/11 自动检查通过**，`AWAITING_MANUAL_REVIEW` |

## 3. 真实模型（spark-x2.6，契约 endpoint）

- 结果文件：`evals/stage-4a/results/<ts>-<sha>-final-repair.json`（绑定生成时的完整代码 SHA）
- 转写与人工判定栏：`evals/stage-4a/review/transcript-final-repair.md`
- 五会话（本机实测原文摘要）：
  - A →「已记住：你的猫叫咪咪。」
  - B →「记得，你的猫叫咪咪。」
  - C →「好的，已经更新好了：之前是咪咪，现在是豆豆。我会用豆豆来称呼它。」
  - D →「你的猫叫豆豆。」
  - E →「根据更早的记录，它之前叫咪咪。目前保存的信息是它叫豆豆。」
- 歧义用例：两只猫时「它现在叫豆豆」→ 询问指哪一只，声明未改动记录（clarify，未写入）
- **人工体验评分：PENDING**（用户亲自判定；AI 不代签）

## 4. PASS / FAIL / BLOCKED / NOT_RUN

| 项 | 状态 |
|---|---|
| 回复前提交与验证（create/correct） | **PASS**（自动化 + 真实） |
| 跨会话 recall、当前值 vs 历史值 | **PASS**（真实） |
| 修正回复表达旧→新、不否认旧记录 | **PASS**（真实，三信号分列） |
| 多候选代词 clarify 不写入 | **PASS**（真实 + 自动化） |
| 重复句子不产生第二条事实 | **PASS**（自动化） |
| 事务/验证失败不声称成功 | **PASS**（自动化，故障注入） |
| 索引降级不伪装零命中 | **PASS**（自动化） |
| 撤回/删除不重新注入 | **PASS**（自动化） |
| 重启后 active/superseded 区分 | **PASS**（自动化） |
| 人格基线在重启/Provider 切换不变 | **PASS**（自动化） |
| Electron 应用级重启/渲染冒烟 | **BLOCKED**（本机渲染进程 0x80000003，环境） |
| 第二真实 Provider 行为 | **BLOCKED**（无第二凭据） |
| 人工体验评分 | **PENDING** |
| Actions runner 状态 | **NOT_RUN（本机无法触发/等待）**，push 后以仓库 Actions 页为准 |

## 5. 已知剩余问题（带入下一阶段）

- 历史回答依赖 superseded 行的 history-only 行；若同一记忆被多次纠正，仅展示最近 10 条 superseded；
- 代词解析仅覆盖 `它(现在)?叫X` 形态；更复杂的省略句仍会 clarify；
- 「我还有一只猫」识别依赖 `还有/另一只/另外/也有一只` 词表；
- Provider 上游推理模型常超 45s 截止，live runner 采用有界重试（5 次），失败以 `PROVIDER_DEADLINE` 分类记录，非静默吞掉；
- 应用级 Electron 冒烟仍受本机环境限制（CI 为准）。

## 6. 结论

核心闭环（记住 → 跨会话复述 → 纠正（回复前提交）→ 当前值 → 历史值 → 歧义澄清）在**真实装配与真实模型**上成立，自动检查 11/11 通过；人工体验评分 PENDING、应用级 Electron 冒烟与第二 Provider 行为 BLOCKED。**交付状态：PARTIAL**（代码侧完成；外部条件如实标注）。不宣称“完成 Morrow”或任何意识主张。
