# Morrow V2 RC 工作日志

- 起始实时 head：`ff5b7876fcfd01a1e53c18c91b35aec47752ca31`
- 本轮代码 SHA：`fad6a94eef19ce5cfbdca9f4c0e1af0aca08074c`
- Base：`3812b18`
- 工作树：本轮开始 clean；代码/测试/构建/RC 产物提交后，仅 RC 文档/二进制为新增。

## 1. 基线

- PR #54：OPEN / not draft / MERGEABLE，head `ff5b787`，base `3812b18`。
- 上次 code-SHA CI `42005665855` 与 docs-HEAD `42007647526` 均 4/4 job 0-step 失败；父代码 `41995422882` 4/4 PASS。
- 最新独立审查：代码 PASS_WITH_NON_BLOCKING_BACKLOG，整体 PARTIAL。
- 真实 Provider 403 BLOCKED_QUOTA；本地服务未运行。

## 2. 本轮实现

| 提交/工作 | 内容 |
| --- | --- |
| B1 | range focus ring；纸面 muted 对比度 `#66676d`；长文本换行；390 self-model 单列/导航换行；1280 聊天密度；Provider 删除状态清理；内置 local 删除禁用；providerUiReady 改为 loading 完成后；reduced-motion canvas 静态 |
| B2 | consent/provider 文案去 DeepSeek 泛化；local 不再声称 HTTPS；dataPolicy 改为 provider egress；显式默认优先级说明 |
| B3 | baseline 与 restart 分别真实 bridge 读取；goal task/progress fixture；allowlist 逐行 key + reason |
| B4 | 非流式成功响应 1 MiB 有界 reader + 测试；discovery 精确 1,048,576 bytes |
| C | portable Windows RC 构建；NSIS BLOCKED_HOST_EXECUTION_POLICY；安装/启动 BLOCKED_HOST_ELECTRON_CRASH |

## 3. 验证命令

| 命令 | 退出码/结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 |
| `npx vitest run`（TEMP/TMP=.tmp/es） | 0；129 files / 1156 tests，0 skipped |
| `npm run build` | 0 |
| `npm run evaluate` | 0 |
| `npm run evaluate:cognition` | 0 |
| portable build | 0；`Morrow-2.0.0-x64-portable.exe` 100,542,249 bytes |
| NSIS build | BLOCKED；installer stub exit 2/挂起 |
| portable launch | BLOCKED；宿主 Electron 0xC0000005 |

## 4. CI 诊断

- 失败 run 的 job：`runner_id=0`、`runner_name=""`、`steps=[]`，2–3 秒结束，无日志。
- workflow 在绿色 run `41997137337` 后未改；`gh api` Actions enabled，0 self-hosted runners；GitHub status operational；check-run annotation 明确为 “recent account payments have failed or your spending limit needs to be increased”。
- 结论：Actions 启动/runner 分配基础设施失败；不是代码/测试失败，但 required checks 仍红，不能标 PASS。
- 未删除 required checks、未跳过 Windows job、未加 continue-on-error、未用父 SHA 替代最终 SHA。

## 5. 外部/宿主阻塞

- 真实 Provider：既有 403 BLOCKED_QUOTA，未重复空转。
- 本地模型：BLOCKED_LOCAL_SERVICE_NOT_RUNNING。
- NSIS：本机执行 installer stub 返回 exit 2/挂起。
- 安装/启动/安装后截图：宿主 Electron 0xC0000005。
- RC-SHA product-path：CI 0-step，无法在 RC SHA 重跑。

## 6. 产物

- `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe`
- `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe.sha256`
- `evals/morrow-v2-rc/results/20261105T195500Z-rc-fad6a94.json`
- `evals/morrow-v2-rc/transcripts/20261105T195500Z-rc-fad6a94.md`
- `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/`（built-app 截图，非 installed-app）
- `docs/install/windows-installation-guide.md`

## 7. 结论

**PARTIAL**：portable RC 已产出并可下载；NSIS、安装后启动/截图、RC-SHA CI 仍 BLOCKED。未合并 PR、未发布正式 Release、未修改 main/release。
