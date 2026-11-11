# Stage 4-A 验收报告

运行环境：Windows / Node v22.23.2。起始 SHA `548d40e`，分支 `feat/stage-4a-companion-continuity`。

## 1. 逐项验收（任务 §5 的十二项）

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 真实消息写入后创建记忆，来源 message ID 与数据库消息一致 | **PASS** | `stage4a-continuity.integration.test.ts` #1：`memory_revisions.source_message_id` 与 `fact_records.source_message_id` 均等于本轮 `result.userMessage.id` |
| 2 | 跨会话读取 active 猫名 | **PASS** | #2（scripted，证据块含咪咪）+ 真实运行会话 B「你的猫叫咪咪。」 |
| 3 | 纠正后旧值 superseded、新值 active，原子性成立 | **PASS** | #3（同一事务内 revision 递增、旧行 `valid_to` 关闭）+ 真实运行 factState `豆豆:active / 咪咪:superseded` |
| 4 | 重启后新值仍是当前值 | **PASS** | #4（整运行时重建 + `reindexAll` 后 current=豆豆） |
| 5 | 历史查询与当前查询结果不同且正确 | **PASS** | #5：current=[豆豆]，history=[豆豆, 咪咪] |
| 6 | 记忆删除/撤回后旧值不再注入 | **PASS** | #6 |
| 7 | 人格基线在会话重启与 Provider 切换前后完全一致 | **PASS** | #7：保存第二个 provider 配置并设为激活后，三维数值与版本号不变；重启后仍一致 |
| 8 | 同一单值谓词并发/重复纠正不产生两个静默 current 值 | **PASS** | #8：连续两次纠正后 active 行数 = 1（团团） |
| 9 | 索引故障/检索降级不伪装零命中 | **PASS** | #9：注入 `lookupActive` 抛错后降级扫描仍投递「咪咪」 |
| 10 | prompt budget 截断时 manifest 明确记录遗漏 | **PASS** | #10：`turn.evaluated` 载荷含 `omittedCount` |
| 11 | 真实 Provider 覆盖「记住咪咪 → 纠正豆豆 → 新会话复述豆豆」 | **PASS（客观信号）/ 人工 PENDING** | `evals/stage-4a/results/20261101T132529Z-23c4d44-stage-4a.json`：R1 stored=true，R2 提及豆豆，R3 stored=true 且未把旧值当当前 |
| 12 | 至少一次正式应用路径的重启/新会话 smoke | **PASS（装配级）/ 应用级 BLOCKED** | #4 在真实装配（buildStack：完整迁移+服务+outbox）上关闭并重建运行时；**Electron 应用级重启与渲染层冒烟 BLOCKED**（本机渲染进程崩溃 0x80000003，CI 为准） |

## 2. 真实模型运行（spark-x2.6，契约 endpoint）

结果文件：`evals/stage-4a/results/20261101T132529Z-23c4d44-stage-4a.json`（绑定代码 SHA `23c4d44`）。
转写与人工判定栏：`evals/stage-4a/review/transcript.md`。

| 会话 | 用户 | Morrow | 证据投递 |
|---|---|---|---|
| A | 我有一只猫，它叫咪咪。帮我记住。 | 已记住：你有一只猫，名字叫咪咪。 | （创建于本轮之后，证据为空属预期） |
| B | 你还记得我的猫叫什么吗？ | 你的猫叫咪咪。 | 我的猫叫咪咪。 |
| C | 我说错了，它现在叫豆豆。帮我更新。 | 说明本轮检索未找到「它」的条目、不会假装已更新；提及豆豆 | （纠正写入发生在回复之后，证据为空属预期） |
| D | 我的猫叫什么？ | 你的猫叫豆豆。 | 我的猫叫豆豆。 |

- 自动客观信号：R1 stored=true；R2 ack（提及豆豆）=true；R3 stored=true、oldValueAsCurrent=false。**这些只证明系统投递与值级出现，不证明理解。**
- **人工体验评分：PENDING**（用户逐条判断「记得、理解纠正、保持身份」；AI 不代签）。
- 早前一轮的真实运行暴露并已修复两个问题：证据用「宠物」而非「猫」（物种丢失）与模型自称「没有写入工具」（与系统已保存矛盾）。修复后重跑即为上表。

## 3. Provider 切换

- 应用侧：`personality_profiles`（身份）与 provider 配置分表；切到第二个 loopback provider 后基线三维值与版本不变，重启后仍不变（#7）。
- 第二 Provider **真实行为：BLOCKED**——本机未配置第二个真实模型凭据。应用侧持久化验证与真实行为验证分开报告，不混为一谈。

## 4. CI

- 基线 CI（`548d40e`，run 41303086095）**failure**：`fact-index-faults.test.ts` TS4114 override 缺失；已在 4-A 首提交修复（`5fef66a`）。
- 新分支首次 push 后 Actions 状态以仓库 Actions 页为准；本阶段未合并任何 PR。

## 5. 结论

**PARTIAL（代码与本地证据完成，真实模型客观信号通过，人工体验评分与 Electron 应用级冒烟分别为 PENDING / BLOCKED）。** 未宣称「完成整个 Morrow」或任何意识/主观体验主张。
