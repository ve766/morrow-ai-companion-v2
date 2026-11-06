# Morrow V2 本机部署独立审计（Issue #60）

- 仓库：`ve766/morrow-ai-companion-v2`
- PR：https://github.com/ve766/morrow-ai-companion-v2/pull/54（OPEN，未合并）
- 分支：`feat/morrow-v2-final-closure`
- 被审 HEAD：`51189361bf1c253fc7fa790e9e9be78af7a8f88e`（`feat(app): add an explicit local-acceptance data root`）
- Parent：`2ffb697cff3491a0f67080a35bb163f87603ca4b`
- PR base：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 审计方式：只读复核；独立重算哈希、独立复现 Electron 崩溃、独立读取注册表与旧版目录元数据/哈希。
- 审计边界：未运行 `npm ci`/`npm install`/全量测试/`npm run build`/`npm run package:win`/NSIS/正式安装器；未修改任何产品代码、测试、脚本或既有文档；未 commit/stage/push；唯一新增文件为本审计文件；探针仅位于 `.tmp/` 并在结束后清理。

## 1. 结论摘要

**Overall status: BLOCKED。**

隔离实现、默认行为、部署证据与旧版保护均通过独立复核；应用窗口在本机 Windows build 26200 上仍无法启动（Electron 运行时级崩溃），窗口不可见，用户交互无法开始。**不能标记为 `DEPLOYED_AND_RUNNING`，也不是本机实机验收完成。** 未在本次 diff 中发现产品代码层面的 BLOCKER/HIGH 缺陷；导致任务目标无法达成的 BLOCKER 是宿主 Electron 运行时崩溃。

## 2. 判定表

| 复核项 | 判定 | 主要证据 |
| --- | --- | --- |
| 隔离代码（绝对路径/空值/相对路径） | **PASS** | `src/app/acceptance-data-path.ts:8-16`；`tests/acceptance-data-path.test.ts` 3/3 通过 |
| 默认行为（未设置环境变量时不覆盖） | **PASS** | `src/app/index.ts:41-45` 仅在解析结果非空时 `setPath`；`:181` 的 `whenReady` 之前执行；`:186`/`:265` 仍使用 `app.getPath('userData')` |
| 部署证据（SHA、隔离数据、默认 profile） | **PASS**（带 LOW 级证据瑕疵） | 部署 `Morrow.exe` SHA256 `42749ba5…` 与构建产物一致；隔离目录含 `morrow.sqlite3`；默认 profile 66 文件、最新 mtime 未变 |
| 旧版保护（`F:\morrow1` + HKCU 卸载键） | **PASS** | 74 文件 / 386,629,322 bytes；逐文件 length/mtime/SHA256 0 差异；canonical `206f9a593ee5032f68145372556cf89ef7b0a15f67b224410479b97c191dac91` 复现；注册表快照 `d0c7c12f…` 复现 |
| Electron 窗口真实可见 | **BLOCKED** | `electron.exe --version` → `0x80000003`；最小窗口探针带部署参数 → `0xC0000005`（4/4），无窗口；WER `Morrow.exe` `0xc0000005` offset `0x357db3a` |
| 文档诚实性 | **PASS**（带 LOW 级缺口） | 报告/矩阵/证据索引均为 BLOCKED，明确“不是 DEPLOYED_AND_RUNNING/不是实机验收完成”；窗口标为不可见 |
| 用户手动交互 | **PENDING_USER_ACTION** | 无窗口，用户无法操作；矩阵 `:19-20` 如实标注 |
| 独立审计 | **COMPLETE**（本文件） | 针对 `51189361…` 与本机证据的独立复核 |

## 3. 身份与变更范围

| 项 | 实测值 |
| --- | --- |
| `git rev-parse HEAD` | `51189361bf1c253fc7fa790e9e9be78af7a8f88e` |
| `git rev-parse HEAD^` | `2ffb697cff3491a0f67080a35bb163f87603ca4b` |
| 工作区（审计文件写入前） | clean（`git status --porcelain` 空） |
| `git diff --stat 2ffb697..HEAD` | 9 files changed, 272 insertions(+), 2 deletions(-) |
| 变更文件 | `.gitignore`；`docs/install/windows-installation-guide.md`；`docs/install/windows-troubleshooting.md`；3 个 `docs/reports|testing` 新文档；`src/app/acceptance-data-path.ts`；`src/app/index.ts`；`tests/acceptance-data-path.test.ts` |
| 未变更 | 无 `package.json`/lockfile、无 schema/migration、无 `.github/workflows`、无构建脚本 |
| 提交数（2ffb697..HEAD） | 1 |
| 远端分支 | `feat/morrow-v2-final-closure` @ `51189361…`（与 PR head 一致） |
| 远端 main / release | `8b207b7d…` / `3812b185…`（release 与 PR base 一致，未被本次改动） |

## 4. 隔离实现复核

`src/app/acceptance-data-path.ts:8-16` 实现与报告一致：

- `undefined` → `null`；`trim()` 后为空 → `null`；
- 非绝对路径 → `throw new Error('MORROW_LOCAL_ACCEPTANCE_USER_DATA must be an absolute path.')`；
- 绝对路径 → `resolve()` 规范化后返回。

`src/app/index.ts:41-45` 在模块顶层解析并仅在非空时调用 `app.setPath('userData')` 与 `app.setPath('sessionData')`；该代码位于 `:181` 的 `app.whenReady()` 之前，满足 Electron 对 `setPath` 的时序要求。未设置变量时完全跳过覆盖，`:186` 的数据库路径与 `:265` 的 secret store 仍取 `app.getPath('userData')`；`grep` 未发现其他硬编码的 `morrow-ai-companion` 路径。

单测独立执行结果：`tests/acceptance-data-path.test.ts` 1 file / 3 tests passed / 0 failed（exit 0），覆盖未设置、空串、纯空白、绝对路径规范化、相对路径抛错。

## 5. 部署证据复核

Run ID：`8d94195efd014ae49d0fa224a9022294`，证据目录 `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\<runId>`。

- 部署 `Morrow.exe`：246,819,840 bytes，SHA256 `42749ba5833aa6c8d371135002705931ebaa013a424d8613575a4b1268862b98`；与 `release-local\win-unpacked\Morrow.exe` 独立重算一致。
- `resources\app.asar`：构建产物与部署副本 SHA256 均为 `bd77ea9200d3bbc4fb9827c1bb18679a0aa0d2d7f2a8addcbafe1dfeb025ad84`；app 目录 72 个文件，与 `release-local\win-unpacked` 的 72 个文件一致。
- 隔离 user-data 目录：当前 60 个文件；存在 `morrow.sqlite3`（4,096 bytes）、`morrow.sqlite3-wal`（3,073,552 bytes）、`morrow.sqlite3-shm`，以及 `Local State`、`Local Storage`、`Cache`、`GPUCache` 等 Electron 数据，证明 userData/sessionData 确实落在隔离根。
- 默认 `%APPDATA%\morrow-ai-companion`：66 个文件；最新 mtime `2026-10-29T07:59:02.2867039Z`（本地 15:59:02），与部署前快照一致；审计探针结束后复查仍为 66 文件、同一 mtime。
- `checksums.sha256`：7 个证据文件的 SHA256 值全部独立重算一致（见 §7 的 CRLF 说明）。
- `old-install-before.json` 与 `old-install-after.json` 内容完全相同（SHA256 均为 `4c04eb72…`），文件数为 74，总字节数 386,629,322。
- `deployment.json` 记录 `exitCode=-1073741819`（`0xC0000005`）、`aliveAfter15s=false`、`windowTitle=""`；启动日志 `launch.stdout.log` 2 bytes、`launch.stderr.log` 0 bytes，无业务输出。

## 6. 旧版保护复核

- `F:\morrow1` 独立清点：74 个文件，386,629,322 bytes，与证据 JSON 的 `fileCount`/总长度一致；逐文件比较 `relative`、`length`、`lastWriteTimeUtc`、`sha256`，**0 差异**。
- 按记录顺序用实际文件值重建 canonical 串并计算 SHA256，得到 `206f9a593ee5032f68145372556cf89ef7b0a15f67b224410479b97c191dac91`，与 `old-install-before/after.json` 和报告一致。
- HKCU 卸载键 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\92ffd461-3512-54f9-8cf5-c344989830ea` 仍存在；`DisplayName=Morrow 1.0.0`、`DisplayVersion=1.0.0`、`InstallLocation=""`、`UninstallString="F:\morrow1\Uninstall Morrow.exe" /currentuser`；快照 JSON 的 SHA256 独立重算为 `d0c7c12f2e74903a48e6cfc0c45a80508fd1851471c3ff9ac895cad6144a6bb8`，与记录一致。
- 仅读取了 `F:\morrow1` 的程序文件元数据与哈希；未打开数据库/聊天/用户数据，未执行安装器或卸载器。

## 7. Electron 运行时与窗口证据

独立探针（均只启动我创建的进程，结束后无残留 electron 进程）：

| 探针 | 次数 | 结果 |
| --- | --- | --- |
| `node_modules\electron\dist\electron.exe --version`（Electron 44.9.3） | 1 | exit `-2147483645` = `0x80000003`，stdout/stderr 为空 |
| 最小窗口应用（仅 `BrowserWindow` + data URL），无参数 | 7 | 7/7 exit `0x80000003`，无窗口、无 stdout |
| 最小窗口应用 + `--no-sandbox --disable-gpu` | 2 | 2/2 exit `0xC0000005`，无窗口 |
| 最小窗口应用 + `--no-sandbox --disable-gpu --in-process-gpu` | 2 | 2/2 exit `0xC0000005`，无窗口 |

WER `Application Error` 独立查询：

- 部署版 `Morrow.exe 2.0.0.0`：`0xc0000005`，faulting module `Morrow.exe`，offset `0x357db3a`；同一路径另有 1 条 `0x80000003` offset `0x32f3f4c`（对应 `single-process` 变体）。
- 本次最小探针 `electron.exe 44.9.3.0`：`0xc0000005`，offset `0x7d7287b`；历史上 44.10.2 / 45.2.3 的 `electron.exe` 也各有 `0xc0000005` 记录。

结论：崩溃发生在 Electron/Chromium 初始化阶段，最小应用与 `--version` 同样失败，与 Morrow 业务代码、数据库、Provider 配置无关。窗口从未创建/显示，`MainWindowTitle` 为空。该结果是宿主 Windows build 26200 的环境级阻塞。

## 8. 文档诚实性复核

- `docs/reports/morrow-v2-local-deployment-report.md:9,67,89` 与 `docs/reports/morrow-v2-local-deployment-evidence-index.md:5,69`、`docs/testing/morrow-v2-local-deployment-acceptance-matrix.md:4,17-21,24,28` 全部明确 **BLOCKED**，并写明“不是 DEPLOYED_AND_RUNNING，也不是本机实机验收完成”。
- 窗口项标为 BLOCKED/不可见；用户交互与 Provider UI 标为 PENDING_USER_ACTION；没有“应用已运行/聊天/记忆功能已验收”的表述。
- `docs/install/windows-installation-guide.md` 与 `docs/install/windows-troubleshooting.md` 的新增内容与证据一致：说明 side-by-side 方式、绝对路径约束、26200 崩溃、不要运行正式 NSIS。
- 报告中“主进程已执行到创建数据库”（`:57`）由隔离目录中 `morrow.sqlite3`/`-wal`/`-shm` 实际存在支持；但无进程级日志，属于合理推断而非直接日志证据（LOW）。
- 报告称全量 130 files / 1159 tests（`:31`）：仓库内 `.tmp/test60b.log` 确实显示 `130 passed / 1159 passed`、182.32s。按本次审计规则未重跑全量套件，故该数字为“已有日志支持、本次未独立复跑”；新增单测已由审计独立复跑 3/3 通过。
- 未发现省略 BLOCKED、夸大窗口/用户交互或把历史 Provider 结果冒充本次 UI 验收的表述。

## 9. Findings

| ID | 严重度 | 位置 | 发现 | 影响/处置建议 |
| --- | --- | --- | --- | --- |
| F1 | LOW | `docs/reports/morrow-v2-local-deployment-report.md:8`；`docs/reports/morrow-v2-local-deployment-evidence-index.md:4` | 只写“代码 SHA：本文件所在提交（最终 full SHA 以 Issue #60 comment 为准）”，未写本次实际 full SHA `51189361…`；实测 Issue #60 当前 **0 条 comment**，该引用目前悬空 | Issue #60 要求最终完整 40 位 SHA；建议后续在报告/Issue 中补 `51189361bf1c253fc7fa790e9e9be78af7a8f88e` |
| F2 | LOW | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\<runId>\checksums.sha256`；`.tmp/evidence60.ps1:53`（本地脚本，未提交） | 校验文件用 CRLF 写入；Git Bash 下 `sha256sum -c` 对 6/7 个条目报“文件不存在”并 exit 1，仅最后一行（无 CR）通过 | 哈希值本身全部正确；建议改为 LF 写入或用 `--check` 前去除 `\r`。不影响证据完整性判定 |
| F3 | LOW | `%LOCALAPPDATA%\...\deployment.json`（`dataDirFileCount: 54`）vs `isolation.txt`（`isolatedFileCount=60`）；报告 `:59` 与索引 `:55` 采用 60 | 两个证据快照计数不同：`deployment.json` 在首次 15 秒启动结束后（15:45:45）记录 54，`isolation.txt` 在随后 6 组变体启动后（15:49）记录 60；当前仍为 60 | 非核心矛盾（`morrow.sqlite3` 均已存在，默认 profile 未变）；建议在证据中注明快照时间/口径，避免读者误判 |
| F4 | LOW | `electron-runtime.txt`、`engine-variants.txt`；`.tmp/evidence60.ps1:19-36` | 两个证据文件由脚本按硬编码字符串写入，属于“结果摘要”而非原始命令捕获；同理 `host.txt`/`isolation.txt` 也是脚本汇总 | 独立探针已复现核心结果（`--version` `0x80000003`；带部署参数 `0xC0000005`；WER offset 一致），结论不受影响；建议后续保留原始 stdout/exit code |
| F5 | LOW | `docs/install/windows-troubleshooting.md:14`；`electron-runtime.txt` 的 `minimal-electron-window` 行 | 文档称最小窗口应用以 `0xC0000005` 退出，但未说明参数；本次独立复现显示：无参数时 7/7 为 `0x80000003`，加 `--no-sandbox --disable-gpu` 后 4/4 为 `0xC0000005` | 结论“无法创建窗口”成立；建议文档写明复现参数，避免读者按无参数复现时看到不同异常码 |
| F6 | LOW | `src/app/index.ts:41`；`src/app/acceptance-data-path.ts:12-14` | 相对路径在模块顶层抛错，早于 logger/`reportStartupFailure`/对话框初始化；属于 fail-closed，但用户看不到任何错误提示，表现为静默启动失败 | 行为符合“绝不回退正式 profile”的设计；建议在 release 说明/故障排查中写清该失败模式 |
| F7 | LOW（隐私） | `%LOCALAPPDATA%\...\deployment.json` 的 `artifact.source` | 本地证据记录了构建仓库绝对路径（含用户名），超出部署根范围 | 该文件未提交到仓库；仓库内文档只用 `%LOCALAPPDATA%`，未泄漏。建议共享证据前脱敏 |
| F8 | INFO | `docs/testing/morrow-v2-local-deployment-acceptance-matrix.md:23` | 矩阵第 16 项在本次提交仍为 PENDING（独立审计） | 本审计文件已完成对应复核；按本次规则未修改既有矩阵，后续可由交付方更新 |
| F9 | INFO | 全量测试声明 `docs/reports/...report.md:31` | 全量套件未由审计独立复跑（审计规则禁止），仅核对既有日志 `.tmp/test60b.log` | 建议最终收口时由 CI 或交付方在冻结 SHA 上重跑并保留原始日志 |

未发现 BLOCKER/HIGH 级产品代码、测试或文档问题。任务目标层面的 BLOCKER 是宿主 Electron 运行时崩溃（环境级，非本次 diff 可修复）。

## 10. 命令与真实退出码

| 命令/操作 | 真实结果 | 退出码 |
| --- | --- | --- |
| `git rev-parse HEAD` / `HEAD^` | `51189361…` / `2ffb697…` | 0 |
| `git status --porcelain`（写审计文件前） | 空 | 0 |
| `git diff --stat 2ffb697..HEAD` | 9 files, +272/-2 | 0 |
| `git log --oneline 2ffb697..HEAD` | 1 commit | 0 |
| `git ls-remote origin …` | branch=`51189361…`；main=`8b207b7d…`；release=`3812b185…` | 0 |
| `npx vitest run tests/acceptance-data-path.test.ts` | 1 file / 3 tests passed / 0 failed | 0 |
| `sha256sum release-local/win-unpacked/Morrow.exe` 与部署副本 | 均为 `42749ba5…` | 0 |
| `sha256sum release-local/win-unpacked/resources/app.asar` 与部署副本 | 均为 `bd77ea92…` | 0 |
| Python 重算 `checksums.sha256` 的 7 个值 | 7/7 一致 | 0 |
| `sha256sum -c checksums.sha256`（Git Bash） | 6 个 CRLF 文件名读取失败，1 个 OK | 1（见 F2） |
| 默认 profile 文件清点 | 66 files；newest `2026-10-29T07:59:02.2867039Z` | 0 |
| 旧版目录清点 + 逐文件哈希 + canonical | 74 files / 386,629,322 bytes；0 差异；`206f9a…` | 0 |
| HKCU 卸载键读取与快照哈希 | 值匹配；`d0c7c12f…`；`MATCH=yes` | 0 |
| `electron.exe --version` | exit `-2147483645`（`0x80000003`），无输出 | 非 0 |
| 最小窗口探针（无参数，7 次） | 7/7 `0x80000003`，无窗口 | 非 0 |
| 最小窗口探针（`--no-sandbox --disable-gpu`，2 次） | 2/2 `0xC0000005`，无窗口 | 非 0 |
| 最小窗口探针（再加 `--in-process-gpu`，2 次） | 2/2 `0xC0000005`，无窗口 | 非 0 |
| WER 查询 | `Morrow.exe` `0xc0000005` offset `0x357db3a`；另有 `0x80000003` offset `0x32f3f4c` | 0 |
| `gh pr view 54` | OPEN；head `51189361…`；base `3812b185…`；MERGEABLE/CLEAN | 0 |
| `gh api …/actions/runners` | `total_count=0` | 0 |
| `gh api …/commits/5118936…/check-runs` | `total_count=0` | 0 |
| `gh api …/commits/5118936…/status` | `state=pending`，`total_count=0` | 0 |
| Actions artifacts（reviewed SHA） | 无匹配 artifact；无该 SHA 的 workflow run | 0 |

## 11. 安全与隐私复核

- `git diff 2ffb697..HEAD` 与三份新文档：未发现 API key/token/`Authorization` 凭据/密码模式；未出现 `C:\Users\...` 完整用户路径（仓库内文档仅用 `%LOCALAPPDATA%`/`%APPDATA%`）。
- 未读取 `.tmp/spark.key`，未读取任何用户数据库/聊天内容；旧版目录只做了元数据与程序文件哈希；隔离目录只列文件与大小，未打开 `morrow.sqlite3` 内容。
- 未执行正式 NSIS/安装器；`F:\morrow1` 与 HKCU 键未改动可独立复现。
- CI 侧：PR #54 OPEN，head 与本地/远端一致；0 个已注册 runner；reviewed SHA 无 check-run、无 status、无 workflow run、无 artifact，未产生 Actions 计费迹象。

## 12. 残余风险

1. **宿主 Electron 崩溃不可由仓库修复**：Windows 26200 上最小 Electron 与 `--version` 均失败；在更换到非 26200 的标准 Windows 前，窗口/60 秒稳定性/UI/记忆写入/Provider UI 均无法验收。这是当前 BLOCKED 的唯一根因。
2. **默认 profile 的“未修改”只有计数 + 最新 mtime 证据**，未做全量 canonical hash（为遵守不读取用户数据的边界）；理论上存在“数量与 mtime 不变但内容被改”的检测盲区，实际证据与隔离机制均指向未触碰。
3. **隔离依赖 `app.getPath` 的调用链**：当前数据库与 secret store 均通过它取得路径；未来若新增绕过 `app.getPath` 的硬编码路径，可能破坏隔离，需要回归测试守护。
4. **环境变量误配为相对路径时静默失败**（无对话框），运维/用户需知道该行为。
5. **证据快照口径漂移**（54→60 文件）与 CRLF 校验文件降低可复现性；核心哈希与隔离结论不受影响。
6. **全量测试与 tree 构建未由审计独立重跑**（规则限制），仅核对既有日志与产物哈希。

## 13. 最终结论

- 隔离代码：**PASS**
- 默认行为：**PASS**
- 部署证据：**PASS**（LOW 级证据卫生问题）
- 旧版保护：**PASS**（目录 74 文件、canonical hash 与注册表快照均独立复现）
- Electron 窗口：**BLOCKED**（`0xC0000005`/`0x80000003`，无窗口；WER offset `0x357db3a`）
- 文档诚实性：**PASS**（无过度声明；仅最终 SHA 引用与证据格式需补强）
- 用户交互：**PENDING_USER_ACTION**
- 独立审计：**COMPLETE**

**Overall: BLOCKED.** 本机隔离部署与数据保护已验证成立，但应用窗口无法启动，不能称为部署成功或本机实机验收完成。未发现需要在 24h 内修复的仓库可控 BLOCKER/HIGH；阻塞来自宿主 Windows build 26200 的 Electron/Chromium 运行时崩溃，需在受支持的 Windows 版本上重新执行启动与用户交互验收。
