# 第二阶段证据对齐（Evidence Alignment）

**生成时间**：2026-10-26 23:5x（本地时区 GMT+8）
**用途**：核对「报告说了什么 / 代码是什么 / 测试跑出什么 / CI 跑的是哪个 SHA」四者是否指向同一版本。
**方法**：本文件的所有结论来自本轮重新读取的 git 对象、实跑命令输出和按 SHA 对齐的 GitHub API 结果。上一轮的报告只作为「被核对对象」，不作为证据来源。

---

## 1. 仓库与 PR 的真实状态

| 项 | 值 | 来源 |
|---|---|---|
| 仓库 | `https://github.com/ve766/morrow-ai-companion-v2` | `git remote -v` |
| 默认分支 | `main` | `gh repo view --json defaultBranchRef` |
| `main` 最新提交 | `8b207b7d7b80b91ed4369d02fd6ef7e170b81133` | `git ls-remote --heads origin` |
| PR | **#3**，`OPEN`，`MERGED_AT = null`，`MERGEABLE` | `gh pr view 3` |
| PR base 分支 | `chore/phase-1-engineering-consistency` | 同上 |
| PR base SHA | `12f83e19172d02648ff5007ba14fa9ad9d640525` | 同上 |
| PR head 分支 | `feat/phase-2-companion-core` | 同上 |
| PR head SHA（本轮审计起点） | `6348dac5cde5e452ad3027333a7e44893ebbb66c` | 同上 + `git rev-parse HEAD` |
| 本地工作区 | 干净（`git status --short` 无输出） | 本地 |
| PR 变更文件 | 30 个 | `gh pr diff 3 --name-only` |
| PR 提交数 | 22 | `gh pr view 3 --json commits` |

### 1.1 一个必须点明的结构事实

**PR #3 的 base 不是 `main`。** 它合并进 `chore/phase-1-engineering-consistency`（`12f83e19`），而 `main` 停在 `8b207b7d`。

这意味着：

- 「PR #3 已通过 CI」**不等于**「main 已获得这些能力」。第一阶段分支本身尚未合入 main。
- 任何关于「项目主线已具备真实多轮陪伴核心」的说法，在当前分支拓扑下都不成立。
- 本轮未合并 PR #3，也未改动 `main`、未改动 base 分支（任务书禁止）。

### 1.2 其他远端分支（未触碰）

`feature/algorithm-v2-phase-a`、`report/project-work-report-2026-10-26`、`reports/algorithm-v2`。本轮未读取其代码，也未合并。

---

## 2. 源码审计：实际读了什么

以下文件在 `6348dac` 这个工作树上被逐个打开阅读，不是从报告转述：

| 文件 | 关键实现 | 结论 |
|---|---|---|
| `src/app/companion-service.ts` | `HISTORY_POLICY`（:81）、`retainedHistoryTail`（:94）、并发锁（:744）、二次 prepare + 哈希比对（:785–:795）、取消后中止检查（:825）、敏感度上限（:880）、历史裁剪调用（:939） | 与上一轮报告描述一致，且 `:795` 的 `hashProviderInput` 比对确实覆盖记忆变化 |
| `src/memory/memory-context-assembler.ts` | 状态+敏感度过滤（:73）、词面命中（:76）、连续性截断（:82）、过期标记（:117） | 与描述一致 |
| `src/persistence/memory-repository.ts` | SQL 层状态过滤（:99） | **报告未提到的一点**：撤回过滤在 SQL 里还有一层，见 §2.1 |
| `src/providers/provider-policy.ts` | `assessProviderRequest`（:81）、loopback 校验（:94）、敏感度未授权拒绝（:112） | 派发时**重新推导**最大敏感度，是独立于 `prepare` 的第二道门 |
| `src/memory/memory-domain.ts` | `MEMORY_STALE_DAYS = 180`（:47）、`isStaleMemory`（:142） | 与描述一致 |
| `src/evaluation/request-assertions.ts` | 请求解析与三类门禁 | 与描述一致 |
| `src/evaluation/real-provider-conversation.ts` | 4 轮对话 + 失败场景 | 与描述一致 |
| `src/app/companion-core.integration.test.ts` | 29 → **30** 个用例 | 本轮新增 1 个（§4.1） |

### 2.1 报告与代码的一处偏差（本轮新发现，非缺陷）

上一轮审计报告称「撤回由 `memory-context-assembler.ts` 过滤」。代码事实是：**撤回状态过滤有两处独立实现**——`memory-repository.ts:99` 的 SQL `WHERE status = 'active'`，以及 `memory-context-assembler.ts:73` 的 `record.status === 'active'`。

本轮的突变实验证明（§3.1）：单独移除任一层，撤回保证依然成立；只有两层同时移除才会泄漏。这不是缺陷，是纵深防御。但它意味着**任何只移除其中一层的代码审查结论都不成立**——必须两层都看。

---

## 3. 本轮实际执行的验证

### 3.1 突变实验（证明门禁有失败能力）

在 `6348dac` 的工作树上，逐个向生产代码注入缺陷，运行 `npm run evaluate:context`，记录哪些用例变红，然后还原并确认 `git status` 干净：

| 突变 | 改动 | 变红的用例 | 退出码 |
|---|---|---|---|
| M1 | 移除 assembler 的 `status === 'active'` 过滤 | **无**（SQL 层仍在拦） | 0 |
| M1b | 只移除 SQL 的 `WHERE status='active'` | **无**（assembler 层仍在拦） | 0 |
| M1c | 两层同时移除 | `b4-retracted` | 2 |
| M2 | 把 continuity 条目标成 `topic` | `a3`, `a4`, `b8`, `b9` | 2 |
| M3 | 敏感度上限恒为 `sensitive` | `b2b-authorised-recall` | 2 |
| M4 | 连续性上限 3 → 25 | `b9-bounded` | 2 |
| M5 | `isStaleMemory` 恒返回 `false` | `b5-stale`, `c4-uncertain` | 2 |
| M6 | 历史窗口 12 → 1 条 | `a1`, `a2`, `b1`, `c5` | 2 |
| M7 | `retract` 不写状态（假装撤回） | 集成测试 5 个失败（含新增的重启用例） | 1 |

每条突变都只命中预期用例，没有「一改全红」也没有「改了还全绿」。完整命令与输出见最终实施报告 §4。

### 3.2 自动化测试

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 无输出 |
| `npx vitest run --no-fsModuleCache --maxWorkers=2`（改动前，`6348dac`） | 0 | `Test Files 45 passed` / `Tests 359 passed` |
| 同上（改动后） | 0 | 见最终实施报告 §4（本轮新增 2 个测试文件） |

### 3.3 离线评测

| 命令 | 数据集 | 退出码 | 结果 |
|---|---|---|---|
| `npm run evaluate` | 既有 | 0 | 通过 |
| `npm run evaluate:cognition` | 既有 | 0 | 通过 |
| `npm run evaluate:companion` | `companion-core-v1.json`（31 用例） | 0 | 通过 |
| `npm run evaluate:context` | **`context-memory-v1.json`（22 用例，本轮新增）** | 0 | 22/22，90 条断言，`replayStable: true` |

### 3.4 Windows 验收

| 项 | 值 |
|---|---|
| Job 名 | `Windows upgrade path (schema migrations under the real app)` |
| 命令 | `npx vitest run src/persistence` |
| 覆盖 | v1→v15 升级路径、迁移回滚、备份预览 |
| `6348dac` 上的结论 | success |
| 本轮改动是否触碰迁移 | **否**。本轮未新增迁移、未改 schema、未改 `src/persistence/*.ts`（除临时突变，已还原） |

### 3.5 真实模型实验

| 项 | 值 |
|---|---|
| Provider | 本机 Ollama `http://127.0.0.1:11434/v1`（loopback，符合生产门禁） |
| 模型 | `qwen2.5:0.5b` |
| 运行方式 | `npm run verify:real`（4 轮对话 + 3 个真实 socket 失败场景）；`npm run verify:context:real`（12 个可机械判定的语境用例） |
| 授权 | 每轮经 `authorize` 显式批准，payload 哈希绑定 |
| 本轮结果 | `verify:real` 9/9 检查通过、3 个失败场景全部命中；`verify:context:real` 12 项中 6 项通过、6 项失败，失败全部归因「上下文已送达但模型未使用」 |
| 局限 | 0.5B 模型不具备产品代表性；本地跑分**不能**外推到云端模型，也**不作为**陪伴质量结论 |

---

## 4. 改动清单与性质

| 文件 | 性质 | 是否触碰生产行为 |
|---|---|---|
| `src/evaluation/context-memory-evaluation.ts` | 新增（离线评测器） | 否，纯新增 |
| `src/evaluation/context-memory-evaluation.test.ts` | 新增（31 用例） | 否 |
| `src/evaluation/context-memory-real.ts` | 新增（真实模型层） | 否 |
| `src/evaluation/context-memory-real.test.ts` | 新增（10 用例） | 否 |
| `src/evaluation/context-memory-cli.ts`、`context-memory-real-cli.ts` | 新增（入口） | 否 |
| `scripts/run-context-memory-evaluation.mjs`、`run-context-memory-real.mjs` | 新增（esbuild 打包壳） | 否 |
| `evaluation/fixtures/context-memory-v1.json` | 新增（22 用例，覆盖 21 项能力） | 否 |
| `src/app/companion-core.integration.test.ts` | **+1 用例**（重启后撤回仍生效） | 否，仅测试 |
| `.github/workflows/ci.yml` | 离线评测步增加 `npm run evaluate:context` | 否，仅 CI |
| `package.json` | 增加 `evaluate:context`、`verify:context:real`，`verify` 串联新评测 | 否 |
| `.gitignore` | 允许提交 `context-memory-real-report.json` | 否 |

**生产代码零改动。** 本轮没有修改 `companion-service.ts`、`memory-*.ts`、`provider-*.ts` 的任何一行；上述 M1–M7 均为临时突变，已逐条还原并用 `git status` 确认。

> 这一点需要说清：本轮审计**没有发现需要修改生产代码的 P0 缺陷**。发现的是一个测试覆盖缺口（重启后撤回未被验证），已补测试。审计结论见 `phase-2-risk-audit.md`。

---

## 5. CI 证据：按 SHA 对齐，明确区分历史与当前

### 5.1 全部 13 次运行

| Run | head SHA | 尝试 | 结论 | 相对 `6348dac` 的位置 |
|---|---|---|---|---|
| [40345776838](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40345776838) | `6348dac` | 1 | **success**（3/3 Job） | **本轮审计起点** |
| 40345324766 | `dbff261` | 1 | success | 历史 |
| 40337895001 | `e944799` | 1 | success | 历史 |
| 40336723143 | `c4aecc3` | **2** | success（attempt 1 failure） | 历史 |
| 40335930849 | `151f123` | 1 | success | 历史 |
| 40335743832 | `b10f088` | 1 | success | 历史 |
| 40334673549 | `b2a16a3` | 1 | success | 历史 |
| 40324745303 | `f579897` | 1 | success | 历史（修复前） |
| 40324566292 | `ad1475b` | 1 | success | 历史 |
| 40323987426 | `30b74dd` | 1 | success | 历史 |
| 40322940570 | `d84dcfa` | 1 | **failure** | 历史 |
| 40321933436 | `aa2642b` | **2** | success（attempt 1 failure） | 历史 |
| 40321367137 | `a8f82ab` | 1 | success | 历史 |

### 5.2 两次首轮失败的真实原因

**`40322940570` @ `d84dcfa`**：`Unit and integration tests`（windows-latest）失败，`src/persistence/migrations.test.ts` 3 个用例 **`Test timed out in 5000ms`**。

**`40336723143` attempt 1** @ `c4aecc3`：`Windows upgrade path` Job 失败，`src/persistence/backup-service.test.ts` 2 个用例 **`Test timed out in 20000ms`**。

这两条放在一起有诊断价值：`30b74dd` 把 `testTimeout` 从 5s 提到 20s 之后，同一批 I/O 密集用例**仍然**在 20s 超时。也就是说，当时的处理**缓解了症状，没有解决根因**。这不是本轮引入的问题，也不能算已解决——已列入 `phase-2-risk-audit.md` 的 P1 遗留项。

### 5.3 本轮改动对应的 CI

**本轮的新提交在推送前没有任何 CI 结果。** 这是事实，不能用 `6348dac` 的绿色运行代替。

推送后必须按新 head SHA 重新查询并回填到最终实施报告 §5；在拿到那个结果之前，本轮改动的 CI 状态只能记为「未验证」。

> 检验方法：`gh run list --branch feat/phase-2-companion-core --limit 3 --json databaseId,headSha,conclusion`，逐条比对 `headSha` 与 `git rev-parse HEAD`。

---

## 6. 上一轮报告中被纠正/补充的表述

| 上一轮表述 | 本轮核实结果 | 处理 |
|---|---|---|
| 「撤回由 assembler 的 active 过滤保证」 | 实际是 SQL + assembler 双层 | 已在本文件 §2.1 补正 |
| 「CI 通过即证明修复有效」 | CI 只覆盖离线信号；`f579897`（有缺陷的代码）同样 CI 全绿 | 已明确：CI 绿 ≠ 门禁有效，有效性靠突变实验证明（§3.1） |
| 「真实 Provider 已验收」 | 9/9 检查是**投递与结构**证据；`quality.assessed: false` | 已在 §3.5 与最终报告中分层表述 |
| 「PR 已就绪」 | base 不是 main（§1.1） | 已单列结构事实 |

---

## 7. 结论

1. 报告、代码、测试、CI 在当前 `6348dac` 上是可以对齐的：31 个 companion-core 离线用例、9/9 真实 Provider 检查、3/3 CI Job 都能复现。
2. **不存在「旧 SHA 冒充新提交」的情况**，但也**不存在**本轮改动的 CI 证据——因为尚未推送。
3. 生产代码未改动，本轮交付的是审计结论 + 评测能力 + 一个测试缺口修补。
4. PR #3 仍为 `OPEN`、未合并；`main` 未被改动。
