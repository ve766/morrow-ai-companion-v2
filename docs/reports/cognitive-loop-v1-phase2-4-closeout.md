# Phase 2.4 Stage 1 Closeout（issue #14）

分支：`feat/cognitive-loop-v1-phase2-4-continuity`
基线：`46defb6454a452416679623cd6ae60ad57cf3cea`
代码提交：`8cb3761`
报告提交：见 §9（在其后）
`main`：`8b207b7`（未改动、未合并、未发布）

**结论：BLOCKED。** 代码侧整改完成并已实测；但任务要求的「真实模型六场景运行」与「桌面运行」两项无法在本环境完成，因此不宣称完整验收。

---

## 1. 审查结论（改动前）

对 `scripts/phase24-real-model.ts` 及其依赖逐条核对，issue 指出的问题全部属实，并额外发现一处更严重的统计缺陷：

| 编号 | 问题 | 影响 |
|---|---|---|
| S1 | 先用 `memories.create` 预置记忆，再在**同一次**首轮提问 | 测的是单轮检索，不是跨轮偏好复用 |
| S4 | 缺少 `MORROW_SPARK_MODEL_2` 时把 `nextModel = model` 重配一遍 | 没有发生切换，却按"切换成功"计通过 |
| 统计 | `checks.every(...)` 对空数组返回 `true` | **一次运行若没产生任何断言，会被算作通过** |
| S2 | 只断言"撤回后未投递" | 检索本来就没命中时同样"通过"（假阳性） |
| S3 | 仅用正则判断有无车牌 | 场景库里若已有车牌记录，检查会空转 |
| S6 | 只排除 `no-error` / `UNKNOWN` | `CONFLICT`、`INVALID_INPUT` 等应用错误也能满足"发生了失败" |
| 同意 | 脚本自行批准 `ProviderConsentPreview` | 未说明它与产品同意流程的差别，易被当成同意链路证据 |

## 2. 修复内容

### S1 —— 改为真正的跨轮偏好复用

第一轮：用户陈述偏好 `我养了一只叫咪咪的猫。`，随后走**产品真实保存路径**（`proposeMemorySuggestions` → 用户接受 → 来源记为 `model_inferred_confirmed`）。
第二轮：同一会话内提问 `我的猫叫什么名字？`，**不重复原句**。

客观断言两条：① 第一轮结束时偏好已落库且来源正确；② 该记忆 id 出现在第二轮的序列化请求中。
回复是否说出"咪咪"单独记为主观项，不并入客观通过率。

### S4 —— 不再把同模型重配当作切换

- 无 `MORROW_SPARK_MODEL_2`：该场景整体记为 **skipped**，从分子分母同时剔除，状态不为 pass。
- 有第二个模型：分别断言第 1 轮记录的 `provider.model` 等于模型 A、第 2 轮等于模型 B（读的是**轮次记录里的实际模型**，不是配置意图），再校验人格版本、记忆 id、状态修订号连续。

### 统计口径 —— 异常与空断言不可能变成通过

- 每次运行若抛出异常 → 记入 `errors`，该次不计通过；
- 若某次运行没有产生任何客观断言 → 判 `fail`（"什么都没断言"不等于"全部成立"）；
- `skipped` 项不计入分子也不计入分母；
- 新增 `attempts / completed / skipped` 三个计数，`completed === 0` 直接判 `blocked`。

### S2 —— 增加正对照

撤回**之前**先问一次，断言该记忆确实被投递；再撤回，断言请求中既无该 id 也无该值，且库中状态为 `retracted`。这样"未投递"只有在"曾经能投递"的前提下才算数。

### S3 —— 增加场景诚实性断言

先断言库中不存在车牌类记录（`seeded === 0`），再检查交付文本里没有车牌形态的值，并记录门控判定。

### S6 —— 只接受 provider 类错误

要求错误码以 `PROVIDER_` 开头，并分别断言：失败轮未写助手消息、该轮记录为 `failed`、重试后恰好一条助手消息且其 id 与返回一致、轮次记录为 `succeeded`。

### 同意自动化 —— 明确标注

报告新增字段：

```json
"consent": { "mode": "auto_approved_harness", "production_equivalent": false }
```

产品路径会把 `ProviderConsentPreview` 展示给用户并要求显式批准后才发出请求；本脚本自行合成批准。因此**本脚本只能说明模型行为，不能作为同意流程的证据**。这句话同时写进了脚本注释、报告字段与 limitations 列表。

## 3. 实际执行的检查（命令与退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无输出 |
| `npx tsc --noEmit --strict --exactOptionalPropertyTypes scripts/phase24-real-model.ts` | 0 | 脚本单独严格检查通过（该目录不在 tsconfig include 内） |
| 聚焦测试：phase24 集成 + 待办 + 迁移 | 0 | **45 passed** |
| `npx vitest run --maxWorkers=2` | 0 | **569 passed / 63 files** |
| `npm run build` | 0 | 成功 |
| `npm run evaluate` | 0 | `passed:true` |
| `npm run evaluate:cognition` | 0 | 四套件 gate 全过，`providerCalls = 0` |
| `npm run verify:phase23` | 0 | `ok:true` |
| Phase 2.3 五套件 | 0 | 66 passed |
| esbuild 打包脚本 | 0 | 316.8 kb |
| 无密钥运行脚本 | **2** | 打印缺失说明后退出，**零请求** |

## 4. 场景级结果

| 场景 | 状态 | 说明 |
|---|---|---|
| S1 跨轮偏好复用 | **BLOCKED** | 需要真实模型完成"提议 → 接受 → 下轮复用" |
| S2 撤回 | **BLOCKED** | 同上 |
| S3 无证据 | **BLOCKED** | 同上 |
| S4 模型切换 | **BLOCKED** | 同上（且需要第二个模型 id） |
| S5 状态影响 | **BLOCKED** | 同上 |
| S6 失败重试 | **BLOCKED** | 同上 |

**六项一次都没有对真实模型运行过。** 本轮只验证了运行器本身：打包、严格类型检查、无密钥时的干净退出。脚本的场景执行体从未被执行——这是本轮最需要如实标注的残留风险。

## 5. 真实模型验证为何未执行

本机不存在可用凭据，逐处核查：

| 位置 | 结果 |
|---|---|
| 环境变量 `MORROW_SPARK_API_KEY` / `SPARK_API_KEY` / `IFlyTek_API_KEY` / `DEEPSEEK_API_KEY` / `MORROW_DEEPSEEK_API_KEY` | 全部 absent |
| `%APPDATA%\morrow-ai-companion\morrow.sqlite3` | `provider_profiles` **0 行** |
| `%APPDATA%\morrow\data`、两个 userData 目录 | 无 `*secret*` / `*credential*` / `*.bin` |
| 仓库 | 无 `.env`、无密钥文件 |

2026-10-28 曾用一把 Spark 密钥完成 Phase 2.2 的 100 次调用，之后按"密钥不落盘"删除临时文件并提示轮换，无法复用（历史对话索引检索亦为 0 条）。

## 6. 桌面运行证据（与 CI 分开记录）

| 项目 | 值 |
|---|---|
| 操作系统 | Windows `10.0.26200` |
| Node | `v22.22.2` (win32 x64) |
| Electron | `44.9.3` |
| `npm run build` | 0 |
| `npm run smoke` | **1** |

失败信息（与基线一致，非本轮引入）：

```
Morrow smoke failed during smoke fixture compilation:
  The built renderer did not expose its typed preload bridge.
{"level":"error","source":"app","msg":"window load failed","fields":{"code":"renderer-load-failed"}}
GPU process exited unexpectedly: exit_code=-1073741819
```

对照：在基线 `872367c` 上重新构建后跑同一命令，报错逐条相同。

**CI 状态：未运行。** 本会话没有任何 CI 触发，因此不存在 Linux/xvfb 下的桌面证据；桌面运行一律记为 BLOCKED，不以构建成功替代。

## 7. 验收门对照

| 门 | 状态 | 依据 |
|---|---|---|
| 无未解决的 P0/P1（隐私泄漏、撤回失效、数据丢失、重复/错误收尾） | **PASS** | 上轮整改 + 本轮审计；隐私负向测试、撤回正对照、崩溃恢复故障注入均通过 |
| S1 真正测试跨轮偏好复用 | **PASS（代码）** / 未运行 | 已改为首轮建立、次轮复用；场景本身 BLOCKED |
| S4 不会在未切换时暗示切换 | **PASS（代码）** | 无第二模型即 skipped；有则断言实际 model id |
| 所有计数可从原始行复现，客观/主观分离 | **PASS（代码）** | 逐项 checks 落盘；空断言判 fail；skipped 剔出分母 |
| 不改 `main`、不合并、不发布 | **PASS** | `origin/main = 8b207b7` |
| 凭据或桌面不可用时明确说明 | **PASS** | §5、§6 明确标 BLOCKED |

## 8. 结论与剩余风险

**BLOCKED** —— 不是"代码没改完"，而是两项必需验证无法在本环境完成：

1. 真实模型六场景 **0 次运行**（无凭据）；
2. 桌面冒烟 **不可用**（本机 Electron 渲染进程崩溃，基线与当前一致）。

要转为 PASS WITH LIMITATIONS，只需提供一次可用凭据并跑通六场景；要转为 PASS，还需在能正常启动桌面的环境（或 Linux + xvfb 的 CI）跑通 `npm run smoke`。

其他残留风险：

- 运行器的场景执行体从未真正跑过，首次真实运行仍可能出现断言口径问题；
- S3 的车牌识别是词法代理，非标准格式的编造值可能漏检（已在 limitations 标注为主观项）；
- 同意自动化使得该脚本不能用于评估产品同意流程。

## 9. 提交

- 代码：`8cb3761`
- 本报告：随后提交（见 `git log`）
- 建议：以 Draft PR 合入 `feat/cognitive-loop-v1-phase2`；**不合并、不发布、不改 `main`**。
