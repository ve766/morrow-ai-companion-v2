# Phase 2.2.5 — 认知链路诊断与上下文结构

代码 `42cc5bd`（上下文与诊断）、`03dc89b` / `576260e` / `5b65f6d` / `b55ba7b`（评测修正）。

## 1. 诊断链

真实模型报告（`evaluation/reports/phase-2.2.5-behaviors-real.*.json`）现在每个 case 带 `diagnostics`：

```json
"diagnostics": {
  "expectedInRequest": ["杭州"],
  "deliveredInRequest": ["杭州"],
  "retractedLeaked": [],
  "requestContradictory": false,
  "stages": [
    {"stage":"stored","ok":true,"detail":"fixture declares 1 required and 0 forbidden value(s)"},
    {"stage":"retrieved","ok":true,"detail":"the required value reached the request"},
    {"stage":"serialized","ok":true,"detail":"1/1 required value(s) present; 0 retracted value(s) leaked"},
    {"stage":"answered","ok":true,"detail":"a reply was obtained and is stored verbatim"},
    {"stage":"evaluated","ok":true,"detail":"verdict pass"}
  ],
  "failureClass": "INSUFFICIENT_EVIDENCE"
}
```

同一份 JSON 里还保留：`turns[].content`（原始输入）、`turns[].reply`（原始回复）、`turns[].request`（角色序列、历史长度、投递条目数、`memoryMatches`、字节数）、`judgement.findings`（逐维度判定与依据）、`checks`、`failureReason`。凭这一份文件可以还原一轮对话而不需要重跑。

**没有新增存储**：全部来自已有的请求捕获与判定结果，没有第二份对话副本。隐私约束不变——全部本地，不上云。

## 2. 上下文结构（工作包 C3）

### 2.1 修复前

一个扁平列表，冲突只是每条的 `conflictGroup` 数字，指令里一句「conflictGroup may contradict: ask which is current」。模型需要自己从一堆并列条目里推断哪条有效。

### 2.2 修复后

```json
{
  "subject": "user",
  "instruction": "…currentFacts=confirmed now. unresolvedConflicts=contradict: say so, ask which is current, never pick one. uncertain=unconfirmed long: maybe. corrected=an earlier value was replaced: use only currentFacts. …",
  "currentFacts": [ { "id": "…", "content": "我住在杭州。", "status": "current", … } ],
  "unresolvedConflicts": [
    { "conflictGroup": 0, "resolved": false,
      "entries": [ {"content":"我住在杭州。","status":"conflict"}, {"content":"我住在上海。","status":"conflict"} ] }
  ],
  "uncertain": [ { "content": "我的生日在一月。", "status": "uncertain", "stale": true, "ageDays": 400 } ],
  "corrected": [ { "memoryId": "…", "replacedAt": "…", "onlyCurrentApplies": true } ]
}
```

四条规则：

1. **currentFacts** 是已确认的现行事实；
2. **unresolvedConflicts** 是显式的未解决冲突，`resolved:false` 写在结构里，不是靠模型猜；
3. **uncertain** 是长期未确认的记录（`stale`），标注为「maybe」；
4. **corrected** 只声明「这条事实被改过」，**不回传被替换的原文**。

第 4 条是刻意的：2.2.4 的失败样本里，模型把上下文里出现过的旧值当作现行值复述。把旧值塞回去等于邀请它再说一次；用户要求的是「替换」，不是「复述」。旧文本留在 `memory_revisions` 里可审计，但不进请求。

### 2.3 代价

单条记忆的块从 ~620 字符涨到 ~663 字符（多了分节键与 `status` 字段）。预算测试从 620 上调到 700，理由写在测试注释里；超限时仍从尾部丢弃，不会静默超预算。

## 3. 纠正的语义（工作包 C2）

- `MemoryService.correct` 走既有的 revision 机制：`current_text` 换新、`revision+1`、追加 `corrected` 修订行，旧文本保留在历史里；
- `listSupersededTexts()` 一条 SQL 取出「被纠正过的活跃记录」的上一版内容，用于生成 `corrected` 段；
- 检索时只有 `current_text` 参与，旧值不会和新值同时作为现行事实投递（`correction-new-value` 断言 `contextExcludes: ["上海"]`）；
- 连续两次纠正后只剩最新值（`correction-twice` 断言 `contextExcludes: ["上海","杭州"]`）。

## 4. 失败归因（工作包 E 的前半）

五个场景各 5 次，共 60 次判定，`failureClass` 分布：

| 分类 | 次数 | 含义 |
|---|---|---|
| `MODEL_MISINTERPRETATION` | 20 | 上下文正确，模型答错 |
| `INSUFFICIENT_EVIDENCE` | 36 | 判定为 pass 或 needs_review，无需归因 |
| `MODEL_IGNORED_INSTRUCTION` | 4 | 上下文正确，模型违反冲突/纠正要求 |
| `CONTEXT_NOT_RETRIEVED` | **0** | — |
| `CONTEXT_NOT_SERIALIZED` | **0** | — |
| `CONTEXT_CONTRADICTORY` | **0** | — |

**零检索失败、零序列化失败、零上下文矛盾。** 冲突场景的两条记忆都带 `conflictGroup` 送进请求，标注完整；模型仍然只答一个城市。

## 5. 本轮修掉的两个评测器假失败

两处都是真实运行暴露的，不是读代码想到的：

1. **`您` 不被认作第二人称**。模型答「您对花生严重过敏。」被判「没有回答」。已改为 `(?:你|您)`。
2. **「我不记得」被判成否认**。空记忆时这是**正确答案**，却被 `DENIAL` 正则判 fail。现在区分「否认事实」（`你不是对花生过敏` → fail）与「承认不知道」（无事实 → pass，有事实 → fail）。

修完之后 `no-evidence-admits` 从 2 fail / 3 uncertain 变成 5 uncertain（不再有假失败，但也没有一个 pass——模型从不说「不知道」而总是转移话题）。

## 6. 结论

| 项 | 状态 |
|---|---|
| 每轮对话可还原（输入/检索/状态/请求/回复/判定/归因） | **PASS** |
| 上下文区分现行/冲突/不确定/已纠正 | **PASS** |
| 不把旧值回传给模型 | **PASS** |
| 纠正后旧值不参与检索 | **PASS** |
| 归因基于证据而非猜测 | **PASS** |
| 评测器假失败（您 / 不记得） | **PASS**（已修） |
| 编造值的识别 | **NEEDS_REVIEW**（仍只能判 uncertain） |
