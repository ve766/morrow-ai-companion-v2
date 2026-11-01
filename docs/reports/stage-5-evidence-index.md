# Stage 5 证据索引

单页索引：源码、测试、真实模型、CI 与风险。所有结果绑定生成时的完整代码 SHA。

## 1. 源码（本阶段新增/修改）

| 文件 | 作用 |
|---|---|
| `src/relationship/relationship-threads.ts`（新） | 关系线程抽取、证据聚合、TTL/撤回/替换 |
| `src/affective-state/expression-policy.ts`（新） | 状态 → 结构化表达策略 |
| `src/persistence/migrations.ts` | v43 两张表 |
| `src/app/companion-service.ts` | prepare 内 observe/read + 两处 prompt 块 + D1 阶段化降级 + D3 多事实验证 + D4 原则 |
| `src/cognition/turn-evaluation.ts` | 记录策略与线程 id/kind |
| `src/memory/memory-service.ts` | D3 逐项验证 |
| `src/app/index.ts`、`evals/stage-3/runner/harness.ts`、`evals/stage-3/shared/real-provider.ts` | 装配三处（应用、scripted、live） |
| `evals/stage-5/{scenarios-v1.json,run.ts}`（新） | 12 场景与 runner |

## 2. 测试（本阶段）

| 文件 | 覆盖 |
|---|---|
| `src/relationship/relationship-threads.test.ts` | 抽取保守性、双消息晋升、称呼单条即生效、纠正替换、撤回、TTL 过期、同消息去重 |
| `src/app/stage5-presence.integration.test.ts` | 连续性进入下一轮 payload；撤回后消失；纠正后只用新值；策略四类对比；策略不覆盖事实 |
| `src/app/stage4a-continuity.integration.test.ts` | 12 项 4-A 验收（回归） |
| `src/memory/fact-index-faults.test.ts` | 索引故障/降级（D2 复核） |

## 3. 命令（本机 win32 / Node 22.23）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | — |
| `npx vitest run --no-file-parallelism` | 0 | 103 文件 / 951 测试 |
| `npx electron-vite build` | 0 | — |
| `npm run eval:stage5` | 0 | 12/12 scripted |
| `npm run eval:stage5:live` | 0 | 12/12 live（AWAITING_MANUAL_REVIEW） |

## 4. 真实模型

- 模型 `spark-x2.6`，契约 endpoint（`maas-api.cn-huabei-1.xf-yun.com`，OpenAI chat-completions）。
- 结果：`evals/stage-5/results/20261101T155538Z-1b7ab9c-stage-5.json`（代码 SHA `1b7ab9c`；其后仅文档提交）。
- 复核包：`evals/stage-5/review/transcript-live.md`（PENDING，人工填写）。
- 凭据：仅本机环境变量 `MORROW_TEST_API_KEY`，未写入任何文件。

## 5. 状态汇总

| 门槛 | 状态 |
|---|---|
| 关系连续性（跨会话、纠正/撤回/TTL） | PASS |
| 状态→策略（payload 差异且事实不变） | PASS |
| 12 场景客观检查（scripted + live） | PASS |
| D1–D4 | PASS（D2 复核无新增缺口） |
| 全量测试 / build | PASS |
| CI | 以 push 后 Actions 为准（未等待） |
| Electron 应用级冒烟 | BLOCKED（本机渲染进程崩溃） |
| Windows 安装 | NOT_RUN |
| 第二真实 Provider | BLOCKED（无凭据） |
| 人工自然度评分 | PENDING |

## 6. 风险

- 关系抽取依赖显式句式；模糊线索不写入（有意），可能漏掉真实但含糊的约会型表达。
- 关系线程与事实记忆是两套表，同一轮内先后写入但不在一个事务；一致性靠同一 message 证据与启动重建。
- 策略阈值是规则常量，未经统计校准；不同模型对策略块的服从度可能不同（live 只覆盖 spark-x2.6）。
- 上游推理模型常超 45s 截止：live 以有界重试（5 次）与 `PROVIDER_DEADLINE` 分类记录。
