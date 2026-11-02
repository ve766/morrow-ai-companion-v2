# Morrow Agent 未来准备评审（工作包 F，只评估不实现）

- 基线：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 评审对象：PR #38（`research/morrow-agent-capability-architecture-v1` @ `efa4be9c80159ef79f44f11fafa88264ca25fb35`，OPEN，base=release 分支）的三份研究文件：
  1. `docs/research/morrow-agent-capability-architecture-reference-v1.md`（429 行，v1.0）
  2. `docs/research/morrow-agent-open-source-review-v1.md`（110 行，v1.0）
  3. `docs/research/morrow-agent-research-decision-record-v1.md`（39 行，ADR-001~010）
- 核实方式：经 GitHub API（gh）读取 PR head 文件原文；对其中引用的当前代码事实逐项抽查（16 项，14 项准确、1 项措辞失准、1 项精度不足）
- 边界声明：本文件只做架构评估，不实现 Agent Runtime、工具调用、shell、浏览器、后台自主执行、多 Agent 或任何外部副作用

---

## 1. 三份文件的核心主张

**能力架构参考 v1.0**：主张 Morrow 自建 TypeScript 原生 Agent Capability Runtime，而非包装 OpenHands/LangGraph/CrewAI/AutoGen/MS Agent Framework。结构为 Companion Kernel → Action Proposal → Policy Gate → Durable Orchestrator → Capability Registry → Sandboxed Workspace → Verification → SQLite Journal。关键原则：模型只能产出结构化提案，不直接获得文件/shell/网络/数据库访问；审批绑定 planVersion/step/digest/scope/过期；第一真实能力仅工作区 list/read/create；SQLite 为唯一状态真相，审计只写 ID/digest；情绪/好奇不得解释为授权，工具结果不得自动改写人格记忆。§13 给出 A0-A5 分阶段路线，进入 A1 的门槛是 PR #35、Issue #37、Stage 5 关闭（截至核实：三者均 OPEN）。

**开源审查 v1.0**：六项目采用矩阵——OpenHands（执行循环/事件/workspace 首要参考）、LangGraph（checkpoint/interrupt/resume 最高优先）、PydanticAI（typed tool contract/deferred approval）、CrewAI（仅 Flow）、MS AF（治理补充）、AutoGen（仅历史，README 已标归档告示）。结论：无证据支持引入 Python/.NET 第二运行时。八步代码复用纪律（锁 commit、SBOM、NOTICE）。诚实声明未完成代码级审计与 Windows 实机试验。

**决策记录 v1.0**：十条 ADR——自有 Runtime（001）、单 Agent+能力注册表（002）、仅 ActionProposal（003）、服务端确定性审批且前端布尔值不构成授权（004）、先文件创建不先 shell（005）、SQLite 唯一真相（006）、验证后置条件（007）、Agent 不得直接改人格/长期记忆（008）、A0-A5 各 24h 分阶段（009）、**当前阶段不启动（010）**。

三份文件自我定位为"研究基线、非实现批准"（架构文件卷首、ADR-010），与产品原则"伴侣本体优先、Agent 最后"一致。

---

## 2. 值得保留的架构要素（对照当前代码的落点）

| 架构要素 | 当前代码中的同构先例 | 证据 | 建议 |
|---|---|---|---|
| Kernel 边界："内部状态只改变表达方式，永不改事实/权限/记忆真相" | expression-policy 文件头已确立同一哲学 | `src/affective-state/expression-policy.ts:4-8` | 固化为 A1 设计输入 |
| ActionProposal + 服务端 grant（审批过期、前端布尔不构成授权） | goal 审批链已实现 awaiting_approval 状态、approval_expires_at 过期判定、goal_audit 审计 | `src/persistence/goal-repository.ts:253-309,582`；consent 后重跑 prepare 再验证 `src/app/companion-service.ts:1421,1591-1609` | 审批设计不必新造，从现有模式扩展 |
| SQLite 唯一真相 + lease/fencing | effect-ledger 条件 claim（WHERE state IN ... AND lease 过期）+ generation 递增 + 仅声明 generation 可 complete | `src/app/effect-ledger.ts:112-150,164` | ADR-006 正确，直接复用 |
| 独立 verifier（验证后置条件） | answer-fact-guard（交付前事实校验"prompt 指令不是保证"）；`MemoryCountTool` 的 execute/verify 双路径（verify 用独立读法） | `src/cognition/answer-fact-guard.ts:1-8`；`src/motivation/tool-registry.ts:16-41` | **tool-registry 是现成的 CapabilityDescriptor 雏形，PR #38 未引用，应补入其 §2 复用清单** |
| 审计最小化（只写 ID/digest、载荷上限） | event-log 载荷校验（32 字段/单值 2000 字符）+ 记忆事件只写元数据 | `src/persistence/event-log.ts:82-87`；`src/memory/memory-service.ts:780-792` | 现有纪律已达文件要求 |
| fail-closed 哲学（不能自证即拒绝） | url-gate 全程 fail-closed；secrets 独占写 + 原子 rename | `src/security/url-gate.ts:1-5,51-56`；`src/security/secrets.ts:56-69` | 可直接作为 workspace gate 设计准则 |

**结论**：PR #38 的原则层（ADR-001~008）与当前代码哲学完全同构，保留价值高；主要风险在代码级草案的"提前实现诱惑"。

---

## 3. 与当前阶段冲突的部分

1. **`src/agent/*` 模块目录与 §5/§6 代码级草案**（StepState 枚举、runTask 伪代码、八张表名）：粒度已接近实现规格。虽自称非实现批准，但在 Stage 4/5 未关闭时极易被当作开工蓝本。**建议：冻结为"参考规格"，文件头重申"建目录属 A1 事务，A1 未启动前不得创建"**。
2. **§7.2 风险合成分（I/S/R/U/X 五维）**：伴侣内核无对应概念；`goal_actions` 已有 `resource_scope, risk` 字段（`goal-repository.ts:225` 附近），引入新公式会制造第二套风险语义。**建议降级为"仅参考"，以现有 risk 字段语义为基线**。
3. **§7.3 意图五分类**：与 `src/cognition/intent-decision.ts`/`speech-act.ts` 现有意图体系重叠，不合并即违反文件自身 §2"禁止复制第二套真相"。**建议保留分类思想，标注"必须与现有 intent-reading 体系合并设计"**。
4. **§13 的 24h 数字**：易被读成排期承诺，与 ADR-010"不启动"矛盾。**建议删去或标注"非承诺"**。

---

## 4. Agent 与伴侣内核的隔离设计评估

**方向充分，机制不足。** §11 五条禁令与代码现状兼容且有价值，但三处机制缺口需在 A1 前补设计：

1. **证据回流无 schema**：§11 只说"结构化证据返回 Kernel"。具体落点应是 `event-log.ts:5-8` 的 `EVENT_SOURCE_MODULES` 新增 `'agent'` 模块 + correlationId 绑定 sourceTurnId——现成挂点，文件未指明。
2. **记忆写入路径未指明**：ADR-008 说"经现有证据、确认、撤回规则"，正确挂点是 `memory.created_inferred` 事件 + suggestion review IPC 通道（`memory-service.ts:204` 附近）——Agent 证据应只能走 inferred 建议审核流（模型推断候选 → 用户确认才成为记忆），不得直接写。文件应写明。这与本仓库"模型推断不得升级成用户事实"的状态契约完全一致。
3. **审批双轨风险**：§10 新设 `agent_approvals` 表，而 goal 审批已存在（goal_audit + expiry）。建议 ADR-004 补一条：agent 审批与 goal 审批共用一套 grant 语义，或给出分离理由。

人格侧尚可：growth/rollback 机制（`src/app/ipc.ts:47` 的 parsePersonalityGrowthRollbackRequest 及 `personality-growth.ts:389-416`）是"Agent 影响人格必须走同一通道"的现成锚点。

---

## 5. 必须等待伴侣本体验收后才能启动的能力

| 能力 | 等待理由 |
|---|---|
| A1 durable task state（Agent 状态表/迁移） | 新 migration 须等 Stage 4（Issue #37 OPEN）关闭，避免迁移纪律分叉 |
| A2 审批 UI/IPC | Stage 5 人工验收门槛未关，不应新增待验收审批面 |
| A3 workspace/file create | 依赖 A1/A2；开源审查 §5 自认未做 Windows 实机试验 |
| A4 bounded planning | 依赖 §12 评测体系先建成（当前不存在；本任务工作包 D 是其前置） |
| 任何 R2/R3 能力（shell 等） | 文件 §8 自定初版不开放 |
| 多 Agent | ADR-002 明确不采用，无用户价值证据 |

**验收门槛清单（与 PR #35 人工验收项一致）**：真人自然度盲评 PENDING_HUMAN、第二真实 Provider live FAIL/PENDING、真机安装/升级 PENDING_HUMAN（`docs/testing/stage-3-final-gate-matrix.md`）。三项未关前不启动 Agent 实现。

---

## 6. 未来文件工具的安全设计 vs 现有机制复用评估

| 需求 | PR #38 设计 | 现有可复用机制 | 评估 |
|---|---|---|---|
| 用户确认 | 分级确认表，"不能只显示允许吗" | provider consent 的 consentPreview + authorize 回调模式（`companion-service.ts:288,586-591`）；goal 审批 challenge + 单次令牌 + 过期 | 可复用作为 R1 逐次确认协议 |
| 工作区沙箱 | workspace root 持久化 | 净新增；root 持久化可仿 provider_profiles 表模式（`companion-service.ts:422`） | 净新增，模式有先例 |
| 路径防护 | realpath、canonical containment、exclusive create、SHA-256 读回 | url-gate 的自证式校验风格；secrets.ts `mode 0o600, flag 'wx'` 独占写直接对应 exclusive create | 防护逻辑净新增，风格沿用 url-gate |
| 审计 | 只写 ID/digest | event-log 载荷纪律现成可用 | 复用 |
| 回滚 | ArtifactRecord + recovery_required + "不确定即不报告成功" | deletion-journal（restore 不复活已删内容）、backup 的 integrity_check + TTL preview token、人格 growth rollback | 三件套可复用；ArtifactRecord 记账净新增，原则与 fail-closed 一致 |

---

## 7. 与当前代码/事实不符的陈述（合并前建议修订）

1. **§2"重试退避"列为现有可复用基础——失准**：`effect-ledger.ts`/`cognitive-outbox.ts` 仅有 attempts 计数与失败重入队（`cognitive-outbox.ts:295-296`），无延迟调度；指数退避仅存在于 provider 请求层（`openai-compatible.ts:210-240`）。§7.4 的 `delay_n` 公式是新设计，不是复用。
2. **架构文件 §3"AutoGen 官方仓库已标记归档"——精度不足**：经核实 `microsoft/autogen` 仓库 `archived:false` 且 2026-10-28 仍有 push；"archived"是 README 徽章与告示（开源审查文件的"README 已标记归档"表述准确），架构文件措辞应对齐。
3. 其余抽查全部相符：主链顺序、lease/generation、goal owner 三分、RRF 多通道、事务内验证、IPC parse 全覆盖、引用文档存在、PR/Issue 状态、OpenHands/PydanticAI 的 MIT 许可证。

**合并前建议的三处修订**：① ADR-010 的"不启动"门槛提升到架构文件头部；② §7.3 意图分类标注"须与 intent-decision 合并设计"；③ ADR-004 补审批单轨约束。

---

## 8. 结论与对后续路线的建议

- **进入后续路线图（A1 前置约束）**：ADR-001~008 全部原则；§2 复用基础映射（补入 tool-registry.ts）；§12 评测体系清单（作为 A1 验收设计输入，与工作包 D 的 Morrow Evaluation Suite 合并设计）；开源审查 §4 许可证纪律；§9 路径防护清单（作为 A3 威胁模型基线）。
- **标记为仅参考**：§5/§6 代码级草案（冻结）；§7.2 风险公式；§13 的 24h 数字；CrewAI/MS AF 采用条目。
- **总体判断**：三份文件质量高于平均研究产出，事实纪律好（含"本报告不构成法律意见""未完成项"等诚实声明）。保留价值主要在**原则层与复用映射**；风险主要在**代码级草案的提前实现诱惑**。当前阶段（伴侣本体收口）不需要也不应该创建任何 `src/agent/*` 代码。
- 本评审与工作包 E 路线图的衔接：路线图第 ⑤ 阶段（伴侣本体验收后启动 Agent）直接引用本文件 §5 的等待清单与 §2 的复用清单作为 A0/A1 的准入条件。
