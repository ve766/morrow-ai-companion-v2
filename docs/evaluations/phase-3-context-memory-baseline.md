# 第三阶段：语境理解与连续记忆评测基线

**版本**：`context-memory-v1`
**数据集**：`evaluation/fixtures/context-memory-v1.json`（22 个用例，覆盖 21 项能力）
**离线入口**：`npm run evaluate:context`（确定性、无网络）
**真机入口**：`npm run verify:context:real`（需要本机 loopback Provider）
**基线日期**：2026-10-26

---

## 1. 这套评测要回答什么，以及不回答什么

产品目标是「能自然多轮交流、理解语境、连续记忆、保持人格、能改错」的伴侣。要判断这件事，必须先承认一个事实：

> **「模型收到了正确上下文」和「模型理解了上下文」是两件事。**

本项目此前的问题恰恰出在这里：把请求里有某个字符串，当成了陪伴能力。这套评测因此**分三层，且永远不合并成一个总分**。

| 层 | 问题 | 证据类型 | 能否自动化判定 |
|---|---|---|---|
| **L1 确定性工程** | 隔离、授权、撤回、顺序、错误处理是否成立 | 断言 | 能，完全确定 |
| **L2 离线语境/记忆** | 该给的上下文、出处、告诫是否**投递**到位 | 逐轮请求断言 | 能，但只证明投递 |
| **L3 真实模型行为** | 模型是否**使用**了这些上下文 | 真实回复 + 机械规则 | 部分能，其余需人工 |

**这套基线不回答的**：陪伴感、情绪价值、长期关系质量、云端模型表现。这些没有可辩护的度量方法，写进来只会制造假精度。

### 1.1 为什么 L2 不能声称「理解」

L2 的 Provider 是确定性桩：它不读 prompt，固定回 `确定性回复 N`。因此 L2 的任何绿色结果都只可能来自「请求结构正确」，不可能是「模型答对了」。

这不是妥协，是刻意的：如果 L2 用桩来模拟回答，那么「模型答对」就变成了「桩按剧本回话」，比不测更危险。

### 1.2 L3 的归因机制（本层最重要的设计）

L3 同时记录**回复**和**产生它的请求**。失败时用请求判定责任方：

- 期望出现的事实**不在**请求里 → `not_delivered`：这是系统缺陷，投递层要修。
- 期望出现的事实**在**请求里但回复没用到 → `delivered_but_not_used`：这是模型局限，不该去改投递层。

没有这个区分，「模型不行」和「系统没给」在报告里长得一模一样，最后总是改错地方。

---

## 2. 场景覆盖

21 项能力全部有对应用例，无空缺（缺一项离线门禁会直接失败：`uncovered_capabilities`）。

### A. 多轮语境理解

| 能力 | 用例 | 投递层断言 | 真机规则 |
|---|---|---|---|
| A1 代词指代消解 | `a1-pronoun-cat` | 第 2 轮请求仍含「豆豆」；历史 2 条且角色为 user,assistant | mustMention `豆豆` |
| A2 省略主语 | `a2-elliptical-trip` | 「那后天呢？」这轮仍含杭州/上海/出差 | 需人工（正确性无法子串化） |
| A3 话题切换 | `a3-switch-to-guitar` | 吉他记忆为 `topic`；豆豆记忆**不得**升为 `topic` | mustNotMention `豆豆` |
| A4 旧话题重提 | `a4-revisit-cat` | 第 3 轮豆豆重新为 `topic`，吉他退回非 topic | mustMention `豆豆` |
| A5 同句不同语境 | `a5-two-sessions` | 第 2 个会话不含第 1 个会话的人名，历史 0 条 | 应反问（问号代理） |
| A6 信息不足澄清 | `a6-insufficient` | 「证据不足时表达不确定」原则在 system 中 | 应反问（问号代理） |

### B. 连续记忆

| 能力 | 用例 | 投递层断言 | 真机规则 |
|---|---|---|---|
| B1 同会话回忆 | `b1-recall-in-session` | 第 3 轮含成都/婚礼，历史 4 条 | mustMention `成都` |
| B2 跨会话回忆 | `b2-recall-new-session` | 新会话无历史，成都记忆为 `topic` | mustMention `成都` |
| B2' 授权与撤销 | `b2b-authorised-recall` | 敏感记忆：未授权 0 条 → 授权 1 条 topic → 撤销后 0 条 | 需人工 |
| B3 纠正后当前有效 | `b3-correction` | 纠正为杭州后，上海**不得**出现 | mustMention `杭州`、mustNotMention `上海` |
| B4 撤回后不使用 | `b4-retracted` | 撤回后条目 0，唯一标记不出现 | 需人工（见 §4.2） |
| B5 过期标记 | `b5-stale` | 200 天未确认 → `stale: true` + 过期告诫 | 需人工（语气） |
| B6 出处与置信度 | `b6-provenance` | 两条记忆各自带 `sourceCategory` 投递 | 需人工 |
| B7 冲突双可见 | `b7-conflict` | 两条冲突记忆同时 `topic` + 冲突原则 | mustMention `杭州`+`上海` |
| B8 检索未命中 | `b8-miss` | 词面 0 命中 → 只能 `continuity` + 背景原则 | mustNotMention `三月十二` |
| B9 无关记忆不干扰 | `b9-bounded` | 6 条无关记忆最多 3 条，`topic` 计数 0 | mustNotMention `驾照` |
| B10 会话隔离 | `b10-isolation` | 未保存为记忆的内容不跨会话 | 需人工 |

### C. 人格连续性与纠错

| 能力 | 用例 | 投递层断言 | 真机规则 |
|---|---|---|---|
| C1 跨话题人格一致 | `c1-personality` | 两轮人格版本与 setup 后一致 | 需人工 |
| C2 单轮提示不改人格 | `c2-no-rewrite` | 版本不变（请求内 + 库内） | 需人工 |
| C3 无脑赞同 ≠ 身份 | `c3-agreement` | 版本不变，且「不得静默改人格」原则仍在 | 需人工 |
| C4 冲突时表达不确定 | `c4-uncertain` | 新记忆 + 220 天旧记忆同为 topic，旧的 `stale`，不确定性原则在位 | mustMention `杭州`+`上海` |
| C5 能看到自己的错 | `c5-own-error` | 第 2 轮请求含上一轮助手原文 | 需人工 |

---

## 3. 用例格式与判定条件

每个用例在 fixture 中包含（字段名即 schema 键）：

| 要求 | 字段 | 说明 |
|---|---|---|
| 唯一 ID | `id` | 重复即报 `DUPLICATE_CASE_ID` |
| 能力归属 | `capability` | 封闭枚举，未知值报 `UNKNOWN_CAPABILITY` |
| 场景描述 | `title` | 一行 |
| **本用例可下的结论** | `claims` | 强制字段。写清「只证明投递」还是「可用于行为判定」 |
| 多轮输入 | `turns[].content` | 顺序发送，可 `newConversation` 切会话 |
| 初始记忆/人格/授权 | `setup.memories` / `setup.personality` / `turns[].includeSensitive` | `ageDays` 控制过期 |
| 中间操作 | `turns[].op` | `correct` / `retract` / `restore` / `delete`，在该轮发送**之前**执行 |
| 预期行为（投递） | `turns[].expect` | 见下方断言清单 |
| 预期行为（行为层） | `realModel` | `substring` 或 `clarifying_question`；`null` 表示需人工 |
| 可定位的失败原因 | — | 失败信息形如 `turn 1: memory "豆豆" was promoted to match=topic`，含轮次与断言 |
| 对应代码 | — | 断言实现 `context-memory-evaluation.ts` `checkTurn`；规则实现 `context-memory-real.ts` `applyRealRule` |
| 是否需真实模型 | `realModel !== null` | 离线层只跑投递断言 |

### 3.1 投递层断言清单（`expect` 的封闭键集）

`contextContains`、`contextExcludes`、`historyLength`、`historyRoles`、`lastMessageEquals`、`memoryEntries`、`memoryEntriesAtMost`、`memoryTopicCount`、`memoryMatchFor`、`memoryNotTopicFor`、`systemContains`、`personalityVersionStable`。

**关键设计**：`contextExcludes` 会在**所有消息**上扫描，包括用户当前这句。这是刻意的——上一轮的敏感度测试就是因为用户自己说了「花生」，导致裸子串断言无法区分「记忆泄漏」与「用户原话」。所以涉及记忆的判断一律走 `memoryMatchFor` / `memoryNotTopicFor` / `memoryEntries`，解析 system 里的记忆块后逐条判定。

### 3.2 schema 是封闭的

未知字段直接报 `UNKNOWN_FIELD:<case>:turn<n>:<key>`，而不是忽略。理由：本项目此前出现过拼错的 `systemContain` 被 `...candidate` 静默吞掉，用例零断言却 `passed: true`。空 `expect` 也会报 `EMPTY_EXPECTATION`。

---

## 4. 已知局限（写在这里，不藏在附录）

### 4.1 `mustMention` / `mustNotMention` 是词面的

正确的换说法会判失败。缓解：报告保留完整原文供人工复核，且不对「通过」做质量解读。

### 4.2 `mustNotMention` 的通过可能是平凡的

真机跑里 `b8` 通过，是因为模型输出了一段天气数据，**碰巧**不含生日。这不算「它克制了」。因此 B4、B5 这类「正确行为是不要提」的能力，`realModel` 设为 `null`——人工复核，不用子串冒充。

### 4.3 `clarifying_question` 只看问号

`a5` 真机通过，回复是「我们来聊聊好吗？」——有问号，但没有澄清「她是谁」，属于**代理误通过**。`a6` 的「那您需要预定些什么呢？」才是真通过。同一规则两种结果，说明它只是弱代理。

### 4.4 覆盖的是投递，不是理解

L2 全绿**不能**推出「模型理解了」。这是本文件最重要的一句话，也是 L2 报告里 `modelUnderstanding: 'not_assessed'` 字面写死的字段。

### 4.5 单会话、单用户

不覆盖多用户、多设备、共享数据库。见 `phase-2-risk-audit.md` P0-3.2。

---

## 5. 基线结果（2026-10-26）

### 5.1 L1 确定性工程

| 项 | 值 |
|---|---|
| 命令 | `npx vitest run --no-fsModuleCache --maxWorkers=2` |
| 结果 | 47 文件 / 401 用例全绿（改动前 45 / 359） |
| 与语境直接相关 | 30 个集成用例（含本轮新增的重启撤回） |

### 5.2 L2 离线语境与记忆（投递层）

| 项 | 值 |
|---|---|
| 命令 | `npm run evaluate:context` |
| 用例 | 22 / 22 通过 |
| 断言 | 90 条实际执行（`assertionsExecuted`） |
| 能力覆盖 | 21 / 21，无空缺 |
| 确定性 | `replayStable: true`，`resultHash` 两次一致；`networkCalls: 0` |
| 证据类别 | `offline_deterministic_stub`；`measures: context_delivery`；`modelUnderstanding: not_assessed` |

**按能力分组**：21 项能力全部 `n/n`（B2 为 2/2，其余 1/1）。

**这个 22/22 的可信度来自突变实验**，不是自我声明。逐个破坏生产保证后，变红的用例与预期完全对应：

| 破坏 | 变红 |
|---|---|
| 撤回双层过滤全移除 | `b4` |
| continuity 误标 topic | `a3` `a4` `b8` `b9` |
| 敏感度上限失效 | `b2b` |
| 连续性上限 3→25 | `b9` |
| 过期判定恒 false | `b5` `c4` |
| 历史窗口 12→1 | `a1` `a2` `b1` `c5` |

### 5.3 L3 真实模型行为

| 项 | 值 |
|---|---|
| 命令 | `npm run verify:context:real` |
| Provider | `http://127.0.0.1:11434/v1`，模型 `qwen2.5:0.5b` |
| 可机械判定用例 | 12 |
| 通过 / 失败 | **6 / 6** |
| 需人工复核（未计分） | 10 |
| 执行轮次 | 20 |
| 归因 | `not_delivered: 0`，`delivered_but_not_used: 6` |

#### 逐用例

| 用例 | 结果 | 回复要点 | 判定 |
|---|---|---|---|
| `a1-pronoun-cat` | 失败 | 「作为一个AI助手，我没有直接接触或观察动物的机会」 | 上下文有豆豆，模型拒答 |
| `a3-switch-to-guitar` | 通过 | 「用户最近在学吉他。」 | 复述记忆，未提猫 |
| `a4-revisit-cat` | 失败 | 「这个对话是否适合在此处生成内容？」 | 输出退化，未提豆豆 |
| `a5-two-sessions` | 通过（**弱通过**） | 「生气，需要安慰。我们来聊聊好吗？」 | 有问号但未澄清「她」，见 §4.3 |
| `a6-insufficient` | 通过（真通过） | 「那您需要预定些什么呢？」 | 正确澄清 |
| `b1-recall-in-session` | 失败 | 「温暖: 1. 直接ness: - 提出明确的问题。」 | 复读 prompt 片段 |
| `b2-recall-new-session` | 通过（**弱通过**） | 「…可以猜测答案为成都…」 | 命中但表述是元语言 |
| `b3-correction` | 失败 | 「你的位置是哪里？」 | 杭州已投递，未使用 |
| `b7-conflict` | 失败 | **「用户住在上海。」** | 两条冲突记忆都在，直接选了一条 |
| `b8-miss` | 通过（**平凡通过**） | 天气数据 | 碰巧不含生日，见 §4.2 |
| `b9-bounded` | 通过（真通过） | 推荐《肖申克的救赎》 | 无关记忆未出现 |
| `c4-uncertain` | 失败 | **「用户住在杭州。」** | 忽略 stale 冲突，当确定事实断言 |

#### 这张表该怎么读

- **`not_delivered: 0`** 是有价值的结论：6 次失败没有一次能归咎于「系统没给上下文」。投递层尽到了职责。
- **6/12** 不是「陪伴能力 50%」。0.5B 模型不具备代表性，这些数字**只在「同一模型、同一数据集」内部可比**，用于观察改动前后是否退化。
- 其中至少 3 次「通过」属于弱通过或平凡通过。真实有效通过大约 3 次（`a3`、`a6`、`b9`）。**报告不应引用 6/12 作为能力证据**，只应引用「失败全部归因模型」这一点。

### 5.4 与改动前相比

| 指标 | 改动前 | 改动后 |
|---|---|---|
| 自动化测试 | 359 | 401 |
| 离线评测集 | 3 组 | 4 组 |
| 语境/记忆用例 | 0（companion-core 内 31 个混装） | 22（独立分层） |
| 逐轮断言 | 不支持（只看最后一次请求） | 支持 |
| 真实模型行为归因 | 无 | 有（`not_delivered` vs `delivered_but_not_used`） |

无回归：`evaluate`、`evaluate:cognition`、`evaluate:companion` 三个既有评测退出码均 0，`companion-core` 仍 31/31、`resultHash` 未变。

---

## 6. 如何运行

```bash
# L2：离线投递层（无需网络，秒级）
npm run evaluate:context
# 报告：evaluation/reports/context-memory-report.json

# L3：真实模型行为层（需本机 Provider）
ollama serve                      # 已在运行则跳过
npm run verify:context:real
# 报告：evaluation/reports/context-memory-real-report.json
# 退出码：0 全通过 / 2 有失败 / 3 blocked（无 Provider，不写报告）

# 只跑部分用例（迭代用）
MORROW_CONTEXT_REAL_CASES=a1-pronoun-cat,b7-conflict npm run verify:context:real

# 换模型或端点
MORROW_CONTEXT_REAL_MODEL=qwen2.5:7b npm run verify:context:real
```

CI（`.github/workflows/ci.yml` 的 `Offline evaluations` 步）只跑 L2。L3 需要本机模型，不进 CI——把不可复现的东西放进 CI 只会制造噪音。

---

## 7. 下一步（建议，未实施）

1. **先换模型再谈能力**：0.5B 上的行为数据只能证明管线通，不能指导产品。建议在 7B 级本地模型上重跑同一数据集，观察 `delivered_but_not_used` 是否下降。若下降，说明瓶颈在模型；若不下降，说明瓶颈在我们的投递方式（例如记忆块是 JSON，小模型可能不擅长读）。
2. **给冲突加系统级处理**：`b7`/`c4` 表明「把两条冲突记忆都给模型 + 一句原则」不足以保证不静默选边。可考虑在投递时就标注 `conflictsWith`，或在 system 里显式列出冲突对。这是当前最明确的、可被评测验证的改进方向。
3. **补空响应/慢响应的确定性模拟服务器**，把 L3 的 `auth-rejected`、`timeout`、空体从「未验证」变成「已验证」。
4. **人工复核清单**：10 个 `not_checked` 用例需要人读回复判断语气与克制，建议固定 3 人盲评，记录分歧本身。
