# Stage 3 未解决缺陷与阻塞清单

- 审查对象：`5fe62f5`（`ve766/morrow-ai-companion-v2` / `feat/stage-3-long-term-companion`）
- 审查者：本轮实现作者 → 非独立，全文受 `BLOCKED_INDEPENDENCE` 约束
- 口径：P0 = 直接否决 Stage 3；P1 = 削弱能力主张但不单独否决；P2 = 记录项
- 区分「代码缺陷」与「外部阻塞」：前者有代码位置可指，后者只有解除条件

---

## P0（任一未解决 → Stage 3 不通过）

### D-01 独立性缺失（本次验收本身）

- **类型**：流程阻塞，不是代码缺陷
- **证据**：PR #19 当前 HEAD `5fe62f5` 的三个提交（`9ac4bd5` / `bb3c150` / `5fe62f5`）由本次会话的作者产生
- **影响**：本文所有"通过/不通过"判断都带自证性质；按要求必须标 `BLOCKED_INDEPENDENCE`，不得作为独立验收结论
- **解除条件**：由未参与实现的第三方（人或另一个无上下文的审查会话）按同一 SHA 重跑本文 §可复现命令

### D-02 G1 人格成长没有消费者（能力未成立）

- **类型**：代码/架构
- **证据**
  - 生产者存在：`companion-service.ts:1073–1082` 每完成轮 `deriveGrowthSignals` → `growth.apply`
  - 消费者缺失：`describeGrowth()`（`personality-growth.ts:281`）全仓无生产调用点
  - prompt 合成只加交互偏移：`companion-service.ts:1001–1008` 调 `interaction.offsets()`
  - 真实运行旁证：三次 32 轮长跑 `interactionOffsets` 恒为 `{0,0,0}`
- **影响**：`effective_d = baseline_d + offset_d` 是设计目标而非事实。对外说"人格会随对话成长"不成立。登记表已按此改写（见 `docs/algorithms/stage-3-algorithm-registry.md` G1「接入口」）
- **最小修复方向**：在 `effectiveProfile` 内叠加 growth offset，并补"基线不变 + 偏移有界"的测试；或明确废除此项能力并删除台账
- **责任角色**：实现方；决策需维护者拍板（接/废）

### D-03 C1 语义证据缺失

- **类型**：外部阻塞（凭据）
- **证据**：`evals/real-provider/results/20261031T161446Z-unknown-semantic.json` → `status: "BLOCKED_NO_SECRET"`，`notRun` 自陈"本文件不是评估结果"
- **影响**：C1 只有机制证据（22 场景 / 88 断言，scripted provider），不能主张语言理解
- **解除条件**：注入 `MORROW_TEST_API_KEY` 后运行 `npm run eval:stage3:intent:semantic`，并完成人工逐条阅读

### D-04 人工互动质量复核未执行

- **类型**：流程
- **证据**：历史真实长跑的 `manualReview.status = "PENDING"`；仓库内无任何"审查者 + 场景编号 + 原文引用 + 评分"的记录
- **影响**：真实互动质量门槛无法评估；"计划/负责人"不能替代结果
- **解除条件**：由独立审查者按固定场景逐条阅读并署名记录

### D-05 CI 未启动（账号计费）

- **类型**：外部阻塞
- **证据**：run `41178081914`，三个 job `steps=[]`，注解 *"The job was not started because recent account payments have failed or your spending limit needs to be increased."*
- **影响**：双平台从未验证；本机全绿不能写成 CI PASS
- **解除条件**：账户恢复计费或提升额度后重跑

### D-06 Windows 安装包未验证

- **类型**：未执行
- **证据**：冒烟输出为 `built Electron app`，不是 `installed Windows app`；无干净机器测试记录
- **影响**：安装、升级、数据保留、卸载均无证据
- **解除条件**：在干净 Windows 环境执行安装 → 升级 → 卸载全流程并留档

### D-07 语音闭环未实现

- **类型**：未实现
- **证据**：无 ASR/TTS adapter、无状态机、无 UI 入口
- **影响**：Stage 3 门槛项直接缺失
- **解除条件**：实现端到端输入输出链并有可复现用例

---

## P1（削弱能力主张）

### D-08 探索"是否真的提起"仍是词面判定

- `exploration-policy.ts` 的 `evaluateRaise` 用标签分词 + 形态检查；改写式提出会被判为 `not_raised` 或 `uncertain`
- 影响：`actually_raised` 的统计偏低，探索成功率不可信
- 修复方向：语义级匹配或用模型二判（后者成本与可复现性需权衡）

### D-09 记忆冲突分类未实现

- 全树无 `conflictKind` / `conflict_type` / `ConflictClass`；只保留既有 conflict 标记
- 影响：事实冲突、偏好变化、时间变化、情境差异无法区分，冲突处理只能整体回避

### D-10 反思质量指标未实现

- `reflection-service.ts` 内无证据支持度/重复率/错误推断率的实现
- 影响：反思产出无法评估好坏，只能评估"有没有"

### D-11 内在状态 appraisal 未重构

- 沿用信号驱动的计算状态，没有事件级 appraisal 层
- 影响：状态变化的"为什么"不可解释，只有数值

### D-12 历史真实运行结果的 `status` 不是契约标签

- `20261031T073847Z-876d263.json`、`20261031T083700Z-ee728fd.json`、`20261031T085512Z-6a885fa.json` 均写 `status: "FAIL"`
- 根因：对象字面量里两个 `status`，后写的汇总覆盖了 `REAL_PROVIDER_PASS/FAIL`；已改为 `verdict`，但这三份是修前产物
- 影响：直接引用会被读成"真实模型整体失败"；其中「证件号」一条用当前判定式**复现不出来**（无 git 历史，无法区分是判定式变了还是对象不同）

### D-13 结果文件的 `codeCommit` 为 `unknown`

- 三份旧结果与 C1 机制结果均写 `unknown`（产出时工作树无 `.git`）
- 影响：结果无法绑定提交；**不得事后回填成 `5fe62f5`**，那等于伪造

### D-14 断言覆盖不均

- `C1-F4` 仅 1 条断言（下游不得盲信被篡改分析），`C1-E1/E2` 各 2 条
- 影响：这三格最容易出现"绿但无意义"

### D-15 两份离线评估报告未纳入版本控制

- `evaluation/reports/m3-synthetic-retrieval-report.json`、`m4-synthetic-reminder-report.json` 在本地存在但 `git` 未跟踪
- 影响：评估结论的可复现性依赖重新运行，不依赖工件；需确认是有意忽略还是遗漏

### D-16 遗留便条诱导把凭据落盘

- `.tmp/WHERE_TO_PUT_KEY.txt` 让人把 key 写进 `.tmp/deepseek.key`，而运行器没有文件回退（单一入口 `MORROW_TEST_API_KEY`）
- 影响：照做者会得到"配了 key 仍是 BLOCKED"，下一步往往去改探针——拆掉安全设计
- 修复方向：删除便条

---

## P2（记录项）

- **D-17** C1 读解 `confidence` 是 `heuristic_score`，无任何校准数据；界面/文档不得当概率展示。
- **D-18** `2026-10-31` 的真实长跑中「风格请求达到证据门槛并产生交互偏移」三次全失败：`directness_signals` 为 1/2/2，门槛 3。规则上正确，但意味着该夹具从未验证过非零偏移。

---

## 汇总

| 级别 | 数量 | 其中代码缺陷 | 外部阻塞 | 未实现 |
|---|---:|---:|---:|---:|
| P0 | 7 | 1（D-02） | 3（D-01/03/05） | 2（D-06/07） |
| P1 | 9 | 6 | 1（D-16 卫生） | 2（D-09/10） |
| P2 | 2 | 0 | 0 | 0 |

D-04 属流程项，计入 P0 的"证据缺口"一类。
