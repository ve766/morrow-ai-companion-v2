# Stage 2 真实 Provider 原始报告

本目录存放 `scripts/phase24-real-model.ts` 的**原始输出**。文件内容逐字节保留，未做任何改写（复制时已用 SHA-256 校验一致）。

## `phase24-real-model-26aeac7.json`

| 项 | 值 |
|---|---|
| 生成时间（UTC） | 2026-10-30T05:33:18.152Z |
| 生成时代码 SHA | `26aeac77cc8867465202496e30f9e0694762df0b`（完整值见 JSON 内 `codeSha`） |
| 模型 | `spark-x2.6` |
| 端点 | `https://maas-api.cn-huabei-1.xf-yun.com` |
| 运行命令 | 见下方 |
| 退出码 | 0 |
| 环境变量（仅变量名，不含值） | `MORROW_SPARK_API_KEY`、`MORROW_SPARK_MODEL`、`MORROW_REAL_RUNS`、`MORROW_SPARK_TIMEOUT_MS`、`MORROW_SPARK_BUDGET_MS` |
| 每场景运行次数 | 1（`runsPerScenario`，小样本） |
| 单次调用超时 / 整次预算 | 120000 ms / 300000 ms（见 JSON 内 `providerTimeoutMs` / `providerBudgetMs`） |
| 客观断言 | **13 / 13**（`objectiveSkipped: 1` 为 S4 整场景跳过） |
| 场景结果 | S1 PASS、S2 PASS、S3 PASS、S4 **SKIPPED**、S5 PASS、S6 PASS |

```
MORROW_SPARK_API_KEY=<env> \
MORROW_SPARK_MODEL=spark-x2.6 \
MORROW_REAL_RUNS=1 \
MORROW_SPARK_TIMEOUT_MS=120000 \
MORROW_SPARK_BUDGET_MS=300000 \
node node_modules/.bin/../.cache/phase24-real.cjs
```

（`.cjs` 由 `esbuild scripts/phase24-real-model.ts --bundle --platform=node --format=cjs --external:electron` 生成；命令与脚本头部注释一致。）

## 这份证据能证明什么、不能证明什么

**能证明**：在这台机器、这次运行里，真实模型参与下 S1/S2/S3/S5/S6 的客观断言全部成立——偏好候选被持久化并进入后续请求、撤回后不再投递、无证据时不投递、状态影响会加宽检索、失败重试只产生一条回答。

**不能证明**：

- **不是成功率**。每个场景只跑了 1 次，样本量为 1。
- **不是 6/6**。S4（跨模型切换）因为只有**一个**模型 id 而 SKIPPED，不能计入通过。
- **不是模型质量评价**。主观检查（`subjectiveScored: 3`，匹配 2）是词面代理，单独计数，未并入客观断言。
- **不含安装器/桌面路径**。桌面证据在 `npm run smoke`，安装器升级未验证。

## 为什么之前访问 404

`.gitignore` 第 18 行 `evaluation/reports/*` 把脚本默认输出目录整体忽略，所以该报告生成后一直只在本地，**从未提交**。本文件是它第一次进入仓库。生成脚本的输出路径未改动（仍写 `evaluation/reports/`），因此后续运行需要手动复制到本目录，或按需在 `.gitignore` 中放行。
