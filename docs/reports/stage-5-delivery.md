# Stage 5 交付报告

- 仓库 `ve766/morrow-ai-companion-v2` · 分支 `feat/stage-5-relational-presence`
- 父 PR [#24](https://github.com/ve766/morrow-ai-companion-v2/pull/24)（Stage 4-A，PARTIAL，保持 OPEN/未合并）
- 本阶段 PR：base `feat/stage-4a-companion-continuity`（stacked，依赖 #24）
- 起始 SHA `57d2ff3` · 最终 SHA 见本分支 HEAD
- 迁移：v43（`relationship_threads` + `relationship_thread_evidence`）

## 1. 交付 A：关系连续性（进入真实主链）

| 要素 | 实现 |
|---|---|
| 数据结构 | v43 两张表；只存最小结构化值 + 来源 message；证据按消息去重 |
| 抽取 | 仅显式陈述：称呼偏好 / 约定话题 / 承诺 / 互动节奏；模糊暗示不写入 |
| 聚合公式 | `score = clip(Σ_g w_g·s_g·exp(−ln2·age/halfLife), 0, 1)`；halfLife 180/90 天；active 需 score≥0.5 且独立消息 ≥ MIN_GROUPS（约定话题需 2 条） |
| 更新/遗忘 | 纠正→superseded；口头撤回→retracted 立即停用；180 天→expired；重复同一消息不加权 |
| 消费 | `prepare()` 内 observe + read → 连续性块进入本轮 payload；TurnEvaluation 记 `relationshipThreads`（id/kind） |

## 2. 交付 B：内在状态 → 表达策略

- `deriveExpressionPolicy(state, analysis, wantsDirectAnswer)` → `{adviceMode, clarifyMode, questionBudget, brevity, rationale}`；
- 判定顺序：直接请求 > 不确定性澄清 > 未解决张力先回应 > 默认；
- 策略进入 payload 的独立块，并记录在 TurnEvaluation；**事实证据与权限不变**（S9 断言）。

## 3. 交付 C：12 场景

- 场景集 `evals/stage-5/scenarios-v1.json`
- scripted：**12/12 PASS**
- live（spark-x2.6，SHA 绑定 `1b7ab9c`）：**12/12 PASS，0 ERROR**
- 逐条转写与 rubric：`evals/stage-5/review/transcript-live.md`；**人工自然度评分 PENDING**

真实回复摘录（原文）：

| 场景 | 回复 |
|---|---|
| S1 接续约定话题 | 「好，那咱们就先放下项目那摊事。今天想聊点什么都行……」（未强行带回，符合“不要硬塞”） |
| S3 挫折 | 「听起来今天确实够糟——项目又被推翻，换谁都会觉得提不起劲。这种时候我可以先听你说说……你更想要哪种？」 |
| S4 直接请求 | 「我这边没有你之前的任务上下文，不知道我们在推进什么。告诉我目标或上一条要求，我直接给下一步。」 |
| S6 纠正称呼 | 「你好，阿林。……」（不再用旧称呼） |
| S8 多义线索 | 「想确认一下：你说的"它"是指咪咪，还是小黑？哪只现在改名叫豆豆了？」 |
| S11 独立判断 | 「我这边记录里你住在杭州，是之前你明确告诉我的。所以我不能直接说"你在北京"。如果你现在搬到了北京，我可以更新这条信息……」 |
| S12 重启后 | 「我们上次约好接着聊「长期记忆的边界」。你想从哪一块入手……」 |

## 4. Stage 4-A 技术债（D1–D4）

| 项 | 处置 | 证据 |
|---|---|---|
| D1 宽泛 catch | 拆为 analysis / retrieval / feeling 三阶段降级，保留已完成结果；事件只含组件+阶段+原因码 | `companion-service.ts` `prepare()` |
| D2 索引一致性 | 复核既有实现（同事务 reindex + `fact_index_jobs` degraded/退避）；未发现新缺口 | `fact-index-faults.test.ts` |
| D3 多事实验证 | 逐项验证全部计划事实；部分失败返回 `PARTIAL_VERIFICATION_FAILED` 且不声称成功 | `executeOperation` |
| D4 记忆表达 | 新增固定原则 + 策略块指令：不得向用户引用 confidence/revision/memory id/状态数值 | `fixedPrinciples`、S9 |

## 5. 命令与结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run --no-file-parallelism` | 0 | **103 文件 / 951 测试全部通过** |
| `npx electron-vite build` | 0 | 构建成功 |
| `npm run eval:stage5` | 0 | 12/12 scripted |
| `npm run eval:stage5:live` | 0 | 12/12 live（`AWAITING_MANUAL_REVIEW`） |

## 6. 状态

| 项 | 状态 |
|---|---|
| 关系连续性进入生产路径（跨会话） | **PASS**（自动化 + 真实模型） |
| 状态→策略改变 payload 且不改事实 | **PASS** |
| 纠正/撤回/歧义 | **PASS** |
| D1–D4 | **PASS**（D2 复核无新增缺口） |
| 全量测试 / build | **PASS** |
| 真实 Provider | **PASS（12/12 客观）**；自然度 **PENDING 人工** |
| CI | 以 push 后 Actions 为准（本机无法等待结论） |
| Electron 应用级冒烟 | **BLOCKED**（本机渲染进程 0x80000003） |
| Windows 安装 | **NOT_RUN** |
| 第二真实 Provider | **BLOCKED**（无凭据） |
| 人工体验评测 | **PENDING** |

## 7. 结论

**PARTIAL**：关系连续性与状态表达策略在真实生产链与真实模型上成立（12/12 客观检查），但自然度需人工判定，Electron/Windows/第二 Provider 受外部条件限制。Stage 4-A 保持 PARTIAL，未被改写为 PASS。
