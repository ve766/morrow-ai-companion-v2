# 记忆、Provider、UI 与 Windows 验证（Issue #78）

## Memory

- 现有 FTS5/Fact Slot/冲突/RRF/Utility 保留；本任务没有 Dense/PPR。
- 100/500/1000/5000 benchmark：**NOT_RUN**。缺固定 corpus/labels 和 benchmark harness；没有伪报数字。
- 历史 ONNX 语义通道未恢复；没有 112.8MB 模型。

## Provider/UI

- `npm run smoke:chat-ui`：PASS（built Electron → renderer → preload → IPC → ChatService → loopback HTTP/SSE → SQLite）。
- Portable `smoke:product-path`：PASS（隔离 profile，provider/secret/restart/continuity）。
- 真实 cloud Provider A–K：**NOT_RUN**；loopback 不等同 cloud。
- Provider registry 当前只支持 OpenAI-compatible；UI 不应宣称 Anthropic/Ollama/Responses 原生协议。
- 原生 consent OS 对话框点击/Electron 取消重试点击：PENDING_HUMAN/PARTIAL。

## Windows package

- Portable zip：`release/Morrow-2.0.0-x64-portable.zip`，154,662,310 bytes，SHA-256 `fc31efd6b2bfda02e90b8c9d635ce4fedbb9cfb1d88a2ab20256a11b057f1b1d`（上一轮构建；Issue #78 代码需重建后以最终值为准）。
- Portable asar：1,398,225 bytes，SHA-256 `f13ffbc1abbe2a1acd73a9edb391a516c7c01114a91b5b3959e47e38fd7176b3`。
- 自定义 NSIS：158,384,165 bytes，SHA-256 `0212b5471ae2d3375c1456c9c43e011f8d13c9e2d07e353325a1bc7e5d0d25b8`；PE/Nullsoft 有效，静默安装 exit 2 → BUILT_NOT_INSTALL_VERIFIED。
- electron-builder NSIS：BLOCKED（HTTP 504）。
- 签名：unsigned；未发 Release。
