# Morrow V2 Windows RC 验收矩阵

- 代码 SHA：`fad6a94eef19ce5cfbdca9f4c0e1af0aca08074c`
- 版本：2.0.0 · win32-x64
- 最终状态：**PARTIAL**

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 最终 SHA 的 Ubuntu CI（typecheck/tests/evaluate/build/smoke） | **BLOCKED_CI_INFRA** | CI 0-step；本地等价命令 tsc 0、129 files/1156 tests、build/evaluate 0 |
| 2 | 最终 SHA 的 Windows CI（typecheck/tests/evaluate/build/smoke/product-path） | **BLOCKED_CI_INFRA** | 同上；父代码 `6f5fe47` run `41995422882` 4/4 PASS |
| 3 | Windows upgrade/migration CI | **BLOCKED_CI_INFRA** | 父代码 run `41995422882` upgrade PASS；RC SHA 无新 run |
| 4 | Windows package/install/installed-app smoke | **BLOCKED** | NSIS 构建在本机 exit 2/挂起；CI 0-step |
| 5 | Windows x64 安装包 | **BLOCKED_HOST_EXECUTION_POLICY** | NSIS stub 无法执行；portable RC 已产出 |
| 6 | Portable RC 文件/SHA256/大小 | **PASS** | `Morrow-2.0.0-x64-portable.exe`，100,541,544 bytes，SHA256 `cf662590…8e67` |
| 7 | 安装/首次启动/重启/已有数据启动 | **BLOCKED_HOST_ELECTRON_CRASH** | 本机 Electron 0xC0000005；未伪装 PASS |
| 8 | 安装后截图（1440/1280/390） | **BLOCKED** | 无 installed-app 截图；built-app 9 张已标注 |
| 9 | Windows upgrade/migration 到 v49 | **PASS（测试）** | 迁移测试 6 组；真实安装升级 BLOCKED |
| 10 | Provider consent/自定义/本地文案 | **PASS** | `consent-presentation.test.ts` 6 组 |
| 11 | 非流式/流式 body 边界 | **PASS** | `bounded-body.test.ts` 10 组 + adapter 非流式超限测试 |
| 12 | 全字段连续性（含 goal task/progress） | **PASS（代码/本地测试）** | product-path 代码 + 本地测试；RC-SHA Electron 运行 BLOCKED |
| 13 | 真实 Provider 非流式/SSE | **BLOCKED_QUOTA** | 既有 403 runs，未重复空转 |
| 14 | 本地 OpenAI-compatible | **BLOCKED_LOCAL_SERVICE_NOT_RUNNING** | 无兼容服务，未用 mock |
| 15 | 全量测试/构建/评估 | **PASS** | 129 files/1156 tests，0 skipped；tsc/build/evaluate 0 |
| 16 | 独立复审 | **PENDING → 见 rc-independent-review** | 冻结 RC SHA 后由不同 Agent 复审 |

## 结论

**PARTIAL**：代码/测试/构建/评估和 portable RC 产物通过；NSIS、安装/启动/安装后截图、RC-SHA CI 仍被本机执行策略、Electron 宿主崩溃和 GitHub Actions 基础设施阻断。真实 Provider/本地模型仍外部阻塞。
