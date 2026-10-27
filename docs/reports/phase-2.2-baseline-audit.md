# Phase 2.2 — 基线审计与冻结

审计时间：2026-10-27。审计方式：重新查询 GitHub、在独立工作树中只读核对源码/历史/原始记录。此文件是 Phase 2.2 的起点，不回写任何 Phase 2.1 证据。

## 0. 基线与分支依赖

| 项 | 本次重新核实的值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2`（私有） |
| PR #3 | OPEN，MERGEABLE/CLEAN，未合并，无审查结论 |
| PR head | `feat/phase-2-companion-core` @ `e252d062581bc6aacc5f1197ff52693f8a944358` |
| PR base | `chore/phase-1-engineering-consistency` @ `12f83e19172d02648ff5007ba14fa9ad9d640525` |
| main | `8b207b7d7b80b91ed4369d02fd6ef7e170b81133`，是上述 head 的祖先 |
| 最新基线 CI | run `40451977563` @ `e252d062`，三个 Job success；Windows/Ubuntu 各 50 文件、435 测试，Windows 持久化 6 文件、47 测试，双平台 smoke passed |
| 本阶段起点 | 从 `e252d062` 新建 `feat/phase-2.2-memory-reliability`，继承尚未合并的 PR #3 与其 Phase 1 base 的全部依赖 |

工作区接手时为 detached HEAD，`git status` 为空，没有可覆盖的未提交改动。未获知其他 Agent 的未推送工作区。不得改变 PR #3 的 base；本阶段独立 PR 必须以 `feat/phase-2-companion-core` 为 base，并明确堆叠依赖。

## 1. 实际链路

`renderer` → `preload` → `app/ipc.ts` → `ChatService.send` → `prepare`：`ConversationService` 读取当前会话历史，`analyzeCognitiveTurn` 本地规则分析，`MemoryService.assembleContext` 检索，`PersonalityService.get` 读取版本化人格，`CognitiveFeelingService` 计算短期状态，`buildSelfModelContextBlock` 加入兴趣/派生用户原话。

最终 system 顺序：人格、用户风格、认知提示、状态提示、长期层、记忆 JSON、固定原则；随后是保留历史与本轮用户消息。`consentPreview` 后重新 `prepare` 并比较 payload hash，再由 `OpenAICompatibleProvider` 发送。成功才保存助手消息；记忆显式操作走 `MemoryService`，对话完成后才更新兴趣和自我条目。

## 2. 证据等级

- **源码核实**：上述调用链、v15 迁移、记忆/人格/内在状态/Provider 实现。
- **远端核实**：PR/base/head/main 和 CI run `40451977563`。它不是本阶段新提交的 CI。
- **原始记录核实**：真实模型文件的内容、runId、模型、代码状态与采样声明。文件存在不证明当时执行环境可被完整重建。
- **Agent 历史报告**：用于定位风险，不当作独立人工复核。当前复核文件 `20261027T034222Z-d3839e.review.json` 的 `reviewer.kind` 是 `agent`。
- **本阶段尚未执行**：真实模型、云端调用、打包安装。后续真实实验必须绑定本阶段 commit、数据集版本、运行 ID 和参数，不得用旧绿灯替代。

## 3. 已确认问题与工作边界

### 3.1 检索不是简单的“零重叠全丢弃”

`MemoryContextAssembler` 已有最多三条 `continuity`，因此旧报告“score=0 永不召回”并非当前完整事实。真正盲区是：只有词面重叠才成为 topic；查询扩展只在显式回忆路由使用，普通指代/省略轮次不会带上相关前文；continuity 无主题关系且可能引入无关信息。

本阶段须先建立同一 fixture 的旧策略/候选策略对照，考察相关召回、错误召回、预算和授权边界；不无差别塞入全部记忆，不强制引入嵌入模型。

### 3.2 冲突与过期只有提示，没有可操作的上下文语义

两条记忆可同时进入请求，但 `detectConflicts` 只记录事件，未把冲突关系交给模型；180 天阈值适用于所有记忆。`lastConfirmedAt`、revision 和 sourceCategory 可追踪，但模型实验中仍出现静默选边、把过期信息当现状。不能把“指令送达”当作行为通过。

### 3.3 授权还有派生数据通道

主记忆有敏感度过滤；逐字自我条目已受 `includeSensitive` 门禁。兴趣仍无敏感度字段，始终可进入 prompt。

另有源码审查发现：对话完成后将用户原话写入 `self_model_entries`，它与主记忆没有外键/来源关联；主记忆撤回/删除不会自动撤回该条目。单独的自我条目撤回 API 不能证明“用户撤回这项信息”的统一语义。动态复现和负责人语义确认前，不宣称已修复，也不默默选择数据迁移策略。

### 3.4 评测可信度和实验复现

当前已有四态判定、回声检测和独立 review 文件，但词面正向断言仍可假通过，形式断言仍可假失败。关键 `8d96a5f` 原始记录标为 dirty，而部分 Phase 2.1 文档称 clean；默认采样也限制重放。不能把不同代码和请求的命中合并成可靠成功率。

### 3.5 文档/工程差异

README 列出的 `src/personality/` 不存在，人格在 `app/companion-service.ts`；真实 schema 是 v15，未来迁移只能在核实后追加。当前 CI 全绿不排除历史 Windows I/O 超时复发，不通过加超时或重试掩盖。

## 4. 阶段实施顺序与禁止事项

1. 检索候选/对照与安全回归。
2. 冲突分类、可追踪纠正及类型化过期语义。
3. 兴趣敏感授权与迁移；派生数据边界单独披露，不擅自扩大 schema 语义。
4. 评测集 v2、历史误判回归、独立复核接口。
5. 完成前述离线验证后才运行本地真实模型；失败保留，不付费、不换云模型。

本阶段不增加 Agent 操控，不改 main，不合并 PR #3，不删除失败实验，不把自动评测或 Agent 阅读当真实人工验收。每个独立修改分别提交、推送并按 commit 核查 CI。
