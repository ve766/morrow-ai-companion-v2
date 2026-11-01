# Stage 4-A 交付报告

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/stage-4a-companion-continuity`（从 `548d40e` 创建）
- 起始 SHA：`548d40e4846556a86b208e29876971f46824e211`
- 最终 SHA：见本分支最新提交（文档提交后以 PR 页面为准）
- PR：以 Stage 3 分支 `feat/stage-3-long-term-companion` 为 base，标注不自动合并
- PR #19：保持 OPEN、未合并、base 未动

## 1. 断点与修复

详见 [基线与断点分析](stage-4a-baseline-and-gap-analysis.md)。核心一句话：**故事在第 2 步断裂——「帮我记住」只记了个人化信号，从未创建记忆**；纠正也没有 supersede 入口。

修复（最小必要）：

| 文件 | 改动 |
|---|---|
| `src/cognition/cognitive-turn-analyzer.ts` | `explicitMemorySaveRequest` 识别「帮我记住 / 帮我记一下 / 帮我更新」 |
| `src/memory/fact-slot.ts` | 复合 pet 句抽取（「我有一只猫，它叫咪咪」）；`FactCandidate` 携带 clause |
| `src/memory/memory-service.ts` | `createExplicitFromTurn`：显式请求 → 事实抽取 → 冲突即授权纠正 / 否则创建；代词纠正仅在唯一 active pet 事实时解析；显示模板带物种（猫/狗）并在纠正时继承物种；`lookupActive` 的 past 语义修正（历史可读 superseded） |
| `src/app/companion-service.ts` | memory 投影器接显式创建（save/update/correction 信号）；固定原则新增「应用自身持久化已批准记忆」 |
| `src/memory/fact-index-faults.test.ts` | `override` 修饰符（修复基线 CI 失败） |
| `evals/stage-3/shared/real-provider.ts` | `ProviderStack` 暴露 `factMemory` |
| `evals/stage-4a/*` | fixture、scripted runner、live runner、复核材料 |
| `src/app/stage4a-continuity.integration.test.ts` | 12 项验收测试 |

未扩张：不重写检索/人格算法/UI，不引入调度器，不做 Agent/语音。

## 2. 命令与结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run --no-file-parallelism` | 0 | **101 文件 / 936 测试全部通过**（含新增 12 项验收） |
| `npx electron-vite build` | 0 | 构建成功 |
| `npm run eval:stage4a`（scripted） | 0 | fact-state PASS、provenance PASS |
| `npm run eval:stage4a:live`（真实 spark-x2.6） | 0 | `AWAITING_MANUAL_REVIEW`，见 §3 |

## 3. 真实模型（spark-x2.6 @ 契约 endpoint）

- 结果：`evals/stage-4a/results/20261101T132529Z-23c4d44-stage-4a.json`（代码 SHA `23c4d44`）
- 转写 + 人工判定栏：`evals/stage-4a/review/transcript.md`
- 关键轮次：A「已记住…咪咪」→ B「你的猫叫咪咪」→ C 纠正（系统落库：咪咪 superseded / 豆豆 active）→ D「你的猫叫豆豆」
- 客观信号：R1 stored=true、R2 ack=true、R3 stored=true & oldAsCurrent=false
- **人工体验评分：PENDING**（用户须亲自判断；AI 不代签）
- 凭据：仅本机环境变量 `MORROW_TEST_API_KEY`；未写入代码/日志/结果文件

## 4. 边界与阻塞

| 项 | 状态 | 说明 |
|---|---|---|
| 应用级重启冒烟（Electron 渲染层） | **BLOCKED** | 本机渲染进程崩溃 0x80000003（历史已知环境问题）；装配级重启（#4）已通过 |
| 第二 Provider 真实行为 | **BLOCKED** | 本机无第二真实模型凭据；应用侧身份/记忆持久化已通过（#7） |
| CI | 以 push 后 Actions 为准 | 基线 run 41303086095 的 typecheck 失败（TS4114）已修复 |
| 人工体验评分 | **PENDING** | 见 §3 |

## 5. 已知风险

- 显式创建依赖规则的保守抽取；未知句式不建事实（原文仍可词面检索）
- 代词纠正只在唯一 active pet 事实时工作；多只宠物时不会猜测
- 纠正轮的回复在证据注入之前生成（prepare 先于投影），模型可能说「本轮没找到记录」——这是真实顺序，未伪造
- 记忆文本被模板化为「我的猫叫豆豆。」，原始措辞保存在消息与修订链中

## 6. 结论

**PARTIAL**：纵向闭环在真实应用装配与真实模型上成立（记住 → 跨会话复述 → 纠正 → 新会话读新值），12 项验收全部通过；人工体验评分 PENDING、Electron 应用级冒烟与第二 Provider 真实行为 BLOCKED。不宣称「完成 Morrow」或任何意识主张；不自动启动 Stage 4-B。
