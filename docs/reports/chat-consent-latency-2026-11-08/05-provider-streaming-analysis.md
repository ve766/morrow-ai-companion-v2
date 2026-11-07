# 05 · Provider 流式分析

- OpenAI-compatible SSE 既有测试覆盖 chunk boundary、CRLF、空响应、malformed、cancel、timeout。
- 真实 Spark 流式可完成；trace 记录 provider_delta started/completed（完成 interval，不是 TTFT）。
- HTTP headers/first byte/first effective delta 未单独测量；renderer 首 delta 未测。
- 状态 PARTIAL。
