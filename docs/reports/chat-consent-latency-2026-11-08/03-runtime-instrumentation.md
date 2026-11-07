# 03 · 运行时计时

- `ChatResult.timings`：prepareMs/consentMs/providerMs/persistMs，单调时钟。
- 不记录消息正文/prompt/key；只返回数值给调用方。
- trace 仍记录阶段/状态/原因/耗时。
- 未单独记录 IPC/renderer 首 delta；未把 consent 等待混入 Provider TTFT（独立字段）。
