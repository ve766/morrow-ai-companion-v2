# Phase 2.2.1 — 接手与基线冻结

审计时间：2026-10-27。本轮不改写任何 Phase 2.2 证据。

## 0. 基线

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 分支 | `feat/phase-2.2-memory-reliability` |
| 起点 HEAD | `d5ff30a`（Phase 2.2 交付末） |
| 工作区 | clean（`.models/`、`.workbuddy-ai/` 已加入 `.git/info/exclude`） |
| PR #4 | OPEN，MERGEABLE，base `feat/phase-2-companion-core`（PR #3 未合并） |
| 起点 CI | run `40466666680` @ `d5ff30a`，3/3 success |
| 起点测试 | 51 文件 / 467 用例 |
| schema | v16（`interest-sensitivity`） |
| 真实模型 | 本地 `qwen2.5:0.5b` @ `127.0.0.1:11434/v1`，Ollama 0.32.5，无付费调用 |

## 1. 已有可复用实现

- **人格版本**：`personality_profiles` + `personality_revisions`；`PersonalityService.history()` 与 `restore(version)` 已存在。Phase 2.3 不需要新建版本系统。
- **记忆生命周期**：`MemoryService` 的 create/correct/retract/restore/delete 与 revision 链。
- **兴趣**：`InterestService.observe` + `interests` 表（v16 已有 `sensitivity`）。
- **评测基础设施**：`context-memory-evaluation`、`retrieval-benchmark`、`run-identity`（runId/codeCommit/codeState）、`verdict`（四态）。
- **没有**反馈候选表；这是 Phase 2.3 需要新增的唯一 schema。

## 2. 起点能力状态

| 能力 | 状态 | 依据 |
|---|---|---|
| 检索（整词 + context 层） | 系统层通过 | Recall@3 0.75→0.875，误召回 3→0 |
| 撤回/删除/敏感授权 | 系统层通过 | v2 用例 + 集成测试 |
| 兴趣敏感度 | 系统层通过 | v16 + 请求体测试 |
| 长对话投递 | 系统层通过 | 26 轮，`notDelivered=0` |
| 长对话**行为** | **未充分验证** | 旧检查只看 `mustMention:花生` |
| 角色混淆 | **未验证** | 已观察到「我对花生严重过敏」 |
| 冲突披露 / 纠正遵循 | **模型层失败** | clean 运行 1 pass / 2 fail |
| 过期不确定性 | **未验证** | 无机械规则 |
| 人工复核 | **未完成** | `reviewer.kind = agent` |

## 3. 本轮发现并修复的评测器缺陷

长对话行为检查器在三次迭代中被发现并修正：

1. 只含 `mustMention` → 改成安全属性（过敏原、角色、拒绝、编造）。
2. 有食物但无过敏原被判 `uncertain` → 加入食物词表。
3. `坚果` 被当成花生 → 花生与坚果分离（医学上不同的过敏原）。
4. `我不能帮助查询您的过敏` 被误判为第一人称过敏 → 角色混淆改为「我」必须是过敏谓语的主语。
5. 「不是非常严重」未被识别 → 增加严重程度降级检查。

## 4. 预计迁移与兼容风险

- 新增 v17（`persona-feedback-candidates`），只建新表，不改旧表。
- 回滚代码后 v17 库会被 fail-closed 拒绝打开，需要恢复备份（既有行为）。
- 候选表只存 ≤500 字摘要 + 会话/消息引用，不复制完整对话。

## 5. 复现命令

```bash
npm run typecheck && npm test
npm run evaluate && npm run evaluate:cognition && npm run evaluate:companion
npm run evaluate:context && npm run evaluate:retrieval-context
MORROW_LONG_BEHAVIOR_RUNS=5 npm run verify:long:behavior
```
