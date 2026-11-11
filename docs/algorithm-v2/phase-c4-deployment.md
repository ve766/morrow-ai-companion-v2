# Phase C4：本地模型部署决策

- 平台：Windows 11 x64，Node 22.22.2，Electron 44.9.3，onnxruntime-node 1.21.0，@huggingface/transformers 3.8.1
- 模型：`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`，**Apache-2.0**（HF API 实测 `cardData.license`），384 维，`max_seq_length 128`，均值池化，q8 量化后 **112.8 MB**
- 所有数字均为本机实测；无法测量的项目单独标注

---

## 1. 运行时事实

| 项 | 值 | 来源 |
|---|---|---|
| 推理运行时 | onnxruntime-node 1.21.0（N-API，无需针对 Electron 重编译） | package.json |
| 加载方式 | `@huggingface/transformers` v3 的 `pipeline('feature-extraction')`，`allowRemoteModels=false` | `onnx-semantic-encoder.ts` |
| 模型路径 | `<userData>/models/<modelId>`（可用 `MORROW_SEMANTIC_MODEL_DIR` 覆盖） | `src/app/index.ts` |
| Electron 内验证 | 主进程内 `ELECTRON_OK dim=384` | Phase B 手工探针 |
| 打包现状 | `build.files = ["out/**/*","package.json"]` → **node_modules 不进包** | package.json |

electron-builder 日志明确输出 `no node modules returned while searching directories`，即当前安装包**不包含**推理运行时，也不包含模型。

---

## 2. 资源实测

| 项目 | 实测值 | 说明 |
|---|---|---|
| 模型文件 | 112.8 MB（q8 ONNX）+ tokenizer/config ≈ **130 MB** 目录 | `du` |
| 冷加载（新进程，文件已在 OS 缓存） | **1514 ms** 墙钟 / **2671 ms** CPU | 多线程 ORT，CPU 时间 > 墙钟 |
| 同进程二次加载 | 1502 ms | **不缓存**，每次 `pipeline()` 都重新加载 |
| RSS：加载前空闲 | 65 MB | — |
| RSS：加载后 | 476 MB（**+411 MB**） | — |
| RSS：查询中 | 497 MB | — |
| 单条查询 | 6.2 ms 墙钟 / 36.0 ms CPU | 50 次平均 |
| 一次检索（5 条记忆 + 1 查询） | 17.9 ms | — |
| 离线运行 | `allowRemoteModels=false` 下全部正常 | Phase B + 本轮 |

**未测量 / 无法测量**：真正的「无 OS 文件缓存」冷启动（Windows 上无法在不破坏系统状态的情况下清缓存）。1514 ms 是「进程冷、文件热」的值。

---

## 3. 失败模式（全部实测）

| 情形 | 行为 |
|---|---|
| 模型 id 不存在 | `pipeline()` 抛错，错误信息含 `local_files_only=true or env.allowRemoteModels=false` |
| 模型文件损坏（写入 `not an onnx file`） | `pipeline()` 抛同样错误 |
| 适配层处理 | 两者都被 `SemanticEncoderUnavailableError` 捕获并归类为 `model_missing` / `load_failed` |
| 应用侧结果 | `tryCreateOnnxSemanticEncoder` 返回 null → **回退到词法检索**，回合不失败 |
| 失败后的重试 | 惰性加载器**记住失败**，不会每回合重试 113 MB 的加载 |

未测：模型版本不匹配（模型文件来自不同 modelId 但目录名相同）——等价于文件内容错误，与「损坏」路径一致，但未单独构造。

---

## 4. 安装包体积（实测）

| 方案 | NSIS 安装包 | 解包后 | 增量 |
|---|---|---|---|
| 现状（不含运行时与模型） | **106.49 MB** | 369 MB | — |
| A：随包分发运行时 + 模型 | **174.96 MB** | 498 MB | **+68.5 MB（1.64×）** |

测量方式：临时修改 `package.json` 的 `build.files` 加入 `node_modules/@huggingface/transformers/**` 与 `node_modules/onnxruntime-node/**`，`asarUnpack` 原生 DLL，`extraResources` 放入模型目录，然后 `npm run package:win`。测量后配置已还原，`git diff package.json` 为空。

体积构成（解包）：

| 组件 | 大小 |
|---|---|
| 模型目录 | 130 MB |
| onnxruntime-node win32/x64 | 34 MB（DirectML.dll 18.5 MB + onnxruntime.dll 16 MB + binding） |
| @huggingface/transformers dist | 45 MB（含大量面向 Web 的 WASM 变体，Node 侧用不到；可裁剪，未验证裁剪后是否仍能加载） |

安装包只增 68.5 MB 是因为 NSIS 压缩了模型与 DLL。

---

## 5. 两个方案的比较

### 方案 A：随安装包分发模型

| 优点 | 缺点 |
|---|---|
| 开箱即用，无网络、无同意流程、无半初始化状态 | 安装包 106 → **175 MB**（+65%） |
| 无需下载 UI、校验、断点续传 | 模型更新必须随应用发版 |
| 离线保证最简单（什么都不需要下载） | 所有用户都承担体积，无论是否使用语义检索 |
| 失败模式最少（文件随包，校验由安装器保证） | 仓库不携带模型，构建机器需要额外步骤 |

### 方案 B：首次启动由用户明确同意后下载

| 优点 | 缺点 |
|---|---|
| 安装包保持 **106.49 MB** | 需要实现下载 UI：进度、取消、校验和、失败重试 |
| 不用语义检索的用户不承担任何体积 | 首次使用前有一次性网络依赖 |
| 模型可以独立于应用更新 | 必须严格保证**绝不**静默下载（当前代码已满足：`allowRemoteModels=false`） |
| 与产品「本地优先、默认无网络」的姿态一致 | 失败状态更多（下载中断、校验失败、磁盘不足） |

### 共同要求（无论选哪个）

- 校验和必须验证（模型 113 MB，损坏会导致加载失败并静默降级，用户不会知道为什么语义检索没生效）。
- 模型缺失时**必须**有可见状态，而不是无声降级。当前实现是无声降级（决策日志里有 `semantic.applied`，但 UI 不展示）。

---

## 6. 建议

**采用方案 B，作为目标设计；本阶段不实现下载流程。**

理由：

1. **默认无网络是这个产品的既有约束**。方案 A 不破坏它，但把 113 MB 强加给所有用户，包括只用词法检索的用户。
2. 语义检索是**增强**，不是核心：词法路径在全部安全场景上已经正确（纠正、删除、撤回、权限），语义只是提高召回。
3. 方案 B 的下载是一次性的（113 MB），之后完全离线，与方案 A 的运行时行为相同。
4. 方案 A 的 175 MB 安装包会显著提高分发成本，而收益只对开启语义检索的用户存在。

**本阶段实际状态**：能力已实现并验证（真实模型、真实请求体），模型从本地目录加载，没有下载 UI。**方案 B 的下载/校验/进度/取消流程未实现**，因此现在既不是 A 也不是 B，而是「手动放置模型文件」——这必须如实说明。

---

## 7. 若实现方案 B，需要做的事

| 项 | 说明 |
|---|---|
| 下载源 | HF Hub 直链或自有镜像；必须固定到具体 revision，避免模型悄悄变更 |
| 校验和 | 记录每个文件的 SHA-256，下载后校验 |
| UI | 明确说明「模型 113 MB，仅在本机使用，不上传任何内容」+ 进度 + 取消 |
| 失败 | 下载失败/中断/校验失败 → 保持在词法路径，并在 UI 显示「语义检索未启用」 |
| 存储 | `<userData>/models/<modelId>`（当前默认路径，无需改代码） |
| 打包 | `build.files` 不需要加 node_modules —— **但运行时仍需进入安装包**，见下 |

**方案 B 仍然需要运行时进安装包**（+34 MB onnxruntime + JS），否则下载了模型也无法推理。所以更准确的对比是：

- A：175 MB 安装包，开箱即用
- B：约 140 MB 安装包（106 + 34 运行时），加 113 MB 一次性下载

**这个 140 MB 的数字是估算**（106.49 + 34 MB DLL + JS，未单独打包验证）；A 的 174.96 MB 是实测。

---

## 8. 决策所需但本阶段未提供的信息

1. 用户规模中开启语义检索的预期比例——决定 113 MB 下载是否值得。
2. 分发渠道对流量的敏感度。
3. 是否存在必须支持「完全无法联网安装」的场景（若存在，方案 A 不可替代）。
4. 是否愿意接受运行时进入 `dependencies`（+34 MB 安装包 + CI 安装时间）。
