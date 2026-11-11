# Stage 3 最终验收（修复轮）

- 对象：`feat/stage-3-long-term-companion` 修复轮 HEAD（完整 SHA 见 PR #19 / 证据索引）。
- 性质：修复方自报验收；独立审计的复核待维护者安排。状态口径 PASS/PARTIAL/FAIL/BLOCKED/NOT_RUN，非 PASS 不计入通过率。

## 门槛矩阵

| Gate | 状态 | 证据 |
|---|---|---|
| G1 人格成长 | PASS（机制） | outbox 写 G1、effectiveProfile 消费、prompt 分层、门槛/衰减/上限/回滚/重启——集成+单元+主套件 L4；G2 不再冒充 G1 |
| G2 用户适配 | PASS | 独立账本独立 prompt 行，`admitConflictingEvidence` 语义不涉价值观 |
| 记忆 | PASS（检索层）/ PARTIAL（模型使用层） | 10 场景复述回归 recall@1=1.0；live 重跑的逐轮 use trace 供人工复核（PENDING）；无标记价值断言的召回为记录在案的边界 |
| L6/F7 | PASS（scripted 八类矩阵）/ 真实模型逐场景见 live 附件 | 主套件 L6（16 断言）；"prompt 字符串断言"已删除 |
| 反思 | PASS（机制） | 7 类路由 + 自动/手动同径 + pending 决策 UI/IPC + ≤2 hints + 痕迹 |
| 探索 | PASS | 死状态诚实移除，CHECK 同步，无不可达声明 |
| 巩固 | PASS | 调度器（catch-up/绝对时间门/互斥/重试/stop）+4 测试；保护语义留在 archiveBelow |
| 评测证据 | PASS | 全部新结果绑定完整 SHA；unknown 旧文件不再被引用 |
| CI | PASS（推送后以 run 为准） | Stage 3 七套件为必需步骤 |
| 工程 | PASS | typecheck 0 / vitest 全量 / build 0 / smoke: CI 双平台为准（本机环境 BLOCKED） |
| 真实模型 | 见结果文件 | spark-x2.6 live（32 轮/3 会话）+ semantic（6/8 轮）于修复后 SHA 运行；摘要见交付回复 |
| 真人复核 | **PENDING** | 复核包已生成；AI 不冒充真人 |
| 语音 | NOT_IMPLEMENTED | 按任务约束留独立阶段 |
| Windows | NOT_RUN | 无干净授权机器 |

## 运行命令

见 [stage-3-remediation-evidence-index.md](../audit/stage-3-remediation-evidence-index.md) §3（逐命令退出码）。

## 结论

- 工程、机制、评测有效性门槛：达到。
- 真实互动质量：scripted 全过 + 真实模型已在新 SHA 运行并留痕，**人工复核 PENDING** —— 按任务 §11，"真实模型未运行/真人复核未完成" 时真实互动 Gate 不得标 PASS，Stage 3 整体不得自行宣称完成；本报告如实停在 **PARTIAL(待真人复核)**，由维护者依据独立证据决定。
