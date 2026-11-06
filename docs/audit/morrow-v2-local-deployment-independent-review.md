# Morrow V2 本机部署独立复核（最终复核，Issue #60）

- 仓库：`ve766/morrow-ai-companion-v2`
- PR：#54（OPEN，未合并）
- 分支：`feat/morrow-v2-final-closure`
- 被审 docs HEAD：`0bc45e185d23ec45c6a9b76a86c2a1c317580d1a`
- 被审代码 SHA：`07a82d5ff00c1cd0cfce450091fb7e5e1ef573ad`（docs HEAD 的 parent）
- Parent（docs）：`23faf14cffbd70caec07d87735cc93b2d80a8e42`
- PR base：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 远端分支/PR head：`0bc45e1…`（与本地一致）
- 复核边界：只读复核；未停止/重启/恢复 V2 窗口；未修改产品代码、测试、workflow、脚本、既有文档或证据；未 commit/stage/push；未运行 `npm ci`/`npm install`/全量测试/`npm run build`/`npm run package:win`/NSIS。未读取 `.tmp/spark.key`；未读取 V1/V2 数据库内容或真实聊天记录（仅读取 SQLite 16 字节文件头、文件哈希与 UI 合成验收字符串）。**未 invoke/click 任何 UIA 元素**；只读取现有 UIA 树。
- 取代关系：**本文件取代此前同路径的所有 BLOCKED 复核**。

## 1. 结论摘要

**Overall status: BLOCKED。**

本轮证据文件、代码 gate、V1 备份/退役、单测与 PR 状态均通过；UIA 当前树只读读取也显示 chat/no-provider 视图，未进行任何 UIA 导航。但**当前 PID 20732 主窗口从启动到最终检查都处于最小化**：两次独立的 60 秒轮询（启动后 18:54–18:59，以及最终 19:11–19:12）共 60 个样本全部 `IsIconic=True`、`GetWindowRect=(-32000,-32000,-31840,-31972)`。这与 `stability-steady.json`/`window-state.json`/`ui-uia-final.json`/`ui-chat-final.json` 声称的 `iconic=false/visible=true/rect 410,160,1510,920` **直接矛盾**。

按本轮规则“PID 20732 不可见/离屏或证据矛盾则保持 BLOCKED”，不能授予 `DEPLOYED_USER_TEST_PENDING`。本次没有 invoke/click UIA；最小化不是复核方 UIA 导航造成的，至少在启动轮询时窗口已是最小化。窗口最小化的原因未确定；需要操作者在可见状态下重新启动/恢复并复核。

## 2. 判定表

| 复核项 | 判定 | 证据 |
| --- | --- | --- |
| 身份/变更范围 | **PASS** | HEAD `0bc45e1`；parent `23faf14`；docs-only 3 files +23/-19；worktree 除本审计文件外 clean；代码 SHA `07a82d5` |
| 沙箱 gate | **PASS** | `src/app/index.ts:72-78`：默认 `app.enableSandbox()`；仅 `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1` 追加 `no-sandbox` |
| 单测 | **PASS** | `tests/acceptance-data-path.test.ts` 1 file / 3 tests passed / 0 failed，exit 0 |
| V1 备份 | **PASS** | 74 app / 386,629,322 bytes / canonical `193784f4…`；14 data / 414,954 bytes / canonical `015bf16e…`；88/88 checksums；manifest/checksums 哈希匹配；DB 头可读 |
| V1 退役 | **PASS** | HKCU `92ffd461…` 不存在；`F:\morrow1` 0 文件；默认 profile 66 文件 / 8,718,995 bytes；V1 DB 未变 |
| V2 隔离 | **PASS** | V2 DB/WAL 在隔离 user-data；默认 profile 仍 66 个 V1 文件（含 V1 DB），报告 `:75` 说明正确 |
| V2 进程 | **PASS** | PID 20732 存活；路径 `…\app\final-1793955356\Morrow.exe`；标题/Responding 正确；命令行含 occlusion/backgrounding 关闭参数 |
| **V2 窗口最终可见性** | **FAIL** | 18:54–18:59 与 19:11–19:12 两次 60s 轮询共 60 样本，全部 `IsIconic=True`、rect `-32000…`；UIA 只读后仍最小化 |
| 5 分钟证据文件 | **FAIL（与 live 矛盾）** | `stability-steady.json` 声称 PID 20732 300s 全部 iconic=false/visible=true/rect 410,160,1510,920；hash `422bcafe…` 匹配索引，但 live 状态相反 |
| UI 证据文件 | **PARTIAL/FAIL（最终可见性）** | `ui-uia-final.json` PID 20732、`11:06:11Z`、hash `977c07d4…`；`ui-chat-final.json` PID 20732、`11:06:46Z`、hash `8be9eb51…`；文件字段/哈希一致，但 `finalIconic=false`/`finalVisible=true` 被 live 最小化否定 |
| UIA 当前树（只读） | **PASS（读取）** | root `IsOffscreen=False`；67 个 descendant；`尚未配置 Provider` 命中；未 invoke/click；读取后窗口仍最小化 |
| 文档诚实性 | **PARTIAL/FAIL** | 状态 DEPLOYED_USER_TEST_PENDING、非 COMPLETE；代码 SHA 已写；无 PII 路径；Provider/user 待办与 NSIS 未执行正确；但“最终窗口可见”与 live 矛盾，evidence 文件与 live 矛盾 |
| 安全扫描 | **PASS（带 LOW）** | diff/evidence 无 API key/token/Bearer/私钥；当前 docs 无 PII 路径；diff 仅移除一条历史本机路径；无 9333/CDP 端口 |
| 仓库/CI | **PASS** | PR #54 OPEN；head `0bc45e1`；0 registered runners；HEAD check-runs/workflow runs 均 0；status pending/0 |
| 独立审计 | **COMPLETE** | 本文件 |

## 3. 身份与变更范围

| 项 | 实测 |
| --- | --- |
| `git rev-parse HEAD` | `0bc45e185d23ec45c6a9b76a86c2a1c317580d1a` |
| `git rev-parse HEAD^` | `23faf14cffbd70caec07d87735cc93b2d80a8e42` |
| 代码 SHA | `07a82d5ff00c1cd0cfce450091fb7e5e1ef573ad` |
| 工作区 | 仅 `docs/audit/morrow-v2-local-deployment-independent-review.md` 修改；其余 clean |
| `git diff --stat 23faf14..HEAD` | 3 files changed, 23 insertions(+), 19 deletions(-) |
| 变更文件 | 3 个 `docs/reports|testing` 文档；无 `src/**`、package/lockfile、schema、workflow、测试/脚本 |
| 远端/PR | 分支 `0bc45e1`；PR #54 OPEN，head `0bc45e1`，base `3812b185` |

## 4. HIGH 发现处理

### 4.1 窗口可见性：**最终仍未解决**

- 启动轮询（18:54–18:59）：PID 20732 存活、标题/Responding 正确，但 30 个样本全部 `IsIconic=True`、`IsWindowVisible=True`、rect `-32000,-32000,-31840,-31972`；`BAD_SAMPLES=30`。
- 最终轮询（19:11–19:12）：同样 30 个样本全部 `IsIconic=True`、rect `-32000…`；`BAD_SAMPLES=30`。
- UIA 只读读取（未 invoke/click）：root `IsOffscreen=False`；67 个 descendant；当前 chat 视图 `尚未配置 Provider` 命中；读取后窗口仍 `IsIconic=True`。UIA 的 `IsOffscreen=False` 不能证明 Win32 窗口未最小化；Win32 状态是权威。
- 因此不是“UIA 导航导致最小化”：本次未导航；窗口在启动后第一次轮询即最小化，并在最终轮询仍最小化。`--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows` 没有让窗口保持可见。

**证据矛盾**：
- `stability-steady.json`（hash `422bcafe…`，mtime 19:04:17）声称 PID 20732 300s、30 samples 全部 `iconic=false/visible=true/responding=true/rect 410,160,1510,920`。
- `window-state.json`（hash `1f3159c6…`，mtime 19:07:05）同样声称 PID 20732 `iconic=false/visible=true/rect 410,160,1510,920`。
- `ui-uia-final.json`（PID 20732，`11:06:11Z`，hash `977c07d4…`）与 `ui-chat-final.json`（PID 20732，`11:06:46Z`，hash `8be9eb51…`）均声称 `finalIconic=false/finalVisible=true`。
- 但 live 18:54–18:59、19:11–19:12 两次轮询均为最小化；证据文件与当前进程状态直接矛盾。证据文件可能对应 18:59–19:04 的短暂可见区间（文件 mtime 可支持），但最终状态不是可见窗口。

按规则，最终窗口最小化且证据与 live 矛盾 → **BLOCKED**。

### 4.2 UI 证据归属：**文件与 PID 匹配，但最终可见性不成立**

- `ui-uia-final.json`：PID 20732、capturedAt `2026-11-06T11:06:11.9098340Z`、`settingsClicked=true`、`settingsHasProviderConfig/HasDeepSeek/HasLocalModel/HasBackup=true`、`memoryClicked=true`、`memoryContainsTestPhrase=true`、`chatStateSeen=false`、`finalIconic=false/finalVisible=true`。
- `ui-chat-final.json`：PID 20732、capturedAt `2026-11-06T11:06:46.3844553Z`、`chatClicked=true`、`chatStateSeen=true`、`chatMessages=true`、`finalIconic=false/finalVisible=true`。
- 独立 UIA 当前树（只读，未导航）确认 chat/no-provider 视图与 `尚未配置 Provider`；未独立读取设置/记忆视图（按“禁止 UIA 导航”规则）。因此 UI 字段/证据可接受，但 `finalVisible=true` 被 live 最小化否定。

### 4.3 根因文档：**已解决**

- 报告 `:15-17` 区分：Electron 44.9.3 原仓库 checkout 路径失败；44.9.3 复制到 `%LOCALAPPDATA%\et44` 成功；35.7.5 复制到 E:/C: 空格/长路径成功；明确“不能用同一版本完整隔离”，不把原因简化为空格/驱动器/长度。
- 报告 `:24` 把 Issue #59 的 0xC0000005 指向 Windows 26200 强制沙箱启动路径以及原仓库路径不可用；应用级 `app.enableSandbox()` gate 仍为代码层原因。
- 与独立核验一致（前轮已复现；本轮代码/docs 未变）。

### 4.4 其他发现

- F4 logs：`logs\final-1793955356\` 存在，0 文件；路径正确、内容为空（INFO）。
- F5 code SHA：报告 `:8`、证据索引 `:4`、矩阵 `:4` 均已写 `07a82d5`；文档 HEAD 独立标注。**已解决**。
- PII：当前 docs 无 `C:\Users`/`E:\Hasee` 路径（diff 仅删除一条历史路径）。**已解决**。
- F6 验收路径空值回退：`src/app/acceptance-data-path.ts:4-6,10-11` 仍把 `''`/空白回退默认 profile（LOW，未变）。
- F7 沙箱绕过进入正式产物：`src/app/index.ts:72-78` 默认仍沙箱，env 可跳过（LOW，未变）。

## 5. V1 备份与退役复核

- essential 备份存在：app 74 files / 386,629,322 bytes；data 14 files / 414,954 bytes。
- `checksums.sha256`：88/88 匹配。
- canonical 独立重算：app `193784f4b981613c9f79782a9fc9dc3fe1fcc66d1e9b16b9ee18a536144be7d5`；data `015bf16ed872641271544673d24d8e08ab96df095f769816478d9afe8fbebb04`。
- `backup-manifest.json` SHA256 `4a98a00b…`；`checksums.sha256` SHA256 `0d988915…`。
- `data\morrow.sqlite3` 16 字节头 `SQLite format 3\0`。
- HKCU `92ffd461-3512-54f9-8cf5-c344989830ea` 不存在；`F:\morrow1` 目录存在 0 文件；`%APPDATA%\morrow-ai-companion` 66 files / 8,718,995 bytes；V1 DB 311,296 bytes、mtime `2026-10-25 17:51:33`。
- `v1-retirement-result.json`（hash `9112c353…`）：uninstallerExit=0、registryExistsAfter=false、v1DirFilesAfter=0、profileFilesAfter=66，与独立观测一致；卸载器退出码未重跑（规则禁止）。

## 6. V2 运行、隔离与 UIA

- PID 20732，路径 `…\app\final-1793955356\Morrow.exe`；启动 18:54:20；命令行 `--no-sandbox --disable-gpu --force-renderer-accessibility --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --user-data-dir="…\user-data\final-1793955356"`；无 remote-debugging port。
- 两次 60s 轮询（30×2s）均为 `IsIconic=True`、rect `-32000…`；`Responding=True`、标题正确。
- UIA 只读：root `IsOffscreen=False`；67 个 descendant；chat 视图 `尚未配置 Provider` 命中；未 invoke/click；读取后仍最小化。
- 证据文件：`stability-steady.json` PID 20732、300s（30 samples）；`ui-uia-final.json` PID 20732、`11:06:11Z`；`ui-chat-final.json` PID 20732、`11:06:46Z`；`window-state.json` PID 20732；`checksums.sha256` 10/10 匹配。**文件内部一致，但最终可见性与 live 矛盾。**
- 隔离：V2 DB/WAL 在隔离 user-data；默认 profile 66 个 V1 文件（含 V1 DB），未被 V2 写入；报告 `:75` 已说明。

## 7. 文档诚实性与安全

- 状态：报告 `:10,:122`、索引 `:6,:80`、矩阵 `:5,:27,:31` 均 `DEPLOYED_USER_TEST_PENDING`，明确不是 COMPLETE；Provider/用户手动体验 `PENDING_USER_ACTION`；正式 NSIS 未执行。**PASS**。
- 代码 SHA：报告 `:8`、索引 `:4`、矩阵 `:4` 均 `07a82d5`；文档 HEAD 单独标注。**PASS**。
- 根因：报告 `:15-17` 与 44.9.3/35.7.5 证据一致；应用级 gate 正确。**PASS**。
- 默认 profile V1：报告 `:75` 正确（66 个 V1 文件，含 V1 DB；V2 未写入）。**PASS**。
- logs：`logs\final-1793955356\` 存在，0 文件；路径正确、内容为空（INFO）。
- 问题：文档/矩阵称“窗口真实可见/最终 ICONIC=false”，但 live 两次 60s 轮询均为最小化；`stability-steady`/`window-state`/`ui-*-final` 的 `finalVisible=true` 与 live 矛盾。**PARTIAL/FAIL**。
- 安全：`git diff 07a82d5..HEAD` 与 evidence 无 API key/token/Bearer/私钥；当前 docs 无 PII 路径；无真实聊天；证据只含合成验收字段。当前进程无 9333/CDP 端口；UIA 为 Windows UI Automation。

## 8. 命令与真实退出码

| 命令/操作 | 真实结果 | 退出码 |
| --- | --- | --- |
| `git rev-parse HEAD` / `HEAD^` | `0bc45e1…` / `23faf14…` | 0 |
| `git status --porcelain`（写本文件前） | 仅审计文件修改 | 0 |
| `git diff --shortstat 23faf14..HEAD` | 3 files, +23/-19 | 0 |
| `npx vitest run tests/acceptance-data-path.test.ts` | 1 file / 3 tests passed / 0 failed | 0 |
| 启动后 60s 窗口轮询（PID 20732，30×2s） | 全部 ICONIC=True、RECT=-32000…；BAD_SAMPLES=30 | 0 |
| 最终 60s 窗口轮询（19:11–19:12，30×2s） | 全部 ICONIC=True、RECT=-32000…；BAD_SAMPLES=30 | 0 |
| UIA 只读当前树（未 invoke/click） | root offscreen=False；67 descendants；`尚未配置 Provider` 命中；读取后仍最小化 | 0 |
| `stability-steady.json` | PID 20732；30 samples 10–300s；文件称 all iconic=false/visible=true/rect 410…；hash `422bcafe…` | 0 |
| `ui-uia-final.json` / `ui-chat-final.json` | PID 20732；capturedAt `11:06:11Z` / `11:06:46Z`；hash `977c07d4…` / `8be9eb51…` | 0 |
| `window-state.json` | PID 20732；文件称 iconic=false/visible=true/rect 410…；hash `1f3159c6…` | 0 |
| evidence `checksums.sha256` | 10/10 匹配 | 0 |
| V1 `checksums.sha256` | 88/88 匹配 | 0 |
| V1 canonical / DB 头 / manifest / checksums | `193784f4…` / `015bf16e…` / `SQLite format 3\0` / `4a98a00b…` / `0d988915…` | 0 |
| HKCU / `F:\morrow1` / profile | 不存在 / 0 文件 / 66 文件 | 0 |
| `logs\final-1793955356` | 存在，0 文件 | 0 |
| PR #54 | OPEN；head `0bc45e1`；base `3812b185`；CLEAN | 0 |
| Actions runners / HEAD checks / HEAD runs | 0 / 0 / 0 | 0 |
| secret scan diff/evidence | 0 key/token hits；当前 docs 无 PII 路径 | 0 |

## 9. 残余风险

1. **窗口最终最小化**：两次独立 60s 轮询均为 `IsIconic=True`；UIA 当前树只读也未改变。这是当前 BLOCKED 的直接原因。
2. **证据与 live 矛盾**：`stability-steady.json`/`window-state.json`/`ui-*-final.json` 均声称可见/非最小化，但 live 最小化；证据可能对应某个历史可见区间，不是最终状态。需重新采集最终状态证据。
3. **UIA 导航未复现**：本轮严格未 invoke/click；窗口在启动轮询即最小化，说明最小化不必然由 UIA 导航引起。
4. **V1 卸载器 exit 0 仅有证据值**：端状态已独立验证；卸载过程未重跑。
5. **根因未完全隔离**：44.9.3 原仓库路径失败、et44 44.9.3 成功；35.7.5 路径副本成功；同一 44.9.3 的路径因素仍无完整矩阵。
6. **空值回退/沙箱绕过**：验收 env 空值时回退默认 profile；env 可让正式构建无沙箱运行（LOW）。
7. **全量测试/构建/CI 未独立重跑**：仅单测 3/3；CI 0 runner/0 run。
8. **logs 空文件**：路径正确、无日志内容（INFO）。

## 10. 最终结论

- 身份/代码/单测：**PASS**
- V1 备份/退役：**PASS**
- V2 隔离：**PASS**
- V2 进程：**PASS**（PID 20732 存活、路径/标题/Responding；但窗口最小化）
- **V2 窗口最终可见性：FAIL**（两次 60s 轮询全部 `IsIconic=True`、rect `-32000…`；未做 UIA 导航）
- 5 分钟证据文件：**FAIL（与 live 矛盾）**（`stability-steady` 声称 300s 可见；live 最小化）
- UI 证据文件：**PARTIAL/FAIL（最终可见性）**（PID/时间/哈希匹配；`finalVisible=true` 被 live 否定）
- UIA 当前树只读：**PASS（读取）**（chat/no-provider；未导航）
- 文档诚实性：**PARTIAL/FAIL**（状态/待办/NSIS/代码 SHA/PII 已正确；最终窗口可见性与证据矛盾）
- 安全：**PASS（无密钥；无 PII 当前路径）**
- 仓库/CI：**PASS**

**Overall: BLOCKED。** 本轮没有 invoke/click UIA，窗口在启动轮询和最终轮询都最小化；`stability-steady`/`window-state`/`ui-*-final` 的可见性字段与 live 状态矛盾。按规则不能授予 `DEPLOYED_USER_TEST_PENDING`。若操作者恢复窗口并在可见状态下重新启动/保持 60 秒（不做 UIA 导航），其余通过项支持重新评估；当前未发现新的产品代码/schema/依赖/workflow BLOCKER/HIGH。
