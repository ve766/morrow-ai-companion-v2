# Stage 2 当前最终交付报告（面向项目负责人）

| 项 | 值 |
|---|---|
| 报告版本 | 2026-10-30T06:10Z 起（本文件是**唯一当前版本**；`stage-2-final-delivery.md` 为历史快照） |
| 分支 / PR | `feat/stage-2-delivery-hardening` / [#15](https://github.com/ve766/morrow-ai-companion-v2/pull/15)（OPEN，未合并） |
| 审计 HEAD | `42a51e075af8a8ce9628c87490c37df8c92b7580` |
| 审计报告 | [`docs/audit/stage-2-final-delivery-audit.md`](../audit/stage-2-final-delivery-audit.md) |
| 证据索引 | [`docs/reports/stage-2-evidence-index.md`](stage-2-evidence-index.md) |
| 状态 | **PARTIAL — 阶段二尚未完成** |

---

## 1. 实际交付了什么

| 能力 | 一句话 | 证据 |
|---|---|---|
| 记忆撤回/删除/纠正 → 兴趣证据失效 | 记忆不再有效时，从它的证据在**同一事务**里删除；兴趣降级或删除；下一轮请求里不再出现 | 迁移 25 + `interest-invalidation.test.ts`（9 条）+ `interest-payload-invalidation.integration.test.ts`（2 条，读最终 payload） |
| 兴趣反转改变状态 | "我不喜欢了"立即把 `active` 降为 `candidate`；"又喜欢了"能重新晋升；删掉反证来源会重算 | `interest-service.ts` 折叠规则 + 4 条用例 + payload 级 |
| 反思 → 下一轮上下文 | 反思发现的长期主题在跨会话满足门槛后，带上 id 进入下一轮请求 | 场景 B5（5 条断言） |
| 主题同一性匹配 | 同一主题的不同说法会聚合，不同主题不误合并 | `topic-identity.ts` + 12 条单测 + 26 对开发集（P 1.000 / R 0.889） |
| B2 人格稳定 | 情绪表达与反馈轮次不改写人格 | 场景 E（4 条）+ 13 条单测 |
| B3 上下文效用 | 记忆排序按 `U(c)`；偏好/冲突/陈旧三个分量都接线 | 7 条装配器测试（含 3 条排序断言）+ `personalizationFit` 2 条 |
| B4 轮次状态机 | 一轮的生命周期 9 个状态都有真实写入点 | 3 条集成测试（7 步序列、失败止于 `failed`、`recovery_required` 入边） |
| 评测与消融 | 12 个可执行场景全过；四组消融真跑 | `results/…42a51e0.json`、`ablation/results/…42a51e0.json` |
| 真实模型 | `spark-x2.6` 下 S1/S2/S3/S5/S6 全过（13/13 客观断言） | `evals/stage-2/provider/phase24-real-model-26aeac7.json` |
| 桌面 | Electron 默认沙箱 smoke 通过 | `results/verify-42a51e0-061042.txt` |

## 2. 当前可用边界（别读过头）

- **评测是脚本化 Provider**：12 场景证明"接线与载荷正确"，**不证明模型质量**。
- **真实模型每场景只跑 1 次**：证明行为发生，**不是成功率**；S4 只有一个模型，**SKIPPED，不是 6/6**。
- **26 对是开发集**：P 1.000 不代表可泛化。
- **B3 的 `P` 是窄映射**：只有明确提到"详细/简短/节奏/多给几个"这类词的记忆才加分。
- **`no_reflection` 臂未见 payload 差异**：不能据此说反思提升质量，也不能说反思无用。
- **Windows 57/57 是 schema 测试**，不是安装器升级。

## 3. 需要你决策或提供的（3 项）

| # | 事项 | 现状 | 需要你做什么 |
|---|---|---|---|
| 1 | **B1 意图置信度** | 分数已算但未接线。实测它是三级序数信号（0.512 / 0.780–0.799 / 0.819–0.947，同档内差 ≤0.019），三次接线尝试全部实测回退 | 二选一：①给标注数据（几十条"这句该不该追问"即可），我重定分量并重标定；②批准把 B1 移出阶段二范围 |
| 2 | **CI** | 三个 job `runner_id=0`/`steps=0`，注解为账号付款失败或额度不足 | 恢复账单/额度；恢复后我重跑并附 steps/logs |
| 3 | **Windows 安装器升级** | 未验证；schema 测试不能替代 | 授权在干净机器上跑一次：装旧版 → 覆盖装新版 → 启动 → 数据保留 |

## 4. 是否可称阶段二完成

**否。** 状态为 PARTIAL。

已完成的都有可复核证据；未完成的**不是**"再多写点代码"能解决的：B1 需要产品裁决，CI 需要账单，安装器需要授权机器。在这个前提下宣称 COMPLETE 会失真。

**也不建议现在合并 PR #15**：B1 属于阶段二范围且未完成，CI 从未真正执行，安装器升级未验证。

## 5. 证据入口

- 逐项状态、口径冲突修复、剩余风险：[最终审计报告](../audit/stage-2-final-delivery-audit.md)
- 能力 → 源码 → 测试 → 结果 → SHA：[证据索引](stage-2-evidence-index.md)
- 算法规则与接线现状：[算法登记表](../algorithms/stage-2-algorithm-registry.md)
- 本次验证的完整命令日志：[`evals/stage-2/results/verify-42a51e0-061042.txt`](../../evals/stage-2/results/verify-42a51e0-061042.txt)
- 真实 Provider 原始报告：[`evals/stage-2/provider/`](../../evals/stage-2/provider/)
