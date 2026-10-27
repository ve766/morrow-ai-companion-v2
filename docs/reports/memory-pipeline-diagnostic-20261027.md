# Morrow V2 记忆链路故障定位诊断（第一轮）

日期：2026-10-27  
性质：只读诊断。未修改生产代码、未修复缺陷、未合并 PR、未修改 `main`、未发布版本、未调用付费云端模型、未读取或输出任何真实凭据。

## 1. 仓库、基线与环境

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/ve766/morrow-ai-companion-v2.git` |
| 原分支 | `feat/phase-2.2-memory-reliability` |
| HEAD / 代码 SHA | `1bd5468d81460b3c0138d945e59df8a81a4cfd88` |
| 隔离目录 | `E:/opencode/morrow-v1-diagnostic-1bd5468`，detached worktree |
| 原工作区 | 仅有上一轮未跟踪审计报告；本诊断未触碰该文件 |
| PR | #1–#5 全部 OPEN；#4 head 为上述 SHA，base 为 PR #3 |
| 数据库 | 每用例新建临时 SQLite；无真实用户库 |
| 本地模型 | Ollama `qwen2.5:0.5b`，`http://127.0.0.1:11434/v1` |
| Node | `v22.22.2`，Windows x64 |
| 生产源码改动 | `git diff -- src package.json package-lock.json vitest.config.ts` 为空 |
| 运行代码状态 | `dirty`，原因仅为新增诊断 fixture、harness、证据和报告；生产源码未改 |

PR #3 的修复提交 `137113f` 是当前 HEAD 的祖先，已用 `git merge-base --is-ancestor` 验证，不是只依据 PR 描述。

可复核产物：

- 诊断 harness：`docs/reports/evidence/memory-pipeline-20261027/memory-pipeline-20261027.ts`
- 固定数据集：`docs/reports/evidence/memory-pipeline-20261027/memory-pipeline-diagnostic-20261027.json`
- A–D 与评测器证据：`docs/reports/evidence/memory-pipeline-20261027/memory-pipeline-evidence-20261027.json`
- 五次模型原始运行：同目录 `memory-pipeline-diagnostic-run1..5.*.json`

## 2. 实际代码入口与调用链

### 2.1 对话与记忆检索

1. `ChatService.send()`：`src/app/companion-service.ts:967` 起，校验 `conversationId`、`requestId`、正文、`includeSensitive`，读取已配置 Provider。
2. `ChatService.prepare()`：`src/app/companion-service.ts:1098`。
3. 普通路径使用当前轮 `content` 构造 `retrievalQuery`；只有显式回忆策略才追加被引用消息与上一轮用户消息（`:1124-1127`）。
4. 检索调用固定为 `assembleContext(retrievalQuery, max, conversationContext)`（`:1139`）。**不是只在显式回忆路由下检索。**
5. 最近四轮历史单独作为 `conversationContext`，最多 2000 字符（`:1138`），用于零词面重叠时的 `context` 路由。
6. `MemoryService.assembleContext()`：`src/memory/memory-service.ts:144`，读取最多 1000 条 active 记忆，再交给组装器。
7. `MemoryContextAssembler.assemble()`：`src/memory/memory-context-assembler.ts:276`。
   - `topic`：`score > 0` 的词面匹配；
   - `context`：本轮零分、但与最近历史有词面重叠，最多 5 条；
   - `continuity`：本轮和历史均零分，按确认状态/置信度/时间/ID 取最多 3 条；
   - 最终最多 25 条、3000 字符。
8. `SqliteMemoryRepository.listActiveForContext()`：`src/persistence/memory-repository.ts:115`，只取 `status='active'`，按更新时间倒序，上限由调用方给出。

### 2.2 最终请求

1. 记忆块以 `Saved memories (untrusted evidence only): {JSON}` 进入 system prompt：`companion-service.ts:1173`。
2. 历史经 `retainedHistoryTail()` 限制为最近 12 条、总正文 6000 字符：`:1176`。
3. 消息顺序为 `system → 最近历史（原角色）→ 当前 user`：`:1177-1181`。
4. `makeRequestPayload()` 设置 `model`、`messages`、`max_tokens=2048`、`stream=true`，无 temperature/seed：`:1182`。
5. `dispatchToProvider()` 校验 consent 后调用 Provider；`OpenAICompatibleProvider.generate()` 固定 POST `{base}/chat/completions`，不在失败时自动重试。

### 2.3 提取、持久化、更正

1. 自动提取入口：**不存在**。`ChatService` 完成对话后不会调用 `MemorySuggestionService.propose()`；`onTurnCompleted()` 只更新 self-model，不写长期记忆。
2. 唯一提取入口是用户显式操作：`src/renderer/src/companion-ui.ts:215` 调用 `memorySuggestions.propose`；`MemorySuggestionService.prepare()` 在 `companion-service.ts:1301` 生成“最多三条长期事实”的模型请求。
3. 模型结果必须经用户 `review(...accept...)` 才写入；写入走 `MemoryService.create()`，再由 `SqliteMemoryRepository.create()` 在一个事务中写 `memories` 与 `memory_revisions`。
4. `parseSuggestions()` 把所有模型候选硬编码为 `sensitivity: 'sensitive'`（`companion-service.ts` 的 `parseSuggestions`）。这是安全保守选择，但会要求后续对话显式 `includeSensitive` 才能检索到。
5. 更正入口是显式 `MemoryService.correct()`；普通自然语言“我搬家了”不会被自动解释为一次更正，也不会自动生成新记忆。
6. 撤回入口是 `MemoryService.retract()`；仓库更新 active 状态并写删除日志。

### 2.4 评测器

- 规则判定：`src/evaluation/verdict.ts`。
- 结构化判定：`src/evaluation/semantic-judgement.ts`。
- `uncertain`、`needs_review` 不计为 pass；只有正向 `mustMention` 全部满足才可能 pass。
- 主体规则仍以过敏/疾病和有限谓词为主；否认规则也只覆盖“过敏/住在/喜欢/讨厌”等有限谓词。

## 3. 测试 A：提取与保存

**结论：自动提取功能尚未实现；模型辅助提取 + 人工接受可以正确持久化。**

为避免把人工创建冒充自动提取，A 使用显式 proposal 入口和测试 transport。模型响应是合成的，因此只验证编排、解析和持久化，不验证真实模型提取质量。

| 输入 | 对话后自动提取 | 显式 proposal | 接受后 active |
|---|---:|---:|---:|
| 我一直住在杭州。 | 否 | 1 | 1 |
| 我喜欢独自研究新技术，不喜欢别人替我做决定。 | 否 | 1 | 2 |
| 我最近开始学习 Blender。 | 否 | 1 | 3 |
| 你好。 | 否 | 0 | 3 |

数据库实际记录：

- 正文与用户陈述一致；
- `status='active'`；
- `sourceCategory='model_inferred_confirmed'`；
- `confidence=70`；
- `revision=1`；
- `sensitivity='sensitive'`（来自 `parseSuggestions` 的固定值）；
- 创建时间存在；
- 每次接受后，下一次检索能看到记录，没有“写入成功但不进入索引”的证据。

失败归因：**EXTRACTION（功能缺失）**，不是 PERSISTENCE。持久化路径没有观察到失败。

## 4. 测试 B：语义变化后的检索

三个记忆全部 active，每次查询候选数均为 3，预算内没有候选被 `maxMemories` 或字符预算排除（`omitted=0`）。当前实现没有语义向量分数，也没有融合分数；下表的“词面分”是实际内部 `score`。

| 查询 | 主题命中 | 词面分 | 其他入选 | 结果判断 |
|---|---|---:|---|---|
| 我现在住在哪里？ | 我一直住在杭州。 | 1 | 另两条 continuity | 找到，但仅靠“住在” |
| 你记得我喜欢怎样做决定吗？ | 我喜欢独自研究… | 4 | 另两条 continuity | 找到 |
| 我最近在学什么软件？ | 我最近开始学习 Blender。 | 2 | 另两条 continuity | 找到 |
| 给我一个完全无关的问题。 | 我一直住在杭州。 | **1（误命中）** | 另两条 continuity | **无关问题仍注入杭州** |

零词面重叠对照：

- 查询“那后来呢？”，最近历史含“我最近开始学习 Blender。”；
- Blender 以 `match='context'` 入选，不是 `topic`；
- 另两条以 `continuity` 入选。

**B 的两个独立问题：**

1. 语义检索不存在。中文双字组会造成偶然碰撞：“给我一个完全无关的问题”和“我一直住在杭州”共享“我一”二元组，于是无关查询得到 1 分并被标为 `topic`。
2. continuity 会稳定补入最多 3 条背景，因此“没有因零分被完全排除”是事实，但“被选入”不等于“相关”。在记忆多时，排序仍缺真正的语义相关性。

失败归因：**RETRIEVAL**。证据强度：已证实（合成库、确定性输出）。

## 5. 测试 C：更正、冲突、撤回

### 5.1 显式更正

- 创建“我现在住在杭州。”；
- 调用 `MemoryService.correct()` 改为“我现在住在大阪。”；
- 当前正文为“大阪”，revision=2，保留两条修订；
- 最终请求 system 含“大阪”，**不含“杭州”**；
- 旧文本只在修订历史/记忆时间线可查，最终模型上下文不包含。

因此：显式更正机制正确；但自然语言“我搬家了，现在住在大阪”不会自动触发它，也不会自动保存新事实。旧记忆会保持 active。实际产品路径中的自然更正属于 **EXTRACTION 缺口**。

### 5.2 冲突

为构造冲突，另外创建一条 active“我现在住在杭州。”。组装结果为：

```json
{"unresolvedConflicts":[{"conflictGroup":0,"resolved":false,"entries":[
  {"content":"我现在住在杭州。","status":"conflict"},
  {"content":"我现在住在大阪。","status":"conflict"}
]}],"corrected":[{"memoryId":"<大阪记录>","onlyCurrentApplies":true}]}
```

两个值都进入请求，且明确标记 unresolved；没有把旧文本当作 currentFacts。组装层正确。

### 5.3 撤回

撤回两条居住记忆后再检索：

- 选中集合为空；
- 请求 system 不含杭州或大阪；
- 撤回后的记忆没有再次注入。

失败归因：此测试 **无 ASSEMBLY/PERSISTENCE 失败**；自然语言更正缺失归 **EXTRACTION**。

## 6. 测试 D：同会话与跨会话

| 场景 | 最终消息角色 | BLUE-731 来源 | 是否出现 |
|---|---|---|---|
| 同会话第二问 | system,user,assistant,user | 对话历史 + 当前问题 | 是 |
| 新会话、无持久记忆 | system,user | 无 | 否 |
| 新会话、有持久记忆 | system,user | system 中 saved memories | 是 |

这证明跨会话成功只能来自持久记忆，没有把同会话复述误判为长期记忆。请求角色顺序正确，没有角色错置；该组请求没有截断或重复。

失败归因：该链路无失败。

## 7. 最终请求证据

### 已检查

- 检索器返回的记忆 ID/正文/match；
- 组装后的完整 JSON 记忆块；
- 实际 Provider 调用的 endpoint、model、messages、role 顺序；
- 记忆是否进入 system、历史是否进入 user/assistant；
- 更正后旧值是否泄漏、撤回后值是否泄漏、冲突双方是否同时存在；
- Provider 错误码、空回复、超时和重试。

### 结果

- 更正请求：仅大阪，无杭州；
- 撤回请求：两者均无；
- 冲突请求：杭州、大阪均在 `unresolvedConflicts`；
- 跨会话有记忆：BLUE-731 在 system，历史只有当前 user；
- 无重复消息、无角色错置、无凭据；
- 五次本地模型运行均获得非空回复，`notDelivered=0`，没有 Provider 错误、超时或重试。

请求层没有发现“应有记忆未进入请求”的证据。因此本次失败不能归因于 PROVIDER 或 ASSEMBLY。

## 8. 本地模型重复实验

### 8.1 运行身份

固定 5 场景，同一 fixture、同一 prompt、同一模型，各运行 5 次。客户端不发送 temperature/seed，使用 Ollama 默认采样；因此重复性受服务端默认随机性影响。生产源码未改，运行 `codeState=dirty` 仅因诊断产物。

| 运行 | Run ID | 通过 | 失败 | uncertain |
|---|---|---:|---:|---:|
| 1 | `20261027T153722Z-5d5f32` | 0 | 2 | 3 |
| 2 | `20261027T153733Z-8db017` | 2 | 0 | 3 |
| 3 | `20261027T153738Z-5ffde0` | 1 | 1 | 3 |
| 4 | `20261027T153743Z-0b6c70` | 1 | 1 | 3 |
| 5 | `20261027T153752Z-ef5059` | 0 | 3 | 2 |

`uncertain` 不计入通过。

### 8.2 人工校正后的逐能力结果

| 能力 | 自动结果 | 人工校正 | 请求是否送达 |
|---|---|---|---|
| 跨会话 BLUE-731 | 1–2 pass/次 | **1/5 真正通过**；2 次假通过；2 次失败 | 5/5 送达 |
| 更正为大阪 | 0–1 pass/次 | **1/5 通过**；4 次失败 | 5/5 送达大阪，杭州未泄漏 |
| 冲突披露 | 0 pass | **0/5 披露**；4 次未回答，1 次静默选择大阪 | 5/5 同时送达两值 |
| 撤回后不使用 | 0 pass | 0 次泄漏；5 次均 `uncertain` | 5/5 未送达 BLUE |
| 无记忆不编造 | 0 pass | 0 次编造代号；5 次 `uncertain` | 5/5 空记忆 |

典型原始回答：

- 冲突：`您住在中国。`、`你住在哪里？`、`你住在大阪。`；
- 跨会话：`你，现在。我现在的项目代号是 BLUE-731。`（主体错误却被自动判 pass）；
- 更正：`you`、`你，请告诉我。我目前是在线的，不能回答这个问题。`；
- 撤回：`我无法提供与当前无关的详情……`；
- 无记忆：`抱歉，我记不起来这个信息了。`

失败归因：对已送达的冲突/更正，主要是 **MODEL**；跨会话两次自动 pass 是 **EVALUATOR** 假通过；撤回/无记忆的 absence-only 规则只能给出 uncertain，不能证明模型理解。

### 8.3 较强模型对照

**BLOCKED。** 当前环境只有 `qwen2.5:0.5b` 可生成；`nomic-embed-text` 只能嵌入。没有用户明确授权、已安全配置且无需额外付费的第二个生成模型。未调用云端，未使用聊天中出现过的 key。

因此不能判断“换更强模型是否稳定成功”，也不能把 0.5B 的结果外推到产品模型。

## 9. 评测器检查

### 9.1 自测样本

| 样本 | 应有判断 | 实际 | 结论 |
|---|---|---|---|
| 正确改述“你现在的居住地是大阪。” | pass | pass | 正确 |
| 错误值“你住在杭州。” | fail | fail | 正确 |
| 矛盾“你住在大阪，也住在杭州。” | fail | fail | 正确 |
| 已送达事实却拒答“我不记得……” | fail | fail | 正确 |
| 第一人称“我住在大阪。” | fail | fail | 正确 |
| 第一人称“我现在的项目代号是 BLUE-731。” | fail | **pass** | **假通过** |
| 否认“你没有项目代号 BLUE-731。” | fail | **pass** | **假通过** |
| 否认后又称“我不记得你住在大阪，但你现在住在大阪。” | fail | **pass** | **假通过** |

原因：

- 主体规则只识别过敏/疾病和“住在/喜欢”等有限谓词，未把“我的项目代号是”识别为把用户事实说成自己的；
- 否认规则不覆盖“有/项目代号”，把含值否定句当成普通陈述；
- “不记得”只通过 `ADMITS_UNKNOWN` 影响 answer 维度，没有覆盖同一回复中的自我否认。

### 9.2 对真实运行的影响

- run2、run4 的跨会话 pass 与“我(现在)的项目代号是 BLUE-731”同类，属于假通过；
- 冲突“您住在中国”“你住在哪里？”没有出现值，只能得到 `uncertain`，不是假 pass，但会把明显未回答隐藏为“无法判定”；
- 运行 ID、数据集、代码 SHA、请求摘要均已绑定，但报告没有保存完整原始请求文本，只有诊断字段；本次 harness 另行保存了最终请求。

失败归因：**EVALUATOR**，已证实。

## 10. 根因排序与证据强度

### 已证实

1. **EXTRACTION 功能缺口**：对话结束不自动提取；自然语言搬家/新事实不写入、不更新旧记忆。显式 proposal + 人工接受才保存。
2. **MODEL 使用失败**：冲突双方每次都在请求中，但 0/5 正确披露；更正值每次都在请求中，但仅 1/5 正确使用；跨会话仅 1/5 真正正确。
3. **EVALUATOR 假通过**：主体和否认规则过窄，至少 3 个合成反例和 2/5 真实跨会话 pass 被误判。
4. **RETRIEVAL 词面误命中**：无关查询因中文二元组碰撞把杭州标为 `topic`；无真正语义检索。
5. **PERSISTENCE / ASSEMBLY / PROVIDER 未发现本次失败**：写入、active 过滤、更正旧值移除、撤回移除、冲突双值注入、角色顺序和调用均正确。

### 较强迹象

- continuity 固定补入最多 3 条，会让无关事实进入每次请求，增加小模型误用机会；本次无关查询三条全部入选。
- 模型候选全部被硬编码为 `sensitive`，用户不开启敏感上下文时，经人工接受的记忆可能长期不可检索。
- 自动提取缺失使真实产品中的大多数自然陈述根本不会成为记忆，这比检索算法更上游。

### 尚未证实

- 真实模型（非 stub）的提取准确率、误提取率和拒绝率；
- 大量记忆（>25 条）下的排序、预算和误召回率；
- 更强模型在同一请求下是否稳定正确；
- 冲突“未回答”是否应统一判 fail，而非 uncertain；
- 历史居住地查询的产品语义；当前模型上下文不保留旧文本，只有记忆历史接口可查。

## 11. 最小修复顺序与验收条件

1. **先修评测器，不改模型结论**
   - 主体：识别任意“我的 X 是/为 VALUE”及第一人称谓词承载用户值；
   - 否认：识别含目标值的否定句，以及“我不记得…但…”的自相矛盾；
   - 验收：上述 3 个反例全部 fail；现有正确改述仍 pass；真实 run2/run4 不再假通过。

2. **明确提取产品路径**
   - 若产品要求自动记忆：对话完成后异步生成候选，仍需用户确认后写入；寒暄/模型自述/临时状态不生成；
   - 若保持手动：UI 必须明确“记忆不会自动保存”；
   - 验收：三句 durable 陈述生成候选、寒暄 0 候选、未确认不写库、确认后 DB 与检索均可见；不得把 stub 当真实提取质量。

3. **修检索误命中并保留可解释性**
   - 避免中文单二元组碰撞直接把无关记忆标 `topic`；引入最低相关阈值或真正语义分数；
   - 验收：无关查询不再 topic 命中；三个改述查询仍 topic 命中；零重叠仅在 context/continuity 中有界出现。

4. **模型层复测**
   - 在评测器修复后重跑同一 fixture ≥5 次；再在获得授权的第二个生成模型上重跑；
   - 验收：每个用例同时记录“值是否送达”和“是否正确使用”；冲突披露、更正遵循分开统计；`uncertain` 不计 pass。

## 12. 结束条件回答

- **有没有被提取？** 没有自动提取；显式 proposal 可以提取，但需要人工接受。
- **有没有保存成功？** 显式接受后保存成功，字段与事务正常。
- **检索有没有找到？** 三个改述查询找到；无关查询发生误命中；零重叠靠 context/continuity 找到。
- **为什么保留或排除？** topic 词面分、context 最近历史、continuity 固定背景；没有语义分数。撤回/非 active 被排除。
- **最终请求有没有包含它？** 更正、跨会话、冲突关键值均包含；撤回值不包含。
- **Provider 有没有成功返回？** 五次本地运行均返回，未观察到 Provider 错误。
- **模型有没有正确使用？** 冲突 0/5，更正 1/5，跨会话 1/5 真正正确；多数失败发生在正确请求已送达之后。
- **评测器有没有正确判定？** 大部分正确，但对第一人称项目代号、含值否定和“不记得但…”存在已证实假通过。

## 13. 结论

**当前证据最支持的根因是复合根因：自然对话的 EXTRACTION 缺口使记忆经常根本没有被创建；在记忆已经正确送达的场景，MODEL 无法稳定使用冲突/更正信息；EVALUATOR 又把部分主体错误误判为通过。** RETRIEVAL 有可证实的词面误命中，ASSEMBLY、PERSISTENCE、PROVIDER 在本次核心用例中没有成为首要故障层。

仍不能排除：真实提取模型的质量、强模型能否稳定成功、海量记忆下的检索退化、以及冲突未回答应如何判定。较强模型对照和真实提取质量均为 **BLOCKED**，不能用本轮 0.5B 结果替代。

下一步只应做最小修复：先修评测器假通过，再明确/实现提取产品路径，随后修中文词面误命中，最后在相同 fixture 上做强模型复测。不要先扩大功能。
