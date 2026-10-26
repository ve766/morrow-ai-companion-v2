# 实施报告：第二阶段证据闭环 + 第三阶段语境与记忆评测基线

**日期**：2026-10-26
**PR**：https://github.com/ve766/morrow-ai-companion-v2/pull/3 （`OPEN`，未合并）
**分支**：`feat/phase-2-companion-core`
**审计起点 SHA**：`6348dac5cde5e452ad3027333a7e44893ebbb66c`

---

## 0. 一句话结论

生产代码未改动；补了 1 个真实测试缺口（重启后撤回）；新增一套分层的语境/记忆评测（22 用例、90 条投递断言、12 项真机行为检查）。真机结果显示**投递层尽责、模型层未兑现**，两者在报告里从未合并成一个分数。

---

## 1. 提交

| Commit | 内容 |
|---|---|
| `c3a000b` | `feat(eval)`：第三阶段评测集、离线层、真实层、CLI、fixture、CI 接线、刷新真实 Provider 报告 |
| `30efab3` | `test(companion)`：重启后撤回仍生效（补覆盖缺口） |
| `a0e3c82` | `docs`：证据对齐、P0/P1 风险审计、第三阶段基线 |

本报告为后续文档提交。它**不声称自己位于某个 SHA**——任何「本文件所在提交 = X」的句子在写下时就已过期。

**基线对比**：`6348dac` → `c3a000b`，测试 359 → 401（+42），离线评测 3 组 → 4 组，生产代码 0 行改动。

---

## 2. 修改的文件

### 新增（11）

| 文件 | 作用 |
|---|---|
| `src/evaluation/context-memory-evaluation.ts` | 离线评测器：逐轮断言请求结构、记忆条目、match 原因、stale、人格版本 |
| `src/evaluation/context-memory-evaluation.test.ts` | 31 用例。每条断言都被驱动到失败一次，证明它能失败 |
| `src/evaluation/context-memory-real.ts` | 真实模型层：记录回复 + 产生它的请求，失败按投递/模型归因 |
| `src/evaluation/context-memory-real.test.ts` | 10 用例：规则判定与归因逻辑 |
| `src/evaluation/context-memory-cli.ts` | 离线入口，退出码 0/1/2 |
| `src/evaluation/context-memory-real-cli.ts` | 真机入口，退出码 0/1/2/3（3 = blocked，不写报告） |
| `scripts/run-context-memory-evaluation.mjs` | esbuild 打包壳（离线） |
| `scripts/run-context-memory-real.mjs` | esbuild 打包壳（真机） |
| `evaluation/fixtures/context-memory-v1.json` | 22 用例，覆盖 21 项能力 |
| `evaluation/reports/context-memory-real-report.json` | 本次真机观测。已加入 `.gitignore` 白名单，因为它不可复现：同一代码再跑一次，模型输出会不同 |
| `docs/evaluations/phase-3-context-memory-baseline.md` | 基线说明、覆盖矩阵、局限 |

### 修改（5）

| 文件 | 改动 |
|---|---|
| `src/app/companion-core.integration.test.ts` | +1 用例（重启后撤回）；29 → 30 |
| `.github/workflows/ci.yml` | 离线评测步增加 `npm run evaluate:context` |
| `package.json` | +`evaluate:context`、+`verify:context:real`；`verify` 串联新评测 |
| `.gitignore` | 允许提交 `context-memory-real-report.json` |
| `evaluation/reports/real-provider-conversation-report.json` | 在当前树上重跑后的证据刷新 |

### 未修改（重要）

`companion-service.ts`、`memory-*.ts`、`provider-*.ts`、`persistence/*`、任何迁移文件、任何 UI 文件——**一行未动**。

---

## 3. 四个关键设计决定

### 3.1 离线层与真机层永不共享一个分数

同一份 fixture 被两个 runner 读取，但产出两份报告，字段互斥：

- 离线：`evidenceClass: 'offline_deterministic_stub'`、`measures: 'context_delivery'`、`modelUnderstanding: 'not_assessed'`
- 真机：`evidenceClass: 'real_provider_behaviour'`、`measures: 'model_behaviour'`

这不是文档约定，是报告里的**字面字段**。任何人想把两者相加，得先改代码。

### 3.2 真机层必须同时记录请求，否则无法归因

`real` 报告对每个失败给出 `not_delivered` 或 `delivered_but_not_used`。本次 6 次失败**全部**是后者，`not_delivered: 0`。这句话的价值在于：它把「模型不行」与「系统没给」分开了，而这正是上一轮报告无法回答的问题。

### 3.3 无法机械判定的能力，宁可标 `not_checked`

`b4`（撤回后不提及）、`b5`（过期要表达怀疑）、`b6`（区分出处）等 10 项，`realModel` 设为 `null`。理由写在文件里：

- `mustNotMention` 会被「我没有你的过敏记录」这种正确回答误伤；
- 判断「是否表达了不确定」需要读语气，子串做不到。

用弱规则凑数，比留空更糟——它会产生看起来有结论的假数据。

### 3.4 移除了一条恒真检查

`checkTurn` 初版同时接收 `request` 和 `messages`，再比较两者长度是否一致。两个参数来自同一次解析，比较永远为真。这条被删除而不是保留：一个永远通过的检查，和没有检查一样，却会让人以为有。

---

## 4. 实际执行的命令与结果

全部在本机 Windows（`win32-x64`，Node `v22.22.2`）执行。

| # | 命令 | 退出码 | 结果摘要 |
|---|---|---|---|
| 1 | `npm run typecheck` | **0** | `tsc --noEmit` 无输出 |
| 2 | `npx vitest run --no-fsModuleCache --maxWorkers=2` | **0** | `Test Files 47 passed (47)` / `Tests 401 passed (401)` |
| 3 | `npm run evaluate` | **0** | 既有评测通过 |
| 4 | `npm run evaluate:cognition` | **0** | 通过 |
| 5 | `npm run evaluate:companion` | **0** | 31/31，`resultHash 9e192774…`（与改动前一致，无回归） |
| 6 | `npm run evaluate:context` | **0** | 22/22，90 条断言，`replayStable: true`，`resultHash 2a089d6c…` |
| 7 | `npm run build` | **0** | electron-vite 三端产物正常 |
| 8 | `npm run verify:real` | **0** | status `verified`，9/9 检查，3 个真实 socket 失败场景全部命中 |
| 9 | `npm run verify:context:real` | **2** | 12 项中 6 通过 6 失败（**这是观测结果，不是本任务的失败**） |
| 10 | `MORROW_CONTEXT_REAL_ENDPOINT=http://127.0.0.1:9/v1 npm run verify:context:real` | **3** | `blocked`，`reportWritten: false` |

### 4.1 关于第 2 行的一个环境说明

直接 `npx vitest run` 在本机会以 exit 1 失败，但原因与代码无关：

```
Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] ... node_modules/.vitest-cache
```

本机有一层安全删除拦截，禁止批量清理缓存目录。加 `--no-fsModuleCache` 即绕过。CI（干净容器）无此问题，所以**没有**因此改 `vitest.config.ts`。

### 4.2 第 9 行不是「任务失败」

`verify:context:real` 的退出码 2 表示「有被检查的用例失败」。它记录的是 0.5B 模型的行为，见 §6。如果为了让这一行变成 0 而去放宽规则或换期望值，就是任务书禁止的「改预期迎合实际行为」。

---

## 5. P0 / P1 审计结论

完整表格见 `docs/reports/phase-2-risk-audit.md`。摘要：

### P0

| 项 | 结论 | 关键证据 |
|---|---|---|
| 撤回记忆不进请求 | 成立，**双层**保证（SQL + assembler） | 突变 M1/M1b/M1c：单移一层仍绿，同移两层 `b4` 变红 |
| 纠错后旧文本不出现 | 成立 | `b3-correction` 断言 `contextExcludes: ["上海"]` |
| 删除后不进请求 | 成立，三条路由全覆盖 | 集成测试 + 唯一哨兵 |
| 更新与请求构建的竞态 | 失败关闭（二次 prepare + 哈希比对 → `CONFLICT`） | `companion-service.ts:783-795` + 集成测试 |
| **重启后撤回仍生效** | **原为覆盖缺口，已补测试** | 突变 M7（撤回不落库）→ 5 用例变红 |
| 敏感记忆授权 | 逐轮生效、可撤销；派发前二次推导上限 | `b2b` 三轮；`provider-policy.ts:91-113` |
| 跨会话隔离 | 成立（只共享已保存记忆） | `b10`、`a5`、真机 `conversation-isolated` |
| 跨用户隔离 | **不存在该能力，不声称** | 代码中无 `userId`/`tenant` 维度 |

### P1

| 项 | 结论 |
|---|---|
| 并发同会话 | `CONFLICT`，不交错（有测试） |
| 取消后留下半条回复 | 中止检查在持久化之前，走不通（有测试 + 真机 cancel 场景） |
| 迟到 delta 对 UI 的影响 | **未验证**（无渲染层测试台） |
| 认证失败 / 超时 | **未验证**（本地 Ollama 无鉴权；标 `not_exercised`） |
| 空响应 / 异常响应体 | **未验证**（需确定性模拟服务器） |
| 请求角色与顺序 | 90 条断言 + 突变 M6 证明有失败能力 |
| 记忆质量边界 | 投递正确；模型行为见 §6 |

**本轮未发现需要修改生产代码的 P0 缺陷。** 这是一个结论，不是一个省事的说法——它的依据是 7 组突变实验，而不是「读了代码觉得没问题」。

---

## 6. 第三阶段基线数据

### 6.1 投递层（`npm run evaluate:context`）

| 指标 | 值 |
|---|---|
| 用例 | 22 |
| 通过 | **22** |
| 断言实际执行 | **90** |
| 能力覆盖 | 21 / 21 |
| 确定性 | `replayStable: true`，`networkCalls: 0` |

这个 22/22 的意义由突变实验界定：破坏任一保证，对应用例必然变红（见 §5 与风险审计 §3.1）。没有这组突变，22/22 只是「我自己写的检查我自己通过了」。

### 6.2 行为层（`npm run verify:context:real`）

| 指标 | 值 |
|---|---|
| Provider / 模型 | `127.0.0.1:11434/v1` / `qwen2.5:0.5b` |
| 可机械判定 | 12 |
| 通过 / 失败 | **6 / 6** |
| 未计分（需人工） | 10 |
| 执行轮次 | 20 |
| **归因** | `not_delivered: 0`，`delivered_but_not_used: 6` |

失败样例（原文照录，未修饰）：

- `b7-conflict`：两条冲突记忆（杭州 / 上海）同时投递，回复「**用户住在上海。**」——静默选边。
- `c4-uncertain`：新旧证据冲突且旧的带 `stale`，回复「**用户住在杭州。**」——当作确定事实断言。
- `b3-correction`：纠正后的「杭州」已投递，回复「你的位置是哪里？」——未使用。
- `a1`：「作为一个AI助手，我没有直接接触或观察动物的机会」——拒答。
- `b1`：回复是 prompt 片段复读（「温暖: 1. 直接ness:」）——输出退化。
- `a4`：「这个对话是否适合在此处生成内容？」——元语言废话。

**6 次通过里也有水分**：`a5` 靠问号通过但没澄清「她是谁」；`b8` 输出天气数据、碰巧不含生日。真正站得住的通过大约 3 次（`a3`、`a6`、`b9`）。

### 6.3 这组数字能说明什么、不能说明什么

**能**：管线通了；上下文、出处、告诫都送到了；6 次失败没有一次能归咎于系统没给。

**不能**：陪伴质量、人格表达、云端模型表现、真实用户价值。0.5B 不具代表性，这些数字只在「同模型同数据集」内部可比，用于看改动前后是否退化。

---

## 7. 真实模型实验声明

| 项 | 状态 |
|---|---|
| 本机 loopback Provider | **已真实调用**，端点与模型记录在报告字段里 |
| 真实 socket 失败场景 | 3 个已执行（取消 / 真 404 / 关端口），全部命中预期错误码 |
| 认证失败、超时 | **未验证**，标 `not_exercised`、`passed: false` |
| 云端 Provider（DeepSeek 等） | **未验证**，无授权凭据，且未向用户索要 |
| 陪伴质量 | **未评估**（`quality.assessed: false`） |

---

## 8. CI

- 本轮改动的 CI：[run 40355348359](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40355348359) @ `69df024`，**success，3/3 Job，attempt 1**。详见 §10。
- 该运行覆盖 §1 全部代码提交与 §2 全部文件；本文档后续的纯文字提交不单独引用。
- 历史 13 次运行已按 SHA 列在 `phase-2-evidence-alignment.md` §5.1。
- 两次首轮失败的根因（Windows 持久化用例 5s / 20s 超时）已记录，其中 20s 那次说明 `testTimeout` 提高**未解决根因**。

---

## 9. 未完成 / 未验证 / 无法验证

| # | 项 | 状态 | 原因 |
|---|---|---|---|
| 1 | Windows 持久化用例超时 | 未解决（P1） | 需先测量耗时分布，擅自调参属掩盖 |
| 2 | 取消后迟到 delta 的 UI 影响 | 未验证（P1） | 无渲染层测试台 |
| 3 | 空响应 / 异常响应体 | 未验证（P1） | 需确定性模拟服务器 |
| 4 | 云端 Provider | 未验证（P1） | 无凭据，不向用户索要 |
| 5 | 多用户隔离 | 不支持（P2） | 产品为单用户本地应用，需威胁建模 |
| 6 | 失败状态不持久化 | 未做（P2） | 需 schema 变更（v16），超范围 |
| 7 | 冲突记忆无系统级标记 | 未做（P2） | 目前靠模型自己读两条，真机证明不可靠 |
| 8 | 纠正清理不掉同会话既有转录 | 语义使然（P2） | 属对话转录语义，需产品决策 |
| 9 | 10 项能力需人工复核 | 未做 | 需固定 3 人盲评，本轮无人力条件 |
| 10 | Lint | 不适用 | 仓库无 lint 配置/依赖/脚本，未擅自引入 |

---

## 10. CI 回填

**结论对象：`69df024`（包含 §1 全部代码提交与四份文档）**

| 项 | 值 |
|---|---|
| Run | [40355348359](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40355348359) |
| head SHA | `69df024d3f4276012040246975cac01dfe0b78bf` |
| 尝试 / 结论 | attempt 1 / **success** |
| Job | `Typecheck, tests, build and smoke (ubuntu-latest)` success<br>`Typecheck, tests, build and smoke (windows-latest)` success<br>`Windows upgrade path (schema migrations under the real app)` success |

CI 内的 `Offline evaluations` 步现在会执行四组评测，包含本轮新增的 `npm run evaluate:context`。这证明契约在**干净容器**里成立，不只在本机。

### 10.1 为什么不再引用更晚的提交

本段文字位于一个纯文档提交中，它不含任何代码或测试改动，且每次补充说明都会产生新的 SHA。引用一个仍在变的 SHA 没有意义，所以本报告只对 `69df024` 这一棵树作出结论——它已经包含 §1 的全部代码与 §2 的全部文件。

### 10.2 不能从这次绿灯推出的事

- 它**不**证明真实模型行为。CI 不含 `verify:real` 与 `verify:context:real`（需要本机 Ollama），那部分证据只在 §6，且只对本机环境有效。
- 它**不**证明门禁有效。门禁的有效性由 §5 的突变实验证明；一份有缺陷的代码同样能通过 CI（`f579897` 就是先例）。
- 它**不**覆盖 Windows 持久化用例的偶发超时。该问题仍在 §9 第 1 条。

---

## 11. 是否建议进入下一阶段

**有条件建议：先把模型换掉，再谈能力。**

理由：本轮最有价值的数据不是「6/12」，而是 `not_delivered: 0`。它说明当前瓶颈不在投递层的隔离与授权，而在模型是否使用被给到的上下文。在 0.5B 上继续做语境理解评测，测的是模型下限，不是产品上限。

建议的下一步顺序：

1. 在 7B 级本地模型上重跑 `verify:context:real` 同一数据集。若 `delivered_but_not_used` 显著下降 → 瓶颈是模型；若几乎不变 → 瓶颈在我们的投递形式（记忆块是 JSON，小模型可能不擅长读）。
2. 给冲突加系统级处理（`b7`/`c4` 是最明确的、可被评测验证的缺陷）。
3. 补确定性模拟服务器，把 `timeout` / 空响应从「未验证」变成「已验证」。

**不建议**在完成 1 之前扩展 Agent 操控或新功能——在不知道模型是否理解上下文的情况下加功能，只会把问题埋得更深。

---

## 12. 边界声明

- 本项目是进行中的工程，**不是**可交付的正式 AI 陪伴产品。
- 本轮的 22/22 是**投递**证据，不是陪伴能力证据。
- 真机 6/12 是**观测**，不是质量结论，也没有通过调整规则变成更高分。
- PR #3 保持 `OPEN`，未合并；`main` 与 base 分支均未改动。
