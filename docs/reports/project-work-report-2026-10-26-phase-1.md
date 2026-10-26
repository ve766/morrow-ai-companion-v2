# Morrow V2 · 第一阶段工作报告：工程收尾与回归保护

| 项 | 值 |
|---|---|
| 报告日期 | 2026-10-26 |
| 仓库 | `github.com/ve766/morrow-ai-companion-v2` |
| 工作分支 | `chore/phase-1-engineering-consistency` |
| 基线 | `main` @ `8b207b7` |
| Pull Request | **#2** — https://github.com/ve766/morrow-ai-companion-v2/pull/2 |
| PR 状态 | **OPEN / 未合并**（等待人工审查与审计） |
| CI 运行 | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40308680325 |
| CI 总结果 | **success**（3 / 3 Job 通过） |

本报告中的所有事实均来自本次实际执行的命令输出。凡未执行、失败或无法验证的项目，均在 §6 单独列明，不与通过项混写。

---

## 1. 任务目标与实际完成情况

目标：修复审计报告确认的工程不一致，**不改变现有产品行为**，为下一阶段真实对话验证建立稳定基线。

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| 1 | 统一版本号 | **已完成** | `package.json` + `package-lock.json` 根字段 1.0.0 → 2.0.0；未创建 tag / Release |
| 2 | 清理失效 CI 步骤 | **已完成** | 删除两个 job 中的 `npm rebuild better-sqlite3`（−5 行）；确认项目使用 `node:sqlite`；未改动其他 CI 行为 |
| 3 | 修正文档 | **已完成** | README、验收报告、旧资产审计三处 SQLite 表述修正；补全 `verify` 命令链与 Node 版本依据 |
| 4 | 回归验证 | **已完成（本地 smoke 除外）** | typecheck / 268 测试 / 两组离线评估 / build 本地通过；smoke 本地失败但 CI 通过，判定为环境问题（§6.1） |
| 5 | 提交并创建 PR | **已完成** | 3 个提交已推送，PR #2 已创建，**未合并** |
| 6 | 交付报告 | **本文件** | — |

未完成项：无（smoke 由 CI 判定通过，详见 §5.3 与 §6.1）。

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

---

## 6. 未执行 / 失败 / 无法验证的项目

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

### 6.2 真实对话端到端 —— 未执行

需真实 Provider 凭据与逐轮人工同意，超出本阶段范围。本阶段**不声称**任何云端调用、对话质量或陪伴效果已验证。

### 6.3 打包产物 —— 未执行

`npm run package:win`（electron-builder NSIS）未运行，因此 `Morrow-Setup-2.0.0-x64.exe` 的实际文件名由配置推导，未产出实物验证。属本阶段范围外。

### 6.4 CI 告警（未处理，超出允许改动范围）

- `actions/checkout@v4` / `actions/setup-node@v4` 收到 Node.js 20 弃用告警（被强制在 Node 24 上运行）。修复需升级 action 版本，属「其他 CI 行为」，本阶段不动。
- `ubuntu-latest` 标签将于 2026-10-19 起迁移至 Ubuntu 26（runner 自身公告）。同上，不在本阶段处理。

### 6.5 任务过程中发现的新问题（未修，明确越界）

**评估报告的 `reportSha256` 跨平台不可复现**：同一数据集、同一 `deterministicHash`（`209d8d37…`，Linux 与 Windows 完全一致），但 `reportSha256` 不同 —— Linux `d18c8225…`、Windows `c5c1948d…`。原因已定位：报告 JSON 内嵌 `generatedAt` 时间戳（本地实测 `evaluation/reports/m3-synthetic-retrieval-report.json` 含 `"generatedAt": "2026-10-26T10:06:35.807Z"`），时间戳进入哈希输入。

影响：`reportSha256` 不能作为跨运行一致性凭据，`deterministicHash` 可以。修复需改 `scripts/run-evaluation.mjs`，属算法/脚本变更，**本阶段明确不修**，建议列入下一阶段。

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

1. **评估报告哈希不可复现**（§6.5）——建议下一阶段修 `run-evaluation.mjs`，把 `generatedAt` 排除在哈希输入外，或改用确定性时间。
2. **本机 Electron 渲染层不可用**——影响本机所有依赖 GUI 的验证（smoke、真实对话）。建议单独排查（GPU/驱动/安全策略），不阻塞 CI 流程。
3. **CI action 版本与 runner 镜像告警**（§6.4）——非紧急，建议与下一次 CI 变更合并处理。
4. **产品层三个 P1 缺口未动**（记忆召回 `score > 0` 硬过滤、逐轮同意摩擦、兴趣/自我模型无 UI）——按任务边界「不修改记忆召回算法/人格算法/内在状态算法/授权策略」，本阶段不触碰。

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
| PR | #2 — https://github.com/ve766/morrow-ai-companion-v2/pull/2 （OPEN，`MERGEABLE`，**未合并**） |
| CI | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40308680325 （**success**，3/3 Job 通过） |
| 本报告 | `docs/reports/project-work-report-2026-10-26-phase-1.md` |

**关于本报告自身的提交**：本报告作为 PR #2 的第 4 个提交追加，**仅新增本文件，无任何代码/配置变更**。因此上表 CI 运行 `40308680325` 覆盖的是全部实质性改动（提交 1–3，head `44ffe42`）；本报告提交会触发新一轮 `pull_request` 运行，其结果不记录在此文件内（否则会形成"改一次报告触发一次 CI"的循环），请以 PR #2 的 Checks 页面为最终依据，最新提交 SHA 与最终 CI 状态亦见 PR 描述。

**停止点**：本报告上传后即停止，不开始下一阶段，不合并 PR，等待审计。
