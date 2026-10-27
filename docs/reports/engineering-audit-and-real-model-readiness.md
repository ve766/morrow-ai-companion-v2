# Morrow V2 — 工程核实与真实模型接入准备审计

审计日期：2026-10-27  
范围：只读源码审查、GitHub 状态核实、既有证据复核与本地测试复现。  
本阶段未修改产品源码、未合并 PR、未修改 `main`、未发布版本、未调用真实模型、未保存或使用对话中提供的 API 凭据。

## 1. 证据边界与 SHA

| 类别 | 值 | 含义 |
|---|---|---|
| 审计代码 SHA | `1bd5468d81460b3c0138d945e59df8a81a4cfd88` | 本地与 GitHub PR #4 head 一致；审计开始时工作区 clean |
| 本次测试运行 SHA | 同上 | 三次测试命令均在此工作区运行；没有源码修改 |
| 既有真实模型运行 SHA | `97f07d11cdaf2011055ea0a6e2db14fc6e56f5da` | 五次本地 qwen 运行；不是当前 HEAD 的新运行 |
| 报告 SHA | 本文件写入后由后续提交决定 | 不伪称本报告已经属于 `1bd5468` |
| CI | run `40524927941`，head 为审计代码 SHA | Ubuntu、Windows 和 Windows migration 三项均 success |

历史报告、当前源码、当前 CI 和真实模型结果是不同证据。CI 成功不能替代真实模型行为验收，旧模型运行不能标成当前 HEAD 的复测。

## 2. GitHub 与 PR 依赖

远程 `main` 为 `8b207b7d7b80b91ed4369d02fd6ef7e170b81133`，未保护；本阶段没有改动它。

| PR | 状态 | head | base | 最新列出的 CI |
|---|---|---|---|---|
| #1 | OPEN / draft | `a6f9e0b` | `main` | 3/3 success |
| #2 | OPEN | `12f83e1` | `main` | 3/3 success |
| #3 | OPEN | `e252d06` | PR #2 分支 | 3/3 success |
| #4 | OPEN / non-draft | `1bd5468` | PR #3 分支 | 3/3 success |
| #5 | OPEN / draft | `f55ef0a` | `main` | 3/3 success |

用 `git merge-base --is-ancestor` 验证了 `main → PR #2 → PR #3 → PR #4` 的祖先关系。PR #1、#5 不属于这条堆叠链。PR #4 的 57 个提交及 GitHub 文件列表中实际包含相关源码、fixture、验收测试、真实运行 JSON 和阶段报告；不是只有 PR 描述。

本地另一个 `ssh/phase-2.2-memory-reliability` 引用停在旧提交 `a57a55f`；实际 PR head 是 `ssh/feat/phase-2.2-memory-reliability` 与 GitHub API 中的 `1bd5468`，不能把旧引用当成 PR head。

## 3. 本地复现结果

### 3.1 测试运行器失败，不是产品断言失败

- 目标五文件命令：5 个文件在套件注册阶段失败，**0 tests**。
- 完整 `npm test`：59 个文件在套件注册阶段失败，**0 tests**。
- 去掉宿主注入的 `NODE_OPTIONS` 后重试目标五文件：结果不变。
- 典型错误：`Vitest failed to find the current suite`、`Vitest failed to find the runner`、`Cannot read properties of undefined (reading 'config')`。
- 本地 Node `v22.22.2`、Vitest `5.0.5`、Vite `6.4.5`；`package.json`、lockfile、Vitest 配置均无 diff。

因此本次不能把本地运行写成通过，也不能写成 592 条产品用例失败。CI 在当前 SHA 通过，但本地 runner/安装状态需要独立诊断，不能靠改断言或跳用例消除。

### 3.2 既有真实模型证据

仓库保留五次 `local-qwen-behaviors.*.json`，每次完整选择固定 12 场景、执行 16 turns，运行 SHA 均为 `97f07d1`：通过场景数依次为 **2、3、3、1、5**；失败数为 **6、5、6、7、3**；每次还有 3–4 个 `uncertain`。这些不确定项没有计入通过。

没有一个场景取得 5/5。冲突披露五次全失败；同会话召回仅最后一次通过。部分失败记录显示所需事实已经进入序列化请求，支持“模型未正确使用”而不是“记忆未送达”的归因。该结论只适用于本地 `qwen2.5:0.5b`，不可外推至其他模型。

## 4. 数据库迁移、备份与恢复

### 已有正向设计和历史证据

- 当前 schema 为 v21；事务支持嵌套 `SAVEPOINT`。
- 迁移前以 `VACUUM INTO` 创建快照，验证 integrity 和源 schema 版本。
- 备份导入校验 manifest、大小、SHA-256、schema、integrity、FK 与计数；恢复前再次校验，防止 preview 后文件被替换。
- 删除日志在 staged DB 内重放，再执行 integrity/FK 检查后替换 live DB；没有虚构“跨文件事务”。
- 凭据由独立 `SafeStorageSecretStore` 管理，不进入 SQLite 备份。
- `tests/acceptance/schema-recovery.test.ts` 与恢复测试有 CI 证据；本次本地无法执行，不能重复声明本地通过。

### 需修复或保持未决的边界

**R1 — 降级打开的产品边界不完整。** `SqliteDatabase.open()` 在迁移失败后允许 v9–v20 降级打开，只有 cognitive 表有明确 capability gate。聊天、Provider 等代码仍按当前列集查询；任意迁移失败后的可用性没有普遍保障。现有人工重复列测试只证明一种情况保留数据和快照，不证明所有旧 schema 都可安全读写，也不证明降级期间不会发生数据分叉。下一阶段应把“可恢复”与“可继续运行”分开验收。

**R2 — 替换过程不是崩溃原子性证明。** `swapRestoredDatabase()` 是 copy rollback → 删除 WAL/SHM → rename → 重开检查；rollback rename 失败会留下当时磁盘状态并返回错误。没有跨 live/staged 的事务，也没有在 swap 各时点强制终止进程的测试。既有 SIGKILL 测试针对事务恢复，不等于 restore swap 崩溃验收。

**R3 — 凭据备份测试是结构性证明加弱哨兵测试。** 哨兵从未写入 secret store 再导出，因此“备份不含哨兵”单独并不充分；真正的保证来自凭据不写入 SQLite、备份只包含 SQLite 和 manifest 的架构。建议下一阶段增加先向独立 secret store 写哨兵再导出的测试。

**R4 — 旧应用回滚只有 fail-closed 证据。** 当前代码会拒绝未知未来 schema，但没有真实旧 build 执行回滚/恢复；不得标为完整回滚通过。

## 5. Provider、协议与凭据安全

### 已确认实现

- `third-party` 是独立 provider id；DeepSeek endpoint/model 仍固定，本地 Ollama 路径仍保留。
- 第三方要求 HTTPS、禁止 URL 内凭据/query/fragment、显式数据外发 acknowledgement；timeout 限定 1–300 秒。
- base URL 去除末尾 slash 和 `/chat/completions`，请求派生为 `{base}/chat/completions`。
- adapter 再核对实际 endpoint 与 payload model；fetch 禁止 redirect，没有自动重试。
- 401/403、429、404、408/504、解析失败、abort/timeout/network 分开映射。
- 显式 active provider 不可用时抛 `PROVIDER_UNCONFIGURED`，不会偷偷切换服务；默认仍 local 优先、DeepSeek 其次。
- 凭据由 Electron safeStorage 加密后独立保存，配置返回只有 `apiKeyConfigured`；日志会遮蔽 authorization、key、requestPayload、prompt/content 等字段。
- consent hash 绑定 endpoint 和完整 request body，授权后重新构造并比较，敏感上下文另需授权。

这些是工程控制，不代表网关可信、模型目录存在、聊天协议兼容或行为达标。远程 URL 检查是 HTTPS 配置校验，不是网络 egress allowlist；用户确认的目标主机仍可能接收敏感内容。

### 新提供的三个 endpoint 的适配结论

- `https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions`：从 URL 形状看可归一化为 `/v2` base，并走现有 OpenAI Chat Completions 路径；**未实测兼容性**。
- `https://maas-api.cn-huabei-1.xf-yun.com/v1/responses`：当前 adapter 不是 OpenAI Responses API，不能直接配置使用。
- `https://maas-api.cn-huabei-1.xf-yun.com/anthropic/v1/messages`：当前 adapter 不是 Anthropic Messages API，不能直接配置使用。

目前没有已确认的 model id。`/models` 即使返回 200 也只能证明目录响应，不证明 chat 流式响应、`max_tokens`、角色处理或模型行为兼容。

### 已定位的 Provider 缺陷

**P1 — memory proposal 的用户预览硬编码 DeepSeek。** `MemorySuggestionService.preview()` 返回固定 DeepSeek endpoint/model，而真正 `prepare()` 使用 `requireConfigured()`，可能是 local 或 third-party。实际 consent hash 内仍绑定真实请求，因此这不是“hash 可绕过”，但用户看到的 preview 元数据可能错误，破坏知情确认。必须为第三方/local preview 增加回归测试后再做真实调用。

**P2 — 评测 probe 与生产请求策略不完全一致。** 真实评测的 `/models` probe 直接 fetch，未设置生产 adapter 的 `redirect: 'error'`。目录可达不能替代生产 adapter 的单次合成 chat 验证。

## 6. 记忆、纠正、撤回与人格上下文

### 已确认实现

- 只从 active memories 检索，sensitivity ceiling 始终生效。
- 当前 turn 的 lexical/topic 匹配优先；无词面重叠时，最近四轮上下文提供有界 `context` 路由，再有最多 3 条 `continuity` 背景。跨会话不依赖聊天 history，可从持久记忆召回。
- 最多读取 1000 条 active 记录、25 条入选、3000 字符。这是有界策略，不保证大规模库中旧的低排名相关事实必然被看到。
- memory block 分为 `currentFacts`、`unresolvedConflicts`、`uncertain`、`corrected`，声明 `subject=user`；旧纠正文本不会重新进入请求。
- 冲突由共享词项保守推断，只能称“可能冲突”；模型提示要求披露和澄清，不能静默选择。
- 人格数值、版本和 style rules 进入 system prompt；feedback 只有显式 apply 才能改变人格，不存在自动学习人格路径。
- 实际请求包含固定原则、人格、认知/情感提示、有界 self-model、记忆 block、最近最多 12 条/6000 字符 history 和当前 user turn；不是只发送 memory block。

### 已定位的记忆撤回缺口

**M1 — 删除消息没有清理派生 self-model 与 interest。** `deleteMessage()` 当前只撤回 feedback evidence、从该消息接受的 memory，再删除 message。`self_model_entries` 保存 `source_message_id` 和原始 statement，但没有 message 外键或删除联动；interest evidence 也独立于 message 生命周期。之后 `buildSelfModelContextBlock()` 仍可能把 active statement/interest 注入请求。故“消息及其派生内容不会再次出现”尚未闭环；现有删除/恢复测试没有覆盖这两个派生存储。此项在下一次真实行为测试前必须修复并补测试。

**M2 — 无重叠召回是缓解而非完整解决。** `context`/`continuity` 能覆盖省略句和跨会话熟悉感，但上下文短、continuity 小、语义主要仍是词面匹配。应保留同会话、跨会话、零重叠、大量旧记忆四类独立测试，不以单一路由通过代替整体能力。

**M3 — 固定 12 场景是基线，不是完整陪伴验收。** 它覆盖召回、纠正、冲突、删除、时效、无证据和安全回答，但不覆盖长历史预算、personality 切换后的逐请求变化、self-model 撤回、多模型稳定性等；不能扩展解释为产品 READY。

## 7. 真实模型接入门槛

对话中粘贴的凭据没有写入环境、secret store、数据库、源码或报告，也没有用于网络请求。由于它已经出现在聊天中，应按暴露凭据处理并轮换；本审计没有把“消息里存在 key”当作“用户已安全配置 key”。

第三方真实行为评测当前为 **BLOCKED**，原因是：

1. 没有确认已轮换并通过安全配置通道注入的凭据；
2. 没有确认模型 id；
3. M1 的派生撤回缺口和 P1 的授权预览错误尚需修复；
4. 新服务尚未通过生产路径单次合成请求验证。

下一阶段满足安全前提后，顺序应是：安全配置 key → 明确 Chat Completions base/model → 单次无记忆合成 chat → 核对原始请求/响应与 SSE → 再运行固定 12 场景；失败即停止，不自动重试、不扩量。只能使用合成数据，不能把本地库或真实用户记忆发给网关。独立人工复核仍未完成。

## 8. 下一阶段修复优先级

1. **M1**：让 message/conversation/memory 撤回覆盖 self-model、interest 和恢复重放；增加源码、DB、最终 request 三层证据。
2. **P1**：memory-proposal preview 使用真实 provider/endpoint/model，验证 consent 展示与实际 payload 一致。
3. **R1/R2**：定义 degraded-open 的只读或受限运行策略；增加 restore swap 崩溃/rollback 验收，不宣称跨文件原子事务。
4. **本地测试可复现性**：诊断 runner 初始化问题，保留 CI 与本地各自 SHA/环境，不通过删用例解决。
5. **模型层**：在上下文修复后分别做本地与第三方真实运行；重点复测冲突披露、同会话召回、纠正、staleness 和事实归属，`uncertain`/`needs_review` 不计通过。

## 9. 最终结论

**READY FOR REPAIR**

理由：仓库和 PR 基线可信，Provider/数据库/记忆已有可审查的工程基础，且已定位到具体的 M1、P1 和恢复边界问题，适合进入定向修复阶段。该结论不代表 PR 可合并、不代表真实模型 READY，也不解除第三方评测的 BLOCKED 状态。PR #4 应保持开放，直至上述修复、同 SHA 回归、真实模型验收与独立人工复核完成。
