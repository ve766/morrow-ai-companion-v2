# Phase C5：CI 评测门禁

- 现状：**检索评测尚未进入 CI**，且本阶段**没有**通过绕过权限、删除测试或降低断言来改变这一点
- 本阶段做了能做的部分：把 CI 需要的检查项**先补进本地门禁**，使接入 CI 后立即有效

---

## 1. 当前 CI 的实际状态

`.github/workflows/ci.yml` 的 `verify` job（windows-latest + ubuntu-latest 矩阵）按顺序执行：

1. `npm ci --ignore-scripts`
2. `npm rebuild better-sqlite3`
3. `npm run typecheck`
4. `npm test`
5. **`npm run evaluate` + `npm run evaluate:cognition`** ← 只有这两个评测
6. `npm run build`
7. 安装 Electron + xvfb → `npm run smoke`

另有 `Windows upgrade path` job 跑 `npx vitest run src/persistence`。

**`npm run evaluate:retrieval` 不在其中。** 语义评测（`run-semantic-retrieval-benchmark.mjs`）也不在。

---

## 2. 权限状态（多次实测，结论一致）

```
$ gh auth status        → Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'
$ gh api .../actions/permissions → {"enabled":true,"allowed_actions":"all",...}
```

- 仓库 Actions **已开启**，限制只在**凭据**上。
- 推送包含 `.github/workflows/*` 的提交会被 GitHub 拒绝：

```
refusing to allow an OAuth App to create or update workflow
`.github/workflows/ci.yml` without `workflow` scope
```

Phase B 曾尝试加一行并因此撤回；本阶段**没有再次尝试**改这个文件。

---

## 3. 需要的授权（由具有权限的人执行）

| 项 | 内容 |
|---|---|
| 文件 | `.github/workflows/ci.yml` |
| 位置 | `verify` job 的 `Offline evaluations` 步骤 |
| 改动 | 追加一行 `npm run evaluate:retrieval` |
| 所需权限 | classic PAT 勾选 **`workflow`**，或 GitHub App 的 **Workflows: write** |
| 授权方式 | `gh auth refresh -s workflow`（设备码流程，须账号持有人本人完成） |
| 授权目的 | 让 CI 运行与本地相同的生产检索评测，而不是只靠本地手动验证 |

授权完成后无需其他改动，CI 会自动运行 `npm run evaluate:retrieval` 并因门禁失败而使 job 变红。

**语义评测不建议进 CI**：需要 130 MB 模型 + 可选运行时，会给每次 PR 增加数分钟与大量下载。它应作为**发布前手动门禁**。若将来要进 CI，需要缓存模型或自建镜像，属于单独决策。

---

## 4. 本阶段补齐的检查项

为了让 CI 一旦接入就有效，Phase C1 的门禁已扩展到任务要求的全部检查项。`npm run evaluate:retrieval` 现在断言：

| 检查项 | 实现方式 |
|---|---|
| 纠正 / 删除 / 撤回防泄漏 | `v2NoLeaks` / `fewerLeaks`（泄漏计数为硬门禁） |
| 固定输入与时间的确定性 | 每个算法在每个案例上连续跑两次并比较规范化 JSON（`deterministic`） |
| 词法匹配回归 | `lexicalMatchingIsToken`：默认匹配模式必须是 token，防止 substring 缺陷悄悄回归 |
| 基本检索质量门槛 | `v2RecallAt5Floor ≥ 0.9`、`v2RecallAt1Floor ≥ 0.6`（**绝对**下限，不是只和 v1 比） |
| 评测数据集版本 | `datasetVersionRecorded`（semver）+ 单测锁定 fixture 的 `inputSetHash` |
| 模型相关测试是否实际执行或明确跳过 | 见 §5 |

新增的绝对下限很重要：纯相对门禁会放过「两个算法一起变差」的改动。

fixture 完整性由单测锁定：

```ts
expect(hash).toBe('5d3cecc8af7d66ff57045813ec10152ed4ff237d078f10466e012ec318545c99')
```

任何人改 fixture 都会让这个用例失败，必须**在同一次提交里**更新锁值并重新基线化——不能悄悄移动标准。

---

## 5. 模型相关测试：通过 / 失败 / 跳过 / 环境阻塞 的区分

`src/app/semantic-request-context.integration.test.ts` 有 6 个需要真实 ONNX 模型的用例。它们用 `describe.skipIf(!hasRealModel)` 门控，**不会**用 stub 顶替。

四种状态的实际表现：

| 环境 | 状态 | 证据 |
|---|---|---|
| 本机（模型存在） | **通过**（6/6） | `347/347`、`350/350`、`351/351` 全绿 |
| CI（模型不存在） | **明确跳过** | run `40274455249`：`317 passed \| 6 skipped (323)` |
| 模型损坏 / 缺失 | **通过但语义未生效** | 集成测试的 `applied: false` 断言 + C4 失败模式表 |
| 本机并行过载 | 曾出现超时，已把 per-test 预算提到 20 s | 连续三次全量通过 |

**关键声明**：CI 的 `317 passed | 6 skipped` **不等于**那 6 个模型用例已在 CI 验证通过。它们只在装了模型的本机上验证过。这一点在 Phase B 报告、Phase B PR 描述和本文件中都明确写了。

---

## 6. 本地评测入口（权限未就绪时的完整能力）

| 命令 | 作用 | 输出 |
|---|---|---|
| `npm run evaluate:retrieval` | 生产 v1/v2 对照 + 门禁（12 例） | `evaluation/reports/retrieval-benchmark-v1.json` |
| `node scripts/run-semantic-retrieval-benchmark.mjs --dataset semantic-retrieval-dev-v2.json --output …` | 三臂对照（16 例） | 对应报告 |
| 同上（validation / holdout v2） | 方案选择 / 最终评估 | 对应报告 |
| `node scripts/diagnose-retrieval-case.mjs --case <id>` | 单案例完整决策路径 | stdout |
| `npm test` | 351 用例，含 fixture 完整性锁 | — |

---

## 7. CI 接入后的预期行为

| 场景 | CI 表现 |
|---|---|
| 正常提交 | `evaluate:retrieval` 通过（当前 12/12 门禁全绿） |
| 有人改坏泄漏防护 | `v2NoLeaks` 失败 → job 红 |
| 有人把匹配模式改回 substring | `lexicalMatchingIsToken` 失败 → job 红 |
| 有人改 fixture 不更新锁值 | `npm test` 的完整性用例失败（先于评测） |
| 两个算法一起变差 | 绝对下限失败 → job 红 |
| 模型相关用例 | 保持 skip，报告中如实标注 |

---

## 8. 明确声明

- **CI 目前没有运行检索评测。** 在授权完成之前，这一点不会改变，也不会被表述成已接入。
- 语义评测在任何环境下都**没有**持续集成保护。
- 真实模型用例只在具备 130 MB 模型的本机上验证过。
