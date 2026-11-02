# Morrow Agent 研究决策记录 v1.0

> 类型：ADR 汇总（研究阶段）；待用户确认，不授权运行时代码开发。

## ADR-001：Agent Runtime 归 Morrow 自己所有
建议建立 Morrow 原生 Agent Runtime，不将 Morrow 包装成外部 Agent 框架前端。原因：TypeScript/Electron/SQLite 技术栈；人格、记忆、情绪、价值观和身份必须留在 Companion Kernel；Agent 必须服从 Morrow 的权限治理。

## ADR-002：先做单 Agent + 能力注册表
第一代只有一个 Morrow 身份、一个任务协调器和多个确定性能力执行器。当前没有证据证明多 Agent 会改善用户价值；多 Agent 会增加身份、权限、状态同步、冲突和审计复杂度。

## ADR-003：模型只能提出 ActionProposal
所有工具调用先形成结构化 proposal，经 schema、policy、approval、executor、verifier 固定管线。禁止从模型文本直接解析 shell 并执行；模型说“已完成”不是执行证据。

## ADR-004：权限与审批是服务端确定性机制
审批由主进程保存，绑定 task、plan version、step、capability、参数 digest、目标 digest、scope 和 expiresAt。前端提交的批准布尔值不构成授权边界。

## ADR-005：先文件创建，不先 shell/browser
第一种真实能力只考虑工作区内 list/read/create。新文件 exclusive create、路径限制、逐次确认、hash read-back。初版不开放 update/delete/shell/network。

## ADR-006：SQLite 是任务状态唯一真相
复用当前 SQLite、migration、transaction、outbox 和 lease/fencing；不引入第二数据库或独立 Python Agent Server，避免两套状态源。

## ADR-007：动作必须验证后置条件
工具执行结果经过独立 verifier；只有验证成功才向用户报告完成。文件创建至少读回并比对 SHA-256 和字节数。

## ADR-008：Agent 不得直接修改人格或长期记忆
Agent 计划与执行结果只作为有来源的事件返回 Companion Kernel；是否进入长期记忆必须经过现有证据、确认、撤回和治理规则。

## ADR-009：分阶段交付，每阶段最多 24 小时
- A0 研究架构冻结；
- A1 durable task state；
- A2 action proposal/policy/approval；
- A3 workspace/file create；
- A4 bounded planning/verification；
- A5 每项扩展能力单独评审。
每阶段单独分支和 PR，先审查再进入下一阶段。

## ADR-010：当前阶段不启动 Agent 实现
PR #35 仍是 Release Candidate；Issue #37 Stage 4 仍 OPEN；Stage 5 人工验收门槛尚未全部关闭。研究分支与产品修复分离。用户确认研究设计、且产品交付状态允许后，再决定启动 A1。
