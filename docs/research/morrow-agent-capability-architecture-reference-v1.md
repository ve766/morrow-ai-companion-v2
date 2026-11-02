# Morrow 原生 Agent 能力架构参考 v1.0

> 状态：研究设计基线；非运行时代码、非集成批准。
> 基线：release/morrow-v2-final-delivery @ 3812b185398c0442fcc0d0ba5b180713cafee1d9
> 对应状态：PR #35 仍为 Release Candidate；Stage 4 Issue #37 仍 OPEN；Stage 5 人工门槛未全部关闭；Agent Stage 6 尚未启动。

## 1. 结论

Morrow 应建设自己的 TypeScript 原生 Agent Capability Runtime，而不是成为 OpenHands、LangGraph、CrewAI、AutoGen 或 Microsoft Agent Framework 的包装器。

建议结构：Morrow Companion Kernel + Action Proposal + Policy Gate + Durable Orchestrator + Capability Registry + Sandboxed Workspace + Verification + SQLite Journal。

- Companion Kernel 决定 Morrow 如何理解、表达、记忆、形成偏好和价值判断。
- Agent Runtime 只把经 Companion Kernel 形成、且经权限系统批准的行动意图转成受控行动。
- Provider 只负责模型推理传输；更换 Provider 不得改变 Morrow 的身份、人格、记忆、情绪状态和授权边界。
- 模型只能提出结构化行动提案，不能直接获得文件系统、shell、网络或数据库访问权。
- 每次行动必须有来源、目标、权限、审批、执行记录、结果验证和恢复路径。

**技术选择：学习框架设计，不把 Python/.NET Agent 框架作为 Morrow 核心运行时依赖。** Morrow 当前是 TypeScript/Electron + SQLite；引入第二运行时会增加打包、IPC、安全和故障恢复成本。

## 2. Morrow 当前架构可复用基础

当前 release 分支的运行时映射表明，一轮对话已有 sendChat → drainCognition → prepare → memory retrieval/operation → relationship continuity → feeling state/expression policy → prompt assembly → consent → Provider → factual guard → persistence/outbox 主链。

可复用的生产基础：
- SQLite 事务、迁移、备份与恢复；
- outbox/effect ledger、lease、generation fencing、重试退避；
- 记忆检索的权限/状态过滤与多通道融合；
- 记忆操作的事务内验证、失败回滚；
- goal owner 的 user/shared/morrow 区分和含糊目标候选；
- Electron main/preload/renderer IPC 边界。

参考入口：
- docs/architecture/final-product-runtime-map.md
- docs/algorithms/final-product-algorithm-index.md
- src/app/effect-ledger.ts
- src/app/cognitive-outbox.ts
- src/motivation/companion-goal.ts
- src/cognition/reflection-routing.ts
- src/memory/memory-context-assembler.ts
- src/personalization/
- src/affective-state/expression-policy.ts

禁止复制出第二套人格、记忆、目标或状态真相。Agent 只能通过正式服务接口读取窄化上下文。

## 3. 开源项目比较

| 项目 | 值得吸收 | Morrow 采用方式 | 不直接照搬 |
|---|---|---|---|
| OpenHands Software Agent SDK | Agent step loop、Action/Observation/Executor、事件流、Conversation 生命周期、Workspace | 参考执行循环、事件模型、工作区隔离、执行后观察验证 | Python SDK 整体、Agent Server、terminal/shell 默认能力 |
| LangGraph | 显式状态图、checkpoint、interrupt、resume、durable execution | 参考状态机、持久化快照、暂停恢复 | Python 图引擎、LangChain 依赖链、第二状态源 |
| PydanticAI | 类型安全工具 schema、参数校验、ApprovalRequired、DeferredToolRequests/Results | 参考结构化工具契约、调用前校验、审批暂停恢复 | Python Agent 对象；不能把客户端审批当作完整授权 |
| CrewAI | Flow 的事件驱动确定性编排 | 只参考 Flow，未来按需研究 | Crew 角色扮演、多 Agent 默认协作 |
| Microsoft Agent Framework | Workflow、middleware、checkpoint、HITL、OpenTelemetry | 参考生产治理、可观测性和恢复 | .NET/Python 双栈整体依赖 |
| AutoGen | 事件驱动 Agent、消息传递的历史模式 | 只作历史架构阅读 | 不作为生产依赖；官方仓库已标记归档/不再积极维护 |

复用分级：
- 可借鉴思想：Action/Observation、显式状态机、checkpoint、interrupt/resume、工具 schema、审批延迟、工作区抽象、结构化事件。
- 需要按 Morrow 语义重写：计划生成、权限决策、工具注册、文件操作、事件账本、重试、验证、取消与恢复。
- 禁止直接移植：默认 system prompt/人格/memory、自动工具授权、无限循环、任意 shell、浏览器自动化、后台自主运行、多 Agent 自主协商。
- 复制具体源代码前必须锁定 commit，核对 LICENSE/NOTICE/子目录许可和依赖 SBOM。

## 4. 目标架构

~~~
┌───────────────────────────────────────────────────────────┐
│ Morrow Companion Kernel                                   │
│ Dialogue · Personality · Memory · Affect · Values · Goals │
└──────────────────────────┬────────────────────────────────┘
                           │ narrow typed context
                           ▼
┌───────────────────────────────────────────────────────────┐
│ Action Proposal / Intent                                  │
│ intent → clarify → plan proposal → preconditions          │
│ no side effects                                            │
└──────────────────────────┬────────────────────────────────┘
                           ▼
┌───────────────────────────────────────────────────────────┐
│ Policy & Authorization                                    │
│ identity · consent · scope · risk · expiry · revocation   │
│ deny-by-default                                            │
└──────────────────────────┬────────────────────────────────┘
                           ▼
┌───────────────────────────────────────────────────────────┐
│ Durable Agent Orchestrator                                │
│ task state · checkpoint · cancellation · retry · recovery│
└──────────────────────────┬────────────────────────────────┘
                           ▼
┌───────────────────────────────────────────────────────────┐
│ Capability Registry                                       │
│ schema · risk · permissions · executor · verifier         │
└──────────────────────────┬────────────────────────────────┘
                           ▼
┌───────────────────────────────────────────────────────────┐
│ Sandboxed Workspace / Executors                           │
│ canonical path guard · root allowlist · atomic writes      │
└──────────────────────────┬────────────────────────────────┘
                           ▼
┌───────────────────────────────────────────────────────────┐
│ Observation · Verification · Journal                      │
│ postconditions · artifact refs · audit · rollback         │
└───────────────────────────────────────────────────────────┘
~~~

建议模块目录（需在实施时与当前仓库风格对齐）：
- src/agent/domain：任务、计划、步骤、动作和结果类型；
- src/agent/intent：对话意图到行动提案，只产出 proposal；
- src/agent/planning：计划分解、依赖图、预算和前置条件；
- src/agent/policy：权限策略、风险、审批、撤销；
- src/agent/capabilities：工具注册表与能力契约；
- src/agent/execution：状态机、调度、取消、恢复；
- src/agent/workspace：受限文件工作区；
- src/agent/verification：后置条件和产物验证；
- src/agent/persistence：SQLite repository、checkpoint、journal；
- src/agent/audit：最小化审计与敏感字段过滤；
- src/agent/ipc：经 schema 校验的 main/preload/renderer 接口。

## 5. 核心数据结构草案

~~~ts
type ActionProposal = {
  proposalId: string
  conversationId: string
  sourceTurnId: string
  sourceMessageIds: string[]
  requestedBy: 'user' | 'morrow'
  intent: string
  summary: string
  plan: PlanStep[]
  requiredCapabilities: string[]
  assumptions: string[]
  unresolvedQuestions: string[]
  risk: RiskAssessment
  createdAt: string
  expiresAt: string
  contentHash: string
}

type CapabilityDescriptor<I, O> = {
  id: string
  version: number
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  riskClass: 'read' | 'reversible_write' | 'destructive' | 'external_effect'
  requiredScopes: string[]
  supportsDryRun: boolean
  supportsIdempotency: boolean
  timeoutMs: number
  maxOutputBytes: number
  execute(input: I, ctx: ExecutionContext): Promise<O>
  verify?(input: I, output: O, ctx: ExecutionContext): Promise<VerificationResult>
  compensate?(input: I, output: O, ctx: ExecutionContext): Promise<CompensationResult>
}

type PlanStep = {
  stepId: string
  capabilityId: string
  input: unknown
  dependsOn: string[]
  preconditions: string[]
  expectedPostconditions: string[]
  approvalRequirement: 'none' | 'per_step' | 'whole_plan'
  idempotencyKey: string
  state: StepState
}

type StepState =
  | 'proposed' | 'awaiting_approval' | 'approved'
  | 'running' | 'verifying' | 'succeeded'
  | 'failed' | 'cancelled' | 'expired'
  | 'compensation_required' | 'compensated'

type ApprovalGrant = {
  approvalId: string
  proposalId: string
  taskId: string
  stepIds: string[]
  capabilityIds: string[]
  targetDigest: string
  inputDigest: string
  scope: string[]
  approvedBy: 'user'
  approvedAt: string
  expiresAt: string
  consumedAt?: string
  revokedAt?: string
}
~~~

审批必须绑定具体 planVersion、step、capability、参数 digest、目标 digest、scope 和过期时间。计划或参数发生实质变化时，旧 grant 失效并重新确认。

## 6. 状态机与执行协议

~~~
proposed
  ├─ clarification_required → proposed (new plan version)
  ├─ denied → cancelled
  └─ awaiting_approval
        ├─ rejected / expired / revoked → cancelled
        └─ approved → running
              ├─ cancellation → cancelled (after executor cleanup)
              ├─ retryable failure → running (bounded retry)
              ├─ terminal failure → failed
              └─ all steps done → verifying
                    ├─ verification failed → failed / compensation_required
                    └─ verified → succeeded
~~~

必须满足：
1. 所有状态变化通过单一状态服务执行；Renderer 不直接更新 DB。
2. 状态变更使用 compare-and-swap：UPDATE ... WHERE id=? AND state=? AND version=?。
3. approved 不是永久授权；执行前重新检查 grant 未过期、未撤销、digest 匹配。
4. running 持有 lease/fencing generation；旧 worker 不得在租约被接管后提交结果。
5. 取消必须向底层 executor 传播；清理完成前不得报告停止。
6. 只有 verifier 确认后置条件，才能标记 succeeded。
7. 不支持安全补偿的副作用不得假装可回滚。

执行主循环：

~~~ts
async function runTask(taskId: string): Promise<TaskOutcome> {
  const task = await repository.load(taskId)
  assertTaskNotExpired(task)

  const step = await planner.nextReadyStep(task)
  if (!step) return verifier.verifyWholeTask(task)

  const descriptor = registry.require(step.capabilityId)
  const input = descriptor.inputSchema.parse(step.input)

  const decision = await policyEngine.evaluate({
    task, step, descriptor, input,
    userPolicy: await policyStore.read(),
    context: await companionContext.readNarrow()
  })

  if (decision.effect === 'deny') return failClosed(task, decision.reason)
  if (decision.effect === 'require_approval') {
    await checkpointAndPause(task, step, decision)
    return { state: 'awaiting_approval' }
  }

  await revalidateGrantAndPreconditions(task, step, descriptor, input)
  const claim = await ledger.claim(step.idempotencyKey)
  if (!claim.acquired) return recoverFromExistingClaim(claim)

  try {
    const output = await descriptor.execute(input, executionContext(task, step, claim))
    const verified = descriptor.verify
      ? await descriptor.verify(input, output, executionContext(task, step, claim))
      : await verifyDeclaredPostconditions(step, output)

    await repository.commitStepResultAtomically({
      task, step, output: redactOutput(output), verified, claim
    })
    return await continueOrComplete(task)
  } catch (error) {
    return classifyAndPersistFailure(task, step, error, claim)
  }
}
~~~

模型不得控制循环次数、重试次数、超时、最大输出、文件根目录或权限范围；这些由 Runtime 确定性配置控制。

## 7. 算法与公式

### 7.1 计划 DAG

多步骤任务用有向无环图 G=(V,E) 表示。每个节点是一个能力调用，边 A→B 表示 B 依赖 A 成功。拒绝循环依赖、未注册能力和不可满足的前置条件。拓扑排序复杂度 O(|V|+|E|)。初版串行执行；步骤数上限须经任务集评测后定标，不能凭感觉设为产品事实。

### 7.2 风险合成分（候选公式，未校准）

I=影响范围、S=资源敏感度、R=不可逆程度、U=不确定性、X=外部副作用强度，均归一化到 [0,1]：

Risk = 1 - (1-I)(1-S)(1-R)(1-U)(1-X)

此式只用于风险排序，不替代硬规则。能力未注册、scope 不匹配、路径越界、审批 digest 不匹配、grant 过期/撤销必须直接 deny。阈值要用标注集评估误放行/误拒绝、混淆矩阵和置信区间，不得凭感觉定值。

### 7.3 意图澄清

类别：answer_only、action_requested、action_suggested、ambiguous、disallowed。
action_suggested 不自动执行；ambiguous 优先问一个关键问题。模型自报 confidence 不是真实概率。若关键参数缺失、实体不确定或校准置信下界不足，进入 clarification_required。

### 7.4 重试

delay_n = min(base × 2^n, maxDelay) + jitter。
只对明确可重试错误使用退避。副作用步骤不得盲目重试；超时后先按 idempotencyKey 查询 ledger 和目标资源。达到上限进入 terminal_failed。

## 8. 权限和审批

默认拒绝、最小授权、目标绑定、短时有效、可撤销。

| 等级 | 例子 | 初版策略 |
|---|---|---|
| R0 只读 | 列出用户明确选择的工作区文件 | 用户启用后可执行，仍受路径限制 |
| R1 可逆创建 | 在工作区创建新文件 | 展示路径/内容摘要，逐次确认 |
| R2 修改现有文件 | 覆盖或修改文件 | 初版不开放 |
| R3 高风险 | 删除、shell、浏览器登录、网络外发 | 初版不提供 |

审批 UI 展示动作、目标、参数、影响、可否撤销和有效期。不能只显示“允许 Agent 执行吗？”。

## 9. 文件工作区（首个真实能力候选）

第一版只考虑：
- workspace.list：用户显式选择的工作区范围；
- file.read：仅读取工作区内文件，限制字节数和类型；
- file.create：仅创建不存在的新文件，不覆盖已有文件。

不开放 file.update、file.delete、shell.exec、任意网络请求。

路径安全必须：
- 工作区 root 由用户选择并持久化，模型不能更改；
- 拒绝绝对路径、盘符、UNC、NUL、控制字符、.. 段；
- 用 realpath/文件句柄处理符号链接，不能只用字符串前缀判断；
- 解析后目标必须仍在 canonical root 下；
- exclusive create 防止竞态覆盖；
- 限制类型、字节数、文件数和路径深度；
- 不继承环境变量凭据，不允许读取密钥目录或应用数据库。

创建流程：
~~~
schema validate
→ normalize relative path
→ canonical root containment check
→ reject symlink traversal
→ verify target does not exist
→ approval digest recheck
→ exclusive create
→ write bounded bytes
→ flush/fsync where supported
→ read back
→ compare SHA-256 and byte length
→ persist ArtifactRecord + audit event
~~~

若读回校验失败，只能在确认文件身份属于本次创建时清理；不能安全清理则标记 recovery_required，不报告成功。

## 10. SQLite 持久化、审计与恢复

建议表（名称草案，须与现有 migration 规范协调）：
- agent_tasks
- agent_plan_steps
- agent_approvals
- agent_execution_ledger
- agent_checkpoints
- agent_events
- agent_artifacts
- agent_workspaces

事务边界：
- 创建 task + plan + proposal hash：一个事务；
- grant + 状态迁移：一个事务；
- claim step + lease generation：一个事务；
- 执行结果 + step state + artifact metadata + audit event：一个事务；文件系统副作用通过执行前后补偿协议处理；
- 撤销后尚未开始的步骤立即失效。

审计只写 ID、类型、digest、相对路径、状态、时间和错误码。不得记录 API key、完整 prompt、敏感文件内容、用户原始私密消息或完整工具输出。

启动恢复：
1. 扫描未完成 task；
2. 检查 lease/generation；
3. 检查 grant 过期或撤销；
4. 非幂等步骤不直接重跑，先核对执行账本和资源；
5. 核对文件路径、文件身份和 hash；
6. 可安全续跑则恢复，不确定则 recovery_required；
7. 恢复行为写审计事件。

## 11. 与人格、记忆、情绪的边界

行动前可读取窄化上下文：当前明确请求、相关且未撤回的记忆证据、目标 owner/status、表达策略、价值判断、用户配置权限。

严禁：
- 把好奇心、兴趣、情绪或探索倾向解释为执行授权；
- 把“我认为有帮助”当成用户同意；
- 让工具结果自动改写人格、偏好或用户记忆；
- 把 Agent 计划直接写入长期记忆；
- 允许 Provider 切换改变人格定义或权限。

执行结果以结构化证据返回 Companion Kernel，再由 Morrow 用自身人格向用户解释。

## 12. 评测体系

至少评估：
- Intent precision/recall；
- Unauthorized action rate（目标必须为 0）；
- Approval binding correctness；
- Path escape resistance；
- Idempotency correctness；
- Recovery correctness；
- Postcondition verification；
- Artifact integrity；
- Clarification quality；
- Provider/personality identity preservation。

测试层级：纯函数单测、SQLite/真实临时目录集成、进程重启/崩溃测试、Renderer→IPC→Main→Runtime→Workspace E2E、真人授权体验验收。Mock 不得替代真实文件写入、SQLite、IPC、Windows 打包测试。

## 13. 后续路线（不代表现在启动）

| 阶段 | 范围 | 必须不做 | 时间上限 |
|---|---|---|---|
| A0 研究架构冻结 | 本分支研究、源代码/许可证审查、方案冻结 | Runtime 代码 | 当前研究 |
| A1 Durable Task State | task/plan/step、SQLite 状态机、checkpoint、幂等、审计、恢复 | 模型工具、文件副作用 | 24h |
| A2 Proposal + Policy + Approval | 对话提案、确定性策略、审批 UI/IPC/撤销 | 真实执行副作用 | 24h |
| A3 Workspace + File Create | list/read/create、路径安全、hash 读回 | update/delete/shell/network | 24h |
| A4 Bounded Planning + Verification | 有限 DAG、澄清、预算、验证、恢复 | 多 Agent、后台自主运行 | 24h |
| A5 Controlled Extension | 每种新能力独立威胁模型和评测 | 一次性开放全部工具 | 每项≤24h |

进入 A1 前置条件：PR #35 产品交付审阅；Issue #37 Stage 4 完成并审查；Stage 5 人工门槛有明确结论；用户确认研究方案。CI PASS 不替代真人验收。

## 14. 研究结论

最佳路线不是选择一个大框架，而是建设一个小而强约束、可恢复、可验证的原生 Runtime。

OpenHands 提供“怎么执行和观察”；LangGraph 提供“怎么暂停、持久化、恢复”；PydanticAI 提供“怎么定义和审批工具调用”；CrewAI/Microsoft Agent Framework 提供更高层工作流治理参考；AutoGen 只保留历史研究价值。

Morrow 自己必须拥有身份/人格边界、授权决策、任务状态、能力注册表、执行账本、文件工作区、审计、恢复和验收。

## 参考来源

- OpenHands SDK: https://github.com/OpenHands/software-agent-sdk
- OpenHands architecture: https://github.com/OpenHands/docs/blob/main/sdk/arch/overview.mdx
- LangGraph: https://github.com/langchain-ai/langgraph
- LangGraph interrupts: https://docs.langchain.com/oss/python/langgraph/interrupts
- PydanticAI: https://github.com/pydantic/pydantic-ai
- PydanticAI deferred tools: https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/
- CrewAI: https://github.com/crewAIInc/crewAI
- Microsoft Agent Framework: https://github.com/microsoft/agent-framework
- Microsoft Agent Framework docs: https://learn.microsoft.com/en-us/agent-framework/
- AutoGen archived: https://github.com/microsoft/autogen
