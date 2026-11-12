# Stage 2 最终收尾交付报告

| 项 | 值 |
|---|---|
| 任务 | issue #17 评论 6517598292（阶段二最后一次修复与强制收尾） |
| 分支 | `feat/stage-2-delivery-hardening`（PR #15，未合并） |
| 开工基线 HEAD | `9837b59fbf5d1088f06814fdd2a3632792142a38` |
| **结果生成 SHA** | `a8e382de96840e72effa9c8d7901971bee6e6e89`（干净工作树，`dirty=0`） |
| 发布提交 | 见 PR #15 最新 HEAD（比结果 SHA 多"提交证据与文档"的提交） |
| 环境 | Windows 10.0.26200（MINGW64）、Node v22.22.2、npm 10.9.7 |
| 审计报告 | [`docs/audit/stage-2-final-closeout-audit.md`](../audit/stage-2-final-closeout-audit.md) |
| 算法登记 | [`docs/algorithms/stage-2-final-algorithm-registry.md`](../algorithms/stage-2-final-algorithm-registry.md) |
| 证据索引 | [`docs/reports/stage-2-final-evidence-index.md`](stage-2-final-evidence-index.md) |

> 结果文件全部绑定 `a8e382d`。提交这些文件会把 HEAD 前移一个"证据提交"，因此**不得**用更晚的 SHA 声称跑过验证。

---

## 1. P0-1 B1 意图置信度 — **PASS（未校准）**

### 1.1 真实调用链

```
src/cognition/intent-decision.ts      scoreIntentCandidates() → decideIntent()
        │  规则层：intent / alternatives / needsMemoryRetrieval / confidence(0-100)
        ▼
src/cognition/intent-confidence.ts    assessIntentConfidence()
        │  五特征 z 分、margin、band、needsClarification（未解析指代是硬闸）
        ▼
src/cognition/cognitive-turn-analyzer.ts  strategy = clarify | retrieve_memory | answer
        │  写入 analysis（持久化）
        ▼
src/app/companion-service.ts          system 消息：`intent=…; response route=…; uncertainty=…`
        │  strategy==='clarify' 时追加"只问一个澄清问题"的指令
        ▼
最终序列化 Provider payload
```

消费点：`companion-service.ts` 第 80 行（route 字符串）与第 90 行（澄清指令）。payload 断言在 `src/app/b1-strategy-payload.integration.test.ts`。

### 1.2 公式与参数

```
z_i = w_s·s + w_e·e + w_m·m + w_k·k − w_a·a
Δ   = z₍₁₎ − z₍₂₎
```

| 变量 | 定义 | 来源 |
|---|---|---|
| `s∈[0,1]` | 候选语义/规则匹配强度 | `scoreIntentCandidates().score / 100` |
| `e∈[0,1]` | 本轮目标表达明确度 | 短语级标记(≥80)→1；仅事实谓词→0.55；中等→0.6；词面线索→0.35 |
| `m∈[0,1]` | 该意图所需对象/动作/范围完整度 | 按标签：查询要对象、计划要动作+范围、纠正要新值 |
| `k∈[0,1]` | 与已确认上下文的**内容**一致度 | 独立轮次恒为 1（与历史无关）；指代轮次：共享内容 1 / 无关 0.2 / 无上文 0 |
| `a∈[0,1]` | 歧义程度 | 未解析指代 0.6、自述困惑 0.8、指示词 0.3、否定 0.15、反讽 0.3、候选竞争 0.2 |
| `Δ` | 候选区分度（集合级） | 排序后前两名 z 差，**不进单候选向量** |

权重（源码 `INTENT_CONFIDENCE_WEIGHTS`）：`s 0.10 / e 0.60 / m 0.10 / k 0.10 / a 0.10`，非负、和为 1。
阈值（`INTENT_CONFIDENCE_BANDS`、`INTENT_MARGIN_FLOOR`）：`high 0.62 / medium 0.45 / clarify 0.42 / marginFloor 0.08`。

**权重来源**：`scripts/b1-calibrate.ts` 在开发集（26 例，`evals/stage-2/b1-devset.json`）+ 既有 fixture（26 例）双集网格搜索，约束为：每个特征权重 ≥0.05、`completeness ≤0.2`、`context ≤0.3`、`semantic+explicitness ≥0.5`；平手时取证据权重更高者。

### 1.3 决策优先级（按任务给的语义落地）

```ts
if (explicitUserCorrection)          → correctionStrategy（无新值才追问）
if (unresolvedReference)             → clarify          // 硬闸，不是扣分
if (requiresAuthorization)           → existingApprovalGate  // 置信度不能绕过
if (noMeaningfulIntentCandidate)     → answer            // 与"低置信度"区分
if (topScore < floor || margin < floor) → changesAnswerDirection ? clarify : safeUncertain
else                                 → strategyFor(topCandidate)
```

### 1.4 证据

| 类型 | 位置 | 断言 |
|---|---|---|
| 单元 | `src/cognition/intent-confidence.test.ts`（11 条） | 权重归一非零；**四档历史（无/无关/相关/冲突）同分**；指代仅在有共享内容时得分；歧义降分；按 z 排序；share 和为 1 且非概率；无候选不追问；未解析指代必追问；两读数同路由不追问 |
| 分析器 | `src/cognition/cognitive-turn-analyzer.test.ts`（6 条 B1 组） | 三档历史同分同策略；未解析指代→clarify；有相关上文→不 clarify；`嗯。` 不追问；纠正压过上下文；清晰请求跨历史同策略 |
| 应用级 | `src/app/b1-strategy-payload.integration.test.ts`（3 条） | payload 含 `route=clarify` 与澄清指令；同句有上下文后不再出现；清晰个人问题在无关历史下仍 `retrieve_memory` |
| 机器结果 | `evals/stage-2/final/…-b1.json` | 26/26；混淆矩阵 `retrieve_memory→13 / clarify→3 / answer→10`；**高置信度错误 0**；`calibration: uncalibrated_heuristic` |

**能证明**：分数真实改变策略，且策略变化进入最终请求；历史存在本身不抬分；模糊/冲突/低置信度会追问；纠正优先；授权门控不被绕过。
**不能证明**：这是概率或已校准；也不能证明泛化性能（52 例小样本，仅报告命中率与混淆矩阵）。

---

## 2. P0-2 B4 轮次恢复 — **PASS**

### 2.1 真实持久化顺序与事务边界

```
received → analyzed → context_ready → awaiting_consent → requesting → response_received → committed
                                                    │
                        prepareFinalization（意图落库，独立事务）
                                                    ▼
                        appendMessage(assistant) ── 事务内：写消息 → applyFinalization → remove(intent)
                                                    ▼
                                              committed（事务外）
```

关键事实：**提交消息与清理意图在同一事务内**。因此"消息已提交但意图未清理"这个窗口不可能由崩溃产生——只能由清理自身失败产生（服务有意吞掉该失败并保留意图）。这一点在实现中被验证并写进了测试说明。

### 2.2 恢复规则

| 中断位置 | 处理 | 是否重发 Provider |
|---|---|---|
| Provider 调用前（无意图） | 结算为 `failed`；不伪造回答 | 否 |
| Provider 调用中（无意图，状态 `requesting`） | `recovery_required → recovering → failed`；结果未知不重试 | 否 |
| Provider 返回、未持久化（有意图、无消息） | `failed` / `INTERRUPTED` | 否 |
| 消息已提交、意图残留 | `committed`，只补记账，不重复写消息 | 否 |
| 会话已删除 | 不复活，计入 `dropped` | 否 |
| 重复恢复 | 意图处理后移除；二次调用无动作 | 否 |

### 2.3 证据

| 类型 | 位置 | 覆盖 |
|---|---|---|
| 进程级（真实 SIGKILL） | `tests/b4-child-crash.test.ts`（5 条） | 调用前 / 调用中 / 返回后未持久化 三个窗口用**子进程强杀**；断言消息数、Provider 调用次数、状态、意图残留、二次恢复 |
| 注入级 | `src/app/b4-recovery.integration.test.ts`（4 条） | 提交失败、意图残留、删除会话、数据库重开 |
| 机器结果 | `evals/stage-2/final/…-b4-faults.json` | 9/9 通过；窗口矩阵与每窗口期望 |
| 迁移 | `migrations.test.ts`（v25→v26、v26 之后的状态表） | `recovering` 写入 CHECK、级联触发器重建 |

**能证明**：四个故障窗口都有数据库级断言；无重复消息、无重复 Provider 调用、无数据复活；无法安全恢复时明确失败。
**不能证明**：OS 级断电（未做文件系统断电模拟）；多进程并发恢复（单进程串行）。

---

## 3. P0-3 B5 反思 — **PASS**

### 3.1 映射管线

```
ReflectionFinding → 证据校验 → allowlist 映射 → 门控 → 持久候选/证据 → 下一轮上下文 → 最终 payload
```

| finding kind | 效果 | 说明 |
|---|---|---|
| `interest_candidate` | 写兴趣证据（带 memory id / revision / 时间 / 会话） | 仍受晋升门槛（≥3 证据、≥2 会话） |
| `intent_correction` | 记录候选纠正，**不覆盖本轮用户输入** | 只发审计事件 |
| `next_turn_suggestion` | 记录有界建议，**不执行任何动作** | 只发审计事件 |
| `bias_hint` | 仅当声明维度时 → `pending_personality_candidate` | **人格基线一律不动** |
| `memory_gap` / `open_question` / `consistency_note` | 仅记录 | 无副作用 |
| 未知 kind | 拒绝 + 审计原因 `unmapped_kind` | 不静默忽略 |

其他保障：`dedupe_key = sha256(kind|normalizedStatement|sortedEvidenceRefs)` 唯一索引 → 重跑幂等；证据必须存在且可用（撤回/删除后不再产生效果）；`pending_personality_candidates` 带证据、置信度、有效期（14 天），状态 `pending`，无人自动应用。

### 3.2 正向夹具（同一输入、同一初始库）

| 层次 | full | no_reflection |
|---|---|---|
| 反思运行 | 5 次 | 0 次 |
| 产生候选 | 有 | 有（来自消息） |
| 通过门控（active） | **是**（3 证据 / 2 会话） | 否（2 / 1） |
| 下一轮 payload 变化 | **是**（含注意力块） | 否 |

撤回两条记忆后重发探针轮：注意力块消失。

### 3.3 证据

- `src/self-model/reflection-mapping.test.ts`（7 条）：allowlist、无证据拒绝、证据失效拒绝、未知 kind 拒绝、去重键稳定
- `src/self-model/self-model.test.ts`（+3 条）：重跑幂等（`duplicates>0, stored=0`、证据不增加）、撤回后不再重建证据、**挂起人格候选且 personalization 前后完全相同**
- `src/app/b5-reflection-safety.integration.test.ts`：反思抛错仍 deliver（且断言注入确被触发）
- 机器结果：`evals/stage-2/final/…-b5-ablation.json`

**能证明**：反思产物不是孤立 DB 记录，经过证据校验与门控后真实改变下一轮请求；撤回后消失；稳定人格不被静默改写。
**不能证明**：反思提升回复质量（只有一个夹具，证明接线与门控，不证明收益）。

---

## 4. P1-1 B3 / B2 / A1–A3 回归 — **PASS**

未重写任何已通过实现。`npm test`（80 files / 693 tests）包含：

- B3：`context-utility.test.ts`、`memory-context-assembler.test.ts`（P/X/D 三条排序断言）
- B2：`personalization-service.test.ts`（13 条：单轮上限、折叠重算、撤回回到 0.5）
- A1–A3：`derived-deletion-boundary.test.ts`、`interest-invalidation.test.ts`、`backup-service.test.ts`

`P` 分量仍是窄映射（只在记忆明确提到交互维度时非 0），文档如实保留该边界。

---

## 5. P1-2 外部项

### 5.1 CI — **BLOCKED**

| 项 | 值 |
|---|---|
| run | [41021035940](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41021035940)（`head_sha=9837b59`） |
| job | 三个 job 全部 `runner_id=0`、`steps=0`、`conclusion=failure` |
| 注解 | *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* |

workflow YAML 本轮未改动，不存在由本任务引起的 YAML/shell/平台问题。**不计通过，也不计失败**：没有任何步骤执行过。

### 5.2 真实 Provider — **NOT_RUN（本轮）**

本会话未提供可用凭据。既有报告 `evals/stage-2/provider/phase24-real-model-26aeac7.json` 保留其自身 `codeSha=26aeac7`，**不冒充** `a8e382d` 的验证。S4 多模型切换维持 SKIPPED。

### 5.3 Windows 安装器 — 见 §5.3 补充（构建与升级验证分开）

- `npm run package:win`：见本文件末尾"安装器构建结果"
- **升级验证**（旧版安装 → 覆盖升级 → 启动 → 数据保留）：**BLOCKED / NOT VERIFIED**，因为当前环境没有干净测试机，也没有旧版安装包。`npx vitest run src/persistence` 的 57/57 只是 schema 测试，**不等于**安装器升级。

---

## 6. 命令与退出码（`a8e382d`，`dirty=0`）

原始日志：[`evals/stage-2/final/2026-10-30T08-37-58-a8e382d…-verification.txt`](../../evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-verification.txt)

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | — |
| `npm test` | 0 | **80 files / 693 tests** |
| `npm run evaluate` | 0 | M1–M4 合成评测全绿 |
| `npm run evaluate:cognition` | 0 | 认知评测通过 |
| `npm run build` | 0 | — |
| `npm run smoke` | 0 | Electron 默认沙箱通过 |
| `npm run eval:stage2` | 0 | 12 executed / 12 passed / blocked 2 / notRun 0 |
| `npm run eval:topic-identity` | 0 | P 1.000 / R 0.889（26 对） |
| `npm run eval:ablation` | 0 | 四臂 |
| `npx vitest run tests/b4-child-crash.test.ts` | 0 | 5/5（含 3 个真实 SIGKILL 窗口） |
| `npx vitest run src/app/b4-recovery.integration.test.ts` | 0 | 4/4 |

---

## 7. 阶段二最终状态

| 项 | 状态 |
|---|---|
| P0-1 B1 | **PASS（`uncalibrated_heuristic`）** |
| P0-2 B4 | **PASS** |
| P0-3 B5 | **PASS** |
| P1-1 B2/B3/A1–A3 | **PASS（回归）** |
| P1-2 CI | **BLOCKED（账号计费）** |
| P1-2 真实 Provider | **NOT_RUN（本轮无凭据）** |
| P1-2 Windows 安装器 | **构建 BLOCKED（502）**、**升级 BLOCKED / NOT VERIFIED** |

**阶段二整体：PARTIAL。** 三项算法缺口已闭合；三项外部条件未解除。

**不建议合并 PR #15**：CI 从未真正执行，安装器升级未验证。这两项不是代码问题，但合并后无法确认流水线健康与升级路径。

---

## 附：Windows 安装器（构建与升级分开记）

### 构建 — **BLOCKED（网络）**

`npm run package:win`（`npm run build && electron-builder --win nsis --x64 --publish never`）执行两次，均在下载 NSIS 工具链时失败：

```
⨯ Response code 502 (Bad Gateway)  failedTask=build
  HTTPError: Response code 502 (Bad Gateway)
```

- 第一次：`nsis-3.0.4.1.7z`、`7zip-win-x64.tar.gz` 已 100% 下载，随后另一个资源返回 502
- 第二次：同样 502
- 产物：`release/win-unpacked/`（已解包的 Electron 应用，构建成功）与 `release/builder-debug.yml`；**没有生成 `Morrow-Setup-1.0.0-x64.exe`**
- 日志：`node_modules/.cache/package-win.log`、`package-win-2.log`（未提交，属本地诊断产物）

结论：构建失败于**外部下载**，不是本仓库的打包配置问题；本环境无法产出安装器。

### 升级验证 — **BLOCKED / NOT VERIFIED**

即使有安装器，也需要：干净 Windows 测试机、旧版安装包、安装权限。本环境三者都不具备。`npx vitest run src/persistence` 的 57/57 只是 schema 测试，**不能替代**安装器升级验证。
