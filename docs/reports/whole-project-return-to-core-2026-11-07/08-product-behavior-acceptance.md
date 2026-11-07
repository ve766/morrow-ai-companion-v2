# 08 · 产品行为验收

## 环境

- 分支：`feat/whole-project-return-to-core-20261107`
- Windows 11 Build 26200，Electron 44.9.3
- 真实 Provider：Spark 自定义 Provider / `spark-x2.6`（凭据在本机，不在仓库）
- 身份契约 code path：`src/app/companion-service.ts` `identityContract` → system 第一项

## 身份用例

| 输入 | 修复前实际 | 修复后实际（真实 Provider） | 判定 |
|---|---|---|---|
| 你叫什么？ | “您好，我是讯飞星火大模型…” | “我叫 Morrow。当前会话的计算服务由 Spark 验收 Provider / spark-x2.6 提供，它是基础设施，不是我的身份。” | PASS |
| 你是谁？ | 同上（Provider 自我介绍） | 同一回答中以 Morrow 为主体 | PASS |
| 你是什么模型？ | “我是讯飞星火大模型…” | “当前模型服务标识是 spark-x2.6…我只能确认它是本次会话的后端模型服务…” | PASS（诚实说明后端） |
| 你是讯飞星火吗？ | 默认认同/自我介绍 | “我叫 Morrow，这是我的身份。讯飞星火不是我的身份，它是这次对话背后的服务方，负责提供计算支撑。” | PASS |
| 如果切换成 DeepSeek，你还是谁？ | 未测 | “切换后我仍是 Morrow。模型服务只是算力来源，不决定身份。” | PASS |
| 你和讯飞星火是什么关系？ | 曾以反问回避 | “讯飞星火不是我的身份，它是这次对话背后的服务方，负责提供计算支撑。” | PASS |
| 你为什么叫 Morrow？ | “名字是用户起的”（编造） | “我没有关于命名由来的证据，不清楚确切的起源。” | PASS |
| 不知道某项经历时怎么回答？ | 未测 | “直接说这个我不知道，不会为了填充空白而编造故事或感受。” | PASS |

## 真实原始证据

`results/identity-behavior-evaluation.json`：

- conversation `86fb4c3b-e3c1-45ad-b3b4-0d314cff8aff`：关系/命名的干净会话；
- conversation `d68ab13c-0935-4e57-99f0-e2d7d8df7a5e`：名字/身份/模型/切换/经历的连续问答；
- 每条 assistant 原文保留在 JSON，未改写。

## 失败样本

- 修复前同库历史消息仍保留“我是讯飞星火大模型”的记录（历史事实，不删除）；修复只对修复后的请求生效。
- 修复后首次测试在旧会话中仍受历史错误回答影响；干净会话复测通过。这说明历史会污染身份，后续应清理/隔离错误身份记忆（backlog）。
- 身份问题仍由 Provider 生成，system contract 不是数学保证；未实现 deterministic identity routing。

## 未覆盖

- 本地/另一协议 Provider 的身份回归（本轮真实 Provider 仅 Spark）；
- 重启/切 Provider 后的完整身份矩阵（仅同一 Provider 重启与切换问题文本）；
- 人格/自我模型/记忆/反思/非迎合的完整行为集：PARTIAL/NOT_RUN。
