# Issue #63 验收矩阵

- 日期：2026-11-07
- 分支：`feat/ai-life-core-upgrade-20261107`
- schema：53
- 状态：PASS / PARTIAL / NOT_IMPLEMENTED / NOT_RUN

| 要求 | 实现/证据 | 状态 |
|---|---|---|
| A 结构化自我模型 | `self_model_states` v53；type/stance/origin/scope/evidence/revision/supersedes/rationale；`self-model-state.test.ts` 5 tests | PASS |
| A 用户偏好不被伪装成 Morrow 偏好 | 提取器固定 `origin=user_explicit`；上下文明确“用户陈述，不是 Morrow 自己的偏好” | PASS |
| A 模型推断不升级为事实 | API 支持 `model_inference/model_proposed_candidate`，低来源可靠度；测试覆盖 unknown 不激活 | PASS（API）/ PARTIAL（运行时仅显式用户来源） |
| A append-only revision | 新行 + 旧行 superseded；同消息幂等；测试覆盖 revision 1→2 | PASS |
| A 自我模型进入下一轮上下文 | `buildSelfModelContextBlock` 注入 active 状态；单测校验 origin/revision/证据数 | PASS |
| B 偏好/价值候选评分 | 公式 `C=0.35E+0.20R+0.20S+0.15K−0.10X`；阈值冻结；5 tests 覆盖 reinforce/revise/conflict/candidate | PASS |
| B 来源分类/证据绑定 | `origin` 六类、`evidenceRefs`、`rationale`；DB 行可查 | PASS |
| C 记忆混合检索 | 既有 4 通道 RRF（fact-index/lexical/fact-slot/value） | PASS（既有） |
| C 神经语义检索 + 三臂消融 | 未实现 | NOT_IMPLEMENTED |
| D 反思闭环 | 既有 reflection runs/findings/hint 注入；未自动写回 self-model | PARTIAL |
| E 探索候选 | 既有 interest-based exploration；统一 Priority 公式未实现 | PARTIAL |
| F 上下文整合 | 新状态经 system context 进入真实请求；token/敏感度沿用既有路径 | PASS（self-model）/ PARTIAL（全量指标） |
| 授权同 scope 复用 | 真实：首条消息弹窗，第二条同 provider/endpoint/model/personal 无弹窗；`consent-grants.test.ts` 3 tests | PASS |
| scope 变化/撤销/过期 | scope 变化 find=null；revoke/25h expiry 测试；删除 profile/清除凭据 revoke provider grants | PASS（服务层） |
| 重启保持授权/状态 | 重启后 grant 仍命中、无弹窗；state 仍 active revision 1 | PASS |
| 真实 Provider | 多条真实对话 committed；最新 turn `162781e3-9c2a-4628-a4f2-0497a9f94208` | PASS（单轮/重启）/ PARTIAL（完整认知指标） |
| 跨会话/跨重启连续性 | state + grant + conversation 保留 | PASS |
| 完整认知评测指标/置信区间 | 仅 focused unit/integration，非完整 12 项 | PARTIAL |
| UI | 本轮未修改 | N/A（按任务暂停） |

## 结论

`PARTIAL`：自我模型结构化状态与 consent scope 复用两个 P0 纵向切片真实运行并通过；记忆神经语义/消融、反思写回、统一探索候选和完整认知评测尚未实现，不能用文档冒充 PASS。
