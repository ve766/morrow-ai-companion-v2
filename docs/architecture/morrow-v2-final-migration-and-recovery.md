# 最终迁移与恢复设计（v48 冲突 → v49）

- 实现 SHA：`d07b3f4b951fab2bd522413c789850055a49fe61`
- 迁移文件：`src/persistence/migrations.ts`
- 当前版本：`CURRENT_SCHEMA_VERSION = 49`

## 1. 最终序列

| 版本 | 名称 | 来源 | 作用 |
| --- | --- | --- | --- |
| 48 | `pending-decision-terminal-state` | Stage 4 PR #40 | `cognitive_pending_items` 增加 `finding_id`、`decision` 与索引 |
| 49 | `provider-multi-source-profiles-final` | Provider PR #51 重编号 | 重建 `provider_profiles`，统一 40 字符 id，分离 source/protocol/endpoint/model |

没有跳过 v48，也没有把两个不同结构塞进同一个版本。Provider 的原始 v48 名称只作为“已存在数据库”的输入被识别，最终记录统一为 v48 Stage 4 + v49 Provider。

## 2. 三类数据库的路径

### 2.1 release v47 → v49

正常循环：先执行 v48（加 pending 列），再执行 v49（重建 provider 表）。v49 检测 `provider_profiles` 是否有 `display_name`：

- 无：按旧表复制 `provider_class`、`endpoint`、`model`、`enabled`、`updated_at`，补 `display_name`、`source_kind`、`protocol_id`、`endpoint_path=NULL`、`is_default=0` 和默认 capabilities。
- 有：按 Provider v48 扩展列复制。

### 2.2 Stage 4 v48 → v49

记录名为 `pending-decision-terminal-state`，结构校验确认 pending 列存在；正常循环只执行 v49。v49 走旧 provider 表分支。

### 2.3 Provider v48 → v49（桥接）

记录名为 `provider-multi-source-profiles`，结构校验确认 `provider_profiles.display_name` 存在。`applyMigrations` 在正常循环前执行：

1. 检查 `cognitive_pending_items` 是否已有 `finding_id` / `decision`。
2. 若没有：在 `BEGIN IMMEDIATE` 中执行 Stage 4 的 v48 `up`，把 `schema_migrations` 的 v48 名称改为 `pending-decision-terminal-state`，提交。
3. 若已有（上次桥接已提交列但未改名的恢复场景）：只改名称。
4. 正常身份校验通过后执行 v49。

桥接只处理这一个已知历史身份；任何其他 v48 名称、或名称与结构不一致，都会抛 `SchemaIdentityError`，`SqliteDatabase.open` 关闭连接并报 `Local storage could not be opened.`，不会打开后才因缺列崩溃。

## 3. 事务与失败语义

- 每个 migration 在 `BEGIN IMMEDIATE` 中执行，失败 `ROLLBACK`，不写 `schema_migrations`。
- 桥接与 v49 是两个独立事务：桥接成功、v49 失败时，数据库停在“Stage 4 v48 + Provider v48 表”的中间态；下次启动桥接检测到 pending 列已存在，只改名，然后重试 v49。
- v49 失败时 provider 表保持 v48 形状（重建在事务内回滚），不会留下半张新表。
- `schema_migrations` 身份不匹配、版本高于当前应用、目标版本越界都 fail closed。

## 4. 数据保护

- v49 复制全部 profile 行，包括自定义 profile、endpoint_path、is_default、capabilities、last_test。
- 旧 DeepSeek/Spark/local-openai 行保留 id、endpoint、model、enabled；`local-openai` 映射为 `source_kind='local'`，其余内置映射为 `official`。
- 旧 secret 以 profile id 为键保存在 OS store；id 不变，因此迁移后仍可读取。若某 id 超过 40 字符（仅可能来自 Provider 分支手工数据），v49 的 CHECK 会使迁移失败并回滚；恢复方式是把该 id 改为 ≤40 字符的合法 id 后重试，迁移不会静默截断或丢行。
- pending items、reflection findings/routes、outbox 表由 v48 原样保留，v49 不触碰。
- 重复启动：v49 已记录后不再执行；桥接只对 Provider v48 身份生效。
- 回滚：v49 回滚后数据库仍是 v48 结构；应用可重新运行旧版本或修复冲突后重试。v48/v49 都不删除业务行。

## 5. 覆盖测试

`src/persistence/migrations.test.ts`：

- release v47 → v49，三个内置 profile 字段逐一断言；
- Stage 4 v48 → v49，pending 行与 provider 行保留；
- Provider v48 → v49，桥接补列、改名、自定义 profile 保留；
- 重复启动与桥接重试；
- v49 重建失败回滚（重复 default 触发唯一索引失败），修复冲突后重试成功；
- 数据库边界拒绝 41 字符 id、接受 40 字符 id。

`src/app/provider-multi-source.integration.test.ts`：

- 外来 v48 名称 → fail closed；
- 已知 v48 名称但结构不符 → fail closed；
- v47 → v49 通过生产 `SqliteDatabase.open`。

## 6. Windows 升级路径

CI `windows-install-path` 在最终 SHA 上执行 `src/persistence` 全量迁移测试；`windows-package-smoke` 先用构建产物在隔离 profile 写入数据，再安装 NSIS 包并用 `--verify-upgrade` 启动已安装程序，验证真实安装路径能打开同一迁移后的数据库。
