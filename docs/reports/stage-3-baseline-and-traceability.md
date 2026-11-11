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


---

## 6. 后续修复（F1–F7）的基线复核

本轮（Issue #20）开工时重新核验：`feat/stage-3-long-term-companion` HEAD = `0ebbdd71fb37cfef671c81f6884a0628ed0900f1`，与任务书给定值一致，无他人提交被覆盖。

逐项复核结论（详见 `docs/reports/stage-3-followup-implementation-report.md`）：

| 编号 | 复核结论 | 处理 |
|---|---|---|
| F1 | 属实：`interests` 无归属字段，探索直接吃用户话题 | 迁移 30 加 `origin`；`observeMorrow`；长期层拆三行；探索只认 `morrow/shared` |
| F2 | 属实：`decide()` 直接写 `raised`，`prepare()` 两次调用会重复 | 状态机 + `UNIQUE(turn_id, state)`；落库后 `settle()` |
| F3 | 属实：L5 只查 prompt，`好的。` 也能过 | 重写 L5 为四段断言 |
| F4 | 属实：纠正/记忆请求被当人格证据 | 6 条显式风格规则 + 反证 + `source` 列 |
| F5 | 属实：L11 另建库 | 全运行时重建 + `restart` 套件 |
| F6 | 属实：真实时钟下的区块被当作多日 | 注入时钟 + `clock: injected` + 冷却边界实测 |
| F7 | 属实：L6 只查原则存在 | 降级为客观检查，模型质量 BLOCKED |

## 7. 仍然存在的缺口（本轮未做）

记忆巩固/重要度衰减（§2A）、内在状态 appraisal（§2B）、反思质量评测（§2C）、GoalService 主链（§2D，L10 仍 NOT_RUN）、语音闭环（§2F）。这些不计入任何通过率。

---

## 2026-10-31 最后一轮

| 项 | 值 |
|---|---|
| 任务发布时核实的 PR #19 HEAD | `a6923fc95c20d6a47970468fd77a8fd63835e69f` |
| 实际开工基线 | `a6923fc95c20d6a47970468fd77a8fd63835e69f`（一致，无漂移） |
| 本轮代码基线 | `ee728fd95ddd3e3d1ad05cc96b00c90e7b66b409` |
| PR #21 | `infra/shared-real-model-test-contract` @ `5bb221e`，OPEN / DRAFT，未合并 |
| 契约同步方式 | 逐文件复制 `docs/testing/shared-real-model-test-contract.md` 与 `.env.real-model.example`，未合并 PR #21 |
| 迁移 | v36（effect ledger claim）、v37（provider endpoint /v2） |
| PR #19 状态 | OPEN / 未合并；base 仍为 `feat/stage-2-delivery-hardening` |
| main | 未改动 |
