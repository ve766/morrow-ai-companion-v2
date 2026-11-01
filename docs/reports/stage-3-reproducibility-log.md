# Stage 3 可复现日志

- 审查 SHA：`5fe62f546b84b0306e7f11e887bad9c75f3227ba`
- 执行位置：`E:\Hasee\Documents\morrow-stage3`（内容已证明与上述 SHA 等价，见 `stage-3-runtime-and-data-lineage-review.md` §1）
- 环境：Windows 11 / Node `v22.22.2` / npm 随 Node / Electron 由 `node_modules` 内置
- 时间：`2026-11-01T04:23:10Z` → `2026-11-01T04:33:12Z`（10 分 02 秒）
- 日志原件：`E:\Hasee\Documents\.review-run.log`

---

## 一、命令与退出码（逐条实测）

| # | 命令 | 退出码 | 关键输出 |
|---:|---|---:|---|
| 1 | `npx tsc --noEmit` | **0** | 无输出 |
| 2 | `npx vitest run --no-file-parallelism` | **0** | `Test Files 95 passed (95)` / `Tests 894 passed (894)` / `Duration 474.95s` |
| 3 | `node scripts/run-evaluation.mjs` | **0** | `passed: true`，m3 11 例、m4 19 例 |
| 4 | `node scripts/run-cognitive-core-evaluation.mjs` | **0** | 四套数据集 `gate.passed: true`，`durationMs 855.88` |
| 5 | `npx electron-vite build` | **0** | `out/renderer/index.html 25.04 kB` 等三产物 |
| 6 | `unset ELECTRON_RUN_AS_NODE && node scripts/smoke.mjs` | **0** | `Morrow smoke passed: built Electron app …`（无 `[sandbox disabled for this host]`） |
| 7 | `npm run eval:stage3:intent` | **0** | `denominator 22`，`FAIL 0 / BLOCKED 0 / NOT_RUN 0` |
| 8 | `npm run eval:stage3:intent:semantic` | **0** | `"status": "BLOCKED_NO_SECRET"` |

第 8 条退出码 0 是契约行为（缺凭据是被记录的结果，不是运行失败），**不是通过**。

## 二、可复现性细节（两个容易被误读的点）

### 2.1 单测耗时不是常量

同一棵树，10:4x 的一次串行跑是 **342.01s**，本次 **474.95s**。差异来自机器负载（同时有克隆/比对进程），不是回归。vitest 自己给了提示：`isolate: false` 可省约 45.66s。**结论只看 894/894，不看秒数。**

### 2.2 `deterministicHash` 稳定，`reportSha256` 不稳定

| 字段 | 10:4x 那次 | 本次 | 说明 |
|---|---|---|---|
| `deterministicHash` | `209d8d37…` | `209d8d37…` | **相同** → 计算过程一致 |
| `reportSha256` | `fec15247…` | `c9ca5d51…` | **不同** → 报告文件内嵌生成时间 |

引用时只能用 `deterministicHash` 证明"同输入同结果"；用 `reportSha256` 会得出"不可复现"的错误结论。

## 三、本次重跑产生的工件（未提交）

| 文件 | 性质 |
|---|---|
| `evals/stage-3/intent-understanding/results/20261101T043224Z-unknown.json` | 新的机制套件结果 |
| `evals/stage-3/intent-understanding/traces/20261101T043224Z-unknown.jsonl` | 对应 traces |
| `evals/real-provider/results/20261101T043310Z-unknown-semantic.json` | 新的 `BLOCKED_NO_SECRET` 记录 |
| `evaluation/reports/m3-*.json`、`m4-*.json` | 重新生成（本地本就未被 git 跟踪） |

另有 4 个**已跟踪**的评估报告被重跑覆盖，已从 `5fe62f5` 的 blob 还原并逐个校验为 `MATCH`：

```
evaluation/reports/cognitive-alpha-adversarial-report.json
evaluation/reports/cognitive-turn-synthetic-example.json
evaluation/reports/feeling-synthetic-example.json
evaluation/reports/intent-decision-synthetic-example.json
```

因此除本组六份审计文档与上述新增工件外，工作树与 `5fe62f5` 保持一致。

## 四、真实模型（分栏，不与 scripted 混记）

| 项 | 状态 | 证据 |
|---|---|---|
| `MORROW_TEST_API_KEY` | 缺失（长度 0） | 见 `docs/audit/stage-3-provider-credential-audit.md` |
| 本轮真实运行 | **BLOCKED_NO_SECRET** | 第 8 条命令的输出 |
| 历史真实运行（2026-10-31） | 3 次 × 32 轮 / 3 会话 | `evals/stage-3/live/results/`、`evals/real-provider/results/` |
| 人工复核 | **NOT_RUN** | `manualReview.status = "PENDING"` |

脚本化 Provider 的结果只能证明机制，**本栏与上一栏不得合并统计**。

## 五、未运行（不得写成 PASS）

| 项 | 原因 | 解除条件 |
|---|---|---|
| GitHub Actions | 账号计费，run `41178081914` 未启动 | 恢复计费/提额 |
| Windows 安装 → 升级 → 卸载 | 无干净机器 | 在目标环境执行并留档 |
| 真实模型语义对话 | 无凭据 | 注入 `MORROW_TEST_API_KEY` |
| 人工互动质量 | 无人执行 | 独立审查者逐条阅读并署名 |
| 跨天记忆连续性 | 未构造 | 注入时钟的纵向用例 + 真实隔日会话 |

## 六、复跑方式（供独立审查者）

```bash
git clone --depth 1 --single-branch --branch feat/stage-3-long-term-companion \
  https://github.com/ve766/morrow-ai-companion-v2.git
cd morrow-ai-companion-v2
git rev-parse HEAD                      # 应为 5fe62f5…
npm ci
npx tsc --noEmit; echo $?
npx vitest run --no-file-parallelism; echo $?
node scripts/run-evaluation.mjs; echo $?
node scripts/run-cognitive-core-evaluation.mjs; echo $?
npx electron-vite build; echo $?
unset ELECTRON_RUN_AS_NODE; node scripts/smoke.mjs; echo $?
npm run eval:stage3:intent; echo $?
npm run eval:stage3:intent:semantic; echo $?   # 无凭据时应为 0 且写 BLOCKED_NO_SECRET
```

若第 2 条出现失败，先确认 `node_modules` 是否完整（本仓库依赖含 Electron 二进制，`--ignore-scripts` 安装会导致 4 个套件 import 失败，那是环境问题不是代码缺陷）。
