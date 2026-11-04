# Provider 多源接入验收矩阵（Issue #50）

- 代码 SHA：`24efc5cb60972f28b746779ca4f32ed37d295f57`
- 分支：`feat/provider-multi-source-foundation`
- 结论：**PARTIAL**（产品代码/UI/安全/迁移完成；真实第二 Provider 因账号额度不足 BLOCKED_QUOTA，本地服务未运行 BLOCKED，独立复审待完成）

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| 1 | DeepSeek/Spark 旧配置升级后可用，profile/secret 不丢失 | PASS | `provider-multi-source.integration.test.ts` `migrates the legacy provider table…`；v48 复制旧行；旧 secret id 不变；既有 provider 测试通过 |
| 2 | UI 可创建两个独立 custom profile，endpoint/model/secret 隔离 | PASS | `creates two isolated profiles…`；`tests/provider-profiles-ui.test.ts`；SecretStore 按 profile id |
| 3 | 自定义远程 OpenAI-compatible 中转站经正式产品路径发真实请求 | **BLOCKED_QUOTA** | `eval:provider-multi-source` run `20261104T100603Z-b3b82e61`：IPC save/list 通过；IPC test 到达 `https://api.supxh.xin/v1` 后返回 provider 403 `pre_consume_token_quota_failed`（余额 $0.04775 < 最低 $0.05），分类为 `PROVIDER_QUOTA`；未写成 PASS |
| 4 | 本地 loopback OpenAI-compatible 服务经正式路径连接 | **BLOCKED_LOCAL_SERVICE_NOT_RUNNING** | 无可用本地服务；`local` 字段明确 BLOCKED，未用 mock 冒充 |
| 5 | SSE/非流式/重试/取消/错误分类回归 | PASS（mock HTTP） | `openai-compatible.test.ts`、`provider-retry.test.ts`、`endpoint-*`、`provider-multi-source` health/quota 测试；真实 SSE 受 #3 阻塞 |
| 6 | Provider/endpoint/model 切换不重置 Morrow 本体状态 | PASS | `provider-continuity.integration.test.ts`：personality/memory/goals/messages 在 A→reopen→B→A 后保持；真实文件关闭/重开 |
| 7 | consent 绑定 endpoint/model/payload，切换后旧 consent 不可复用 | PASS | `binds consent to the profile endpoint and payload`；`assessProviderRequest` providerId/hash 校验 |
| 8 | SSRF/redirect/private network 安全 | PASS | `endpoint-security.test.ts`（HTTP/userinfo/query/fragment、loopback/私网/metadata、DNS 私网、lookup 失败）；adapter `redirect:error`；private-network 拒绝 |
| 9 | 无 secret 泄漏；tracked/log/report 扫描 0 | PASS | tracked 820→（最终扫描）0；结果/transcript 不含 key/Authorization/回复正文；测试 key 为固定假值 |
| 10 | 真实中转站测试有凭据时执行；无凭据 BLOCKED | **BLOCKED_QUOTA** | 凭据存在并执行；provider 额度不足；未宣称 real provider pass |
| 11 | 本地服务未运行明确 BLOCKED | PASS（BLOCKED） | `BLOCKED_LOCAL_SERVICE_NOT_RUNNING` |
| 12 | typecheck/tests/build/CI 通过 | PASS（本地）；CI 待 PR | 全量 `npx vitest run`、`tsc`、`build`；PR CI 记录在 evidence index |
| 13 | 独立 reviewer 复审代码与真实调用路径 | PENDING | 由独立上下文/Agent 另行提交，不由实现者代写 |
| 14 | PR 不自动合并，不合入 main/release | PASS | PR 保持 OPEN；release/main 未改 |

## 验证命令（代码 SHA `24efc5c`）

```bash
npx tsc --noEmit
npx vitest run
npm run build
npm run eval:provider-multi-source   # key 仅从 MORROW_TEST_API_KEY
```

真实运行（无 key 时 BLOCKED_NO_SECRET；本次有 key 但额度不足）：

`evals/provider-multi-source/results/20261104T100603Z-b3b82e61.json`
`evals/provider-multi-source/transcripts/20261104T100603Z-b3b82e61.md`

## 未完成/阻塞

- 真实第二 Provider 完成态：**BLOCKED_QUOTA**（provider 账号余额低于最低预扣 $0.05；不是代码失败，也不是 PASS）。
- 本地真实服务：**BLOCKED_LOCAL_SERVICE_NOT_RUNNING**。
- 独立复审：PENDING，另行提交。
