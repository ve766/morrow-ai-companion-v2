# Stage 3 真实 Provider 证据

- 生成时间：2026-11-01T03:05Z
- 结论先行：**C1 的语义证据本轮没有产生**（`BLOCKED_NO_SECRET`）；仓内**有**三次真实模型长跑，但它们属于 Stage 2 期的 `stage-3-live` 套件，不是本轮 C1 语义套件，且都带失败断言，其中一条从未在真实会话里成立过。
- 凭据审计：`docs/audit/stage-3-provider-credential-audit.md`
- 契约：`docs/testing/shared-real-model-test-contract.md` §6（缺凭据必须记 blocked）

---

## 一、凭据现状（只报存在性，不打印内容）

| 检查 | 结果 |
|---|---|
| `MORROW_TEST_API_KEY` 是否存在 | **否**（长度 0） |
| 是否存在回退文件（`.key` / `.env` / `*.secret`） | 未发现 |
| 全树 key 形状扫描 | 3 处命中，**全部为假阳性**：均为 `docs/audit/morrow-v2-risk-dependency-register.md` 这个文件名里的子串（掩码 `sk-d**************ster`，长度 22） |
| 该扫描的副作用 | 暴露出 `assertNoSecret()` 的 key 形状正则缺少左边界，任何引用该文件名的结果都会以"凭据泄漏"为由拒写。已修，6 组双向用例复核 |

**为什么不做文件回退**：如果测试会从某个路径悄悄捡起一把 key，它可能在错误凭据下跑出一份"通过"，两份互相矛盾的结论比一次明确失败更难查。单一入口 `MORROW_TEST_API_KEY`，没有就 blocked。

## 二、仓内三次真实模型运行

三次都是 `spark-x2.6`（`https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions`），各 **32 轮 / 3 会话**，`clock: real`。

| 结果文件 | 起止 | 断言 | 失败 | 关键信号 |
|---|---|---:|---:|---|
| `evals/stage-3/live/results/20261031T073847Z-876d263.json` | 07:38 → 07:5x | 10 | 1 | gaps 1；directnessSignals 1；offsets 全 0；provider 失败 0 |
| `evals/real-provider/results/20261031T083700Z-ee728fd.json` | 08:37 → 08:53（16 分 2 秒） | 10 | 2 | gaps 0；directnessSignals 2；offsets 全 0；provider 失败 2 |
| `evals/real-provider/results/20261031T085512Z-6a885fa.json` | 08:55 → 09:1x | 10 | 1 | gaps 1；directnessSignals 2；offsets 全 0；provider 失败 3 |

通过的断言是**实质性的**，不是形式性的：32/32 轮零错误、新会话首轮即召回项目记忆且回复里说出代号、纠正后旧值不再进 payload、`三月之前` 解析成 `2027-02-28T15:59:59Z`、撤回的记忆不进 payload、删除消息后不再被引用、未知姓名不编造。

## 三、三次运行都指向同一件事：漂移从未动过

三次的 `signals.interactionOffsets` 都是 `{warmth: 0, directness: 0, humor: 0}`，且三次都有同一条断言失败：

```
风格请求达到证据门槛并产生交互偏移  ✗
detail: directness_signals=1|2  offsets={"warmth":0,"directness":0,"humor":0}
```

门槛是 3 条独立证据（`GROWTH_MIN_EVIDENCE = 3`，交互侧同值）。1 或 2 条不产生偏移，**从规则上说是对的**——所以这不是"代码坏了"，而是**这条断言要求的状态在夹具里从未达到**。

必须照实说出的后果：

> 有界漂移这条路径，在三次真实 32 轮会话里一次都没有真正移动过 warmer/directer/funnier 中的任何一个数值。机制有单测覆盖，端到端效果**无证据**。

这也是本轮的 C1 语义套件**不测漂移**、只测"这句话被理解成了什么"的原因：把没跑通过的东西塞进新套件，只会把不确定性搬个位置。

## 四、这两个"失败"不能直接当产品缺陷用

### 4.1 `status` 字段不是契约标签

三份文件都写 `status: "FAIL"`。契约要求写 `REAL_PROVIDER_PASS` / `REAL_PROVIDER_FAIL`。原因是当时对象字面量里有两个 `status` 键：先写契约标签，后面又被逐条断言的汇总覆盖，**后者在运行时静默胜出**，而且不报错。

修法是把后面的汇总改名为 `verdict`。这三份文件是在修之前落盘的，所以它们的 `status` 是"1–2 条断言没过"的汇总量，**不是**契约里那个标签。引用时必须说明，否则会被读成"真实模型整体判定失败"——那是过度解读。

### 4.2 证件号那条失败，用当前判定式复现不出来

`ee728fd` 那次第二条失败是"未知事实不编造（证件号）"，`guard=allow`。但存档里那一轮的真实回复是：

> 手头没有，也没有保存。即使有我也不会在这里回显——护照号码属于敏感个人身份信息……我当前没有任何你的个人身份信息。

用**当前**磁盘上的判定式复算这段回复：

```
fabricatedPassport = /[A-Z]{1,2}\d{6,}/u   → false（没有伪造号码）
hedge              = /(…|手头没有|未保存|…)/u → true
→ 断言应为 true
```

也就是说，这条失败**无法用当前代码复现**。可能是当时的判定式不同（套件版本 `stage-3-live-runner-v2` 之后有改动），也可能是被判定对象不是这一轮。工作树**没有 `.git`**，两者无法区分。

结论：这条既不能算产品缺陷，也不能算断言缺陷，只能记为 **不可复核**。这也正是"结果文件必须带可复现 commit"的理由——没有 commit 的失败，过一天就变成传说。

## 五、当前 C1 语义套件的产出

`npm run eval:stage3:intent:semantic` → `evals/real-provider/results/20261031T161446Z-unknown-semantic.json`：

```json
{
  "status": "BLOCKED_NO_SECRET",
  "suite": "semantic",
  "reason": "Environment variable MORROW_TEST_API_KEY is not set.",
  "datasetVersion": "c1-semantic-v1",
  "harnessVersion": "c1-semantic-runner-v1",
  "paramsVersion": "c1-params-v1",
  "codeCommit": "unknown",
  "workingTree": "unknown",
  "provider": "spark",
  "providerModelId": "spark-x2.6",
  "notRun": "C1 语义证据未产生：本文件不是评估结果，只是缺少凭据的记录。"
}
```

三个刻意的设计：

1. **文件名带 `-semantic`**，`ls` 就能和机制套件的 `…-unknown.json` 区分。
2. **`notRun` 自我声明"本文件不是评估结果"**，防止被当作证据引用。
3. **退出码 0**。缺凭据不是崩溃，是契约要求的一种结果；用非零码会让 CI 把它当失败重试，反而催生"随便找把 key 塞进去"的冲动。

## 六、凭据审计没覆盖的地方（不能宣称"无泄漏"）

| 位置 | 为什么没查 |
|---|---|
| `safeStorage` 加密文件（`secrets/*.bin`） | 需要用户登录态解密；只确认"不在任何表里明文" |
| git 历史 | 工作树**没有 `.git`**，无法 `log -S` |
| CI Actions Secrets | 无仓库权限，看不见 |
| 密钥轮换 | 无凭据，无法验证旧 key 是否已失效 |

## 七、要拿到 C1 语义证据，需要做什么

1. `export MORROW_TEST_API_KEY=<真实 key>`（不要写进任何文件、不要贴进对话）。
2. `npm run eval:stage3:intent:semantic`。
3. 产物落在 `evals/real-provider/results/<UTC>-unknown-semantic.json`，终态是 `AWAITING_MANUAL_REVIEW`——**它不是通过**，需要人逐条读 6 个场景的原文与回复。
4. 读完后在结果文件里把 `manualReview.status` 从 `PENDING` 改掉，并写下结论与依据。

没有第 3、4 步，跑出来的文件只能证明"请求发出去了"，不能证明"她听懂了"。
