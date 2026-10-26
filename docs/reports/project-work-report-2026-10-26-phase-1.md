# Morrow V2 · 第一阶段工作报告：工程收尾与回归保护

| 项 | 值 |
|---|---|
| 报告日期 | 2026-10-26 |
| 仓库 | `github.com/ve766/morrow-ai-companion-v2` |
| 工作分支 | `chore/phase-1-engineering-consistency` |
| 基线 | `main` @ `8b207b7` |
| Pull Request | **#2** — https://github.com/ve766/morrow-ai-companion-v2/pull/2 |
| PR 状态 | **OPEN / 未合并**（等待人工审查与审计） |
| 报告版本 | **第 2 版**（2026-10-26 审计修正：仅修正完成状态表述，未改任何验证结论、未改任何代码） |
| CI 运行（实质改动 `44ffe42`） | [run 40308680325](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40308680325) — **success**（3 / 3 Job） |
| CI 运行（报告第 1 版 `fd6c6cd`） | [run 40309704692](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40309704692) — **success**（3 / 3 Job） |
| CI 覆盖范围 | **仅限 `.github/workflows/ci.yml` 定义的检查项**；不含真实 Provider 对话、不含 Windows 安装包实际打包（见 §1.1、§1.2） |

本报告中的所有事实均来自本次实际执行的命令输出。凡未执行、失败或无法验证的项目，均在 §1.1 与 §6 单独列明，不与通过项混写。

---

## 1. 任务目标与实际完成情况

目标：修复审计报告确认的工程不一致，**不改变现有产品行为**，为下一阶段真实对话验证建立稳定基线。

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| 1 | 统一版本号 | **已完成** | `package.json` + `package-lock.json` 根字段 1.0.0 → 2.0.0；未创建 tag / Release |
| 2 | 清理失效 CI 步骤 | **已完成** | 删除两个 job 中的 `npm rebuild better-sqlite3`（−5 行）；确认项目使用 `node:sqlite`；未改动其他 CI 行为 |
| 3 | 修正文档 | **已完成** | README、验收报告、旧资产审计三处 SQLite 表述修正；补全 `verify` 命令链与 Node 版本依据 |
| 4 | 回归验证 | **已完成（本地 smoke 除外）** | typecheck / 268 测试 / 两组离线评估 / build 本地通过；smoke 本地失败但 CI 通过，判定为环境问题（§6.1） |
| 5 | 提交并创建 PR | **已完成** | 5 个提交已推送（3 个实质改动 + 2 个报告文档），PR #2 已创建，**未合并** |
| 6 | 交付报告 | **本文件** | — |

**完成状态的准确表述**：本阶段的**工程收尾任务**（版本号统一、CI 死步骤清理、文档修正、回归验证）已完成，并已通过 PR #2 提交审查。但**产品能力验证仍有未覆盖项**——本阶段并未、也不能宣称真实陪伴能力已经验收。未覆盖项见 §1.1；失败与无法验证项见 §6。

### 1.1 验证边界与未覆盖项

本阶段交付的是**工程基线**，不是产品验收。以下三项**未执行**，且不在本阶段范围内，其结论不得由本报告的 CI 结果推导：

| # | 未覆盖项 | 状态 | 说明 |
|---|---|---|---|
| A | **真实 Provider 多轮对话端到端验证** | **未执行** | 本阶段未使用任何真实 Provider 凭据发起对话，未发起任何真实云端请求。因此以下均**未验证**：多轮上下文连贯性、记忆召回路在真实语料上的实际效果、人格与内在状态在长对话中的行为、模型回复质量。CI 与本地评估输出中的 `providerCalls: 0` / `networkCalls: 0` 恰恰**证明这类调用一次都没有发生**——它是"离线可复现"的证据，不是"真实对话可用"的证据。 |
| B | **Windows 安装包实际打包验证** | **未执行** | `npm run package:win`（electron-builder NSIS）未运行，未产出任何 `.exe`，未验证安装、覆盖升级、卸载、签名与产物命名。`Morrow-Setup-2.0.0-x64.exe` 这一名称是由 `package.json:50` 的 `artifactName` 模板**推导**得出，不是实测结果。 |
| C | **真实陪伴效果验收** | **未执行** | 对话质量、长期记忆可用性、逐轮同意摩擦对留存的实际影响，均需真实使用后才能评估。本阶段无任何此类数据。 |

### 1.2 「CI 通过」的准确含义

CI 全绿只证明一件事：**当前 `.github/workflows/ci.yml` 所定义的那几项检查，在这两个 runner 上通过了**。具体是：类型检查、268 个单元/集成测试、两组合成 fixture 离线评估、构建产物生成，以及在隔离 profile 与无网络出口条件下的 Electron 冒烟。

它**不能**推出：真实模型回复质量合格、多轮对话可用、记忆在真实语料上有效、安装包可用、产品体验达标。本报告全文中任何「通过」字样均限定在上述检查范围内，**不构成对真实陪伴能力的验收结论**。

---

## 2. 修改文件清单及原因

改动规模：**修复改动共 6 个文件，+10 / −13 行**（`git diff --stat 8b207b7...44ffe42`，不含本报告）。

| 文件 | 变更 | 原因 |
|---|---|---|
| `package.json` | `version`: `1.0.0` → `2.0.0` | `app.getVersion()` 读取该字段；1.0.0 使渲染层版本标签与 electron-builder `artifactName`（`Morrow-Setup-${version}-${arch}.${ext}`，见 package.json:50）与实际交付版本不符 |
| `package-lock.json` | 根 `version` 与 `packages[""].version` 同步为 2.0.0（+2/−2） | 与 package.json 一致；**无依赖树变化**，未新增/删除任何包 |
| `.github/workflows/ci.yml` | 删除 2 处 `Rebuild better-sqlite3 for Node` 步骤（−5 行） | `better-sqlite3` 不在依赖中，该命令实际不重建任何东西却返回成功，属误导性死步骤 |
| `README.md` | 安装说明、Node 要求行、验证命令块（+5/−3） | 原文称 `npm install` 含「better-sqlite3 预编译模块」已不成立；`verify` 实际包含两项离线评估但读者看不到 |
| `docs/testing/acceptance-report.md` | §5 环境条目 1 行替换 | 验收报告中的 better-sqlite3 表述是 V1 遗留，与当前实现矛盾 |
| `docs/audit/legacy-asset-audit.md` | 在既有记录行末追加一句说明（+1/−1） | 该文件是**历史审计记录**，不改写历史结论，只加一句上下文，避免被误读为当前状态 |

### 2.1 CI 删除的可验证依据

```
$ git grep -c "better-sqlite3" -- package.json package-lock.json
（无匹配，退出码 1）
$ grep -n "node:sqlite" src/persistence/database.ts
4:import { DatabaseSync } from 'node:sqlite'
```

删除后 `ci.yml` 的结构核验（grep 实际输出，非推测）：

```
$ grep -nE "^  [a-z][a-z-]*:$" .github/workflows/ci.yml
9:  verify:
59:  windows-install-path:

$ grep -nE "^      - name: |^      - uses: " .github/workflows/ci.yml
17:      - uses: actions/checkout@v4
19:      - uses: actions/setup-node@v4
26:      - name: Install dependencies
29:      - name: Typecheck
32:      - name: Unit and integration tests
35:      - name: Offline evaluations
40:      - name: Build application bundles
43:      - name: Install Electron binary for smoke
46:      - name: Install xvfb (Linux headless display for Electron)
50:      - name: Electron smoke (real app, isolated profile, no network egress)
63:      - uses: actions/checkout@v4
64:      - uses: actions/setup-node@v4
68:      - name: Install dependencies
70:      - name: Migration and persistence test pass (includes v1→v15 upgrade paths)

$ grep -c "better-sqlite3" .github/workflows/ci.yml
0 matches
```

两个 job 的其余步骤、`npm ci` 参数、xvfb 包装、Electron 二进制安装均保持原样。CI 在本次运行中实际执行到 `Electron smoke` 并通过（§5.3），说明删除未破坏后续链路。

> 说明：本机无 PyYAML（`ModuleNotFoundError: No module named 'yaml'`），且项目未安装 `yaml` npm 包，因此**未做 YAML 解析器级别的结构校验**，上述核验基于 grep 行匹配与整文件人工复核。YAML 语法的最终有效性由 GitHub Actions 实际成功调度并执行三个 job 反向证明。

---

## 3. 版本号最终选择及依据

**最终版本：`2.0.0`**

依据（均可复核）：

1. **仓库无任何 tag、无任何 Release**：`git tag -l` 输出为空，`gh release list` 输出为空。因此不存在任何外部契约锁定 `1.0.0`。
2. **CHANGELOG 与 README 是仓库唯一版本叙事**，二者均将已交付里程碑叙述为 2.0.0。
3. 因此选择把 `package.json` **向上对齐到文档**，而不是把文档历史向下改写为 1.0.0。

**未做的事**：本次未创建任何 Git Tag、未创建任何 Release、未触发任何发布流程。

**影响面**（已核实配置，非推测）：

- `app.getVersion()` → UI 版本标签显示 2.0.0；
- `package.json:50` `artifactName: "Morrow-Setup-${version}-${arch}.${ext}"` → 打包产物名变为 `Morrow-Setup-2.0.0-x64.exe`；
- CI 日志中出现 `> morrow-ai-companion-v2@2.0.0 smoke`，证明版本变更在 runner 上已生效。

> 说明：`npm run package:win` **未执行**（见 §6.3），因此产物名变更由配置推导，未实际产出安装包验证。

---

## 4. 具体修复结果

### 4.1 CI 死步骤

- 删除前：`verify` 与 `windows-install-path` 两个 job 各有一处 `npm rebuild better-sqlite3`。
- 删除后：`grep -n "better-sqlite3" .github/workflows/ci.yml` 无匹配；`grep -n "better-sqlite3"` 全仓库仅剩 `docs/audit/legacy-asset-audit.md` 一处（历史记录，已加说明）。
- 项目使用 `node:sqlite` 已确认：`src/persistence/database.ts:4` 导入 `DatabaseSync`；`package.json` 与 `package-lock.json` 无 `better-sqlite3`。
- 其他 CI 行为：**未改动**（对比 diff 仅删除 5 行）。

### 4.2 过时文档

| 位置 | 修改前 | 修改后 |
|---|---|---|
| README 安装行 | `npm install # 含 Electron 二进制与 better-sqlite3 预编译模块` | `npm install # 安装依赖并确保 Electron 二进制就位（无原生模块编译步骤）` |
| README Node 要求 | `Node.js ≥ 22.13（使用内置 node:sqlite，无原生编译需求）` | 补明「`node:sqlite` 自 v22.13.0 起无需 `--experimental-sqlite` 标志；**无原生模块，无需本地编译工具链**」 |
| README 验证块 | 只有 typecheck / test / build / smoke / verify | 增列 `npm run evaluate`、`npm run evaluate:cognition`，并把 `verify` 展开为「typecheck + test + 两项评估 + build + smoke」 |
| 验收报告 §5 | `better-sqlite3 原生模块：npm 预编译二进制直接可用…` | `SQLite：使用 Node 内置 node:sqlite（要求 Node ≥ 22.13…），无原生模块、无本地编译工具链；运行时打印 ExperimentalWarning 属预期` |
| 旧资产审计 | `npm install（含 … better-sqlite3 原生模块重建）：成功` | 保留原记录 + 追加「该记录针对**旧仓库工作树**…V2 已切换为 node:sqlite，不存在原生模块编译步骤」 |

**Node 版本要求经官方文档核实**：Node.js 官方 `node:sqlite` 文档的版本历史明确记载 —— `node:sqlite` 于 **v22.5.0** 引入；**v23.4.0 / v22.13.0** 起「SQLite is no longer behind `--experimental-sqlite` but still experimental」。因此 README 原写的 `≥ 22.13` 本身准确，本次只是把它写得更明确，**未抬高或降低门槛**；同时文档标注该模块仍为 experimental（v25.7.0 起为 release candidate），故「运行时打印 `ExperimentalWarning` 属预期」的表述也有据。

**未做的事**：未把任何未验证的云端 API 调用或真实陪伴效果写为已完成；未修改测试计数、验收结论、`known-limitations.md`。

---

## 5. 验证证据

### 5.1 本机环境

| 项 | 值 |
|---|---|
| OS | Windows 10.0.26200.9711 |
| Node | v22.22.2 |
| npm | 10.9.7 |
| Electron | 44.9.3 |

### 5.2 本地实际执行

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | **通过** | 0 错误 |
| `npx vitest run --no-fsModuleCache` | **通过** | `Test Files 40 passed (40)` / `Tests 268 passed (268)`（本机耗时约 21s） |
| `npm run evaluate` | **通过** | 检索 11 例：baseline precision 0.4 → candidate **1.0**，recall 1.0，各类泄漏 0；提醒 19 例 precision/recall 1.0，FP 0；`m2Safety: true` |
| `npm run evaluate:cognition` | **通过** | 轮次 26 例 / 内在状态 34 例 / 认知 Alpha 28 例（安全关键 19 例），三组 gate `passed: true`；`providerCalls: 0`、`networkCalls: 0`、`toolCalls: 0` |
| `npm run build` | **通过** | main / preload / renderer 三段产物正常 |
| `npm run smoke` | **失败** | 渲染进程 `window load failed` + GPU 进程 `0xC0000005`；已证明与本次改动无关并有 CI 反证（§6.1） |

> 偏差说明：本地 `npm test` 未能直接跑通，原因是本机删除守卫限制了 vitest 缓存清理，改用等价的 `--no-fsModuleCache` 参数执行同一测试集（文件数与用例数一致）。CI 上以原样的 `npm test` 执行并通过（§5.3），因此该偏差不影响结论。

### 5.3 GitHub Actions 实际结果

运行：https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40308680325
触发：`pull_request`（PR #2）；head SHA `44ffe42`；时段 `10:36:05Z → 10:38:05Z`；总结果 **success**。

| Job | 结论 | 耗时 | 起止 (UTC) |
|---|---|---|---|
| Typecheck, tests, build and smoke (`ubuntu-latest`) | **pass** | 1m6s | 10:36:08 → 10:37:14 |
| Typecheck, tests, build and smoke (`windows-latest`) | **pass** | 1m57s | 10:36:08 → 10:38:05 |
| Windows upgrade path (schema migrations under the real app) | **pass** | 59s | 10:36:08 → 10:37:07 |

关键输出（直接摘自 CI 日志）：

```
[ubuntu]  Test Files  40 passed (40)
[ubuntu]  Tests       268 passed (268)        Duration 15.01s
[windows] Test Files  40 passed (40)
[windows] Tests       268 passed (268)        Duration 37.74s
[windows-install-path] Test Files 6 passed (6) / Tests 47 passed (47)   16.64s

[smoke · ubuntu] > morrow-ai-companion-v2@2.0.0 smoke
[smoke · ubuntu] Morrow smoke passed: built Electron app, default-off DeepSeek configuration,
                 secure credential save/restart/delete (failed-closed, no Provider requests), ...
[smoke · windows] Morrow smoke passed: ... (encrypted-restart-corruption-protected-then-explicit-delete-verified,
                 no Provider requests), cognitive default-off/explicit opt-in and restart persistence, ...

[evaluate] {"passed":true,"cases":11,"baselinePrecision":0.4,"candidatePrecision":1,"candidateRecall":1,
            "candidateSourceLeaks":0,"candidateScopeLeaks":0,"candidateRestrictedLeaks":0,
            "m2Safety":true,"deterministicHash":"209d8d37…","m4Reminders":{"passed":true,"cases":19,…}}
[evaluate:cognition] {"passed":true,"cognitive":{…26 例…},"feeling":{…34 例…},
            "cognitiveAlpha":{…28 例 / 安全关键 19 例…,"calibration":{"measured":false,…}},
            "offlineExecution":{"providerCalls":0,"networkCalls":0,"networkGuarded":true,"toolCalls":0}}
```

**结论性事实**：smoke 在两个 runner 上都真实通过，覆盖凭据保存/重启/删除、认知默认关闭与显式开启、记忆生命周期、目标与审批安全、提醒控制、持久化与重启校验。这直接反证本地 smoke 失败属本机环境问题。

**第二次运行**（报告第 1 版 `fd6c6cd`，docs-only 提交触发的 `pull_request` 运行）同样 3/3 通过：

| Job | 结论 | 耗时 |
|---|---|---|
| Typecheck, tests, build and smoke (`ubuntu-latest`) | **pass** | 1m27s |
| Typecheck, tests, build and smoke (`windows-latest`) | **pass** | 1m56s |
| Windows upgrade path (schema migrations under the real app) | **pass** | 47s |

运行链接：https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40309704692 （`completed / success`，时段 `10:44:08Z → 10:46:09Z`）

**第三次运行**（报告第 2 版 `cfa038d`）同样 3/3 通过，逐 Job 数据见 §10。

> 三次运行覆盖的都是**同一批源码改动**（提交 1–3），后两次仅因追加文档提交而重跑。它们证明的是工程检查项稳定通过，**不改变 §1.1 的未覆盖项状态**。

---

## 6. 未执行 / 失败 / 无法验证的项目

本节是与通过项隔离的**权威清单**，对应 §1.1 的未覆盖项：§6.2 = 未覆盖项 A，§6.3 = 未覆盖项 B，§6.6 = 未覆盖项 C。任何一项都不因 §5.3 的 CI 通过而改变状态。

### 6.1 本地 `npm run smoke` —— 失败，已判定为环境问题

现象：渲染进程报 `window load failed`，GPU 进程以 `0xC0000005`（Access Violation）退出。

判定过程（全部实际执行）：

1. 在**未修改的 `origin/main` 基线**（`8b207b7`）另建 worktree 运行 smoke → **完全相同的失败**；
2. 换到**无空格路径** `E:\morrow-smoke` → 同样失败，排除路径含空格；
3. **关闭沙箱**执行 → 同样失败，排除沙箱限制；
4. 分别尝试 `--use-angle=swiftshader`、`--in-process-gpu --disable-gpu-compositing`、`--disable-features=SkiaGraphite,Vulkan` → 同样失败；
5. Electron 探针（CDP `--remote-debugging-port`）→ `BrowserWindow` 可创建，页面未完成加载；
6. 最终由 CI 反证：同一份代码在 `windows-latest` 与 `ubuntu-latest`（xvfb）上 smoke 均 **pass**。

结论：本机 Electron 渲染层不可用，属环境限制，**不是本次改动引入**。该机上的 smoke 永久标记为「本地未验证，CI 已验证」。

对照用的两个临时 worktree 已清理（`git worktree list` 只剩主工作树）。

### 6.2 真实 Provider 多轮对话端到端 —— 未执行（未覆盖项 A）

本阶段未使用任何真实 Provider 凭据发起对话，未发起任何真实云端请求。需真实凭据与逐轮人工同意，超出本阶段范围。

本阶段**不声称**任何云端调用、多轮上下文连贯性、对话质量或陪伴效果已验证。CI 日志中的 `providerCalls: 0` / `networkCalls: 0` 只能证明离线链路干净，不能反过来当作真实对话可用的证据。

### 6.3 Windows 安装包实际打包 —— 未执行（未覆盖项 B）

`npm run package:win`（electron-builder NSIS）未运行，因此 `Morrow-Setup-2.0.0-x64.exe` 的实际文件名是由 `package.json:50` 的 `artifactName` 模板推导得出，**未产出任何 `.exe` 实物**，安装 / 覆盖升级 / 卸载 / 签名 / 产物命名均未验证。属本阶段范围外。

### 6.4 CI 告警（未处理，超出允许改动范围）

- `actions/checkout@v4` / `actions/setup-node@v4` 收到 Node.js 20 弃用告警（被强制在 Node 24 上运行）。修复需升级 action 版本，属「其他 CI 行为」，本阶段不动。
- `ubuntu-latest` 标签将于 2026-10-19 起迁移至 Ubuntu 26（runner 自身公告）。同上，不在本阶段处理。

### 6.5 任务过程中发现的新问题（未修，明确越界）

**评估报告的 `reportSha256` 跨平台不可复现**：同一数据集、同一 `deterministicHash`（`209d8d37…`，Linux 与 Windows 完全一致），但 `reportSha256` 不同 —— Linux `d18c8225…`、Windows `c5c1948d…`。原因已定位：报告 JSON 内嵌 `generatedAt` 时间戳（本地实测 `evaluation/reports/m3-synthetic-retrieval-report.json` 含 `"generatedAt": "2026-10-26T10:06:35.807Z"`），时间戳进入哈希输入。

影响：`reportSha256` 不能作为跨运行一致性凭据，`deterministicHash` 可以。修复需改 `scripts/run-evaluation.mjs`，属算法/脚本变更，**本阶段明确不修**，建议列入下一阶段。

**修复状态：未修复。** 本问题在本阶段结束时**依然存在**，本次审计修正也未触碰 `scripts/run-evaluation.mjs` 或任何评估输出逻辑，因此该跨平台不一致在最新提交上仍然可复现。任何把本报告理解为「该问题已修复」的解读都是错误的——此处只做记录，不做修复。

### 6.6 真实陪伴效果验收 —— 未执行（未覆盖项 C）

对话质量、长期记忆在真实使用中的可用性、逐轮同意摩擦对留存的实际影响，均需真实使用后才能评估。本阶段无任何此类数据，也未做任何主观质量判断。此状态不因 CI 全绿而改变。

---

## 7. 与原始任务的偏差

| # | 偏差 | 说明 | 是否影响完成标准 |
|---|---|---|---|
| 1 | 本地测试使用 `npx vitest run --no-fsModuleCache` 而非 `npm test` | 本机删除守卫阻止 vitest 清理缓存；CI 以原样 `npm test` 通过 | 否 |
| 2 | 额外修改 `docs/audit/legacy-asset-audit.md`（1 行） | 该文件不在「README 和验收文档」字面范围内。理由：它含 `better-sqlite3` 表述，若不动会在 `grep` 审计中被反复误判为当前状态；处理方式是**追加说明而非改写历史** | 否，已在此显式披露 |
| 3 | README 验证块新增 2 行评估命令 | 属任务 3「统一测试命令」范畴；未改任何结论性表述 | 否 |
| 4 | `package-lock.json` 被修改 | 版本号统一的必然连带，仅 2 个版本字段，无依赖树变化 | 否 |

---

## 8. 遗留问题

**一、本阶段明确未覆盖、需下一阶段承接的验证（对应 §1.1）**

1. **真实 Provider 多轮对话端到端未验证**（未覆盖项 A / §6.2）——需真实凭据、真实云端请求、多轮上下文与记忆召回的实况观察。
2. **Windows 安装包未实际打包**（未覆盖项 B / §6.3）——需运行 `npm run package:win` 并验证安装 / 升级 / 卸载 / 产物命名。
3. **真实陪伴效果未验收**（未覆盖项 C / §6.6）——需真实使用数据，无法由任何自动化检查替代。

**二、工程层遗留**

4. **评估报告哈希不可复现**（§6.5）——**未修复**。建议下一阶段修 `run-evaluation.mjs`，把 `generatedAt` 排除在哈希输入外，或改用确定性时间。
5. **本机 Electron 渲染层不可用**——影响本机所有依赖 GUI 的验证（smoke、真实对话）。建议单独排查（GPU/驱动/安全策略），不阻塞 CI 流程。
6. **CI action 版本与 runner 镜像告警**（§6.4）——非紧急，建议与下一次 CI 变更合并处理。
7. **产品层三个 P1 缺口未动**（记忆召回 `score > 0` 硬过滤、逐轮同意摩擦、兴趣/自我模型无 UI）——按任务边界「不修改记忆召回算法/人格算法/内在状态算法/授权策略」，本阶段不触碰。

---

## 9. 风险与回滚

**风险等级：低。**

- 唯一有运行时影响的是 `version` 字段（影响 `app.getVersion()` 显示与打包产物命名），已在 CI 实测生效并全绿；
- 其余改动为 CI 删行与文档表述，无源码逻辑进入；
- 无数据库 schema 变化、无数据迁移、无依赖增删，回滚不涉及数据或环境清理。

**回滚方式**：

- 整体：不合并 PR #2 即完全回滚（`main` 未受任何影响，仍为 `8b207b7`）；
- 已合并场景：`git revert` 三个提交，或按提交粒度单独回滚；
- 单点回滚：`git revert 04af222`（版本号）/ `d978f09`（CI）/ `44ffe42`（文档）可独立执行。

---

## 10. 交付清单

| 项 | 值 |
|---|---|
| 分支 | `chore/phase-1-engineering-consistency` |
| 提交 1 | `04af222` — `chore(release): align package version with the documented 2.0.0` |
| 提交 2 | `d978f09` — `ci: remove the obsolete better-sqlite3 rebuild step` |
| 提交 3 | `44ffe42` — `docs: correct the SQLite/Node statements and document the evaluation commands` |
| 提交 4 | `fd6c6cd` — `docs(report): phase 1 work report with reproducible verification evidence`（报告第 1 版） |
| 提交 5 | `cfa038d` — `docs(report): correct the completion status wording per audit`（报告第 2 版，docs-only） |
| 提交 6 | 本报告定稿补充 CI 事实的提交（docs-only）—— SHA 见 PR #2 提交列表 |
| PR | #2 — https://github.com/ve766/morrow-ai-companion-v2/pull/2 （OPEN，`MERGEABLE`，**未合并**） |
| CI（实质改动 `44ffe42`） | [run 40308680325](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40308680325) — **success**，3/3 Job |
| CI（报告第 1 版 `fd6c6cd`） | [run 40309704692](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40309704692) — **success**，3/3 Job |
| CI（报告第 2 版 `cfa038d`） | [run 40312875507](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40312875507) — **success**，3/3 Job（详见下表） |
| 本报告 | `docs/reports/project-work-report-2026-10-26-phase-1.md`（第 2 版） |

**报告第 2 版提交 `cfa038d` 的 CI 实际结果**（该运行已真实完成，非预判）：

| Job | 结论 | 耗时 | 起止 (UTC) |
|---|---|---|---|
| Typecheck, tests, build and smoke (`ubuntu-latest`) | **pass** | 1m3s | 11:09:04 → 11:10:07 |
| Typecheck, tests, build and smoke (`windows-latest`) | **pass** | 2m6s | 11:09:04 → 11:11:10 |
| Windows upgrade path (schema migrations under the real app) | **pass** | 37s | 11:09:04 → 11:09:41 |

运行整体：`completed / success`，时段 `11:09:02Z → 11:11:11Z`。

**关于本报告自身的提交**：提交 4、5、6 均为 docs-only，不含任何代码/配置变更。上表三次 CI 运行覆盖的都是**同一批源码改动**（提交 1–3），后两次仅因追加文档提交而重跑。

**提交 6 的 CI 状态**：该提交仅补充上述 CI 事实，同样为 docs-only，会触发一次新的 `pull_request` 运行。**本文件不对该运行作任何预判**——截至本文件写入时它尚未启动，其结果请以 PR #2 的 Checks 页面为准（不再回写本文件，以避免「改一次报告触发一次 CI」的循环）。

**停止点**：本报告修正推送后即停止，不合并 PR，不开始第二阶段，等待复审。

---

## 11. 修订记录

| 版本 | 日期 | 变更 | 是否触及代码 |
|---|---|---|---|
| 第 1 版 | 2026-10-26 | 初版：工程收尾执行记录 + 验证证据 | 未触及（随提交 1–4 交付） |
| **第 2 版** | 2026-10-26 | 按审计意见修正**完成状态表述**：① 删除「未完成项：无」，改为「工程收尾已完成，产品能力验证仍有未覆盖项」；② 新增 §1.1 显式列出未执行的真实 Provider 多轮对话端到端验证、Windows 安装包实际打包验证、真实陪伴效果验收；③ 新增 §1.2 说明 CI 通过的准确边界；④ §6.2 / §6.3 标题与内容标注为「未覆盖项 A / B」，新增 §6.6；⑤ §6.5 增补「修复状态：未修复」；⑥ §8 拆分「未覆盖验证」与「工程遗留」；⑦ §10 补入第 2 版提交 `cfa038d` 的真实 CI 结果 | **未触及**（仅本报告文件） |

第 2 版**未改动**任何验证结论、命令输出、CI 结果或代码；仅调整完成状态的表述精度，并补入已实际完成的 CI 事实。
