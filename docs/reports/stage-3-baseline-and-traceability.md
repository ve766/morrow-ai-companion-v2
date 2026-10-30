# Stage 3 基线与需求追踪

- 仓库：`ve766/morrow-ai-companion-v2`
- 基线分支 / HEAD：`feat/stage-2-delivery-hardening` @ `84670792fa08352835d4cca88da6355435ee0cd6`
- 开发分支：`feat/stage-3-long-term-companion`
- 审计方式：直接读远端源码与数据库迁移，不引用旧报告的数字。
- 审计日期：2026-10-30

## 1. 开工时远端状态核验

| 项 | 实测 | 结论 |
|---|---|---|
| `feat/stage-2-delivery-hardening` HEAD | `84670792fa08352835d4cca88da6355435ee0cd6`（2026-10-30T08:51:13Z，`docs(final): 交付报告、自审、最终算法登记、最终证据索引 + 五份结果文件`） | 与任务书给定基线**一致**，无漂移 |
| `feat/stage-3-long-term-companion` | 远端不存在（20 个分支中无匹配，PR #1–#15 无该 head） | 需新建 |
| 最新迁移版本 | `CURRENT_SCHEMA_VERSION = 28` | 阶段三新增迁移从 29 开始 |
| 源码规模 | `src/**/*.ts` 约 34k 行，80 个测试文件 | 见 §2 |

> 记录说明：本次开工前 `git fetch` 在本机被代理阻断（`CONNECT tunnel failed, response 502` / `OpenSSL unexpected eof`），源码通过 GitHub API 以 `tarball/84670792…` 取得，字节级校验 `gzip -t` 通过，440 个文件。因此**本地无 `.git` 历史**，提交通过 GitHub Git Data API 建立，父提交为 `8467079`。

## 2. 模块审计（真实实现 / 部分 / 空壳 / 未实现）

判定依据是调用点与写入点，不看文件名。

| 模块 | 关键入口 | 状态 | 证据 |
|---|---|---|---|
| 回合主链 | `src/app/companion-service.ts:928` `ChatService.send` | **真实** | 单轮 12 个生命周期状态全部有写入点（`recordTurnState`） |
| 上下文装配 | `companion-service.ts:1440-1476` `prepare()` | **真实** | 人格→认知指引→状态指引→长期层→记忆→原则→历史 固定顺序 |
| 意图/认知分析 | `src/cognition/cognitive-turn-analyzer.ts` | **真实** | 规则实现，非占位 |
| 记忆生命周期 | `src/memory/memory-service.ts` | **真实**（撤回/纠正/删除/事务） | 迁移 25 的证据失效同事务删除 |
| 记忆巩固/衰减 | — | **未实现** | 无巩固、无按重要度的归档策略；仅 180 天 `isStaleMemory` 标记 |
| 人格 | `companion-service.ts:520` `PersonalityService` | **真实但只有用户写路径** | `save()` 唯一写入口，`changeType` 仅 `user_edit` |
| 人格从证据成长 | — | **未实现（本次新增 G1）** | 迁移 27 只存 `pending_personality_candidates`，无应用路径 |
| 内在状态 | `src/affective-state/*` | **真实** | `feelingPromptGuidance` 进入 system；检索宽度由 `adjustPolicyForState` 调整 |
| 自我模型 | `src/self-model/self-model-service.ts` | **真实** | `activeStatementsForContext` 进入长期层 |
| 兴趣 | `src/self-model/interest-service.ts` | **真实** | 证据账本 + 多会话晋升门槛 |
| 反思 | `src/self-model/reflection-service.ts` | **真实** | 限频 6 次/小时，findings 去重，不写基线 |
| 自主探索 | — | **未实现（本次新增 X1）** | 无频次/打扰控制，无发起记录 |
| Provider | `src/providers/*` | **真实** | 超时/取消/错误分类 |
| 桌面 UI | `src/renderer/*` | 部分 | 未在本次范围验证（见 §5） |
| Windows 安装/升级 | — | **BLOCKED** | 本机无干净机器授权，且 `npm run smoke` 本机不可用（阶段二已证伪为环境问题） |

## 3. 需求追踪矩阵（Issue #18 → 源码 → 测试 → 证据）

| 需求 | 源码入口 | 测试 | 证据 | 状态 |
|---|---|---|---|---|
| 3.1 真实认知链 | `ChatService.prepare` / `send` | `src/app/cognitive-loop.integration.test.ts` | `evals/stage-3` L1–L3、L13 | **已实现（既有）** |
| 3.2 记忆形成/纠正/撤回 | `memory-service.ts` | `memory-service.test.ts` | L2、L12 | **已实现（既有）**；巩固/衰减**未实现** |
| 3.3 人格稳定 + 渐进成长 | `personality-growth.ts`（新增） | `personality-growth.test.ts`（16） | L4、消融 `no_growth` | **本次实现** |
| 3.3 独立判断 | `fixedPrinciples` + 认知指引 | `cognitive-loop.integration.test.ts` | L6 | **部分**：原则常在，未做行为层判定 |
| 3.4 内在状态驱动行为 | `affective-state/*` | `cognitive-feeling-*.test.ts` | L7 | **已实现（既有）** |
| 3.5 自我模型/兴趣 | `self-model-service.ts`、`interest-service.ts` | `self-model.test.ts`、`interest-*.test.ts` | L5、L8 | **已实现（既有）** |
| 3.5 受约束自主探索 | `exploration-policy.ts`（新增） | `exploration-policy.test.ts`（11） | L5、消融 `no_exploration`、纵向 | **本次实现** |
| 3.5 反思门控 | `reflection-service.ts` | `reflection-mapping.test.ts` | L9、消融 `no_reflection` | **已实现（既有）** |
| 3.6 上下文质量 | `memory-context-assembler.ts` | 装配器测试 | L3、L13 | **已实现（既有）** |
| 4 桌面可用性 | `src/renderer`、`ipc.ts` | `ipc.test.ts` | — | **BLOCKED**（见交付报告） |
| 5 长期评测 | `evals/stage-3/*`（新增） | 运行器本身 | 结果 JSON | **本次实现** |

## 4. 缺口清单（本次未做）

1. 记忆巩固与按重要度的衰减/归档（Issue §3.2 明确要求，本次未实现）。
2. 人格漂移的 UI 确认面（用户无法在界面看到/回滚漂移；服务层已提供 `rollback`）。
3. 语音入口闭环。
4. Windows 安装器升级验收。
5. 真实 Provider 下的行为层评分（需要凭据）。
6. 长对话早期约束的 30 轮行为观察。

## 5. 方法学声明

- 本文件不重复旧报告结论；所有"真实/部分/未实现"均以本次读到的源码为准。
- 脚本化 Provider 的结果只证明接线与载荷，不证明模型质量。
- 无法执行的项目一律标 BLOCKED / NOT_RUN，不计入分母，也不写成通过。
