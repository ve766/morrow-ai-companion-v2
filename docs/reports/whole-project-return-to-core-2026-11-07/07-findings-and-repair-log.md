# 07 · Findings 与修复日志

| ID | 级别 | 发现 | 根因 | 修复/状态 | 证据 |
|---|---|---|---|---|---|
| F65-01 | P0 | 问“你叫什么”，Morrow 回答“我是讯飞星火大模型” | 最终 system context 缺应用级身份契约；Provider 默认自我介绍可直达输出 | 新增 `identityContract(provider)` 并置顶 system；真实 Provider 复测通过 | `src/app/companion-service.ts`；`results/identity-behavior-evaluation.json` |
| F65-02 | P0 | 问“你和讯飞星火关系”被反问、不回答 | 契约没有关系问题/不得反问规则 | 增加 direct answer 规则；真实复测回答“讯飞星火不是我的身份，是服务方” | 同上 |
| F65-03 | P0 | 问“为什么叫 Morrow”回答“名字是用户起的” | 无证据时编造命名来源 | 契约要求“没有命名来源证据就说不知道，不得说用户命名” | 真实复测“没有关于命名由来的证据，不清楚确切起源” |
| F65-04 | P0 | acceptance DB 已迁移到 v53，权威基线代码只有 v52，启动 fail-closed | PR #64 未合并但用户数据已升级 | 仅移植 v53 schema（不合并 PR #64 业务代码）；app 正常启动 | `migrations.ts` v53；真实启动 |
| F65-05 | P1 | 全仓 1348 文件无法在 24h 内逐行人工审阅 | 范围过大 | 生成 100% inventory + 自动静态扫描；P0 文件人工审阅；其余标记 AUTOMATED_REVIEWED | `02-complete-file-inventory.csv`、`results/audit-coverage.json` |
| F65-06 | P1 | PR #64 sensitive scope 可能 24h 复用，与“敏感仅本次”文案冲突 | scope 未区分敏感策略 | 本任务未合并 PR #64；列为独立修复项 | `09-security-data-lifecycle-review.md` |
| F65-07 | P1 | 反思 findings 不写回 self-model | 缺 evidence-gated revision 链路 | NOT_IMPLEMENTED | `06-algorithm-gap-and-upgrade-plan.md` |
| F65-08 | P1 | 无语义 embedding/三臂消融 | 无本地 embedding 服务 | NOT_IMPLEMENTED；保留 4 通道 RRF | `results/retrieval-ablation.json` |
| F65-09 | P2 | PR #64 的 self-model 公式用 evidenceRefs.length 同时近似质量/重复 | 设计简化 | 已在 PR #64 评审中标记；本任务不合并 | PR #64 评论 |

## 修复提交

- 身份契约与 v53 兼容迁移：本任务 commit（最终 SHA 见 PR）。
- 未修改 UI/CSS/布局。
