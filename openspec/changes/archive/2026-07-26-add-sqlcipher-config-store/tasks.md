## 1. 依赖与模块骨架

- [x] 1.1 为 `rust/crates/gateway` 引入 `rusqlite`、`rusqlite_migration` 和所需的 SQLCipher feature
- [x] 1.2 在 `gateway` crate 中拆分出数据库、主密钥解析、存储抽象与迁移目录骨架
- [x] 1.3 定义新的配置领域模型与 `CatalogStore` 接口，替代直接依赖 JSON 文件的实现入口

## 2. 主密钥解析与数据库打开

- [x] 2.1 实现 `MasterKeyResolver` 抽象，统一 `Env` 与 `OS Key` 两种主密钥来源
- [x] 2.2 实现 `Desktop` 的默认解锁策略：优先 OS Key，首次启动自动生成并保存数据库密钥
- [x] 2.3 实现 `Standalone Service` 的默认解锁策略：显式环境变量优先，缺少可用 key 时快速失败
- [x] 2.4 实现 SQLCipher 连接创建、`PRAGMA key` 设置与 key 有效性验证流程

## 3. 初始化、迁移与存储实现

- [x] 3.1 建立 `01_init` 初始迁移并定义服务器目录与通用设置表结构
- [x] 3.2 接入启动时自动迁移执行逻辑，确保服务对外前 schema 已升级到最新版本
- [x] 3.3 实现基于 SQLCipher 的 `CatalogStore`，支持读取默认服务器、列出服务器、保存配置和保留旧密码语义
- [x] 3.4 支持空库初始化并保证配置 API 在无服务器数据时仍可正常返回空目录

## 4. 接入 gateway 与 Desktop

- [x] 4.1 用新的 `CatalogStore` 替换 `gateway` 中现有的 JSON 加载、保存和选择逻辑
- [x] 4.2 保持 `__standalone__/status`、`__standalone__/config` 和代理选择接口的前端契约不变
- [x] 4.3 移除 `Desktop` 默认生成明文 `standalone.json` 的初始化逻辑，改为数据库初始化路径
- [x] 4.4 清理或降级 JSON 配置文件在 runtime 中的职责，只保留必要的样例/文档用途

## 5. 文档与验证

- [x] 5.1 更新 `README`、`deploy/standalone-service` 与 `rust/apps/desktop` 文档，说明加密数据库与密钥来源策略
- [x] 5.2 为数据库初始化、迁移、主密钥解析和配置 API 语义补充 Rust 侧测试
- [x] 5.3 验证 `Standalone Service` 与 `Desktop` 在空库启动、已有库启动和错误 key 场景下的行为
