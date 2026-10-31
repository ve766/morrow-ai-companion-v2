# Stage 3 验收矩阵（能力 × 三层）

> 基准：`43c92813763d9ca3b524d112c231af7f75843a5e`
> 三层：**E** 工程真实性（装配/事务/重启/删除/并发/备份）、**C** 认知有效性（检索指标/来源准确性/分离/反思质量/调节效果）、**R** 真实互动质量（真实 Provider 的自然度与连续性）。
> 状态：PASS / FAIL / BLOCKED / NOT_RUN / SKIPPED。BLOCKED、NOT_RUN、SKIPPED **不计入分子**。

---

## 1. 能力成熟度（M0–M6）

| 能力 | 本轮前 | 本轮后 | 升级依据（必须是一条断言） |
|---|---|---|---|
| 语境/意图理解 | M4（默认关） | M4（默认关） | 未变：`companion-service.test.ts` 开关两态 |
| 记忆形成 | M4 | M4 | 未变 |
| 纠正/修订 | M4 | M4 | 未变 |
| 记忆巩固 | M3 | **M3** | 仍无生产读者；本轮未动 |
| 记忆冲突 | M4 | M4 | 未变 |
| 记忆重要度 | M3 | **M4** | `memory-importance-ranking.test.ts`：只翻转分数即翻转顺序 |
| 记忆衰减/归档 | M3 | **M3+** | 类型化半衰期 + 恢复可测；仍无 UI |
| 撤回/删除传播 | M4（有误删） | **M4** | `migrations.test.ts` 删除边界 + `interest-evidence.test.ts` 降级 |
| 人格稳定（身份） | M4 | **M4** | L4「身份基线字段未被交互画像改动」 |
| 人格成长（身份演化） | M3（语义错） | **M1** | 语义纠正后无生产者；不再声称已实现 |
| 交互适配（表达） | —（混在成长里） | **M4** | L4 正负证据 + `interaction-profile.test.ts` |
| Morrow 自身兴趣 | M1 | **M3** | L5：真实链路产出 `shared` 兴趣，证据含 `reflection` |
| 兴趣三分 | M2 | **M4** | L5 六条断言（含「用户话题不得被许可」） |
| 受约束自主探索 | M2 | **M4** | L5「自身话题在合适回合获得许可」；`no_exploration→L5` |
| 反思 | M3 | **M3+** | 新增 `morrow_interest_candidate` 与证据；仍无质量指标 |
| 自我模型 | M3 | M3 | 未变（无确认语义、无 UI） |
| 内在状态 | M4（默认关） | M4（默认关） | 未变 |
| 长期目标 | M2 | **M3** | L10：真实对话创建并进入 payload；确认 UI 缺失 |
| 独立判断 | M2 | M2 | 未变 |
| 多轮连续 | M4 | M4 | 未变 |
| 语音 | M0 | **M0** | 未做 |
| 真实云 Provider | M5*（n=1） | **M5*** | 未新增真实调用（无凭据） |
| 真实本机 Provider | M4 | M4 | 未变 |
| 长期稳定（真实时间） | M0 | **M0** | 仍无真实时间跨度 |
| 隐私与安全 | M4 | **M4** | outbox 不存原文（单测断言） |
| 安装/升级/恢复 | M1/M4/M4 | 同 | 未变 |

---

## 2. 三层验收

| 能力 | E 工程 | C 认知 | R 真实互动 | 证据 |
|---|---|---|---|---|
| 意图理解 | PASS | PASS（规则级） | **BLOCKED** | 单测 + payload 断言 |
| 记忆形成/纠正 | PASS | PASS | **BLOCKED** | L1/L2/L13 |
| 重要度 → 排序 | PASS | **PASS** | **BLOCKED** | 对照测试（翻转分数） |
| 衰减/归档 | PASS | PASS | **BLOCKED** | 类型化半衰期单测 |
| 删除/撤回传播 | **PASS** | PASS | **BLOCKED** | 迁移测试 + L12 |
| 身份稳定 | PASS | PASS | **BLOCKED** | L4 |
| 交互适配 | PASS | PASS | **BLOCKED** | L4 + 单测 |
| Morrow 自身兴趣 | **PASS** | **PASS（窄）** | **BLOCKED** | L5（变异测试证明会红） |
| 兴趣三分 | PASS | PASS | **BLOCKED** | L5 |
| 自主探索 | PASS | PASS | **BLOCKED** | L5 + 消融 |
| 反思 | PASS | **PARTIAL** | **BLOCKED** | 无质量指标 |
| 长期目标 | PASS | **PARTIAL** | **BLOCKED** | L10；确认 UI 缺失 |
| 内在状态 | PASS | PARTIAL | **BLOCKED** | 未重构 appraisal |
| 崩溃恢复（认知义务） | **PASS** | — | — | outbox 单测 |
| 语音 | **NOT_RUN** | — | — | 无实现 |
| 真实 Provider | **BLOCKED** | — | — | 无凭据 |
| Windows 安装升级 | **BLOCKED** | — | — | 无干净机器 |

---

## 3. 假阳性关闭清单

| 原断言 | 关闭方式 | 复核 |
|---|---|---|
| `memoryBlockEmpty` 标记缺失即 true | 缺失 → false | L3/L13 |
| L11 0==0 | 先断言非零 | L11 三条 |
| L5 直调 `observeMorrow` | 走生产链 | L5 + 变异 |
| L10 直调 `goals.create` | 真实对话 | L10 |
| L5 只查 `permitted` 存在 | 按 interestId 判定 | L5 |
| L6 只查原则存在 | 仍保留客观检查；模型层 BLOCKED | 见风险登记 |
| 消融无差异 | 三臂各自命中 | `no_growth→L4`、`no_exploration→L5`、`no_reflection→L5,L9` |

---

## 4. 本轮实测门槛

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | **87 文件 / 774 用例** |
| `npx electron-vite build` | 待跑 | — |
| `npm run eval:stage3` | 0 | **15 PASS / 0 FAIL / 1 NOT_RUN**（分母 16） |
| `eval:stage3:ablation` | 0 | 3 臂各命中 |
| `eval:stage3:longitudinal` | 0 | PASS，`clock: injected` |
| `eval:stage3:restart` | 0 | PASS |
| `eval:stage3:long-conversation` | 0 | PASS |

---

## 5. 不计入通过率的项

真实云 Provider（无凭据）、真实本机模型（未部署）、Electron renderer（本机沙箱崩溃 `0x80000003`）、Windows 安装升级（无干净机器）、CI（job `steps=0`）、真实时间跨度（无法在单轮产生）、语音（未实现）。
