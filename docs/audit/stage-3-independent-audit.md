# Stage 3 独立自审

自审对象：本分支相对基线 `84670792fa08352835d4cca88da6355435ee0cd6` 的全部改动。
原则：**没有证据的能力不写 PASS**。

## 1. 我实际新增了什么

| 项 | 是否改变用户可见行为 | 证据 |
|---|---|---|
| G1 人格有界漂移 | 是（system prompt 多一行、人格数值可被 ±8 点漂移影响） | L4；消融 `no_growth` 使 L4 失败 |
| X1 受约束自主话题 | 是（符合条件的回合多一行许可） | L5；消融 `no_exploration` 使 L5 失败 |
| 迁移 29 | 是（新增 4 张表 + 2 个触发器） | 全量测试含 `migrations.test.ts` 通过 |
| 评测运行器 | 否（只读代码路径 + 临时库） | 三次运行退出码 0 |

## 2. 隐私与数据安全

| 检查 | 结论 |
|---|---|
| 新增表是否存原文 | **否**。成长证据只存 `signal/weight/turn_id`；探索记录只存 `interest_id/kind/reason` |
| 是否可能把用户原文写进日志 | 否。新增代码不打印任何用户内容，`reason` 是固定枚举字符串 |
| 删除消息是否清除派生数据 | **是**。两个 `AFTER DELETE ON messages` 触发器分别清除成长证据与探索记录（L12 验证） |
| 是否新增出网路径 | **否**。没有新增网络调用 |
| 敏感记忆是否可能通过新路径泄漏 | 否。成长证据不携带记忆内容，只携带回合 id |

## 3. 迁移与恢复

| 检查 | 结论 |
|---|---|
| 迁移是否只增不改 | 是。v29 为纯追加，未改动 v1–v28 |
| 旧库能否升级 | `migrations.test.ts` 覆盖 v1→current 全链，通过 |
| 是否有降级风险 | 新表不参与任何既有读路径；旧版本打开新库不受影响（多出的表被忽略） |
| 崩溃恢复 | 成长写入在 `BEGIN IMMEDIATE` 内；崩溃只可能丢本轮证据，不会产生"证据在、状态没动" |

## 4. 并发与幂等

| 检查 | 结论 |
|---|---|
| 同一回合重放 | 成长证据主键 `(dimension, turn_id)` + `ON CONFLICT DO NOTHING`，幂等 |
| 预览与校验两次决策 | `recent(excludeTurnId)` 排除当前回合，两次结果一致（有专门测试） |
| 并发写 | `BEGIN IMMEDIATE` 串行化；`ChatService` 本身有会话级锁 |

## 5. 模型幻觉风险

| 风险 | 现状 |
|---|---|
| 把推断说成事实 | 长期层每行都带"未经确认/规则推导"限定；既有事实守卫 `guardAnswerFacts` 未改动 |
| 自主话题被模型当成"经历" | 许可文本明确写 "Do not claim an experience you did not have" |
| 模型把用户兴趣说成自己的 | 许可文本明确 "not as the user's interest"；L5 断言检查归属措辞 |
| **未消除** | 这些是 prompt 约束，**没有行为层判定**。模型是否遵守，本次无法证明（无真实 Provider） |

## 6. 我明确没有做到的事

1. **记忆巩固/衰减未实现**——Issue §3.2 要求"可解释的巩固与衰减/归档策略"，本次只复用了既有的 180 天过期标记。
2. **人格漂移无 UI**——用户看不到漂移，也无法在界面回滚（服务层 `rollback` 已可用）。
3. **真实 Provider 未跑**——所有评测是脚本化 Provider，只证明接线与载荷。
4. **Electron / Windows 验收 BLOCKED**——本机 smoke 环境性崩溃；安装器升级无授权机器。
5. **CI 未执行**——账号侧 `runner_id=0 / steps=0`。
6. **长对话早期约束**——无 30 轮行为观察。

## 7. 自审结论

- 本次改动**没有把任何未验证能力写成 PASS**：L10/L15 是 NOT_RUN，Provider/Electron/Windows/CI 是 BLOCKED，分母里不含它们。
- 消融只证明"这三个模块在各自单一场景里承重"，**不证明**它们在真实对话里的整体价值。
- 因此整体判定 **PARTIAL**，不建议按"阶段三完成"合并。

## 8. 复现与反驳方式

```bash
npm run eval:stage3            # 看 15 个场景的逐条断言
npm run eval:stage3:ablation   # 看三个模块各自的差异场景
npm run eval:stage3:longitudinal
npx vitest run src/personalization src/self-model
```

任何一条断言都可以被单独反驳：断言全部读自数据库、序列化 payload 或返回对象，不读日志。
