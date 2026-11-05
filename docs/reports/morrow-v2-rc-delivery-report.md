# Morrow V2 Windows RC 交付报告

- 仓库：https://github.com/ve766/morrow-ai-companion-v2
- PR：https://github.com/ve766/morrow-ai-companion-v2/pull/54
- 分支：`feat/morrow-v2-final-closure`
- Base：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 本轮代码 SHA：`fad6a94eef19ce5cfbdca9f4c0e1af0aca08074c`
- 上一冻结 SHA：`ff5b7876fcfd01a1e53c18c91b35aec47752ca31`
- 版本：`2.0.0`
- 最终状态：**PARTIAL**

## 1. 本轮修复

### A. CI 0-step 失败

- 失败 run：`42005665855`（df8f802）、`42007647526`（ff5b787）、`42001850336`（13ce2a6）以及后续 docs HEAD。
- 证据：4 个 job 均 `runner_id=0`、`runner_name=""`、`steps=[]`，开始/结束间隔 2–3 秒，无 job 日志；workflow 文件在绿色 run `41997137337` 后未变，`gh api` 显示 Actions enabled、0 self-hosted runners、GitHub status operational。
- 判断：GitHub Actions 启动/runner 分配基础设施失败，不是代码/测试失败；rerun 复现。required checks 仍为红色，因此不能把最终 SHA 标 PASS。
- 未删除/跳过任何 required check，未用父 SHA 冒充最终 SHA。

### B. 高影响体验/边界修复

| 项 | 文件 | 结果 |
| --- | --- | --- |
| range slider 键盘 focus ring | `src/renderer/src/style.css` | 新增 `:focus-visible` 2px accent + 4px offset |
| 浅色 muted 对比度 | `style.css` | 深空 `#8595ae`，纸面 `#66676d`；新增 `tests/design-tokens.test.ts` 计算 WCAG 对比度（纸面 ≥4.95:1） |
| 长文本换行 | `style.css` | 聊天/记忆/候选/provider metadata 加 `overflow-wrap:anywhere` |
| 390 self-model grid / 导航 | `style.css` | <640 self-model 单列；导航改为可换行 2×2，末项可达 |
| 1280 composer | `style.css` | <1180 聊天消息高度收紧，composer 在首屏可达 |
| Provider 删除确认状态 | `provider-profiles-ui.ts` | 切换/编辑/其他操作时 disarm；内置 local/deepseek/spark 删除按钮禁用并给出原因 |
| providerUiReady | `provider-profiles-ui.ts` | 改为 profile loading 完成后标记，产品路径等待真实状态 |
| reduced-motion canvas | `presence-ui.ts` | 静态绘制一次，不再持续 rAF |
| Consent/Provider 文案 | `companion-ui.ts`、`index.html`、`index.ts` | 通用“模型服务请求”；local 不再声称 HTTPS；dataPolicy 改为 provider egress；显式默认优先级说明 |
| 连续性 tautology | `scripts/product-path-smoke.mjs` | baseline 与 restart 分别从真实 bridge 读取；新增 goal task/progress fixture；allowlist 改为逐行 key + reason |
| 非流式响应边界 | `openai-compatible.ts` | 1 MiB 有界 reader，超限 cancel；新增 adapter 测试 |
| discovery 1 MiB | `companion-service.ts` | 精确 1,048,576 bytes（不是十进制 1,000,000） |

### C. Windows RC

- **Portable RC 已构建**：`evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe`
  - 大小：100,541,544 bytes
  - SHA256：`fd584ffd53f74ffb3d7c93804a8d92a308a84c7ffb2d04b9da7532f73e8ab1da`
  - 版本：2.0.0 · win32-x64
- **NSIS 安装包 BLOCKED_HOST_EXECUTION_POLICY**：electron-builder 生成 NSIS stub 后必须执行它来提取 uninstaller；本机执行返回 exit 2 / 挂起，无法产出完整 NSIS 安装包。Portable target 成功。
- **安装/启动 BLOCKED_HOST_ELECTRON_CRASH**：本机 Electron 44 即使 `--no-sandbox` 也以 0xC0000005 退出；无法完成安装后启动和安装后截图。
- **RC-SHA product-path BLOCKED_CI_INFRA**：最后一次 PASS 是父代码 `6f5fe47` run `20261105T084141Z-45483dd6`；RC SHA 的 CI 0-step 失败，无法在 RC SHA 重跑 Electron 产品路径。
- 安装包未上传到 GitHub Actions artifact：CI 基础设施失败；artifact 以仓库内 portable 文件 + SHA256 提供。正式 GitHub Release 未创建。

## 2. 验证

| 项目 | 结果 |
| --- | --- |
| `tsc --noEmit` | PASS，exit 0 |
| `vitest run` | PASS，129 files / 1156 tests，0 skipped |
| `npm run build` | PASS |
| `npm run evaluate` | PASS |
| `npm run evaluate:cognition` | PASS |
| Portable RC build | PASS（hash 见上） |
| NSIS build | BLOCKED_HOST_EXECUTION_POLICY |
| 安装/启动/截图 | BLOCKED_HOST_ELECTRON_CRASH |
| RC-SHA CI | BLOCKED_CI_INFRA（0-step） |
| 真实 Provider | BLOCKED_QUOTA（既有 403，未重复空转） |
| 本地模型 | BLOCKED_LOCAL_SERVICE_NOT_RUNNING |

## 3. 用户安装步骤

见 `docs/install/windows-installation-guide.md`。当前可下载的是 portable exe；在正常 Windows 桌面（非本机受限宿主）双击运行即可。若需要 NSIS 安装包，必须在可执行 NSIS stub 的环境或恢复的 CI Windows runner 上重跑 `npm run package:win`。

## 4. 风险与回滚

- Portable RC 未在本机启动验证；用户首次运行前请备份 `%APPDATA%\morrow-ai-companion`。
- NSIS 安装包缺失；不要把它描述为已交付。
- CI 0-step 是基础设施问题；代码 SHA 的本地全量测试/构建/评估通过，但 required checks 仍红。
- 回滚：关闭应用，恢复备份的 `morrow.sqlite3` 与 `secrets/`；schema v49 高于 release，不能直接降级打开，必须使用迁移前备份。
- 不自动合并、不发布正式 Release、不修改 main/release。

## 5. 结论

**PARTIAL**：代码/测试/构建/评估和 portable Windows RC 已产出；NSIS 安装包、安装后启动/截图、RC-SHA CI 仍被本机执行策略、Electron 宿主崩溃和 GitHub Actions 基础设施阻断。真实 Provider/本地模型仍为外部阻塞。用户可在正常 Windows 环境试用 portable RC，但在这些阻塞解决前不应开始正式发布决策。
