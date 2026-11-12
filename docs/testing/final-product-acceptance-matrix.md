# 最终产品验收矩阵（P01–P20 · 六阶段）

机器结果：`evals/final-product/results/<UTC>-<sha>.json`（scripted，生产装配）
真实 Provider：Stage 5 live（最终 head）、语境 probe；自然度 PENDING_HUMAN。

| ID | 场景 | 结果 | 关键断言 |
|---|---|---|---|
| P01 | 普通多轮对话 | **PASS** | 3 user/3 assistant 持久化；无重复 turn |
| P02 | Provider 超时/错误 | **PASS** | 失败轮抛出、无 assistant 消息；恢复后继续 |
| P03 | 显式记住事实 | **PASS** | memories=1、事实 active、payload `committed_and_verified` |
| P04 | 跨会话记忆 | **PASS** | 新会话注入“咪咪” |
| P05 | 纠正事实 | **PASS** | 旧值 superseded、新值 active、下一轮只注入新值 |
| P06 | 歧义纠正 | **PASS** | 未写入“豆豆”（clarify） |
| P07 | 撤回 | **PASS** | payload 不含“花生” |
| P08 | 删除 | **PASS** | 证据 0；payload 不含旧称呼 |
| P09 | 重启连续性 | **PASS** | 称呼/记忆/人格版本跨进程一致 |
| P10 | 用户情绪隔离 | PASS（既有测试） | affective-state 状态更新仅来自对 Morrow 的反馈 |
| P11 | 独立判断 | **PASS** | 脚本化“住在北京”断言被事实守卫改写；payload 携带杭州 |
| P12 | 兴趣成长 | **PASS** | 3 次独立证据跨 2 会话 → active |
| P13 | 反思闭环 | PASS（既有测试） | 反思路由/growth 投影/消费追踪测试 |
| P14 | 受控探索 | **PASS** | 合格可提出；直接请求禁止；日预算生效 |
| P15 | 第二 Provider | **NOT_RUN** | 无第二 Provider 凭据 |
| P16 | 备份恢复 | **PASS** | 删除边界不被旧备份复活 |
| P17 | 并发与 Outbox | PASS（专用套件） | 真实 OS 进程：单 owner/单次/租约接管/删除并发/lostLease |
| P18 | Windows 安装升级 | **BLOCKED**（安装包已生成） | 无人值守安装在本机挂起；真机安装/升级 PENDING_HUMAN |
| P19 | 真人自然度 | **PENDING_HUMAN** | 盲评包 v1 A–G + v2 H–J |
| P20 | 总体回归 | PASS（见索引） | typecheck / 全量 / build / evals / CI 于最终 head |

汇总：可执行项 0 FAIL；外部项如实为 NOT_RUN / PENDING_HUMAN / BLOCKED。

## 六阶段状态

| 阶段 | 状态 |
|---|---|
| 1 真实对话核心 | PASS |
| 2 记忆与认知基础 | PASS |
| 3 人格、偏好与自我模型 | PASS |
| 4 反思、探索与受控更新 | PARTIAL（P2 级路由/决策追踪缺口入 backlog） |
| 5 长期体验与可靠性 | PARTIAL（PENDING_HUMAN / NOT_RUN / 真机安装） |
| 6 Agent 操作能力 | NOT_STARTED（按路线保留） |
