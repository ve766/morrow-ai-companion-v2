# 00 · 聊天授权与延迟交付摘要

- 分支：`fix/chat-consent-latency-20261108`
- 基线：PR #68 `efdbf52`
- asar：`2fb59d5aef57fa0f696e95036024c83f147e45db8cbcfb723e39e0090397333b`
- 状态：**PARTIAL**

## 已完成

- 30 天 normal/personal consent grant；首次弹窗、后续同 scope 0 弹窗；真实 Spark 验证。
- sensitive 永不长期复用（单测）。
- 撤销/过期（单测）；指纹不含 key/正文/payload。
- `ChatService.send` 批准后复用 prepared snapshot，消除第二次昂贵 prepare；状态变化 CONFLICT。
- 新增 `ChatResult.timings`（prepare/consent/provider/persist）。
- trace 延迟样本：cognition p50 83.5ms/p95 254ms；context p50 11ms/p95 45ms；consent p50 11.5ms/p95 41ms；provider delta p95 318ms。

## 未完成

- UI 的“仅本次/记住 30 天/取消”显式选项、授权列表/撤销控件：NOT_IMPLEMENTED（未改 UI）。
- prepare/TTFT/renderer 首 delta 完整分段：PARTIAL。
- 1000/5000 记忆 benchmark 与 5x 提速：NOT_RUN。
- sensitive live escalation：未执行（需敏感记忆）。
- self-hosted CI：BLOCKED（继承 #65）。
