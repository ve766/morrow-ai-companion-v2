# Stage 3 独立最终验收（自审版）

> **`BLOCKED_INDEPENDENCE`** —— 本文件不是独立验收。审查者是本轮实现的作者。按任务 §0，独立性无法保证时必须标记该状态，且不得自称独立验收。本文按此执行：结论只用于给真正的独立审查者提供证据基础，**不构成批准**。

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/stage-3-long-term-companion`
- PR：[#19](https://github.com/ve766/morrow-ai-companion-v2/pull/19)（`refs/pull/19/head` 与分支同点；`refs/pull/19/merge` = `f2fe599` 存在，与"仍为 OPEN"一致。**但 PR 的 state 无法用 API 独立确认**——连接器对这个私有库返回 404，所以这一项的判定上限是"与证据一致"，不是"已验证"）
- PR base：`feat/stage-2-delivery-hardening` @ `8467079`（未改）
- 审查 SHA：`5fe62f546b84b0306e7f11e887bad9c75f3227ba`（与任务发布时一致，期间未变）
- 审查时间：2026-11-01T04:2xZ
- 结论：**NO-GO**（见 `stage-3-final-decision.md`）

---

## 0. 独立性声明

| 项 | 事实 |
|---|---|
| 被审提交 | `9ac4bd5`（C1 代码）、`bb3c150`（文档与证据）、`5fe62f5`（落地记录） |
| 这三笔由谁产生 | 本次会话的助手 |
| 因此 | 审查者与实现者是同一方，独立性 = **不成立** |
| 处置 | 全文标 `BLOCKED_INDEPENDENCE`；判定为 NO-GO 而非 PASS，避免自证 |

**为什么仍然写这份文件**：它把可复核的事实（树一致性、复跑退出码、血缘缺口、外部阻塞）集中成一份证据包。独立审查者可以只重跑命令、只读原文，不必重新摸索。

**为什么不能把它当验收**：一个作者说"我没通过"，只是诚实的自评；一个作者说"我通过"，才是自证。本文只做前者。

## 1. 方法

1. 用 `git fetch --filter=blob:none` 取 `5fe62f5` 的树，避免整包克隆（TLS 在代理下不稳定，`schannel: server closed abruptly` 复现两次）。
2. 对 583 个文件逐一计算本地 blob 哈希与远端比对，再对 65 个"不匹配"逐个 `diff --strip-trailing-cr` 复核。
3. 在内容等价的本地树上复跑仓库定义的全部验证命令，逐条记录退出码。
4. 逐份阅读任务 §3 列出的权威文件，并与源码对照（行号对应该 SHA）。
5. **未修改任何业务代码、测试、迁移、配置；未提交除本组审计文档以外的任何文件。**

## 2. 关键发现

### F-1 树一致性成立（可复核）

583 个文件中 518 个字节级一致，65 个仅行尾不同且逐个复核为 0 差异，**内容不同者 0 个**。因此本地重跑结果可以归属到 `5fe62f5`。

### F-2 G1 人格成长没有消费者（认知门槛 FAIL 项）

- 有生产者：`companion-service.ts:1073–1082` 每完成轮写证据。
- 无消费者：`describeGrowth()`（`personality-growth.ts:281`）无生产调用点；`effectiveProfile`（`996–1013`）只叠加 `interaction.offsets()`。
- 真实旁证：三次 32 轮长跑 `interactionOffsets` 恒为 `{0,0,0}`，且"风格请求产生偏移"三次全失败（`directness_signals` 1/2/2 < 门槛 3）。

结论：`effective_d = baseline + growth_offset` **未实现**。登记表已改写为"目标公式，当前未实现"，但代码未动（本任务禁止改代码）。

### F-3 C1 只有机制证据

机制套件 22 场景 / 88 断言全过，`suite=mechanism`，provider 为脚本化字符串。语义套件产出 `BLOCKED_NO_SECRET`，其 `notRun` 字段自陈"本文件不是评估结果"。**不得用机制结果替代语义主张。**

附：本轮修掉了一处假绿——`C1-A3` 旧断言只查 `status === 'stated'`，可被 `个函数`/`张图` 通过；上一版"修复"只清值未清断言。现要求"值出现在原话 + 非量词开头 + `topic.evidenceMessageId` 等于引入轮 id"。这个修复本身也说明：**此前的 22/22 曾经无意义**。

### F-4 历史真实运行可用但不可直接引用

- 三次 32 轮 / 3 会话，0 轮次失败，召回/纠正/删除传播通过。
- 每次 1–2 条断言失败；`status` 字段是修 bug 前的汇总值（`"FAIL"`），不是契约标签 `REAL_PROVIDER_*`。
- `codeCommit` 为 `unknown`（产出时工作树无 `.git`），**不得回填**。
- 「证件号」那条失败用当前判定式复现不出来，无 git 历史可区分原因 → 记为不可复核。

### F-5 Electron 冒烟在本机通过，旧记录需作废

输出 `Morrow smoke passed: built Electron app …`，且**未带** `[sandbox disabled for this host]`（`scripts/smoke.mjs:27` 判定 + 未设 `MORROW_SMOKE_DISABLE_SANDBOX`）。此前记录的 `0x80000003` 本轮未复现，差异在于启动脚本会从子进程环境删除 `ELECTRON_RUN_AS_NODE`。

但这只覆盖"起得来、IPC 通、重启后还在、删除后不引用"，**不是逐屏正确性**，也不是安装包。

### F-6 CI 仍 BLOCKED

run `41178081914`，jobs `steps=[]`，注解为账号计费。本机全绿不能写成 CI PASS。

### F-7 迁移升级路径未逐版本核对

存在 `src/persistence/migrations.test.ts`，但本轮没有逐个验证 38 个迁移在旧库上的升级路径，也没有验证降级锚点 `DEGRADED_OPEN_MINIMUM_VERSION=9` 的实际行为。→ PARTIAL。

### F-8 未实现项（不得从门槛中隐去）

语音 ASR/TTS、记忆冲突分类、反思质量指标、appraisal 重构、语义级"是否真的提起"。

### F-9 一处口径需要收紧

`docs/reports/stage-3-final-gap-closure-audit.md` 把 **S3-01 判为 PASS**，理由是 `reflection-service.ts:678` 调用了 `observeMorrow`。这个调用确实存在，**但缺口的来源仍然只有"事实守卫改写"一种**（登记表 R1 自陈）。真实运行里 `knowledgeGaps` 为 0 或 1，`morrowInterests` 始终 0。

按任务 §1"代码有实现但无真实生产调用链，不得评为能力 PASS"，S3-01 应改为 **PARTIAL**：链路成立，能力未在真实对话中成立。

## 3. 范围之外（未审）

- renderer 逐屏交互、Windows 安装/升级/卸载、CI 实际执行、真实模型语义与人工质量。
- 这些不是我漏掉，而是没有证据可审。

## 4. 若要转成真正的独立验收，必须补做的事

1. 由未参与实现的一方，在同一 SHA 上重跑 `stage-3-reproducibility-log.md` 的全部命令。
2. 逐份阅读任务 §3 的 12 个文件，确认与源码一致（本文 F-9 就是这类阅读发现的）。
3. 拿到 `MORROW_TEST_API_KEY` 后跑语义套件，并由**人**逐条读原文、署名记录评分。
4. 在干净 Windows 环境验证安装 → 升级 → 卸载。
5. 对 F-2 给出决策：接 growth offset 还是废除此能力——这是产品决定，不是审查结论。

## 5. 本文件没有改变任何东西

未改代码、未改测试、未改迁移、未改配置、未改其他文档；除本组六份审计文件外无新增文件。PR #19 保持 OPEN、未合并。
