# Cognitive Loop V1 / Slice 2.2 — 疑问、否定与时间状态

## 1. 基线

| 项 | 值 |
|---|---|
| 基线分支 | `feat/cognitive-loop-v1-slice2`（PR #10） |
| 基线 SHA | `c5696a944d7808a1d4ff950aa7a308e6bcdad805`（开工前实测 CI 三平台 success） |
| 本轮分支 | `feat/cognitive-loop-v1-slice2-2`（从基线新建） |
| 最终 SHA | 提交 `fix(memory): classify mood, polarity and time before matching` 的 SHA（见 PR #11） |
| 迁移 / 依赖 | 无 |

## 2. 缺陷：复现、原行为、修复、新行为

| # | 输入 | 原行为 | 根因 | 新行为 |
|---|---|---|---|---|
| 1 | `我喜欢猫吗？` | `assertion`，value=`猫` | 只检查取值开头是否为疑问词，没有看句尾语气 | `question`，value 为空 |
| 2 | `我住在杭州吗？` | `assertion` | 同上 | `question` |
| 3 | `我对花生不过敏。` | value=`花生不`、`assertion` | 否定词被当成宾语的一部分 | value=`花生`、`negated` |
| 4 | `我没有花生过敏。` | 未识别否定 | 只检查谓词前 2 个字符 | value=`花生`、`negated` |
| 5 | `我以前对花生过敏，现在不过敏了。` | 单一当前事实 | 无时间状态，后句覆盖前句 | `uncertain` + `time=mixed`，不生成事实 |
| 6 | `我可能对花生过敏。` | `assertion` | 无模态词识别 | `uncertain` |
| 7 | `听说我对花生过敏。` | `assertion` | 无转述识别 | `uncertain` |
| 8 | `我不是不喜欢猫。` | `negated` | 双重否定被当作单次否定 | `uncertain` |
| 9 | `我以前喜欢猫，但现在不喜欢了。` | `negated`（取末句） | 转折句只保留一个极性 | `uncertain` + `time=mixed` |
| 10 | `我不再喜欢猫了。` | value=`猫了` | 尾字「了」在去标点前被判断 | value=`猫` |

修复方式：`readFactSlot()` 拆成「谓词识别 → 语气与极性分析 → 取值 → 时间状态」四步。`analyzeMood()` 依次判定假设/转述、模态、双重否定、过去与现在并存、疑问、否定、肯定；`time` 取 `past | present | mixed | unspecified`，`mixed` 直接降级为 `uncertain`。健康谓词改为 `对(宾语)(不)?过敏` 与 `(?:没有|没|无)(宾语)过敏` 两条，否定绑定到谓词而不是拼进取值。

## 3. 修改文件

| 文件 | 修改 |
|---|---|
| `src/memory/fact-slot.ts` | 新增 `FactTime`、`analyzeMood()`；健康谓词两条抽取；取值清洗顺序修正；`compareFactValues` 增加 `uncertain` 短路与「不同时间状态不算冲突」 |
| `src/memory/memory-context-assembler.ts` | 槽位准入增加 `memorySlot.kind !== 'uncertain'` |
| `src/memory/fact-slot.test.ts` | +8 条（语气、否定、时间、双重否定、跨时间比较） |
| `src/app/cognitive-continuity.integration.test.ts` | +4 条（疑问不成事实、否定极性保留、混合时间不合并、撤回不泄漏） |
| `scripts/cognitive-slice1-benchmark.ts` | +3 个场景（疑问、否定健康、混合时间） |

## 4. 算法与准入

- 语气判定顺序：假设/转述 → 模态 → 双重否定 → 过去与现在并存 → 疑问 → 否定 → 肯定。任一不确定条件成立即 `uncertain`，不生成取值。
- 疑问证据：句尾 `吗/么/呢`、`是否/难道/是不是`、取值以疑问词开头、句末问号；假设与转述优先于疑问。
- 比较三态不变，但新增：任一侧 `uncertain` → `uncertain`；时间状态不同且都明确 → `uncertain`（过去与现在可以同时成立，不是冲突）。
- 准入公式未改：`1.00·S_slot + 1.00·min(1, contentOverlap/2) + 0.25·S_temporal + 0.20·S_source`。槽位准入要求「问句 + 时间兼容」或「值等价」，且记忆侧不能是 `uncertain`。

## 5. 测试与工程验证

| 命令 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `vitest run --maxWorkers=2` | **323 / 323，44 文件**（Slice 2.1 的 311 + 12） |
| `electron-vite build` | 通过 |
| `npm run evaluate:cognition` | 三套数据集 gate 全过 |

覆盖边界：语气与极性在句子级判定，取值在谓词级抽取；不处理真正的句法分析。反例均与正例成对出现（疑问/陈述、否定/肯定、过去/现在、双重否定/单次否定）。

## 6. 真实模型评测

- 模型：`qwen2.5:0.5b`，本地 Ollama `http://127.0.0.1:11434/v1`
- 12 场景 × 5 轮 = **60 次调用**，`codeState=clean`
- 原始记录：`evaluation/reports/cognitive-slice2-2-benchmark.2026-10-28T05-56-55-013Z-fb9505.json`

| 指标 | 分子 / 分母 |
|---|---|
| 记忆选择 | **15 / 15** |
| 最终 payload 正确 | **60 / 60** |
| 证据使用 | **5 / 10**（50 次无评分场景，计未测量） |
| 无证据编造 | **0 / 5** |
| 撤回泄漏（payload / 回答） | **0 / 5，0 / 5** |
| 敏感泄漏（payload / 回答） | **0 / 5，0 / 5** |
| Provider 调用失败 | **0 / 60** |
| 模型层失败 | **5**（跨会话 1、新会话 4） |

新增三个场景（疑问、否定健康、混合时间）在 payload 层全部 5/5 通过；未做模型评分，因此计入未测量。

失败样例：`我住的这个城市最近怎么样？` 4/5 次回答未使用已投递的「杭州」（如「你住在哪个区呢？」）；猫名场景 1/5 次反问用户。

## 7. 未解决问题

1. 时间状态只做字面标记（以前/现在），没有区间推理；「上周」与「周三」不会关联。
2. 否定作用域基于子句内的标记，复杂嵌套（「我不认为他说的我喜欢猫是真的」）未覆盖。
3. `schedule` 谓词依赖事件名词，无标记词的事件只能走词法。
4. 0.5B 模型使用证据仍不稳定（5/10），不能外推。
5. 地点等价仅处理后缀，层级地址会被判冲突（保守方向）。

## 8. 回滚

删除本轮提交即可。`FactSlot` 新增 `time` 字段，属新增可选语义；无迁移、无数据格式变化、无新依赖。既有调用方只读 `predicate/value/kind/question`，不受影响。

## 9. 结论

- **工程验证：通过。** 323 条测试、类型检查、构建、认知评测全过；payload 层 60/60，撤回与敏感泄漏 0。
- **事实语义处理：通过（受限）。** 疑问、否定、模态、双重否定、过去/现在并存均按保守规则处理；覆盖面受规则上限约束。
- **真实模型行为：受限。** 60 次调用无 provider 失败，payload 全对，但可评分的 10 次里只有 5 次使用了已投递证据；这是模型能力问题，不作为工程结论。

## 10. 是否进入下一阶段

建议进入，但先把「模型是否使用证据」作为下一阶段的核心指标，而不是继续增加记忆规则。
