# 安全政策（Security Policy）

## 敏感数据处理原则

### 凭据（API Key / 本地服务口令）

- 唯一存储位置：OS 级加密存储。Windows 上为 Electron `safeStorage`（DPAPI）加密后写入 `<userData>/secrets/<id>.bin`（0600，原子替换写入）。
- **绝不**写入 SQLite、普通日志、提交历史、渲染进程或 IPC 响应（IPC 只返回 `apiKeyConfigured` 布尔位）。
- 读取失败/密文损坏：映射为 `PROVIDER_CREDENTIAL_STORE_ERROR`，聊天暂停（fail-closed），不降级为明文。
- 删除：显式操作；对 ENOENT 幂等。

### 出口（egress）控制

- 所有模型请求必须经过 `assessProviderRequest`：未配置/载荷 >64KB/无有效同意/敏感上下文未批准 → 拒绝。
- **local 类 Provider 只能指向文本上可证明的回环端点**（`security/url-gate.isLoopbackEndpoint`）：仅接受 `localhost`、`127.0.0.0/8`、`::1` 字面量；拒绝 DNS 名、IPv4 映射、内嵌凭据、不可解析输入；不信任解析结果。同一门禁在**配置保存时**再校验一次（fail closed）。
- 每次云端请求需用户在同意框中单独批准：展示精确载荷 SHA-256、字节数、所选记忆清单与完整请求正文；同意哈希经 timing-safe 比较，有效期 ≤5 分钟且单次有效。
- 敏感级记忆默认不进入任何请求；进入需用户在该次请求中明确勾选。

### IPC 与渲染进程

- contextIsolation + sandbox + CSP（生产禁 unsafe-inline）；`will-navigate` 仅信任白名单渲染源；`setWindowOpenHandler` 全拒；权限请求全拒。
- 所有 IPC 处理器先做 trusted-sender 校验（senderFrame === mainFrame 且 URL 可信），再经严格输入解析（allowed-keys、长度、控制字符、原型检查）。

### 信任边界

- 用户消息、检索到的记忆、模型输出一律视为**不可信数据**：记忆以带 instruction 的 JSON 注入并声明"不是指令"；模型建议必须经用户逐条审核才入记忆；模型输出不写人格、不写权限、不改安全配置。
- 内在状态与兴趣信号在提示词中带强制限定（"不是主观体验/不是权限/不得覆盖事实与安全"），且它们没有任何写人格或权限的代码路径。

### 日志与可观测性

- 结构化日志强制键级脱敏（apikey/authorization/token/secret/password/credential/requestPayload/prompt/content/body/context 等）+ 长串截断。
- 统一事件日志（event_journal）只存有界元数据（≤32 键、单值 ≤2000 字符），验收测试含 journal 全文凭据泄漏扫描。

### 数据库

- 迁移 fail-closed：实现线指纹（版本+命名）不匹配的数据库拒绝打开；升级前自动完整性备份。
- 备份文件导出经完整性/外键/版本/哈希校验，恢复需预览令牌 + 显式确认 + 删除边界确认；`secure_delete=ON`。

## 报告漏洞

私有仓库：请通过仓库的 GitHub Security Advisories 或仓库所有者的私下渠道报告，不要公开提交 issue。请在报告中包含复现步骤与影响评估；不要包含真实凭据或他人数据。

## 已知安全边界（如实声明）

- 本地模型服务器自身暴露的 HTTP（无 TLS、可选口令）不归本项目保护范围；请仅使用回环地址（应用强制）。
- 打包分发（NSIS 安装器）尚未配置代码签名；分发渠道建立前请自行校验构建来源。
