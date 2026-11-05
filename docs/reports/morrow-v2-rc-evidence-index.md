# Morrow V2 Windows RC 证据索引

- 代码 SHA：`fad6a94eef19ce5cfbdca9f4c0e1af0aca08074c`
- 上一冻结 SHA：`ff5b7876fcfd01a1e53c18c91b35aec47752ca31`
- PR #54：https://github.com/ve766/morrow-ai-companion-v2/pull/54
- 最终状态：**PARTIAL**

## 1. 构建产物

| 项目 | 值 |
| --- | --- |
| 文件 | `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` |
| 类型 | Windows portable RC（NSIS installer BLOCKED） |
| 版本 | 2.0.0 |
| 大小 | 100,541,544 bytes |
| SHA256 | `fd584ffd53f74ffb3d7c93804a8d92a308a84c7ffb2d04b9da7532f73e8ab1da` |
| 构建时间 | 2026-11-05T19:05:00Z |
| 构建环境 | Windows 10.0.26200 x64 · Electron 44.9.3 · electron-builder 26.15.3 |
| 构建命令 | `npx electron-builder --win portable --x64 --publish never --config.electronDist=node_modules/electron/dist --config.directories.output=.tmp/rc-portable --config.win.signAndEditExecutable=false` |

NSIS 构建：electron-builder 生成 stub 后执行 installer 提取 uninstaller，本机返回 exit 2 / 挂起；未产出完整 NSIS 文件。这是宿主执行策略问题，不是代码编译失败。

## 2. 测试与评估

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| `tsc --noEmit` | PASS 0 | 本机命令 |
| `vitest run` | PASS 129 files / 1156 tests / 0 skipped | 本机命令 |
| `npm run build` | PASS 0 | 本机命令 |
| `npm run evaluate` | PASS 0 | `evaluation/reports/m3-synthetic-retrieval-report.json` 等 |
| `npm run evaluate:cognition` | PASS 0 | `evaluation/reports/cognitive-*` 等 |
| RC 机器结果 | `evals/morrow-v2-rc/results/20261105T195500Z-rc-fad6a94.json` | 本文件 |
| RC transcript | `evals/morrow-v2-rc/transcripts/20261105T195500Z-rc-fad6a94.md` | 本文件 |

## 3. CI

| Run | Head | 结果 | 说明 |
| --- | --- | --- | --- |
| `41995422882` | `6f5fe47`（父代码） | 4/4 PASS | 最后绿色；含 Windows product-path、package/install、upgrade |
| `41997137337` | `9215cc4`（docs） | 4/4 PASS | 历史 docs HEAD |
| `42005665855` | `df8f802` | 4/4 FAIL 0-step | Actions 基础设施失败 |
| `42007647526` | `ff5b787` | 4/4 FAIL 0-step | Actions 基础设施失败 |
| `42004491868` | `eac8fbd` | 4/4 FAIL 0-step | Actions 基础设施失败 |
| `42001850336` | `13ce2a6` | 4/4 FAIL 0-step | Actions 基础设施失败 |
| RC `ac00627` | `ac00627` | 未获得可信 run | 同一 0-step 基础设施失败 |

证据：失败 job `runner_id=0`、`runner_name=""`、`steps=[]`，2–3 秒结束，无 job 日志；check-run annotation 为 “The job was not started because recent account payments have failed or your spending limit needs to be increased.”；workflow 在绿色 run 后未变；`gh api` Actions enabled、0 self-hosted runners；GitHub status operational。未删除/跳过 required check。用户需处理 GitHub 付款/额度。

## 4. 截图

`docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/`：9 张真实 **built-app** 截图（chat/memory/settings × 1440/1280/390），来源父代码 run `20261105T084141Z-45483dd6`。它们不是安装后截图；安装/启动在本机被 Electron 0xC0000005 阻断，不能冒充 installed-app 证据。

## 5. 真实 Provider / 本地服务

| 项 | 状态 | 证据 |
| --- | --- | --- |
| `api.supxh.xin` | BLOCKED_QUOTA | `evals/provider-multi-source/results/20261104T135205Z-75b01260.json`（HTTP 403） |
| `speed26.toter.me` | BLOCKED_QUOTA | `evals/provider-multi-source/results/20261104T135210Z-abf69f16.json`（HTTP 403） |
| 本地 OpenAI-compatible | BLOCKED_LOCAL_SERVICE_NOT_RUNNING | 无兼容 `/v1/models`；未用 mock |

## 6. 结论

RC portable 产物、哈希、本地全量测试/构建/评估可用；NSIS、安装后启动/截图、RC-SHA CI 仍 BLOCKED。整体 PARTIAL，不建议在阻塞解决前开始正式发布决策。
