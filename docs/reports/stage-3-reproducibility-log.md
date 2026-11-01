# Stage 3 复现记录（独立审计）

- 被测 SHA（全部命令唯一对象）：`5fe62f546b84b0306e7f11e887bad9c75f3227ba`
- 审查工作区：独立克隆（`git init` + 本地 fetch 该 SHA → detached checkout），工作树在审查开始与结束时 `git status --porcelain` 为空（除本审查新增的六份审计文档与评测运行的未跟踪结果文件；后者未提交，作为工件引用）。
- 审查执行时间：2026-11-01（UTC+8 约 12:14–13:10）。

## 1. 环境与仓库核验

| 命令 | 退出码 | 结果 |
|---|---|---|
| `gh pr view 19 --json state,baseRefName,headRefOid,mergeable` | 0 | OPEN / base=feat/stage-2-delivery-hardening / head=5fe62f54 / MERGEABLE |
| `git ls-remote origin refs/heads/feat/stage-3-long-term-companion` | 0 | 远端 tip = 5fe62f54（与任务发布 SHA 一致，无他人提交） |
| `git fetch origin <head> <base> <main>`（本机直连 github.com 不稳，重试 7 次成功） | 0 | 对象就位 |
| `git rev-list --count <base>..<head>` / `--count <head>..<base>` / `git merge-base` | 0 | 33 / 0 / 84670792（merge-base=base tip，线性、base 未动） |
| `git status --porcelain`（审查克隆） | 0 | 空（干净树） |
| `grep -c "version:" src/persistence/migrations.ts`；`grep version: \| tail -5` | 0 | 40 项；最高 v38（intent_readings，:2109） |

## 2. 本机复跑（审查 SHA；Node v22.23.2 / win32 / registry.npmmirror.com 装依赖）

| 命令 | 退出码 | 结果 / 工件 |
|---|---|---|
| `npx tsc --noEmit` | **0** | 0 错误，11.4s |
| `npx vitest run --no-file-parallelism` | **1** | Test Files 1 failed / 94 passed (95)；**Tests 888 passed (888)**，460.5s。失败文件 `src/evaluation/offline-evaluation.test.ts` 为装载失败：esbuild 报 `Failed to write to output file: …%TEMP%\morrow-m3-cli-test-*\m3-cli.mjs: Access is denied`（环境，见 §6）。TEMP 重定向后单跑该文件 **6/6 过**（1.5s）。 |
| `npx vitest run src/evaluation/offline-evaluation.test.ts`（TEMP→工作区内 .tmp-smoke） | **0** | 6/6 通过 |
| `npx electron-vite build` | **0** | 成功 |
| `npm run eval:stage3` | **0** | 15 PASS / 1 NOT_RUN（L15→纵向运行器）；`evals/stage-3/results/20261101T045020Z-5fe62f5.json`（+summary），codeCommit=5fe62f54 |
| `npm run eval:stage3:ablation` | **0** | 4 臂；no_growth→L4+L12 FAIL、no_exploration→L5 FAIL、no_reflection→L5+L9 FAIL、全臂其余 PASS；`evals/stage-3/ablation/results/20261101T045045Z-5fe62f5.json` |
| `npm run eval:stage3:longitudinal` | **0** | PASS；7 断言（含正例 raised=1、+1h cooldown、+7h allowed、fresh=3/aged=1.5）；`evals/stage-3/longitudinal/results/20261101T045*5fe62f5.json` |
| `npm run eval:stage3:restart` | **0** | PASS；6 断言（记忆进 payload、漂移连续、兴趣来源不变、撤回出 payload）；`evals/stage-3/restart/results/…5fe62f5.json` |
| `npm run eval:stage3:long-conversation` | **0** | PASS；30 轮/3 会话；`evals/stage-3/long-conversation/results/…5fe62f5.json` |
| `npm run eval:stage3:intent` | **0** | counts {PASS:22, FAIL:0, BLOCKED:0, NOT_RUN:0}；`evals/stage-3/intent-understanding/results/…5fe62f5.json` |
| `npm run smoke` | **1** | 冒烟夹具编译即失败：esbuild 向 `%TEMP%` 写 `.mjs` Access is denied（§6） |
| `npm run smoke`（TEMP→工作区内） | **1** | 夹具编译通过；应用启动即退出 2147483651（**0x80000003** STATUS_BREAKPOINT，渲染进程） |
| `MORROW_SMOKE_DISABLE_SANDBOX=1 npm run smoke`（TEMP→工作区内） | **1** | 应用启动退出 3221225477（**0xC0000005**）；脚本自印提示"product still ships with sandboxed renderers" |

结论：可本地验证的全部工程门槛在审查 SHA 上通过；Electron 真实渲染层在本机不可启动（环境），其证据由 CI 提供。

## 3. 真实模型（scripted 分栏见上；本节为真实 Provider 分栏）

- 契约（`docs/testing/shared-real-model-test-contract.md`）：模型 `spark-x2.6`，endpoint `https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions`，凭据环境变量 `MORROW_TEST_API_KEY`，禁止打印/入库。
- 探测（审查环境，无值打印）：`[ -n "$MORROW_TEST_API_KEY" ]` → **NOT SET**；`.tmp/` 目录不存在；全盘无注入迹象。判定：**BLOCKED_NO_SECRET**。
- 解除条件与直接复跑命令（维护者本机、凭据不进聊天/评论）：
  `MORROW_TEST_API_KEY=<key> npm run eval:stage3:live`（live 套件 32 轮/3 会话）
  `MORROW_TEST_API_KEY=<key> npm run eval:stage3:intent:semantic`（C1 语义 6 场景/8 轮）
- 仓库内既有真实证据（本审查未重跑、仅审阅）：`evals/real-provider/results/20261031T085512Z-6a885fa.json` 等 3 份（876d263/ee728fd/6a885fa），全部 `clock: real`、spark-x2.6；断言 10 条分别 9/8/9 过；共同 FAIL=风格证据门槛；Morrow 兴趣 NOT_RUN；manualReview 全部 PENDING。**三份均绑定 6a885fa 及更早提交，早于 C1 主链改动。**

## 4. CI（GitHub Actions，替代本机渲染层证据）

| run | SHA | 触发 | 结果 | 步骤 |
|---|---|---|---|---|
| 41270227620 | 5fe62f54 | pull_request @ 2026-11-01T03:42:20Z | success | ubuntu 冒烟 15 步全 success；windows 15 步全 success；windows 升级路径 9 步全 success |
| 41270251780 | 5fe62f54 | pull_request @ 2026-11-01T03:42:44Z | success | 同上（3 job / 9+15+15 步全 success） |

CI 步骤明细（抽查 ubuntu job）：checkout → setup-node → `npm ci --ignore-scripts` →（死步骤 `npm rebuild better-sqlite3`，无害）→ typecheck → `npm test` → `npm run evaluate` + `npm run evaluate:cognition` → build → electron install → xvfb → `npm run smoke`（真实 Electron、隔离 profile）。**注意：CI 不运行任何 `eval:stage3\*` 套件。**

## 5. 仓库内既有结果文件的绑定审计

| 文件（相对 evals/） | codeCommit | 审查判定 |
|---|---|---|
| stage-3/results/…b0e719a（主套件最新） | b0e719a | 有效但**早于 C1 主链改动与迁移 v36–v38**，不能代表 HEAD |
| stage-3/intent-understanding/results/20261031T125539Z-6ae4520.json | 6ae4520 | 被 c1-behavior-matrix §三 指认 A3 断言空洞（假绿存档），不作证据 |
| stage-3/intent-understanding/results/20261031T161448Z-unknown.json | **unknown** | 机制套件 22/22 的最终引用文件；无 .git 工作树产出，**按任务规则 BLOCKED（不能绑定）**；本审查复跑已用绑定 5fe62f54 的新结果替代其作用 |
| 其余 5 份 …Z-unknown.json（intent/semantic） | unknown | 同上；其中 2 份 semantic 本身即 BLOCKED_NO_SECRET 记录 |
| real-provider/results/…（3 份 live） | 876d263/ee728fd/6a885fa | 有效 live 证据，但均早于 a0405cd 起的 C1 改动 |
| **任何绑定 5fe62f54 的既有结果** | — | **不存在**（本审查复跑前） |

## 6. 环境缺陷记录（审查机，非代码缺陷）

1. **esbuild 无法写 %TEMP%**：node 直写同目录成功、esbuild（子进程）一律 `Access is denied`；与 ZCode 沙箱无关（非沙箱模式同样失败）。绕过：`TEMP/TMP` 指向工作区内目录。影响：离线评测测试文件装载与冒烟夹具编译（两处均用 esbuild 产临时 .mjs）。
2. **渲染进程启动崩溃**：0x80000003（默认）→ 0xC0000005（`--no-sandbox`），与 phase-2.1 报告记录的本机长期问题同签名；DevTools 监听已建立后进程退出。CI 双平台同 SHA 通过，判本机环境。

## 7. 未运行项与原因

| 项 | 状态 | 原因/解除条件 |
|---|---|---|
| 真实 Provider 重跑（审查 SHA） | BLOCKED_NO_SECRET | 无凭据；命令见 §3 |
| C1 语义套件（审查 SHA） | BLOCKED_NO_SECRET | 同上 |
| Windows 安装/升级/卸载 | NOT_RUN | 无干净授权 Windows 机器与安装包构建 |
| 真人人工复核 | NOT_RUN（本轮以 AI 审阅替代性补充，见 acceptance §5） | 需维护者执行 |
| 置信度校准 | NOT_RUN | 无标注集 |
| 本机 Electron 冒烟 | BLOCKED（环境） | §6-2；解除条件：更换主机或修复本机 GPU/沙箱环境 |
