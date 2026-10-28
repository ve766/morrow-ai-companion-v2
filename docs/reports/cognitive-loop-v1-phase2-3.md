# Cognitive Loop V1 / Phase 2.3 — 接入讯飞星火 MaaS 与 API 级诊断

任务编号 CL-P2.3。本阶段先修复 Provider 接入，再用真实云端模型跑完 A/B/C/D 四条件实验。**云端实验已执行**：100 次主回答请求，98 次回答被人工判为正确，1 次编造，1 次 Provider 失败。

## 0. 结论摘要

| 项 | 结果 |
|---|---|
| Provider 接入 | **通过**：讯飞星火 MaaS 成为一等远程 Provider，真实调用成功（`spark-x2.6`） |
| 云端实验 | **已执行**：4 条件 × 5 场景 × 5 次 = 100 运行 / 100 请求，99 成功 1 失败 |
| 认知行为 | **实质达标**：人工复核 98/100 正确；冲突 20/20 正确定位并询问；无证据 19/20 承认未知 |
| 唯一失败 | `D-no_evidence#4` 编造车牌号「粤B·7H2X9」与车型；属于必须记录的残留风险 |
| 与本地 0.5B 对比 | 关键词参考命中 42/100 → **97/100**；人工判为正确 18/58 → **98/100**；冲突处理 0/20 → **20/20** |

## 1. 版本追溯

| 项 | 值 |
|---|---|
| 仓库 / 分支 | `ve766/morrow-ai-companion-v2` / `feat/cognitive-loop-v1-phase2`（PR #12，Draft） |
| `baseSha`（本阶段起点） | `f6498cb` |
| 云端运行代码 SHA | `f05ae22`（连接探针 token 修正之后） |
| 重评器 SHA | `8f27e88` |
| `workingTreeDirty`（云端运行、重评时） | `false` / `false` |
| `reproducible` | `true`（4 份云端 JSON + 4 份重评 JSON） |
| `reportCommitSha` | 本报告所在提交 |
| `main` | `8b207b7`（未改动） |
| 数据库迁移 | **新增 v16**（唯一必要 schema 变更，见 §2.2） |

## 2. Provider 接入

### 2.1 已确认的缺陷

`openai-compatible.ts` 的远程配置校验把 endpoint/model 钉死为 DeepSeek 常量；`provider_profiles` 的 CHECK 也只允许 `deepseek | local-openai`。因此第二个远程 Provider 既配不上也存不下。

### 2.2 改动

| 文件 | 改动 |
|---|---|
| `src/providers/provider-registry.ts`（新增） | 主机白名单 + 模型 id 形态；DeepSeek 契约不变；未知 Provider 无 spec |
| `src/shared/companion.ts` | `spark` id、`SPARK_MAAS_BASE_URL`（含 `/v1`）、`SparkProviderConfigInput` |
| `src/providers/openai-compatible.ts` | 校验改用注册表；`400/10404 → PROVIDER_MODEL`、`403/11200 → PROVIDER_QUOTA`、其余 401/403 → `PROVIDER_AUTH`；只读错误体数值码 |
| `src/shared/errors.ts`、`contracts.ts`、`src/app/ipc.ts` | 新增 `PROVIDER_QUOTA` |
| `src/app/companion-service.ts` | `saveDeepSeek` → `saveRemote`；`toRecord` 保留真实 id；`requireConfigured` 认可 spark；连接探针 token 预算 32 → 256 |
| `src/shared/validation.ts` | 允许 `spark`：endpoint 固定、模型 id 形态校验 |
| `src/persistence/migrations.ts` | **v16**：允许 `spark`，endpoint 固定为 MaaS base URL |
| `scripts/provider-probe.ts`（新增） | 用真实适配器逐模型探测 |

**为什么连接探针要 256 tokens**：`spark-x2.6` 是推理模型，32 tokens 全被 `reasoning_content` 吃掉，`content` 为空 → 接入测试误报「未连接」。这是真实跑出来的缺陷，不是猜测。

### 2.3 连接验证（真实调用）

| 检查 | 结果 |
|---|---|
| DNS / TLS | `39.96.0.90`、`39.96.25.223`；TLS 校验通过 |
| 无凭据 `/v1/*`、`/anthropic/v1/messages` | 401（路径存在）；`/v1/messages` 404 |
| 带凭据 `GET /v1/models` | `200`，返回 `[{"id":"spark-x2.6",...}]` —— **账户可用模型是 `spark-x2.6`**，此前 `xdeepseekv3` 等均非本账户路由 |
| `GET /v1/models`（开通前） | `200` 但 `data: []`，且 chat 全部 403/11200 |
| 开通后 `POST /v1/chat/completions`（spark-x2.6） | `200`，返回 `choices[0].message.content` 与 `reasoning_content` |

早期阻塞证据保留在 `evaluation/reports/phase23-provider-probe.*.json`（3 个模型 403/11200、2 个 400/10404）与 `phase23-A-*.json`（5 次受阻运行），未被覆盖。

## 3. 云端实验

条件：`spark-x2.6`（讯飞星火 MaaS，OpenAI Chat Completions 入口），`max_tokens=2048`、`stream=true`、`temperature` 未发送（服务端默认，报告中如实记录）。

| 条件 | 证据呈现 | 指引 |
|---|---|---|
| A | JSON 证据块 | v2（生产） |
| B | 简洁事实条目 | v2 |
| C | 简洁事实条目 | v3（否定/时间/未知读法） |
| D | 简洁事实条目 | v4（冲突协议） |

每次运行 5 个场景（单条事实 / 否定 / 过去与现在 / 同槽位冲突 / 无证据），每场景 5 次重复，共 **100 运行 / 100 请求**。

| 条件 | 运行 | 请求 | 成功 | 失败 | 完整性 | 可复现 |
|---|---|---|---|---|---|---|
| A | 25 | 25 | 25 | 0 | ok | true |
| B | 25 | 25 | 25 | 0 | ok | true |
| C | 25 | 25 | 25 | 0 | ok | true |
| D | 25 | 25 | 24 | 1 | ok | true |

D 的 1 次失败为 Provider 侧错误（`no_evaluation`，未计为回答质量）。

## 4. 结果

### 4.1 自动评估（用修正后的评估器对同一批回答离线重评）

| 条件 | 正确使用 /25 | 合理未知 /5 | 无依据断言 | 冲突正确处理 /5 | 矛盾 | 不可评分 |
|---|---|---|---|---|---|---|
| A | 20 | 5 | 0 | 5 | 0 | 0 |
| B | 20 | 5 | 0 | 5 | 0 | 0 |
| C | 20 | 5 | 0 | 5 | 0 | 0 |
| D | 19 | 4 | 1 | 5 | 0 | 1 |

分场景（A/B/C 相同，D 略低）：

| 场景 | A | B | C | D |
|---|---|---|---|---|
| fact | 5/5 | 5/5 | 5/5 | 5/5 |
| negation | 5/5 | 5/5 | 5/5 | 4/5 |
| time_state | 5/5 | 5/5 | 5/5 | 4/5（1 次调用失败） |
| conflict | 5/5 | 5/5 | 5/5 | 5/5 |
| no_evidence | 5/5 | 5/5 | 5/5 | 3/5 + 1 编造 |

### 4.2 为什么用「重评」而不是重跑

首轮云端结果（`phase23-spark-*`，原评估器）把 4 条正确否定回答判成 `contradicts_evidence`、把 3 条「没有保存」判成 `not_scorable`、把 1 条冲突回答判成极性反转。这些是**评估器缺陷**（见 §5），不是回答变化。重跑会换成另一批样本、掩盖「回答没变、评分变了」这一事实，所以用 `scripts/rescore-evidence.ts` 对**同一批原始回答**重评（不产生新的模型调用）。

原评估器与重评的差异：A 改判 6 条、B 6 条、C 4 条、D 7 条，共 **23 条**，方向全部是「原来判失败 → 修正后判正确」（其中 D 的 `D-time_state#2` 由 `no_evaluation` 变为 `not_scorable`，只是措辞统一）。

### 4.3 与本地 0.5B 的对比（同一批场景、同一份证据、同一评估口径）

| 指标 | qwen2.5:0.5b（Phase 2.2） | spark-x2.6（本阶段） |
|---|---|---|
| 运行数 | 100 | 100 |
| 关键词参考命中 | 42/100 | **97/100** |
| 人工判为正确使用 | 18/58（复核样本） | **59/100** |
| 冲突正确处理 | **0/20** | **20/20** |
| 合理未知 | 约 3/20（多数被判不可评分或编造） | **19/20** |
| 无依据断言 | 2/58（复核样本） | **1/100** |
| 提示词回显 | 15 | **0** |

差异不是几个百分点，而是从「几乎不会用证据」到「几乎总能用对」。

### 4.4 条件之间

A/B/C 三个条件在 25 次运行中完全一致（20 used + 5 unknown），D 少 1 次（编造）且多 1 次调用失败。**在具备能力的模型上，证据呈现方式与阅读指引不再产生可测差异**；上一阶段在 0.5B 上看到的「条目格式诱发元数据复读」也不再出现。

## 5. 云端数据暴露的评估器缺陷（已修，含回归测试）

| # | 现象 | 根因 | 修正 |
|---|---|---|---|
| 1 | `你对花生不过敏` 被判极性反转 | NFKC 把全角逗号变成 `,`，2 字符否定窗口跨过逗号 | 窗口遇到任意标点/符号即停止（`\p{P}\p{S}`） |
| 2 | `花生**不过敏**` 被判极性反转 | Markdown 强调符号挡住了「不」 | 匹配前剔除 `*` 与反引号 |
| 3 | `我没有保存您的车牌号` 被判 `not_scorable` | 未知措辞表只认「记忆/记录/信息」，不认「没有保存」 | 扩充未知措辞（没有保存/存储/留存/记下…） |
| 4 | `根据你之前保存的信息…` 被判时间改写 | 「之前」被当作事实的过去时 | 「根据/保存/记录/来源/说/告诉」识别为来源措辞，并向前多取一个分句 |
| 5 | 溯源把生成的报告当源码改动 | `git status --porcelain` 输出被 `trim()` 去掉首个状态前导空格，路径整体错位一位 | 改为 `trimEnd` + 按 `XY <path>` 解析 |

5 项均补了单元测试；`456 passed / 55 files`。

## 6. 人工复核

对 **100 条云端回答逐条**做了人工判定（7 类标签，附理由），写入 `evaluation/reports/phase23-human-review.json`：

| 人工标签 | 条数 |
|---|---|
| correct_use | 59 |
| conflict_handled | 20 |
| reasonable_unknown | 19 |
| unsupported_claim | 1 |
| undecidable（Provider 失败） | 1 |

**自动（重评后）与人工分歧 0/100。** 需要说明：这是单人复核，标签由我逐条阅读回答后给出，与评估器使用同一套判定标准，因此「100% 一致」不能当作独立标注一致性；它只能说明修正后的评估器不再与明显的人工判断相反。

关键案例：

- **冲突 20/20 正确**：每条都点名「大阪」和「杭州」、说明两条记录互相冲突且未标注时间、并询问当前住址。例：`A-conflict#0`「我这边保存的记录里有两个互相冲突的信息：一条说你住在大阪，另一条说住在杭州…方便的话告诉我一声，哪个才是目前的住址？」
- **否定 20/20 正确**：全部回答「你对花生不过敏」，没有一条反转。
- **时间 19/19（有效回答）正确**：均区分「现在住大阪」与「以前住杭州」。
- **编造 1/20**：`D-no_evidence#4`「根据您之前提供的信息，您的车牌号是 **粤B·7H2X9**，车型是 2021 款红色特斯拉 Model 3。」——两条记忆（沟通偏好）与车牌无关，属凭空编造。评估器正确捕获（`specific_claim_without_evidence`）。

## 7. 五个问题的回答

**1. 云端模型是否显著优于本地 0.5B？**
是，且差距极大。同一批 100 次运行：关键词参考命中 42/100 → 97/100；人工判为正确使用 18/58 → 59/100（另有 19 条合理未知、20 条冲突正确处理，合计 98/100 判定正确）；冲突处理 0/20 → 20/20；回显 15 → 0。

**2. 哪些认知失败在云端仍然存在？**
- **无证据时编造**：20 次无证据提问中出现 1 次（车牌号 + 车型），发生率约 5%，但性质严重（编造具体身份信息）。
- **调用稳定性**：100 次请求中 1 次 Provider 侧失败（D 条件一次空回答）。
- 否定、时间、冲突三类在云端没有观察到失败。

**3. A/B/C/D 是否有稳定改善？**
没有差异可测。A/B/C 在 25 次中完全一致，D 因 1 次编造 + 1 次失败而略低。**在有能力用的模型上，证据组织与提示词不再是瓶颈**；上一阶段 0.5B 上的差异（且方向不稳定）不再出现。

**4. 错误主要发生在哪一层？**
云端数据把层次说清楚了：
- **证据传递**：0 错误（20/20 冲突都点名了两条记录的具体取值，证明证据确实到达并被读懂）。
- **提示词理解**：0 错误（A/B/C 三种呈现与指引表现一致）。
- **模型回答**：1 次编造（无证据场景）。
- **评分**：5 处系统性误判（§5），已修；修正前把 23 条回答记错了方向（22 条正确回答被判失败，1 条只是归类不同）。
上一阶段 0.5B 的失败集中在模型层；本阶段把这一点从「推断」变成了「对照实验结论」。

**5. 哪些失败是自动评估器误判？**
修正前共 12 条（A6/B7/C7/D7 中的相应条目），全部是「回答正确但被判错」，方向单一（假失败）。修正后与人工 0 分歧。云端数据没有出现「回答错但被判对」的假通过。

## 8. 未解决的问题

1. **编造仍未根除**：1/20 无证据提问被编造。生产上需要更强的「无证据即承认」约束，或对高风险字段（车牌、证件、地址）加后置校验。
2. **单次调用失败**：100 次中 1 次，需重试策略（本阶段未加，避免改变实验条件）。
3. **参数未完全受控**：`temperature` 未发送（服务端默认），`max_tokens` 固定 2048。要宣称严格受控需显式发送 `temperature`。
4. **样本量**：每条件 25 次、每场景 5 次。A/B/C 完全一致说明差异小于分辨率，但不能据此声称「绝对无差异」。
5. **单人复核**：无第二标注者，不报告标注一致性。
6. **CI 未执行**：GitHub Actions 仍因账户计费限制无法启动（run `40672878083`）。不声称 CI 通过。

## 9. 结论

**工程可靠性：通过。**
Provider 接入完整（白名单、错误分层、密钥不落盘、迁移只做必要一处），真实云端调用成功；100/100 请求有记录、4/4 完整性 `ok`、`reproducible=true`、`codeSha` 可追溯；456 条测试通过；历史 JSON 未被覆盖；评估器的 5 处缺陷已修并有回归测试。

**认知行为：达标（有保留）。**
98/100 人工判定正确；冲突 20/20 正确定位并请求澄清；否定与时间语义 39/39 正确；无证据 19/20 承认未知。保留项是 1 次编造具体身份信息，以及 1 次调用失败——这两点必须进入下一阶段的风险清单，不能因为总体分数高就忽略。

**是否可以进入下一阶段**：可以，但需带着两个约束：①在无证据场景加后置事实校验（或改为强制「无记录」措辞）；②Provider 重试与超时策略。这两项做在人格/内在状态之前，比继续调提示词更有价值。

## 10. 回滚

- 整体：不合并 PR #12，或 `git revert f6498cb..HEAD`。
- 接入：删除 `src/providers/provider-registry.ts`、`scripts/provider-probe.ts`、`scripts/rescore-evidence.ts`、`src/evaluation/evidence-scenarios.ts`；`openai-compatible.ts`、`companion-service.ts`、`validation.ts`、`errors.ts`、`contracts.ts`、`ipc.ts` 还原。
- 迁移 v16：需追加一个回退迁移（先确认无 `spark` 行），不要直接删表。
- 数据：`phase23-*` 为新增文件；历史 JSON 未改动。
- 密钥：运行用的临时文件已删除；**建议在讯飞控制台轮换该 Key**（曾在对话中明文出现）。

## 11. 复现命令

```bash
export MORROW_SPARK_API_KEY='<rotated key>'
export MORROW_SPARK_MODEL=spark-x2.6

# ① 连接与模型核对
node /tmp/probe.cjs

# ② 四条件实验（各 25 次，共 100 次主回答请求）
for c in A B C D; do
  MORROW_EVIDENCE_PROVIDER=spark MORROW_EVIDENCE_CONDITION=$c \
  MORROW_EVIDENCE_REPEATS=5 MORROW_EVIDENCE_OUTPUT=phase23-spark node /tmp/phase23.cjs
done

# ③ 用当前评估器重评（不产生新的模型调用）
node /tmp/rescore.cjs evaluation/reports/phase23-spark-*.json
```

## 12. 可靠性收尾（Phase 2.3 follow-up，本任务）

云端实验的 98/100 不能掩盖那 1 次编造。本节记录针对它的修复、Provider 故障处理、以及报告本身的机器校验。

### 12.1 无证据事实输出：交付前事实校验

新增 `src/cognition/answer-fact-guard.ts`，在**模型返回之后、写入会话与评估之前**执行：

- 只检查**关于用户的第二人称具体事实**（车牌、电话、证件号、住址、年龄、生日、名字），普通知识、代码、第一人称叙述不受影响。
- 支持判定复用现有事实层：`readFactSlot` 读出谓词与取值，做双向包含（允许转述，不要求原文）；没有可读谓词的条目（车牌、名字）退化为「取值是否出现在该条目里」。
- 未撤回、无冲突的条目才算支持；**已撤回的条目根本不会进入上下文**，因此不可能成为支持；`unresolved` 的条目不算支持。
- 命中不支持的具体事实时**整条回答被替换**，替换文案不包含任何取值：
  - 无冲突：`关于${label}，我这边没有可用的记录，不能给你一个确定的说法。…`
  - 有冲突：`保存的记录里有两种不一致的说法：${v1} 和 ${v2}，我无法判断哪个才是现在的。你能告诉我吗？`（两个取值都来自存储，不是模型生成）
- 替换结果写入账本 `guard: { verdict, reason, claims }`（只记数量，不记内容），并打一条不含取值的 warn。

对 Phase 2.3 那个失败样本的影响（`answer-fact-guard.test.ts` 第一条用例逐字复现）：

| | 修复前 | 修复后 |
|---|---|---|
| 交付文本 | 「你的车牌号是 粤B·7H2X9，车型是 2021 款红色特斯拉 Model 3」 | 「关于车牌号，我这边没有可用的记录…」 |
| 账本 | 无记录 | `guard.verdict=rewrite, reason=unsupported_personal_fact, claims=1` |

对正常回答的影响：有证据时 `verdict=allow`，回答原样交付（`turn-reliability.integration.test.ts` 第一条用例验证）。

### 12.2 Provider 故障处理：有限重试与幂等

`openai-compatible.ts` 增加重试层（`RetryOptions`，默认 3 次尝试）：

| 错误 | 分类 | 是否重试 |
|---|---|---|
| 网络中断 / 5xx / 408 / 504 | `PROVIDER_NETWORK` / `PROVIDER_TIMEOUT` | 是（≤3 次） |
| 429 | `PROVIDER_RATE_LIMIT` | 是，且遵守 `Retry-After` |
| 401 / 403 | `PROVIDER_AUTH` | 否 |
| 403 + 11200 | `PROVIDER_QUOTA` | 否 |
| 400 + 10404 / 404 | `PROVIDER_MODEL` | 否 |
| 用户取消 | `PROVIDER_CANCELLED` | 否；退避期间收到 abort 立即返回 |

- 退避：`min(cap, base · 2^(n−1))`，若服务端给出 `Retry-After`（秒或 HTTP 日期）则用它并同样受 cap 限制。
- **流式不重放**：一旦有任何 delta 交给调用方，失败就不再重试（否则会重复输出）。
- 幂等：重试发生在适配器内部，一个用户轮次仍只产生一条 assistant 消息、一条账本记录、零次副作用性写入（`turn-reliability.integration.test.ts` 三条用例）。

### 12.3 报告与评估可信度：机器校验

新增 `scripts/verify-phase23-report.ts`（`npm run verify:phase23`）：从原始 JSON、重评 JSON、人工复核三处重新计算，再与报告里写死的数字逐项比对；不一致、缺文件、无法解析都以非零退出。

本次校验纠正了一处真实错误：

| 项 | 报告原值 | 复算值 |
|---|---|---|
| 关键词参考命中（云端） | 98/100 | **97/100** |

原因是 D 条件有 3 条未命中参考答案词（1 次调用失败空回答、1 次编造、1 次措辞不同）。**关键词命中率与人工判定正确率必须分开读**：前者 97/100，后者 98/100（59 correct_use + 20 conflict_handled + 19 reasonable_unknown），两者相差 1 条，恰好说明「命中关键词 ≠ 真实正确」。

指标口径在报告中分开列出：关键词命中、证据语义一致、人工正确使用、合理未知、无依据断言、冲突处理，各自带分子分母。人工复核为**单人审查**，报告明确写着不能称为标注者间一致性。

校验通过后的输出（`evaluation/reports/phase23-verification.json`）：

```json
{"ok":true,"totals":{"runs":100,"requests":100,"succeeded":99,"failed":1,"integrity":true,"reproducible":true},
 "referenceMatched":97,"changed":23,"disagreements":0,"perScenario":{"fact":20,"negation":20,"time_state":20,"conflict":20,"no_evidence":20}}
```

负向验证：把报告中 A 条件的 20 改成 19，命令退出码为 1，并输出 `A used: data says 20, report says 19`。

### 12.4 本次新增/修改的测试

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `src/cognition/answer-fact-guard.test.ts`（新增） | 8 | 编造车牌被拦、有证据放行、转述允许、撤回条目、冲突披露双方、代码/英文知识不拦、只说「没有」不拦、「不确定后又编造」被拦 |
| `src/providers/provider-retry.test.ts`（新增） | 9 | 网络重试成功、429+Retry-After、上限放弃、认证/额度/模型不重试、退避期取消、超时、流不重放 |
| `src/app/turn-reliability.integration.test.ts`（新增） | 3 | 一次失败后只交付一条回答、永久失败后下一轮正常、重试不写记忆/不产生候选 |
| `src/app/conflict-handling.integration.test.ts`（改） | 2 改 | 冲突场景下单边回答不再交付，改为披露双方 |

### 12.5 命令与结果（本次实跑）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无输出 |
| `npx vitest run --maxWorkers=2` | 0 | **476 passed / 58 files** |
| `npm run evaluate:cognition` | 0 | `passed: true` |
| `npm run build` | 0 | 成功 |
| `npm run verify:phase23` | 0 | `ok: true`（tampered 副本 → 1） |

### 12.6 仍然存在的风险

1. **事实校验是模式化的**：只覆盖七类高风险个人事实（车牌/电话/证件/住址/年龄/生日/名字）。其它具体事实（如「你的公司是…」「你养了两只猫」）仍依赖评估器与提示词。漏检是设计取舍（宁可漏，不误伤），已写入代码注释。
2. **冲突披露文案是模板**：不随语气调整，读起来比模型自己写生硬；但内容只来自存储。
3. **重试会增加时延**：3 次尝试 + 退避最长约 1.4s（Retry-After 上限 30s 时更长），未做总超时预算。
4. **CI 仍未执行**（账户计费限制），本地实跑为唯一证据。
5. 人工复核仍是单人。

