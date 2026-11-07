# 06 · 内部认知工作区

## Schema

`morrow_thoughts`（v54）：

`id, actor=morrow, trigger, question, hypothesis, evidence_json, counter_evidence_json, uncertainty, priority, status, created_at, updated_at, next_review_at, algorithm_version`

状态：`open / reviewed / candidate / promoted / dormant / closed`。

## 优先级

```text
priority = 0.30*uncertainty + 0.25*novelty + 0.20*recurrence
         + 0.15*relevance + 0.10*importance - 0.20*risk
```

- uncertainty 0/0.8（不确定回答/纠错）；
- recurrence = min(1, similarThoughts/3)；
- novelty = 1 - recurrence；
- relevance = 0.5/0.75（有 analysis）；
- importance 0.6；risk 0（本轮无外部动作）。
- 结果 clamp [0,1]；真实 thought priority 0.646–0.663。

## 触发

仅当 assistant reply 含 `不知道/不确定/没有记录/没有证据/不能确定` 或 analysis intent=correction 时创建；普通寒暄/天气/身份守卫回答不创建（identityGuarded 跳过）。

## 调度与预算

- `observeTurn` 同步 review 当前 thought（最多 1），保证下一轮可读；
- `app/index.ts` 每 5 分钟 `reviewDue(now,3)`；单进程 timer，退出清理；
- 不调用云 Provider，不执行工具/网络；DB 事务写入；失败只记 degradation/warn。

## 持久化与恢复

- 表在 SQLite；重启后 `listStates` 从 DB 读；真实 state/grant 跨重启保留。
- `next_review_at` 6 小时后；`reviewDue` 只处理到期项。

## 真实证据

`results/inner-workspace-evaluation.json`：

- thought candidate 0.663；
- 第二独立会话 promoted；
- state active score 91 revision 2；
- next-turn payload 包含 Morrow-owned unresolved thoughts。

## 边界

- 这是 bounded internal cognition/reflection workspace，不是“意识”证明。
- 没有长期自动高频推理；没有后台云调用。
- 反证路径未在生产触发；只 schema/测试预留。
