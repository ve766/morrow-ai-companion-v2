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
- 结果：1,393,038 bytes，SHA-256 `a98ca6dee0e668d92eed2a2cce0346ed431844237841ee1421fbfb357fdbf423`。
- Portable zip：`release/Morrow-2.0.0-x64-portable.zip`，154,660,976 bytes，SHA-256 `8591f10b630c0766223d0cb598b485ecfea4ff3ea70e58160313122098ca0109`。
- 目录：`release/win-unpacked/`；可启动性由 `smoke:product-path`（`MORROW_PRODUCT_EXECUTABLE=release/win-unpacked/Morrow.exe`）验证；结果见 `results/issue74-portable-smoke.log`（PASS，runId `20261109T052530Z-71ed544f`）。
- 该 portable 不是正式 NSIS 安装器；不得把它误标为 installer。

## 安装/升级隔离

- 未在用户生产数据、Morrow V1（`F:\morrow1`）或现有 V2 userData 上执行安装/卸载。
- 代码路径仍使用明确 userData/profile 目录；`product-path` 使用隔离临时 profile。
- 用户 Windows 桌面实机安装：**PENDING_USER_ACTION**。

## 签名

- 未配置代码签名证书；构建为 **unsigned**。没有伪称签名通过。

## 第二轮

- 代码新增 v56 mood 表；portable asar 需要按最终 build 重新打包（见最终评论 SHA/大小）。
- NSIS 仍 BLOCKED：electron-builder 下载 winCodeSign/electron 资源 504；没有有效 installer。
- 旧 189KB stub 未运行、未冒充。

## 第二轮：自定义 NSIS 安装器

- 由于 electron-builder 的 winCodeSign 下载 504，使用缓存 NSIS 3.0.4.1 手动编译了真实 NSIS 安装器：
  - `release/Morrow-2.0.0-x64-custom-setup.exe`
  - 158,382,905 bytes，SHA-256 `dd7a2f895c23bc5805264705aeb3a37b6500046bc2a060abfcfca47c3f9b8184`
  - PE `MZ` 与 `Nullsoft NSIS` 标记存在；编译日志 `results/custom-nsis-build.log`。
- 隔离安装尝试：`/S /D=C:\morrow-install-test` 返回 exit 2，目录未创建；未把它标记为安装 PASS。自定义安装器 **BUILT_NOT_INSTALL_VERIFIED**，不是 electron-builder 产物。
- 未运行旧 189KB stub；未触碰 `F:\morrow1` 或生产 userData。
