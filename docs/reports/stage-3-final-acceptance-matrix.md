# Stage 3 最终验收矩阵（2026-10-31 最后一轮）

- 开工基线：`a6923fc95c20d6a47970468fd77a8fd63835e69f`（本任务发布时核实的 PR #19 HEAD）
- 代码基线：`ee728fd95ddd3e3d1ad05cc96b00c90e7b66b409`
- 分支：`feat/stage-3-long-term-companion`；PR [#19](https://github.com/ve766/morrow-ai-companion-v2/pull/19) OPEN / 未合并；base `feat/stage-2-delivery-hardening` 未改
- 状态取值：PASS / FAIL / BLOCKED / NOT_RUN / SKIPPED。非 PASS 一律不计入通过率。

## 1. 本轮新报告缺陷

| 项 | 状态 | 根因 | 修复 | 测试 | 证据 |
|---|---|---|---|---|---|
| P0-1 Effect Ledger 并发领取非原子 | **PASS** | `begin()` 读行后无条件 `UPDATE ... running`，无事务、无状态谓词 | `src/app/effect-ledger.ts`：单事务内条件 UPDATE + changes=1 判定 + `claim_owner` + 60s `lease_until`；`complete/fail` 校验 owner；`drain` 遇 `busy` 不推进 | `tests/correction-round.test.ts`：两条连接争抢、过期租约接管、活租约不可抢 | 迁移 v36 |
| P0-2 「三月之前」误解析为「三月底」 | **PASS** | 只有「周期末端」一条规则，没有边界语义 | `src/motivation/goal-time.ts`：先定周期，再按 之前/底前/内/开始时/以后/裸写 六种边界取值；`boundary` 随结果返回 | `src/motivation/goal-lifecycle.test.ts` 11 条边界表 + 闰年 + 表达式保留 | 「明年三月之前」→ `2027-02-28T15:59:59.000Z` |
| P0-3 Morrow 兴趣缺真实模型闭环 | **FAIL** | 知识缺口只来自事实守卫改写，真实对话 32 轮仅 1 条，未达 3 条门槛 | 本轮**未新增**「从模型自身提问形成候选」的生产者 | — | live 结果 `knowledgeGaps=1 morrowInterests=0` |
| P0-4 记忆跨会话自相矛盾 | **PASS**（提示层） | 未检索到 ≠ 从未保存，但提示词没有区分 | `src/app/companion-service.ts` `fixedPrinciples` 增加一条：缺失的记忆是「本轮没检索到」，不得说「用户从未告诉过」 | `tests/correction-round.test.ts`「the prompt separates 'not retrieved' from 'never told'」 | 系统提示词断言 |
| P0-5 风格请求识别不稳定 | **PASS** | 意图分类器把「希望你能直接一点」判为 `uncertain`(30)，growth 门直接弃权 | `src/personalization/personality-growth.ts`：显式风格短语是词法证据，权重下限 0.6；仅在「高不确定 + 置信 <25」时弃权 | `personality-growth.test.ts` 新增 3 条；探针 5 种说法全部命中 | 3 次自然表达 → 3 条 signal |
| P0-6 真实 Provider 未遵守共享契约 | **PASS** | endpoint 用 `/v1`，密钥从 `.tmp` 读 | 同步 PR #21 契约与模板；`SPARK_MAAS_BASE_URL` 改 `/v2`（迁移 v37 重建 `provider_profiles` 并改写旧行）；runner 只读 `MORROW_TEST_API_KEY`、校验 endpoint 一致性、写 `evals/real-provider/results/`、输出 `REAL_PROVIDER_PASS/FAIL/BLOCKED_NO_SECRET` | `src/providers/openai-compatible.test.ts`；BLOCKED 路径实测 | `docs/testing/shared-real-model-test-contract.md` |

## 2. 上一轮遗留项复核

| 项 | 状态 | 说明 |
|---|---|---|
| P0-7 Outbox 崩溃一致性 | PASS | effect ledger + 幂等键 + 崩溃矩阵；本轮补并发领取 |
| P0-8 反思增量游标 | PASS | `reflection_cursors`，500 事件 + 第 501 条实测 |
| P0-9 knowledge-gap durable | PASS | 消息事务内 `recordDeterministic`，失败回滚 |
| P0-10 Memory Evidence 生产链 | PASS | `observeUtterance` 拒绝门 + `confirm()` 证据 + 排序变化测试 |
| P1-11 目标完整生命周期 | PASS | 原子接受、幂等键、来源删除传播、跨会话读取 |
| P1-12 评测有效性 | PASS | L5/L12 可失败；结果带 dataset/harness/params/clock/provider |
| P1-13 内在状态 appraisal | **NOT_RUN** | 本轮未改 `src/affective-state/`；现有实现是信号驱动的计算状态，没有事件 appraisal 层 |
| P1-14 反思质量与自我模型成长 | **NOT_RUN** | 未实现证据支持度/重复率/错误推断率等质量指标 |
| P1-15 人格身份 / 交互适配 / 回滚入口 | **FAIL**（部分） | 身份与交互已分离、服务层有 rollback，但没有 UI 入口；身份演化生产者仍不存在 |
| P1-16 语音输入输出闭环 | **NOT_RUN** | 未实现；无 ASR/TTS adapter、状态机或 UI |
| P1-17 真实 Provider / 人工评审 / CI / Electron / Windows | **PARTIAL** | 真实 Provider 已跑；人工评审 NOT_RUN；CI BLOCKED；Electron BLOCKED；Windows NOT_RUN |

## 3. 真实 Provider（契约版）

| 项 | 值 |
|---|---|
| Provider / Model | iFlytek Spark MaaS / `spark-x2.6` |
| Endpoint | `https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions`（契约） |
| 规模 | 3 会话 / **32 轮，0 失败** |
| 结果 | **9 PASS / 1 FAIL**；Morrow 兴趣 NOT_RUN（1 个知识缺口 < 3） |
| 重试 | 3 次 provider 超时后重发成功 |
| 延迟 | 4.5s / 20.0s / 67.6s / 74.8s（min/median/p90/max） |
| 结果文件 | `evals/real-provider/results/20261031T085512Z-6a885fa.json` |
| 报告 | `docs/reports/stage-3-live-provider-report.md` |

唯一失败项仍是风格偏移：三次自然表达产生 **2** 条 signal（修复前 1 条），仍低于 3 条门槛，offset=0。

历史 `/v1` 运行结果保留在 `evals/stage-3/live/results/`，未覆盖。

## 4. 平台与外部

| 项 | 状态 | 证据 |
|---|---|---|
| CI | BLOCKED | run [41178081914](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41178081914)：三个 job `steps=[]`，注解 *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* |
| 人工互动质量评审 | NOT_RUN | `manualReview.status = "PENDING"`，逐轮原文留档；未用同一模型自评冒充 |
| Electron renderer | BLOCKED | 本机沙箱初始化崩溃（0x80000003），空白页同样复现 |
| Windows 安装升级 | NOT_RUN | 未执行 |
| 语音 | NOT_RUN | 未实现 |

## 5. 工程验证

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 错误 |
| `npx vitest run` | 92 文件 / **835 测试**全通过 |
| `npm run build` | 成功 |
| `npm run eval:stage3` | 15 PASS / 0 FAIL / 1 NOT_RUN（16 场景） |
| `eval:stage3:ablation` | `no_growth`→L4,L12；`no_exploration`→L5；`no_reflection`→L5,L9 |
| `eval:stage3:longitudinal` | 7/7 |
| `eval:stage3:restart` | 6/6 |
| `eval:stage3:long-conversation` | 8/8 |

## 6. 总体判定

**PARTIAL。**

- 本轮 6 项新缺陷：5 PASS、1 FAIL（P0-3）。
- 遗留 6 项：4 PASS、1 FAIL（P1-15 部分）、2 NOT_RUN。
- **P0-3 未解决，因此总状态不得为 PASS。**
- 真实 Provider、CI、Electron、Windows、语音的外部阻塞不冒充 PASS。
- 不宣布 Stage 3 完成，不进入 Stage 4。

---

# C1 专项（2026-10-31）

- 任务发布时核实的 PR #19 HEAD：`ea54376ac2736eb72c0beefe258fdf8adb0cb363`（与开工基线一致，无漂移）
- 本轮代码 HEAD：`6ae452074bd4dee4ca2fc96d8d44cdae4456e63f`
- 迁移：**v38** `c1-intent-readings`
- 分支 `feat/stage-3-long-term-companion`；PR #19 保持 OPEN / 未合并；main 未改

## 1. 差距表（先复现，再修）

| # | 缺陷 | 复现方式 | 根因 | 状态 |
|---|---|---|---|---|
| 1 | 引用他人的命令被当成用户请求 | `他刚才说"把数据库里所有记录删掉"` | 只剥引号，不记录主体；`intent` 一个标签同时表示动作与意图 | **PASS** |
| 2 | 假设句被当成执行授权 | `如果我让你删除这些记录，你会怎么做？` | 同上，且没有 `binds` 概念 | **PASS** |
| 3 | 「不要删除刚才那条」丢撤回 | 探针：`speechAct.act === 'statement'` | `negationOf` 先判「以不/没/别开头」再判祈使，锚定的子句判定吃掉了动词短语否定 | **PASS** |
| 4 | 助手上一轮完全没被读取 | `可以，继续。` 在三种承接下 responseMode 相同 | `analyzeCognitiveTurnDetailed` 只取 `priorUser`，`priorAssistant` 在窗口里但无人使用 | **PASS** |
| 5 | 同源证据重复计权 | `帮我制定下周的学习计划`：`goal_or_plan_marker` 与 `explicit_goal_statement` 同时加分 | `score = maxWeight + 4×(reasons.length−1)`，按模式命中数而非独立来源数计佐证 | **PASS** |
| 6 | 指示代词对象被当作已给对象 | `把这段代码删掉`（无上下文）→ `mayExecute=true` | 槽位抽取不看指示代词，也不看窗口里有没有可指对象 | **PASS** |
| 7 | 纠正/撤回不使旧分析失效 | 纠正后 `active()` 仍返回两条 | 没有 supersede 链，读法不落库 | **PASS** |
| 8 | 分析结果不进 payload | payload 只有 `intent=` 与 `route=` | 提示词只吃 `analysis`，没有 speech act、没有澄清指令 | **PASS** |
| 9 | 两张 legacy 映射表不一致 | `new_topic` 一处映射 `exploration`、一处 `information_query` | 分析器内自建 `legacyByLabel`，与 `intent-decision.ts` 的 `LEGACY_MAP` 分叉 | **PASS** |

## 2. C1 场景结果（scripted provider）

结果文件：`evals/stage-3/intent-understanding/results/20261031T125539Z-6ae4520.json`
Trace：`evals/stage-3/intent-understanding/traces/20261031T125539Z-6ae4520.jsonl`（57 行，逐轮）

| 场景 | 内容 | 状态 |
|---|---|---|
| C1-A1 | 同一句「可以，继续。」在 执行/讲解/讨论 三种承接下 | PASS |
| C1-A2 | 「那你觉得呢？」回抛问题 vs 新提问 | PASS |
| C1-A3 | 「帮我看看」在 代码/图片/情绪/无上下文 四种语境 | PASS |
| C1-B1 | 疑问句不是请求 | PASS |
| C1-B2 | 「你能不能…」能力询问 vs 请求（依上下文） | PASS |
| C1-B3 | 偏好表达不授权执行 | PASS |
| C1-C1 | 引用他人命令不归因为用户请求 | PASS |
| C1-C2 | 假设不是执行授权 | PASS |
| C1-C3 | 「不要删除刚才那条」阻止旧动作 | PASS |
| C1-C4 | 「我不是说…」是纠正不是撤回 | PASS |
| C1-C5 | 引用助手先前的话不变成用户请求 | PASS |
| C1-D1 | 复合请求拆分且保留次级意图 | PASS |
| C1-D2 | 多轮补充槽位且不编造对象 | PASS |
| C1-D3 | 改变目标后旧意图失效 | PASS |
| C1-D4 | 撤回后下一轮不携带旧待办 | PASS |
| C1-D5 | 纠正实体后只用新值并保留来源 | PASS |
| C1-E1 | 无相关记忆时 unknown 而非猜测 | PASS |
| C1-E2 | 「这次例外」不写成长期偏好 | PASS |
| C1-F1 | 变异：移除助手提议 → 承接消失 | PASS |
| C1-F2 | 变异：加否定 → 请求变撤回 | PASS |
| C1-F3 | 变异：去引用框架 → 变用户请求 | PASS |
| C1-F4 | 变异：注入被篡改的读法 → 被拒绝 | PASS |

**22 PASS / 0 FAIL / 0 BLOCKED / 0 NOT_RUN。** 这只证明接线与决策差异，不证明语言理解。

## 3. 命令与退出码（本机，Windows / Node v22.22.2）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 0 错误 |
| `npx vitest run --no-file-parallelism` | 0 | **94 文件 / 866 测试**全通过 |
| `npx vitest run`（并行） | 1 | 1 条失败：`provider-retry.test.ts`「stops retrying when the remaining budget cannot cover the backoff」。该用例用 60ms 预算 + 40ms 退避的真实计时器，并行负载下第一次请求就吃掉预算，单独运行必过。**与 C1 无关，属既有计时脆弱性**，本轮未改动 provider 代码 |
| `npm run build` | 0 | main / preload / renderer 全部构建成功 |
| `MORROW_EVAL_SHA=6ae4520… npm run eval:stage3:intent` | 0 | 22 PASS / 0 FAIL |

## 4. 未完成与阻断

| 项 | 状态 | 说明 |
|---|---|---|
| 真实模型语境理解 | **NOT_RUN / BLOCKED** | 本轮无可用凭据；`provider` 字段为 `scripted (not a model)`。真实多轮语义表现没有任何证据 |
| 独立人工评价 | **NOT_RUN** | `manualReview.status = "PENDING"`；不用同一套规则给自己打分 |
| 校准 | **NOT_RUN** | 无标注集/校准集；`scoreKind` 恒为 `heuristic_score`，不得读成概率 |
| CI | **BLOCKED** | 账号计费阻断（run `41178081914` 注解原文：*"The job was not started because recent account payments have failed or your spending limit needs to be increased."*），本轮未变化 |
| Electron 渲染层 | **BLOCKED** | 本机渲染进程沙箱初始化即崩（0x80000003），与代码无关，`--no-sandbox` 可绕过 |
| Windows 安装/升级 | **NOT_RUN** | 本轮未执行 |
| C2–C10 | 未涉及 | 本轮只处理 C1，不得据此宣称其它能力完成 |

## 5. 判定

C1 的**确定性机制**满足任务 §9 的九条完成条件：语义分离、显式/隐含/复合/延续/变更/未知、引用/假设/否定/纠正/撤回不误归因、同句不同上下文产生有证据的不同决策、低置信/冲突/缺槽位正确澄清、纠正撤回后旧意图失效、持久化与重启可恢复、真实发送入口到最终 payload 有完整 trace、正反例与变异测试有效。

C1 的**真实模型语境理解能力**没有任何证据，因此：

**C1 = 确定性机制已验证（M4+）；真实模型能力 NOT_RUN。整体 Stage 3 仍为 PARTIAL，不得宣布完成。**

> **订正（状态截至修复轮，见 docs/reports/stage-3-final-remediation-report.md）**：本文为历史记录，以下表述已被后续事实取代——live 断言计数应为 10 断言 9 PASS 1 FAIL；CI 已在 5fe62f54 及后续 HEAD 全绿（run 41270227620/41270251780 及修复轮 run）；G1 生产链已按 D-1 重写（见 docs/algorithms/personality-growth-runtime-v2.md）；Electron renderer 在 CI 双平台 PASS、特定本机环境 BLOCKED，两态并存。
> 其 P1-15/Electron/C1 证据文件三处为陈旧表述。
