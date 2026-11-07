# Issue #63 最终交付报告

- 仓库：`E:/Hasee/Documents/morrow v2/zcode/stage3-audit/repo`
- 分支：`feat/ai-life-core-upgrade-20261107`
- 基线：`e1d85137b64f4e6d65750a11eb27757135c1f32b`
- Schema：53
- 安装 asar：`a8dc31e324100005ac18297d19affd2a18f0d7af239a9e5c9ecb55f256434d8e`
- 最终状态：**PARTIAL**

## 1. 交付摘要

| 线 | 状态 | 证据 |
|---|---|---|
| 结构化自我模型 | PASS | `self_model_states` v53；7 tests；真实状态 `f2b72392...` |
| 偏好/价值更新算法 | PASS（显式来源）/ PARTIAL（模型推断运行时） | 公式、阈值、reinforce/weaken/revise/conflict/reject tests |
| 自我模型进入上下文 | PASS | `buildSelfModelContextBlock` + 单测 |
| 持久授权 scope 复用 | PASS | 真实首条弹窗、第二条无弹窗；重启后仍复用 |
| 授权 scope 变化/撤销/过期 | PASS（服务层） | `consent-grants.test.ts` 3 tests；删除 profile/清凭据撤销 |
| 跨重启连续性 | PASS | state + grant + conversation 保留 |
| 记忆混合检索 | PASS（既有 4 通道 RRF） | 未改造；无神经语义 |
| 神经语义检索 + 消融 | NOT_IMPLEMENTED | `ablation-comparison.json` |
| 反思 findings → self-model 写回 | NOT_IMPLEMENTED | 既有 hint 注入保留 |
| 统一探索候选 Priority | PARTIAL | 既有 interest 探索保留 |
| 完整 12 指标认知评测 | PARTIAL/NOT_RUN | `cognition-evaluation.json` |
| UI | 未修改 | 按 Issue #63 要求暂停 |

## 2. 算法与实现

- 新表 `self_model_states`：type/stance/confidence/evidenceRefs/origin/scope/revision/supersedes/status/rationale/sourceMessageId。
- 公式：`C = 0.35E + 0.20R + 0.20S + 0.15K − 0.10X`，阈值 0.55/0.40/0.62，证据门槛 0.80；权重与阈值固定并由测试覆盖。
- 更新：activate/reinforce/weaken/revise/conflict_pending/candidate/reject；append-only，旧行 superseded；同 source message 幂等。
- 来源：`user_explicit` 等六类；用户陈述在上下文中明确不是 Morrow 自己的偏好。
- 授权 scope：`sha256(action + providerId + endpoint + model + maximumSensitivity)`，不含 key/正文/payload；普通 chat 24h grant，scope 变化/撤销/过期重新确认。`ProviderConsent` 仍短 TTL 且校验当前 payload hash。

## 3. 验证结果

```text
typecheck: PASS
npm test: 139 files / 1200 tests PASS (0 failed / 0 skipped)
build: PASS
focused self-model state: 7 passed
focused consent grants: 3 passed
migrations/provider: 52 passed
```

真实 Provider（本机，凭据未入库）：

- 首条偏好消息 `9285cf8c...`：弹窗一次，committed；
- 同 scope 第二条 `3efd063c...`：无弹窗，grant hit，committed；
- 重启后 `162781e3...`：无弹窗，committed；
- 状态 `f2b72392-9bfe-4ca9-a1b9-bd95e3ba91cf`：preference/user_explicit/active/revision 1；
- grant `d78e07e41a0d79429c5de180e48d2f2f1cf6aff49c48af2e2935977e88eb3225` 重启后仍有效。

## 4. 未完成与下一步

1. **神经语义检索/三臂消融**：需要本地 embedding 提供方或标注转述集；预先冻结 recall@k/precision@k/遗漏率/冲突误合并阈值。
2. **反思 → self-model 自动修订**：需要把 finding 证据映射为 candidate，并经证据门控写入 revision。
3. **统一探索候选**：实现 Interest × InformationGain × Relevance × Feasibility × UncertaintyNeed − RiskPenalty，并接入 pending。
4. **完整认知评测**：12 指标、样本量、失败案例、置信区间、盲评；本轮只有 focused tests。
5. **模型推断来源的真实生成**：本轮运行时只从显式用户陈述提取；`model_inference` 路径有 API/测试但未由真实 Provider 生成。
6. **UI 授权撤销控件**：本轮 UI 暂停；撤销通过后端 service + profile 删除/凭据清除生效。

## 5. 边界

- 未修改 UI、CSS、主题、布局。
- 未清空/覆盖现有用户数据；迁移 v53 前向追加；未导入 V1。
- 未新增 Agent、文件、shell、网络执行能力。
- 未把 mock/结构/文档当作真实 Provider 或完整认知评测 PASS。
- 总体 PARTIAL：两个 P0 纵向切片真实运行；其余要求明确未完成，不能宣称完整 DoD。
