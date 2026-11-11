# Morrow V2 2.0.0 Release Candidate — Release Notes

## 产品

Morrow 是长期 AI 伴侣（非 Agent）。本版本把 Stage 3–5 的对话、记忆、人格/自我模型、
反思/探索、关系连续性与可靠性整合为单一 release candidate。

## 主要能力

- 真实多轮对话（Spark/OpenAI-compatible；本地 loopback provider）。
- 记忆：显式保存、纠正、撤回、删除；来源账本与事务内复读验证。
- 人格：用户编辑的基线 + 有界、可回滚的自身成长（G1）；用户沟通适配（G2）单独存储。
- 关系连续性：称呼/话题/约定/节奏；目标化撤回、澄清、删除 tombstone。
- 内在状态：有界 valence/activation/tension，只影响表达策略；distress 语境作用域。
- 反思/探索：注册路由、pending 决策、预算/冷却/相关性；直接请求时让路。
- 可靠性：durable outbox、lease generation fencing、多进程 claim、删除/恢复边界。

## 安装

```text
release/Morrow-Setup-2.0.0-x64.exe
SHA-256: b753df7c31e79f04e024b50c4a0758922f4b8223d3210ec09f94d3830f0a8998
```

安装方式：Windows x64，NSIS（per-user）。首次启动后在设置中配置 Provider；
真实模型验收使用 spark-x2.6（凭据不入库、不入日志）。真机干净安装/升级仍待人工执行。

## 数据与升级

- schema v47；迁移逐版本事务化，升级前自动快照。
- 备份恢复重放 deletion journal；删除的关系/记忆不会因旧备份复活。
- 卸载默认保留用户数据（与 README 一致）。

## 已知限制

见 `docs/testing/known-limitations.md`：真人自然度 PENDING_HUMAN、第二 Provider NOT_RUN、
真机安装 PENDING_HUMAN、本机 Electron smoke 环境 BLOCKED（CI 已通过）、P2 backlog。

## 真实性说明

- 脚本化 12/12、payload 断言与 CI build 不等于真人产品验收。
- 所有结果绑定代码/CI SHA；未把 PENDING/NOT_RUN/BLOCKED 写成 PASS。
