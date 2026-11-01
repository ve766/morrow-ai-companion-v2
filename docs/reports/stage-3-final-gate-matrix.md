# Stage 3 最终门槛矩阵

- 审查对象 SHA：`5fe62f546b84b0306e7f11e887bad9c75f3227ba`
- 分支 / PR：`feat/stage-3-long-term-companion` / [#19](https://github.com/ve766/morrow-ai-companion-v2/pull/19)
- 审查者独立性：**BLOCKED_INDEPENDENCE**（审查者是本轮实现作者）
- 判定：PASS / PARTIAL / FAIL / BLOCKED / NOT_RUN。**非 PASS 不计入通过率。**

---

## 门槛一：工程真实性 —— PARTIAL

| 项 | 判定 | 证据 | 缺口 |
|---|---|---|---|
| 对话主链 renderer→preload→main→service | PASS | 冒烟跑通真实 Electron 应用（未传 `--no-sandbox`），IPC 往返与重启持久化被断言 | renderer 无逐屏断言 |
| IPC 契约 | PASS | 66 个通道集中在 `src/shared/contracts.ts`，单处注册循环 | — |
| 持久化与事务边界 | PASS | 57 张表 / 38 个迁移；消息+证据同事务；effect ledger 条件 UPDATE；预算 `BEGIN IMMEDIATE` | 未逐版本核对升级路径（见下） |
| 迁移 v1→当前升级 | **PARTIAL** | 存在 `src/persistence/migrations.test.ts` | 本轮未逐版本验证 38 个迁移在旧库上的升级；降级锚点只做了常量检查 |
| 记忆生命周期 | PASS | 创建/纠正/撤回/删除/归档/恢复均有测试；删除触发器回收证据 | 跨天连续性未测 |
| Outbox / Effect Ledger | PASS | `tests/correction-round.test.ts` 崩溃矩阵 6 点；并发领取单事务 | — |
| 目标生命周期与时间语义 | PASS | `goal-time` 边界表 11 条 + 闰年；真实运行中「三月之前」→ `2027-02-28T15:59:59Z` | — |
| 类型 + 单测 | PASS | 见 `stage-3-reproducibility-log.md`（退出码逐条记录） | — |
| 构建 | PASS | `electron-vite build` 三产物写出 `out/` | — |
| CI 双平台 | **BLOCKED** | run `41178081914` 因账号计费未启动 | 外部解除 |

## 门槛二：认知有效性 —— PARTIAL

| 项 | 判定 | 证据 | 缺口 |
|---|---|---|---|
| C1 语境理解（机制） | PASS | 22 场景 / 88 断言，`suite=mechanism`，scripted provider | — |
| C1 语境理解（语义） | **BLOCKED** | `BLOCKED_NO_SECRET`，`notRun` 自陈非评估结果 | 需凭据 + 人工阅读 |
| 记忆连续性 | **PARTIAL** | 真实 32 轮 / 3 会话中"新会话首轮召回代号"通过；删除/撤回不泄漏有断言 | 跨天、重启后的多轮一致性只在机制层验证 |
| Morrow 自身兴趣 | **PARTIAL** | 生产链存在：反思 → `observeMorrow`（678）/ `observeMorrowEvidence`（669）；证据按来源拆分、跨会话聚合 | 缺口来源单一（只来自事实守卫改写）；真实运行 `knowledgeGaps=0/1` → `morrowInterests=0`，从未形成兴趣 |
| 人格身份 / 交互适配 | **FAIL** | 基线只由用户编辑改变（成立）；交互偏移 ±8 有界 | **G1 无消费者**：`describeGrowth()` 无调用点，`effectiveProfile` 不读 growth；`effective_d` 未实现 |
| 内在状态 | **PARTIAL** | 状态是计算变量，参与检索策略与 prompt；证据可溯源 | appraisal 未重构；无 affect 消融 |
| 反思 | **PARTIAL** | 增量游标、幂等、依赖注入时钟、限频去重通过 | 质量指标（支持度/重复率/撤回率）未实现 |
| 长期目标 | PASS | 归属、优先级、过期、完成即退出、跨会话读取 | — |
| 自主探索 | **PARTIAL** | 状态机 + 原子预算 + `actually_raised` 记账 | "是否真的提起"仍是词面+形态双检，改写式提出漏判；真实运行 `explorationAttempted=0` |
| 语音 | **NOT_IMPLEMENTED** | 无 adapter、无状态机、无 UI | 门槛项缺失 |

## 门槛三：真实互动质量 —— BLOCKED

| 项 | 判定 | 证据 | 缺口 |
|---|---|---|---|
| 契约一致性（模型/端点/密钥变量） | PASS | `docs/testing/shared-real-model-test-contract.md`：`spark-x2.6`、`/v2/chat/completions`、`MORROW_TEST_API_KEY` 单一入口 | — |
| 真实 Provider 运行（本轮） | **BLOCKED** | `MORROW_TEST_API_KEY` 缺失，写 `BLOCKED_NO_SECRET` | 需凭据 |
| 真实运行（历史） | **PARTIAL** | 三次 32 轮 / 3 会话、0 失败轮次；召回、纠正、删除传播通过 | 每次都有 1–2 条失败断言；`status` 字段非契约标签；`codeCommit` 为 `unknown` |
| 人类质量复核 | **NOT_RUN** | `manualReview.status = "PENDING"` | 必须由独立审查者阅读原文 |
| 主体归属与澄清行为 | **PARTIAL** | 规则层有断言；真实回复中出现过"没有上一轮记录"这类不一致（`ee728fd` 第 3 条 detail） | 未系统评估 |

## 门槛四：平台与产品 —— BLOCKED

| 项 | 判定 | 证据 | 缺口 |
|---|---|---|---|
| GitHub Actions | **BLOCKED** | 计费阻断，`steps=[]` | 账户侧解除 |
| Electron renderer | **PARTIAL→PASS（冒烟级）** | 冒烟 exit 0，输出未带 `[sandbox disabled for this host]`；此前记录的 `0x80000003` 本轮未复现（差异在启动脚本会删除 `ELECTRON_RUN_AS_NODE`） | 仅冒烟，无逐屏交互 |
| Windows 安装/升级/卸载 | **NOT_RUN** | 只验证 `out/` 构建产物 | 需干净机器 |
| 语音 ASR/TTS | **NOT_IMPLEMENTED** | — | 无实现 |

---

## 汇总

| 门槛 | 判定 | 一句话理由 |
|---|---|---|
| 工程真实性 | **PARTIAL** | 本机全绿，但 CI BLOCKED、迁移升级路径未逐版本核对 |
| 认知有效性 | **PARTIAL** | C1 语义 BLOCKED、反思质量缺失；**G1 直接 FAIL（无消费者）** |
| 真实互动质量 | **BLOCKED** | 无凭据、人工复核 NOT_RUN |
| 平台与产品 | **BLOCKED** | CI 计费阻断、Windows 未验证、语音未实现 |

**整体：NO-GO。** 任何一个门槛为 BLOCKED 都不允许写 GO；认知有效性存在 FAIL 项，进一步排除通过。

判定依据见 `stage-3-final-decision.md`；命令与退出码见 `stage-3-reproducibility-log.md`；缺陷见 `stage-3-open-defects-and-blockers.md`。
