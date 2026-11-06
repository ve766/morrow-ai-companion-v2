# Morrow V2 本机部署证据索引（Issue #60 修订版）

- 基线 HEAD：`2ffb697cff3491a0f67080a35bb163f87603ca4b`
- 代码 SHA：`07a82d5ff00c1cd0cfce450091fb7e5e1ef573ad`（parent `bb6eb8c`）
- 文档 HEAD：本文件所在提交（最终 full SHA 以 Issue #60 comment 为准）
- 最终状态：**BLOCKED**（窗口在最终审计时被宿主最小化；历史可见/UI 证据仅作过程证据）
- Run ID：`final-1793955356`

## 1. 部署路径与产物

| 项 | 值 |
| --- | --- |
| App | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\final-1793955356\` |
| User data | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\user-data\final-1793955356\` |
| Logs | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\logs\final-1793955356\` |
| Evidence | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\final-1793955356\` |
| `Morrow.exe` | 246,820,352 bytes，SHA256 `e89d1a36a5744a89d0ef1f21db5b6e27038deabeb7c932763ee696f8ca96daef` |
| 正式 NSIS（未执行） | 111,771,999 bytes，SHA256 `5aeb40276def2323babe7c9e32ec2946f9ae44e29ef0cc8d13f0e0082b3e5977` |
| Portable（仓库内） | 100,542,249 bytes，SHA256 `e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b` |

启动参数：`--no-sandbox --disable-gpu --user-data-dir=<data>`；环境变量 `MORROW_LOCAL_ACCEPTANCE_USER_DATA=<data>`、`MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1`。

## 2. 证据文件与 SHA256

| 文件 | SHA256 |
| --- | --- |
| `stability-steady.json`（PID 20732，300 秒无交互，iconic=false/visible=true/responding=true，rect 410,160,1510,920） | `422bcafea74c5ac3744a73d3b6569aca6b98270744b79135f38b40230112fc71` |
| `stability-visible.json`（更早 PID 8956 的 300 秒可见采样，历史） | `9dbbcd50e5998a572169fcf68a179e48ec05603798083f3ae69910bc30a4a8a2` |
| `stability-live.json`（更早 PID 19656 的 300 秒存活采样，历史） | `0a25131ffada3cbfb88f72663b913914ec957a5a849020400684a32356d023a1` |
| `ui-uia-final.json`（PID 20732，UIA 读取设置/记忆） | `977c07d481523600c2a52e7aa76db5bc1753703fb4b15055adc88d810fa839fe` |
| `ui-chat-final.json`（PID 20732，无 Provider 对话） | `8be9eb51231365a8ce6cbefecb08590d0dd7acfe5d0bd6df673087c6e6c92acc` |
| `window-state.json` | `1f3159c61a3b6eb0fde77bceec7621467433c1d974412de454d947290c1e9e32` |
| `v1-retirement-result.json` | `9112c3538240edb1b9a61ea5f0de332d1bf2587ab39ba8df3a8e630a62d5e0ad` |

## 3. V1 备份与退役

| 项 | 值 |
| --- | --- |
| 备份根 | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\v1-retirement-backup\essential-20261106T090624Z\` |
| App 备份 | 74 files / 386,629,322 bytes / canonical `193784f4b981613c9f79782a9fc9dc3fe1fcc66d1e9b16b9ee18a536144be7d5` |
| Data 备份 | 14 files / 414,954 bytes / canonical `015bf16ed872641271544673d24d8e08ab96df095f769816478d9afe8fbebb04` |
| DB | `data\morrow.sqlite3` 存在，SQLite header 可读（未输出内容） |
| `backup-manifest.json` | `4a98a00beccf726e8984d8a969096dd2c8e8d3e211887d2429cc51646bf9a416` |
| `checksums.sha256` | `0d988915e769ce1b79c6c860dc4ce28371039a678defb26e17f9ba9aea160794` |
| 卸载器 | `F:\morrow1\Uninstall Morrow.exe /S /currentuser`，exit 0 |
| 卸载后 | HKCU `92ffd461-...` 不存在；`F:\morrow1` 0 文件；`%APPDATA%\morrow-ai-companion` 仍 66 文件 |

## 4. 根因证据

| 检查 | 结果 |
| --- | --- |
| Electron 44.9.3 从 `%LOCALAPPDATA%\et44\dist` 启动 | `--version` = v44.9.3，exit 0；最小窗口可见 |
| 同一 Electron 从原仓库路径（`morrow v2`）启动 | `0xC0000005`，无窗口 |
| 复制到 E: 无空格、E: 短空格、C: 空格、C: 长空格路径 | 均可启动；因此不把原因简化为空格/驱动器/长度 |
| 应用 asar 最小启动（空页面、无 DB） | `new BrowserWindow` 后崩溃 |
| 应用 asar + `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1` + `--no-sandbox` | 主进程到达 `did-finish-load`，完整 UI 加载 |
| 默认路径 | 仍调用 `app.enableSandbox()`；仅验收环境变量跳过 |

## 5. UI 与持久化证据

- 设置页：模型接入配置、官方 DeepSeek、本地模型、本地认知、备份恢复区块可见；密钥仅进入 OS 安全存储。
- 无 Provider 发送：状态“尚未配置 Provider”，未新增消息、未伪造回复。
- 记忆：`验收测试记忆：Morrow V2 在本机 Build 26200 已启动` 保存成功；完全重启后仍存在；位于 V2 隔离 user-data。
- 以上 UI 证据来自 PID 20732：`ui-uia-final.json`（设置/记忆）与 `ui-chat-final.json`（无 Provider 对话），与 5 分钟可见稳定性同一进程。

## 6. 命令与退出码

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 无错误 |
| `npm test` | 0 | 130 files / 1159 tests passed / 0 failed / 0 skipped（176.86s） |
| `npm run build` | 0 | 成功 |
| `electron-builder --win dir --x64 --publish never -c.electronDist=node_modules/electron/dist` | 0 | unpacked app |
| 本机启动 + 5 分钟稳定性 | PASS | PID 20732，`stability-steady.json` 300 秒可见/非最小化/Responding |
| 设置/无 Provider/记忆重启 | PASS | `ui-uia-final.json` |
| V1 卸载 | 0 | 注册项删除、程序文件 0、profile 保留 |

## 7. 结论

V1 已安全退役并保留可校验备份；V2 已部署，UIA/记忆/设置/无 Provider 与历史 300 秒可见采样通过。但宿主在数秒至数分钟内将窗口最小化，独立审计 60/60 样本不可见。整体 **BLOCKED**；Provider/用户手动体验仍 **PENDING_USER_ACTION**。
