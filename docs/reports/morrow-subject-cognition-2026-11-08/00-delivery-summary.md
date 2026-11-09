# 00 · 主体认知交付摘要

- Issue：https://github.com/ve766/morrow-ai-companion-v2/issues/69
- 分支：`fix/chat-consent-latency-20261108`
- 基线：PR #68 HEAD `efdbf52a25e896ee159d296944f019f9b94ab687`
- 安装 asar：`2fb59d5aef57fa0f696e95036024c83f147e45db8cbcfb723e39e0090397333b`
- 状态：**PARTIAL**

## 已完成

- 保留 PR #68 identity guard/identity contract。
- 升级内部认知：prediction-error/纠错触发；query 相关性过滤；反证可 weaken；不确定度不再增加 belief score；证据按 conversation 独立聚类，重复 refs 去重。
- 真实闭环：thought candidate → 第二独立会话 active revision 2 → 下一轮真实 payload 读取。
- 真实 consent 30 天复用（normal/personal），sensitive 永不长期复用；撤销/过期单测。
- prepare 双重执行已消除：批准后复用 immutable snapshot，状态变化 CONFLICT；新增 timings。

## 未完成

- 统一 Experience 协议、Morrow-owned interest/personality 全链路、reflection finding 自动写回、反证 live、自主表达、九项盲测：PARTIAL/NOT_RUN/NOT_IMPLEMENTED。
- 语义检索/历史 timestamp-trust：BLOCKED/NOT_RESTORED。
- latency 分段/TTFT/renderer/1000 记忆 benchmark：PARTIAL/NOT_RUN。
- UI 未修改。
