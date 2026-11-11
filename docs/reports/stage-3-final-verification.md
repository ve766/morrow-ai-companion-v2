# Stage 3 最终验证记录

- 执行时间：2026-10-31T16:00Z – 2026-11-01T02:30Z（本机 Windows 11 / Node 22.22.2 / Electron 内置二进制）
- 工作树：`E:\Hasee\Documents\morrow-stage3`，**无 `.git`** → 所有结果文件 `codeCommit: "unknown"`、`workingTree: "unknown"`，本文不主张"某 commit 做了什么"
- 口径：PASS / FAIL / BLOCKED / NOT_RUN。**非 PASS 不计入通过率**；BLOCKED 与 NOT_RUN 都不算通过。

---

## 一、命令级结果（逐条为真实退出码）

| # | 命令 | 退出码 | 关键输出 | 结论 |
|---|---|---:|---|---|
| 1 | `npx tsc --noEmit` | 0 | 无输出（含 `evals/**`） | PASS |
| 2 | `npx vitest run --no-file-parallelism` | 0 | `95 passed (95)` / `894 passed (894)` / 342.01s | PASS |
| 3 | `node scripts/run-evaluation.mjs` | 0 | 两套数据集 `passed: true` | PASS |
| 4 | `node scripts/run-cognitive-core-evaluation.mjs` | 0 | 四套数据集 `gate.passed: true` | PASS |
| 5 | `npx electron-vite build` | 0 | main/preload/renderer 三产物写出 `out/` | PASS |
| 6 | `node scripts/smoke.mjs`（先 `unset ELECTRON_RUN_AS_NODE`） | 0 | `Morrow smoke passed: built Electron app …` | PASS |
| 7 | `npm run eval:stage3:intent` | 0 | 22/22 场景、88/88 断言 | PASS（机制层） |
| 8 | `npm run eval:stage3:intent:semantic` | 0 | `BLOCKED_NO_SECRET` | **BLOCKED** |

第 8 条退出码为 0 是**契约要求**，不是通过：缺凭据必须写成 blocked 记录，不得伪装成 pass、不得崩、不得用脚本化 Provider 顶替（`docs/testing/shared-real-model-test-contract.md` §6）。

## 二、第 2 条：894 个单测

串行执行（`--no-file-parallelism`）以避免 SQLite 单文件库在并行下的锁竞争噪声。此前并行的 `provider-retry` 套件曾出现偶发失败，已定位并修复（见任务 #20），本轮串行全绿即为该修复的复核。

- 文件 95，用例 894，失败 0。
- 该数字**含** C1 相关套件：`intent-reading`、`speech-act`、`intent-decision`、持久化/重启、删除传播。
- 该数字**不含** `evals/**`（评估脚本不在 vitest 收集范围内，它们是独立可执行程序）。

## 三、第 3 条：离线评估（记忆与提醒）

| 数据集 | 用例 | 结果 |
|---|---:|---|
| `morrow-synthetic-memory-retrieval` | 11 | 基线 `m1-substring` P=0.40 / R=1.00 → 候选 `scope-aware-token` P=1.00 / R=1.00；source/scope/restricted/unknown 四类泄漏均 0；`m2Safety: true` |
| `m4-synthetic-reminder-report` | 19 | P=1.00 / R=1.00，误报 0，安全泄漏 0 |

可复现性：两套各写出 `deterministicHash`（`209d8d37…`、`b61fcb94…`）与 `reportSha256`，同输入重跑哈希一致。报告落在 `evaluation/reports/`。

**这组数字证明什么**：检索的作用域隔离与提醒的抑制逻辑在合成集上成立。**不证明**真实用户语料上的检索质量——数据集是构造的，基线也是构造的。

## 四、第 4 条：认知核心离线评估

| 数据集 | 用例 | 关键指标 | gate |
|---|---:|---|---|
| `cognitive-turn-synthetic-v1` | 26 | intentAccuracy 1 / strategyAccuracy 1 / correction P=R=1 / deterministicReplay true | passed，`failedChecks: []` |
| `morrow-feeling-synthetic` | 34 | 事件检出 P=R=1；`userAffectTransferCount 0`；`attentionBoundViolations 0`；`evidenceTraceabilityFailures 0` | passed |
| `morrow-cognitive-alpha-adversarial` | 28（含 19 安全关键） | 意图/策略允许集 1；`safetyCriticalPassRate 1`；`rawEventTextLeaks 0` | passed |
| `intent-decision-synthetic-v1` | 25 | 12 类意图逐类全对 | passed |

离线性：`offlineExecution = { providerCalls: 0, networkCalls: 0, networkGuarded: true, toolCalls: 0 }`，总耗时 443 ms。

**校准声明照原样保留**：`calibration.measured = false`，附明确限制——"规则强度分与不确定性桶不是校准过的概率；本合成夹具无法建立置信度校准或真实用户准确率；不主张 ECE、Brier 或可靠性曲线"。任何引用本文件的地方都不得把这组 1.00 说成"模型准确率"。

## 五、第 6 条：Electron 冒烟（本轮状态变更）

```
unset ELECTRON_RUN_AS_NODE && node scripts/smoke.mjs
→ exit 0
→ Morrow smoke passed: built Electron app, default-off DeepSeek configuration,
  secure credential save/restart/delete (encrypted-restart-corruption-protected-
  then-explicit-delete-verified, no Provider requests), cognitive default-off/
  explicit opt-in and restart persistence, no fabricated reply, M1 memory lifecycle,
  M2 goal and approval safety, M4 reminder controls, local persistence, deletion,
  and restart verification.
```

三点必须记清，否则会被读成比实际更强：

1. 输出里**没有** `[sandbox disabled for this host]` 后缀，且 `scripts/smoke.mjs:27` 判定 `sandboxDisabled = (MORROW_SMOKE_DISABLE_SANDBOX === '1') || platform === 'linux'`。本机是 win32 且未设该变量 → **未传 `--no-sandbox`**，渲染进程沙箱是开着的。此前会话记录的"渲染进程沙箱初始化即崩 `0x80000003`"在本轮**未复现**；差别在启动脚本会从子进程环境里删掉 `ELECTRON_RUN_AS_NODE`（`scripts/smoke.mjs:57`），带着它 Electron 会退化成 Node 而不起窗口。
2. 输出是 `built Electron app`，**不是** `installed Windows app` → 验证的是构建产物，不是安装包升级路径。
3. 它验证的是"能不能起、IPC 通不通、重启后还在不在、删除后还引不引用"，**不是**界面逐屏正确性，也**不发起任何 Provider 请求**（`no Provider requests`）。

## 六、第 7、8 条：C1 双套件

| | 机制套件 | 语义套件 |
|---|---|---|
| 命令 | `eval:stage3:intent` | `eval:stage3:intent:semantic` |
| `suite` 字段 | `mechanism` | `semantic` |
| Provider | `scripted (not a model)` | 真实模型（`spark-x2.6`） |
| 本轮结果 | 22/22 场景、88/88 断言、`counts: {PASS:22}` | `BLOCKED_NO_SECRET` |
| 能主张 | 线路接通、规则按写定的方式生效 | 本轮**无主张** |

机制套件的 22/22 不能替语义套件说话：Provider 是字符串，语言理解不在其中。详见 `docs/reports/stage-3-c1-behavior-matrix.md` 与 `docs/reports/stage-3-real-provider-evidence.md`。

## 七、仍未通过 / 未运行（不得计入）

| 项 | 状态 | 依据 |
|---|---|---|
| C1 真实模型语义证据 | **BLOCKED** | `MORROW_TEST_API_KEY` 缺失，记录 `BLOCKED_NO_SECRET`；见凭据审计 |
| 人工复核（回复是否自然、是否像长期陪伴） | **PENDING** | 唯一真实长跑的 `manualReview.status = "PENDING"`，无人逐条读过 |
| 置信度校准 | **NOT_RUN** | 无标注集；离线评估自陈 `calibration.measured = false` |
| CI（双平台） | **BLOCKED** | GitHub Actions 未启动：*"The job was not started because recent account payments have failed or your spending limit needs to be increased."*（run `41178081914`） |
| Windows 安装包升级 / 干净机器 | **NOT_RUN** | 只验证了 `out/` 构建产物 |
| 语音 ASR/TTS | **NOT_RUN** | 未实现 |
| 语义级"她是否真的提起了"检测 | **PARTIAL** | 仍是词面 + 形态双检 |

## 八、结论

本机工程验证链**全绿**：类型、894 单测、两组离线评估、构建、真实 Electron 冒烟、C1 机制套件。

但"全绿"只覆盖**可离线判定的部分**。Stage 3 的整体状态仍是 **PARTIAL**：C1 的语义证据 BLOCKED、人工复核 PENDING、CI BLOCKED、语音与语义级探索检测未做。**不建议合并 PR #19**——这个结论不因本次全绿而改变。

> **订正（状态截至修复轮，见 docs/reports/stage-3-final-remediation-report.md）**：本文为历史记录，以下表述已被后续事实取代——live 断言计数应为 10 断言 9 PASS 1 FAIL；CI 已在 5fe62f54 及后续 HEAD 全绿（run 41270227620/41270251780 及修复轮 run）；G1 生产链已按 D-1 重写（见 docs/algorithms/personality-growth-runtime-v2.md）；Electron renderer 在 CI 双平台 PASS、特定本机环境 BLOCKED，两态并存。
