# Stage 2 复审（hardening 之后）

复审时间：2026-10-29 16:35 (+08:00)
复审对象：PR #15 head `feat/stage-2-delivery-hardening`，本文件写作时 HEAD `e7efb4c`
前序审计：`docs/audit/stage-2-repository-audit.md`（提交 `b6ea4a6`，部分结论已过期，见 §3）

---

## 1. 本次复审修正的过期结论

| 前序审计的说法 | 现状 | 依据 |
|---|---|---|
| "轮次上下文 schema 精确匹配 1，任何字段扩展都会让历史记录失效" | **已修复**。schema 2 + v1 读适配器；历史 payload 可读且不被回写 | `turn-context.ts` `normalizeTurnContext`、`cognitive-context-repository.ts` 读路径 |
| "ReflectionService 在 companion-service 中出现 0 次，轮次结束不触发反思" | **已修复**。轮次完成后调用 `reflection.run('post_conversation')` | `companion-service.ts` `onTurnCompleted` |
| "认知附属失败只 console.warn，不写事件" | **已修复**。降级走 `recordCognitiveDegradation`，写结构化事件 | 同上，`self_model_context` / `self_model_turn_hook` 等组件名 |
| "两条开发线分叉 105/60" | **仍然成立**。记忆线与认知线共同祖先仍是 `8b207b7` | `git merge-base` |

## 2. 本次复审新增的发现

| # | 发现 | 处置 |
|---|---|---|
| R1 | `cognitive_turn_finalizations` 无外键，迁移 19 只覆盖会话删除；删除单条消息后收尾意图成孤儿 | 已修（迁移 21 + 回归测试，见 `e7efb4c`） |
| R2 | 自我模型曾把整段用户原文写入 `statement` | 已修（结构化派生 + 迁移 20，见 `d3c2865`） |
| R3 | 旧 schema 只有 validator 级测试，没有真实读取证据 | 已修（读适配器 + 直接 INSERT 的历史 payload 夹具） |
| R4 | 上一版 v1 测试夹具由当前 builder 生成后改版本号，不能证明"历史数据可读" | 已修（改为手写历史字段集，`e7efb4c` 之后的提交） |
| R5 | CI 三个 job 在 attempt 2 上仍然 `runner_id=0`、`steps=[]`、`conclusion=failure` | **BLOCKED**：平台未分配 runner，取不到任何步骤日志 |

## 3. 仍然存在的缺口（未修复，不隐藏）

| 项 | 状态 |
|---|---|
| 多信号意图置信度 `αr+βc+γe+δh` | 未实现；当前只有单一规则强度 |
| 渐进式个性化 `p' = clip(p+η·w·e)` | 未实现；无 `personalization_state` |
| 上下文块效用 `U(c)` | 未实现 |
| 持久化轮次状态机（created→…→committed） | 未实现；只有三个终态 |
| A–L 评测 harness 与消融脚本 | 未实现 |
| 真实模型 S1–S6 | BLOCKED（无凭据） |
| Electron 桌面验收 | BLOCKED（渲染沙箱无法初始化） |

## 4. 结论

代码侧：A1/A2/A3 三个高危项已闭环并有回归测试。
交付侧：**PARTIAL / BLOCKED**。B1–B5、D、E 未完成，且真实模型与桌面两项外部阻塞未解除。

本文件不改变上述任何状态，也不把"代码修完"表述为"阶段二交付完成"。
