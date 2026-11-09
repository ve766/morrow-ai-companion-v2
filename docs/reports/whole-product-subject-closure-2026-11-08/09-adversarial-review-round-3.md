# 第三轮对抗性审查

## 已确认并修复

1. **P0-A Reflection 用 runId 冒充独立**
   - 修复：`reflection-state-gate.ts` 从 `reflection_findings.evidence_json` 取 root source；evidence ref 保存 `rootSourceId/correlationGroupId/owner/derivationKind/parentEvidenceIds`；独立数按 distinct correlationGroupId，不按 runId。
   - 测试：同一 root + 100 个 finding → independent=1、candidate；跨独立 root 才 active。
   - 仍缺：递归祖先环/缺失/retracted root 的完整拒绝与重算（当前只按 cluster；缺失 root 用 findingId 回退）→ PARTIAL。

2. **P0-B Shared → Morrow 污染**
   - 修复：`synthesizeFromContext` 只接受 `origin=morrow`；User/Shared 不生成 actor=morrow thought。测试覆盖。
   - 仍缺：reflection gate 对 finding owner 的显式映射（当前默认 morrow；没有从 event actor 反查）→ PARTIAL。

3. **P0-D Mood pause 吞掉暂停前衰减**
   - 修复：`setPaused` 在暂停前先 `advanceMood(current, now)`，再冻结；重复 pause 保持冻结；resume 不补算暂停区间。
   - 测试：12:00→12:10 衰减后再 pause；暂停 2 天值不变；resume 后 10 分钟继续衰减；重复 pause/resume；时钟回拨不爆炸。
   - 仍缺：数据库写失败/事务 rollback 的故障注入测试 → PARTIAL。

4. **P0-E Mood 生产决策**
   - 已接：prompt/affect 描述、attention bias（emotion+mood）、expression policy、synthesis priority、review limit（低 arousal 降为 1）。
   - 仍缺：不同 Mood 的真实模型 A/B 行为对照；目前是对象/调用链级证据 → PARTIAL。

5. **P1 SHA 错位**
   - 本轮最终统一：代码/测试 commit、sourceCommit、testedCommit、最终 docs HEAD 在 Issue 评论与 PR 中分别给出；报告 `11` 增加 source/tested 字段，文档 commit 不冒充代码 commit。

## 未修复（已确认）

- P0-C 完整 exploration 状态机未实现；现有 thought/review 是候选问题闭环，不是 investigation ledger。
- P0-F 真实 ChatService → reflection producer → router → gate → next context 的 live 集成仍缺；gate/router 有 DB/单测，报告 PARTIAL。
- 真实 cloud Provider A–K、记忆 100/500/1000/5000 benchmark NOT_RUN。
- 自定义 NSIS 安装器 PE/Nullsoft 有效，但隔离静默安装 exit 2，BUILT_NOT_INSTALL_VERIFIED。
- 原生 consent OS 对话框点击、Electron 取消/重试点击 PENDING_HUMAN/PARTIAL。

## 反例

- 同一 message 经 100 个 finding/run 仍只有 1 个 root（测试）。
- User/Shared interest 不生成 Morrow thought（测试）。
- pause 前 10 分钟会衰减（测试断言 `< before`，替换旧的“相等”错误断言）。
- 低 arousal 时 review limit 从 3 降到 1；这是有界调度变化，不是事实/权限变化。
