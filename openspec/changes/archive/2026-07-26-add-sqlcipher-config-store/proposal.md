## Why

`Standalone Service` 和 `Desktop` 目前把服务器目录、默认服务器以及后端凭据直接保存在 `standalone.json` 中，运行时再由 `gateway` 读取并注入到代理请求里。这种方案实现简单，但磁盘落地为明文，且已经成为连接管理能力继续扩展的瓶颈。

现在项目仍处于早期阶段、没有兼容负担，适合直接把网关运行时的配置中心切换为加密数据库：用 `SQLite + SQLCipher` 提供整库透明加密（TDE），并通过统一的主密钥解析接口兼容环境变量与操作系统密钥存储，实现前端无感知、运行时无感知的安全配置存储。

## What Changes

- 将 `Standalone Service` 与 `Desktop` 的服务器配置主存储从 `standalone.json` 切换为 `SQLite + SQLCipher` 整库加密数据库。
- 新增网关侧配置存储抽象，负责数据库打开、主密钥解析、初始化建库和 schema 迁移。
- 新增统一的主密钥解析策略，支持环境变量和 OS Key 两种来源，并为不同运行壳定义默认优先级。
- 保持现有前端配置 API 语义不变，前端继续通过 `__standalone__/config` 读取和保存服务器配置，不感知底层存储介质变化。
- 提供最小可用的初始化与迁移骨架，为后续继续扩展配置、密钥轮换和更多持久化数据打基础。
- **BREAKING**：`Standalone` / `Desktop` 的配置主数据源不再是 `standalone.json`；JSON 仅保留为开发样例或未来的导入导出格式。

## Capabilities

### New Capabilities
- `gateway-config-store`: 为 `Standalone Service` 与 `Desktop` 提供统一的加密配置存储、初始化迁移和主密钥解析能力。

### Modified Capabilities
- None.

## Impact

- Affected code: `rust/crates/gateway`, `rust/apps/desktop/src-tauri`, `deploy/standalone-service`, `src/components/toolbar/StandaloneConfigDialog.vue`, `src/components/toolbar/ServerSwitchMenu.vue`。
- Affected APIs: `__standalone__/config` 的外部语义保持不变，但内部实现将从 JSON 文件读写改为数据库存储。
- New dependencies: `rusqlite`（启用 SQLCipher 相关 feature）、`rusqlite_migration`、`keyring`（或等价 OS Key 接口依赖）。
- Systems: `Standalone Service`、`Desktop` 两个 gateway runtime；`Dist` / `Loader` / `Sidecar` 不直接引入数据库存储职责。
