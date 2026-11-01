# Stage 4 入场简报

- 生成时间：2026-11-01T03:25Z
- 写给：接手 Stage 4 的人（或下一个会话的自己）
- 前置阅读（按顺序，共约 15 分钟）：`docs/reports/stage-3-final-verification.md` → `docs/architecture/stage-3-final-runtime-map.md` → 本文 §三 → `docs/reports/stage-3-real-provider-evidence.md`

---

## 一、一句话状态

Stage 3 是 **PARTIAL**，不是完成。本机工程链全绿，但 C1 的**语义**证据没有、人工复核没人做、CI 因账号计费没跑、人格漂移没有消费者。**PR #19 不得合并**。

## 二、三条硬约束（违反任何一条，后面所有结论作废）

1. **没有 commit 就没有证据。** 当前工作树 `E:\Hasee\Documents\morrow-stage3` **没有 `.git`**，所有结果文件写 `codeCommit: "unknown"`。做任何"这次改动是否修好了 X"的判断之前，先把树放进一个有身份的仓库。补字段不算补证据。
2. **凭据只走一个入口。** `MORROW_TEST_API_KEY`，不写文件、不回退读路径、不打印（只报存在性与长度）。缺就记 `BLOCKED_NO_SECRET`，退出码 0。**不要为了"让套件变绿"去造一个假 key 或换成脚本化 Provider**——那会把"没测"伪装成"测过"。
3. **人格基线只由用户编辑改变。** prompt 里那三个数值来自交互偏移（±8 有界），不是人格生长台账。改这条之前先读完 `stage-3-final-runtime-map.md` §五。

## 三、当前真实能力边界

| 能 | 不能 |
|---|---|
| 上下文决定"执行/讲解/讨论"、引用/假设/撤回/纠正的区分、跨轮补充与 supersede（22 场景 88 断言） | 把"这个函数"解析成 `parseConfig`（无实体链接） |
| 记忆按作用域检索、四类泄漏为 0、提醒抑制（合成集） | 真实用户语料上的检索质量（数据集是构造的） |
| 内在状态作为**计算变量**参与检索与 prompt，带证据溯源 | 置信度校准（`calibration.measured = false`） |
| 目标期限边界解析（`三月之前` → 2 月底）在真实运行中通过 | 语音输入输出（未实现） |
| 桌面应用能起、IPC 通、重启后数据在、删除后不再引用 | 安装包升级、干净机器、逐屏 UI 正确性 |

## 四、三个必须先做的决定（不要边做边定）

### D1 人格生长 G1：接、还是明确废

现状：`personality_growth_*` 三张表每轮写入、有审计事件、可 `rollback`；`describeGrowth()` **无任何生产调用点**；`effectiveProfile` 只加交互偏移。

| 选项 | 代价 | 风险 |
|---|---|---|
| A. 接进 prompt（把 growth offset 也加进 `effectiveProfile`） | 小（一处合成） | 首次让模型可见的数值随证据漂移，需要新的"基线不变"测试与人工复核 |
| B. 保持现状，文档标注"台账未接" | 零 | 永久的技术债；登记表已如实写明，不会误导 |
| C. 删除 G1 台账 | 中（迁移需保留，不能回滚已发版数据） | 丢掉已积累的证据与审计 |

建议 **B 先行**，把 A 作为 Stage 4 第一个有测试护栏的改动。**不要**在没定之前顺手接上——那会让"人格只由用户编辑改变"这句话变成需要解释的话。

### D2 C1 语义证据谁出

需要：一把真实 key + 一个愿意逐条读 6 个场景原文的人。两样缺一，语义状态就一直是 `BLOCKED`。**没有第三条路**（脚本化 Provider 不算）。

### D3 CI 什么时候恢复

当前阻塞是 GitHub 账号计费（run `41178081914` 未启动）。这与代码无关，但意味着双平台从未验证过。恢复后第一件事是跑 `npm run verify` 全链，而不是先合 PR。

## 五、入口地图（改哪里找哪里）

| 要改的东西 | 去哪 |
|---|---|
| 一轮对话的顺序、prompt 拼装 | `src/app/companion-service.ts` `prepare()`（1776 起） |
| C1 读解规则 | `src/cognition/intent-reading.ts` / `speech-act.ts` / `intent-decision.ts` |
| C1 评测（机制） | `evals/stage-3/intent-understanding/run.ts`，`npm run eval:stage3:intent` |
| C1 评测（语义，需 key） | 同目录 `semantic.ts`，`npm run eval:stage3:intent:semantic` |
| 真实 Provider 公共路径 | `evals/stage-3/shared/real-provider.ts`（凭据、栈、脱敏、blocked 记录都在这里） |
| 数据库结构 | `src/persistence/migrations.ts`（38 个迁移，**只增不改**；改约束用"重建表 + 具名迁移"） |
| IPC 契约 | `src/shared/contracts.ts`（66 通道，改这里 renderer 才会跟着报错） |
| 算法口径 | `docs/algorithms/stage-3-algorithm-registry.md`（本轮已收敛为一层真相） |

## 六、不要做的事

- ❌ 重新初始化项目、删现有代码、改架构分层（领域声明 Port，SQLite 实现在 `persistence/`）。
- ❌ `git commit --amend` / `reset --hard` / `rebase` / `stash` 混进"环境债"。
- ❌ 把机制套件的 22/22 说成"C1 通过了"。
- ❌ 把 `status: "FAIL"` 的历史文件当成契约标签引用（那是修 bug 前的汇总字段）。
- ❌ 在没有 `.git` 的树上写"本次提交修复了 X"。

## 七、建议的第一个迭代

1. 把树放进仓库，跑一次 `npm run verify`，把 `codeCommit` 写成真实 SHA（这是所有后续工作的地基）。
2. 若拿到 key：跑语义套件 → 人工逐条读 → 写结论。这是唯一能把 C1 从 BLOCKED 变成有证据的路径。
3. 若拿不到 key：先把 F4（1 条断言）、E1/E2（各 2 条）加厚，并把"人工复核"做成可分工的清单——**不要**用更多脚本化场景冒充语义证据。
4. D1 决策落地：选 B 就把 `stage-3-final-runtime-map.md` §五 的表述固化进 README；选 A 就先写"基线不变 + 偏移有界"的测试，再改合成。

## 八、Stage 4 的入场条件（建议）

- [ ] 工作树有 `.git`，`npm run verify` 全绿且 `codeCommit` 为真实 SHA
- [ ] C1 语义状态不再是 `BLOCKED`（要么有证据，要么有明确的人工复核计划与负责人）
- [ ] D1 已决策并记录
- [ ] CI 恢复，双平台各跑过一次
- [ ] PR #19 的合并条件写成清单，逐条可勾选

五项全绿之前，Stage 4 的任何"新能力"都建立在沙上。
