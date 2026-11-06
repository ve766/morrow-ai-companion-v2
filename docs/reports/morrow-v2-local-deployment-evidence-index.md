# Morrow V2 本机部署证据索引（Issue #60）

- 基线 HEAD：`2ffb697cff3491a0f67080a35bb163f87603ca4b`
- 代码 SHA：`51189361bf1c253fc7fa790e9e9be78af7a8f88e`（parent `2ffb697`）
- 文档/审计 HEAD：见 Issue #60 comment
- 最终状态：**BLOCKED**（隔离部署/数据隔离 PASS；Electron 窗口无法启动）
- Run ID：`8d94195efd014ae49d0fa224a9022294`

## 1. 部署路径

| 项 | 路径 |
| --- | --- |
| App | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\8d94195efd014ae49d0fa224a9022294` |
| 数据 | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\user-data\8d94195efd014ae49d0fa224a9022294` |
| 日志 | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\logs\8d94195efd014ae49d0fa224a9022294` |
| 证据 | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\8d94195efd014ae49d0fa224a9022294` |

## 2. 产物

| 文件 | 大小 | SHA256 |
| --- | --- | --- |
| 部署 `Morrow.exe`（= `release-local\win-unpacked\Morrow.exe`） | 246,819,840 | `42749ba5833aa6c8d371135002705931ebaa013a424d8613575a4b1268862b98` |
| `release\Morrow-Setup-2.0.0-x64.exe`（未执行） | 111,771,999 | `5aeb40276def2323babe7c9e32ec2946f9ae44e29ef0cc8d13f0e0082b3e5977` |
| Portable（仓库内） | 100,542,249 | `e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b` |

## 3. 命令与退出码

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 无错误 |
| `npm test` | 0 | 130 files / 1159 tests passed / 0 failed / 0 skipped（182.32s） |
| `npm run build` | 0 | main/preload/renderer 成功 |
| `npx electron-builder --win dir --x64 --publish never -c.directories.output=release-local` | 0 | unpacked app 生成 |
| `deploy60.ps1` 部署+启动 | 0（脚本） | 部署成功；启动进程 exit `0xC0000005` |
| Electron 44.9.3/44.10.2/45.2.3 `--version` | 3 | `0x80000003`，无输出 |
| 最小 Electron 窗口 | crash | `0xC0000005`，无窗口 |
| 应用 6 组启动参数 | crash | 5×`0xC0000005`、1×`0x80000003`，均无窗口 |

## 4. 证据文件与 SHA256

| 文件 | SHA256 |
| --- | --- |
| `deployment.json` | `dc4e97da6c4f037c9ae9a3eaf8866ca263304badd191062acc1f2320ac345723` |
| `old-install-before.json` | `4c04eb72c5ff358cb65da1756bfa2e7b83f99a00e453467f6ecc1ce613db8e35` |
| `old-install-after.json` | `4c04eb72c5ff358cb65da1756bfa2e7b83f99a00e453467f6ecc1ce613db8e35` |
| `electron-runtime.txt` | `dcaf1924467b3499f5231b8902f8c7b75c1bd34c1dcbd557e28c0684f9183cc0` |
| `engine-variants.txt` | `dd67543dbe95228155a65cbabaf6eb0b5d32c1462eadb932f5857eaf4bfeb544` |
| `host.txt` | `d37c29ba6de3eae8e4ef56c331f0f40285d510ad3709197a1eeaa3e9cf843672` |
| `isolation.txt` | `300c7f97001932985f91ed1a0196030b7f8755ecc2fb83386d5a1b6bdd735f46` |
| `checksums.sha256` | `7cd8e361db7e8e0f7c7d81f1d60ebe59881c1d2228b0b50ae3767ed5d14f82fb` |

`checksums.sha256` 覆盖上述除自身外的所有证据文件；文件使用 CRLF 行尾，PowerShell 验证方式：

```powershell
Get-Content checksums.sha256 | ForEach-Object {
  $hash, $name = $_ -split ' \*', 2
  if ((Get-FileHash -LiteralPath $name -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw $name }
}
'checksums OK'
```

不要直接用 POSIX `sha256sum -c`（会把 CRLF 当作哈希内容的一部分）。两份 old-install JSON 相同即证明旧版 74 个文件清单、长度、mtime、SHA256 未变。

## 5. 数据隔离证据

- `isolation.txt`：隔离 user-data 文件数 60；`morrow.sqlite3` 存在。
- 隔离目录包含 `morrow.sqlite3`/`-shm`/`-wal`、`Local State`、`Local Storage`、`Cache`、`GPUCache` 等。
- 默认 `%APPDATA%\morrow-ai-companion` 仍 66 个文件，最新 mtime `2026-10-29T07:59:02Z` 未变。
- 旧版 `F:\morrow1` 部署前后 74 个文件，canonical hash `206f9a593ee5032f68145372556cf89ef7b0a15f67b224410479b97c191dac91` 相同。
- 旧版 HKCU 卸载键快照 SHA256 `d0c7c12f2e74903a48e6cfc0c45a80508fd1851471c3ff9ac895cad6144a6bb8` 前后相同。

## 6. 崩溃证据

- WER：APPCRASH `Morrow.exe 2.0.0.0`，异常 `0xc0000005`，faulting module `Morrow.exe`，offset `0x357db3a`。
- 最小 Electron（无 Morrow 代码）同样 `0xC0000005`；三个 Electron 版本 `--version` 全部失败。
- 本机 Windows build 26200；已有公开报告（electron#55011、WebView2Feedback#5777）记录该 build 的 Electron/Chromium 启动/退出崩溃。

## 7. 结论

隔离部署、显式数据根、旧版保护和默认 profile 不变均有真实证据；窗口启动被本机 Electron 运行时阻塞。最终 **BLOCKED**，不是 DEPLOYED_AND_RUNNING，也不是本机实机验收完成。
