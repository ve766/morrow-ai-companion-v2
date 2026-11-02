# Morrow Agent 开源项目审查与采用矩阵 v1.0

审查日期：2026-11-02。用途：为 Morrow 自有 Agent 能力设计提供参考，不是引入依赖或复制代码的批准。

## 1. 摘要结论

推荐组合：
1. OpenHands Software Agent SDK：执行循环、事件模型、workspace、executor 的首要参考。
2. LangGraph：状态图、checkpoint、interrupt/resume 的首要参考。
3. PydanticAI：typed tool contract、参数校验、deferred approval 的首要参考。
4. Microsoft Agent Framework：生产治理、workflow、middleware、observability 的补充参考。
5. CrewAI：Flow 的确定性事件编排参考；暂不采用 Crews 多 Agent 结构。
6. AutoGen：仅历史研究，不进入生产依赖清单。

没有证据支持将任何 Python/.NET 框架作为 Morrow 运行时依赖。Morrow 当前为 TypeScript/Electron/SQLite，整体框架引入会带来第二运行时、跨进程调用、打包、权限和恢复成本。

## 2. 项目审查

### OpenHands Software Agent SDK
- 仓库：https://github.com/OpenHands/software-agent-sdk
- 文档：https://docs.openhands.dev/sdk
- GitHub 显示 MIT license；正式复用前仍需锁定具体 commit，审查该 commit 的 LICENSE、子包和依赖。
- 公开架构包含 Agent、LLM、Conversation、Tools、Workspace、Events；Agent Server 通过 REST/WebSocket 暴露执行能力；TypeScript client 供前端调用。
- 吸收：Action/Observation/Executor 分离、conversation 生命周期、typed event、workspace abstraction、过程事件化、取消和资源清理。
- 不照搬：面向软件工程的 Python SDK、Agent Server、terminal/shell 默认能力。
- 建议：高优先级研究模式；用 TypeScript 重写最小执行契约，不引入 Python sidecar。

### LangGraph
- 仓库：https://github.com/langchain-ai/langgraph
- 中断文档：https://docs.langchain.com/oss/python/langgraph/interrupts
- 主包 pyproject 声明 MIT；生态子包应逐包核验。
- 官方定位为有状态、多步骤 Agent 工作流，支持 durable execution、streaming、human-in-the-loop、persistence。
- 吸收：显式流程图、checkpoint、interrupt、resume、可重放。
- 不照搬：Python 图运行时、LangChain 依赖链、第二状态源。
- 建议：最高优先级借鉴生命周期与状态机；在 Morrow 用 TypeScript + SQLite 实现。

### PydanticAI
- 仓库：https://github.com/pydantic/pydantic-ai
- Deferred tools：https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/
- 主项目 pyproject 声明 MIT；子包和依赖需核验。
- 吸收：工具参数 schema、参数验证、ApprovalRequired、CallDeferred、DeferredToolRequests/Results。
- 安全注意：官方文档指出，客户端提交的审批不能单独构成授权边界；服务端仍须验证工具权限和调用来源。
- 不照搬：Python Agent 对象；不能把前端 approval 字段作为授权真相。
- 建议：高优先级借鉴 typed schema、deferred approval 和参数 digest。

### CrewAI
- 仓库：https://github.com/crewAIInc/crewAI
- GitHub 显示 MIT license；正式复用前锁定 commit 和依赖清单。
- 官方区分角色协作的 Crews 与事件驱动、确定性控制的 Flows。
- 吸收：Flow 事件驱动编排、状态变化触发节点。
- 不照搬：Crew 角色扮演、多 Agent 默认协作；角色设定不能替代 Morrow 自己的人格。
- 建议：只研究 Flow，低优先级。

### Microsoft Agent Framework
- 仓库：https://github.com/microsoft/agent-framework
- 文档：https://learn.microsoft.com/en-us/agent-framework/
- 官方 README 描述 Python、C#/.NET；workflow、middleware、checkpoint、HITL、observability 和 provider integrations。
- 本轮没有取得足够的指定 commit LICENSE 内容，因此不猜测许可类型。复制代码前必须单独核对。
- 吸收：middleware 治理、workflow/agent 分离、checkpoint/resume、OpenTelemetry。
- 不照搬：.NET/Python 双栈整体依赖。
- 建议：补充架构参考，不作为核心 Runtime。

### AutoGen
- 仓库：https://github.com/microsoft/autogen
- 官方 README 已标记归档/不再积极维护，并建议新项目使用 Microsoft Agent Framework。
- README 说明代码 MIT、文档 CC BY 4.0；项目归档，不建议新产品采用。
- 吸收：事件驱动 Agent、消息传递和多 Agent 历史设计经验。
- 不采用：生产依赖、未经维护的执行组件。
- 建议：只读历史参考。

## 3. 横向能力矩阵

| 能力 | OpenHands | LangGraph | PydanticAI | CrewAI | Microsoft AF | Morrow 决策 |
|---|---|---|---|---|---|---|
| 执行循环 | 强 | 图节点 | Agent/tool loop | Crew/Flow | Agent/workflow | 原生实现 |
| 状态持久化 | conversation/event | checkpoint 强 | deferred/history | Flow state | checkpoint | 复用 SQLite |
| 人工审批 | 可组合 | interrupt | deferred approval 强 | Flow 可组合 | 一等流程 | 服务端 grant |
| 工具契约 | tool abstraction | node/tool | 强类型 schema | tool schema | typed tool | JSON Schema + TS |
| 工作区 | 强 | 非核心 | 外部提供 | 工具依赖 | capability/tool | Morrow workspace |
| 结果验证 | observation/event | 节点状态 | typed output | task result | workflow events | 独立 verifier |
| 运行时匹配 | Python | Python/TS生态 | Python | Python | Python/.NET | TypeScript 原生 |
| 多 Agent 必要性 | 否 | 否 | 否 | 主打之一 | 支持 | 初版不需要 |

## 4. 许可证与代码复用纪律

本报告只记录仓库级许可标识或官方声明，不构成法律意见。复制代码之前必须：
1. 锁定 commit SHA、tag 和源文件路径；
2. 获取该 commit 的 LICENSE、NOTICE、版权头和子目录许可；
3. 解析依赖树，生成 SBOM，逐项核验直接/传递依赖许可；
4. 检查代码来源、非兼容许可、商业限制；
5. 保留版权和许可声明，标注来源与改动；
6. 检查商标、文档/示例代码、模型权重、训练数据的独立许可；
7. 更新 THIRD_PARTY_NOTICES 或仓库已有机制；
8. 对安全敏感组件进行代码审计和漏洞扫描。

## 5. 审查范围与限制

已核对官方公开 README、架构说明、关键文档和部分 package metadata。尚未完成：全部源码逐文件审计、依赖锁定、SBOM、license scanner、漏洞扫描、法律审查、Windows 实机集成试验。因此这是架构研究与初选，不是完整代码级许可审计，也不证明可直接集成。

## 6. 官方来源
- OpenHands SDK: https://github.com/OpenHands/software-agent-sdk
- OpenHands architecture: https://github.com/OpenHands/docs/blob/main/sdk/arch/overview.mdx
- LangGraph: https://github.com/langchain-ai/langgraph
- LangGraph interrupts: https://docs.langchain.com/oss/python/langgraph/interrupts
- PydanticAI: https://github.com/pydantic/pydantic-ai
- PydanticAI deferred tools: https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/
- CrewAI: https://github.com/crewAIInc/crewAI
- Microsoft Agent Framework: https://github.com/microsoft/agent-framework
- Microsoft Agent Framework docs: https://learn.microsoft.com/en-us/agent-framework/
- AutoGen: https://github.com/microsoft/autogen
