# Morrow V2 全项目收敛与可运行产品最终交付报告（Issue #81）

- 仓库：`ve766/morrow-ai-companion-v2`
- 工作分支：`fix/morrow-project-wide-final-convergence-20261110`
- 起始基线：PR #80 HEAD `094ca2cf35b84e5a342becf0508db2ec6287079e`
- 最终代码 SHA：`60ae6fe11e751bd7e5b80df942d231eade98b8eb`
- 数据库 schema：v59
- 报告内容对应的文档 HEAD：`a83c36c71314677be7c0aef343848e3f22c8f888`（机器结果 JSON 的提交是其后一个记账提交，不改变代码 SHA；分支 tip 以 GitHub 为准）
- 结论：**核心代码交付为 PARTIAL，不是 PASS**。F1/F2/F3 的来源、删除、事务闭环已有生产接线和测试；F4 只完成隔离；F5/F6/F7 各自有真实运行证据和明确缺口。下面逐项说明，不把 PARTIAL 写成 PASS。

## 1. 本轮实际完成的内容

| 项 | 代码位置 | 本轮改动 | 状态 |
| --- | --- | --- | --- |
| F1 递归证据 DAG | `src/self-model/reflection-state-gate.ts`、`src/persistence/migrations.ts` v57 | `evidence_lineage` 表；递归父链、环、断链、撤回/删除、跨 owner、伪造 root/cluster 全部拒绝；独立数按验证过的 cluster 计算；启动 revalidate。 | DONE（14 个 gate 测试） |
| F2 删除与重建 | `src/affective-state/mood-service.ts`、`affect-loop.ts`、`src/app/index.ts` | Mood 贡献账本（impulse/pause/resume/checkpoint），删除单一来源后重放；启动 replay deletion journal；self-state 重新验证。 | PARTIAL：reflection findings/routes 未物理删除；缓存/outbox 无全局 purge。 |
| F3 Inner Cognition 事务 | `src/app/companion-service.ts` | `observeTurn` 移入 assistant message 的 `afterPersist` 事务；失败回滚整条消息，提交后不会丢观察。 | PARTIAL：达到"同等可靠事务写入"，但没有复用 outbox 的 lease/退避/dead-letter。 |
| F4 人格隔离 | `src/app/companion-service.ts` | 用户 style 只写 G2，不再写 G1；G1 保持为空；G2 重启后保留。 | PARTIAL：隔离完成，但没有新的 Morrow-owned intrinsic G1 写入路径。 |
| F5 调查状态机 | `src/self-model/investigation.ts`、`src/app/index.ts` v59 | 9 状态、版本化转移、主/备假设、证据步、置信度、预算/暂停恢复；真实 CompanionGoal stall 接入；公式严格为 `P=clamp(0.20I+0.20G+0.20U+0.15N+0.15R-0.10C,0,1)`。 | PARTIAL：状态机持久可恢复，但没有外部证据采集工具。 |
| F6 检索基准 | `scripts/memory-retrieval-benchmark.ts`、`evals/memory-retrieval/benchmark/` | 100/500/1000/5000 条固定数据集；Recall@5、MRR、误召回、撤回/敏感泄漏、纠正准确率、p50/p95、冷启动。 | PARTIAL/BLOCKED：lexical 路径已跑；ONNX 语义通道因当前运行时无模型/无依赖/无调用点而阻断，未伪造对比。 |
| F7 Windows 产品路径 | `release/`、`C:\morrow-out`、`scripts/chat-ui-smoke.mjs` | 重建 win-unpacked、custom NSIS 安装包、portable ZIP；隔离安装、启动、聊天、卸载。 | PARTIAL：安装/启动/聊天/卸载已验证；真实云端 Provider `BLOCKED_NO_SECRET`；原生 consent 点击 `PENDING_HUMAN`。 |

## 2. 为什么此前多轮修复没有收敛（自我审计）

这一节按用户要求随报告提交，不是客套话，而是对过去几轮交付方式的直接归因。

### 2.1 把"覆盖面"当成"完成度"

Issue #74/#76/#78 的每一轮都产出了大量文档、矩阵和测试数量，但 F1–F7 的关键路径仍在使用 fail-open 或测试夹具。测试数量和报告页数给了我错误的进度感：1259 个测试通过并不等于"删除一个对话后，mood、reflection、prompt payload 都不再包含它"。真正应该先问的是"用户删除一条对话后，哪 7 张表、哪个索引、哪个 prompt 字段发生了变化"，而不是"这轮加了多少测试"。

### 2.2 先写单测、后接生产路径

Synthetic thought 的测试曾通过，但生产调用仍然在事务外丢失；mood 的 pause/decay 测试通过，但删除对话没有贡献账本；reflection gate 的测试通过，但 router 没有传完整来源，gate 只能靠调用方注入 owner/root。测试在夹具里绿了，产品路径没有绿。这是"只在测试夹具里通过"的典型，Issue #81 明确禁止，我此前没有完全做到。

### 2.3 没有先冻结 canonical evidence 模型

我先分别修 reflection、thought、mood、deletion，每个模块各自解析 owner/root/删除状态。结果是同一条证据在四个模块里有四种解释，修一个模块会破坏另一个。Issue #81 才建立 `evidence_lineage` 作为唯一图结构。正确顺序应该是：先冻结"什么是一条证据、它的 owner/root/parent/state 如何持久化"，再改所有投影；否则每轮都是在不同假设上打补丁。

### 2.4 遇到硬边界过早标 BLOCKED，或绕过去

NSIS 安装 exit 2 被长期当成环境阻塞，没有先检查两件事：`/D=` 路径含空格会被 NSIS 截断，以及旧安装目录/注册表会让静默安装走"已安装"分支。本次用无空格隔离路径 `C:\morrow81test` 得到 exit 0、文件落地、启动、聊天、卸载全部成功。ONNX 也是同理：没有先给出"当前 line 无模型/无依赖/无调用点"的可复现证据，导致语义检索长期悬空。真实 Provider 无密钥时应尽早区分 `BLOCKED_NO_SECRET` 与"没有做 loopback 产品路径"，而不是用前者掩盖后者。

### 2.5 范围控制失败，没有先做最小可验收纵切

每轮同时改 7 个 P0/P1，时间被拆成"写代码—补测试—写报告—打包"四段，任何一段出问题都会挤掉下一段。正确做法是先做一条纵切：**一条真实对话从 UI 到 SQLite，再删除它，验证 mood/reflection/self-state/prompt 四处归零**。这条纵切打通后，再横向扩展。此前几轮反过来了：先横向铺模块，纵切在最后才碰，于是总在最后发现"产品路径还没通"。

### 2.6 验收顺序错误：先单测/文档，后真实安装包

我多次在真实 Electron/NSIS 之前就把状态写成"已交付"，之后才发现 packaged app 的 consent、CDP reload、安装目录、portable 路径问题。正确顺序是：先构建最终 SHA 的包，跑真实安装/启动/聊天/卸载，再回来补单测和文档；至少两者必须并行，不能把产品验证留到最后。

### 2.7 对自己的 PASS 标签过度自信，缺少 SHA 绑定

Issue #78 的矩阵曾把代码 commit 写成 finalHead，导致报告数字与代码不对应。本轮把 sourceCommit/testedCommit/finalCodeSha 分开，并让 benchmark JSON、安装包、测试日志都绑定 `60ae6fe`。但这是被上一次错误逼出来的，不是一开始就有的纪律。

### 2.8 测试时间线本身没有冻结

本次全量回归发现一个既有测试在 2026-11-10 当天失败：v55 migration 用 wall clock 初始化 `emotion_states`，测试却把时间设到同一天的 01:00，被"当前时间 06:xx"钳制。这不是产品 bug，但说明测试夹具依赖真实日历，属于验收基础设施问题。本轮用 `clearHistory(origin)` 固定了时间线，没有降低断言。

### 2.9 任务本身也过大，但这不是主要理由

Issue #81 同时要求 7 个方向、12 份固定交付物、真实 Provider、Windows 安装包和全量回归，24 小时内确实过载。但任务大只解释"做不完全"，不解释"为什么之前几轮在同样位置反复失败"。主要原因是上面的优先级、纵切顺序和证据模型问题；任务描述是次要因素。

## 3. 本轮验证证据

- `npm run typecheck`：通过（0 error）。
- `npx vitest run`：**连续两轮均为 150 个测试文件、1276 个测试全部通过**（2026-11-10 14:28 与 14:34，两次日志见 `docs/reports/results/project-wide/run-20261110T0630Z-60ae6fe/`）。第一次全量运行暴露的 1 个时间线测试已固定，2 个 esbuild 临时目录写入失败是 Windows `%TEMP%` 权限问题，改用仓库内临时目录后不再出现。
- `npm run build`：通过（main 1,171.75 kB；preload 11.54 kB；renderer 140.75 kB）。
- `npm run smoke:chat-ui`：PASS（built Electron，loopback SSE，消息持久化）。
- 安装包内的 app：`MORROW_SMOKE_EXE=C:/morrow81test/Morrow.exe` → PASS。
- Portable ZIP 解压后的 app：`MORROW_SMOKE_EXE=C:/morrow81portable/Morrow.exe` → PASS。
- 安装：`<installer> /S /D=C:\morrow81test` exit 0，19 个文件，`Morrow.exe` 存在。
- 卸载：`C:\morrow81test\Uninstall.exe /S` exit 0，目录与 exe 均消失。
- 基准：100/500/1000/5000 条，Recall@5=1.0、MRR=1.0、误召回=0.10、撤回泄漏=0、敏感泄漏=0、纠正准确率=1.0；原始 JSON 见证据索引。
- 包 SHA-256：安装包 `80c15fb5…f7a9`；portable `276cc9ab…148c`。

## 4. 真实 Provider 与 consent

- 云端：环境没有 `MORROW_TEST_API_KEY` 或 `DEEPSEEK_API_KEY`，因此真实 DeepSeek 非流式/SSE 调用为 **BLOCKED_NO_SECRET**。没有用 loopback 冒充云端。
- Loopback：built、installed、portable 三种形态都完成了非流式/SSE 产品路径（Chat UI → preload → IPC → ChatService → loopback HTTP/SSE → SQLite），这是真实的代码路径，但不是云端 Provider 验证。
- Consent：安装在 `auto:false` 下记录到 `grant:false`，约 5 秒后出现 `remember:true` 的授权行；自动化没有观察到人类点击。原生对话框的真实交互仍为 **PENDING_HUMAN**。这不影响"安装后能聊天"的事实，但不能作为 consent UX 已验收的证明。

## 5. 未完成与风险（不得读成 PASS）

1. F2 的 reflection findings/routes 物理清理、全局 outbox/cache purge 未完成。
2. F3 没有 outbox 的 lease/指数退避/dead-letter；只有事务性写入。
3. F4 没有 Morrow-owned intrinsic G1 写入路径；G1 当前为空，用户 style 只进 G2。
4. F5 没有外部调查工具；状态机与证据步是本地可恢复框架，不是自主研究 Agent。
5. F6 没有语义通道；20 条标注查询不是 5000 条标注语料；1000 条候选窗口是生产上限，5000 条并不能全部竞争。
6. F7 云端 Provider 无密钥；原生 consent 点击未被人为确认；安装器只在本机 Windows 验证，未做多机/多语言回归。
7. 没有创建 Release，没有合并 PR #77/#80，没有修改 `main`。

## 6. 复现与证据位置

- 代码 SHA 绑定的基准 JSON：`evals/memory-retrieval/benchmark/2026-11-10T06-31-17-730Z-60ae6fe11e751bd7e5b80df942d231eade98b8eb.json`
- 机器结果：`evals/project-wide/results/2026-11-10T06-35-00Z-60ae6fe11e751bd7e5b80df942d231eade98b8eb.json`
- 验收矩阵：`docs/testing/project-wide-acceptance-matrix.md`
- 根因矩阵：`docs/audit/project-wide-root-cause-and-fix-matrix.md`
- 完整证据索引：`docs/reports/project-wide-evidence-index.md`
- 运行日志：`docs/reports/results/project-wide/run-20261110T0630Z-60ae6fe/`

## 7. PR / Issue 状态

- 本报告所在分支为 `fix/morrow-project-wide-final-convergence-20261110`，base 为 PR #80 的 head 分支 `fix/audit-driven-companion-remediation-20261109`。
- Draft PR：https://github.com/ve766/morrow-ai-companion-v2/pull/82（OPEN/Draft，base 为 PR #80 的 head 分支）。Issue #81 的交付评论包含 PR 链接、最终 SHA、命令/退出码与所有 PARTIAL/BLOCKED/PENDING_HUMAN。
- PR #77（`1b7ba085…`）与 PR #80（`094ca2cf…`）保持 OPEN/Draft，未被合并、关闭或覆盖。
