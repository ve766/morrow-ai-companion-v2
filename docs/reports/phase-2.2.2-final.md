# Phase 2.2.2 — 可靠性修复与真实行为补强（最终报告）

## 1. 基线与最终 HEAD

| 项 | 值 |
|---|---|
| 起点 | `430e001`（Phase 2.2.1 交付末，clean） |
| 代码 HEAD | `c9fd65b`（隐私摘要清理） |
| 报告 HEAD | `52d0518` |
| 本报告所在提交 | 仅新增文档 |
| 分支 | `feat/phase-2.2-memory-reliability` |
| PR | [#4](https://github.com/ve766/morrow-ai-companion-v2/pull/4)，base `feat/phase-2-companion-core`（依赖未合并的 PR #3 `e252d06`），OPEN，未合并 |
| schema | v17 → **v18** |
| CI | run [40475647684](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40475647684) @ `94db0ed`；run [40476397474](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40476397474) @ `52d0518`，均 **3/3 success** |

## 2. 提交

| 提交 | 内容 |
|---|---|
| `1e24306` | 主体声明 + 分句级过敏原判定 + 候选身份/证据生命周期/应用状态机（v18） |
| `94db0ed` | 修复后 5 次 clean 长对话运行 |
| `c9fd65b` | 撤回时清理候选摘要 |
| `52d0518` | 七份阶段报告 |

## 3. 每个缺陷的修复

| 缺陷 | 修复 | 测试 |
|---|---|---|
| 候选按哈希全局唯一 | 身份改为 `(hash, kind)`；同句不同 kind 分开 | 迁移 + 服务测试 |
| 敏感度被合并覆盖 | 证据级 source/sensitivity/status；候选只升不降 | `escalates sensitivity…` |
| 来源被无条件覆盖 | 候选来源升级，证据行保留原来源 | `keeps each evidence row attributed` |
| 应用非原子 | 唯一应用行 + `applying/applied/failed/needs_review`；至多一次 | `at most once`、失败、崩溃恢复 |
| 删除后证据仍计入 | 证据 `status='withdrawn'`，重算 distinct | 会话/消息撤回测试 |
| 撤回后摘要残留 | `evidence_excerpt` → `[withdrawn]` | 撤回测试断言 |
| 整句判定假通过 | 分句 + 推荐动词 + 菜品名 + 否认/引用 | 7 条对抗用例 |
| 角色归属错误 | `subject=user` + 固定原则 | 5 次真实运行 |

## 4. 迁移与兼容

- v18 只加列/加表/换索引：`DROP INDEX persona_feedback_evidence_uq` → `(evidence_hash, kind)`。
- 证据表新增 `source`/`sensitivity`/`status`/`withdrawn_at`，默认值保证旧行为。
- 新增 `persona_feedback_applications`。
- 升级测试保留 v16/v17 数据；重复执行迁移安全。
- 回滚代码后 v18 库会被 fail-closed 拒绝打开，需要恢复备份。

## 5. 测试与 CI

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | **54 文件 / 522 用例通过** |
| `evaluate` / `evaluate:cognition` / `evaluate:companion` | 通过 |
| `evaluate:context` / `evaluate:retrieval-context` | 通过 |
| `build` | 通过 |
| CI `40475647684` / `40476397474` | 3/3 success |

## 6. 真实模型

| runId | 代码 | 结果 |
|---|---|---|
| `20261027T084255Z-09b658-r1..r5` | `1e24306` | 角色混淆 **0/5**；召回 4/5；0 过敏原违规；4 uncertain / 1 fail |
| `20261027T080223Z-09b658-r1..r5` | `afa4106` | 角色混淆 **2/5**；召回 3/5；1 pass / 4 fail |
| `20261027T064032Z-2132d7` | `c0d27ca` | 冲突 fail、纠正 fail、2 needs_review |

修复后第 26 轮回复全部为「你对花生严重过敏／你对花生过敏」，不再出现「我对花生过敏」。

## 7. 仍失败 / 未验证

- **冲突披露**：fail（只选一边）。
- **纠正遵循**：fail（反问，未用新值）。
- **过期处理**：`needs_review`，未验证。
- **第 25 轮回避**：修复后不再推荐具体菜品，安全维度只能 `uncertain`。
- **冲突/纠正重复运行**：未做（仅 1 次 clean 运行）。
- **第三方事实归属**：未测。
- **人工复核**：无。
- **消息级删除生产路径**：方法已实现，未接线。

## 8. 删除、撤回与敏感数据结论

- 候选撤回 → 不再可应用；证据撤回 → 不再计入门槛；0 条有效证据 → 候选撤回。
- 会话删除已接线：先撤回证据，再删会话。
- 撤回时摘要被替换为 `[withdrawn]`，不再保留用户原文。
- 证据行仍保留会话/消息 UUID 作为审计引用；未去标识化。
- 已应用候选不因证据撤回而自动回滚，只保留审计与 `needs_review` 应用记录。

## 9. 回滚

```bash
git revert c9fd65b 1e24306   # 代码；v18 数据库需恢复备份
git revert 94db0ed           # 运行记录
```

## 10. 验收结论（分开陈述）

| 维度 | 结论 |
|---|---|
| A 工程可靠性 | **通过**：身份、并发至多一次、失败/恢复、删除重算均有测试 |
| B 系统可靠性 | **通过**：请求声明 `subject=user`，撤回/授权边界成立 |
| C 真实模型行为 | **部分改善**：角色混淆 2/5→0/5；冲突/纠正仍 fail；过期未验证 |
| D 独立复核 | **未完成**：无人工复核 |
| E 人格安全 | **通过**：候选无自动应用路径；应用需显式回调 + 敏感授权 |

**是否建议合并：不建议。** 行为层冲突/纠正仍失败，过期未验证，且无人工复核。工程层可以审查，但不满足合并门槛。

## 11. 下一优先级

用同一数据集把冲突披露与纠正遵循跑到可重复通过（≥5 次），并处理第 25 轮的回避行为；在此之前不扩大自动人格学习。
