# Windows 构建、安装器与 smoke

## 构建

- `npm run build`：PASS（exit 0，`results/issue74-build.log`）。
- Electron 44.9.3 x64，electron-builder 26.15.3。
- portable runtime 使用 `release/win-unpacked` 的 Electron 运行时；本任务用当前 `out/` + `package.json` 重新打包 `resources/app.asar`（SHA-256 见 `11-machine-results.json`），因为 NSIS 第一步在下载/执行阶段被外部服务阻塞。

## NSIS installer

**BLOCKED**。

两次尝试：

1. `npx electron-builder --win nsis --x64 --publish never`
   - 失败：`Response code 504 (Gateway Time-out)` while downloading electron/winCodeSign 资源（`results/issue74-package.log`）。
2. `--config.win.signAndEditExecutable=false`
   - 同样失败：504；没有生成新的完整 installer（`results/issue74-package2.log`）。
   - 旧的 189,809-byte `release/Morrow-Setup-2.0.0-x64.exe` 是 Issue #72 遗留的 **stub**，不是有效安装器；本任务没有运行或冒充它。

## Portable

- 重新打包：`npx asar pack .tmp/asar-stage release/win-unpacked/resources/app.asar`
- 结果：1,369,540 bytes，SHA-256 `ba2e88764b1f9a12cddda76c819ce8b46681afbc7939bf55da94001ede93b895`。
- Portable zip：`release/Morrow-2.0.0-x64-portable.zip`，154,656,028 bytes，SHA-256 `e1eaaa5fb2653fac78acd208941a63cb445e17435e6abf8bf131ee2b6cfdad99`。
- 目录：`release/win-unpacked/`；可启动性由 `smoke:product-path`（`MORROW_PRODUCT_EXECUTABLE=release/win-unpacked/Morrow.exe`）验证；结果见 `results/issue74-portable-smoke.log`（PASS，runId `20261108T101020Z-64686c86`）。
- 该 portable 不是正式 NSIS 安装器；不得把它误标为 installer。

## 安装/升级隔离

- 未在用户生产数据、Morrow V1（`F:\morrow1`）或现有 V2 userData 上执行安装/卸载。
- 代码路径仍使用明确 userData/profile 目录；`product-path` 使用隔离临时 profile。
- 用户 Windows 桌面实机安装：**PENDING_USER_ACTION**。

## 签名

- 未配置代码签名证书；构建为 **unsigned**。没有伪称签名通过。
