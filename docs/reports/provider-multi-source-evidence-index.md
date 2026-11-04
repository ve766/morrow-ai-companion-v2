# Provider 多源接入证据索引（Issue #50）

- 代码 SHA：`34098fb6698fad5a8674e8ceb2b2a4f5be819310`
- 分支：`feat/provider-multi-source-foundation`
- base：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 状态：PARTIAL

## 1. 源码

| 主题 | 文件/符号 |
|---|---|
| 类型 | `src/shared/companion.ts`（ProviderSourceKind/ProtocolId/Capabilities/Health/ProviderConfigRecord/ProviderProfileSaveInput） |
| 迁移 | `src/persistence/migrations.ts` v48 `provider-multi-source-profiles` |
| Registry | `src/providers/provider-registry.ts`（spec/validate/normalize） |
| Endpoint | `src/providers/endpoint-resolver.ts` |
| Security | `src/providers/endpoint-security.ts`（classify/policy/digest/mask） |
| Adapter | `src/providers/openai-compatible.ts`（profile-aware、SSRF policy、quota 403） |
| Service | `src/app/companion-service.ts:ProviderConfigService` |
| IPC | `src/app/ipc.ts`、`src/preload/index.ts`、`src/shared/contracts.ts`、`src/shared/validation.ts` |
| UI | `src/renderer/index.html`、`src/renderer/src/provider-profiles-ui.ts`、`main.ts` |
| Eval | `evals/provider-multi-source/run.ts`；`package.json` `eval:provider-multi-source` |
| Error | `src/shared/errors.ts` `PROVIDER_ENDPOINT_BLOCKED` |

## 2. 测试

| 文件 | 关联 |
|---|---|
| `src/app/provider-multi-source.integration.test.ts` | 迁移、两个 profile、隔离、非法 endpoint、connection/health/quota、discovery、consent、DNS 私网 |
| `src/app/provider-multi-source-ipc.integration.test.ts` | IPC save/list/test、不可信 frame、危险 endpoint |
| `src/app/provider-continuity.integration.test.ts` | A→reopen→B→A 本体状态不变 |
| `tests/provider-profiles-ui.test.ts` | 列表/编辑/保存/测试/删除/默认 |
| `src/providers/endpoint-resolver.test.ts` | base/versioned/full path、models、URL 约束 |
| `src/providers/endpoint-security.test.ts` | HTTPS、userinfo/query/fragment、loopback/私网/metadata、DNS、IPv4/IPv6 |
| `src/providers/openai-compatible.test.ts` | 既有 payload/SSE/错误 |
| `src/providers/provider-retry.test.ts` | retry/timeout/取消 |
| `src/providers/provider-registry.test.ts` | 官方 spec/legacy |
| `src/app/provider-manual-chat.integration.test.ts` | 旧配置/连接测试/secret 回滚 |

## 3. 命令与结果（代码 SHA `34098fb`）

```bash
npx tsc --noEmit                     # 0
npx vitest run                       # 113 files / 1044 tests passed
npm run build                        # success
npm run eval:provider-multi-source   # BLOCKED_QUOTA (external)
```

Provider 定向：13 files / 91 tests passed（endpoint/security/adapter/retry/registry/UI/IPC/continuity/multi-source/manual-chat/local）。

## 4. 真实运行

| 项 | 值 |
|---|---|
| Run ID | `20261104T114033Z-10e4a3e2` |
| Result | `evals/provider-multi-source/results/20261104T114033Z-10e4a3e2.json` |
| Transcript | `evals/provider-multi-source/transcripts/20261104T114033Z-10e4a3e2.md` |
| Status | **BLOCKED_QUOTA** |
| Endpoint | `https://api.supxh.xin/v1`（digest `81f2def21ea9d6eb`） |
| Model | `gemini-3-flash` |
| Evidence | IPC save/list true；真实请求到达 provider；provider 403 `pre_consume_token_quota_failed`（余额 $0.04775 < $0.05）；分类 `PROVIDER_QUOTA` |
| Local | `BLOCKED_LOCAL_SERVICE_NOT_RUNNING` |

说明：同一 key/端点/模型在额度下降前曾返回 200（09:52 的 `.tmp` 协议探测），但该次不是最终代码 SHA 的正式产品路径证据；本索引只把最终 SHA 的 `BLOCKED_QUOTA` 结果作为真实运行证据，不写成 PASS。

## 5. CI

- PR: https://github.com/ve766/morrow-ai-companion-v2/pull/51
- Run: https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41823420247
- head: 44404e086063a0a621caf4fceedb0e65bb8cce3d
- conclusion: success
- jobs: Ubuntu typecheck/tests/build/smoke; Windows 同; Windows upgrade path（7 files / 59 tests）
- 未复用旧 run。
- 独立复审：PR #52，review commit `626a3cf4b80bde4598b22a2732037b534a863fa4`，round 2 `PASS_WITH_NON_BLOCKING_BACKLOG`。

## 6. 安全扫描

- tracked 文件扫描：0 个真实 key 泄漏（测试中的 key 为固定假值）。
- 结果/transcript：不含 key、Authorization、回复正文。
- 未修改仓库 secrets。

## 7. 未完成/阻塞

- 真实第二 Provider：BLOCKED_QUOTA。
- 本地服务：BLOCKED_LOCAL_SERVICE_NOT_RUNNING。
- 独立复审：PASS_WITH_NON_BLOCKING_BACKLOG（PR #52 round 2；B1/B2/B3/B4 已复验修复）。
- v48 与 Stage 4 v48 版本冲突：合并前需重编号为 v49（若无已发布 provider v48 DB）。
