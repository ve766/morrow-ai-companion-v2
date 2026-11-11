# UI 截图证据

这些 PNG 由 `scripts/product-path-smoke.mjs` 在 Windows CI 的真实 Electron 窗口中生成，按 run id 分目录：

- `chat-1440x900.png` / `chat-1280x800.png` / `chat-390x844.png`
- `memory-*.png`
- `settings-*.png`

本机 Electron 宿主在 Windows 26200 上以 0xC0000005 退出，因此本机运行记录保留为 FAILED；不以静态预览图替代真实窗口截图。CI artifact `morrow-product-path-windows-latest` 包含这些文件。
