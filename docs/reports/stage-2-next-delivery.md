# Stage 2 下一轮交付（issue #17）

写作时间：2026-10-29 17:35 (+08:00)
分支：`feat/stage-2-delivery-hardening`（PR #15）
本文件对应提交 HEAD：见 PR #15 最新 HEAD（结果文件内记录了生成它的 exact SHA）

---

## 1. 本轮实际完成

### 1.1 A–L 评测运行器（从"只有定义"到"能真跑"）

新增 `evals/stage-2/runner/cli.ts` + `npm run eval:stage2`。运行器：

- 用真实 `CompanionService` + 真实 SQLite（临时库）驱动，经 `sendChat` 走完整轮次；
- 断言只读**序列化后的 Provider 请求**与数据库，不读模型自述；
- Provider 为**脚本化**（返回固定文本），结果文件里标注 `providerMode: "scripted"`，绝不当作真实模型证据；
- 逐场景输出 `PASS / FAIL / SKIPPED / BLOCKED / NOT_RUN`，`passRate` 分母只含 `PASS + FAIL`。

**可执行场景（3 个，全部真实执行）**

| 场景 | 断言 | 结果 |
|---|---|---|
| B 跨会话记忆 | 记忆 id 在同会话请求中投递；新会话仍投递 | PASS 2/2 |
| D 撤回 | 撤回前正对照可投递；撤回后 id 与文本均不出现 | PASS 3/3 |
| I 幂等 | 重复 requestId 只产生 1 条 assistant；返回同一消息；provider 只调 1 次 | PASS 3/3 |

**未执行场景（诚实标注）**：A / C / E / F / G / H / J = `NOT_RUN`（脚本未写），K / L = `BLOCKED`（无凭据 / 渲染沙箱）。

### 1.2 运行器自身的缺陷（记录，不隐藏）

首次运行时 B 与 D 全红，`delivered=0`。排查后确认**不是产品缺陷**，而是运行器的 ID 提取错误：
记忆块是嵌在 system 消息里的 JSON 字符串，引号是转义的（`\"id\":\"...\"`），原正则匹配不到。
修正为「先反转义、再在 `"memories":[` 窗口内匹配」后全部通过。

这意味着：D 的"撤回后不存在"断言在修好之前是**假通过**（因为提取恒为 0）——正对照存在的意义正在于此。

### 1.3 B2 渐进式个性化（本次实现，已进入真实链路）

- 迁移 22：`personalization_state`（有界值）+ `personalization_signals`（逐轮证据，主键 `(dimension, turn_id)`）。
- `src/personalization/personalization-service.ts`：`p' = clip(p + η·w·e, 0, 1)`，`η = 0.05`，单轮每维最多移动 0.05。
- 写入：`onTurnCompleted`（真实轮次完成）；读取：`buildSelfModelContextBlock` → 下一轮 system 提示词。
- 撤回：`forgetTurn` 删该轮信号并重算（回到 0.5，不是"略低于 0.5"）；消息删除由迁移 22 触发器清理。
- 端到端测试证明：第 1 轮写入后**第 1 轮 payload 不含该块**，第 2 轮 payload 含 `Bounded interaction preference state` 与 `exploration=`。

## 2. 命令与退出码（实跑）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run eval:stage2` | 0 | executed 3 / passed 3 / failed 0 / blocked 2 / notRun 7 |
| `npx tsc --noEmit` | 0 | — |

结果文件：`evals/stage-2/results/2026-10-29T09-37-54-2174fa2.json`（+ `-summary.json`，与本报告同属提交 `2174fa2`）
另保留首次运行的 `2026-10-29T09-34-34-55c9aef.json`（其结果 `headSha` 记的是 `55c9aef`，不冒充当前提交的证据）
旧结果文件 `2026-10-29T08-35Z-local-not-run*.json` 保留未覆盖。

## 3. 未完成（阻止交付）

| 项 | 状态 |
|---|---|
| B1 多信号意图置信度 | 未实现 |
| ~~B2 渐进式个性化~~ | **已实现并接线**（见 §1.3） |
| B3 上下文块效用 `U(c)` | 未实现 |
| B4 持久化轮次状态机 | 未实现 |
| B5 反思→下一轮请求端到端 | 仅接线，无 payload 级证据 |
| 消融脚本 | **未实现**（`ablation/README.md` 只有约定） |
| 场景 A/C/E/F/G/H/J | NOT_RUN |
| 真实 Provider S1–S6 | BLOCKED（凭据 absent） |
| Electron / Windows | BLOCKED（渲染沙箱崩） |
| CI | BLOCKED（runner_id=0，重跑 attempt 2 仍无 runner） |

## 4. 结论

**PARTIAL / BLOCKED。**

本轮把"评测不可执行"变成了"3 个场景真实可复算"，这是可验证的进展；
但认知算法本身（B1–B4）一行未写，产品行为未改变，因此不构成阶段二交付。
不建议合并。
