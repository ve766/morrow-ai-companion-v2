# Cognitive Loop V1 / Phase 2.3 — 接入讯飞星火 MaaS 与 API 级诊断

任务编号 CL-P2.3。本阶段的目标是"用真实云端模型判断问题出在哪一层"。Provider 接入已完成并通过真实调用验证；**认知实验被账户额度阻塞**（403 / code 11200），因此本报告不含云端 A/B/C/D 对照结果，只给出可复核的接入证据、阻塞证据，以及解除阻塞后可直接执行的命令。

## 0. 一句话结论

**接入通过；实验被环境阻塞。** 讯飞星火 MaaS 已能作为一等远程 Provider 配置与调用，认证、路由、错误分类都验证过；但该账户当前"没有有效订单或额度不足"，任何生成请求都返回 `403 / 11200`，因此无法产生任何模型回答，A/B/C/D 实验与人工复核**未执行**——不编造结果。

## 1. 版本追溯

| 项 | 值 |
|---|---|
| 仓库 / 分支 | `ve766/morrow-ai-companion-v2` / `feat/cognitive-loop-v1-phase2`（PR #12，Draft） |
| `baseSha`（本阶段起点） | `f6498cb` |
| `headSha`（本阶段开始时） | `f6498cb` |
| `evaluationCodeSha`（探针与受阻实验实际使用） | `adbc18e`（接入代码提交） |
| `workingTreeDirty`（运行前） | `false` |
| `workingTreeDiffHash` | `null` |
| `reproducible` | `true`（探针与受阻实验两份 JSON 均为 true） |
| `reportCommitSha` | 本报告所在提交 |
| `main` | `8b207b7`（未改动） |
| 数据库迁移 | **新增 v16**（唯一不可避免的 schema 变更，见 §2.2） |

## 2. 第一部分：Provider 接入

### 2.1 已确认的缺陷

`src/providers/openai-compatible.ts` 的远程配置校验是：

```ts
return this.config.apiKeyConfigured &&
  this.config.endpoint === DEEPSEEK_API_BASE_URL &&
  this.config.model === DEEPSEEK_MODEL
```

即任何第二个 OpenAI 兼容 Provider 都无法配置。数据库层还有第二道锁：`provider_profiles` 的 CHECK 把 `id` 限定为 `deepseek | local-openai`。

### 2.2 改动清单

| 文件 | 改动 | 理由 |
|---|---|---|
| `src/providers/provider-registry.ts`（新增） | 远程 Provider 注册表：每个 id 对应一个**允许的 base URL** 与**模型 id 形态** | 保留"主机白名单"这一安全属性，同时允许第二个 Provider；不放开 URL 校验 |
| `src/shared/companion.ts` | `spark` id、`SPARK_MAAS_BASE_URL`、`SparkProviderConfigInput`；`MemoryProposalPreview` 的 provider/model 改为实际值 | 接入所需的最小类型扩展 |
| `src/providers/openai-compatible.ts` | 校验改用注册表；错误体读取数值码：`400/10404 → PROVIDER_MODEL`、`403/11200 → PROVIDER_QUOTA` | 三种失败（无此模型 / 无额度 / 密钥错）必须分开，否则诊断会被误导 |
| `src/shared/errors.ts`、`contracts.ts`、`src/app/ipc.ts` | 新增 `PROVIDER_QUOTA` 及提示文案 | 同上 |
| `src/app/companion-service.ts` | `saveDeepSeek` → `saveRemote`（按注册表）；`toRecord` 保留真实 id；`requireConfigured` 认可 spark | 通用化，不改变 DeepSeek / 本地路径行为 |
| `src/shared/validation.ts` | 允许 `spark`：endpoint 固定、模型 id 形态校验 | IPC 入口同等严格 |
| `src/persistence/migrations.ts` | **v16**：重建 `provider_profiles`，允许 `spark` 且 endpoint 固定为 MaaS base URL，model 长度 1–64 | 旧表 CHECK 无法容纳新 id；这是本阶段唯一不可避免的迁移 |
| `scripts/provider-probe.ts`（新增） | 用**真实适配器**逐模型探测：是否可配置、是否认证成功、错误类别 | 连接验证与路由核查 |
| `scripts/cognitive-evidence-experiment.ts` | `MORROW_EVIDENCE_PROVIDER=spark` 支持；报告记录 provider/model/参数 | 复用同一套实验 |

**未做**：没有改 URL gate 的白名单机制、没有新增 HTTP 客户端、没有重构记忆或认知层、没有改动 DeepSeek 与本地 Ollama 的行为、没有把星火伪装成本地模型。

### 2.3 安全

- Key 只通过 `MORROW_SPARK_API_KEY` 环境变量进入进程，经 `SecretStore` 写入（脚本用内存实现），**不进入仓库、报告、日志、错误信息或提交**。
- 适配器只读取错误体的数值码，读取上限 4096 字节，原样丢弃；错误只保留 `ApplicationError` 的错误码。
- 探针报告记录 `credential.length`，不记录内容。
- 服务端地址固定为 `https://maas-api.cn-huabei-1.xf-yun.com/v1`（注册表 + 迁移双重约束），不随配置漂移。

## 3. 连接验证（真实调用，非模拟）

| 检查 | 结果 |
|---|---|
| DNS | `maas-api.cn-huabei-1.xf-yun.com` → CNAME `alihs-spark-kcyxh.xf-gtm.com` → `39.96.0.90`、`39.96.25.223` |
| TLS | 握手成功，`ssl_verify_result=0` |
| 无凭据访问 `/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/anthropic/v1/messages` | 全部 `401`（路径存在，需鉴权） |
| 无凭据访问 `/v1/messages` | `404`（该路径不存在） |
| 带凭据 `GET /v1/models` | `200`，返回 `data: []`（**账户不在该接口枚举模型**） |
| 带凭据 `POST /v1/chat/completions` | 见下表 |

模型路由探测（每个模型一次最小请求，`max_tokens` 较小）：

| 模型 id | HTTP | 服务端 code | 含义 |
|---|---|---|---|
| `xdeepseekv3` | 403 | 11200 | 路由存在，**账户无有效订单/额度** |
| `xdeepseekr1` | 403 | 11200 | 同上 |
| `xop3qwen235b` | 403 | 11200 | 同上 |
| `x1` | 400 | 10404 | `no category route found`，无此路由 |
| `generalv3.5` | 400 | 10404 | 同上 |
| `4.0Ultra`、`lite`、`deepseek-v3`、`x1.5`、`xopglm47flash` | 400 | 10404 | 同上 |
| Anthropic 入口 `/anthropic/v1/messages`（model=xdeepseekv3） | 403 | 11200 | 同一账户限制，与协议无关 |

**结论：认证成功、路由正确、请求格式被接受；账户无可用额度。**

通过应用适配器执行的探针（`evaluation/reports/phase23-provider-probe.2026-10-28T11-47-48-130Z-148ff8.json`）：

```
attempted 5, connected 0
errorCodes: PROVIDER_QUOTA 3 (xdeepseekv3, xdeepseekr1, xop3qwen235b)
            PROVIDER_MODEL 2 (x1, generalv3.5)
```

`codeSha=adbc18e`、`reproducible=true`、`credential.provided=true`、报告中无密钥。

## 4. 阻塞判定

阻塞点不是代码、不是网络、不是模型 id 猜测错误，而是**账户额度**：

```
403 {"error":{"code":11200,"message":"no valid authorization: the account lacks
an active order, has insufficient quota, or the order is invalid","type":"permission_error"}}
```

该错误在 OpenAI Chat 入口与 Anthropic 入口、在三个不同模型上一致出现；同时 `11200` 已在讯飞文档中定义为"授权错误：该 appId 没有相关功能的授权 或者 业务量超过限制"。

由此：

- **无法产出任何模型回答**，A/B/C/D 四条件实验与人工复核未执行；
- 本报告不包含云端分数，**不以本地 0.5B 结果代替**；
- 不猜测模型能力，也不声称"云端更好/更差"。

配套的受阻实验记录（`evaluation/reports/phase23-A-2026-10-28T11-47-51-887Z-722a65.json`）证明链路本身正确：5 次请求全部发出、全部被 Provider 拒绝、账本与完整性校验正常。

| 项 | 值 |
|---|---|
| 场景运行 | 5（5 类场景各 1 次，`repeats=1`，仅条件 A） |
| Provider 请求 | 5 发出 / 0 成功 / 5 失败（`PROVIDER_QUOTA`） |
| 可评分 / 不可评分 | 0 / 5（`no_evaluation`） |
| 完整性校验 | `ok=true`（无孤立请求、无错误关联） |
| `reproducible` | `true` |

## 5. 测试与检查

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无输出 |
| `npx vitest run --maxWorkers=2` | 0 | **451 passed / 55 files**（比上阶段 +10） |
| `npm run evaluate:cognition` | 0 | `passed: true` |
| `npm run build` | 0 | 成功 |

本阶段新增的针对性测试：

| 文件 | 覆盖 |
|---|---|
| `src/providers/provider-registry.test.ts`（5） | 允许的 host + 模型形态；拒绝其他 host；拒绝非法模型 id；DeepSeek 契约不变；未知 Provider 无 spec |
| `src/providers/openai-compatible.test.ts`（+5） | 星火成功调用（URL、Bearer、body 不含密钥、返回 model id）；非白名单 host 被拒；403/11200 → `PROVIDER_QUOTA`；400/10404 → `PROVIDER_MODEL`；401 时错误信息不含密钥 |
| `src/persistence/migrations.test.ts` | 迁移 v16 后 `schemaVersion` 与全量升级路径仍通过 |

**GitHub Actions 仍未执行**：账户计费限制（run `40672878083` 及其重跑均 2 秒失败）。不声称 CI 通过；验收依据为本地实跑与 `codeSha=adbc18e` 的 `reproducible=true` 报告。

## 6. 五个问题的回答

1. **云端模型是否显著优于本地 0.5B？**
   **无法回答。** 云端模型一次生成都没成功（5/5 被 403 拒绝），没有可比数据。任何"更好/更差"的表述都会是编造。

2. **哪些认知失败在云端模型上仍然存在？**
   **未测。** 需要一个可用额度的账户。

3. **A/B/C/D 是否存在稳定改善？**
   **未测（云端）**。上一阶段本地 0.5B 的结论是"没有稳定差异，同条件重复波动大于跨条件差异"（参考-matched 13/11/11/7，重复运行 A 由 17 掉到 13）。

4. **错误主要发生在哪一层？**
   本阶段能确认的只有接入层：**认证与路由正确，额度不足**。证据传递层在上一阶段已被证明（证据逐条进入最终请求、回答回吐证据块内容）。提示词理解与回答质量两层，云端未测，本地结果是失败集中在语义层。

5. **哪些失败是自动评估器误判？**
   本阶段未产生新的模型回答，无新增误判样本。上一阶段 58 条复核中 6 条（10.3%）与自动判定不一致，已记录在 `phase22-human-review.json`。

## 7. 安全事件与建议

- 本次 API Key 由用户在对话中以明文提供。它**没有**写入仓库、报告、提交或日志；运行期间仅存在于仓库外的临时文件与进程环境变量中，任务结束后已删除临时文件。
- **建议立即在讯飞控制台轮换该 Key**，因为明文已经出现在聊天记录中；轮换后通过环境变量提供，不需要再贴到对话里。

## 8. 解除阻塞后的执行步骤

1. 在讯飞 MaaS 控制台为该账户开通/充值，使 `xdeepseekv3`（或控制台显示的其他 id）可用；
2. 轮换后的 Key 放入环境变量（不要写进仓库）：

```bash
export MORROW_SPARK_API_KEY='<rotated key>'      # 仅本机环境
export MORROW_SPARK_MODEL=xdeepseekv3            # 先跑探针确认可用 id

# ① 连接与路由再确认（真实适配器，5 次请求）
node /tmp/probe.cjs

# ② 四条件实验：各 5 场景 × 5 次 = 25 运行/条件，共 100 次主回答请求
for c in A B C D; do
  MORROW_EVIDENCE_PROVIDER=spark MORROW_SPARK_MODEL=xdeepseekv3 \
  MORROW_EVIDENCE_CONDITION=$c MORROW_EVIDENCE_REPEATS=5 \
  MORROW_EVIDENCE_OUTPUT=phase23-spark node /tmp/phase23.cjs
done
```

3. 产出后按 `docs/reports/cognitive-loop-v1-phase2-2.md` 的复核口径（全部冲突、全部否定、自动/人工不一致）再做一轮人工复核，才能回答第 6 节的 1–5 问。

## 9. 结论

**工程可靠性：通过（接入部分）。**
星火 MaaS 已成为可配置、可测试的一等远程 Provider：主机白名单、模型形态校验、`PROVIDER_QUOTA` / `PROVIDER_MODEL` 区分、密钥不落盘不落日志、迁移只做必要的一处、DeepSeek 与本地路径行为不变；451 条测试通过，探针与受阻实验两份 JSON 的 `codeSha=adbc18e`、`reproducible=true`、完整性 `ok`。

**认知行为：被环境阻塞（无结论）。**
账户无有效订单/额度，云端生成 0 次成功，A/B/C/D 实验与人工复核未执行。因此本阶段既不能确认也不能否定"云端模型更好"，更不能据此决定是否进入下一阶段。

**进入下一阶段的条件**：先用可用额度跑完 100 次云端主回答请求，并按既有口径完成人工复核；在此之前，认知层面的判断仍停留在上一阶段的本地结论（冲突 0/20、复核 58 条中 18 条正确使用），不足以支撑人格与内在状态开发。

## 10. 回滚

- 整体：不合并 PR #12，或 `git revert f6498cb..HEAD`。
- 接入部分：删除 `src/providers/provider-registry.ts`（及测试）、`scripts/provider-probe.ts`；`openai-compatible.ts`、`companion-service.ts`、`validation.ts`、`errors.ts`、`contracts.ts`、`ipc.ts` 还原到 `f6498cb`。
- 迁移 v16：**数据可回滚但需要新迁移**（schema_migrations 已记录 v16）。若必须回退，追加一个把 `provider_profiles` 重建回 v13 结构的迁移，并先确认没有 `spark` 行；不要直接删表。
- 数据：`evaluation/reports/phase23-*.json` 为新增文件，删除即可；历史 JSON 未改动。
