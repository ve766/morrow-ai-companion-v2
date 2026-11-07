# Issue #63 证据索引

- 分支：`feat/ai-life-core-upgrade-20261107`
- 基线：`e1d85137b64f4e6d65750a11eb27757135c1f32b`
- Schema：53
- 安装 asar：`a8dc31e324100005ac18297d19affd2a18f0d7af239a9e5c9ecb55f256434d8e`
- 最终 commit：见 PR/Issue #63

## 代码证据

| 机制 | 文件 | 测试 |
|---|---|---|
| 结构化自我模型 | `src/self-model/self-model-state.ts` | `src/self-model/self-model-state.test.ts`（7） |
| 自我模型上下文 | `src/app/companion-service.ts` `buildSelfModelContextBlock` | 同上 |
| post-turn 写入 | `buildCognitiveProjectors` `self_fact` | 同上（projector 调用） |
| 持久授权 | `src/providers/consent-grants.ts` | `src/providers/consent-grants.test.ts`（3） |
| 授权复用接入 | `src/app/index.ts` `requestProviderConsent` | 真实运行 + `consent-scope-e2e.json` |
| 删除/清凭据撤销 | `src/app/companion-service.ts` `deleteProfile/clearProviderCredential` | 服务层 |
| 迁移 | `src/persistence/migrations.ts` v53 | `migrations.test.ts`（53 断言） |

## 真实运行证据

- 首条显式偏好：turn `9285cf8c-ad74-4324-aa6b-b61484725986`（弹窗一次，approved）。
- 同 scope 第二条：turn `3efd063c-ea8c-43d9-ab10-50b6bd18e425`（无弹窗，grant hit）。
- 重启后：turn `162781e3-9c2a-4628-a4f2-0497a9f94208`（无弹窗，状态和授权保留）。
- 自我模型状态：`f2b72392-9bfe-4ca9-a1b9-bd95e3ba91cf`，preference/user_explicit/active/revision 1。
- grant fingerprint：`d78e07e41a0d79429c5de180e48d2f2f1cf6aff49c48af2e2935977e88eb3225`。

## 机器结果

- `results/verification-summary.json`
- `results/cognition-evaluation.json`（PARTIAL；未跑完整 12 指标）
- `results/ablation-comparison.json`（NOT_IMPLEMENTED）
- `results/live-provider-continuity.json`
- `results/consent-scope-e2e.json`

## 未完成

- 神经语义检索与 lexical/semantic/hybrid 三臂消融；
- reflection findings → self-model 自动 revision；
- 统一探索候选 Priority 公式与完整 12 指标评测；
- UI（本轮按任务暂停）。
