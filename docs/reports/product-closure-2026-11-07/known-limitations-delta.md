# Known Limitations 增量（Issue #61）

- 源文件：`docs/testing/known-limitations.md`
- 本轮已在该文件顶部新增“产品收口更新（2026-11-07）”，以下为逐条结论，不删除历史条目。

| 能力 | 旧状态 | 本轮结论 | 证据 |
|---|---|---|---|
| 兴趣/自我模型专属面板 | 未实现 | **已实现（superseded）** | `src/renderer/src/self-model-ui.ts`；记忆视图 `#self-model-list` / `#interest-list`；IPC 列表真实存在；控件契约覆盖 |
| 运行轨迹 | 无 | **已实现** | `turn_trace_events` v50–v52；inspector；`turn-trace.integration.test.ts` |
| 多源 Provider | 主要 DeepSeek | **已实现 + 真实连接验证** | 多源配置 UI；Spark 真实 `connected` 10,612ms；README 已更新 |
| 反思产物呈现 | 无 | **部分完成** | 自我模型可查看/纠正；反思 findings 的逐条接受/拒绝仍无专属控件 |
| Windows 真机窗口可见 | BLOCKED | **BLOCKED_HUMAN_DESKTOP** | 宿主自动最小化；状态机/恢复代码已交付，人工 10 分钟硬门未完成 |
| Electron 本机 smoke | BLOCKED | **可用但非默认路径** | `MORROW_SMOKE_EXECUTABLE` + `MORROW_SMOKE_DISABLE_SANDBOX=1` + `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1` 下 PASS；默认沙箱路径仍受宿主 0xC0000005 影响 |
| 第二真实 Provider 切换 | NOT_RUN | **NOT_VERIFIED** | 代码路径完整；本机只验证了一个自定义 Provider |
| 语义嵌入检索 | P3 | 不变 | 四通道 RRF，无 embedding |
| 归档记忆重述、pending 终态、反思路由 | P2 | 不变 | 历史条目保留 |

## 新增限制（本轮）

- 产品路径 smoke 在隔离 profile 重启阶段失败 `Renderer did not expose a DevTools page`；已保留为 FAIL，不标记 PASS。
- `npm test`/evaluate 在本机默认 `%TEMP%` 会因 esbuild 写入 `Access is denied` 失败；manifest 已把 `TMP/TEMP` 指向仓库 `.tmp/esbuild-tmp`，这是环境规避，不是测试跳过。
- 默认构建仍启用 `app.enableSandbox()`；验收主机的 `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1` 只用于本机验收，不是产品默认。
