# 03 · 记忆检索消融

## 历史算法

`origin/feature/algorithm-v2-phase-a` @ `a6f9e0be683b9a40af028952d625a5643cbf3553` 含：

- `src/memory/retrieval/onnx-semantic-encoder.ts`
- `src/memory/retrieval/retrieval-v2.ts`
- `src/memory/retrieval/retrieval-semantic.ts`
- config/lexical/supersession/trace 等（该分支检索目录约 2172 行）

编码器依赖可选 `@huggingface/transformers`，本地模型 q8 约 113MB；当前产品未安装该 runtime/model，且不允许下载作为聊天副作用。

## 当前实现

`src/memory/memory-context-assembler.ts` 四通道 RRF：

- fact-index
- lexical
- fact-slot
- value

RRF `k=60`，随后 context utility/importance 重排；冲突并列、撤回/过期过滤。

## 判定

| 臂 | 状态 | 说明 |
|---|---|---|
| lexical-only | 可运行（当前 lexical 通道） | 未单独跑指标 |
| semantic-only | **BLOCKED** | encoder/model 不在运行环境 |
| hybrid | 当前生产是 lexical+fact-slot+value 的 RRF | 不是 neural semantic hybrid |

**决定**：保留当前 RRF；不把 lexical fallback 称为 semantic；不执行伪造消融。`results/retrieval-ablation.json` 记录 BLOCKED 与下一阶段所需模型/阈值。

## 历史记忆可信度

`origin/fix/memory-reliability-v0.1`、`fix/phase-2.2.10-memory-trust-hardening` 有 `timestamp-trust.ts`；当前分支没有该文件，也无等价显式模块。因历史 schema 集成未在 24h 内证明安全，**NOT_RESTORED**，列入 backlog。
