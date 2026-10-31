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
