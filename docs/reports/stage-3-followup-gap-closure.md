# Stage 3 审查整改矩阵（S3-01 ~ S3-05 / A–F / L5·L6·L10·L11）

对应 Issue #20 的两条强制补充审查（2026-10-30T12:41Z、13:02Z、13:38Z）。
基准：开工核验 HEAD `69cb18f23b38f1f07f436e0cc1583ffcd63f4765`。
状态口径：PASS / PARTIAL / BLOCKED / NOT_RUN，**非 PASS 不计入通过率**。

## 一、本轮审查发现

| 编号 | 审查前状态 | 本轮处理 | 修改文件/函数 | 版本 | 测试 ID | 评测 | 结果 |
|---|---|---|---|---|---|---|---|
| **S3-01** Morrow 兴趣未接真实反思生产链 | `observeMorrow()` 存在，但反思候选仍走 `interests.observe()`（用户兴趣） | **未修复** | — | — | — | L5 仍只验证 `observeMorrow()` 直调 | **OPEN（P0）** |
| **S3-02** 探索消融无行为因果 | `no_exploration` 的 `changedCount` 曾为 0（断言是条件式） | **已修复**：两条许可断言改为必须存在 `permitted` | `evals/stage-3/runner/harness.ts` L5 | harness v4 | — | 消融 `no_exploration → L5` | **PASS** |
| **S3-03** 人格证据门禁与同轮冲突 | 无显式不确定性门禁；`seen` 去重吞掉同轮相反证据 | **已修复**：净证据聚合 + 三重门禁 + 非断言语气 abstain | `personality-growth.ts` `deriveGrowthSignals` | `growth.v2` | `personality-growth.test.ts`（23） | L4 | **PASS** |
| **S3-04** 每日预算并发超额 | 读-判-写非原子，两会话可同抢最后名额 | **已修复**：事务内预留表 | `exploration-policy.ts` `reserve/consume/release`、迁移 33 | `x1.budget.v1` | `exploration-policy.test.ts`（19） | 纵向 / L5 | **PASS** |
| **S3-05** 登记表新旧规则冲突 | 追加 G1′/X1′ 段落，形成双重真相 | **已修复**：删除追加段，规则内联到唯一章节；旧规则标 deprecated | `docs/algorithms/stage-3-algorithm-registry.md` | — | — | — | **PASS** |

### S3-03 细节（本轮唯一改动的算法语义）

```
net_d  = clip( Σ polarity·strength , −1, +1 )
weight = confidenceScore / 100
abstain if intent='uncertain' ∨ confidence<50 ∨ (uncertainty='high' ∧ confidence<65)
abstain if 引述（stripQuotedAndReportedText 后为空） ∨ 非断言语气（如果/假如/扮演/假装…）
```

同轮"直接说，但别太冲" → `+0.8 −0.8 = 0` → 不产生证据（旧实现会产生一条正向证据）。

### S3-04 细节

```
BEGIN IMMEDIATE
  if (scope, day, turn_id) exists → 返回既有状态（幂等）
  used = COUNT(state ∈ {reserved, consumed})     ← 预留也占名额
  state = used ≥ MAX_PER_DAY ? 'denied' : 'reserved'
COMMIT
```

`reserved → consumed`（真实提出）/ `released`（未提出、Provider 失败、用户拒绝）。`day` 来自注入时钟的 UTC 日期。日预算与滚动 24 小时窗口是两个独立限制，均需通过。

## 二、原任务 A–F

| 项 | 状态 | 证据 / 缺口 |
|---|---|---|
| A 记忆重要度/衰减/合并 | **PARTIAL** | M1 已实现（迁移 31、11 测试、L16）；**冲突分类未做**（只保留既有 conflict 标记） |
| B 内在状态 appraisal/调节 | **NOT_RUN** | 沿用既有 `cognitive-feeling-engine`，未重构 appraisal，未做 affect 消融 |
| C 反思候选与质量评测 | **PARTIAL** | findings 可追溯、限频去重可用；**质量指标（证据支持度/重复率/撤回率）未实现**；S3-01 未解 |
| D 长期目标闭环 | **PASS（本机）** | D1 `CompanionGoalService`（迁移 32、10 测试、L10 六断言）；`GoalService` 保持 Agent 侧 |
| E 真实自主探索闭环 | **PARTIAL** | 状态机 + 原子预算 + 词面检测已实现；**语义级提及检测未实现**（`detectRaised` 仍是词面匹配） |
| F 语音闭环 | **NOT_RUN** | 未实现 ASR/TTS adapter 与 UI 状态机 |

## 三、评测项

| 项 | 状态 | 说明 |
|---|---|---|
| L5 | **PASS（客观）** | 六条断言，含用户兴趣不可被提出、回复未提及不计、Provider 失败不计；模型层行为 **BLOCKED** |
| L6 | **PASS（客观）/ BLOCKED（行为）** | 只验证原则在 payload 且未被迎合要求改写；四类证据对照的真实模型评分未运行 |
| L10 | **PASS** | 三类归属、优先级、过期、完成即退出、状态可查 |
| L11 | **PASS** | 同一 DB 文件重建整个运行时；另有 `restart` 套件 6 断言 |
| 长对话 | **PASS** | 30 轮 / 3 会话，7 断言 |
| 纵向 | **PASS（注入时钟）** | 结果文件写 `clock: injected` 与 `realElapsedMs`，不宣称真实多日 |

## 四、仍未完成（不得计入通过）

1. **S3-01**（P0）：Morrow 兴趣的反思生产链。
2. **§2A 冲突分类**：事实冲突/偏好变化/时间变化/情境差异未分类建模。
3. **§2B**：appraisal 重构与 affect 消融。
4. **§2C**：反思质量指标。
5. **§2F**：语音闭环。
6. **语义级提出检测**：`detectRaised` 仍是词面匹配，改写式提出会漏判为 `not_raised`。
7. **真实 Provider / Electron renderer / Windows 安装升级 / CI**：BLOCKED（缺凭据、缺干净机器、账号侧 runner 未执行）。

## 五、结论

本轮把 S3-02 ~ S3-05 四条审查项落到代码与文档，S3-01 未修。

按补充审查的完成定义，只要 S3-01、§2B、§2C、§2F 任一未实现，整体只能 **PARTIAL**，不得建议合并 PR #19。
