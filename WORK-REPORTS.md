# Morrow 算法工作报告索引

本分支**只承载工作报告**，不含实现代码。实现与测试在 `feature/algorithm-v2-phase-a` 分支（Draft PR #1）。

- 基线 `main`：`8b207b7d7b80b91ed4369d02fd6ef7e170b81133`
- 本分支基于：`main` 的同一提交
- 报告来源：`feature/algorithm-v2-phase-a` 的 `docs/algorithm-v2/`
- 实现分支 HEAD：`a6f9e0be683b9a40af028952d625a5643cbf3553`

所有数字来自实际执行；无法测量的项目在各报告中单独标注为「未验证」，未编造数据。

---

## 按阶段阅读

### Phase A — 基线审计

| 报告 | 内容 |
|---|---|
| [`phase-a-baseline.md`](./phase-a-baseline.md) | 审计当时的检索与认知管线：词法主导、来源不参与排序、无跨记录纠正链、检索不可重放、M3 评测器与生产脱耦、CI 状态 |

### Phase B — 混合检索、语义召回与独立评测

| 报告 | 内容 |
|---|---|
| [`phase-b-audit.md`](./phase-b-audit.md) | 复核 Phase A：发现两个缺陷（检索未固定到回合时刻、纠正链静默截断）并修复；确认 Phase A 指标存在调参污染 |
| [`phase-b-delivery.md`](./phase-b-delivery.md) | Phase A 实现交付：改动清单、复用的基础设施、执行的检查、CI 与 smoke 状态 |
| [`phase-b-semantic-evaluation.md`](./phase-b-semantic-evaluation.md) | 开发/验证/留出三段评测集、阈值校准、v2 词法 vs v3 加权 vs v3 RRF 的实测对比、资源开销 |
| [`phase-b-hybrid-retrieval.md`](./phase-b-hybrid-retrieval.md) | 混合检索实现：处理顺序、融合方式、回退矩阵、真实请求体闭环验证 |
| [`phase-b-final-report.md`](./phase-b-final-report.md) | Phase B 逐条验收回答、实测数字、未完成项 |

### Phase C — 检索正确性、评测可信度与本地部署

| 报告 | 内容 |
|---|---|
| [`phase-c-lexical-matching.md`](./phase-c-lexical-matching.md) | 修复子串匹配缺陷：按书写系统选择匹配单位，新旧结果对照 |
| [`phase-c2-failure-analysis.md`](./phase-c2-failure-analysis.md) | 两个语义召回失败的逐案例根因（能力边界 vs 门限边界），以及「语义模型错了、系统没有错」的对照证据 |
| [`phase-c3-benchmark.md`](./phase-c3-benchmark.md) | 基准 v2：数据集登记表、指标分母、Wilson 不确定性区间、加权 vs RRF 分出胜负、一处如实保留的门禁失败 |
| [`phase-c4-deployment.md`](./phase-c4-deployment.md) | 本地部署决策：安装包 106.49 MB vs 174.96 MB 实测、冷加载与内存、失败模式、方案 A/B 对比与建议 |
| [`phase-c5-ci.md`](./phase-c5-ci.md) | CI 现状、`workflow` 作用域授权需求、本地门禁已具备的检查项、模型用例通过/跳过/阻塞的区分 |
| [`phase-c-final-report.md`](./phase-c-final-report.md) | Phase C 逐条验收回答 |

### 评测协议与基线对照

| 报告 | 内容 |
|---|---|
| [`evaluation-protocol.md`](./evaluation-protocol.md) | 指标的精确公式、数据集 schema、门禁定义，以及这些数字**不能**证明什么 |
| [`retrieval-benchmark.md`](./retrieval-benchmark.md) | Phase A 时期 v1 与 v2 的逐案例对照（保留为历史基线，注意其调参污染已在 Phase B 复核中说明） |

---

## 核心结论速览

| 阶段 | 结果 |
|---|---|
| Phase A | 建立可回退基线与评测协议；发现 9 项问题 |
| Phase B | 混合检索上线留出集 Recall@1 0.4583 → 0.7917；泄漏 0 |
| Phase C | 修复子串匹配缺陷；错误相关率大降；留出 v2 Recall@1 0.8000（Wilson 95% [0.7412, 1.0]） |

**持续未解决**：检索评测未进 CI（缺 `workflow` 作用域）；语义模型分发流程未实现；两个语义场景仍失败（语用推理、一个跨语言方向）。
