# 08 · 最终交付报告

- 状态：**PARTIAL**
- 已完成 30 天 grant 复用、sensitive 排除、撤销/过期单测、prepare snapshot 复用、timings、真实首/二次授权验证。
- 未完成 UI 选项/撤销控件、TTFT/renderer 计时、检索 benchmark、CI。
- 结论：聊天授权重复弹窗的产品主路径已修复；延迟优化只完成 prepare 去重与阶段计时，未达到全部量化门槛。

## Windows x64 包

- `release/Morrow-2.0.0-x64-portable.zip`：154,630,579 bytes，SHA256 `33ceb60f744d4ff7c3d235506730737d7ecb0e329e94b275083050d7703067d2`（PASS）。
- `release/win-unpacked/resources/app.asar`：1,245,068 bytes，SHA256 `2fb59d5aef57fa0f696e95036024c83f147e45db8cbcfb723e39e0090397333b`，与真实 Provider 验收使用的已安装 asar 完全一致。
- NSIS 安装器：BLOCKED。electron-builder 在 BUILD_UNINSTALLER 步骤执行中间安装器返回 exit code null；产物仅为 189,809 bytes 的未完成 stub，未作为有效安装器，也未运行安装。
